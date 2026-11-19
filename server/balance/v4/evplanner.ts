/**
 * Balance Designer V4: EXPERIMENT-ONLY expected-value planner candidate ("EV-1").
 *
 * The production planner (server/ai.ts) evaluates every move by running the real engine on a structuredClone of the
 * state, RNG included, so a move that enters a teleport is valued by the ONE destination the hidden RNG will
 * actually produce. This candidate is the same planner (same placement search, same evaluation, same greedy move
 * loop, same reply model, same temperature roll) with exactly one change: a move whose result is random is valued
 * by the probability-weighted average over every legal outcome, enumerated by the engine itself
 * (applyMove + ChanceResolver + teleportDestinations + teleportIndexProbabilities). Concretely:
 *
 *  1. Hidden state is removed before any simulation: every planner state has its RNG overwritten with a constant
 *     (maskHidden). The planner also never lets the engine draw: every simulated move passes a resolver.
 *  2. ExpectedUtility(move) = sum_i P(destination_i) * evaluate(state after the move with destination_i).
 *  3. The move sequence the planner commits to ENDS at the first move with a random outcome. The real game then
 *     resolves it, the destination becomes public, and the planner is asked again (playTurnMoves / executeEV).
 *     It never issues moves that assume the destination of an unresolved teleport.
 *  4. Whole-turn look-ahead (placement choice and the opponent reply) averages over the same outcome tree:
 *     after the first random move the planner's own continuation is planned separately for each outcome (that is
 *     what it will be able to do once it sees the result), then the opponent's reply is simulated for each.
 *     Deeper random events inside a continuation or inside the reply are averaged without further continuation.
 *
 * Exact enumeration everywhere a DECISION is made (every greedy move choice, own and opponent). One bounded,
 * explicitly labelled approximation exists, in the whole-turn ranking only: when a placement candidate has more than
 * REPLY_STRATA possible end-of-move-phase states, the opponent reply (the most expensive part) is simulated for
 * REPLY_STRATA representatives instead of all of them: the end states are ordered by their (public) evaluation,
 * cut into REPLY_STRATA strata of equal probability, and each stratum's middle state stands for the stratum's whole
 * probability mass. It uses no RNG at all. Its error against exact replies is measured in tests/balance-v4.test.ts.
 * evaluateCached() is the production evaluate() with a memo of the per-piece path cost (exact, tested equal).
 * Production never imports this module (tests check it); it is only reachable from V4 self-play and tests.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type State, type Placement, type Move, type ChanceResolver, applyPlacement, applyMove, endTurn, legalMoves, validatePlacement,
  teleportDestinations, teleportIndexProbabilities, parseKey,
} from '../../engine.ts';
import { type Player, other } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS, effectUpkeep, plannerEffects } from '../../weights.ts';
import { evaluate, pieceCost, bestCells, describeTurn, placementValue, type TurnPlan, type Plan } from '../../ai.ts';
import { effectId } from '../../weights.ts';

/** Max opponent-reply simulations per placement candidate in the whole-turn ranking (see header). */
export const REPLY_STRATA = 16;

export const EV_PLANNER_ID = 'ev-teleport-v4.1';
export const EV_PLANNER_FILE = 'server/balance/v4/evplanner.ts';
/** Content hash of this file (LF-normalised): identifies the exact candidate that produced a record. */
export const evPlannerHash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/** The constant every planner simulation sees in place of the real RNG state. */
export const MASKED_RNG = 0x5eed0001;
/** Copy of the state with every piece of non-public information replaced by a constant. */
export function maskHidden(s: State): State { const t = structuredClone(s); t.rng = MASKED_RNG; return t; }

export type Outcome = { p: number; state: State; random: boolean; destination: string | null };
/**
 * Every legal outcome of one move with its exact engine probability, computed by the engine itself. A move with no
 * random effect has one outcome with p = 1. The input state is not modified.
 */
export function moveOutcomes(s: State, p: Player, m: Move): Outcome[] {
  let seen: readonly string[] | null = null;
  const probe = structuredClone(s);
  const first: ChanceResolver = { teleport: d => { seen = d; return 0; } };
  applyMove(probe, p, m, first);
  const dests = seen as readonly string[] | null;
  if (!dests) return [{ p: 1, state: probe, random: false, destination: null }];
  const probs = teleportIndexProbabilities(dests.length);
  const out: Outcome[] = [{ p: probs[0], state: probe, random: dests.length > 1, destination: dests[0] }];
  for (let i = 1; i < dests.length; i++) {
    const t = structuredClone(s);
    let n = -1;
    applyMove(t, p, m, { teleport: d => { n = d.length; return i; } });
    if (n !== dests.length) throw new Error('teleport destination list changed between enumerations');
    out.push({ p: probs[i], state: t, random: true, destination: dests[i] });
  }
  return out;
}
/** Public, engine-owned distribution of a teleport from `from` (exposes no RNG). */
export function teleportDistribution(s: State, from: string): { cell: string; p: number }[] {
  const d = teleportDestinations(s, parseKey(from)), pr = teleportIndexProbabilities(d.length);
  return d.map((cell, i) => ({ cell, p: pr[i] }));
}

export type Ctx = { w: Weights; sims: number; outcomeStates: number; memo: Map<string, number>; replyStrata: number; approximated: number };
export const newCtx = (w: Weights = DEFAULT_WEIGHTS, replyStrata = REPLY_STRATA): Ctx => ({ w, sims: 0, outcomeStates: 0, memo: new Map(), replyStrata, approximated: 0 });
/**
 * Exactly ai.ts evaluate() (no hooks), with pieceCost memoised. pieceCost depends only on the piece (owner, square,
 * frozen, shield, scored) and the live effects on the board, which is what the key holds.
 */
export function evaluateCached(s: State, me: Player, ctx: Ctx): number {
  const opp = other(me);
  if (s.winner === me) return 1000;
  if (s.winner === opp) return -1000;
  if (s.winner === 'draw') return 0;
  const sig = Object.keys(s.cells).sort().map(k => `${k}=${effectId(s.rules.find(r => r.id === s.cells[k])!.effect)}`).join(';');
  if (ctx.memo.size > 200_000) ctx.memo.clear();
  const cost = (p: Player) => { let c = 0; for (const q of s.pieces) { if (q.owner !== p || q.scored) continue; const k = `${sig}|${q.owner}${q.x}${q.y}${q.frozen}${q.shield ? 1 : 0}`; let v = ctx.memo.get(k); if (v === undefined) { v = pieceCost(s, q, ctx.w); ctx.memo.set(k, v); } c += v; } return c; };
  const sc = (p: Player) => s.pieces.filter(q => q.owner === p && q.scored).length;
  return cost(opp) - cost(me) + ctx.w.planner.scoredBonus * (sc(me) - sc(opp));
}
export type GreedyEV = {
  /** Moves the planner commits to now. If `pending` is set, the last one has a random outcome. */
  moves: Move[];
  /** Deterministic end of the committed moves (pending = null), or the outcomes of the last, random, move. */
  state: State | null; pending: Outcome[] | null; expected: number;
};
/**
 * Greedy move loop of the production planner with expected values. Same stopping rule (stop when the best move is
 * worse than standing still by more than 0.25) and the same per-candidate noise. Stops right after a random move.
 */
export function greedyEV(s0: State, p: Player, ctx: Ctx, noise = 0, rnd: () => number = Math.random): GreedyEV {
  let s = s0.rng === MASKED_RNG ? structuredClone(s0) : maskHidden(s0);
  const moves: Move[] = [];
  while (s.current === p && !s.winner && s.actionsLeft > 0) {
    const base = evaluateCached(s, p, ctx);
    let best: { m: Move; v: number; outs: Outcome[] } | null = null;
    for (const m of legalMoves(s, p)) {
      const outs = moveOutcomes(s, p, m); ctx.sims += outs.length;
      const v = outs.reduce((a, o) => a + o.p * evaluateCached(o.state, p, ctx), 0) + (noise ? (rnd() - 0.5) * noise : 0);
      if (!best || v > best.v) best = { m, v, outs };
    }
    if (!best || best.v < base - 0.25) break;
    moves.push(best.m);
    if (best.outs.length > 1) return { moves, state: null, pending: best.outs, expected: best.v };
    s = best.outs[0].state;
  }
  return { moves, state: s, pending: null, expected: evaluateCached(s, p, ctx) };
}

/** Probability-weighted end states of `p`'s move phase (own continuation after the FIRST random event only). */
function turnEnds(s: State, p: Player, ctx: Ctx, noise: number, rnd: () => number): { first: GreedyEV; ends: { p: number; state: State }[] } {
  const first = greedyEV(s, p, ctx, noise, rnd);
  if (!first.pending) return { first, ends: [{ p: 1, state: first.state! }] };
  const ends: { p: number; state: State }[] = [];
  for (const o of first.pending) {
    const cont = greedyEV(o.state, p, ctx, 0);
    if (!cont.pending) ends.push({ p: o.p, state: cont.state! });
    else for (const o2 of cont.pending) ends.push({ p: o.p * o2.p, state: o2.state }); // deeper chance: averaged, no further continuation
  }
  ctx.outcomeStates += ends.length;
  return { first, ends };
}
/** Expected evaluation (for `me`) after the opponent's greedy EV reply to state `s`. */
function replyValue(s: State, me: Player, ctx: Ctx): number {
  if (s.winner) return evaluateCached(s, me, ctx);
  const rep = structuredClone(s);
  endTurn(rep);
  const opp = other(me);
  if (rep.winner || rep.current !== opp) return evaluateCached(rep, me, ctx);
  const r = greedyEV(rep, opp, ctx, 0);
  if (!r.pending) return evaluateCached(r.state!, me, ctx);
  ctx.outcomeStates += r.pending.length;
  return r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0);
}

function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; }

export type EVPlan = Plan & { plannerId: string; outcomeStates: number; approximatedCandidates: number };
/**
 * Whole-turn plan with the production structure (candidate placements x greedy moves x opponent reply, same score
 * formula, same temperature roll seeded from the game seed and turn as in production) but every random outcome
 * averaged. `chosen.moves` is only the committed prefix (it ends at the first random move).
 */
/** The labelled approximation (see header): at most ctx.replyStrata representatives carrying the full probability mass. */
export function stratify<T extends { p: number; v: number; state: State }>(ends: T[], ctx: Ctx): { p: number; state: State }[] {
  const R = ctx.replyStrata;
  if (ends.length <= R) return ends;
  ctx.approximated++;
  const sorted = [...ends].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((a, e) => a + e.p, 0);
  const strata: { mass: number; best: T | null; dist: number }[] = Array.from({ length: R }, () => ({ mass: 0, best: null, dist: Infinity }));
  let cum = 0;
  for (const e of sorted) {
    const mid = (cum + e.p / 2) / total; cum += e.p;
    const k = Math.min(R - 1, Math.floor(mid * R)), centre = (k + 0.5) / R;
    strata[k].mass += e.p;
    if (Math.abs(mid - centre) < strata[k].dist) { strata[k].dist = Math.abs(mid - centre); strata[k].best = e; }
  }
  return strata.filter(x => x.best).map(x => ({ p: x.mass, state: x.best!.state }));
}

export function planTurnEV(s0: State, opts: { me?: Player; temperature?: number; weights?: Weights; replyStrata?: number } = {}): EVPlan {
  const t0 = performance.now();
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const me = opts.me ?? 'ai', temperature = opts.temperature ?? w.planner.temperature;
  const s = maskHidden(s0);
  // Planner randomness: the same stream as production, derived from the game seed and the turn number. It is the
  // planner's own tie-breaking noise and never reads the engine RNG state, so it carries no outcome information.
  const r = rng((s0.seed ^ Math.imul(s0.turn + 7, 0x9e3779b1)) >>> 0);
  const placements: (Placement | null)[] = [null];
  for (const e of plannerEffects(w)) {
    const cells = bestCells(s, me, e, w);
    if (!cells.length) continue;
    const pl: Placement = { text: 'planner', effect: e, cells, interpretedBy: 'planner' };
    if (validatePlacement(s, me, pl).ok) placements.push(pl);
  }
  const ctx = newCtx(w, opts.replyStrata ?? REPLY_STRATA);
  const ranked: TurnPlan[] = [];
  for (const pl of placements) {
    const st = structuredClone(s);
    if (pl) applyPlacement(st, me, pl);
    const { first, ends } = turnEnds(st, me, ctx, 0.02, r);
    const vals = ends.map(e => evaluateCached(e.state, me, ctx));
    const immediate = ends.reduce((a, e, i) => a + e.p * vals[i], 0);
    const afterReply = stratify(ends.map((e, i) => ({ ...e, v: vals[i] })), ctx).reduce((a, e) => a + e.p * replyValue(e.state, me, ctx), 0);
    const upkeep = pl ? effectUpkeep(w, pl.effect) : 0;
    const overlay = pl && w.weightMix ? w.weightMix * placementValue(s, me, pl, w) : 0;
    ranked.push({ id: '', placement: pl, moves: first.moves, score: immediate * w.planner.immediateWeight + afterReply * w.planner.replyWeight - upkeep + overlay, afterReply, summary: describeTurn(pl, first.moves) + (first.pending ? ' (then re-plan after the teleport)' : '') });
  }
  ranked.sort((a, b) => b.score - a.score || a.summary.localeCompare(b.summary));
  ranked.forEach((c, i) => { c.id = 'p' + (i + 1); });
  let chosen = ranked[0];
  const near = ranked.filter(c => c.score >= ranked[0].score - temperature);
  if (temperature > 0 && near.length > 1) {
    const ws = near.map(c => Math.exp((c.score - ranked[0].score) / temperature * 2.5));
    let roll = r() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { roll -= ws[i]; if (roll <= 0) { chosen = near[i]; break; } }
  }
  return { chosen, ranked, candidates: placements.length, sims: ctx.sims, ms: Math.round(performance.now() - t0), plannerId: EV_PLANNER_ID, outcomeStates: ctx.outcomeStates, approximatedCandidates: ctx.approximated };
}

/** Moves to play next on the REAL board: the committed prefix (ends at a random move, then ask again). */
export function nextMovesEV(real: State, p: Player, w: Weights = DEFAULT_WEIGHTS): { moves: Move[]; endsAtChance: boolean; sims: number } {
  const ctx = newCtx(w);
  const g = greedyEV(real, p, ctx, 0);
  return { moves: g.moves, endsAtChance: !!g.pending, sims: ctx.sims };
}

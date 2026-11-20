/**
 * Policy-diversity preparation (V5, EXPERIMENT-ONLY, no game has been played with these yet).
 *
 * Three self-play policies whose observations can be compared, so that a balance pattern can be attributed to the
 * rules only if it survives a change of policy:
 *
 *  REF  'ev-k1'      the frozen V4.2 reference: EV teleport planner + K1 side-relative tie-breaking
 *                    (server/balance/v4/evplanner.ts, hash 3af55720fad8b2ce, variant { sideRelativeOrder: true }).
 *  OA   'oa-v1'      opponent-aware maximin search. Different decision rule: for the reference's top-N whole-turn
 *                    candidates, enumerate the end states of its own move phase (exact over teleports), then let the
 *                    opponent answer with EVERY placement option (or none) followed by its greedy moves, and assume
 *                    the answer that is worst for us. Pick the candidate with the best expected worst case.
 *                    No immediate/reply weighting, no placement overlay, no temperature: a pessimistic searcher.
 *  SM   'softmax-v1' uncertainty-aware bounded Top-k softmax over the reference's ranked candidates: candidates
 *                    whose score gap is within the reference's measured prediction error are treated as nearly
 *                    equivalent and sampled, so it explores openings the deterministic reference never plays.
 *
 * Mandatory for every policy (tests/policies-v5.test.ts): decisions never depend on the hidden RNG (all planning on
 * maskHidden states, chance enumerated by the engine), and a position and its left-right mirror (sides swapped) get the
 * mirrored decision (side-relative ordering everywhere, ties broken by a side-relative canonical key, sampling seeded by
 * public game seed + turn only).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type State, type Placement, type Move, applyPlacement, applyMove, endTurn, validatePlacement } from '../../engine.ts';
import { type Player, type Effect, other, makeEffect } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS, plannerEffects, effectId } from '../../weights.ts';
import { cellPenalty, describeTurn, type TurnPlan, type Plan } from '../../ai.ts';
import { eligibleCells, ruleAt, parseKey, GOAL_X } from '../../engine.ts';
import { MAX_CELLS_PER_TURN } from '../../rules.ts';
import { planTurnEV, nextMovesEV, maskHidden, moveOutcomes, greedyEV, newCtx, evaluateCached, orderedMoves, type Ctx } from '../v4/evplanner.ts';

export type PolicyId = 'ev-k1' | 'oa-v1' | 'softmax-v1';
export const K1 = { sideRelativeOrder: true } as const;
export const POLICY_FILE = 'server/balance/v5/policies.ts';
export const policiesHash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/** Frozen parameters (part of the policy definition; changing one is a new policy version). */
export const PARAMS = {
  oa: { topN: 6, maxEnds: 8 },
  /** T = calibrated prediction error / 2. 2.651 = mean |predicted after-reply - real| of the reference reply model on 33
   *  recorded positions (evidence/balance/v4/v42/manipulation.json, K2.recorded.meanAbsPredictionErrorE0). */
  softmax: { k: 4, temperature: 2.651 / 2, minProb: 0.02 },
} as const;

// ---------------------------------------------------------------- side-relative canonical keys
const flipEW = (e: Effect): Effect => (e.kind === 'shove' && (e.dir === 'east' || e.dir === 'west') ? makeEffect('shove', e.dir === 'east' ? 'west' : 'east', e.amount) : e);
const rx = (p: Player, x: number) => (p === 'ai' ? 6 - x : x);
const rCell = (p: Player, k: string) => { const [x, y] = k.split(',').map(Number); return `${rx(p, x)},${y}`; };
const rDir = (p: Player, d: Move['dir']) => (p === 'ai' ? (d === 'left' ? 'right' : d === 'right' ? 'left' : d) : d);
/** A plan described relative to the side that plays it: identical for a plan and its mirror. */
export function canonicalPlan(p: Player, c: { placement: Placement | null; moves: Move[] }): string {
  const pl = c.placement ? `${effectId(p === 'ai' ? flipEW(c.placement.effect) : c.placement.effect)}@${c.placement.cells.map(k => rCell(p, k)).sort().join(' ')}` : 'none';
  return `${pl}|${c.moves.map(m => `${rCell(p, m.from)}${rDir(p, m.dir)}${m.mode}`).join(' ')}`;
}
const byScoreThenCanon = (p: Player) => (a: TurnPlan, b: TurnPlan) => {
  const d = Math.abs(b.score - a.score) < 1e-7 ? 0 : b.score - a.score; if (d) return d;
  const ka = canonicalPlan(p, a), kb = canonicalPlan(p, b); return ka < kb ? -1 : ka > kb ? 1 : 0;
};
/** Planner randomness from PUBLIC data only (game seed, turn, policy label), never the engine RNG. */
function publicStream(seed: number, turn: number, label: string) {
  let x = parseInt(createHash('sha256').update(`${seed >>> 0}|${turn}|${label}`).digest('hex').slice(0, 8), 16) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; };
}

export type PolicyPlan = Plan & { policy: PolicyId; probabilities?: { id: string; p: number }[]; worstCase?: { id: string; v: number }[] };

/** REF: the frozen reference, ranked deterministically and symmetrically (temperature roll as in V4.2). */
export function planRef(s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  return { ...planTurnEV(s, { me, weights: w, variant: K1 }), policy: 'ev-k1' };
}

/** SM: bounded Top-k softmax with the calibrated uncertainty temperature. */
export function planSoftmax(s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  const base = planTurnEV(s, { me, weights: w, variant: K1, temperature: 0 });
  const ranked = [...base.ranked].sort(byScoreThenCanon(me));
  const top = ranked.slice(0, PARAMS.softmax.k), best = top[0].score;
  let ws = top.map(c => Math.exp((c.score - best) / PARAMS.softmax.temperature));
  const z0 = ws.reduce((a, b) => a + b, 0); ws = ws.map(x => (x / z0 < PARAMS.softmax.minProb ? 0 : x));
  const z = ws.reduce((a, b) => a + b, 0), probs = ws.map(x => x / z);
  let roll = publicStream(s.seed, s.turn, 'softmax-v1')(), chosen = top[0];
  for (let i = 0; i < top.length; i++) { roll -= probs[i]; if (roll <= 0 && probs[i] > 0) { chosen = top[i]; break; } }
  return { ...base, ranked, chosen, policy: 'softmax-v1', probabilities: top.map((c, i) => ({ id: c.id, p: Math.round(probs[i] * 1e6) / 1e6 })) };
}

/** End states of our move phase after a placement: exact over teleports, our greedy continuation after the first one. */
export function ownEnds(st: State, me: Player, ctx: Ctx): { p: number; state: State; v: number }[] {
  const first = greedySym(st, me, ctx, 0);
  const raw: { p: number; state: State }[] = [];
  if (!first.pending) raw.push({ p: 1, state: first.state! });
  else for (const o of first.pending) { const c = greedySym(o.state, me, ctx, 0); if (!c.pending) raw.push({ p: o.p, state: c.state! }); else for (const o2 of c.pending) raw.push({ p: o.p * o2.p, state: o2.state }); }
  return raw.map(e => ({ ...e, v: evaluateCached(e.state, me, ctx) }));
}
/**
 * Labelled approximation: at most R representative end states. Ends are sorted by value (1e-9 resolution) then by a
 * side-relative description, cut into R groups of equal COUNT (not floating-point mass, which differs by ~1e-9 between
 * mirrored destinations), and each group's middle state carries the group's total probability. Depends only on the
 * symmetric order, so a position and its mirror get the same representatives.
 */
function rankStrata(ends: { p: number; state: State; v: number }[], me: Player, R: number): { p: number; state: State }[] {
  if (ends.length <= R) return ends;
  const key = (st: State) => canonicalState(st, me);
  const sorted = [...ends].sort((a, b) => (Math.abs(a.v - b.v) < 1e-7 ? 0 : a.v - b.v) || (key(a.state) < key(b.state) ? -1 : key(a.state) > key(b.state) ? 1 : 0));
  const out: { p: number; state: State }[] = [];
  for (let g = 0; g < R; g++) { const lo = Math.floor(g * sorted.length / R), hi = Math.floor((g + 1) * sorted.length / R); if (hi <= lo) continue; const grp = sorted.slice(lo, hi); out.push({ p: grp.reduce((a, e) => a + e.p, 0), state: grp[Math.floor((grp.length - 1) / 2)].state }); }
  return out;
}
/**
 * The reference greedy move loop (evplanner greedyEV, noise 0, same stop rule) with expected values compared at 1e-9
 * resolution: the engine's exact draw law gives destination index 0 a probability ~1e-9 off, and destinations are
 * indexed in board order, so unrounded comparisons can break real ties differently for a position and its mirror.
 */
export function greedySym(s0: State, p: Player, ctx: Ctx, _noise = 0): { moves: Move[]; state: State | null; pending: ReturnType<typeof moveOutcomes> | null } {
  const TIE = 1e-7; // values closer than this are a tie, broken by the side-relative move order
  let s = maskHidden(s0);
  const moves: Move[] = [];
  while (s.current === p && !s.winner && s.actionsLeft > 0) {
    const base = evaluateCached(s, p, ctx);
    let best: { m: Move; v: number; outs: ReturnType<typeof moveOutcomes> } | null = null;
    for (const m of orderedMoves(s, p, true)) {
      const outs = moveOutcomes(s, p, m); ctx.sims += outs.length;
      const v = outs.reduce((a, o) => a + o.p * evaluateCached(o.state, p, ctx), 0);
      if (!best || v > best.v + TIE) best = { m, v, outs };
    }
    if (!best || best.v < base - 0.25) break;
    moves.push(best.m);
    if (best.outs.length > 1) return { moves, state: null, pending: best.outs };
    s = best.outs[0].state;
  }
  return { moves, state: s, pending: null };
}
/** Side-relative description of a whole state (pieces, live effects, actions, bonus, winner). */
export function canonicalState(st: State, me: Player): string {
  const rEff = (id: string) => (me === 'ai' ? id.replace('east', 'W').replace('west', 'east').replace('W', 'west') : id);
  return st.pieces.map(q => `${q.owner === me ? 'm' : 'o'}${q.scored ? 's' : `${rx(me, q.x)},${q.y}`},${q.frozen},${q.shield ? 1 : 0},h${rx(me, q.home.x)},${q.home.y}`).sort().join(';')
    + '|' + Object.entries(st.cells).map(([k, id]) => { const r = st.rules.find(z => z.id === id)!; return `${rCell(me, k)}=${rEff(effectId(r.effect))}:${r.owner === me ? 'm' : 'o'}`; }).sort().join(';')
    + '|' + `${st.actionsLeft},${st.bonus[me]},${st.bonus[other(me)]},${st.winner === null ? '-' : st.winner === me ? 'm' : st.winner === 'draw' ? 'd' : 'o'}`;
}
/**
 * The production trap-cell search (ai.ts bestCells: same per-cell value, same 0.05 floor, top 3) with equal values
 * (1e-9) broken by a side-relative cell key instead of the board key, so the simulated opponent places mirror-
 * symmetrically. Used only inside the OA policy's opponent model; the frozen reference keeps ai.ts bestCells.
 */
export function symBestCells(s: State, p: Player, e: Effect, w: Weights): string[] {
  const pieces = s.pieces.filter(q => !q.scored);
  const scored = eligibleCells(s, p).filter(k => !ruleAt(s, k)).map(k => {
    const c = parseKey(k); let v = 0;
    for (const q of pieces) {
      const ahead = (GOAL_X[q.owner] - q.x) * (GOAL_X[q.owner] - c.x) >= 0 ? 1 : 0.3;
      const d = Math.abs(q.x - c.x) + Math.abs(q.y - c.y), lateral = Math.abs(q.y - c.y);
      v += (q.owner === p ? -w.planner.selfHarmFactor : 1) * (ahead / (1 + 0.6 * d + 0.8 * lateral)) * cellPenalty(s, q.owner, k, e, w);
    }
    return { k, v, r: rCell(p, k) };
  }).filter(o => o.v > 0.05).sort((a, b) => (Math.abs(b.v - a.v) < 1e-7 ? 0 : b.v - a.v) || (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
  return scored.slice(0, MAX_CELLS_PER_TURN).map(o => o.k).sort();
}
/** Our value after the opponent's answer that is WORST for us (placement option x its greedy moves, chance averaged). */
export function worstAnswer(s: State, me: Player, ctx: Ctx): number {
  if (s.winner) return evaluateCached(s, me, ctx);
  const rep = structuredClone(s); endTurn(rep);
  const opp = other(me);
  if (rep.winner || rep.current !== opp) return evaluateCached(rep, me, ctx);
  const after = (st: State) => { const r = greedySym(st, opp, ctx, 0); return r.pending ? r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0) : evaluateCached(r.state!, me, ctx); };
  let worst = after(rep);
  const effs = opp === 'ai' ? plannerEffects(ctx.w).map(flipEW) : plannerEffects(ctx.w);
  for (const e of effs) {
    const cells = symBestCells(rep, opp, e, ctx.w);
    if (!cells.length) continue;
    const pl: Placement = { text: 'planner', effect: e, cells, interpretedBy: 'planner' };
    if (!validatePlacement(rep, opp, pl).ok) continue;
    const st = structuredClone(rep); applyPlacement(st, opp, pl);
    worst = Math.min(worst, after(st));
  }
  return worst;
}
/** OA: maximin over the reference's top-N candidates. */
/**
 * OA: maximin with its OWN symmetric candidate set (not the reference's ranking, which still contains coordinate tie
 * breaks): no placement, or each planner effect on its side-relative best cells. All candidates are pre-ranked by the
 * expected value of our own move phase (exact over teleports), the top N get the full worst-case opponent search.
 */
export function planOpponentAware(s0: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  const t0 = performance.now();
  const s = maskHidden(s0), ctx = newCtx(w, PARAMS.oa.maxEnds, K1); ctx.me = me;
  const effs = me === 'ai' ? plannerEffects(w).map(flipEW) : plannerEffects(w);
  const pls: (Placement | null)[] = [null];
  for (const e of effs) { const cells = symBestCells(s, me, e, w); if (!cells.length) continue; const pl: Placement = { text: 'planner', effect: e, cells, interpretedBy: 'planner' }; if (validatePlacement(s, me, pl).ok) pls.push(pl); }
  const pre = pls.map(pl => {
    const st = structuredClone(s); if (pl) applyPlacement(st, me, pl); if (st.phase === 'place') st.phase = 'move';
    const g = greedySym(st, me, ctx, 0), ends = ownEnds(st, me, ctx);
    const total = ends.reduce((a, e) => a + e.p, 0);
    return { c: { id: '', placement: pl, moves: g.moves, score: 0, afterReply: 0, summary: describeTurn(pl, g.moves) } as TurnPlan, ends, own: ends.reduce((a, e) => a + e.p * e.v, 0) / total };
  });
  const order = (a: { c: TurnPlan; v: number }, b: { c: TurnPlan; v: number }) => { const d = Math.abs(b.v - a.v) < 1e-7 ? 0 : b.v - a.v; if (d) return d; const ka = canonicalPlan(me, a.c), kb = canonicalPlan(me, b.c); return ka < kb ? -1 : ka > kb ? 1 : 0; };
  const top = pre.map(x => ({ ...x, v: x.own })).sort(order).slice(0, PARAMS.oa.topN);
  const scored = top.map(x => { const ends = rankStrata(x.ends, me, PARAMS.oa.maxEnds), total = ends.reduce((a, e) => a + e.p, 0); return { c: x.c, v: ends.reduce((a, e) => a + e.p * worstAnswer(e.state, me, ctx), 0) / total }; }).sort(order);
  const ranked = scored.map((x, i) => ({ ...x.c, id: 'p' + (i + 1), score: x.v }));
  return { chosen: ranked[0], ranked, candidates: pls.length, sims: ctx.sims, ms: Math.round(performance.now() - t0), policy: 'oa-v1', worstCase: ranked.map(x => ({ id: x.id, v: Math.round(x.score * 1000) / 1000 })) };
}

export function planPolicy(id: PolicyId, s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  return id === 'oa-v1' ? planOpponentAware(s, me, w) : id === 'softmax-v1' ? planSoftmax(s, me, w) : planRef(s, me, w);
}
/** Moves on the real board after the chosen placement: every policy uses the reference's EV greedy executor with K1. */
export const policyMoves = (real: State, p: Player, w: Weights = DEFAULT_WEIGHTS) => nextMovesEV(real, p, w, K1);
export { orderedMoves, applyMove, moveOutcomes };

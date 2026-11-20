/**
 * V5.1 C1-C4 ablation planner (EXPERIMENT-ONLY, versioned 'abl-1'). One implementation with four switches, so that
 *   flags {}                     == frozen ev-k1   (server/balance/v4/evplanner.ts, { sideRelativeOrder: true })
 *   flags { c1, c2, c3, c4 }     == ev-k1.1        (server/balance/v5/evk11.ts)
 * both checked decision-by-decision (tests/ablation-v51.test.ts, preflight). Historical implementations are untouched.
 *
 *  C1 trap-cell search: side-relative tie-breaking (symBestCells) instead of ai.ts bestCells.
 *  C2 reply-strata ordering key: complete side-relative state description incl. piece homes (canonicalState) instead
 *     of ev-k1's description without homes.
 *  C3 near-ties: value comparisons treat |d| < 1e-7 as equal everywhere (greedy choice and stop rule, strata order /
 *     distance, candidate ranking with a canonical plan tie-break, temperature window) instead of ev-k1's exact / 1e-9
 *     rounded comparisons and summary-string tie-break.
 *  C4 planner/executor consistency: planning greedy without the 0.02 noise (= the executor) instead of with it.
 *
 * Executor for every arm: the same greedy move loop as planning but noise-free, with the arm's C3 setting (ev-k1's
 * executor, nextMovesEV, is exactly that loop with C3 off).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type State, type Placement, type Move, applyPlacement, endTurn, validatePlacement } from '../../engine.ts';
import { type Player, type Effect, other } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS, effectUpkeep, plannerEffects, effectId } from '../../weights.ts';
import { bestCells, describeTurn, placementValue, type TurnPlan, type Plan } from '../../ai.ts';
import { maskHidden, moveOutcomes, evaluateCached, newCtx, orderedMoves, MASKED_RNG, REPLY_STRATA, type Ctx, type Outcome } from '../v4/evplanner.ts';
import { symBestCells, canonicalState, canonicalPlan, flipEW, cmpVal } from '../v5/evk11.ts';

export type AblFlags = { c1?: boolean; c2?: boolean; c3?: boolean; c4?: boolean };
export const ABL_ID = 'abl-1';
export const ablationHash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
const K1 = { sideRelativeOrder: true } as const;
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** ev-k1's strata description (no piece homes). */
function canonK1(st: State, me: Player) {
  const rx = (x: number) => (me === 'ai' ? 6 - x : x);
  const rEff = (id: string) => (me === 'ai' ? id.replace('east', 'W').replace('west', 'east').replace('W', 'west') : id);
  return st.pieces.map(q => `${q.owner === me ? 'm' : 'o'}${q.scored ? 's' : `${rx(q.x)},${q.y}`},${q.frozen},${q.shield ? 1 : 0}`).sort().join(';')
    + '|' + Object.entries(st.cells).map(([k, id]) => { const [x, y] = k.split(',').map(Number); const r = st.rules.find(z => z.id === id)!; return `${rx(x)},${y}=${rEff(effectId(r.effect))}:${r.owner === me ? 'm' : 'o'}`; }).sort().join(';')
    + '|' + `${st.actionsLeft},${st.bonus[me]},${st.bonus[other(me)]},${st.winner === null ? '-' : st.winner === me ? 'm' : st.winner === 'draw' ? 'd' : 'o'}`;
}

type G = { moves: Move[]; state: State | null; pending: Outcome[] | null };
/** Greedy EV move loop: ev-k1's (exact '>' comparisons, optional noise) or C3's (TIE comparisons). */
export function greedyAbl(s0: State, p: Player, ctx: Ctx, f: AblFlags, noise = 0, rnd: () => number = Math.random): G {
  let s = s0.rng === MASKED_RNG ? structuredClone(s0) : maskHidden(s0);
  const moves: Move[] = [];
  while (s.current === p && !s.winner && s.actionsLeft > 0) {
    const base = evaluateCached(s, p, ctx);
    let best: { m: Move; v: number; outs: Outcome[] } | null = null;
    for (const m of orderedMoves(s, p, true)) {
      const outs = moveOutcomes(s, p, m); ctx.sims += outs.length;
      const v = outs.reduce((a, o) => a + o.p * evaluateCached(o.state, p, ctx), 0) + (noise ? (rnd() - 0.5) * noise : 0);
      if (!best || (f.c3 ? cmpVal(v, best.v) > 0 : v > best.v)) best = { m, v, outs };
    }
    if (!best || (f.c3 ? cmpVal(best.v, base - 0.25) < 0 : best.v < base - 0.25)) break;
    moves.push(best.m);
    if (best.outs.length > 1) return { moves, state: null, pending: best.outs };
    s = best.outs[0].state;
  }
  return { moves, state: s, pending: null };
}
function stratifyAbl<T extends { p: number; v: number; state: State }>(ends: T[], me: Player, R: number, f: AblFlags): { p: number; state: State }[] {
  if (ends.length <= R) return ends;
  const key = new Map(ends.map(e => [e, f.c2 ? canonicalState(e.state, me) : canonK1(e.state, me)]));
  const q9 = (x: number) => Math.round(x * 1e9) / 1e9;
  const sorted = [...ends].sort((a, b) => (f.c3 ? cmpVal(a.v, b.v) : q9(a.v) - q9(b.v)) || cmpStr(key.get(a)!, key.get(b)!));
  const total = sorted.reduce((a, e) => a + e.p, 0);
  const strata: { mass: number; best: T | null; dist: number }[] = Array.from({ length: R }, () => ({ mass: 0, best: null, dist: Infinity }));
  let cum = 0;
  for (const e of sorted) {
    const mid = f.c3 ? (cum + e.p / 2) / total : q9((cum + e.p / 2) / total); cum += e.p;
    const k = Math.min(R - 1, Math.floor(mid * R + 1e-6)), dist = f.c3 ? Math.abs(mid - (k + 0.5) / R) : q9(Math.abs(mid - (k + 0.5) / R));
    strata[k].mass += e.p;
    if (f.c3 ? cmpVal(dist, strata[k].dist) < 0 : dist < strata[k].dist) { strata[k].dist = dist; strata[k].best = e; }
  }
  return strata.filter(x => x.best).map(x => ({ p: x.mass, state: x.best!.state }));
}
function replyValueAbl(s: State, me: Player, ctx: Ctx, f: AblFlags): number {
  if (s.winner) return evaluateCached(s, me, ctx);
  const rep = structuredClone(s); endTurn(rep);
  const opp = other(me);
  if (rep.winner || rep.current !== opp) return evaluateCached(rep, me, ctx);
  const r = greedyAbl(rep, opp, ctx, f);
  if (!r.pending) return evaluateCached(r.state!, me, ctx);
  return r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0);
}
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; }

export type AblPlan = Plan & { plannerId: string; flags: AblFlags };
export function planTurnAbl(s0: State, f: AblFlags, opts: { me?: Player; temperature?: number; weights?: Weights } = {}): AblPlan {
  const t0 = performance.now();
  const w = opts.weights ?? DEFAULT_WEIGHTS, me = opts.me ?? 'ai', temperature = opts.temperature ?? w.planner.temperature;
  const s = maskHidden(s0);
  const r = rng((s0.seed ^ Math.imul(s0.turn + 7, 0x9e3779b1)) >>> 0);
  const placements: (Placement | null)[] = [null];
  for (const e of me === 'ai' ? plannerEffects(w).map(flipEW) : plannerEffects(w)) {
    const cells = f.c1 ? symBestCells(s, me, e, w) : bestCells(s, me, e, w);
    if (!cells.length) continue;
    const pl: Placement = { text: 'planner', effect: e, cells, interpretedBy: 'planner' };
    if (validatePlacement(s, me, pl).ok) placements.push(pl);
  }
  const ctx = newCtx(w, REPLY_STRATA, K1); ctx.me = me;
  const ranked: TurnPlan[] = [];
  for (const pl of placements) {
    const st = structuredClone(s);
    if (pl) applyPlacement(st, me, pl);
    // ev-k1 turnEnds: the first greedy pass carries the planning noise (unless C4), continuations after a teleport do not
    const first = greedyAbl(st, me, ctx, f, f.c4 ? 0 : 0.02, r);
    const raw: { p: number; state: State }[] = [];
    if (!first.pending) raw.push({ p: 1, state: first.state! });
    else for (const o of first.pending) { const c = greedyAbl(o.state, me, ctx, f); if (!c.pending) raw.push({ p: o.p, state: c.state! }); else for (const o2 of c.pending) raw.push({ p: o.p * o2.p, state: o2.state }); }
    const ends = raw.map(e => ({ ...e, v: evaluateCached(e.state, me, ctx) }));
    const immediate = ends.reduce((a, e) => a + e.p * e.v, 0);
    const afterReply = stratifyAbl(ends, me, REPLY_STRATA, f).reduce((a, e) => a + e.p * replyValueAbl(e.state, me, ctx, f), 0);
    const upkeep = pl ? effectUpkeep(w, pl.effect) : 0;
    const overlay = pl && w.weightMix ? w.weightMix * placementValue(s, me, pl, w) : 0;
    ranked.push({ id: '', placement: pl, moves: first.moves, score: immediate * w.planner.immediateWeight + afterReply * w.planner.replyWeight - upkeep + overlay, afterReply, summary: describeTurn(pl, first.moves) + (first.pending ? ' (then re-plan after the teleport)' : '') });
  }
  ranked.sort((a, b) => (f.c3 ? cmpVal(b.score, a.score) || cmpStr(canonicalPlan(me, a), canonicalPlan(me, b)) : b.score - a.score || a.summary.localeCompare(b.summary)));
  ranked.forEach((c, i) => { c.id = 'p' + (i + 1); });
  let chosen = ranked[0];
  const near = ranked.filter(c => (f.c3 ? cmpVal(c.score, ranked[0].score - temperature) >= 0 : c.score >= ranked[0].score - temperature));
  if (temperature > 0 && near.length > 1) {
    const ws = near.map(c => Math.exp((c.score - ranked[0].score) / temperature * 2.5));
    let roll = r() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { roll -= ws[i]; if (roll <= 0) { chosen = near[i]; break; } }
  }
  return { chosen, ranked, candidates: placements.length, sims: ctx.sims, ms: Math.round(performance.now() - t0), plannerId: ABL_ID, flags: f };
}
/** The arm's executor (noise-free greedy with the arm's C3 setting). */
export function nextMovesAbl(real: State, p: Player, f: AblFlags, w: Weights = DEFAULT_WEIGHTS): { moves: Move[]; endsAtChance: boolean } {
  const ctx = newCtx(w, REPLY_STRATA, K1); ctx.me = p;
  const g = greedyAbl(real, p, ctx, f);
  return { moves: g.moves, endsAtChance: !!g.pending };
}
export const ARMS: Record<string, AblFlags> = { K1: {}, C1: { c1: true }, C2: { c2: true }, C3: { c3: true }, C4: { c4: true }, K11: { c1: true, c2: true, c3: true, c4: true } };
void (null as unknown as Effect);

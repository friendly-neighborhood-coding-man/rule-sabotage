/**
 * V5.2 2x2 planner ('k1x-1'), EXPERIMENT-ONLY: ev-k1 + C1 + C2 + C3 always, with
 *   factor A  c4: planning without the 0.02 noise (planner/executor consistency) or with it (historical);
 *   factor B  stream: legacy seed mixing or the new SHA-256 planner stream (server/balance/v5_2/stream.ts).
 * Checked decision by decision: (c4 off, legacy) == V5.1 ablation { c1, c2, c3 } and (c4 on, legacy) == ev-k1.1.
 * Executor for every arm: ev-k1.1's noise-free greedy with C3 (nextMoves11), i.e. the C1-C3 baseline executor.
 */
import { type State, type Placement, applyPlacement, endTurn } from '../../engine.ts';
import { type Player, other } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS, effectUpkeep } from '../../weights.ts';
import { describeTurn, placementValue, type TurnPlan, type Plan } from '../../ai.ts';
import { maskHidden, evaluateCached, newCtx, REPLY_STRATA, type Ctx } from '../v4/evplanner.ts';
import { stratify11, candidatePlacements, byScoreThenCanon, cmpVal, greedy11, K1 } from '../v5/evk11.ts';
import { greedyAbl } from '../v5_1/ablation.ts';
import { plannerStreams, type StreamKind } from './stream.ts';

export type Arm = { c4: boolean; stream: StreamKind };
export const PLANNER_ID = 'k1x-1';
const C123 = { c1: true, c2: true, c3: true } as const;

function reply(s: State, me: Player, ctx: Ctx) {
  if (s.winner) return evaluateCached(s, me, ctx);
  const rep = structuredClone(s); endTurn(rep);
  const opp = other(me);
  if (rep.winner || rep.current !== opp) return evaluateCached(rep, me, ctx);
  const r = greedy11(rep, opp, ctx);
  return r.pending ? r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0) : evaluateCached(r.state!, me, ctx);
}
export type Plan52 = Plan & { plannerId: string; arm: Arm; roll: number | null; nearCount: number };
export function planTurn52(s0: State, arm: Arm, opts: { me?: Player; temperature?: number; weights?: Weights } = {}): Plan52 {
  const t0 = performance.now();
  const w = opts.weights ?? DEFAULT_WEIGHTS, me = opts.me ?? 'ai', temperature = opts.temperature ?? w.planner.temperature;
  const s = maskHidden(s0);
  const st0 = plannerStreams(arm.stream, s0, me);
  const placements = candidatePlacements(s, me, w); // C1 cells, side-relative effect order
  const ctx = newCtx(w, REPLY_STRATA, K1); ctx.me = me;
  const ranked: TurnPlan[] = [];
  for (const pl of placements) {
    const st = structuredClone(s);
    if (pl) applyPlacement(st, me, pl);
    const first = greedyAbl(st, me, ctx, C123, arm.c4 ? 0 : 0.02, st0.noise);
    const raw: { p: number; state: State }[] = [];
    if (!first.pending) raw.push({ p: 1, state: first.state! });
    else for (const o of first.pending) { const c = greedyAbl(o.state, me, ctx, C123); if (!c.pending) raw.push({ p: o.p, state: c.state! }); else for (const o2 of c.pending) raw.push({ p: o.p * o2.p, state: o2.state }); }
    const ends = raw.map(e => ({ ...e, v: evaluateCached(e.state, me, ctx) }));
    const immediate = ends.reduce((a, e) => a + e.p * e.v, 0);
    const afterReply = stratify11(ends, me, REPLY_STRATA).reduce((a, e) => a + e.p * reply(e.state, me, ctx), 0);
    const upkeep = pl ? effectUpkeep(w, pl.effect) : 0, overlay = pl && w.weightMix ? w.weightMix * placementValue(s, me, pl, w) : 0;
    ranked.push({ id: '', placement: pl, moves: first.moves, score: immediate * w.planner.immediateWeight + afterReply * w.planner.replyWeight - upkeep + overlay, afterReply, summary: describeTurn(pl, first.moves) + (first.pending ? ' (then re-plan after the teleport)' : '') });
  }
  ranked.sort(byScoreThenCanon(me));
  ranked.forEach((c, i) => { c.id = 'p' + (i + 1); });
  let chosen = ranked[0], roll: number | null = null;
  const near = ranked.filter(c => cmpVal(c.score, ranked[0].score - temperature) >= 0);
  if (temperature > 0 && near.length > 1) {
    const ws = near.map(c => Math.exp((c.score - ranked[0].score) / temperature * 2.5));
    roll = st0.temperature();
    let left = roll * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { left -= ws[i]; if (left <= 0) { chosen = near[i]; break; } }
  }
  return { chosen, ranked, candidates: placements.length, sims: ctx.sims, ms: Math.round(performance.now() - t0), plannerId: PLANNER_ID, arm, roll, nearCount: near.length };
}
export type { Placement };

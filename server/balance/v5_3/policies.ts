/**
 * V5.3 policies (EXPERIMENT-ONLY). All use the ORIGINAL symmetric candidate generator (ev-k1.1 candidatePlacements) and the
 * SAME executor (ev-k1.1 nextMoves11). Historical planners and policies are untouched.
 *
 *  'ev-k1.2'    frozen experimental reference: ev-k1.1 (C1-C4) with the V5.2 SHA-256 planner stream 'stream-1'
 *               = the V5.2 2x2 arm A4 (server/balance/v5_2/planner.ts, { c4: true, stream: 'mixed' }).
 *  'softmax-v2' unchanged V5 policy (server/balance/v5/policies.ts).
 *  'oa-v3'      bounded-work opponent-aware maximin (docs/PLAN_OA_V3_BOUNDED_WORK.md), a NEW policy; oa-v2 is unchanged.
 *               B1 a second teleport inside our continuation is collapsed to <= 8 strata (instead of n x n end states)
 *               B2 own end states built once per candidate, top-N chosen from them (no second enumeration)
 *               B3 opponent options: 'none' + the top-K placements by the planner's placement heuristic (instead of all)
 *               B4 worst-case value memoised by side-relative state within one decision
 *               B5 a deterministic work budget in greedy simulations; when exhausted, the remaining candidates are not
 *                  searched and the best SEARCHED candidate is chosen (fallback recorded); if none was searched, the best
 *                  by own move-phase value is chosen (fallback recorded)
 *               Every decision carries metadata: work used, budget hit, approximations applied, fallback.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type State, type Placement, applyPlacement, endTurn } from '../../engine.ts';
import { type Player, other } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS } from '../../weights.ts';
import { placementValue, type TurnPlan, type Plan } from '../../ai.ts';
import { maskHidden, newCtx, evaluateCached, type Ctx } from '../v4/evplanner.ts';
import { greedy11, stratify11, candidatePlacements, canonicalPlan, canonicalState, byScoreThenCanon, cmpVal, nextMoves11, describeOf, K1 } from '../v5/evk11.ts';
import { planSoftmax } from '../v5/policies.ts';
import { planTurn52 } from '../v5_2/planner.ts';

export type Policy53 = 'ev-k1.2' | 'softmax-v2' | 'oa-v3';
export const POLICIES53: Policy53[] = ['ev-k1.2', 'softmax-v2', 'oa-v3'];
export const OA3 = { topN: 6, ownStrata: 8, secondLevelStrata: 8, oppTopK: 4, budgetSims: 20_000 } as const;
export const policies53Hash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
export type Meta = { policy: Policy53; ms: number; sims: number; budgetSims?: number; budgetHit?: boolean; candidates?: number; searched?: number; secondLevelCollapsed?: number; opponentOptionsPruned?: number; memoHits?: number; fallback?: string | null; roll?: number | null };
export type Plan53 = Plan & { meta: Meta };

export function planRef12(s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): Plan53 {
  const t0 = performance.now(), p = planTurn52(s, { c4: true, stream: 'mixed' }, { me, weights: w });
  return { ...p, meta: { policy: 'ev-k1.2', ms: Math.round(performance.now() - t0), sims: p.sims, roll: p.roll } };
}

/** B1: our move phase, exact over the first teleport; a second teleport is collapsed to <= R strata. */
function ownEnds3(st: State, me: Player, ctx: Ctx, m: { secondLevelCollapsed: number }) {
  const first = greedy11(st, me, ctx), raw: { p: number; state: State }[] = [];
  if (!first.pending) raw.push({ p: 1, state: first.state! });
  else for (const o of first.pending) {
    const c = greedy11(o.state, me, ctx);
    if (!c.pending) { raw.push({ p: o.p, state: c.state! }); continue; }
    const sub = c.pending.map(o2 => ({ p: o2.p, state: o2.state, v: evaluateCached(o2.state, me, ctx) }));
    const kept = stratify11(sub, me, OA3.secondLevelStrata);
    if (kept.length < sub.length) m.secondLevelCollapsed++;
    for (const k of kept) raw.push({ p: o.p * k.p, state: k.state });
  }
  return { first, ends: raw.map(e => ({ ...e, v: evaluateCached(e.state, me, ctx) })) };
}
/** B3 + B4: our value after the opponent's worst-for-us answer among 'none' + its top-K placements by the heuristic. */
function worst3(s: State, me: Player, ctx: Ctx, memo: Map<string, number>, m: { opponentOptionsPruned: number; memoHits: number }): number {
  if (s.winner) return evaluateCached(s, me, ctx);
  const key = `${s.turn}#${canonicalState(s, me)}`;
  const hit = memo.get(key); if (hit !== undefined) { m.memoHits++; return hit; }
  const rep = structuredClone(s); endTurn(rep);
  const opp = other(me);
  let worst: number;
  if (rep.winner || rep.current !== opp) worst = evaluateCached(rep, me, ctx);
  else {
    const all = candidatePlacements(rep, opp, ctx.w);
    const pls = all.filter((pl): pl is Placement => pl !== null).map(pl => ({ pl, h: placementValue(rep, opp, pl, ctx.w) })).sort((a, b) => cmpVal(b.h, a.h) || (canonicalPlan(opp, { placement: a.pl, moves: [] }) < canonicalPlan(opp, { placement: b.pl, moves: [] }) ? -1 : 1));
    const keep: (Placement | null)[] = [null, ...pls.slice(0, OA3.oppTopK).map(x => x.pl)];
    m.opponentOptionsPruned += all.length - keep.length;
    worst = Infinity;
    for (const pl of keep) {
      const st = structuredClone(rep); if (pl) applyPlacement(st, opp, pl); if (st.phase === 'place') st.phase = 'move';
      const r = greedy11(st, opp, ctx);
      const v = r.pending ? r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0) : evaluateCached(r.state!, me, ctx);
      if (cmpVal(v, worst) < 0) worst = v;
    }
  }
  memo.set(key, worst);
  return worst;
}
export function planOA3(s0: State, me: Player, w: Weights = DEFAULT_WEIGHTS): Plan53 {
  const t0 = performance.now();
  const s = maskHidden(s0), ctx = newCtx(w, OA3.ownStrata, K1); ctx.me = me;
  const m = { secondLevelCollapsed: 0, opponentOptionsPruned: 0, memoHits: 0 }, memo = new Map<string, number>();
  const pre = candidatePlacements(s, me, w).map(pl => {
    const st = structuredClone(s); if (pl) applyPlacement(st, me, pl); if (st.phase === 'place') st.phase = 'move';
    const { first, ends } = ownEnds3(st, me, ctx, m), total = ends.reduce((a, e) => a + e.p, 0);
    return { c: { id: '', placement: pl, moves: first.moves, score: ends.reduce((a, e) => a + e.p * e.v, 0) / total, afterReply: 0, summary: describeOf(pl, first.moves, !!first.pending) } as TurnPlan, ends };
  });
  pre.sort((a, b) => byScoreThenCanon(me)(a.c, b.c));
  const start = ctx.sims; let budgetHit = false; const searched: TurnPlan[] = [];
  for (const x of pre.slice(0, OA3.topN)) {
    if (ctx.sims - start >= OA3.budgetSims) { budgetHit = true; break; }
    const ends = stratify11(x.ends, me, OA3.ownStrata), total = ends.reduce((a, e) => a + e.p, 0);
    const v = ends.reduce((a, e) => a + e.p * worst3(e.state, me, ctx, memo, m), 0) / total;
    searched.push({ ...x.c, score: v, afterReply: v });
  }
  let fallback: string | null = null, ranked: TurnPlan[];
  if (searched.length) { ranked = searched.sort(byScoreThenCanon(me)); if (budgetHit) fallback = `budget reached after ${searched.length} of ${Math.min(OA3.topN, pre.length)} candidates: best searched candidate chosen`; }
  else { ranked = pre.map(x => x.c); fallback = 'budget reached before any worst-case search: best by own move-phase value chosen'; }
  ranked.forEach((c, i) => { c.id = 'p' + (i + 1); });
  return { chosen: ranked[0], ranked, candidates: pre.length, sims: ctx.sims, ms: Math.round(performance.now() - t0), meta: { policy: 'oa-v3', ms: Math.round(performance.now() - t0), sims: ctx.sims, budgetSims: ctx.sims - start, budgetHit, candidates: pre.length, searched: searched.length, ...m, fallback } };
}
export function planPolicy53(id: Policy53, s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): Plan53 {
  if (id === 'ev-k1.2') return planRef12(s, me, w);
  if (id === 'oa-v3') return planOA3(s, me, w);
  const t0 = performance.now(), p = planSoftmax(s, me, w);
  return { ...p, meta: { policy: 'softmax-v2', ms: Math.round(performance.now() - t0), sims: p.sims } };
}
/** The shared executor for all three. */
export const moves53 = (real: State, p: Player, w: Weights = DEFAULT_WEIGHTS) => nextMoves11(real, p, w);

/**
 * V5 policies (EXPERIMENT-ONLY). All three share ONE executor, ev-k1.1's greedy11 (nextMoves11): after a policy picks a
 * placement, the real moves are produced by the same move model every policy also uses inside its own planning, so a
 * plan's committed moves and the executed moves agree until the first random outcome (operator requirement A).
 *
 *  'ev-k1.1'    reference (server/balance/v5/evk11.ts).
 *  'oa-v2'      opponent-aware maximin: for its top-N own candidates (symmetric candidate set, pre-ranked by the expected
 *               value of our own move phase), assume the opponent answers with the placement option (or none) plus
 *               greedy11 moves that is WORST for us; pick the best expected worst case. Deterministic.
 *  'softmax-v2' bounded Top-k softmax over ev-k1.1's ranked candidates, T = 1.3255 (half of the 2.651 mean reply-model
 *               prediction error measured for ev-k1 in V4.2; carried over as the calibration), sampled from a stream
 *               seeded only by the public game seed, turn and policy label.
 *
 * v1 versions (PR #9) were built on ev-k1 and are superseded; no game was ever played with them.
 * Mandatory for every policy: decisions independent of the hidden RNG and mirror-symmetric (tests + preflight).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type State, type Placement, applyPlacement, endTurn } from '../../engine.ts';
import { type Player, other } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS } from '../../weights.ts';
import { type TurnPlan, type Plan } from '../../ai.ts';
import { maskHidden, newCtx, evaluateCached, type Ctx } from '../v4/evplanner.ts';
import { planTurn11, greedy11, ownEnds11, stratify11, candidatePlacements, canonicalPlan, canonicalState, byScoreThenCanon, cmpVal, nextMoves11, describeOf, K1 } from './evk11.ts';

export type PolicyId = 'ev-k1.1' | 'oa-v2' | 'softmax-v2';
export const POLICIES: PolicyId[] = ['ev-k1.1', 'oa-v2', 'softmax-v2'];
export const policiesHash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
export const PARAMS = { oa: { topN: 6, strata: 8 }, softmax: { k: 4, temperature: 2.651 / 2, minProb: 0.02 } } as const;
export { canonicalPlan, canonicalState };

function publicStream(seed: number, turn: number, label: string) {
  let x = parseInt(createHash('sha256').update(`${seed >>> 0}|${turn}|${label}`).digest('hex').slice(0, 8), 16) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; };
}
export type PolicyPlan = Plan & { policy: PolicyId; probabilities?: { id: string; p: number }[] };

export function planSoftmax(s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  const base = planTurn11(s, { me, weights: w, temperature: 0 });
  const top = base.ranked.slice(0, PARAMS.softmax.k), best = top[0].score;
  let ws = top.map(c => Math.exp((c.score - best) / PARAMS.softmax.temperature));
  const z0 = ws.reduce((a, b) => a + b, 0); ws = ws.map(x => (x / z0 < PARAMS.softmax.minProb ? 0 : x));
  const z = ws.reduce((a, b) => a + b, 0), probs = ws.map(x => x / z);
  let roll = publicStream(s.seed, s.turn, 'softmax-v2')(), chosen = top[0];
  for (let i = 0; i < top.length; i++) { roll -= probs[i]; if (roll <= 0 && probs[i] > 0) { chosen = top[i]; break; } }
  return { ...base, chosen, policy: 'softmax-v2', probabilities: top.map((c, i) => ({ id: c.id, p: Math.round(probs[i] * 1e6) / 1e6 })) };
}

/** Our value after the opponent's answer that is WORST for us (each placement option or none, then greedy11 moves). */
export function worstAnswer(s: State, me: Player, ctx: Ctx): number {
  if (s.winner) return evaluateCached(s, me, ctx);
  const rep = structuredClone(s); endTurn(rep);
  const opp = other(me);
  if (rep.winner || rep.current !== opp) return evaluateCached(rep, me, ctx);
  let worst = Infinity;
  for (const pl of candidatePlacements(rep, opp, ctx.w)) {
    const st = structuredClone(rep); if (pl) applyPlacement(st, opp, pl); if (st.phase === 'place') st.phase = 'move';
    const r = greedy11(st, opp, ctx);
    const v = r.pending ? r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0) : evaluateCached(r.state!, me, ctx);
    if (cmpVal(v, worst) < 0) worst = v;
  }
  return worst;
}
export function planOpponentAware(s0: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  const t0 = performance.now();
  const s = maskHidden(s0), ctx = newCtx(w, PARAMS.oa.strata, K1); ctx.me = me;
  const pre = candidatePlacements(s, me, w).map(pl => {
    const st = structuredClone(s); if (pl) applyPlacement(st, me, pl); if (st.phase === 'place') st.phase = 'move';
    const first = greedy11(st, me, ctx), ends = ownEnds11(st, me, ctx), total = ends.reduce((a, e) => a + e.p, 0);
    return { c: { id: '', placement: pl, moves: first.moves, score: ends.reduce((a, e) => a + e.p * e.v, 0) / total, afterReply: 0, summary: describeOf(pl, first.moves, !!first.pending) } as TurnPlan, ends };
  });
  pre.sort((a, b) => byScoreThenCanon(me)(a.c, b.c));
  const ranked = pre.slice(0, PARAMS.oa.topN).map(x => {
    const ends = stratify11(x.ends, me, PARAMS.oa.strata), total = ends.reduce((a, e) => a + e.p, 0);
    const v = ends.reduce((a, e) => a + e.p * worstAnswer(e.state, me, ctx), 0) / total;
    return { ...x.c, score: v, afterReply: v };
  }).sort(byScoreThenCanon(me));
  ranked.forEach((c, i) => { c.id = 'p' + (i + 1); });
  return { chosen: ranked[0], ranked, candidates: pre.length, sims: ctx.sims, ms: Math.round(performance.now() - t0), policy: 'oa-v2' };
}

export function planPolicy(id: PolicyId, s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): PolicyPlan {
  if (id === 'oa-v2') return planOpponentAware(s, me, w);
  if (id === 'softmax-v2') return planSoftmax(s, me, w);
  return { ...planTurn11(s, { me, weights: w }), policy: 'ev-k1.1' };
}
/** The shared executor. */
export const policyMoves = (real: State, p: Player, w: Weights = DEFAULT_WEIGHTS) => nextMoves11(real, p, w);

/**
 * V5.1 workstream A2: zero-game decision traces. The SAME stored start-of-turn states (from V4.2 K1 games and V5 ev-k1.1
 * self-play games) are given to every ablation arm; decisions, committed moves and executor moves are compared.
 * Also checks equivalence: arm K1 == frozen ev-k1 and arm K11 == ev-k1.1 on every state.
 *   npm run balance:v51:trace -> evidence/balance/v5_1/trace.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { recordedPositions } from '../server/balance/v4/manipulation.ts';
import { planTurnEV, nextMovesEV } from '../server/balance/v4/evplanner.ts';
import { planTurn11, nextMoves11, canonicalPlan } from '../server/balance/v5/evk11.ts';
import { planTurnAbl, nextMovesAbl, ARMS } from '../server/balance/v5_1/ablation.ts';
import { loadWeights } from '../server/weights.ts';
import { r3, mean } from '../server/balance/v3/stats.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const sets = {
  'V4.2 K1 games': recordedPositions(join(ROOT, 'evidence/balance/v4/v42/2026-11-20T08-33-47Z-v42-dev'), 4000, 4, 3).filter(x => x.id.startsWith('K1-')).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 40)) === 0).slice(0, 40),
  'V5 ev-k1.1 self-play': recordedPositions(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5'), 8000, 3, 3).filter(x => x.id.startsWith('S-REF')).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 40)) === 0).slice(0, 40),
};
const out: Record<string, unknown> = { newGamesPlayed: 0, note: 'decisions at temperature 0 (the arms differ only in C1-C4); executor = moves the arm would actually play after the chosen placement' };
let eqK1 = 0, eqK11 = 0, n = 0;
for (const [name, ps] of Object.entries(sets)) {
  const res: Record<string, { sameAsK1: number; sameAsK11: number; placementSameAsK1: number; committedMoves: number[]; executorMoves: number[] }> = {};
  for (const a of Object.keys(ARMS)) res[a] = { sameAsK1: 0, sameAsK11: 0, placementSameAsK1: 0, committedMoves: [], executorMoves: [] };
  for (const { s, p } of ps) {
    n++;
    const plans = Object.fromEntries(Object.entries(ARMS).map(([a, f]) => [a, planTurnAbl(s, f, { me: p, weights: w, temperature: 0 })]));
    const k1 = planTurnEV(s, { me: p, weights: w, temperature: 0, variant: { sideRelativeOrder: true } }), k11 = planTurn11(s, { me: p, weights: w, temperature: 0 });
    if (canonicalPlan(p, k1.chosen) === canonicalPlan(p, plans.K1.chosen)) eqK1++;
    if (canonicalPlan(p, k11.chosen) === canonicalPlan(p, plans.K11.chosen)) eqK11++;
    for (const [a, f] of Object.entries(ARMS)) {
      const c = canonicalPlan(p, plans[a].chosen);
      if (c === canonicalPlan(p, plans.K1.chosen)) res[a].sameAsK1++;
      if (c === canonicalPlan(p, plans.K11.chosen)) res[a].sameAsK11++;
      if (c.split('|')[0] === canonicalPlan(p, plans.K1.chosen).split('|')[0]) res[a].placementSameAsK1++;
      res[a].committedMoves.push(plans[a].chosen.moves.length);
      const st = structuredClone(s); if (plans[a].chosen.placement) { const { applyPlacement } = await import('../server/engine.ts'); applyPlacement(st, p, plans[a].chosen.placement); }
      st.phase = 'move';
      res[a].executorMoves.push(nextMovesAbl(st, p, f, w).moves.length);
    }
  }
  out[name] = { states: ps.length, arms: Object.fromEntries(Object.entries(res).map(([a, r]) => [a, { sameDecisionAsK1: r.sameAsK1, sameDecisionAsK11: r.sameAsK11, samePlacementAsK1: r.placementSameAsK1, meanCommittedMoves: r3(mean(r.committedMoves)), meanExecutorMoves: r3(mean(r.executorMoves)) }])) };
  log(`${name}: ${JSON.stringify(out[name])}`);
}
out.equivalence = { states: n, armK1EqualsFrozenEvK1: eqK1, armK11EqualsEvK11: eqK11 };
void nextMovesEV; void nextMoves11;
writeFileSync(join(ROOT, 'evidence/balance/v5_1/trace.json'), JSON.stringify(out, null, 2));
log(`equivalence ${JSON.stringify(out.equivalence)}`);

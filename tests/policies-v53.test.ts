/** V5.3: ev-k1.2 equals the V5.2 arm A4; oa-v3 is bounded, symmetric, hidden-RNG invariant and records its work. No game. */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KANE_REFEREE = 'off';
const P = await import('../server/balance/v5_3/policies.ts');
const { planTurn52 } = await import('../server/balance/v5_2/planner.ts');
const { canonicalPlan } = await import('../server/balance/v5/evk11.ts');
const M = await import('../server/balance/v4/manipulation.ts');
const D = await import('../server/balance/v4/diagnose.ts');
const { loadWeights } = await import('../server/weights.ts');
const W = loadWeights();

test('ev-k1.2 == V5.2 planner { c4: true, stream: mixed }', { timeout: 600_000 }, () => {
  for (const { s, p } of M.syntheticPositions(3, 7373)) assert.equal(canonicalPlan(p, P.planRef12(s, p, W).chosen), canonicalPlan(p, planTurn52(s, { c4: true, stream: 'mixed' }, { me: p, weights: W }).chosen));
});
test('oa-v3: mirror-symmetric, hidden-RNG invariant, within budget, metadata recorded', { timeout: 900_000 }, () => {
  for (const { s, p } of M.syntheticPositions(2, 7474)) {
    const q = p === 'human' ? 'ai' : 'human', a = P.planOA3(s, p, W), b = P.planOA3(D.mirror(s), q, W);
    assert.equal(canonicalPlan(p, a.chosen), canonicalPlan(q, b.chosen));
    const s2 = structuredClone(s); s2.rng = 0xabcdef; assert.equal(canonicalPlan(p, P.planOA3(s2, p, W).chosen), canonicalPlan(p, a.chosen));
    assert.equal(a.meta.policy, 'oa-v3'); assert.equal(typeof a.meta.budgetSims, 'number'); assert.equal(typeof a.meta.budgetHit, 'boolean');
    assert.ok(a.meta.budgetSims! <= P.OA3.budgetSims + 20_000, 'a candidate may finish past the budget, never unbounded');
  }
});

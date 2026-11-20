/** V5.2: planner streams and the 2x2 planner. No game is played. */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KANE_REFEREE = 'off';
const S = await import('../server/balance/v5_2/stream.ts');
const P = await import('../server/balance/v5_2/planner.ts');
const { planTurnAbl } = await import('../server/balance/v5_1/ablation.ts');
const { planTurn11, canonicalPlan } = await import('../server/balance/v5/evk11.ts');
const M = await import('../server/balance/v4/manipulation.ts');
const D = await import('../server/balance/v4/diagnose.ts');
const { loadWeights } = await import('../server/weights.ts');
const W = loadWeights();
const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

test('legacy stream: consecutive seeds give nearly the same first draw (the V5.1 defect); mixed stream does not', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => 68001 + i);
  assert.ok(sd(seeds.map(s => S.legacyStream(s, 21)())) < 0.01);
  assert.ok(sd(seeds.map(s => S.mixedDraw(s, 21, 'F', 'temperature', 0))) > 0.2);
});
test('mixed stream: deterministic, in [0,1), domain-separated by role and purpose', () => {
  assert.equal(S.mixedDraw(5, 3, 'F', 'temperature', 2), S.mixedDraw(5, 3, 'F', 'temperature', 2));
  const xs = Array.from({ length: 2000 }, (_, i) => S.mixedDraw(i, 1, 'F', 'temperature', 0));
  assert.ok(xs.every(x => x >= 0 && x < 1));
  assert.notEqual(S.mixedDraw(5, 3, 'F', 'temperature', 0), S.mixedDraw(5, 3, 'S', 'temperature', 0));
  assert.notEqual(S.mixedDraw(5, 3, 'F', 'temperature', 0), S.mixedDraw(5, 3, 'F', 'noise', 0));
});
test('2x2 planner: legacy arms equal their historical counterparts; every arm mirror-symmetric and hidden-RNG invariant', { timeout: 900_000 }, () => {
  for (const { s, p } of M.syntheticPositions(3, 6262)) {
    assert.equal(canonicalPlan(p, P.planTurn52(s, { c4: false, stream: 'legacy' }, { me: p, weights: W }).chosen), canonicalPlan(p, planTurnAbl(s, { c1: true, c2: true, c3: true }, { me: p, weights: W }).chosen));
    assert.equal(canonicalPlan(p, P.planTurn52(s, { c4: true, stream: 'legacy' }, { me: p, weights: W }).chosen), canonicalPlan(p, planTurn11(s, { me: p, weights: W }).chosen));
    for (const arm of [{ c4: false, stream: 'mixed' }, { c4: true, stream: 'mixed' }] as const) {
      const q = p === 'human' ? 'ai' : 'human', a = P.planTurn52(s, arm, { me: p, weights: W }), b = P.planTurn52(D.mirror(s), arm, { me: q, weights: W });
      assert.equal(canonicalPlan(p, a.chosen), canonicalPlan(q, b.chosen)); assert.equal(a.roll, b.roll);
      const s2 = structuredClone(s); s2.rng = 0xdeadbeef; assert.equal(canonicalPlan(p, P.planTurn52(s2, arm, { me: p, weights: W }).chosen), canonicalPlan(p, a.chosen));
    }
  }
});

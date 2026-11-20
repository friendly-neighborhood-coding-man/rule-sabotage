/**
 * V5 policy-diversity preparation: mandatory requirements for every policy (hidden-RNG invariance, mirror symmetry),
 * the frozen reference reproduces its recorded V4.2 games, and the softmax / opponent-aware policies behave as defined.
 * No new game is played (the reference test re-executes an already recorded V4.2 game).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
const { playGame } = await import('../server/balance/selfplay.ts');
const { ROOT } = await import('../server/balance/v3/batch.ts');
const { loadWeights, plannerEffects } = await import('../server/weights.ts');
const { bestCells } = await import('../server/ai.ts');
const P = await import('../server/balance/v5/policies.ts');
const M = await import('../server/balance/v4/manipulation.ts');
const D = await import('../server/balance/v4/diagnose.ts');
const W = loadWeights();
const V42 = join(ROOT, 'evidence/balance/v4/v42/2026-11-20T08-33-47Z-v42-dev');

test('frozen reference: policy ev-k1 reproduces a recorded V4.2 K1 game exactly (same final hash)', { timeout: 600_000 }, () => {
  const rec = JSON.parse(readFileSync(join(V42, 'games/K1-66002-human.json'), 'utf8')).rec;
  const viaPolicy = playGame(rec.seed, rec.first, { human: W, ai: W }, { detail: true, policy: { human: 'ev-k1', ai: 'ev-k1' } });
  assert.equal(viaPolicy.detail!.finalHash, rec.detail.finalHash);
  assert.deepEqual(viaPolicy.policies, { human: 'ev-k1', ai: 'ev-k1' });
});

test('frozen reference ev-k1: hidden-RNG invariant; its residual mirror leak is recorded, not hidden', { timeout: 900_000 }, () => {
  let mismatch = 0;
  for (const { s, p } of M.syntheticPositions(4, 4242)) {
    const q = p === 'human' ? 'ai' : 'human';
    const a = P.planPolicy('ev-k1', s, p, W), b = P.planPolicy('ev-k1', D.mirror(s), q, W);
    if (P.canonicalPlan(p, a.chosen) !== P.canonicalPlan(q, b.chosen) || Math.abs(a.chosen.score - b.chosen.score) > 1e-6) mismatch++;
    const s2 = structuredClone(s); s2.rng = 0xdeadbeef;
    assert.equal(P.canonicalPlan(p, P.planPolicy('ev-k1', s2, p, W).chosen), P.canonicalPlan(p, a.chosen), 'hidden RNG');
  }
  // Known residual of the frozen reference (ai.ts cell-search ties and the strata description without piece homes):
  // 1 of these 4 positions differs in score. Changing it would change the frozen reference; it is an operator decision.
  assert.equal(mismatch, 1);
});

for (const id of ['softmax-v1', 'oa-v1'] as const) {
  test(`${id}: mirror-symmetric and invariant to the hidden RNG (synthetic positions)`, { timeout: 900_000 }, () => {
    for (const { s, p } of M.syntheticPositions(4, 4242)) {
      const q = p === 'human' ? 'ai' : 'human';
      const a = P.planPolicy(id, s, p, W), b = P.planPolicy(id, D.mirror(s), q, W);
      assert.equal(P.canonicalPlan(p, a.chosen), P.canonicalPlan(q, b.chosen), 'mirror');
      assert.ok(Math.abs(a.chosen.score - b.chosen.score) < 1e-6);
      const s2 = structuredClone(s); s2.rng = 0xdeadbeef;
      assert.equal(P.canonicalPlan(p, P.planPolicy(id, s2, p, W).chosen), P.canonicalPlan(p, a.chosen), 'hidden RNG');
    }
  });
}

test('softmax-v1: bounded top-k, probabilities sum to 1, sampling from public seed and turn only', () => {
  const [{ s, p }] = M.syntheticPositions(1, 77);
  const a = P.planSoftmax(s, p, W);
  assert.ok(a.probabilities!.length <= P.PARAMS.softmax.k);
  assert.ok(Math.abs(a.probabilities!.reduce((x, y) => x + y.p, 0) - 1) < 1e-5);
  assert.ok(a.probabilities!.every(x => x.p === 0 || x.p >= P.PARAMS.softmax.minProb));
  assert.equal(P.canonicalPlan(p, P.planSoftmax(s, p, W).chosen), P.canonicalPlan(p, a.chosen), 'deterministic for the same public state');
});

test('symBestCells is the production cell search except for how exact ties are broken', () => {
  let same = 0, n = 0;
  for (const { s, p } of M.syntheticPositions(6, 9)) for (const e of plannerEffects(W)) { n++; if (JSON.stringify(P.symBestCells(s, p, e, W)) === JSON.stringify(bestCells(s, p, e, W))) same++; }
  assert.ok(same / n > 0.8, `${same}/${n} identical`);
});

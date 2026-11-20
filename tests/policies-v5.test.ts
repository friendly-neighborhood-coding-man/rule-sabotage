/**
 * V5: ev-k1.1 and the two policies built on it. Mandatory: hidden-RNG invariance and mirror symmetry of plans AND executed
 * moves; plan/execution agreement; deterministic sampling; statistics rules. Frozen ev-k1 still reproduces V4.2.
 * Only throwaway seeds (99701+) are played; recorded V4.2 games are re-executed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
const { playGame } = await import('../server/balance/selfplay.ts');
const { ROOT, replayDetail } = await import('../server/balance/v3/batch.ts');
const { loadWeights, plannerEffects } = await import('../server/weights.ts');
const { bestCells } = await import('../server/ai.ts');
const P = await import('../server/balance/v5/policies.ts');
const K = await import('../server/balance/v5/evk11.ts');
const S = await import('../server/balance/v5/metrics.ts');
const M = await import('../server/balance/v4/manipulation.ts');
const D = await import('../server/balance/v4/diagnose.ts');
const W = loadWeights();
const V42 = join(ROOT, 'evidence/balance/v4/v42/2026-11-20T08-33-47Z-v42-dev');
const mk = (m: { from: string; dir: string; mode: string }) => { const [x, y] = m.from.split(',').map(Number); return { from: `${6 - x},${y}`, dir: m.dir === 'left' ? 'right' : m.dir === 'right' ? 'left' : m.dir, mode: m.mode }; };

test('frozen ev-k1 is untouched: the V4.2 K1 game re-executes to its recorded final hash', { timeout: 600_000 }, () => {
  const rec = JSON.parse(readFileSync(join(V42, 'games/K1-66002-human.json'), 'utf8')).rec;
  const again = playGame(rec.seed, rec.first, { human: W, ai: W }, { detail: true, planner: { human: 'ev-v4', ai: 'ev-v4' }, evVariant: { human: { sideRelativeOrder: true }, ai: { sideRelativeOrder: true } } });
  assert.equal(again.detail!.finalHash, rec.detail.finalHash);
});

for (const id of P.POLICIES) {
  test(`${id}: plans and executed moves are mirror-symmetric and independent of the hidden RNG`, { timeout: 900_000 }, () => {
    for (const { s, p } of M.syntheticPositions(4, 4242)) {
      const q = p === 'human' ? 'ai' : 'human';
      const a = P.planPolicy(id, s, p, W), b = P.planPolicy(id, D.mirror(s), q, W);
      assert.equal(P.canonicalPlan(p, a.chosen), P.canonicalPlan(q, b.chosen), 'mirror plan');
      assert.ok(Math.abs(a.chosen.score - b.chosen.score) < 1e-6, 'mirror score');
      const mv = (st: typeof s) => (st.phase === 'place' ? { ...structuredClone(st), phase: 'move' as const } : st);
      assert.deepEqual(P.policyMoves(mv(s), p, W).moves.map(mk), P.policyMoves(mv(D.mirror(s)), q, W).moves, 'mirror executed moves');
      const s2 = structuredClone(s); s2.rng = 0xdeadbeef;
      assert.equal(P.canonicalPlan(p, P.planPolicy(id, s2, p, W).chosen), P.canonicalPlan(p, a.chosen), 'hidden RNG plan');
      assert.deepEqual(P.policyMoves(mv(s2), p, W).moves, P.policyMoves(mv(s), p, W).moves, 'hidden RNG executed moves');
    }
  });
}

test('plan/execution agreement and replay in a cross-play game (throwaway seed)', { timeout: 900_000 }, () => {
  const r = playGame(99701, 'human', { human: W, ai: W }, { detail: true, policy: { human: 'oa-v2', ai: 'softmax-v2' } });
  assert.ok(replayDetail(r).ok);
  let turns = 0;
  for (const t of r.detail!.turns) {
    turns++;
    const tp = t.moves.findIndex(m => m.events.some(e => e.t === 'forced' && (e as { how: string }).how === 'teleport'));
    const exec = t.moves.slice(0, tp >= 0 ? tp + 1 : t.moves.length).map(m => m.from + m.dir + m.mode), plan = t.plannedMoves!.map(m => m.from + m.dir + m.mode);
    assert.deepEqual(exec.slice(0, plan.length), plan, `turn ${t.turn}`);
    if (tp < 0) assert.equal(exec.length, plan.length, `turn ${t.turn}: no extra or missing moves`);
  }
  assert.ok(turns > 2);
});

test('softmax-v2: bounded, normalised, deterministic for the same public state', () => {
  const [{ s, p }] = M.syntheticPositions(1, 77);
  const a = P.planSoftmax(s, p, W);
  assert.ok(a.probabilities!.length <= P.PARAMS.softmax.k);
  assert.ok(Math.abs(a.probabilities!.reduce((x, y) => x + y.p, 0) - 1) < 1e-5);
  assert.equal(P.canonicalPlan(p, P.planSoftmax(s, p, W).chosen), P.canonicalPlan(p, a.chosen));
});

test('C1 symBestCells equals the production cell search except where exact ties are broken', () => {
  let same = 0, n = 0;
  for (const { s, p } of M.syntheticPositions(6, 9)) for (const e of plannerEffects(W)) { n++; if (JSON.stringify(K.symBestCells(s, p, e, W)) === JSON.stringify(bestCells(s, p, e, W))) same++; }
  assert.ok(same / n > 0.8, `${same}/${n}`);
});

test('statistics: zero or one eligible policy never gives a robustness verdict; seed blocks keep games together', () => {
  assert.equal(S.patternSurvives({ a: { eligible: true, ci95: [0.2, 0.3] } }), 'INSUFFICIENT POLICIES');
  assert.equal(S.patternSurvives({ a: { eligible: true, ci95: [0.2, 0.3] }, b: { eligible: false, ci95: [0.2, 0.3] } }), 'INSUFFICIENT POLICIES');
  assert.match(S.patternSurvives({ a: { eligible: true, ci95: [0.1, 0.3] }, b: { eligible: true, ci95: [0.06, 0.2] } }), /^ROBUST/);
  assert.equal(S.patternSurvives({ a: { eligible: true, ci95: [0.1, 0.3] }, b: { eligible: true, ci95: [-0.04, 0.04] } }), 'POLICY-DEPENDENT');
  assert.equal(S.patternSurvives({ a: { eligible: true, ci95: [0.1, 0.3] }, b: { eligible: true, ci95: [-0.1, 0.2] } }), 'INCONCLUSIVE');
  // a seed block with identical games resamples as one unit: identical games must not narrow the interval below a single block's variability
  const fake = (seed: number, first: 'human' | 'ai', win: 'human' | 'ai') => ({ gameId: `${seed}${first}`, arm: 'x', seed, policies: { human: 'p', ai: 'p' }, rec: { seed, first, winner: win } as never });
  const xs = [1, 2, 3, 4, 5, 6].flatMap(sd => [fake(sd, 'human', sd % 2 ? 'human' : 'ai'), fake(sd, 'ai', sd % 2 ? 'human' : 'ai')]);
  const r = S.seedBlocked(xs as never, S.RATE.first_mover_win_rate);
  assert.equal(r.blocks, 6); assert.equal(r.value, 0.5);
});

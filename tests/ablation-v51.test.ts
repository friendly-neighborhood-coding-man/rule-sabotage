/**
 * V5.1: the ablation module reproduces the frozen implementations exactly at both ends, the corrected agreement metric
 * handles single-destination teleports, and the opening scorer equals ev-k1.1's own scoring. No new game is played.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
const { ROOT } = await import('../server/balance/v3/batch.ts');
const { loadWeights } = await import('../server/weights.ts');
const { planTurnEV, nextMovesEV } = await import('../server/balance/v4/evplanner.ts');
const { planTurn11, nextMoves11, canonicalPlan } = await import('../server/balance/v5/evk11.ts');
const A = await import('../server/balance/v5_1/ablation.ts');
const R = await import('../server/balance/v5_1/reanalysis.ts');
const O = await import('../server/balance/v5_1/openings.ts');
const M = await import('../server/balance/v4/manipulation.ts');
const { init } = await import('../server/engine.ts');
const W = loadWeights();

test('ablation: no switches == frozen ev-k1 and all switches == ev-k1.1 (plans, every score, executor moves)', { timeout: 900_000 }, () => {
  for (const { s, p } of M.syntheticPositions(5, 8080)) {
    const a = planTurnEV(s, { me: p, weights: W, variant: { sideRelativeOrder: true } }), b = A.planTurnAbl(s, {}, { me: p, weights: W });
    assert.equal(canonicalPlan(p, a.chosen), canonicalPlan(p, b.chosen)); assert.deepEqual(a.ranked.map(c => c.score), b.ranked.map(c => c.score));
    const c = planTurn11(s, { me: p, weights: W }), d = A.planTurnAbl(s, A.ARMS.K11, { me: p, weights: W });
    assert.equal(canonicalPlan(p, c.chosen), canonicalPlan(p, d.chosen)); assert.deepEqual(c.ranked.map(x => x.score), d.ranked.map(x => x.score));
    const mv = s.phase === 'place' ? { ...structuredClone(s), phase: 'move' as const } : s;
    assert.deepEqual(nextMovesEV(mv, p, W, { sideRelativeOrder: true }).moves, A.nextMovesAbl(mv, p, {}, W).moves);
    assert.deepEqual(nextMoves11(mv, p, W).moves, A.nextMovesAbl(mv, p, { c3: true }, W).moves);
  }
});

test('corrected agreement: a teleport with a single legal destination is deterministic (stored V5 example)', () => {
  const g = JSON.parse(readFileSync(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5/games/S-OA-68003-human.json'), 'utf8'));
  const t = R.turns(g).find(x => x.turn === 27)!;
  assert.ok(t.moves[0].destination, 'the first move teleported');
  assert.equal(t.moves[0].random, false, '...but it had a single legal destination');
  assert.deepEqual(t.moves.map(x => `${x.m.from}${x.m.dir}${x.m.mode}`), t.planned, 'full execution equals the plan');
});

test('opening scorer reproduces ev-k1.1 scores for its own candidates; the wider set keeps them and adds legal ones', { timeout: 900_000 }, () => {
  const s = init(99651, { first: 'human' });
  const ref = planTurn11(s, { me: 'human', weights: W, temperature: 0 });
  for (const c of ref.ranked) assert.equal(O.scorePlacement11(s, 'human', c.placement, W).score, c.score);
  const v2 = O.openingCandidatesV2(s, 'human', W);
  assert.ok(v2.length > ref.ranked.length);
  assert.ok(ref.ranked.every(c => v2.some(x => (x.pl === null && c.placement === null) || (x.pl && c.placement && x.pl.effect.kind === c.placement.effect.kind && JSON.stringify([...x.pl.cells].sort()) === JSON.stringify([...c.placement.cells].sort())))));
});

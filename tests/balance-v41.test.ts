/**
 * V4.1 diagnostic variants of the EV candidate. Defaults must be exactly the planner that ran the V4 pilot; the
 * side-relative order variant must make the planner mirror-symmetric. No new pilot game, no Kane, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
const { playGame } = await import('../server/balance/selfplay.ts');
const { loadWeights } = await import('../server/weights.ts');
const { ROOT } = await import('../server/balance/v3/batch.ts');
const D = await import('../server/balance/v4/diagnose.ts');
const V4 = await import('../server/balance/v4/evplanner.ts');
const W = loadWeights();
const PILOT = join(ROOT, 'evidence/balance/v4/pilot/2026-11-19T21-42-56Z-v4-pilot');

test('default EV planner (all V4.1 variants off) re-plays a recorded V4 pilot game exactly', { timeout: 600_000 }, () => {
  const rec = JSON.parse(readFileSync(join(PILOT, 'games/B-64003-human.json'), 'utf8')).rec;
  const again = playGame(rec.seed, rec.first, { human: W, ai: W }, { detail: true, planner: { human: 'ev-v4', ai: 'ev-v4' } });
  assert.equal(again.detail!.finalHash, rec.detail.finalHash);
  assert.equal(again.winner, rec.winner); assert.equal(again.turns, rec.turns);
});

test('mirror() is an involution and the evaluation is mirror-symmetric', () => {
  const recs = D.loadRecs(PILOT).filter(r => r.gameId === 'B-64002-ai');
  for (const { s, p } of D.positions(recs[0].rec).slice(0, 6)) {
    assert.deepEqual(D.mirror(D.mirror(s)), s);
    assert.equal(V4.evaluateCached(s, p, V4.newCtx(W)), V4.evaluateCached(D.mirror(s), p === 'human' ? 'ai' : 'human', V4.newCtx(W)));
  }
});

test('side-relative tie-breaking makes the EV planner mirror-symmetric where the default is not', { timeout: 600_000 }, () => {
  const recs = D.loadRecs(PILOT).filter(r => ['B-64001-ai', 'B-64002-human', 'B-64004-ai'].includes(r.gameId));
  const base = D.mirrorCheck(recs, { sample: 8, planner: 'ev' }), fixed = D.mirrorCheck(recs, { sample: 8, planner: 'ev', variant: { sideRelativeOrder: true } });
  assert.ok(base.chosenPlanAsymmetric + base.moveOnlyAsymmetric + base.chosenScoreAsymmetric > 0, 'power: the default is asymmetric on these positions');
  assert.equal(fixed.chosenPlanAsymmetric + fixed.moveOnlyAsymmetric + fixed.chosenScoreAsymmetric, 0);
});

test('placement-aware reply predicts the turn-2 punishment the default reply model misses', { timeout: 600_000 }, () => {
  const r = D.loadRecs(PILOT).find(x => x.gameId === 'B-64001-ai')!;
  const s = D.positions(r.rec)[0].s;
  const a = V4.planTurnEV(s, { me: 'ai', weights: W, temperature: 0 }), b = V4.planTurnEV(s, { me: 'ai', weights: W, temperature: 0, variant: { placementAwareReply: true } });
  assert.ok(a.chosen.afterReply > 0 && b.chosen.afterReply < 0, `${a.chosen.afterReply} vs ${b.chosen.afterReply}`);
});

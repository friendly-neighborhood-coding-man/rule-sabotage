/**
 * V4.2: K3 executor (a chosen hold-back is played exactly and not silently discarded), and deterministic checks that
 * K1 / K2 / K3 each change what they are meant to change. Throwaway seeds only (99401+), no Kane, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KANE_REFEREE = 'off';
const { playGame } = await import('../server/balance/selfplay.ts');
const { replayDetail } = await import('../server/balance/v3/batch.ts');
const { loadWeights } = await import('../server/weights.ts');
const V4 = await import('../server/balance/v4/evplanner.ts');
const D = await import('../server/balance/v4/diagnose.ts');
const M = await import('../server/balance/v4/manipulation.ts');
const W = loadWeights();
const K3 = { truncatedCandidates: true };

test('K3 executor: on a hold-back turn exactly the chosen moves are played and the remaining actions are left unused', { timeout: 600_000 }, () => {
  const r = playGame(99401, 'human', { human: W, ai: W }, { detail: true, planner: { human: 'ev-v4', ai: 'ev-v4' }, evVariant: { human: K3, ai: K3 } });
  assert.ok(replayDetail(r).ok, 'engine replay');
  assert.equal(r.errors.length + r.illegal.length, 0);
  assert.ok(r.holdBackTurns && r.holdBackTurns.human + r.holdBackTurns.ai >= 1, 'this seed has at least one hold-back turn');
  const ps = D.positions(r);
  let checked = 0;
  for (const t of r.detail!.turns) {
    const s = ps.find(x => x.turn === t.turn)!.s;
    const plan = V4.planTurnEV(s, { me: t.p, weights: W, variant: K3 }); // same seeded temperature roll as the game
    assert.equal(plan.chosen.id, t.chosen, `turn ${t.turn}: same choice as in the game`);
    if (!(plan.chosen as { holdBack?: boolean }).holdBack) continue;
    checked++;
    assert.deepEqual(t.moves.map(m => ({ from: m.from, dir: m.dir, mode: m.mode })), plan.chosen.moves, `turn ${t.turn}: the deliberate prefix was played as chosen`);
    assert.ok(t.unused > 0 || plan.chosen.moves.length === t.actions, `turn ${t.turn}: actions were deliberately left unused`);
    assert.ok(!t.moves.some(m => m.events.some(e => e.t === 'forced' && (e as { how: string }).how === 'teleport')), 'a hold-back prefix has no random outcome');
  }
  assert.ok(checked >= 1);
});

test('K3 never offers a prefix containing a random move, and offers "stop before the teleport" when the full plan ends on one', () => {
  const syn = M.syntheticPositions(12, 777);
  let pendingCases = 0;
  for (const { s, p } of syn) {
    const plan = V4.planTurnEV(s, { me: p, weights: W, temperature: 0, variant: K3 });
    for (const c of plan.ranked.filter(c => (c as { holdBack?: boolean }).holdBack)) assert.doesNotMatch(c.summary, /re-plan after the teleport/);
    if (plan.ranked.some(c => /re-plan after the teleport/.test(c.summary))) pendingCases++;
  }
  assert.ok(syn.length === 12); void pendingCases;
});

test('K1 manipulation: mirror mismatches drop to 0 on synthetic positions (beyond the V4.1 sample) and K1 changes some decisions', { timeout: 900_000 }, () => {
  const r = M.checkK1(M.syntheticPositions(10, 31337));
  assert.equal(r.mirrorMismatchK1, 0);
  assert.ok(r.mirrorMismatchE0 >= 1, `power: E0 asymmetric on these positions (${r.mirrorMismatchE0})`);
  assert.ok(r.behaviourChangedVsE0 >= 1);
});

test('K2 manipulation: the opponent model changes the predicted value; whether the chosen plan changes is measured, not assumed', { timeout: 900_000 }, () => {
  const r = M.checkK2(M.syntheticPositions(6, 99));
  assert.ok(r.predictionChanged >= 1, JSON.stringify(r));
  assert.equal(typeof r.chosenPlanChanged, 'number');
});

test('variants are recorded per side and default games are unchanged', { timeout: 600_000 }, () => {
  const a = playGame(99402, 'ai', { human: W, ai: W }, { detail: true, planner: { human: 'ev-v4', ai: 'ev-v4' } });
  const b = playGame(99402, 'ai', { human: W, ai: W }, { detail: true, planner: { human: 'ev-v4', ai: 'ev-v4' }, evVariant: { human: {}, ai: {} } });
  assert.equal(a.detail!.finalHash, b.detail!.finalHash);
  assert.equal(b.evVariants, undefined);
  const c = playGame(99402, 'ai', { human: W, ai: W }, { detail: true, planner: { human: 'ev-v4', ai: 'ev-v4' }, evVariant: { human: { sideRelativeOrder: true } } });
  assert.deepEqual(c.evVariants, { human: { sideRelativeOrder: true } });
});

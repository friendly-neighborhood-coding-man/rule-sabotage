/**
 * V4.1 referee safety (operator decision 2026-11-20): the Kane referee is opt-in; without Kane, tier 1/2 rules are
 * engine-approved and tier-3 rules are fail-closed (unverified, never placed); trial pages never reveal the hidden RNG.
 * Kane here is never run: the fake CLI's run counter must stay empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'rs-v41-'));
const COUNT = join(tmp, 'kane-runs.txt');
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
process.env.KANE_EVIDENCE_DIR = join(tmp, 'kane');
process.env.KANE_CLI = fileURLToPath(new URL('./fixtures/fake-kane.mjs', import.meta.url));
process.env.FAKE_KANE_COUNT_FILE = COUNT;
for (const k of ['KANE_REFEREE', 'REFEREE_TIERS', 'ALLOW_UNVERIFIED_RULES', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'LLM_PROVIDER']) delete process.env[k];

const { newGame, preview, placeHuman, refereeMode } = await import('../server/game.ts');
const { kaneConfig, kaneProbe } = await import('../server/kane.ts');
const { init, applyPlacement, applyMove } = await import('../server/engine.ts');
const { buildTrial, renderTrialPage, TRIAL_RNG } = await import('../server/trial.ts');
const { makeEffect, canonicalRuleText } = await import('../server/rules.ts');

const fresh = (seed: number) => { const g = newGame(seed); g.state.current = 'human'; g.state.phase = 'place'; g.state.actionsLeft = 3; return g; };

test('the Kane referee is opt-in: with KANE_REFEREE unset the referee is engine-only and Kane is never probed for a run', async () => {
  assert.equal(kaneConfig().enabled, false);
  assert.equal(refereeMode(), 'engine-only');
  assert.equal((await kaneProbe()).installed, false);
  process.env.KANE_REFEREE = 'off'; assert.equal(kaneConfig().enabled, false);
  process.env.KANE_REFEREE = 'yes'; assert.equal(kaneConfig().enabled, false, 'only the exact value "on" enables it');
  process.env.KANE_REFEREE = 'on'; assert.equal(kaneConfig().enabled, true);
  delete process.env.KANE_REFEREE;
});

test('engine-only: a tier-1 rule is engine-approved and goes live, labelled as the engine, never Kane', async () => {
  const g = fresh(4101);
  assert.equal(g.refereeMode, 'engine-only'); assert.equal(g.tiers, false, 'tiers flag off: engine-only still runs the tier selection');
  const p = await preview(g, 'Whoever lands here is frozen for a turn');
  const v = (await placeHuman(g, { token: p.token!, cells: ['3,3'] })).verdicts[0];
  assert.equal(v.final, 'engine-approved'); assert.equal(v.decidedBy, 'engine'); assert.equal(v.tier!.tier, 1); assert.ok(v.activated);
  assert.equal(v.kane, null); assert.doesNotMatch(v.message, /Kane approved/i);
  assert.ok(g.state.cells['3,3']);
});

test('engine-only: a tier-3 rule is fail-closed: unverified, never placed, not even later', async () => {
  const g = fresh(4102);
  const p = await preview(g, 'Anything entering is shoved 5 squares north');
  assert.equal(p.interpretation.status, 'approximate');
  const v = (await placeHuman(g, { token: p.token!, cells: ['3,3'] })).verdicts[0];
  assert.equal(v.tier!.tier, 3);
  assert.equal(v.final, 'unverified'); assert.equal(v.activated, false); assert.equal(v.decidedBy, 'engine-only');
  assert.match(v.message, /Not placed/); assert.doesNotMatch(v.message, /approved/i);
  assert.equal(Object.keys(g.state.cells).length, 0);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(Object.keys(g.state.cells).length, 0, 'still not placed');
  assert.ok(!existsSync(COUNT), 'no Kane process was started');
  // the operator override for Kane-mode failures does not open this path either
  process.env.ALLOW_UNVERIFIED_RULES = '1';
  try {
    const g2 = fresh(4103);
    const p2 = await preview(g2, 'Anything entering is shoved 5 squares north');
    const v2 = (await placeHuman(g2, { token: p2.token!, cells: ['3,3'] })).verdicts[0];
    assert.equal(v2.final, 'unverified'); assert.equal(v2.activated, false);
  } finally { delete process.env.ALLOW_UNVERIFIED_RULES; }
});

test('trial pages never reveal the hidden RNG: the same public board gives the same teleport scenarios and page for any RNG', () => {
  const tp = makeEffect('teleport');
  const pl = { text: canonicalRuleText(tp), effect: tp, cells: ['3,3'], interpretedBy: 'test' };
  const pages = new Set<string>(), realNext = new Set<string>();
  for (const r of [1, 99, 0xcafebabe, 0x2545f491, 123456789]) {
    const s = init(7); s.current = 'human'; s.phase = 'place'; s.rng = r;
    const t = buildTrial(s, 'human', pl, 1);
    pages.add(JSON.stringify(t.symmetry) + t.signature);
    assert.match(renderTrialPage(t), /fixed example random state/);
    assert.equal(s.rng, r, 'building a trial does not touch the game RNG');
    // what the real game would do next with this RNG: it does vary
    const real = structuredClone(s); real.current = 'ai'; applyPlacement(real, 'ai', pl); real.current = 'human'; real.phase = 'move'; real.actionsLeft = 3;
    const h = real.pieces.find(q => q.id === 'h2')!; h.x = 2; h.y = 3;
    realNext.add((applyMove(real, 'human', { from: '2,3', dir: 'right', mode: 'single' }).find(e => e.t === 'forced') as { to: string }).to);
  }
  assert.equal(pages.size, 1, 'trial independent of the hidden RNG');
  assert.ok(realNext.size > 1, 'power check: the real next teleport destination does depend on the RNG');
  assert.equal(typeof TRIAL_RNG, 'number');
});

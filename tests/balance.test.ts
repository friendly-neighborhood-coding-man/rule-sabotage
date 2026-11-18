/**
 * Living Balance Loop unit tests. Kane here is the TEST DOUBLE (tests/fixtures/fake-kane.mjs): it proves
 * plumbing and labelling only, and the loop must never treat it as a Kane verdict.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

process.env.KANE_REFEREE = 'off';
const { init, eligibleCells } = await import('../server/engine.ts');
const { planTurn } = await import('../server/ai.ts');
const W = await import('../server/weights.ts');
const { playGame, pairedJobs, aggregate } = await import('../server/balance/selfplay.ts');
const { detect, sampleRows, ownAnswer } = await import('../server/balance/anomaly.ts');
const { conditionsFor, findingFrom, renderEvidencePage } = await import('../server/balance/evidence.ts');
const { proposeCandidates, bundleCandidate, compare, nextVersion } = await import('../server/balance/optimizer.ts');
const { appendJournal, verifyJournal } = await import('../server/balance/journal.ts');
const { loadConfig } = await import('../server/balance/loop.ts');
const { kaneVerify, TEST_DOUBLE_VERSION } = await import('../server/kane.ts');

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../server/${f}`, import.meta.url)), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'rs-bal-'));
const file = W.loadWeights();
const cfg = loadConfig();

test('the shipped weights are the V0.3 human prior; with weightMix 0 the planner is exactly the PR #2 planner', () => {
  assert.equal(file.version, '0.3.0'); assert.equal(file.weightMix, 0.3); assert.equal(file.actorPerspective, 'activator');
  assert.deepEqual({ ...file.featureUtilityToActivator }, { shovePerSquare: 0.9, shoveBackPerSquare: -0.9, shoveForwardPerSquare: 0.9, shoveLateralPerSquare: -0.15, freeze: -2.2, home: -3.8, teleport: -0.8, shield: 1.4, haste: 1.8 });
  const mix0 = W.freezeWeights({ ...structuredClone(file) as never, weightMix: 0 });
  let differs = 0;
  for (const seed of [5, 8, 31337]) {
    const s = init(seed); s.current = 'ai'; s.phase = 'place';
    const a = planTurn(structuredClone(s), { temperature: 0 }), b = planTurn(structuredClone(s), { temperature: 0, weights: mix0 }), c = planTurn(structuredClone(s), { temperature: 0, weights: file });
    assert.equal(a.chosen.summary, b.chosen.summary); assert.equal(a.chosen.score, b.chosen.score);
    if (JSON.stringify(a.ranked.map(r => r.score)) !== JSON.stringify(c.ranked.map(r => r.score))) differs++;
  }
  assert.ok(differs > 0, 'the V0.3 overlay changes the ranking');
});

test('activator utilities follow V0.3 §10A signs (east/west signed by the stepping side)', () => {
  const e = (d: 'east' | 'west' | 'back' | 'north', n: 1 | 2 | 3) => ({ kind: 'shove' as const, dir: d, amount: n });
  assert.equal(W.activationUtility(e('east', 2), 'human', file), 1.8);
  assert.equal(W.activationUtility(e('east', 2), 'ai', file), -1.8);
  assert.equal(W.activationUtility(e('west', 1), 'ai', file), 0.9);
  assert.ok(Math.abs(W.activationUtility(e('back', 3), 'human', file) + 2.7) < 1e-9);
  assert.ok(Math.abs(W.activationUtility(e('north', 2), 'ai', file) + 0.3) < 1e-9);
  assert.equal(W.activationUtility({ kind: 'home' }, 'human', file), -3.8);
});

test('weights change what the planner prefers', () => {
  const s = init(5); s.current = 'ai'; s.phase = 'place';
  const base = planTurn(structuredClone(s), { temperature: 0, weights: file }).chosen;
  const w = structuredClone(W.defaultWeights());
  for (const k of Object.keys(w.placementUpkeep)) w.placementUpkeep[k] = 2; // placing anything is now expensive
  const dear = planTurn(structuredClone(s), { temperature: 0, weights: W.freezeWeights(w) });
  assert.ok(base.placement, 'baseline places an effect');
  const noPlace = (p: typeof dear) => p.ranked.findIndex(r => r.placement === null);
  assert.ok(noPlace(dear) < noPlace(planTurn(structuredClone(s), { temperature: 0, weights: file })), 'with maximal upkeep, not placing ranks higher');
});

test('legality, effect execution, symmetry and the referee never import balance weights', () => {
  for (const f of ['engine.ts', 'rules.ts', 'trial.ts', 'tiers.ts', 'kane.ts']) assert.ok(!/weights\.ts/.test(src(f)), `${f} must not import weights`);
  const s = init(3);
  const before = JSON.stringify(eligibleCells(s, s.current));
  planTurn(structuredClone(s), { weights: file });
  assert.equal(JSON.stringify(eligibleCells(s, s.current)), before);
});

test('validateWeights refuses out-of-range values and mislabelled effects instead of clamping', () => {
  const bad = (mut: (w: any) => void) => { const w: any = structuredClone(W.defaultWeights()); mut(w); return W.validateWeights(w); };
  assert.equal(bad(w => { w.featureUtilityToActivator.freeze = 50; }).ok, false);
  assert.equal(bad(w => { delete w.featureUtilityToActivator.haste; }).ok, false);
  assert.equal(bad(w => { w.featureUtilityToActivator.skip_next_turn = -3.5; }).ok, false, 'a future effect cannot be priced as implemented');
  assert.equal(bad(w => { w.placementUpkeep.laser = 0.1; }).ok, false, 'an effect the engine lacks cannot be placed');
  assert.equal(bad(w => { w.unsupported.freeze = { utility: -2, status: 'UNSUPPORTED', note: '' }; }).ok, false, 'an implemented effect cannot be hidden as unsupported');
  assert.equal(bad(w => { w.weightMix = 2; }).ok, false);
  assert.equal(bad(w => { w.actorPerspective = 'installer'; }).ok, false);
  assert.equal(bad(w => { w.planner.temperature = 50; }).ok, false);
  assert.equal(bad(() => {}).ok, true);
});

test('V0.3 §10C future effects are listed as UNSUPPORTED and never offered to the planner', () => {
  const ids = W.unsupportedEffects(file).map(u => u.id);
  assert.ok(ids.includes('reset_all_opposing_unscored') && ids.includes('skip_next_turn') && ids.length === 8);
  assert.ok(W.plannerEffects(file).every(e => ['shove', 'freeze', 'home', 'teleport', 'shield', 'haste'].includes(e.kind)));
  assert.equal(W.plannerEffects(file).length, 12);
});

test('frozen weights cannot be mutated during a game', () => {
  assert.throws(() => { (file.featureUtilityToActivator as { freeze: number }).freeze = 3; });
  assert.throws(() => { (file as { weightMix: number }).weightMix = 0; });
});

test('self-play is reproducible: same seed, first player and weights give the identical game', () => {
  const a = playGame(1003, 'ai', { human: file, ai: file }), b = playGame(1003, 'ai', { human: file, ai: file });
  const strip = (r: typeof a) => JSON.stringify({ ...r, ms: 0 });
  assert.equal(strip(a), strip(b));
  assert.equal(a.first, 'ai'); assert.equal(a.weights.human.hash, file.hash);
  assert.equal(a.illegal.length + a.errors.length, 0);
  for (const t of a.triggers) assert.ok(typeof t.predicted === 'number' && t.effect);
});

test('paired jobs play every seed with both sides starting; training and held-out seeds are disjoint', () => {
  const j = pairedJobs([1, 2], W.defaultWeights());
  assert.deepEqual(j.map(x => `${x.seed}${x.first}`), ['1human', '1ai', '2human', '2ai']);
  assert.ok(!cfg.seeds.training.some(s => cfg.seeds.heldOut.includes(s)));
  const f = join(tmp, 'overlap.json');
  writeFileSync(f, JSON.stringify({ ...cfg, seeds: { training: [1, 2], heldOut: [2, 3] } }));
  assert.throws(() => loadConfig(f), /overlap/);
});

test('sampled evidence always has an odd number of rows (the statement and its negation cannot tie)', () => {
  for (const n of [3, 4, 10, 13, 40]) { const r = sampleRows(Array.from({ length: n }, (_, i) => i), 13); assert.equal(r.length % 2, 1); }
});

// synthetic games so anomaly tests do not depend on planner behaviour
const fake = (seed: number, first: 'human' | 'ai', winner: 'human' | 'ai', pl: string[][]) => ({
  seed, first, weights: { human: { version: 'x', hash: 'h' }, ai: { version: 'x', hash: 'h' } }, winner, reason: '', turns: 10, turnLimit: false,
  placements: pl.flatMap(([p, e]) => [{ turn: 1, p: p as 'human' | 'ai', effect: e, cells: ['3,3'] }]), triggers: [], unusedCells: {}, placedCells: {},
  unusedActions: { human: 0, ai: 0 }, illegal: [], errors: [], softlock: false, longestStuck: { human: 0, ai: 0 }, signature: { human: 'a', ai: 'b' }, ms: 1, leadChanges: 1, trailed: { human: false, ai: false },
});

test('anomaly detection uses the configured thresholds, and a strong first-player edge is flagged as rule-level', () => {
  const recs = Array.from({ length: 12 }, (_, i) => [fake(i, 'human', 'human', [['human', 'haste'], ['human', 'teleport'], ['ai', 'freeze']]), fake(i, 'ai', 'ai', [['ai', 'haste'], ['ai', 'teleport'], ['human', 'freeze']])]).flat();
  const m = aggregate(recs as never);
  assert.equal(m.firstPlayerWinRate, 1);
  const an = detect(m, recs as never, cfg.thresholds, 13, ['haste', 'teleport', 'freeze', 'shield']);
  const fpa = an.find(a => a.type === 'first-player-advantage')!;
  assert.ok(fpa && fpa.knob === null && fpa.kaneCheckable);
  const combo = an.find(a => a.type === 'overpowered-combo')!;
  assert.ok(combo, 'haste+teleport users always win');
  assert.equal(combo.check!.rows.length % 2, 1);
  assert.equal(ownAnswer(combo.check!), true);
  assert.ok(an.some(a => a.type === 'never-selected' && a.subject === 'shield'));
  const strict = detect(m, recs as never, { ...cfg.thresholds, comboWinRate: 1.01, firstPlayerWinRate: 1.01 }, 13);
  assert.ok(!strict.some(a => a.type === 'overpowered-combo' || a.type === 'first-player-advantage'));
});

const kres = (results: (boolean | null)[], over: Record<string, unknown> = {}) => ({ status: 'complete', conditionResults: results, conditionReasons: results.map(() => 'r'), detail: '', exitCode: 0, timedOut: false, version: '0.10.4', isTestDouble: false, cli: 'kane-cli', mode: 'analyzer', args: [], startedAt: '', finishedAt: '', elapsedMs: 1, timings: {}, files: {}, ...over }) as never;
const anyAnomaly = () => {
  const recs = Array.from({ length: 12 }, (_, i) => [fake(i, 'human', 'human', [['human', 'haste'], ['human', 'teleport']]), fake(i, 'ai', 'ai', [['ai', 'haste'], ['ai', 'teleport']])]).flat();
  return detect(aggregate(recs as never), recs as never, cfg.thresholds, 13).find(a => a.type === 'overpowered-combo')!;
};

test('a finding is CONFIRMED only when real kane-cli answers the statement true and its negated control false', () => {
  const a = anyAnomaly(), c = conditionsFor(a, null);
  assert.equal(c.length, 3);
  assert.equal(findingFrom(a, c, kres([true, true, false])).status, 'CONFIRMED');
  assert.equal(findingFrom(a, c, kres([true, false, true])).status, 'REFUTED');
  assert.equal(findingFrom(a, c, kres([true, true, true])).status, 'UNVERIFIED', 'yes to both a statement and its negation is inconsistent');
  assert.equal(findingFrom(a, c, kres([false, true, false])).status, 'UNVERIFIED', 'integrity failed');
  assert.equal(findingFrom(a, c, kres([true, true, false], { status: 'timeout' })).status, 'UNVERIFIED');
  assert.equal(findingFrom(a, c, kres([true, true, false], { isTestDouble: true, version: TEST_DOUBLE_VERSION })).status, 'UNVERIFIED');
  assert.equal(findingFrom(a, c, null).status, 'UNVERIFIED');
});

test('the evidence page shows raw rows, not the optimizer conclusion', () => {
  const a = anyAnomaly();
  const html = renderEvidencePage({ a, replay: null, commit: 'abc', weights: '0.3.0#h', cycle: 1, generatedAt: 'now', reproduce: 'npm run balance:replay' });
  assert.match(html, /Evidence rows/);
  assert.ok(!html.includes(a.hypothesis) && !html.includes(a.title) && !/overpowered|anomal/i.test(html.replace(/balance evidence/i, '')), 'no conclusion on the page');
  assert.ok(!/<script/i.test(html));
});

test('candidates: refuted anomalies give none, unverified ones are not eligible, Kane-confirmed ones are; steps are bounded', () => {
  const a = anyAnomaly();
  const base = structuredClone(file) as never as ReturnType<typeof W.defaultWeights>;
  const fd = (status: 'CONFIRMED' | 'REFUTED' | 'UNVERIFIED', verifier: 'kane-cli' | 'none' = 'kane-cli') => [{ anomalyId: a.id, fingerprint: a.fingerprint, status, verifier, reason: '', conditions: [], ownAnswer: true, kaneAgreesWithOwnData: true }] as never;
  assert.equal(proposeCandidates(base, [a], fd('REFUTED'), cfg.optimizer, 1).length, 0);
  const u = proposeCandidates(base, [a], fd('UNVERIFIED', 'none'), cfg.optimizer, 1);
  assert.ok(u.length > 0 && u.every(c => !c.eligible));
  const c = proposeCandidates(base, [a], fd('CONFIRMED'), cfg.optimizer, 1);
  assert.ok(c.length > 0 && c.every(x => x.eligible));
  for (const x of c) for (const ch of x.changes) { assert.ok(ch.proposed > ch.old); assert.ok(ch.proposed - ch.old <= 0.2 + 1e-9); assert.equal(ch.old, 0.15); assert.ok(ch.reason); }
  assert.equal(nextVersion('0.3.0'), '0.3.1');
});

test('the V0.3 bundle candidate is evaluated but can never be promoted', () => {
  const v = W.validateWeights(JSON.parse(readFileSync(fileURLToPath(new URL('../balance/v0.3-candidate.weights.json', import.meta.url)), 'utf8')));
  assert.ok(v.ok);
  const bc = bundleCandidate(structuredClone(file) as never, (v as { weights: never }).weights, 'C9')!;
  assert.equal(bc.eligible, false); assert.equal(bc.source, 'v0.3-bundle');
  assert.deepEqual(bc.changes.map(c => `${c.target} ${c.old}->${c.proposed}`).sort(), ['freeze -2.2->-1.7', 'haste 1.8->2.2', 'home -3.8->-3.1', 'shoveBackPerSquare -0.9->-0.8']);
});

test('promotion gates: a softlock or an engine change is a hard failure even if everything else improves', () => {
  const a = anyAnomaly();
  const base = structuredClone(file) as never as ReturnType<typeof W.defaultWeights>;
  const [c] = proposeCandidates(base, [a], [{ anomalyId: a.id, fingerprint: a.fingerprint, status: 'CONFIRMED', verifier: 'kane-cli', reason: '', conditions: [], ownAnswer: true, kaneAgreesWithOwnData: true }] as never, cfg.optimizer, 1);
  const recs = Array.from({ length: 12 }, (_, i) => [fake(i, 'human', 'ai', [['human', 'haste']]), fake(i, 'ai', 'human', [['ai', 'haste']])]).flat();
  const m = aggregate(recs as never), worse = { ...m, safety: { ...m.safety, softlocks: 1 } };
  const ok = { invariantsPass: true, engineHashUnchanged: true, detail: '' };
  assert.equal(compare(c, [a], m, worse, cfg.promotion, ok).pass, false);
  assert.equal(compare(c, [a], m, m, cfg.promotion, { ...ok, engineHashUnchanged: false }).pass, false);
  assert.ok(compare(c, [a], m, worse, cfg.promotion, ok).gates.some(g => g.hard && !g.pass));
});

test('the journal is append-only and hash-chained: edits are detected and further appends refused', () => {
  const f = join(tmp, 'journal.ndjson');
  appendJournal(f, 'baseline', 'r1', null, { version: '0.3.0' });
  appendJournal(f, 'rollback', 'r1', 1, { reasons: ['x'] });
  assert.deepEqual(verifyJournal(f), { ok: true, entries: 2, problem: null });
  writeFileSync(f, readFileSync(f, 'utf8').replace('"x"', '"y"'));
  assert.equal(verifyJournal(f).ok, false);
  assert.throws(() => appendJournal(f, 'promote', 'r1', 1, {}), /Refusing to append/);
});

const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => existsSync(p));
test('kaneVerify runs the CLI on a served page, stores its output and labels the test double as such', { skip: chrome ? false : 'no Chrome' }, async () => {
  const srv = createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<h1>evidence</h1>'); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const saved = { ...process.env };
  Object.assign(process.env, { KANE_REFEREE: 'on', KANE_CLI: fileURLToPath(new URL('./fixtures/fake-kane.mjs', import.meta.url)), KANE_CHROME: chrome, FAKE_KANE_MODE: 'approve' });
  try {
    const r = await kaneVerify({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/e.html`, conditions: ['a', 'b', 'c'], dir: join(tmp, 'kv'), timeoutS: 30 });
    assert.equal(r.status, 'complete'); assert.equal(r.isTestDouble, true); assert.deepEqual(r.conditionResults, [true, true, true]);
    assert.ok(existsSync(r.files.stdout!) && existsSync(r.files.result!));
  } finally { process.env = saved; await new Promise(r => srv.close(() => r(null))); }
});

/**
 * Balance Designer V2 unit tests (no Kane credits). Kane here is the TEST DOUBLE (tests/fixtures/fake-kane.mjs)
 * or not involved at all. These tests prove plumbing, isolation and decision rules, not anything about Kane.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

process.env.KANE_REFEREE = 'off';
const E = await import('../server/engine.ts');
const AI = await import('../server/ai.ts');
const W = await import('../server/weights.ts');
const { playGame } = await import('../server/balance/selfplay.ts');
const { appendJournal, verifyJournal } = await import('../server/balance/journal.ts');
const { writeManifest } = await import('../server/balance/loop.ts');
const I = await import('../server/balance/v2/interventions.ts');
const M = await import('../server/balance/v2/metrics.ts');
const C = await import('../server/balance/v2/contracts.ts');
const X = await import('../server/balance/v2/experiments.ts');
const K = await import('../server/balance/v2/corrections.ts');
const K2 = await import('../server/balance/v2/kane2.ts');
const P = await import('../server/balance/v2/pages.ts');
type GameRec = import('../server/balance/selfplay.ts').GameRec;
type Contract = import('../server/balance/v2/contracts.ts').HypothesisContract;

const root = fileURLToPath(new URL('../', import.meta.url));
const src = (f: string) => readFileSync(join(root, f), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'rs-v2-'));
const base = W.loadWeights();
const FAKE = fileURLToPath(new URL('./fixtures/fake-kane.mjs', import.meta.url));
const hyp = JSON.parse(src('balance/v2/hypotheses.json')) as { observation: Contract['observation']; hypotheses: Omit<Contract, 'observation'>[] };
const contract = (id: string): Contract => structuredClone({ ...hyp.hypotheses.find(h => h.id === id)!, observation: hyp.observation }) as Contract;
let journalN = 0;
const jfile = () => join(tmp, `j${++journalN}.ndjson`);
const registry = (f = jfile()) => new C.Registry(X.experimentDesigns, (t, d) => appendJournal(f, t, 'test', null, d));

/** A synthetic game record (engine-shaped) for metric and decision tests. */
function rec(seed: number, first: 'human' | 'ai', o: { selfTp?: number; oppTp?: number; tpGain?: number; aligned?: number; unaligned?: number; ewSelf?: number; ewOpp?: number; winner?: 'human' | 'ai' | 'draw'; illegal?: number } = {}): GameRec {
  const triggers = [
    ...Array.from({ length: o.selfTp ?? 0 }, (_, i) => ({ turn: 2 + i, mover: 'ai', owner: 'ai', self: true, effect: 'teleport', kind: 'teleport', cell: '3,3', pieces: 1, chain: 1, realized: -(o.tpGain ?? 3), how: 'moved', predicted: 0.8, base: 0 })),
    ...Array.from({ length: o.oppTp ?? 0 }, (_, i) => ({ turn: 3 + i, mover: 'human', owner: 'ai', self: false, effect: 'teleport', kind: 'teleport', cell: '3,4', pieces: 1, chain: 1, realized: 1, how: 'moved', predicted: 0.8, base: 0 })),
    ...Array.from({ length: o.ewSelf ?? 0 }, (_, i) => ({ turn: 4 + i, mover: 'ai', owner: 'ai', self: true, effect: 'shove:west:2', kind: 'shove', cell: '3,3', pieces: 1, chain: 1, realized: -2, how: 'moved', predicted: 0, base: 0 })),
    ...Array.from({ length: o.ewOpp ?? 0 }, (_, i) => ({ turn: 5 + i, mover: 'human', owner: 'ai', self: false, effect: 'shove:west:2', kind: 'shove', cell: '3,4', pieces: 1, chain: 1, realized: 2, how: 'moved', predicted: 0, base: 0 })),
  ];
  const placements = [
    ...Array.from({ length: o.aligned ?? 0 }, (_, i) => ({ turn: 1 + i, p: 'ai', effect: 'shove:west:2', cells: ['3,3'] })),
    ...Array.from({ length: o.unaligned ?? 0 }, (_, i) => ({ turn: 1 + i, p: 'human', effect: 'shove:west:2', cells: ['3,4'] })),
  ];
  return { seed, first, weights: { human: { version: 't', hash: 't' }, ai: { version: 't', hash: 't' } }, winner: o.winner ?? 'ai', reason: '', turns: 12, turnLimit: false, placements, triggers, unusedCells: {}, placedCells: {}, unusedActions: { human: 0, ai: 0 }, illegal: Array.from({ length: o.illegal ?? 0 }, () => 'x'), errors: [], softlock: false, longestStuck: { human: 0, ai: 0 }, signature: { human: '', ai: '' }, ms: 0, leadChanges: 1, trailed: { human: true, ai: true } } as GameRec;
}
const set = (seeds: number[], o: Parameters<typeof rec>[2]) => seeds.flatMap(s => [rec(s, 'human', o), rec(s, 'ai', o)]);
const S = Array.from({ length: 12 }, (_, i) => 100 + i);

// ---------------------------------------------------------------- production isolation
test('production code never passes planner hooks or rule variants; V1 games replay identically with the hooked planner', () => {
  for (const f of ['server/game.ts', 'server/server.ts', 'server/trial.ts', 'server/tiers.ts', 'server/kane.ts']) assert.ok(!/hooks|variant|EXPERIMENTAL_RULE_VARIANT|PlannerHooks/.test(src(f)), `${f} must not use experiment hooks`);
  const v1 = src('evidence/balance/runs/2026-11-18T14-21-47Z-kane/cycle-1/baseline-training-games.ndjson').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as GameRec);
  const fw = W.freezeWeights(base), g = v1[5];
  const r = playGame(g.seed, g.first, { human: fw, ai: fw });
  assert.equal(JSON.stringify({ ...r, ms: 0 }), JSON.stringify({ ...g, ms: 0 }), 'the recorded V1 game reproduces byte for byte');
});
test('a rule variant must carry the explicit experimental token', () => {
  assert.throws(() => E.init(1, { variant: { id: 'x', teleport: 'same-column' } as never }), /explicitly marked experimental/);
  const s = E.init(1, { variant: { id: 'teleport-same-column', experimental: E.EXPERIMENTAL_RULE_VARIANT, teleport: 'same-column' } });
  assert.equal(s.variant?.teleport, 'same-column');
  assert.equal(E.init(1).variant, undefined);
});

// ---------------------------------------------------------------- interventions
test('only allowlisted interventions are accepted; each modifies only its declared component', () => {
  assert.ok(I.validateSpec({ kind: 'shell', cmd: 'rm -rf /' }).length);
  assert.ok(I.validateSpec({ kind: 'weight', path: 'planner.temperature', value: 0 }).length, 'planner constants are not allowlisted');
  assert.ok(I.validateSpec({ kind: 'planner', hook: 'selfBenefitFactor', value: 2 }).length);
  assert.ok(I.validateSpec({ kind: 'planner', hook: 'blindRng', value: true, extra: 1 }).length, 'extra fields are refused');
  assert.throws(() => I.applySpec(base, { kind: 'weight', path: 'featureUtilityToActivator.teleport', value: 99 }), /invalid/);
  const w = I.applySpec(base, X.EXPERIMENTS.E1a.spec);
  assert.deepEqual(w.diff, ['featureUtilityToActivator.teleport']);
  assert.equal(w.hooks, null); assert.equal(w.variant, null); assert.equal(w.component, 'weights');
  for (const id of ['E2', 'E3', 'E5']) { const a = I.applySpec(base, X.EXPERIMENTS[id].spec); assert.equal(I.weightDiff(base, a.weights).length, 0, `${id} leaves weights alone`); assert.equal(a.variant, null); assert.equal(Object.keys(a.hooks!).length, 1); }
  const v = I.applySpec(base, X.EXPERIMENTS.E4.spec);
  assert.equal(v.hooks, null); assert.equal(I.weightDiff(base, v.weights).length, 0); assert.equal(v.component, 'rules');
});
test('planner hooks are isolated: E3 changes candidate cells but not valuation; E2 changes valuation but not candidates; E5 changes neither on a teleport-free state', () => {
  const s = E.init(42); s.current = 'human'; s.phase = 'place';
  const fw = W.freezeWeights(base);
  // put an own forward shove next to a Human piece so self-benefit matters
  E.applyPlacement(s, 'human', { text: 't', effect: { kind: 'shove', dir: 'east', amount: 2 }, cells: ['1,1'], interpretedBy: 't' });
  const ev = (h?: object) => AI.evaluate(s, 'human', fw, h as never);
  const cells = (h?: object) => AI.bestCells(s, 'human', { kind: 'shove', dir: 'east', amount: 2 }, fw, h as never).join(' ');
  assert.equal(ev({ searchOwnBenefit: false }), ev(), 'E3 does not touch valuation');
  assert.notEqual(cells({ searchOwnBenefit: false }), cells(), 'E3 changes candidate generation');
  assert.equal(cells({ selfBenefitFactor: 0 }), cells(), 'E2 does not touch candidate generation');
  assert.notEqual(ev({ selfBenefitFactor: 0 }), ev(), 'E2 changes valuation of own-installed benefit');
  assert.equal(ev({ blindRng: true }), ev(), 'E5 does not change static valuation');
  assert.equal(cells({ blindRng: true }), cells(), 'E5 does not change candidates');
});
test('same-seed experiment replay is deterministic, and the E4 variant keeps every teleport distance-neutral', () => {
  const fw = W.freezeWeights(base);
  const h = { human: { blindRng: true }, ai: { blindRng: true } };
  const a = playGame(3000, 'human', { human: fw, ai: fw }, { hooks: h }), b = playGame(3000, 'human', { human: fw, ai: fw }, { hooks: h });
  assert.equal(JSON.stringify({ ...a, ms: 0 }), JSON.stringify({ ...b, ms: 0 }));
  assert.deepEqual(a.hooks, h);
  const v = playGame(3001, 'ai', { human: fw, ai: fw }, { variant: { id: 'teleport-same-column', experimental: E.EXPERIMENTAL_RULE_VARIANT, teleport: 'same-column' } });
  assert.equal(v.variant, 'teleport-same-column');
  assert.ok(v.triggers.filter(t => t.kind === 'teleport' && t.realized !== null).every(t => t.realized === 0));
});

// ---------------------------------------------------------------- provenance and pre-registration
test('provenance cannot be forged: a hardcoded hypothesis cannot be labelled Kane-generated', () => {
  const c = contract('H2');
  c.provenance = { origin: 'kane', author: 'Kane', note: 'forged' };
  assert.match(C.checkProvenance(c.provenance).join(), /needs a Kane reference/);
  const raw = join(tmp, 'notes.ndjson');
  writeFileSync(raw, JSON.stringify({ noteId: 'KX1-N1', fields: {} }) + '\n');
  const ref = { callId: 'KX1', rawFile: raw, rawSha256: C.sha256File(raw), noteId: 'KX1-N1', cliVersion: '0.0.0-test-double', isTestDouble: true };
  assert.match(C.checkProvenance({ origin: 'kane', author: 'x', note: '', kane: ref }).join(), /test double cannot be labelled as Kane/);
  assert.match(C.checkProvenance({ origin: 'kane', author: 'x', note: '', kane: { ...ref, isTestDouble: false, cliVersion: '0.10.4', rawSha256: '0'.repeat(64) } }).join(), /sha256 does not match/);
  assert.match(C.checkProvenance({ origin: 'kane', author: 'x', note: '', kane: { ...ref, isTestDouble: false, cliVersion: '0.10.4', noteId: 'KX1-N9' } }).join(), /not in the raw Kane file/);
  assert.deepEqual(C.checkProvenance({ origin: 'kane-test-double', author: 'x', note: '', kane: ref }), []);
  assert.match(C.checkProvenance({ origin: 'operator', author: 'x', note: '', kane: ref }).join(), /must not carry a Kane reference/);
  assert.throws(() => registry().register(c), /refused/);
  // the shipped set labels nothing as Kane
  assert.ok(hyp.hypotheses.every(h => h.provenance.origin === 'operator' || h.provenance.origin === 'claude'));
});
test('contracts are registered before results exist, immutable, and evaluation refuses results that predate registration', () => {
  const r = registry();
  const reg = r.register(contract('H2'));
  assert.ok(Object.isFrozen(reg.contract) && Object.isFrozen(reg.contract.predictions[0]));
  assert.throws(() => r.register(contract('H2')), /already registered/);
  r.close('first result');
  assert.throws(() => r.register(contract('H3')), /Pre-registration closed/);
  const eff = M.pairedEffect('ew_self_trigger_share', set(S, { ewSelf: 4 }), set(S, { ewSelf: 1, ewOpp: 3 }), { boot: 300 });
  assert.throws(() => C.evaluateHypothesis(r, 'H2', () => ({ effect: eff, manipulationOk: true, manipulationDetail: '', resultSeq: reg.journalSeq }), 8), /predates the registration/);
});
test('predictions must be testable and discriminating; a shared prediction is not discriminating', () => {
  const bad = contract('H3'); bad.predictions = bad.predictions.map(p => ({ ...p, metric: p.id === 'P3a' ? 'vibes' : p.metric, minEffect: p.id === 'P3c' ? 0 : p.minEffect }));
  const errs = C.checkContract(bad, X.experimentDesigns).join();
  assert.match(errs, /metric vibes unknown/); assert.match(errs, /minEffect must be > 0/);
  const noDisc = contract('H3'); noDisc.predictions = noDisc.predictions.filter(p => p.role !== 'discriminating');
  assert.match(C.checkContract(noDisc, X.experimentDesigns).join(), /discriminating/);
  const h2 = contract('H2'), h4 = contract('H4');
  const p = h2.predictions.find(x => x.id === 'P2d')!;
  assert.equal(C.discriminates(p, h4).ok, true);
  const h4same = structuredClone(h4); h4same.predictions = h4same.predictions.map(q => (q.id === 'P4b' ? { ...q, direction: 'no-change' as const } : q));
  assert.equal(C.discriminates(p, h4same).ok, false);
});

const lookupFrom = (map: Record<string, { c: GameRec[] | null; t: GameRec[]; ok?: boolean; ref?: number }>, seq = 1e9) => (exp: string, design: string, k: string) => {
  const m = map[`${exp}/${design}`]; if (!m) return null;
  return { effect: M.pairedEffect(k, m.c, m.t, { reference: m.ref, boot: 300 }), manipulationOk: m.ok ?? true, manipulationDetail: m.ok === false ? 'no game diverged' : '', resultSeq: seq };
};
test('a clear, discriminating, pre-registered result is SUPPORTED; a negligible one REFUTED; noisy or confounded ones INCONCLUSIVE', () => {
  const ctl = set(S, { ewSelf: 4, selfTp: 3, oppTp: 1 });
  const r = registry();
  r.register(contract('H2')); r.register(contract('H4')); r.register(contract('H1'));
  const strong = lookupFrom({ 'E2/selfplay': { c: ctl, t: set(S, { ewSelf: 1, ewOpp: 3, selfTp: 1, oppTp: 3 }) }, 'C0/observational': { c: null, t: ctl, ref: 0 }, 'E1b/selfplay': { c: ctl, t: ctl } });
  assert.equal(C.evaluateHypothesis(r, 'H2', strong, 8).outcome, 'SUPPORTED');
  const none = lookupFrom({ 'E2/selfplay': { c: ctl, t: ctl }, 'C0/observational': { c: null, t: ctl, ref: 0 }, 'E1b/selfplay': { c: ctl, t: ctl } });
  assert.equal(C.evaluateHypothesis(r, 'H2', none, 8).outcome, 'REFUTED');
  const confounded = lookupFrom({ 'E2/selfplay': { c: ctl, t: set(S, { ewSelf: 1, ewOpp: 3, selfTp: 1, oppTp: 3 }), ok: false }, 'C0/observational': { c: null, t: ctl, ref: 0 }, 'E1b/selfplay': { c: ctl, t: ctl } });
  const ce = C.evaluateHypothesis(r, 'H2', confounded, 8);
  assert.equal(ce.outcome, 'INCONCLUSIVE'); assert.match(ce.reasons.join(), /manipulation check failed/);
  const small = lookupFrom({ 'E2/selfplay': { c: ctl.slice(0, 4), t: set(S.slice(0, 2), { ewSelf: 1, ewOpp: 3, selfTp: 1, oppTp: 3 }) }, 'C0/observational': { c: null, t: ctl, ref: 0 }, 'E1b/selfplay': { c: ctl, t: ctl } });
  assert.equal(C.evaluateHypothesis(r, 'H2', small, 8).outcome, 'INCONCLUSIVE', 'too few seeds is never SUPPORTED');
  const mixed = set(S.slice(0, 6), { ewSelf: 1, ewOpp: 3, selfTp: 1, oppTp: 3 }).concat(set(S.slice(6), { ewSelf: 4, ewOpp: 0, selfTp: 3, oppTp: 1 }));
  assert.notEqual(C.evaluateHypothesis(r, 'H2', lookupFrom({ 'E2/selfplay': { c: ctl, t: mixed }, 'C0/observational': { c: null, t: ctl, ref: 0 }, 'E1b/selfplay': { c: ctl, t: ctl } }), 8).outcome, 'SUPPORTED', 'batches that disagree are not SUPPORTED');
  assert.equal(C.evaluateHypothesis(r, 'H1', lookupFrom({}), 8).outcome, 'NOT_TESTED');
});
test('the old V1 13-row confirmation cannot establish a cause, and Kane can lower but never raise an outcome', () => {
  assert.equal(C.v1ConfirmationOnly(), 'NOT_TESTED');
  const r = registry(); r.register(contract('H5'));
  const ev = C.evaluateHypothesis(r, 'H5', lookupFrom({}), 8);
  assert.equal(C.applyKaneChallenge(ev, { corroboration: 'AGREES', detail: 'V1-style 13-row check: all true' }).outcome, 'NOT_TESTED');
  const sup = { ...ev, outcome: 'SUPPORTED' as const };
  assert.equal(C.applyKaneChallenge(sup, { corroboration: 'DISAGREES', detail: 'x' }).outcome, 'INCONCLUSIVE');
  assert.equal(C.applyKaneChallenge(sup, { corroboration: 'AGREES', detail: 'x', counterexamples: ['seed 3003'] }).outcome, 'INCONCLUSIVE');
  assert.equal(C.applyKaneChallenge({ ...ev, outcome: 'INCONCLUSIVE' }, { corroboration: 'AGREES', detail: 'x' }).outcome, 'INCONCLUSIVE');
});
test('selection-biased conditional win rate and randomized head-to-head impact are different metrics', () => {
  const recs = set(S, { selfTp: 1, winner: 'ai' });
  assert.ok(M.METRICS.conditional_win_tp.note && /not the effect/.test(M.METRICS.conditional_win_tp.note!));
  const treated = recs.map((_, i) => (i % 2 ? 'human' : 'ai') as 'human' | 'ai');
  assert.equal(M.metric('treated_win_rate', { recs, treated }), 0.5);
  assert.equal(M.metric('treated_win_rate', { recs }), null, 'no treated sides, no head-to-head metric');
});

// ---------------------------------------------------------------- holdout
test('the final holdout is sealed until corrections are frozen and never leaks into exploration pages', () => {
  const v = new X.SeedVault({ exploration: [1000], development: [3000], holdout: [7000, 7001] });
  assert.throws(() => v.holdout('hypothesis generation'), /sealed/);
  assert.throws(() => new X.SeedVault({ exploration: [1], development: [1], holdout: [2] }), /overlap/);
  const g = [rec(1000, 'human', { selfTp: 2, aligned: 2 }), rec(1000, 'ai', { oppTp: 1, unaligned: 1 })];
  const html = P.explorationPage({ v1RunId: 'r', v1Hash: 'h'.repeat(64), games: g, traces: [], replay: g[0], valuation: [], effectTable: [] }, 'n0nce', '/v2/notes/KX1');
  assert.deepEqual(v.leaks(html), []);
  const pre = html.replace(/Investigation notebook[\s\S]*/, '').replace(/<\/?h[1-6]>/g, '');
  assert.ok(!/\bH[0-5]\b/.test(pre) && !/hypothes/i.test(pre), 'the exploration page states no hypothesis');
  v.unseal('final'); assert.deepEqual(v.holdout('final'), [7000, 7001]); assert.throws(() => v.unseal('again'), /already/);
});

// ---------------------------------------------------------------- Kane exploration channel
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => existsSync(p));
test('Kane notebook: wrong nonce, out-of-window or malformed notes are invalid; timeout or garbage output yields no valid finding', async () => {
  const dir = join(tmp, 'kx'); mkdirSync(dir, { recursive: true });
  const sessions: Record<string, ReturnType<typeof K2.openSession>> = {};
  const srv = createServer((req, res) => {
    const m = /^\/notes\/(\w+)$/.exec(req.url ?? '');
    if (req.method === 'POST' && m) { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { K2.acceptNote(sessions[m[1]], b); res.end('ok'); }); return; }
    const id = (req.url ?? '').slice(1);
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(P.comparisonPage('t', 'i', [], { nonce: sessions[id]?.nonce ?? '', action: `/notes/${id}`, hypotheses: ['H2'] }));
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const url = (id: string) => `http://127.0.0.1:${(srv.address() as { port: number }).port}/${id}`;
  const saved = { ...process.env };
  Object.assign(process.env, { KANE_REFEREE: 'on', KANE_CLI: FAKE });
  try {
    const out = K2.acceptNote(K2.openSession(join(dir, 'w'), 'W', 'exploration'), 'nonce=x&explanation=a%20long%20enough%20explanation');
    assert.ok(out.problems.some(p => /outside the Kane call window/.test(p)));
    const run = async (id: string, mode: string, extra: Record<string, string> = {}) => {
      sessions[id] = K2.openSession(join(dir, id), id, 'exploration');
      Object.assign(process.env, { FAKE_KANE_OBJECTIVE_MODE: mode, ...extra });
      return K2.kaneExplore({ session: sessions[id], url: url(id), objective: 'test objective', dir: join(dir, id), maxSteps: 3, timeoutS: 20 });
    };
    const ok = await run('A', 'note');
    assert.equal(ok.isTestDouble, true); assert.equal(ok.status, 'complete'); assert.equal(ok.validNotes.length, 1); assert.equal(ok.capability, 'OK');
    assert.ok(readFileSync(ok.files.notes, 'utf8').includes(`"noteId":"${ok.validNotes[0]}"`));
    const forged = await run('B', 'bad-nonce');
    assert.equal(forged.validNotes.length, 0); assert.equal(forged.capability, 'CAPABILITY_LIMITATION');
    const silent = await run('C', 'no-notes');
    assert.equal(silent.capability, 'CAPABILITY_LIMITATION');
    const garbage = await run('D', 'garbage');
    assert.equal(garbage.status, 'incomplete'); assert.equal(garbage.validNotes.length, 1); assert.equal(garbage.capability, 'CAPABILITY_LIMITATION', 'a note without a complete kane-cli run is not success'); assert.equal(garbage.execution, 'INCOMPLETE');
    const hang = await run('E', 'hang', { KANE_KILL_AFTER_MS: '1500' });
    assert.equal(hang.status, 'timeout'); assert.equal(hang.validNotes.length, 0);
    delete process.env.KANE_KILL_AFTER_MS;
  } finally { process.env = saved; await new Promise(r => srv.close(() => r(null))); }
  void chrome;
});

// ---------------------------------------------------------------- corrections and adequacy
// synthetic games use a single effect, so the absolute dominance/diversity guard-rails are relaxed here (tested separately via safety)
const CFG = { ...JSON.parse(src('balance/v2/config.json')).adequacy, maxNewDominantShare: 1.01, maxEntropyDrop: 1 };
const corr = (): import('../server/balance/v2/corrections.ts').Correction => ({ id: 'K1', category: 'planner', policy: 'REVIEW_REQUIRED', basis: ['H2'], origin: 'deterministic', spec: X.EXPERIMENTS.E2.spec, description: 'd', rationale: 'r', targets: [{ metric: 'ew_self_trigger_share', direction: 'decrease', minEffect: 0.15 }] });
const review = (t: GameRec[], o: { safety?: number; kane?: 'AGREES' | 'UNVERIFIED'; real?: boolean; manip?: boolean } = {}) => {
  const c = set(S, { ewSelf: 4 });
  const sum = (g: GameRec[]) => Object.fromEntries(Object.keys(M.METRICS).filter(k => k !== 'treated_win_rate').map(k => [k, M.metric(k, { recs: g })]));
  const tr = sum(t); if (o.safety) tr.safety_events = o.safety;
  return K.reviewCorrection({ correction: corr(), effects: { ew_self_trigger_share: M.pairedEffect('ew_self_trigger_share', c, t, { boot: 300 }) }, control: sum(c), treated: tr, manipulation: { ok: o.manip ?? true, detail: 'diverged', divergedGames: 10 }, invariantsPass: true, unrelatedChanged: [], kane: { status: o.kane ?? 'AGREES', detail: 'k', real: o.real ?? true }, topEffectShift: null, h2h: null }, CFG);
};
test('a correctly implemented correction with negligible improvement is INEFFECTIVE (or PARTIAL), never SUFFICIENT', () => {
  const r = review(set(S, { ewSelf: 4 }));
  assert.equal(r.implementationCorrectness, 'PASS');
  assert.ok(['INEFFECTIVE', 'PARTIAL'].includes(r.balanceAdequacy), r.balanceAdequacy);
  const small = review(set(S, { ewSelf: 9, ewOpp: 1 }).map((g, i) => (i % 3 ? set(S, { ewSelf: 4 })[i] : g)));
  assert.notEqual(small.balanceAdequacy, 'SUFFICIENT');
});
test('a correction that improves its target but worsens safety is a REGRESSION', () => {
  const r = review(set(S, { ewSelf: 1, ewOpp: 3 }), { safety: 2 });
  assert.equal(r.balanceAdequacy, 'REGRESSION');
});
test('SUFFICIENT needs a material, robust improvement AND real Kane; the test double or a dry-run leaves it UNVERIFIED', () => {
  const good = set(S, { ewSelf: 1, ewOpp: 3 });
  assert.equal(review(good).balanceAdequacy, 'SUFFICIENT');
  const td = review(good, { kane: 'UNVERIFIED', real: false });
  assert.equal(td.balanceAdequacy, 'UNVERIFIED'); assert.equal(td.provisionalAdequacy, 'SUFFICIENT'); assert.equal(td.implementationCorrectness, 'UNVERIFIED');
  assert.equal(review(good, { manip: false }).balanceAdequacy, 'INEFFECTIVE', 'behaviour did not change as declared');
});
test('an honest null result does not trigger a forced modification', () => {
  const evals = ['H1', 'H2', 'H3', 'H4', 'H5'].map(id => ({ id, contractHash: '', outcome: (id === 'H1' ? 'REFUTED' : 'INCONCLUSIVE') as 'REFUTED' | 'INCONCLUSIVE', predictions: [], reasons: [], counterexamples: [], kane: { corroboration: 'NOT_ASKED' as const, detail: '' } }));
  const c = K.proposeCorrections(evals, 3);
  assert.equal(c.length, 1); assert.equal(c[0].category, 'none'); assert.equal(c[0].spec, null); assert.equal(c[0].policy, 'NO_CHANGE');
  const h0 = K.proposeCorrections([...evals, { ...evals[0], id: 'H0', outcome: 'SUPPORTED' }], 3);
  assert.equal(h0[0].category, 'metric'); assert.equal(h0[0].spec, null);
  const planner = K.proposeCorrections([{ ...evals[1], outcome: 'SUPPORTED' }], 3);
  assert.equal(planner[0].policy, 'REVIEW_REQUIRED', 'a planner correction is never applied automatically');
});

// ---------------------------------------------------------------- journal and manifests
test('V2 journal and evidence manifests verify; tampering is detected', () => {
  const f = jfile();
  const r = registry(f); r.register(contract('H5')); r.close('x');
  assert.equal(verifyJournal(f).ok, true);
  writeFileSync(f, readFileSync(f, 'utf8').replace('"H5"', '"H6"'));
  assert.equal(verifyJournal(f).ok, false);
  const d = join(tmp, 'man'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'a.txt'), 'x');
  writeManifest(d);
  const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
  assert.ok(m.files.some(x => x.path === 'a.txt' && x.sha256 === C.sha256File(join(d, 'a.txt'))));
});
test('V1 evidence is untouched: the V1 manifest still matches every file it lists', () => {
  const dir = join(root, 'evidence/balance/runs/2026-11-18T14-21-47Z-kane');
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
  const bad = m.files.filter(x => x.path !== 'status.json' && existsSync(join(dir, x.path)) && C.sha256File(join(dir, x.path)) !== x.sha256).map(x => x.path);
  assert.deepEqual(bad, []);
  assert.equal(verifyJournal(join(root, 'balance/journal.ndjson')).ok, true);
});
test('a metric over too few underlying events is never judged, even with a tight-looking interval', () => {
  const eff = M.pairedEffect('tp_self_harm_rate', set(S, { selfTp: 0 }).map((g, i) => (i ? g : rec(g.seed, g.first, { selfTp: 1 }))), set(S, { selfTp: 0 }).map((g, i) => (i ? g : rec(g.seed, g.first, { selfTp: 1 }))), { boot: 300 });
  const p = contract('H5').predictions.find(x => x.id === 'P5b')!;
  assert.equal(C.judge(p, eff, 8, 20).status, 'unclear');
  assert.match(C.judge(p, eff, 8, 20).reason, /too few|no usable interval/);
  const few = M.pairedEffect('tp_self_harm_rate', set(S.slice(0, 8), { selfTp: 1 }), set(S.slice(0, 8), { selfTp: 1 }), { boot: 300 });
  assert.ok(few.ci, 'every resample has events, so an interval exists');
  assert.match(C.judge(p, few, 8, 20).reason, /too few underlying events/);
});
test('the shove self-boost placement metric is flagged as non-discriminating; the trigger metric is used instead', () => {
  assert.match(M.METRICS.ew_aligned_share.note ?? '', /NOT discriminating/);
  const used = hyp.hypotheses.flatMap(h => h.predictions.map(p => p.metric));
  assert.ok(!used.includes('ew_aligned_share') && used.includes('ew_self_trigger_share'));
});

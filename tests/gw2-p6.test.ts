/**
 * GW2 P6: the GW2 SkillBook run end to end by the UNCHANGED vendored SkillFlow runner with test doubles in place of
 * every agent (AC-P6.1 – AC-P6.4), the Kane CLI invocation boundary, the five investigator profiles and abstention
 * handling. No Kane, no model, no network beyond loopback. Scratch runs live in mkdtemp directories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { realRoute, checkShim, BoundaryRefused, PROFILES } from '../gamewatch/gw2/kane-boundary.ts';
import { ranksAbove, DIMENSIONS } from '../gamewatch/gw2/p6-steps.ts';
import { kaneArgv, OBJECTIVE_P7 } from '../gamewatch/gw2/p7-plan.ts';
import { PAID_RESEARCH_EXECUTION, PAID_RESEARCH_SCOPE } from '../server/balance/v4/kanebudget.ts';

const PY = process.platform === 'win32' ? 'python' : 'python3';
const RUNNER = join(ROOT, 'gamewatch/vendor/skillflow/runner.py'), BOOK = join(ROOT, 'gamewatch/gw2/book.json');
const AT = '2026-11-25T20:00:00.000Z';
const vars = (d: string, route = 'test-double') => ['out=' + join(d, 'out'), 'exp=' + join(d, 'exp'), 'generation=evidence/gw2/procedures/generation-p5-1.json', 'partition=evidence/gw2/procedures/partition-p5-1.json',
  'bundle=evidence/gw2/p5-experiment/generated/bundle.json', 'sessions=5', 'profiles=' + PROFILES.join(','), 'route=' + route, 'at=' + AT].flatMap(v => ['--var', v]);
function runBook(d: string, o: { authorize?: boolean; route?: string } = {}) {
  const state = join(d, 'state');
  if (o.authorize) { mkdirSync(join(state, 'authorizations'), { recursive: true }); writeFileSync(join(state, 'authorizations', 'kane-paid'), 'TEST: P6 test-double route (no paid call can happen: the gate is disabled)\n'); }
  const env = { ...process.env, GW2_SHIM_MARKER: join(d, 'shim-started.txt') } as Record<string, string | undefined>;
  delete env.SKILLFLOW_AUTH_KANE_PAID; delete env.KANE_CLI;
  const t0 = Date.now();
  const r = spawnSync(PY, [RUNNER, 'run', BOOK, '--state', state, '--workdir', ROOT, ...vars(d, o.route)], { encoding: 'utf8', env: env as NodeJS.ProcessEnv, timeout: 600_000 });
  const log = readFileSync(join(state, 'log.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { code: r.status, ms: Date.now() - t0, stdout: r.stdout, stderr: r.stderr, log, state: JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')), marker: join(d, 'shim-started.txt') };
}

let full: { d: string; r: ReturnType<typeof runBook> } | null = null;
function fullRun() { if (!full) { const d = mkdtempSync(join(tmpdir(), 'gw2-p6-')); full = { d, r: runBook(d, { authorize: true }) }; } return full; }
test.after(() => { if (full) rmSync(full.d, { recursive: true, force: true }); });

test('AC-P6.1 the GW2 book runs to @done with test doubles under the unchanged runner, offline, in under 10 minutes', () => {
  assert.equal(spawnSync(PY, [RUNNER, 'validate', BOOK], { encoding: 'utf8' }).stdout.trim(), 'ok: 13 tasks');
  const { d, r } = fullRun();
  assert.equal(r.code, 0, r.stdout + r.stderr); assert.equal(r.state.status, 'done');
  assert.ok(r.ms < 600_000, `${r.ms} ms`);
  const tasks = r.state.history.map((h: { task: string }) => h.task);
  assert.deepEqual(tasks, ['procedures', 'partition', 'session-plan', 'investigate', 'closure', 'import', 'freeze', 'representations', 'three-way', 'heldout', 'discriminate', 'report', 'integrity']);
  for (const f of readdirSync(join(d, 'out'))) assert.equal(JSON.parse(readFileSync(join(d, 'out', f), 'utf8')).ok, true, f);
  const inv = JSON.parse(readFileSync(join(d, 'exp', 'INVESTIGATORS.json'), 'utf8')).sessions;
  assert.deepEqual(inv.map((s: { profile: string }) => s.profile), [...PROFILES]);
  for (const s of inv) {
    assert.equal(s.cli, 'gamewatch/gw2/doubles/kane-shim.mjs'); assert.equal(s.route, 'test-double'); assert.equal(s.exitCode, 0);
    assert.deepEqual([s.argv[0], s.argv[1], s.argv[2]], ['run', OBJECTIVE_P7, '--url'], 'the P7 objective-mode argv');
    assert.match(s.argv[3], /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/); assert.deepEqual(s.argv.slice(4), kaneArgv(0).slice(4));
  }
  assert.deepEqual(readFileSync(r.marker, 'utf8').trim().split('\n'), [...PROFILES], 'the shim ran once per profile, and nothing else');
  // the agent-side input boundary: sessions are labelled test-double; nothing was imported as Kane
  const graph = readFileSync(join(d, 'exp', 'judgments.ndjson'), 'utf8');
  assert.doesNotMatch(graph, /"id":"kane-cli"/);
  assert.equal(JSON.parse(readFileSync(join(d, 'out', '08-representations.json'), 'utf8')).externalTranslations, 0, 'U3: no translation');
});

test('AC-P6.2 without authorization the book stops with exit 2 at the gated step and no Kane or agent process starts', () => {
  const d = mkdtempSync(join(tmpdir(), 'gw2-p6-noauth-'));
  try {
    const r = runBook(d);
    assert.equal(r.code, 2); assert.equal(r.state.status, 'needs-authorization'); assert.equal(r.state.current, 'investigate');
    assert.ok(r.log.some(e => e.event === 'needs-authorization' && e.task === 'investigate'));
    assert.ok(!r.log.some(e => e.event === 'task-start' && e.task === 'investigate'), 'the gated task was never started');
    assert.ok(!existsSync(r.marker), 'no shim (stand-in for Kane) process started');
    assert.ok(!existsSync(join(d, 'exp', 'sessions')), 'no review session was opened');
    assert.ok(!existsSync(join(d, 'exp', 'kane-runs')));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('AC-P6.2 the real route is refused by the unchanged paid-call gate before any process, even when the runner step is authorized', async () => {
  // the gate is disabled, or (D109) open only for the three P7 pilot run ids while the pilot runs
  const pilotOpen = PAID_RESEARCH_EXECUTION === 'per-run-approval' && String(PAID_RESEARCH_SCOPE) === String(/^GW2-P7-pilot-[123]$/);
  assert.ok(PAID_RESEARCH_EXECUTION === 'disabled' || pilotOpen);
  const d = mkdtempSync(join(tmpdir(), 'gw2-p6-real-'));
  try {
    mkdirSync(d, { recursive: true });
    const r = await realRoute(d);
    assert.ok('refused' in r); assert.match(r.refused, pilotOpen ? /external operator record/ : /disabled/);
    const r2 = runBook(join(d, 'book'), { authorize: true, route: 'real' });
    assert.equal(r2.code, 3, 'the boundary exits 2 and the book stops'); assert.equal(r2.state.current, 'investigate');
    assert.ok(!existsSync(r2.marker)); assert.ok(!existsSync(join(d, 'book', 'exp', 'sessions')));
    // only the repository's own shim can be started on the test-double route
    assert.throws(() => checkShim('kane-cli'), BoundaryRefused);
    assert.throws(() => checkShim('/usr/local/bin/kane-cli'), BoundaryRefused);
    assert.ok(checkShim('gamewatch/gw2/doubles/kane-shim.mjs').endsWith('kane-shim.mjs'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('AC-P6.3 the five doubles produce the expected separated metrics; over-abstaining never ranks above accurate except on incorrect assertions', () => {
  const { d } = fullRun();
  const rep = JSON.parse(readFileSync(join(d, 'exp', 'P6_REPORT.json'), 'utf8'));
  const m = Object.fromEntries(rep.profiles.map((p: { profile: string }) => [p.profile, p]));
  // accurate: asserts, all correct, cites only what it read
  assert.ok(m.accurate.coverage.k > 0); assert.equal(m.accurate.accuracy.rate, 1); assert.equal(m.accurate.citations.citedWithoutAccess, 0);
  // careless: same claims, cites pages it never opened
  assert.ok(m.careless.citations.citedWithoutAccess > 0); assert.equal(m.careless.citations.citedWithoutAccess, m.careless.citations.cited);
  // over-abstaining: no assertion, no rate, nothing detected
  assert.equal(m['over-abstaining'].submissions.abstentions, 3); assert.equal(m['over-abstaining'].accuracy.rate, null); assert.equal(m['over-abstaining'].coverage.k, 0); assert.equal(m['over-abstaining'].detection.k, 0);
  // confident-wrong: many incorrect assertions, lower accuracy
  assert.ok(m['confident-wrong'].incorrectAssertions.contradictingChecks > 0); assert.ok(m['confident-wrong'].accuracy.rate < 1);
  // defect-describer: describes a planted defect accurately on held-out (through the discovery build id, D88)
  assert.ok(m['defect-describer'].detection.k >= 1); assert.equal(m.accurate.detection.k, 0);
  assert.ok(m['defect-describer'].detection.detected.every((x: string) => x.startsWith('R3@')));
  // abstention handling
  assert.deepEqual(rep.abstentionCheck.overAbstainingAboveAccurateOn.filter((k: string) => k !== 'incorrect assertions'), []);
  assert.match(rep.abstentionCheck.why, /asserts nothing/);
  assert.match(readFileSync(join(d, 'exp', 'P6_REPORT.md'), 'utf8'), /TEST DOUBLES/);
  assert.doesNotMatch(JSON.stringify(rep), /composite|overall score/i);
});

test('AC-P6.3 ranking rule: a profile without assertions is never better on a rate; fewer errors from asserting less is the only allowed edge', () => {
  const base = { coverage: { rate: 0.5 }, accuracy: { rate: 0.9 }, detection: { rate: 0.5 }, incorrectAssertions: { contradictingChecks: 3 }, citations: { citedWithoutAccess: 0 } };
  const abst = { coverage: { rate: 0 }, accuracy: { rate: null }, detection: { rate: 0 }, incorrectAssertions: { contradictingChecks: 0 }, citations: { citedWithoutAccess: 0 } };
  assert.deepEqual(ranksAbove(abst as never, base as never), ['incorrect assertions']);
  assert.deepEqual(ranksAbove(base as never, abst as never).sort(), ['accuracy', 'coverage', 'detection']);
  assert.deepEqual(DIMENSIONS.map(x => x.key), ['coverage', 'accuracy', 'detection', 'incorrect assertions', 'cited without access']);
});

test('AC-P6.4 the vendored runner is unchanged and its verifier passes', () => {
  const v = spawnSync(PY, [join(ROOT, 'gamewatch/vendor/verify.py')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const g = spawnSync('git', ['diff', '--stat', 'd22d33e', '--', 'gamewatch/vendor'], { encoding: 'utf8', cwd: ROOT });
  if (g.status === 0) assert.equal(g.stdout.trim(), '', 'git diff d22d33e -- gamewatch/vendor is empty');
  else assert.fail(`git diff could not run: ${g.stderr}`);
});

test('P7 book: pre-registers into the external record, then stops before the first real session without authorization, and the disabled gate refuses with it', () => {
  const BOOK7 = join(ROOT, 'gamewatch/gw2/book-p7.json');
  assert.equal(spawnSync(PY, [RUNNER, 'validate', BOOK7], { encoding: 'utf8' }).stdout.trim(), 'ok: 16 tasks');
  const d = mkdtempSync(join(tmpdir(), 'gw2-p7book-'));
  try {
    const go = (sub: string, auth: boolean) => {
      const state = join(d, sub, 'state');
      if (auth) { mkdirSync(join(state, 'authorizations'), { recursive: true }); writeFileSync(join(state, 'authorizations', 'kane-paid-1'), 'TEST: runner authorization only; the paid-call gate stays disabled\n'); }
      const env = { ...process.env } as Record<string, string | undefined>; delete env.SKILLFLOW_AUTH_KANE_PAID_1; delete env.KANE_PAID_RUN_AUTH;
      const v = ['out=' + join(d, sub, 'out'), 'exp=' + join(d, sub, 'exp'), 'generation=evidence/gw2/procedures/generation-p7-1.json', 'partition=evidence/gw2/procedures/partition-p7-1.json',
        'bundle=evidence/gw2/p7-evidence/generated/bundle.json', 'sessions=3', 'profiles=kane', 'run1=P7-test-1', 'run2=P7-test-2', 'run3=P7-test-3', 'record=' + join(d, sub, 'external-record'), 'at=' + AT].flatMap(x => ['--var', x]);
      const r = spawnSync(PY, [RUNNER, 'run', BOOK7, '--state', state, '--workdir', ROOT, ...v], { encoding: 'utf8', env: env as NodeJS.ProcessEnv, timeout: 300_000 });
      return { code: r.status, state: JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')) };
    };
    const a = go('noauth', false);
    assert.equal(a.code, 2); assert.equal(a.state.current, 'investigate-1');
    const b = go('auth', true);
    assert.equal(b.code, 3); assert.equal(b.state.current, 'investigate-1');
    assert.ok(!existsSync(join(d, 'auth', 'exp', 'sessions')), 'refused before any server or process');
    const ledger = readFileSync(join(d, 'auth', 'exp', 'kane-ledger.ndjson'), 'utf8');
    assert.match(ledger, /"event":"refused"/); assert.doesNotMatch(ledger, /call-start/);
    assert.ok(existsSync(join(d, 'auth', 'external-record', 'PREREGISTRATION.json')), 'the pre-registration is frozen before the first call');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('P7 evidence (U1, U4): frozen before generation, 12 seeds, 4 held-out seeds, a shielded matrix variant in each partition, unopened', async () => {
  const { loadGenerationProcedure } = await import('../gamewatch/gw2/generate-p7.ts');
  const { verifyPartitions, partition, PartitionError } = await import('../gamewatch/gw2/partition.ts');
  const { fileSha256 } = await import('../gamewatch/gw2/judgments.ts');
  const genF = join(ROOT, 'evidence/gw2/procedures/generation-p7-1.json'), partF = join(ROOT, 'evidence/gw2/procedures/partition-p7-1.json');
  const gen = loadGenerationProcedure(genF);
  assert.equal(gen.runs.experiment.matches!.seeds.length, 12);
  const prov = JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/p7-evidence/generated/PROVENANCE.json'), 'utf8'));
  assert.equal(prov.procedure.sha256, fileSha256(genF)); assert.ok(Date.parse(prov.startedAt) > Date.parse(gen.frozenAt));
  assert.equal(prov.bundle.sha256, fileSha256(join(ROOT, 'evidence/gw2/p7-evidence/generated/bundle.json')));
  const exp = join(ROOT, 'evidence/gw2/p7-evidence'), P = JSON.parse(readFileSync(join(exp, 'partitions/PARTITION.json'), 'utf8'));
  assert.equal(P.procedure.sha256, fileSha256(partF));
  assert.equal(P.assignment.heldout.seeds.length, 4); assert.equal(P.assignment.discovery.seeds.length, 8);
  assert.ok(P.assignment.discovery.scripts.includes('matrix-shield-v1') !== P.assignment.heldout.scripts.includes('matrix-shield-v1'));
  assert.ok(P.assignment.discovery.scripts.some((s: string) => s.startsWith('matrix-shield-')) && P.assignment.heldout.scripts.some((s: string) => s.startsWith('matrix-shield-')));
  assert.equal(P.assignment.discovery.scripts.filter((s: string) => P.assignment.heldout.scripts.includes(s)).length, 0, 'no observation in both partitions');
  assert.deepEqual(verifyPartitions(exp), []);
  assert.equal(JSON.parse(readFileSync(join(exp, 'LEAK_CHECK.json'), 'utf8')).ok, true);
  const ev = JSON.parse(readFileSync(join(exp, 'partitions/eval/eval.json'), 'utf8'));
  assert.equal(Object.keys(ev.idMaps.heldout.matchSeeds).length, P.counts.heldout.matches, 'per-match seed map (D90)');
  for (const f of ['judgments.ndjson', 'evaluation-ledger.ndjson', 'hypotheses', 'sessions']) assert.ok(!existsSync(join(exp, f)), `unopened: no ${f}`);
  // a constraint that cannot be met fails the partition with the reason; nothing is relaxed
  const d = mkdtempSync(join(tmpdir(), 'gw2-p7c-'));
  try {
    const strict = { ...JSON.parse(readFileSync(partF, 'utf8')), constraints: { minSeeds: 12, minHeldoutSeeds: 5, familiesInBothPartitions: ['matrix-shield'] } };
    writeFileSync(join(d, 'proc.json'), JSON.stringify(strict));
    await assert.rejects(partition(join(d, 'proc.json'), join(ROOT, 'evidence/gw2/p7-evidence/generated/bundle.json'), join(d, 'exp')), (e: Error) => e instanceof PartitionError && /4 held-out seeds, at least 5 required/.test(e.message));
    assert.ok(!existsSync(join(d, 'exp', 'partitions')));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('AC-P6.5 evidence: the committed P6 run is complete, sealed and verifies', async () => {
  const { integrity } = await import('../gamewatch/gw2/p6-steps.ts');
  const run = join(ROOT, 'evidence/gw2/p6-run');
  assert.equal(JSON.parse(readFileSync(join(run, 'skillflow/state.json'), 'utf8')).status, 'done');
  const r = integrity(join(run, 'exp'));
  assert.ok(r.ok, JSON.stringify(r.checks.filter(c => !c.ok)));
  assert.equal(JSON.parse(readFileSync(join(run, 'exp/P6_REPORT.json'), 'utf8')).profiles.length, 5);
});

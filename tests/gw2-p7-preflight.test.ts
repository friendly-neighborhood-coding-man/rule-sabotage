/**
 * GW2 P7 preflight corrections (operator review of P6, D102–D108), with the existing test doubles only. No Kane, no
 * model, no paid call: the real route is driven through its test harness, which is accepted only when KANE_CLI is
 * the repository shim (it reports the test-double version, never 0.10.4), with the gate in per-run-approval mode
 * for the duration of the call only. The committed gate is not consulted for these runs. Scratch in mkdtemp dirs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { realRoute, testDoubleRoute, SHIM, BoundaryRefused } from '../gamewatch/gw2/kane-boundary.ts';
import { runStep, sessionLabel } from '../gamewatch/gw2/p6-steps.ts';
import { runFacts, sessionOutcome, cumulativeUsed, opsStatus, readExecLedger, verifyRawSeal, recordDir, PreflightError, RESEARCH_THRESHOLD_CREDITS } from '../gamewatch/gw2/p7-exec.ts';
import { readLedger } from '../server/balance/v4/kanebudget.ts';
import { verify } from '../gamewatch/gw2/judgments.ts';

const AT = '2026-11-25T21:00:00.000Z';
const P7 = { generation: 'evidence/gw2/procedures/generation-p7-1.json', partition: 'evidence/gw2/procedures/partition-p7-1.json', bundle: 'evidence/gw2/p7-evidence/generated/bundle.json' };
const HARNESS = { mode: 'per-run-approval' as const, expectVersion: '0.0.0-test-double' };
const approval = (runId: string) => ({ runId, approvedBy: 'TEST (harness)', approvedAt: AT, maxCalls: 1, maxSteps: 80, ceilingCredits: 300, acknowledgesNoHardCap: true });

/** A fresh P7 experiment: partition (frozen procedure), leak check, 3 declared sessions; optionally pre-registered. */
async function setup(o: { prereg?: boolean } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'gw2-p7pf-')), exp = join(d, 'exp'), out = join(d, 'out'), record = join(d, 'external-record');
  assert.equal(await runStep('partition', join(out, 'p.json'), exp, { partition: P7.partition, bundle: P7.bundle }), true);
  assert.equal(await runStep('session-plan', join(out, 's.json'), exp, { sessions: '3', profiles: 'kane' }), true);
  if (o.prereg !== false) assert.equal(await runStep('preregister', join(out, 'r.json'), exp, { record, run1: 'T-1', run2: 'T-2', run3: 'T-3' }), true, readFileSync(join(out, 'r.json'), 'utf8'));
  writeFileSync(join(d, 'balance'), '1000');
  return { d, exp, out, record, balance: join(d, 'balance') };
}
type Env = Record<string, string | undefined>;
async function withEnv<T>(env: Env, f: () => Promise<T>): Promise<T> {
  const prev: Env = {}; for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await f(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}
/** Activate ONE approval immediately before its run, as the operator does, and run the real route via the harness. */
async function harnessRun(x: Awaited<ReturnType<typeof setup>>, runId: string, env: Env = {}) {
  mkdirSync(join(x.exp, 'approvals'), { recursive: true });
  writeFileSync(join(x.exp, 'approvals', `${runId}.json`), JSON.stringify(approval(runId)));
  return withEnv({ KANE_CLI: join(ROOT, SHIM), KANE_PAID_RUN_AUTH: runId, GW2_SHIM_BALANCE_FILE: x.balance, GW2_DOUBLE_PROFILE: 'accurate', GW2_SHIM_COST: undefined, GW2_SHIM_NO_RUN_END: undefined, GW2_SHIM_LOSE_BALANCE: undefined, ...env },
    () => realRoute(x.exp, { runId, record: x.record, harness: HARNESS }));
}

test('D102 completion needs a valid run_end: exit code 0 alone is inconclusive and stops the pipeline', () => {
  const end = (st: string) => `{"type":"stream_start","cli_version":"0.10.4"}\n{"step":3,"status":"done"}\n{"type":"run_end","status":"${st}","summary":"SECRET FINDING TEXT","credits_consumed":61.5,"reason_code":"success.complete","result_code":100}\n`;
  const ok = runFacts(end('passed'));
  assert.deepEqual(ok.runEnd, { present: true, valid: true, status: 'passed', reasonCode: 'success.complete', resultCode: 100 });
  assert.equal(ok.steps, 3); assert.equal(ok.kaneCreditsReported, 61.5);
  assert.doesNotMatch(JSON.stringify(ok), /SECRET FINDING TEXT/, 'operational facts carry no Kane summary');
  assert.equal(sessionOutcome({ exitCode: 0, timedOut: false, facts: ok }).status, 'completed');
  assert.equal(sessionOutcome({ exitCode: 0, timedOut: false, facts: runFacts(end('failed')) }).status, 'completed', 'an objective Kane reports as failed is still a completed run');
  const none = sessionOutcome({ exitCode: 0, timedOut: false, facts: runFacts('{"type":"stream_start"}\n') });
  assert.equal(none.status, 'inconclusive'); assert.equal(none.stop, true); assert.match(none.reasons.join(), /no run_end event: exit code alone/);
  assert.equal(sessionOutcome({ exitCode: 0, timedOut: false, facts: runFacts(end('error')) }).status, 'inconclusive');
  assert.equal(sessionOutcome({ exitCode: null, timedOut: true, facts: ok }).status, 'inconclusive');
});

test('D103 CEILING_EXCEEDED, SPEND_UNKNOWN and the cumulative 4,000-credit threshold stop the pipeline', () => {
  const facts = runFacts('{"type":"run_end","status":"passed"}\n');
  for (const outcome of ['CEILING_EXCEEDED', 'SPEND_UNKNOWN']) { const r = sessionOutcome({ exitCode: 0, timedOut: false, facts, spend: { used: 1, outcome } }); assert.equal(r.status, 'budget-stop'); assert.equal(r.stop, true); }
  assert.equal(sessionOutcome({ exitCode: 0, timedOut: false, facts, spend: { used: 70, outcome: 'WITHIN_CEILING' }, cumulativeUsed: RESEARCH_THRESHOLD_CREDITS }).status, 'budget-stop');
  assert.equal(sessionOutcome({ exitCode: 0, timedOut: false, facts, spend: { used: 70, outcome: 'WITHIN_CEILING' }, cumulativeUsed: 3999 }).status, 'completed');
  assert.equal(cumulativeUsed([{ event: 'call-end', detail: { used: 70 } }, { event: 'call-end', detail: { used: null } }]), null);
});

test('D107 labels come from the operator record: real Kane is never labelled TEST DOUBLE', () => {
  assert.match(sessionLabel({ profile: 'kane', route: 'real' }), /^REAL KANE SESSION/);
  assert.match(sessionLabel({ profile: 'kane', route: 'real', testHarness: true }), /^TEST HARNESS/);
  assert.match(sessionLabel({ profile: 'accurate', route: 'test-double' }), /^TEST DOUBLE/);
  assert.doesNotMatch(sessionLabel({ profile: 'kane', route: 'real' }), /TEST/);
});

test('D106 the external record must be outside the repository; the pre-registration is written once and needs unopened evidence', async () => {
  assert.throws(() => recordDir(undefined), PreflightError);
  assert.throws(() => recordDir(join(ROOT, 'evidence/gw2/x')), /inside the repository/);
  const x = await setup();
  try {
    const l = readExecLedger(x.record); assert.ok(l.ok); assert.deepEqual(l.entries.map(e => e.event), ['preregistered']);
    const p = JSON.parse(readFileSync(join(x.record, 'PREREGISTRATION.json'), 'utf8'));
    assert.equal(p.plan.sessions, 3); assert.deepEqual(p.plan.runIds, ['T-1', 'T-2', 'T-3']); assert.equal(p.plan.maxSteps, 80); assert.equal(p.plan.timeoutS, 2700); assert.equal(p.plan.cliVersion, '0.10.4');
    assert.ok(p.files['exp:partitions/PARTITION.json'] && p.files['docs/gw2/P7_PREREGISTRATION.md']);
    // written once
    assert.equal(await runStep('preregister', join(x.out, 'r2.json'), x.exp, { record: x.record, run1: 'T-1', run2: 'T-2', run3: 'T-3' }).catch(() => false), false);
    // opened evidence or a different partition is refused
    const y = await setup({ prereg: false });
    mkdirSync(join(y.exp, 'sessions', 'abc'), { recursive: true });
    assert.equal(await runStep('preregister', join(y.out, 'r.json'), y.exp, { record: y.record, run1: 'T-1', run2: 'T-2', run3: 'T-3' }).catch(() => false), false);
    assert.ok(!existsSync(join(y.record, 'PREREGISTRATION.json')));
    rmSync(y.d, { recursive: true, force: true });
  } finally { rmSync(x.d, { recursive: true, force: true }); }
});

test('real route preflight refuses before any process: no record, a changed frozen file, two approvals active at once', async () => {
  const x = await setup();
  try {
    const marker = join(x.d, 'marker');
    const noRec = await withEnv({ KANE_CLI: join(ROOT, SHIM), KANE_PAID_RUN_AUTH: 'T-1', GW2_SHIM_MARKER: marker }, () => realRoute(x.exp, { runId: 'T-1', harness: HARNESS }));
    assert.ok('refused' in noRec && /external operator record/.test(noRec.refused));
    mkdirSync(join(x.exp, 'approvals'), { recursive: true });
    for (const id of ['T-1', 'T-2']) writeFileSync(join(x.exp, 'approvals', `${id}.json`), JSON.stringify(approval(id)));
    const two = await withEnv({ KANE_CLI: join(ROOT, SHIM), KANE_PAID_RUN_AUTH: 'T-1', GW2_SHIM_MARKER: marker }, () => realRoute(x.exp, { runId: 'T-1', record: x.record, harness: HARNESS }));
    assert.ok('refused' in two && /one at a time/.test(two.refused));
    rmSync(join(x.exp, 'approvals', 'T-2.json'));
    const plan = readFileSync(join(x.exp, 'SESSIONS.json'), 'utf8'); writeFileSync(join(x.exp, 'SESSIONS.json'), plan.replace('"expectedSessions": 3', '"expectedSessions": 2'));
    const changed = await withEnv({ KANE_CLI: join(ROOT, SHIM), KANE_PAID_RUN_AUTH: 'T-1', GW2_SHIM_MARKER: marker }, () => realRoute(x.exp, { runId: 'T-1', record: x.record, harness: HARNESS }));
    assert.ok('refused' in changed && /SESSIONS.json changed since the pre-registration/.test(changed.refused));
    assert.ok(!existsSync(marker) && !existsSync(join(x.exp, 'sessions')), 'no Kane process and no session');
    await assert.rejects(withEnv({ KANE_CLI: '/usr/bin/kane-cli' }, () => realRoute(x.exp, { runId: 'T-1', record: x.record, harness: HARNESS })), BoundaryRefused, 'the harness never accepts a non-shim CLI');
  } finally { rmSync(x.d, { recursive: true, force: true }); }
});

test('D102–D108 end to end through the real route (harness): seal, anchors, Kane provenance, import, freeze, seal, evaluation, labels, integrity', async () => {
  const x = await setup();
  try {
    for (const [i, id] of ['T-1', 'T-2', 'T-3'].entries()) {
      const r = await harnessRun(x, id);
      assert.ok(!('refused' in r), JSON.stringify(r));
      if ('refused' in r) return;
      assert.equal(r.status, 'completed'); assert.equal(r.stop, false);
      const dir = join(x.exp, 'kane-runs', r.session);
      assert.deepEqual(readdirSync(dir).sort(), ['RAW_SEAL.json', 'args.json', 'meta.json', 'stderr.txt', 'stdout.ndjson']);
      assert.ok(verifyRawSeal(dir).ok);
      const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
      assert.equal(args.cli, 'kane-cli'); assert.equal(args.version, '0.0.0-test-double'); assert.ok(args.nonce && args.testHarness);
      const l = readExecLedger(x.record); assert.ok(l.ok);
      const last = l.entries[l.entries.length - 1];
      assert.equal(last.event, 'session-end'); assert.equal(last.data.rawSealSha256, r.rawSealSha256); assert.equal(last.data.runId, id);
      assert.equal(readLedger(join(x.exp, 'kane-ledger.ndjson')).filter(e => e.event === 'call-start').length, i + 1, 'one call per session');
    }
    // D108: between sessions only operational fields are visible
    const ops = JSON.stringify(opsStatus(x.exp)), inv = readFileSync(join(x.exp, 'INVESTIGATORS.json'), 'utf8');
    for (const s of [ops, inv]) { assert.doesNotMatch(s, /TEST DOUBLE \(scripted\)|summary|submitted \d+ hypotheses/, 'no Kane summary or findings'); }
    assert.match(ops, /"status":"completed"/);
    // the rest of the P7 book, through the same steps
    for (const step of ['closure', 'import', 'freeze', 'representations', 'three-way', 'heldout', 'discriminate', 'report', 'integrity'])
      assert.equal(await runStep(step, join(x.out, `${step}.json`), x.exp, { at: AT, record: x.record }), true, `${step}: ${readFileSync(join(x.out, `${step}.json`), 'utf8')}`);
    const g = verify(join(x.exp, 'judgments.ndjson'), { checkRefs: true });
    assert.ok(g.ok); assert.notEqual(g.levels.executionProvenance.status, 'fail');
    assert.ok(g.levels.executionProvenance.nodes.length > 0, 'imported with Kane provenance');
    for (const n of g.levels.executionProvenance.nodes) assert.ok(n.limitations.some(m => /kane-cli's own run link/.test(m)), 'a Kane test_url is a limitation, not a mismatch');
    assert.ok(JSON.parse(readFileSync(join(x.out, 'representations.json'), 'utf8')).sealed > 0, 'submitter representations from a Kane-labelled session are sealed');
    const rep = JSON.parse(readFileSync(join(x.exp, 'P7_PILOT_REPORT.json'), 'utf8'));
    assert.match(rep.label, /^TEST HARNESS/); assert.ok(rep.profiles.every((m: { label: string }) => /^TEST HARNESS/.test(m.label)));
    assert.equal(rep.execution.length, 3); assert.ok(rep.execution.every((e: { creditsByBalanceDelta: number; status: string }) => e.creditsByBalanceDelta === 50 && e.status === 'completed'));
    assert.ok(!existsSync(join(x.exp, 'P6_REPORT.json')));
    const md = readFileSync(join(x.exp, 'P7_PILOT_REPORT.md'), 'utf8'); assert.match(md, /^# GW2 P7 pilot report/); assert.doesNotMatch(md, /TEST DOUBLE:/);
    const integ = JSON.parse(readFileSync(join(x.out, 'integrity.json'), 'utf8'));
    for (const c of ['external execution ledger (Q14)', 'frozen pre-registration unchanged', 'external anchor of the hypothesis freeze', 'external anchor of the representation seal', 'judgment graph extends its externally anchored prefix'])
      assert.ok(integ.checks.some((k: { check: string; ok: boolean }) => k.check === c && k.ok), c);
    assert.deepEqual(readExecLedger(x.record).entries.map(e => e.event), ['preregistered', 'session-end', 'session-end', 'session-end', 'hypothesis-freeze', 'representation-seal', 'integrity']);
    // tampering with a raw file after the seal is detected
    const s0 = readdirSync(join(x.exp, 'kane-runs'))[0]; writeFileSync(join(x.exp, 'kane-runs', s0, 'stderr.txt'), 'edited');
    assert.equal(await runStep('integrity', join(x.out, 'i2.json'), x.exp, { record: x.record }), false);
  } finally { rmSync(x.d, { recursive: true, force: true }); }
});

for (const [name, env, expect] of [
  ['exit 0 without run_end', { GW2_SHIM_NO_RUN_END: '1' }, /inconclusive/],
  ['CEILING_EXCEEDED', { GW2_SHIM_COST: '400' }, /budget-stop/],
  ['SPEND_UNKNOWN', { GW2_SHIM_LOSE_BALANCE: '1' }, /budget-stop/],
] as const) test(`D102/D103 ${name}: the session is sealed, the pipeline stops, nothing is cleared, no further session starts`, async () => {
  const x = await setup();
  try {
    const r = await harnessRun(x, 'T-1', env);
    assert.ok(!('refused' in r)); if ('refused' in r) return;
    assert.match(r.status, expect); assert.equal(r.stop, true);
    assert.ok(verifyRawSeal(join(x.exp, 'kane-runs', r.session)).ok, 'raw artifacts are sealed even when the session failed');
    assert.equal(readExecLedger(x.record).entries.pop()!.event, 'session-end');
    writeFileSync(x.balance, '1000');
    const next = await harnessRun(x, 'T-2');
    assert.ok('refused' in next, 'no further session after a stop'); if (!('refused' in next)) return;
    assert.match(next.refused, /ended (inconclusive|budget-stop)|exceeded its ceiling or has an unknown spend/);
    const ledger = readLedger(join(x.exp, 'kane-ledger.ndjson'));
    assert.equal(ledger.filter(e => e.event === 'call-start').length, 1); assert.ok(!ledger.some(e => e.event === 'operator-clear'), 'the pipeline never clears the gate');
    assert.equal(readdirSync(join(x.exp, 'sessions')).length, 1);
  } finally { rmSync(x.d, { recursive: true, force: true }); }
});

test('D102 test-double route: exit 0 without run_end is not a completed session', async () => {
  const x = await setup({ prereg: false });
  try {
    const r = await withEnv({ GW2_SHIM_NO_RUN_END: '1', GW2_SHIM_BALANCE_FILE: x.balance }, () => testDoubleRoute(x.exp, ['accurate']));
    assert.equal(r[0].exitCode, 0); assert.equal(r[0].status, 'inconclusive');
  } finally { rmSync(x.d, { recursive: true, force: true }); }
});

test('D109 the paid-call gate serves only the three authorized P7 pilot run ids, whatever its mode', async () => {
  const KB = await import('../server/balance/v4/kanebudget.ts');
  const d = mkdtempSync(join(tmpdir(), 'gw2-p7scope-'));
  try {
    let execs = 0;
    const deps = (runId: string) => ({ ledgerFile: join(d, 'l.ndjson'), env: { KANE_PAID_RUN_AUTH: runId }, mode: 'per-run-approval' as const, scope: KB.PAID_RESEARCH_SCOPE, isRealCli: async () => true, balance: async () => 1000, exec: async () => { execs++; return { timedOut: false, exitCode: 0 }; } });
    const plan = { maxSteps: 80, timeoutS: 2700 };
    for (const id of ['GW1-blind-review', 'GW2-P7-pilot-4', 'research-x', 'GW2-P7-pilot-1x'])
      await assert.rejects(KB.checkPaidCall(approval(id) as never, plan, deps(id)), /outside the authorized scope/);
    for (const id of ['GW2-P7-pilot-1', 'GW2-P7-pilot-2', 'GW2-P7-pilot-3']) assert.equal((await KB.checkPaidCall(approval(id) as never, plan, deps(id))).before, 1000);
    assert.equal(execs, 0);
    assert.deepEqual(['GW2-P7-pilot-1', 'GW2-P7-pilot-2', 'GW2-P7-pilot-3'].map(x => KB.PAID_RESEARCH_SCOPE!.test(x)), [true, true, true]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

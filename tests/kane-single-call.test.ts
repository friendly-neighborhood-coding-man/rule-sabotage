/**
 * KS1 single-call runner, repaired path, exercised end to end with the repo's TEST DOUBLE (tests/fixtures/fake-kane-ks1.mjs).
 * No real Kane: KANE_CLI always points at the double, and the run happens in a temporary copy of the case directory.
 * Covers strict version/balance parsing, CDP readiness, run_end completeness, the structured shadow verdict, the gate's
 * single-call / overspend / balance rules, and Windows process-TREE termination through a .cmd shim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const FAKE = fileURLToPath(new URL('./fixtures/fake-kane-ks1.mjs', import.meta.url));
process.env.KANE_CLI = FAKE; // never the real kane-cli in this file
const K = await import('../scripts/kane-single-call.ts');
const { kaneConfig } = await import('../server/kane.ts');
const B = await import('../server/balance/v4/kanebudget.ts');
const chrome = process.env.KANE_CHROME || kaneConfig().chrome;
const tmp = mkdtempSync(join(tmpdir(), 'rs-ks1-test-'));
test.after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }));

let n = 0;
function setup(o: { balance?: number; cost?: number; mode?: string; version?: string; cli?: string } = {}) {
  const dir = join(tmp, `case${++n}`);
  cpSync(K.DIR, dir, { recursive: true, filter: s => !/[\\/](run|shadow|attempt-[^\\/]+)([\\/]|$)|ledger\.ndjson$|approval\.json$|preflight-checks\.ndjson$|ks1-console\.log$/.test(s) }); // only the case files, never the real KS1 run's records
  const bal = join(dir, 'balance.txt'); writeFileSync(bal, String(o.balance ?? 1000));
  const count = join(dir, 'count.txt');
  Object.assign(process.env, { KANE_CLI: o.cli ?? FAKE, KS1_BALANCE_FILE: bal, KS1_COST: String(o.cost ?? 7), KS1_MODE: o.mode ?? 'approve', KS1_COUNT_FILE: count, KS1_VERSION: o.version ?? '', KS1_PID_FILE: join(dir, 'pid.txt') });
  if (!o.version) delete process.env.KS1_VERSION;
  const approval = { runId: K.PLAN.runId, approvedBy: 'test', approvedAt: 'now', maxCalls: 1 as const, maxSteps: K.PLAN.maxStepsForEstimate, ceilingCredits: K.PLAN.ceilingCredits, acknowledgesNoHardCap: true as const };
  const runs = () => (existsSync(count) ? readFileSync(count, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  return { dir, approval, runs, env: { KANE_PAID_RUN_AUTH: K.PLAN.runId } };
}
const T = (extra: Record<string, unknown> = {}) => ({ mode: 'per-run-approval' as const, allowTestDouble: true as const, chrome: chrome!, ...extra });

test('strict parsing: version line and balance line, as kane-cli 0.10.4 prints them; anything else is refused', () => {
  assert.equal(K.strictVersion('0.10.4\n'), '0.10.4');
  assert.equal(K.strictVersion('\nUpdate available: 0.10.4 → 0.10.7 — run npm install\n0.10.4\n'), '0.10.4');
  assert.equal(K.strictVersion('0.10.4\n0.10.7\n'), null, 'ambiguous');
  assert.equal(K.strictVersion('kane-cli version unknown'), null);
  const real = '\nUpdate available: 0.10.4 → 0.10.7 — run `npm install -g @testmuai/kane-cli@latest` to update\n\nSkill update available: not installed → 0.1.4 — run `kane-cli install skill`\n\nAvailable credits: 10503.2867\n';
  assert.equal(K.strictBalance(real, '0.10.4'), 10503.2867);
  assert.equal(K.strictBalance('\x1b[1mAvailable credits: 12.5\x1b[0m', '0.10.4'), 12.5);
  assert.equal(K.strictBalance(real, '0.10.7'), null, 'another CLI version: format not verified');
  assert.equal(K.strictBalance('Available credits: 10\nAvailable credits: 11', '0.10.4'), null, 'two balance lines');
  assert.equal(K.strictBalance('Credits left: 10503 (approx. 1 2 3)', '0.10.4'), null, 'first-number parsing is gone');
  assert.equal(K.strictBalance('Available credits: -5', '0.10.4'), null);
  assert.equal(K.strictBalance('', '0.10.4'), null);
});

test('plan: analyzer arguments, the 9-step estimate is NOT enforced, 30 credits is not a cap', () => {
  assert.deepEqual(K.PLAN.args.slice(0, 4), ['run', '--analyzer-only', '--agent', '--cdp-endpoint']);
  assert.ok(!K.PLAN.args.includes('--max-steps'), 'no step limit is passed in analyzer mode');
  assert.match(B.CAP_WARNING, /LOCAL ESTIMATE/);
  const c = K.verifyCase();
  assert.deepEqual([c.coverage.cellsProposed, c.coverage.cellsWithEntryScenario], [3, 2]);
  assert.ok(K.PLAN.interpretation.some(x => /does NOT show the effect is safe/.test(x)));
});

test('the CLI entry point refuses --execute before launching anything while the gate is disabled', () => {
  const ledger = join(K.DIR, 'ledger.ndjson'), before = existsSync(ledger);
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'scripts/kane-single-call.ts', '--execute'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, KANE_CLI: FAKE, KS1_COUNT_FILE: join(tmp, 'main-count.txt') }, encoding: 'utf8' });
  assert.match(r.stdout, /REFUSED before any process started/);
  assert.equal(existsSync(join(tmp, 'main-count.txt')), false, 'not even the test double was started');
  assert.equal(existsSync(ledger), before, 'no ledger entry in the real case directory');
});

test('repaired path with the test double: one call, strict balances, complete run_end -> structured verdict, raw output kept', { skip: !chrome && 'no Chrome' }, async () => {
  const s = setup({ cost: 7 });
  const r = await K.executeSingleCall({ dir: s.dir, approval: s.approval, env: s.env, testOverrides: T() });
  assert.equal(r.refused, null);
  assert.equal(s.runs(), 1);
  assert.equal((r.spend as { outcome: string; used: number }).outcome, 'WITHIN_CEILING'); assert.equal((r.spend as { used: number }).used, 7);
  assert.equal(r.verdict!.status, 'approved'); assert.equal(r.verdict!.conditionResults.length, 6); assert.equal(r.verdict!.testDouble, true);
  assert.equal(r.disagreement, 'engine-unverified-kane-approved', 'an approval is recorded as a disagreement, nothing is placed');
  const stdout = readFileSync(join(r.runDir!, 'stdout.ndjson'), 'utf8');
  assert.match(stdout, /"type":"run_end"/); assert.match(stdout, /"page_seen":true/, 'Chrome was ready and showing the trial page');
  const meta = JSON.parse(readFileSync(join(r.runDir!, 'meta.json'), 'utf8'));
  assert.deepEqual([meta.coverage.cellsProposed, meta.coverage.cellsWithEntryScenario], [3, 2]); assert.equal(typeof meta.cdpReadyMs, 'number');
  assert.equal(JSON.parse(readFileSync(join(r.runDir!, 'args.json'), 'utf8')).args.filter((a: string) => a === '--condition').length, 6);
  const engine = JSON.parse(readFileSync(join(s.dir, 'engine-verdict.json'), 'utf8')); assert.equal(engine.final, 'unverified', 'engine decision preserved');
  // no retry, no follow-up: the same run id is refused, and nothing is started
  const again = await K.executeSingleCall({ dir: s.dir, approval: s.approval, env: s.env, testOverrides: T() });
  assert.match(again.refused!, /already started a call/); assert.equal(s.runs(), 1);
});

test('incomplete or unparsable Kane output stays inconclusive, never approved', { skip: !chrome && 'no Chrome' }, async () => {
  const a = setup({ mode: 'incomplete' });
  const r1 = await K.executeSingleCall({ dir: a.dir, approval: a.approval, env: a.env, testOverrides: T() });
  assert.equal(r1.verdict!.status, 'unverified'); assert.equal(r1.disagreement, 'kane-inconclusive'); assert.match(r1.verdict!.reason, /inconclusive/);
  const b = setup({ mode: 'garbage' });
  const r2 = await K.executeSingleCall({ dir: b.dir, approval: b.approval, env: b.env, testOverrides: T() });
  assert.equal(r2.verdict!.status, 'error'); assert.equal(r2.disagreement, 'kane-inconclusive');
  assert.match(readFileSync(join(r2.runDir!, 'stdout.ndjson'), 'utf8'), /not json at all/, 'raw output preserved');
});

test('gate rules hold on the repaired path: unclear balance, wrong CLI version, overspend blocks the next call', { skip: !chrome && 'no Chrome' }, async () => {
  const g = setup({ mode: 'balance-garbage' });
  assert.match((await K.executeSingleCall({ dir: g.dir, approval: g.approval, env: g.env, testOverrides: T() })).refused!, /balance unavailable/); assert.equal(g.runs(), 0);
  const v = setup({ version: '0.10.7' });
  assert.match((await K.executeSingleCall({ dir: v.dir, approval: v.approval, env: v.env, testOverrides: T() })).refused!, /not the real CLI/); assert.equal(v.runs(), 0);
  const low = setup({ balance: 40 });
  assert.match((await K.executeSingleCall({ dir: low.dir, approval: low.approval, env: low.env, testOverrides: T() })).refused!, /below 1\.5x the ceiling/); assert.equal(low.runs(), 0);
  const o = setup({ cost: 41 });
  const r = await K.executeSingleCall({ dir: o.dir, approval: o.approval, env: o.env, testOverrides: T() });
  assert.equal((r.spend as { outcome: string }).outcome, 'CEILING_EXCEEDED', 'the ceiling is not a cap: overspend is recorded, not prevented');
  const next = await K.executeSingleCall({ dir: o.dir, approval: { ...o.approval, runId: 'KS1-other' }, env: { KANE_PAID_RUN_AUTH: 'KS1-other' }, testOverrides: T() });
  assert.match(next.refused!, /exceeded its ceiling/); assert.equal(o.runs(), 1);
});

test('a hanging Kane behind a Windows .cmd shim is terminated as a whole process tree', { skip: (!chrome && 'no Chrome') || (process.platform !== 'win32' && 'Windows-only shim') }, async () => {
  const shim = join(tmp, 'kane-shim.cmd');
  writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${FAKE}" %*\r\n`);
  const h = setup({ mode: 'hang', cli: shim });
  const t0 = Date.now();
  const r = await K.executeSingleCall({ dir: h.dir, approval: h.approval, env: h.env, testOverrides: T({ killAfterMs: 4_000 }) });
  assert.ok(Date.now() - t0 < 120_000, 'bounded (generous for a loaded machine; the kill itself happens at 4 s)');
  assert.equal(r.verdict!.status, 'error'); assert.match(r.verdict!.reason, /terminated at the hard timeout/);
  const pid = Number(readFileSync(join(h.dir, 'pid.txt'), 'utf8'));
  await new Promise(res => setTimeout(res, 1500));
  let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, `the node process behind the shim (pid ${pid}) is gone`);
  assert.equal(h.runs(), 1);
});

test('a complete run_end is NOT authoritative after a non-zero exit or a timeout: inconclusive, raw results kept', { skip: !chrome && 'no Chrome' }, async () => {
  // complete all-true run_end, then exit code 1
  const a = setup({ mode: 'approve-exit1' });
  const r1 = await K.executeSingleCall({ dir: a.dir, approval: a.approval, env: a.env, testOverrides: T() });
  assert.equal(r1.verdict!.status, 'error', 'never approved after a failed process');
  assert.equal(r1.disagreement, 'kane-inconclusive');
  assert.deepEqual(r1.verdict!.conditionResults, [true, true, true, true, true, true], 'raw condition results preserved');
  assert.match(r1.verdict!.reason, /exited with code 1/); assert.match(r1.verdict!.reason, /NOT authoritative/);
  assert.match(readFileSync(join(r1.runDir!, 'stdout.ndjson'), 'utf8'), /"type":"run_end"/, 'raw run_end kept verbatim');
  const shadow = readFileSync(join(a.dir, 'shadow', 'kane.ndjson'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(shadow.length, 1); assert.equal(shadow[0].status, 'error');
  assert.equal(a.runs(), 1, 'no retry');
  // complete all-true run_end, then the process hangs until the hard timeout
  const b = setup({ mode: 'approve-then-hang' });
  const r2 = await K.executeSingleCall({ dir: b.dir, approval: b.approval, env: b.env, testOverrides: T({ killAfterMs: 4_000 }) });
  assert.equal(r2.verdict!.status, 'error'); assert.equal(r2.disagreement, 'kane-inconclusive');
  assert.equal(r2.verdict!.conditionResults.length, 6);
  assert.match(r2.verdict!.reason, /terminated at the hard timeout/);
  assert.equal(b.runs(), 1, 'no retry');
});

test('a gate refusal explains itself: every version/balance check is recorded, and refusing exits non-zero', { skip: !chrome && 'no Chrome' }, async () => {
  const v = setup({ version: '0.10.7' });
  const r = await K.executeSingleCall({ dir: v.dir, approval: v.approval, env: v.env, testOverrides: T() });
  assert.match(r.refused!, /not the real CLI/);
  const checks = readFileSync(join(v.dir, 'preflight-checks.ndjson'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(checks[0].check, 'version'); assert.equal(checks[0].exitCode, 0); assert.equal(checks[0].parsed, '0.10.7'); assert.match(checks[0].stdout, /0\.10\.7/);
  const src = readFileSync(new URL('../scripts/kane-single-call.ts', import.meta.url), 'utf8');
  const refusedLine = src.split('\n').find(l => l.includes('if (r.refused)')) ?? '';
  assert.ok(refusedLine.includes('process.exitCode = 2'), 'the CLI entry point exits 2 on a gate refusal');
});

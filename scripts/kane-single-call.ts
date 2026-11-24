/**
 * Kane single-call shadow experiment: REVIEWABLE SPEC + GATED RUNNER. PREPARED, NOT RUN.
 *
 *   npm run kane:single-call              dry run (default): verifies the case files, prints the exact plan. No Kane, no network.
 *   npm run kane:single-call -- --execute goes through the existing paid-call gate (server/balance/v4/kanebudget.ts), which is
 *                                          disabled in code (PAID_RESEARCH_EXECUTION = 'disabled'): it records a refusal and
 *                                          stops BEFORE any kane-cli process (version and balance included) is started.
 *
 * Isolation: this is NOT the production referee path (no kaneJudge, no referee cache, no game server). It reuses only the
 * proven generic pieces of server/kane.ts: runCapture (spawn with .cmd handling and Windows process-TREE termination via
 * taskkill /T /F), parseKaneOutput (run_end parsing with condition-count completeness) and kaneConfig().chrome (Chrome path).
 * It shows Kane the saved trial page of ONE historical AI self-play case (evidence/v6/kane-preflight/) and writes only
 * into that directory. No game, referee decision or participant data is involved; the engine decision stays as recorded.
 *
 * Order of a real run (once enabled by the operator):
 *   1. verify case files (hashes); 2. start the loopback page server and a headless Chrome, and WAIT until CDP lists the
 *   page (max 15 s; otherwise stop: no gate entry, no Kane process); 3. the paid-call gate: approval, run-id token, no
 *   previous unresolved overspend, real CLI of the expected version, STRICT balance read (refuse if not unambiguous),
 *   balance >= 1.5 x ceiling; 4. exactly one `kane-cli run --analyzer-only …`, killed as a process tree at 210 s;
 *   5. strict balance read again; 6. parse run_end, require one boolean per condition, append a structured shadow verdict
 *   (incomplete => inconclusive) and keep stdout/stderr verbatim; 7. close Chrome (process tree) and the page server.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import { createServer as createNet } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT } from './v6-fork.ts';
import { runPaidCall, PaidCallRefused, PAID_RESEARCH_EXECUTION, MEASURED_CREDITS_PER_STEP, CAP_WARNING, type PaidApproval, type Deps } from '../server/balance/v4/kanebudget.ts';
import { runCapture, parseKaneOutput, kaneConfig } from '../server/kane.ts';
import { ShadowLog, classify, SHADOW_SCHEMA, type ShadowCase, type KaneShadowVerdict } from '../server/v6/kaneshadow.ts';

export const DIR = join(ROOT, 'evidence/v6/kane-preflight');
/** The CLI version whose output formats (version line, balance line, run_end) were inspected at preflight. */
export const EXPECTED_CLI_VERSION = '0.10.4';
export const PLAN = {
  runId: 'KS1-v6.1-oa-v3-96001-t8',
  mode: 'analyzer' as const,
  calls: 1, retries: 0, parallel: false, followUp: false,
  ceilingCredits: 30,
  /**
   * The gate's estimate formula is steps x MEASURED_CREDITS_PER_STEP (measured in OBJECTIVE mode): 9 x 3.1 = 27.9.
   * NOT ENFORCED: the analyzer invocation takes no objective and performs no agent steps, and no --max-steps is passed;
   * kane-cli 0.10.4 has no credit or spending limit option at all. The 30 credits are a local estimate, not a cap.
   */
  maxStepsForEstimate: 9,
  /** Historical ANALYZER calls cost 5.125 and 9.119 credits (2 and 9 conditions; docs/BALANCE_V2_KANE_RESULT.md). */
  historicalAnalyzerCredits: [5.125, 9.119],
  timeoutS: 180, hardKillAfterS: 210, cdpReadyTimeoutS: 15,
  args: ['run', '--analyzer-only', '--agent', '--cdp-endpoint', '<http://127.0.0.1:PORT of the local headless Chrome>', '--timeout', '180', '--condition', '<condition 1>', '…', '--condition', '<condition 6>'],
  interpretation: [
    'Engine decision (preserved): unverified, tier 3, "a new cell could not be entered in the trial". Not placed.',
    'If Kane approves all six fixed conditions: classified engine-unverified-kane-approved (a DISAGREEMENT). This does NOT show the effect is safe or executable: the trial page has entry scenarios for only 2 of the 3 cells; A1 was never entered.',
    'If Kane rejects any condition: agree-not-approved. If run_end is missing or condition results are incomplete or non-boolean: kane-inconclusive.',
    'A timeout or a non-zero kane-cli exit code makes the attempt inconclusive (error) even if a complete run_end appeared; the raw condition results are kept as evidence only.',
    'Nothing is placed in any case. The six-condition protocol (kane-conditions-v4.1) is used unchanged; the coverage limitation is recorded separately.',
  ],
  stopConditions: [
    'Exactly one kane-cli run process. No retry on any failure, timeout or unparsable output; no second call, no follow-up, nothing in parallel.',
    'Before the gate: case files must match their hashes; Chrome must report the page over CDP within 15 s, otherwise stop with no Kane process and no gate entry.',
    'The gate refuses before starting if: execution disabled in code; no approval / not exactly one call / no acknowledgement that the ceiling is not a hard cap; KANE_PAID_RUN_AUTH is not this run id; the run id already started (ledger); an earlier CEILING_EXCEEDED or SPEND_UNKNOWN not cleared by the operator; CLI version is not exactly 0.10.4; the balance line is missing or ambiguous; balance < 45 (1.5 x ceiling); estimate > ceiling.',
    'kane-cli gets --timeout 180; at 210 s the whole process tree is terminated (taskkill /T /F on Windows). A timeout is NOT a credit limit: credits can be consumed until the process ends.',
    'After the call: strict balance read again. used > 30 => CEILING_EXCEEDED; unreadable => SPEND_UNKNOWN. Either blocks every further paid call until the operator clears it.',
    'Outputs only in evidence/v6/kane-preflight/: the ledger, run/<runId>/ (args, stdout, stderr, meta) and the shadow log (one appended verdict). No game or referee decision changes.',
  ],
};

// ------------------------------------------------------------------ strict CLI output parsing (version-aware)
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
/** The single bare semver line of `kane-cli --version` (update notices are ignored); null if absent or ambiguous. */
export function strictVersion(stdout: string): string | null {
  const v = stripAnsi(stdout).split(/\r?\n/).map(l => l.trim()).filter(l => /^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(l));
  return v.length === 1 ? v[0] : null;
}
/**
 * `kane-cli balance` for CLI 0.10.4 prints exactly one line "Available credits: <number>" (plus optional update notices).
 * Anything else (another version, zero or several balance lines, a non-finite or negative number) => null => refuse.
 */
export function strictBalance(stdout: string, version: string | null): number | null {
  if (version !== EXPECTED_CLI_VERSION && version !== '0.0.0-test-double') return null;
  const m = stripAnsi(stdout).split(/\r?\n/).map(l => l.trim()).map(l => /^Available credits:\s+(\d+(?:\.\d+)?)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
  if (m.length !== 1) return null;
  const n = Number(m[0][1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ------------------------------------------------------------------ case files
export function verifyCase(dir = DIR) {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { files: Record<string, string>; participantData: boolean };
  // LF-normalised, so a Windows checkout with CRLF line endings verifies the same (the files were written with LF)
  const bad = Object.entries(m.files).filter(([f, h]) => createHash('sha256').update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex') !== h).map(([f]) => f);
  if (bad.length) throw new Error(`case files changed since they were built: ${bad.join(', ')}`);
  if (m.participantData !== false) throw new Error('the case must not contain participant data');
  const c = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) as ShadowCase;
  const page = readFileSync(join(dir, 'trial-page.html'), 'utf8').replace(/\r\n/g, '\n');
  const rows = new Set([...page.matchAll(/data-scenario="([^"]+)"/g)].map(x => x[1])).size;
  return { manifest: m, case: c, conditions: (JSON.parse(readFileSync(join(dir, 'conditions.json'), 'utf8')) as { conditions: string[] }).conditions, page, coverage: { cellsProposed: c.placement.cells.length, cellsWithEntryScenario: rows, note: 'The trial entered only the cells listed in its Symmetry table; any other proposed cell was never entered (here A1). Kane judges the six fixed conditions on this page as it is.' } };
}

// ------------------------------------------------------------------ browser with CDP readiness (no fixed sleep)
function freePort(): Promise<number> { return new Promise((res, rej) => { const s = createNet(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); }); }
function killTree(pid: number | undefined, child: { kill: () => void }) {
  if (process.platform === 'win32' && pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
  else child.kill();
}
export type Browser = { url: string; cdp: string; readyMs: number; close: () => Promise<void> };
export async function prepareBrowser(page: string, chrome = process.env.KANE_CHROME || kaneConfig().chrome, readyTimeoutMs = PLAN.cdpReadyTimeoutS * 1000): Promise<Browser> {
  if (!chrome) throw new Error('No Chrome/Chromium found (set KANE_CHROME)');
  const srv = createHttp((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(page); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/ks1-trial.html`;
  const port = await freePort(), profile = mkdtempSync(join(tmpdir(), 'rs-kane-ks1-'));
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), url], { stdio: 'ignore', windowsHide: true });
  let spawnErr: Error | null = null; proc.on('error', e => { spawnErr = e; });
  // Cleanup must never throw: it runs in a finally block after the paid call, and an exception here would hide the
  // recorded spend and the verdict. Wait for Chrome's tree to exit, then remove its temporary profile best-effort.
  const exited = new Promise<void>(r => { if (proc.exitCode !== null) r(); else proc.once('exit', () => r()); });
  const close = async () => {
    killTree(proc.pid, proc);
    await Promise.race([exited, new Promise(r => setTimeout(r, 5_000))]);
    srv.close();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.error(`note: temporary Chrome profile not removed (${(e as Error).message}); it is outside the repository`); }
  };
  const cdp = `http://127.0.0.1:${port}`, t0 = Date.now();
  while (Date.now() - t0 < readyTimeoutMs) {
    if (spawnErr) { await close(); throw new Error(`could not start Chrome: ${(spawnErr as Error).message}`); }
    try { const pages = await (await fetch(`${cdp}/json/list`)).json() as { url: string; type: string }[]; if (pages.some(p => p.type === 'page' && p.url === url)) return { url, cdp, readyMs: Date.now() - t0, close }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  await close();
  throw new Error(`Chrome did not report the trial page over CDP within ${readyTimeoutMs} ms`);
}

// ------------------------------------------------------------------ the run
const note = (dir: string, check: string, r: { code: number | null; timedOut: boolean; ms: number; stdout: string; stderr: string }, parsed: unknown) =>
  appendFileSync(join(dir, 'preflight-checks.ndjson'), JSON.stringify({ at: new Date().toISOString(), check, cli: process.env.KANE_CLI || 'kane-cli', exitCode: r.code, timedOut: r.timedOut, ms: r.ms, parsed, stdout: r.stdout.slice(0, 600), stderr: r.stderr.slice(0, 600) }) + '\n');
export type RunOutcome = { refused: string | null; spend: unknown; verdict: KaneShadowVerdict | null; disagreement: string | null; runDir: string | null };
export async function executeSingleCall(o: {
  dir?: string; approval: PaidApproval | null; env?: Record<string, string | undefined>;
  /** TEST ONLY: lets tests exercise the full path with the repo's kane-cli test double. The CLI entry point never sets these. */
  testOverrides?: { mode: 'per-run-approval'; allowTestDouble: true; chrome?: string; killAfterMs?: number };
}): Promise<RunOutcome> {
  const dir = o.dir ?? DIR, c = verifyCase(dir), runDir = join(dir, 'run', PLAN.runId);
  const capture = (args: string[], ms: number) => runCapture(args, ms);
  let version: string | null = null;
  const browser = await prepareBrowser(c.page, o.testOverrides?.chrome);
  const out = { stdout: '', stderr: '', code: null as number | null, timedOut: false, ms: 0, firstOutputMs: null as number | null, runEndMs: null as number | null, args: [] as string[] };
  const deps: Deps = {
    ledgerFile: join(dir, 'ledger.ndjson'), env: o.env ?? process.env, ...(o.testOverrides ? { mode: o.testOverrides.mode } : {}),
    // Every metadata check is recorded verbatim (exit code, timeout, time, output excerpts) in preflight-checks.ndjson, so a
    // refusal can be explained afterwards. The KS1 manual attempt of 2026-11-22 was refused at this check with no record of why.
    // 60 s per check: kane-cli may perform an update check over the network before answering.
    isRealCli: async () => { const r = await capture(['--version'], 60_000); version = r.code === 0 ? strictVersion(r.stdout) : null; note(dir, 'version', r, version); return version === EXPECTED_CLI_VERSION || (!!o.testOverrides?.allowTestDouble && version === '0.0.0-test-double'); },
    balance: async () => { const r = await capture(['balance'], 60_000); const b = r.code === 0 ? strictBalance(r.stdout, version) : null; note(dir, 'balance', r, b); return b; },
    exec: async (_steps, timeoutS) => {
      out.args = ['run', '--analyzer-only', '--agent', '--cdp-endpoint', browser.cdp, '--timeout', String(timeoutS), ...c.conditions.flatMap(x => ['--condition', x])];
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'args.json'), JSON.stringify({ cli: process.env.KANE_CLI || 'kane-cli', version, args: out.args, startedAt: new Date().toISOString() }, null, 1) + '\n');
      const r = await capture(out.args, o.testOverrides?.killAfterMs ?? PLAN.hardKillAfterS * 1000);
      Object.assign(out, r);
      writeFileSync(join(runDir, 'stdout.ndjson'), r.stdout); writeFileSync(join(runDir, 'stderr.txt'), r.stderr);
      return { timedOut: r.timedOut, exitCode: r.code };
    },
  };
  let spend: unknown = null;
  try { spend = await runPaidCall(o.approval, { maxSteps: PLAN.maxStepsForEstimate, timeoutS: PLAN.timeoutS }, deps); }
  catch (e) { if (e instanceof PaidCallRefused) return { refused: e.reason, spend: null, verdict: null, disagreement: null, runDir: null }; throw e; }
  finally { await browser.close(); }
  // Structured verdict. AUTHORITATIVE (approved / rejected) only when ALL hold: the process exited normally with code 0,
  // was not terminated at the timeout, and run_end carries one boolean per condition. A timeout or a non-zero exit is
  // ALWAYS 'error' (inconclusive), even if a complete run_end appeared in stdout; the raw condition results are kept.
  // Anything else incomplete is 'unverified' (inconclusive). Never approved by default.
  const p = parseKaneOutput(out.stdout, c.conditions.length, 'analyzer');
  const processFailed = out.timedOut || out.code !== 0;
  const status: KaneShadowVerdict['status'] = processFailed ? 'error' : (p.verdict ?? 'unverified');
  const failure = out.timedOut ? 'process tree terminated at the hard timeout' : `kane-cli exited with code ${out.code}`;
  const verdict: KaneShadowVerdict = {
    schema: SHADOW_SCHEMA, kind: 'kane', caseId: c.case.caseId, at: new Date().toISOString(), status,
    reason: processFailed
      ? `inconclusive: ${failure}${p.verdict ? `; a complete run_end was present (would have read as ${p.verdict}) but is NOT authoritative after a failed process; raw condition results kept` : `; ${p.detail}`}`
      : p.verdict ? `run_end with ${p.results.length}/${c.conditions.length} boolean condition results, exit code 0` : `inconclusive: ${p.detail}`,
    conditionResults: p.results, elapsedMs: out.ms, kaneVersion: version, evidencePath: runDir, testDouble: version !== EXPECTED_CLI_VERSION,
  };
  const log = new ShadowLog(join(dir, 'shadow'));
  if (!log.read().cases.some(x => x.caseId === c.case.caseId)) log.addCase(c.case, c.page);
  log.addVerdict(verdict);
  const disagreement = classify(c.case.engine, verdict);
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify({ runId: PLAN.runId, caseId: c.case.caseId, exitCode: out.code, timedOut: out.timedOut, ms: out.ms, firstOutputMs: out.firstOutputMs, runEndMs: out.runEndMs, cdpReadyMs: browser.readyMs, spend, verdict, disagreement, conditionReasons: p.reasons, coverage: c.coverage, interpretation: PLAN.interpretation }, null, 1) + '\n');
  return { refused: null, spend, verdict, disagreement, runDir };
}

if (process.argv[1]?.endsWith('kane-single-call.ts')) {
  const c = verifyCase();
  const execute = process.argv.includes('--execute');
  const estimate = Math.round(PLAN.maxStepsForEstimate * MEASURED_CREDITS_PER_STEP * 10) / 10;
  console.log(JSON.stringify({ mode: execute ? 'EXECUTE (gated)' : 'DRY RUN', execution: PAID_RESEARCH_EXECUTION, caseId: c.case.caseId, engine: c.case.engine.final, placement: c.case.placement, coverage: c.coverage, conditions: c.conditions.length, plan: PLAN, localEstimateCredits: estimate, estimateEnforced: false, warning: CAP_WARNING }, null, 1));
  if (execute) {
    const approvalFile = join(DIR, 'approval.json');
    const approval = existsSync(approvalFile) ? JSON.parse(readFileSync(approvalFile, 'utf8')) as PaidApproval : null;
    // The gate is checked BEFORE the browser starts: while execution is disabled nothing at all is launched.
    if (PAID_RESEARCH_EXECUTION === 'disabled') { console.log('REFUSED before any process started: paid research execution is disabled in this workstream (PAID_RESEARCH_EXECUTION)'); process.exitCode = 2; }
    else {
      const r = await executeSingleCall({ approval });
      console.log(JSON.stringify(r, null, 1));
      // a gate refusal is a failure of the attempt: exit 2 (the 2026-11-22 attempt wrongly exited 0)
      if (r.refused) { console.log(`REFUSED by the gate before any Kane run: ${r.refused}`); process.exitCode = 2; }
      else if (r.verdict && r.verdict.status !== 'approved' && r.verdict.status !== 'rejected') process.exitCode = 3; // ran, inconclusive
    }
  }
  writeFileSync(join(DIR, 'plan.json'), JSON.stringify({ runId: PLAN.runId, caseId: c.case.caseId, plan: PLAN, coverage: c.coverage, localEstimateCredits: estimate, estimateEnforced: false, estimateIsNotAHardLimit: true, warning: CAP_WARNING }, null, 1) + '\n');
}

/**
 * Kane single-call shadow experiment: REVIEWABLE SPEC + GATED RUNNER. PREPARED, NOT RUN.
 *
 *   npm run kane:single-call              dry run (default): verifies the case files, prints the exact plan. No Kane, no network.
 *   npm run kane:single-call -- --execute refused in this build: goes through the existing paid-call gate
 *                                          (server/balance/v4/kanebudget.ts), which is disabled in code
 *                                          (PAID_RESEARCH_EXECUTION = 'disabled'), so it records a refusal and stops
 *                                          BEFORE starting any process, kane-cli --version included.
 *
 * Isolation: this does NOT use the production referee path (server/kane.ts kaneJudge, cache, game server). It shows Kane
 * the saved trial page of ONE historical AI self-play case (evidence/v6/kane-preflight/, built by
 * scripts/kane-preflight-case.ts), and its only output is one appended record in that directory. No game, no referee
 * decision and no participant data is involved; the engine decision stays as recorded.
 *
 * Enabling a real run requires, all reviewed by the operator: (1) a code change setting PAID_RESEARCH_EXECUTION to
 * 'per-run-approval' for this run, (2) approval.json with the fields of PaidApproval (maxCalls 1, ceilingCredits <= 30,
 * acknowledgesNoHardCap true), (3) KANE_PAID_RUN_AUTH = its runId, (4) the final preflight checklist in
 * docs/KANE_SINGLE_CALL_PREFLIGHT.md completed (CLI version, login, balance, analyzer flags, metering).
 */
import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT } from './v6-fork.ts';
import { runPaidCall, PaidCallRefused, PAID_RESEARCH_EXECUTION, MEASURED_CREDITS_PER_STEP, CAP_WARNING, type PaidApproval, type Deps } from '../server/balance/v4/kanebudget.ts';

export const DIR = join(ROOT, 'evidence/v6/kane-preflight');
export const PLAN = {
  runId: 'KS1-v6.1-oa-v3-96001-t8',
  mode: 'analyzer' as const,
  calls: 1, retries: 0, parallel: false, followUp: false,
  ceilingCredits: 30,
  /** kanebudget's estimate formula is steps x MEASURED_CREDITS_PER_STEP (measured in OBJECTIVE mode). 9 x 3.1 = 27.9. */
  maxStepsForEstimate: 9,
  /** Historical ANALYZER calls cost 5.125-9.119 credits (2-9 conditions; docs/BALANCE_V2_KANE_RESULT.md, BALANCE_LOOP_RESULT.md). */
  historicalAnalyzerCredits: [5.125, 9.119, 11.841 / 2],
  timeoutS: 180, hardKillAfterS: 210,
  argsTemplate: ['run', '--analyzer-only', '--agent', '--cdp-endpoint', '<local headless Chrome CDP endpoint>', '--timeout', '180', '--condition', '<condition 1 of 6>', '…', '--condition', '<condition 6 of 6>'],
  stopConditions: [
    'Exactly one kane-cli run process. No retry on any failure, timeout or unparsable output; no second call, no follow-up, nothing in parallel.',
    'Refuse before starting if: execution disabled in code; no approval / wrong run id; run id already started (ledger); a previous call exceeded or has unknown spend without operator clearance; the CLI is not the real CLI; balance unreadable; balance < 1.5 x ceiling (45); estimate > ceiling.',
    `The process is killed at ${210} s (CLI --timeout 180 s + 30 s). A timeout is NOT a credit limit: credits can be consumed until the process ends.`,
    'After the call: balance is read again. used > 30 => CEILING_EXCEEDED; unreadable => SPEND_UNKNOWN. Either blocks every further paid call until the operator clears it.',
    'The verdict (or error) is appended to evidence/v6/kane-preflight/kane-verdict.ndjson. Nothing else is written; no game or referee decision changes.',
  ],
};

function verifyCase() {
  const m = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { files: Record<string, string>; participantData: boolean; source: unknown };
  // LF-normalised, so a Windows checkout with CRLF line endings verifies the same (the files were written with LF)
  const bad = Object.entries(m.files).filter(([f, h]) => createHash('sha256').update(readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex') !== h).map(([f]) => f);
  if (bad.length) throw new Error(`case files changed since they were built: ${bad.join(', ')}`);
  if (m.participantData !== false) throw new Error('the case must not contain participant data');
  return { manifest: m, case: JSON.parse(readFileSync(join(DIR, 'case.json'), 'utf8')), conditions: (JSON.parse(readFileSync(join(DIR, 'conditions.json'), 'utf8')) as { conditions: string[] }).conditions, page: readFileSync(join(DIR, 'trial-page.html'), 'utf8') };
}

const cli = process.env.KANE_CLI || 'kane-cli';
const sh = process.platform === 'win32';
export function realDeps(ledgerFile: string, page: string, conditions: string[], out: { stdout: string; stderr: string; args: string[] }): Deps {
  return {
    ledgerFile, env: process.env,
    isRealCli: async () => { const r = spawnSync(cli, ['--version'], { encoding: 'utf8', shell: sh, timeout: 15000 }); return r.status === 0 && !/test-double|gate-test/.test(r.stdout); },
    balance: async () => { const r = spawnSync(cli, ['balance'], { encoding: 'utf8', shell: sh, timeout: 30000 }); const m = /([0-9]+(?:\.[0-9]+)?)/.exec((r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '')); return r.status === 0 && m ? Number(m[1]) : null; },
    exec: async (_maxSteps, timeoutS) => {
      const srv = createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); });
      await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
      const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
      const profile = mkdtempSync(join(tmpdir(), 'rs-kane-ks1-')), port = 9300 + Math.floor(Math.random() * 500);
      const chrome = spawn(process.env.KANE_CHROME || 'chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', url], { stdio: 'ignore', windowsHide: true });
      await new Promise(r => setTimeout(r, 3000));
      out.args = ['run', '--analyzer-only', '--agent', '--cdp-endpoint', `http://127.0.0.1:${port}`, '--timeout', String(timeoutS), ...conditions.flatMap(c => ['--condition', c])];
      try {
        return await new Promise(res => {
          const child = spawn(cli, out.args, { shell: sh, stdio: ['ignore', 'pipe', 'pipe'] });
          let timedOut = false;
          const kill = setTimeout(() => { timedOut = true; child.kill(); }, PLAN.hardKillAfterS * 1000);
          child.stdout.on('data', d => { out.stdout += d; }); child.stderr.on('data', d => { out.stderr += d; });
          child.on('close', code => { clearTimeout(kill); res({ timedOut, exitCode: code }); });
        });
      } finally { chrome.kill(); srv.close(); rmSync(profile, { recursive: true, force: true }); }
    },
  };
}

if (process.argv[1]?.endsWith('kane-single-call.ts')) {
  const c = verifyCase();
  const execute = process.argv.includes('--execute');
  const estimate = Math.round(PLAN.maxStepsForEstimate * MEASURED_CREDITS_PER_STEP * 10) / 10;
  console.log(JSON.stringify({ mode: execute ? 'EXECUTE (gated)' : 'DRY RUN', execution: PAID_RESEARCH_EXECUTION, caseId: c.case.caseId, engine: c.case.engine, placement: c.case.placement, conditions: c.conditions.length, plan: PLAN, localEstimateCredits: estimate, warning: CAP_WARNING }, null, 1));
  if (execute) {
    const approvalFile = join(DIR, 'approval.json');
    const approval = existsSync(approvalFile) ? JSON.parse(readFileSync(approvalFile, 'utf8')) as PaidApproval : null;
    const out = { stdout: '', stderr: '', args: [] as string[] };
    try {
      const end = await runPaidCall(approval, { maxSteps: PLAN.maxStepsForEstimate, timeoutS: PLAN.timeoutS }, realDeps(join(DIR, 'ledger.ndjson'), c.page, c.conditions, out));
      appendFileSync(join(DIR, 'kane-verdict.ndjson'), JSON.stringify({ caseId: c.case.caseId, at: new Date().toISOString(), spend: end, args: out.args, stdout: out.stdout, stderr: out.stderr.slice(0, 4000) }) + '\n');
      console.log(JSON.stringify(end));
    } catch (e) {
      if (e instanceof PaidCallRefused) { console.log(`REFUSED before any process started: ${e.reason}`); process.exitCode = 2; }
      else throw e;
    }
  }
  writeFileSync(join(DIR, 'plan.json'), JSON.stringify({ runId: PLAN.runId, caseId: c.case.caseId, plan: PLAN, localEstimateCredits: estimate, estimateIsNotAHardLimit: true, warning: CAP_WARNING }, null, 1) + '\n');
}

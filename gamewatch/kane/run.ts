/**
 * GameWatch blind Kane review: GATED RUNNER (one objective-mode call). Reuses the verified pieces of the KS1 path:
 * runCapture (process-tree kill) and parseKaneOutput from server/kane.ts, strictVersion / strictBalance from
 * scripts/kane-single-call.ts, and the paid-call gate runPaidCall from server/balance/v4/kanebudget.ts, which refuses while
 * PAID_RESEARCH_EXECUTION is 'disabled' in code (it is, in every commit) and otherwise needs a single-use approval file
 * and KANE_PAID_RUN_AUTH = the run id, exactly as for KS1.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/kane/run.ts            dry run: plan + frozen-input check, no Kane
 *   node --experimental-strip-types --no-warnings gamewatch/kane/run.ts --execute  gated: refuses unless the operator enabled it
 *
 * Exit codes: 0 Kane ran and at least one valid finding was stored · 2 refused before any Kane process · 3 Kane ran but
 * produced no valid finding or the process failed (inconclusive) · 1 frozen inputs changed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../builds.ts';
import { PLAN, OBJECTIVE } from './plan-data.ts';
import { startServer } from './serve.ts';
import { runPaidCall, PaidCallRefused, PAID_RESEARCH_EXECUTION, CAP_WARNING, type PaidApproval, type Deps } from '../../server/balance/v4/kanebudget.ts';
import { runCapture, parseKaneOutput } from '../../server/kane.ts';
import { strictVersion, strictBalance, EXPECTED_CLI_VERSION } from '../../scripts/kane-single-call.ts';

const DIR = join(ROOT, 'evidence/gamewatch/review');
const RUN = join(DIR, 'run', PLAN.runId);
const NOTES = join(DIR, 'notes.ndjson');
const PORT = 3210;

function frozenOk(): string[] {
  // The operator's freeze check (private) is optional: a standalone GameWatch user has no private ground truth.
  const f = join(ROOT, 'gamewatch/private/FREEZE.json');
  if (!existsSync(f)) return [];
  const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'gamewatch/kane/plan.ts')], { encoding: 'utf8' });
  const j = JSON.parse(out);
  return j.frozenInputs.ok ? [] : j.frozenInputs.changed;
}

const changed = frozenOk();
console.log(JSON.stringify({ mode: process.argv.includes('--execute') ? 'EXECUTE (gated)' : 'DRY RUN', execution: PAID_RESEARCH_EXECUTION, expectedCli: EXPECTED_CLI_VERSION, plan: PLAN, frozenInputsChanged: changed, warning: CAP_WARNING }, null, 1));
if (changed.length) { console.log(`STOP: frozen inputs changed: ${changed.join(', ')}`); process.exit(1); }
if (!process.argv.includes('--execute')) process.exit(0);
if (existsSync(join(RUN, 'meta.json'))) {
  // One call only: if this run id already ran, report the recorded result and never call again.
  const m = JSON.parse(readFileSync(join(RUN, 'meta.json'), 'utf8'));
  console.log(`${PLAN.runId} already ran (${m.findingsValid} valid findings, exit ${m.exitCode}); using the recorded result, no new call`);
  process.exit(!m.timedOut && m.exitCode === 0 && m.findingsValid ? 0 : 3);
}
if (PAID_RESEARCH_EXECUTION === 'disabled') { console.log('REFUSED before any process started: paid research execution is disabled (PAID_RESEARCH_EXECUTION)'); process.exit(2); }

const approvalFile = join(DIR, 'approval.json');
const approval = existsSync(approvalFile) ? JSON.parse(readFileSync(approvalFile, 'utf8')) as PaidApproval : null;
const server = await startServer({ port: PORT, site: join(ROOT, 'evidence/gamewatch/site'), notes: NOTES, label: 'kane' });
const before = existsSync(NOTES) ? readFileSync(NOTES, 'utf8').split('\n').filter(Boolean).length : 0;
let version: string | null = null;
const out = { stdout: '', code: null as number | null, timedOut: false, ms: 0 };
const deps: Deps = {
  ledgerFile: join(DIR, 'ledger.ndjson'), env: process.env,
  isRealCli: async () => { const r = await runCapture(['--version'], 60_000); version = r.code === 0 ? strictVersion(r.stdout) : null; return version === EXPECTED_CLI_VERSION; },
  balance: async () => { const r = await runCapture(['balance'], 60_000); return r.code === 0 ? strictBalance(r.stdout, version) : null; },
  exec: async (maxSteps, timeoutS) => {
    const args = ['run', OBJECTIVE, '--url', `http://127.0.0.1:${PORT}/index.html`, '--agent', '--headless', '--max-steps', String(maxSteps), '--timeout', String(timeoutS)];
    mkdirSync(RUN, { recursive: true });
    writeFileSync(join(RUN, 'args.json'), JSON.stringify({ cli: process.env.KANE_CLI || 'kane-cli', version, args, nonce: server.nonce, startedAt: new Date().toISOString() }, null, 1) + '\n');
    const r = await runCapture(args, (timeoutS + 30) * 1000);
    Object.assign(out, { stdout: r.stdout, code: r.code, timedOut: r.timedOut, ms: r.ms });
    writeFileSync(join(RUN, 'stdout.ndjson'), r.stdout); writeFileSync(join(RUN, 'stderr.txt'), r.stderr);
    return { timedOut: r.timedOut, exitCode: r.code };
  },
};
let spend: unknown = null;
try { spend = await runPaidCall(approval, { maxSteps: PLAN.maxSteps, timeoutS: PLAN.timeoutS }, deps); }
catch (e) { await server.close(); if (e instanceof PaidCallRefused) { console.log(`REFUSED by the gate before any Kane run: ${e.reason}`); process.exit(2); } throw e; }
await server.close();
const notes = existsSync(NOTES) ? readFileSync(NOTES, 'utf8').split('\n').filter(Boolean).slice(before).map(l => JSON.parse(l)) : [];
const valid = notes.filter(n => n.nonceValid && n.source === 'kane');
const p = parseKaneOutput(out.stdout, 1, 'objective');
const meta = { runId: PLAN.runId, exitCode: out.code, timedOut: out.timedOut, ms: out.ms, spend, runEnd: { verdict: p.verdict, summary: p.reasons[0] ?? null, detail: p.detail }, findingsSubmitted: notes.length, findingsValid: valid.length, kaneVersion: version };
writeFileSync(join(RUN, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(JSON.stringify(meta, null, 1));
process.exit(!out.timedOut && out.code === 0 && valid.length ? 0 : 3);

/**
 * GW2 matched comparison: the Kane runner (D143). Every call goes through the UNCHANGED paid-call gate
 * (server/balance/v4/kanebudget.ts runPaidCall / checkPaidCall): per-run approval file <run>/approvals/<runId>.json,
 * KANE_PAID_RUN_AUTH = runId, the real pinned CLI, a readable balance >= 1.5 x ceiling, estimate <= ceiling, no retry
 * of a run id, and a stop after any CEILING_EXCEEDED / SPEND_UNKNOWN until an operator clears it. While
 * PAID_RESEARCH_EXECUTION is 'disabled' (it is), and while its scope names only the P7 pilot ids, preflight refuses
 * before any process or server starts. Enabling the gate for the GW2-M<nn>-P<phase> ids is a separate, reviewed commit.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { kaneArgv } from '../p7-plan.ts';
import { strictVersion, strictBalance } from '../../../scripts/kane-single-call.ts';
import { runCapture } from '../../../server/kane.ts';
import { runPaidCall, checkPaidCall, PaidCallRefused, PAID_RESEARCH_EXECUTION, type Deps, type PaidApproval } from '../../../server/balance/v4/kanebudget.ts';
import { MATCHED } from './params.ts';
import type { Runner, CallRequest } from './pipeline.ts';

/** The process transport: runs kane-cli with argv. Tests replace it (mocked transport) to exercise this boundary. */
export type Transport = (argv: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

export function kaneRunner(run: string, o: { mode?: Deps['mode']; scope?: Deps['scope']; probe?: Pick<Deps, 'isRealCli' | 'balance'>; exec?: Deps['exec']; transport?: Transport } = {}): Runner {
  const transport: Transport = o.transport ?? (async (argv, ms) => runCapture(argv, ms));
  const ledgerFile = join(run, 'kane-ledger.ndjson');
  let version: string | null = null;
  const probe = o.probe ?? {
    isRealCli: async () => { const r = await transport(['--version'], 60_000); version = r.code === 0 ? strictVersion(r.stdout) : null; return version === MATCHED.cli.version; },
    balance: async () => { const r = await transport(['balance'], 60_000); return r.code === 0 ? strictBalance(r.stdout, version) : null; },
  };
  const seams = o.mode !== undefined ? { mode: o.mode, scope: o.scope ?? null } : {};
  const approval = (runId: string) => { const f = join(run, 'approvals', `${runId}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as PaidApproval : null; };
  return {
    kind: 'kane', gateMode: o.mode ?? PAID_RESEARCH_EXECUTION,
    async preflight(r) {
      try { await checkPaidCall(approval(r.runId), { maxSteps: r.maxSteps, timeoutS: r.timeoutS }, { ledgerFile, env: process.env, ...seams, ...probe, exec: async () => { throw new Error('unreachable'); } }); return null; }
      catch (e) { if (e instanceof PaidCallRefused) return e.reason; throw e; }
    },
    async run(r: CallRequest) {
      const startedAt = new Date().toISOString(), out = { stdout: '', stderr: '' }, args = kaneArgv(r.port, { objective: r.objective, maxSteps: r.maxSteps, timeoutS: r.timeoutS });
      const end = await runPaidCall(approval(r.runId), { maxSteps: r.maxSteps, timeoutS: r.timeoutS }, { ledgerFile, env: process.env, ...seams, ...probe,
        exec: o.exec ?? (async () => { const x = await transport(args, (r.timeoutS + 30) * 1000); out.stdout = x.stdout; out.stderr = x.stderr; return { timedOut: x.timedOut, exitCode: x.code }; }) });
      return { exitCode: end.exitCode, timedOut: end.timedOut, stdout: out.stdout, stderr: out.stderr || String(end.error ?? ''), args: { cli: 'kane-cli', version: version ?? (o.probe ? 'probe-seam' : null), args, startedAt },
        spend: { used: end.used, before: end.before, after: end.after, outcome: end.outcome as any } };
    },
  };
}

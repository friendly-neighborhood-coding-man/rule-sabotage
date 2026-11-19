/**
 * Balance Designer V4: Kane credit safety for RESEARCH calls (balance loops V2/V3/V4: kaneExplore, kaneVerify).
 *
 * Facts this module is built on (V3 KX3, journalled): one objective-mode call consumed 107.934 credits against an
 * 80-credit operating ceiling. kane-cli 0.10.4 exposes --max-steps and --timeout but no spending limit, and the
 * balance can only be read before and after a call. So the only enforceable bounds are steps and time; a credit
 * "ceiling" is a LOCAL ESTIMATE and can be exceeded before the CLI returns. This module never calls it a hard cap.
 *
 *  - Paid research calls are DISABLED by default and, in this workstream, disabled outright
 *    (PAID_RESEARCH_EXECUTION = 'disabled'): no environment variable or approval file can turn them on. Re-enabling
 *    is a code change plus a per-run operator approval, reviewed in a PR.
 *  - Even when enabled, a call needs: a per-run approval record naming exactly one call, the local estimate and an
 *    explicit acknowledgement that the ceiling is not a hard cap; a matching single-use token; a readable balance
 *    before the call; an estimate (measured cost per step x max steps) at or below the ceiling. No retries, no
 *    follow-up calls: the ledger locks the run id the moment a call starts.
 *  - After the call the real balance delta is recorded; exceeding the ceiling is recorded as CEILING_EXCEEDED
 *    (a failed requirement, not an estimation footnote) and blocks every further paid call until an operator clears it.
 *  - The game-server referee (kaneJudge) is a separate PRODUCTION path and is not gated here (see docs).
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const PAID_RESEARCH_EXECUTION: 'disabled' | 'per-run-approval' = 'disabled';
/** Measured in V3 KX3: 107.934 credits / 35 steps max (run_end 103.232). Used for the LOCAL estimate only. */
export const MEASURED_CREDITS_PER_STEP = 3.1;
export const CAP_KIND = 'local-estimate-not-enforced' as const;
export const CAP_WARNING = 'kane-cli offers no provider-side or CLI spending limit. The credit ceiling is a LOCAL ESTIMATE from steps x measured cost per step; one call can consume more before it returns (V3: 107.9 against 80).';

export type PaidApproval = { runId: string; approvedBy: string; approvedAt: string; maxCalls: 1; maxSteps: number; ceilingCredits: number; acknowledgesNoHardCap: true };
export type LedgerEntry = { at: string; runId: string; event: 'call-start' | 'call-end' | 'refused' | 'operator-clear'; detail: Record<string, unknown> };
export type Deps = {
  ledgerFile: string; env: Record<string, string | undefined>; now?: () => string;
  isRealCli: () => Promise<boolean>; balance: () => Promise<number | null>;
  exec: (maxSteps: number, timeoutS: number) => Promise<{ timedOut: boolean; exitCode: number | null }>;
  mode?: typeof PAID_RESEARCH_EXECUTION;
};
/** Set only while runPaidCall's exec runs. kaneExplore / kaneVerify refuse a REAL kane-cli run without it. */
let paidToken: string | null = null;
export const paidCallTokenActive = () => paidToken !== null;
/**
 * The repo's own kane-cli test double can report a fake 'real-looking' version so the V2 gate tests can exercise
 * post-call stop rules; those fixture versions end in '-gate-test', which the real kane-cli never reports. Only
 * they bypass the paid-call gate. Any other version (e.g. 0.10.4) is treated as the real, paid CLI.
 */
export const isGateTestFixture = (version: string | null) => !!version && /-gate-test$/.test(version);
export class PaidCallRefused extends Error { reason: string; constructor(reason: string) { super(`Paid Kane call refused: ${reason}`); this.reason = reason; } }

export function readLedger(file: string): LedgerEntry[] { return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []; }
function append(file: string, e: LedgerEntry) { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(e) + '\n'); }

/** Every check that must pass BEFORE any process is started. Throws PaidCallRefused (and records the refusal). */
export async function checkPaidCall(a: PaidApproval | null, plan: { maxSteps: number; timeoutS: number }, d: Deps): Promise<{ before: number; estimate: number }> {
  const now = d.now ?? (() => new Date().toISOString());
  const refuse = (reason: string): never => { append(d.ledgerFile, { at: now(), runId: a?.runId ?? '-', event: 'refused', detail: { reason } }); throw new PaidCallRefused(reason); };
  if ((d.mode ?? PAID_RESEARCH_EXECUTION) === 'disabled') refuse('paid research execution is disabled in this workstream (PAID_RESEARCH_EXECUTION)');
  if (!a) refuse('no per-run approval record');
  if (a!.maxCalls !== 1) refuse('an approval covers exactly one call');
  if (a!.acknowledgesNoHardCap !== true) refuse('the approval must acknowledge that the credit ceiling is not a hard cap');
  if (d.env.KANE_PAID_RUN_AUTH !== a!.runId) refuse('KANE_PAID_RUN_AUTH does not name this run');
  if (plan.maxSteps > a!.maxSteps) refuse(`plan uses ${plan.maxSteps} steps, approval allows ${a!.maxSteps}`);
  const ledger = readLedger(d.ledgerFile);
  const lastExceed = ledger.filter(e => e.event === 'call-end' && (e.detail.outcome === 'CEILING_EXCEEDED' || e.detail.outcome === 'SPEND_UNKNOWN')).pop();
  if (lastExceed && !ledger.some(e => e.event === 'operator-clear' && e.at > lastExceed.at)) refuse(`a previous call (${lastExceed.runId}) exceeded its ceiling or has an unknown spend; an operator must clear it first`);
  if (ledger.some(e => e.runId === a!.runId && e.event === 'call-start')) refuse(`run ${a!.runId} already started a call: no retries or follow-up calls`);
  if (!(await d.isRealCli())) refuse('kane-cli is not the real CLI');
  const before = await d.balance();
  if (before === null) refuse('credit balance unavailable before the call');
  const estimate = Math.round(plan.maxSteps * MEASURED_CREDITS_PER_STEP * 10) / 10;
  if (estimate > a!.ceilingCredits) refuse(`local estimate ${estimate} (= ${plan.maxSteps} steps x ${MEASURED_CREDITS_PER_STEP}) exceeds the ${a!.ceilingCredits}-credit ceiling`);
  if (before! < a!.ceilingCredits * 1.5) refuse(`balance ${before} is below 1.5x the ceiling`);
  return { before: before!, estimate };
}

/** One paid call with accurate before/after records. Never retries. */
export async function runPaidCall(a: PaidApproval | null, plan: { maxSteps: number; timeoutS: number }, d: Deps) {
  const now = d.now ?? (() => new Date().toISOString());
  const { before, estimate } = await checkPaidCall(a, plan, d);
  append(d.ledgerFile, { at: now(), runId: a!.runId, event: 'call-start', detail: { before, estimate, ceiling: a!.ceilingCredits, capKind: CAP_KIND, warning: CAP_WARNING, maxSteps: plan.maxSteps, timeoutS: plan.timeoutS } });
  let r: { timedOut: boolean; exitCode: number | null } = { timedOut: false, exitCode: null }, error: string | null = null;
  paidToken = a!.runId;
  try { r = await d.exec(plan.maxSteps, plan.timeoutS); } catch (e) { error = (e as Error).message; } finally { paidToken = null; }
  const after = await d.balance().catch(() => null);
  const used = after === null ? null : Math.round((before - after) * 1000) / 1000;
  const outcome = used === null ? 'SPEND_UNKNOWN' : used > a!.ceilingCredits ? 'CEILING_EXCEEDED' : 'WITHIN_CEILING';
  const end = { before, after, used, estimate, ceiling: a!.ceilingCredits, outcome, timedOut: r.timedOut, exitCode: r.exitCode, error, capKind: CAP_KIND };
  append(d.ledgerFile, { at: now(), runId: a!.runId, event: 'call-end', detail: end });
  return end;
}

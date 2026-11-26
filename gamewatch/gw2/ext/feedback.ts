/**
 * GW2 Extension V1: RUNTIME activation of agent-facing hypothesis–observation feedback (D125, D131). Prepared, not enabled.
 *
 * activateAgentFeedback refuses unless ALL of these hold, checked before any evidence is read:
 *   1. AGENT_FEEDBACK_ENABLED is true (it is false; changing it is a reviewed code change of its own);
 *   2. an authorization is given for the treatment arm and phase 2, naming the anchored pre-registration by its sha256;
 *   3. that pre-registration lists exactly this {runId, session, arm, phase} among its feedback runs (D138), and the
 *      feedback being built is for that session and phase.
 * Only then are the authenticated inputs loaded (feedback-core.ts agentInputs: graph prefix, discovery, bound feedback
 * partition). servableFeedbackPage refuses anything marked testOnly. This module does not import feedback-testonly.ts.
 * Nothing serves these pages yet; a future authorized run would serve them after freeze-1, logged in the access journal,
 * from a staging directory that is never the blind site.
 */
import { agentFeedbackCore, agentInputs, renderAgentFeedback, type AgentFeedback, type AgentPartition } from './feedback-core.ts';
import { anchoredPrereg, defaultRecord } from './anchored.ts';
import { AccessRefused } from './errors.ts';

export const AGENT_FEEDBACK_ENABLED = false;
/** D138: an authorization names exactly one run: run id, (logical) session, arm, phase and the pre-registration hash. */
export type Authorization = { runId: string; session: string; arm: string; phase: number; preregSha256: string; operatorAuthorization: string };
export const FEEDBACK_PHASE = 2;

/**
 * Pure: why activation is refused (empty = allowed). The pre-registration must list, under plan.agentFeedback.runs, an
 * entry equal to {runId, session, arm, phase} of the authorization; `request` (what is about to be built) must name the
 * same session and phase. Any mismatch in any of the five bound values refuses.
 */
export function activationProblems(enabled: boolean, auth: Authorization | undefined, prereg: { preregSha256: string; prereg: any } | null, request?: { session: string; phase: number }): string[] {
  const p: string[] = [];
  if (!enabled) p.push('agent-facing feedback is not enabled (AGENT_FEEDBACK_ENABLED = false)');
  if (!auth) { p.push('no authorization given'); return p; }
  if (auth.arm !== 'treatment') p.push(`feedback is shown only in the treatment arm, not "${auth.arm}"`);
  if (auth.phase !== FEEDBACK_PHASE) p.push(`feedback is shown only before phase ${FEEDBACK_PHASE}, not phase ${auth.phase}`);
  if (!auth.operatorAuthorization?.trim()) p.push('the authorization names no written operator authorization');
  if (request && (request.session !== auth.session || request.phase !== auth.phase)) p.push(`the authorization is for session ${auth.session} phase ${auth.phase}, not session ${request.session} phase ${request.phase}`);
  if (!prereg) { p.push('no externally anchored pre-registration'); return p; }
  if (auth.preregSha256 !== prereg.preregSha256) p.push('the authorization does not name the externally anchored pre-registration');
  const runs: unknown = prereg.prereg?.plan?.agentFeedback?.runs;
  const listed = Array.isArray(runs) && runs.some((r: any) => r && r.runId === auth.runId && r.session === auth.session && r.arm === auth.arm && r.phase === auth.phase);
  if (!listed) p.push(`the pre-registration does not list run ${auth.runId} (session ${auth.session}, arm ${auth.arm}, phase ${auth.phase}) for agent feedback`);
  return p;
}

export function activateAgentFeedback(exp: string, o: { session: string; phase?: number; authorization?: Authorization; partitions?: AgentPartition[]; rec?: string }): AgentFeedback {
  if (!AGENT_FEEDBACK_ENABLED) throw new AccessRefused(activationProblems(false, o.authorization, null)[0]); // before anything is read
  let prereg = null; try { prereg = anchoredPrereg(o.rec ?? defaultRecord(exp)); } catch { /* reported below */ }
  const problems = activationProblems(AGENT_FEEDBACK_ENABLED, o.authorization, prereg, { session: o.session, phase: o.phase ?? FEEDBACK_PHASE });
  if (problems.length) throw new AccessRefused(`agent feedback refused: ${problems.join('; ')}`);
  const x = agentInputs(exp, o);
  return { ...agentFeedbackCore(x.mine, x.sits, x.parts, o.session), partitionsRead: [...x.reads].sort(), graphPrefix: x.graphPrefix };
}

export function servableFeedbackPage(f: AgentFeedback): string {
  if ((f as any).testOnly) throw new AccessRefused('test-only feedback is never served');
  return renderAgentFeedback(f);
}

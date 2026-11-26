/**
 * GW2 Extension V1: RUNTIME activation of agent-facing hypothesis–observation feedback (D125, D131). Prepared, not enabled.
 *
 * activateAgentFeedback refuses unless ALL of these hold, checked before any evidence is read:
 *   1. AGENT_FEEDBACK_ENABLED is true (it is false; changing it is a reviewed code change of its own);
 *   2. an authorization is given, for the treatment arm, naming the externally anchored pre-registration by its sha256;
 *   3. that pre-registration lists the run id among its feedback runs (plan.agentFeedback.runs).
 * Only then are the authenticated inputs loaded (feedback-core.ts agentInputs: graph prefix, discovery, bound feedback
 * partition). servableFeedbackPage refuses anything marked testOnly. This module does not import feedback-testonly.ts.
 * Nothing serves these pages yet; a future authorized run would serve them after freeze-1, logged in the access journal,
 * from a staging directory that is never the blind site.
 */
import { agentFeedbackCore, agentInputs, renderAgentFeedback, type AgentFeedback, type AgentPartition } from './feedback-core.ts';
import { anchoredPrereg, defaultRecord } from './anchored.ts';
import { AccessRefused } from './errors.ts';

export const AGENT_FEEDBACK_ENABLED = false;
export type Authorization = { arm: string; runId: string; preregSha256: string; operatorAuthorization: string };

/** Pure: why activation is refused (empty = allowed). */
export function activationProblems(enabled: boolean, auth: Authorization | undefined, prereg: { preregSha256: string; prereg: any } | null): string[] {
  const p: string[] = [];
  if (!enabled) p.push('agent-facing feedback is not enabled (AGENT_FEEDBACK_ENABLED = false)');
  if (!auth) { p.push('no authorization given'); return p; }
  if (auth.arm !== 'treatment') p.push(`feedback is shown only in the treatment arm, not "${auth.arm}"`);
  if (!auth.operatorAuthorization?.trim()) p.push('the authorization names no written operator authorization');
  if (!prereg) { p.push('no externally anchored pre-registration'); return p; }
  if (auth.preregSha256 !== prereg.preregSha256) p.push('the authorization does not name the externally anchored pre-registration');
  const runs: unknown = prereg.prereg?.plan?.agentFeedback?.runs;
  if (!Array.isArray(runs) || !runs.includes(auth.runId)) p.push(`the pre-registration does not list run ${auth.runId} for agent feedback`);
  return p;
}

export function activateAgentFeedback(exp: string, o: { session: string; authorization?: Authorization; partitions?: AgentPartition[]; rec?: string }): AgentFeedback {
  if (!AGENT_FEEDBACK_ENABLED) throw new AccessRefused(activationProblems(false, o.authorization, null)[0]); // before anything is read
  let prereg = null; try { prereg = anchoredPrereg(o.rec ?? defaultRecord(exp)); } catch { /* reported below */ }
  const problems = activationProblems(AGENT_FEEDBACK_ENABLED, o.authorization, prereg);
  if (problems.length) throw new AccessRefused(`agent feedback refused: ${problems.join('; ')}`);
  const x = agentInputs(exp, o);
  return { ...agentFeedbackCore(x.mine, x.sits, x.parts, o.session), partitionsRead: [...x.reads].sort(), graphPrefix: x.graphPrefix };
}

export function servableFeedbackPage(f: AgentFeedback): string {
  if ((f as any).testOnly) throw new AccessRefused('test-only feedback is never served');
  return renderAgentFeedback(f);
}

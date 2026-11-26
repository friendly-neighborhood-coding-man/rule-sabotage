/**
 * GW2 matched comparison: hypothesis–observation feedback for one treatment session before phase 2 (D137, D138).
 *
 * Inputs, all authenticated: the session's OWN Freeze-1 (sessions.ts loadFrozen: anchored file and byte-exact graph
 * prefix) and the discovery partition whose manifest the anchored pre-registration binds. Nothing else is opened:
 * no held-out, spec or eval partition, no other session's graph and no node after the Freeze-1 prefix.
 * Construction is ext/feedback-core.ts (cap 25 per hypothesis, deterministic pattern-diverse selection).
 *
 * activateSessionFeedback is the RUNTIME path: it refuses while AGENT_FEEDBACK_ENABLED is false, and otherwise unless
 * the authorization names exactly {runId, session, arm: treatment, phase: 2} and the anchored pre-registration lists that
 * run. This module does not import the test-only builder (matched/feedback-testonly.ts).
 */
import { partitionReader, loadSituations } from '../ext/inputs.ts';
import { agentFeedbackCore, type AgentFeedback } from '../ext/feedback-core.ts';
import { AGENT_FEEDBACK_ENABLED, activationProblems, type Authorization } from '../ext/feedback.ts';
import { anchoredPrereg } from '../ext/anchored.ts';
import { AccessRefused } from '../ext/errors.ts';
import { loadFrozen } from './sessions.ts';
import { MATCHED } from './params.ts';

/** Authenticated feedback inputs for one session (shared by the runtime and the test-only builder). */
export function sessionFeedbackInputs(evidence: string, run: string, rec: string, session: string) {
  const { prereg } = anchoredPrereg(rec), manifests = prereg.plan?.evidence?.manifests;
  if (!manifests?.discovery) throw new AccessRefused('the pre-registration binds no discovery manifest');
  const reader = partitionReader(evidence, ['discovery'], { manifests: { discovery: manifests.discovery } });
  const frozen = loadFrozen(run, rec, session, 1), { sits } = loadSituations(reader, ['discovery']);
  return { mine: frozen.hyps, sits, freeze1Sha256: frozen.freezeSha256, reads: reader.reads };
}

export function constructSessionFeedback(evidence: string, run: string, rec: string, session: string): AgentFeedback & { freeze1Sha256: string } {
  const x = sessionFeedbackInputs(evidence, run, rec, session);
  return { ...agentFeedbackCore(x.mine, x.sits, ['discovery'], session, MATCHED.feedback.cap), partitionsRead: [...x.reads].sort(), graphPrefix: -1, freeze1Sha256: x.freeze1Sha256 };
}

export function activateSessionFeedback(evidence: string, run: string, rec: string, o: { session: string; authorization?: Authorization }) {
  if (!AGENT_FEEDBACK_ENABLED) throw new AccessRefused(activationProblems(false, o.authorization, null)[0]); // before anything is read
  let prereg = null; try { prereg = anchoredPrereg(rec); } catch { /* reported below */ }
  const problems = activationProblems(AGENT_FEEDBACK_ENABLED, o.authorization, prereg, { session: o.session, phase: 2 });
  if (problems.length) throw new AccessRefused(`agent feedback refused: ${problems.join('; ')}`);
  return constructSessionFeedback(evidence, run, rec, o.session);
}

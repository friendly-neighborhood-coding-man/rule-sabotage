/**
 * GW2 Extension V1: agent-facing hypothesis–observation feedback, CONSTRUCTION only (D125, D131).
 *
 * Pure construction from inputs that were authenticated before they reach here; no activation, no serving. Two callers:
 *   - feedback-testonly.ts builds feedback for tests and marks it testOnly (it can never be served);
 *   - feedback.ts is the runtime activation path, which refuses while AGENT_FEEDBACK_ENABLED is false and without an
 *     authorization bound to the externally anchored pre-registration.
 * Inputs: the session's own submissions from the authenticated pre-evaluation graph prefix (anchored.ts) and only the
 * discovery partition and, if the pre-registration binds one, a feedback partition. The reader can open nothing else, so
 * neither the specification, nor held-out evidence, nor eval/ (operator build labels) can reach the agent. Items are facts
 * only: the clause, the situation, the predicted value and the recorded value; never "defect", spec or a correct rule.
 */
import { partitionReader, loadSubmissions, loadSituations, builds, idOf, AccessRefused, type Partition, type Hyp, type Sits } from './inputs.ts';
import { contradictionsCore } from './contradictions.ts';
import { esc } from './html.ts';

export const FEEDBACK_SCHEMA = 'gamewatch/gw2-ext-agent-feedback@1';
export const AGENT_AUTHORIZED: readonly Partition[] = ['discovery', 'feedback'];
export type AgentPartition = 'discovery' | 'feedback';
export const NOTICE = 'Each item is a recorded observation that differs from what your structured hypothesis predicts. It is information about your hypothesis and the observations, nothing else.';

export function agentFeedbackCore(mine: Hyp[], sits: Sits, parts: AgentPartition[], session: string) {
  const core = contradictionsCore(mine, sits, {}, parts);
  const items = core.contradictions.map(c => ({ id: c.id, yourHypothesis: c.hypothesis.ref, clause: c.clause, evidence: c.partition, build: c.build.id, situation: c.evidence.situation, page: c.evidence.unit, outcome: c.field, yourPrediction: c.predicted, recorded: c.observed }));
  const body = { schema: FEEDBACK_SCHEMA, session, evidenceUsed: parts, builds: [...new Set(parts.flatMap(p => builds(sits[p])))].sort(), notice: NOTICE,
    items, withoutCheck: core.notEvaluable.map(x => ({ yourHypothesis: x.ref, reason: x.reason })),
    conflictsBetweenYourHypotheses: core.conflictsBetweenHypotheses.map(c => ({ situation: c.situation, outcome: c.field, predictions: c.predictions.map((p: any) => ({ yourHypothesis: p.ref, predicted: p.predicted })) })) };
  return { ...body, digest: idOf(body) };
}

/** Authenticated agent-visible inputs for one session: graph prefix (anchored), discovery and a bound feedback partition. */
export function agentInputs(exp: string, o: { session: string; partitions?: AgentPartition[]; rec?: string }) {
  const parts = o.partitions ?? ['discovery'];
  for (const p of parts) if (!AGENT_AUTHORIZED.includes(p)) throw new AccessRefused(`partition ${p} is never authorized for agent feedback`);
  const reader = partitionReader(exp, parts, { rec: o.rec }); // exactly the requested agent-visible partitions
  const sub = loadSubmissions(exp, o.rec), mine = sub.hyps.filter(h => h.session === o.session);
  const { sits } = loadSituations(reader, parts);
  return { parts, mine, sits, graphPrefix: sub.graphPrefix, prefixBytes: sub.prefixBytes, reads: reader.reads };
}

export type AgentFeedback = ReturnType<typeof agentFeedbackCore> & { partitionsRead: string[]; graphPrefix: number; testOnly?: true };

export function renderAgentFeedback(f: AgentFeedback, banner = ''): string {
  const rows = f.items.map(i => `<tr><td>${esc(i.yourHypothesis)}</td><td>${esc(i.page)}</td><td class="mono">${esc(i.situation)}</td><td>${esc(i.outcome)}</td><td>${esc(JSON.stringify(i.yourPrediction))}</td><td>${esc(JSON.stringify(i.recorded))}</td></tr>`).join('');
  const none = f.withoutCheck.map(x => `<li>${esc(x.yourHypothesis)}: ${esc(x.reason)}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Your hypotheses and the observations</title>${banner}<h1>Your hypotheses and the observations</h1><p>${esc(f.notice)}</p>`
    + `<table><tr><th>Hypothesis</th><th>Page</th><th>Situation</th><th>Outcome</th><th>You predicted</th><th>Recorded</th></tr>${rows}</table>`
    + (none ? `<h2>Not checked</h2><ul>${none}</ul>` : '') + '\n';
}

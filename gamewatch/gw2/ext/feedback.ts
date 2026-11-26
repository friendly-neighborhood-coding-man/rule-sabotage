/**
 * Extension output C, agent-facing part: OPTIONAL hypothesis-contradiction feedback (D125). Prepared, not enabled.
 *
 * For one session, its own hypotheses, and only the evidence it is authorized to see: the discovery partition and,
 * if one is authorized, a `feedback` partition. The reader for this output can open nothing else, so neither the
 * specification, nor held-out evidence, nor eval/ (operator build labels) can reach it. Notifications are facts only:
 * your clause, the situation, your predicted value and the recorded value. No word "defect", no spec, no correct rule.
 * Hypotheses without a structured representation get an explicit "no machine check possible" entry.
 *
 * AGENT_FEEDBACK_ENABLED is false: nothing serves these pages. A future, separately authorized experiment would serve
 * them after a first freeze, logged in the access journal, from a staging directory that is never the blind site.
 */
import { partitionReader, loadSubmissions, loadSituations, builds, idOf, AccessRefused, type Partition } from './inputs.ts';
import { contradictionsCore } from './contradictions.ts';
import { esc } from './html.ts';

export const AGENT_FEEDBACK_ENABLED = false;
export const FEEDBACK_SCHEMA = 'gamewatch/gw2-ext-agent-feedback@1';
export const AGENT_AUTHORIZED: readonly Partition[] = ['discovery', 'feedback'];

export function buildAgentFeedback(exp: string, o: { session: string; partitions?: ('discovery' | 'feedback')[]; enable?: boolean }) {
  if (!o.enable) throw new AccessRefused('agent-facing feedback is not enabled (AGENT_FEEDBACK_ENABLED = false); pass enable: true only in an authorized run or a test');
  const parts = o.partitions ?? ['discovery'];
  for (const p of parts) if (!AGENT_AUTHORIZED.includes(p)) throw new AccessRefused(`partition ${p} is never authorized for agent feedback`);
  const reader = partitionReader(exp, parts); // exactly the requested agent-visible partitions; no eval, spec or heldout
  const { hyps } = loadSubmissions(exp), mine = hyps.filter(h => h.session === o.session);
  const { sits } = loadSituations(reader, parts);
  const core = contradictionsCore(mine, sits, {}, parts);
  const items = core.contradictions.map(c => ({ id: c.id, yourHypothesis: c.hypothesis.ref, clause: c.clause, evidence: c.partition, build: c.build.id, situation: c.evidence.situation, page: c.evidence.unit, outcome: c.field, yourPrediction: c.predicted, recorded: c.observed }));
  const body = { schema: FEEDBACK_SCHEMA, session: o.session, evidenceUsed: parts, builds: [...new Set(parts.flatMap(p => builds(sits[p])))].sort(),
    notice: 'Each item is a recorded observation that differs from what your structured hypothesis predicts. It is information about your hypothesis and the observations, nothing else.',
    items, withoutCheck: core.notEvaluable.map(x => ({ yourHypothesis: x.ref, reason: x.reason })),
    conflictsBetweenYourHypotheses: core.conflictsBetweenHypotheses.map(c => ({ situation: c.situation, outcome: c.field, predictions: c.predictions.map((p: any) => ({ yourHypothesis: p.ref, predicted: p.predicted })) })) };
  return { ...body, digest: idOf(body), partitionsRead: [...reader.reads].sort() };
}

export function renderAgentFeedback(f: ReturnType<typeof buildAgentFeedback>): string {
  const rows = f.items.map(i => `<tr><td>${esc(i.yourHypothesis)}</td><td>${esc(i.page)}</td><td class="mono">${esc(i.situation)}</td><td>${esc(i.outcome)}</td><td>${esc(JSON.stringify(i.yourPrediction))}</td><td>${esc(JSON.stringify(i.recorded))}</td></tr>`).join('');
  const none = f.withoutCheck.map(x => `<li>${esc(x.yourHypothesis)}: ${esc(x.reason)}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Your hypotheses and the observations</title><h1>Your hypotheses and the observations</h1><p>${esc(f.notice)}</p>`
    + `<table><tr><th>Hypothesis</th><th>Page</th><th>Situation</th><th>Outcome</th><th>You predicted</th><th>Recorded</th></tr>${rows}</table>`
    + (none ? `<h2>Not checked</h2><ul>${none}</ul>` : '') + '\n';
}

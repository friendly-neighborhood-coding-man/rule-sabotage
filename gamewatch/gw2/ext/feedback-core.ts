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
import { partitionReader, loadSubmissions, loadSituations, builds, idOf, canon, AccessRefused, type Partition, type Hyp, type Sits } from './inputs.ts';
import { contradictionsCore } from './contradictions.ts';
import { esc } from './html.ts';

export const FEEDBACK_SCHEMA = 'gamewatch/gw2-ext-agent-feedback@1';
export const AGENT_AUTHORIZED: readonly Partition[] = ['discovery', 'feedback'];
export type AgentPartition = 'discovery' | 'feedback';
export const NOTICE = 'Each item is a recorded observation that differs from what your structured hypothesis predicts. It is information about your hypothesis and the observations, nothing else.';

/** D137: at most FEEDBACK_CAP items are shown per hypothesis (pre-registered: 25). */
export const FEEDBACK_CAP = 25;
type Item = { id: string; yourHypothesis: string; clause: number; evidence: string; build: string; situation: string; page: string; outcome: string; yourPrediction: unknown; recorded: unknown };
const patternKey = (i: Item) => canon([i.clause, i.outcome, i.yourPrediction, i.recorded]);

/**
 * Deterministic, pattern-diverse selection of at most `cap` items for ONE hypothesis. A pattern is (clause, outcome
 * field, predicted value, recorded value). Patterns are ordered by their canonical key, the items of a pattern by
 * (evidence partition, situation id); items are then taken round-robin across patterns, so every pattern is shown once
 * before any pattern is shown twice. The same items always give the same selection, whatever their input order.
 */
export function selectFeedback(items: Item[], cap = FEEDBACK_CAP) {
  if (!Number.isInteger(cap) || cap < 1) throw new Error('the feedback cap must be a positive integer');
  const groups = new Map<string, Item[]>();
  for (const i of items) (groups.get(patternKey(i)) ?? groups.set(patternKey(i), []).get(patternKey(i))!).push(i);
  const keys = [...groups.keys()].sort();
  for (const k of keys) groups.get(k)!.sort((a, b) => a.evidence.localeCompare(b.evidence) || a.situation.localeCompare(b.situation, 'en', { numeric: true }) || a.outcome.localeCompare(b.outcome));
  const shown: Item[] = [];
  for (let round = 0; shown.length < cap && keys.some(k => groups.get(k)!.length > round); round++)
    for (const k of keys) { const g = groups.get(k)!; if (round < g.length && shown.length < cap) shown.push(g[round]); }
  return { shown, patterns: keys.map(k => { const g = groups.get(k)!, i = g[0]; return { clause: i.clause, outcome: i.outcome, yourPrediction: i.yourPrediction, recorded: i.recorded, total: g.length, shown: shown.filter(x => patternKey(x) === k).length }; }) };
}

export function agentFeedbackCore(mine: Hyp[], sits: Sits, parts: AgentPartition[], session: string, cap = FEEDBACK_CAP) {
  const core = contradictionsCore(mine, sits, {}, parts);
  const all: Item[] = core.contradictions.map(c => ({ id: c.id, yourHypothesis: c.hypothesis.ref, clause: c.clause, evidence: c.partition, build: c.build.id, situation: c.evidence.situation, page: c.evidence.unit, outcome: c.field, yourPrediction: c.predicted, recorded: c.observed }));
  const refs = [...new Set(all.map(i => i.yourHypothesis))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const per = refs.map(r => ({ r, ...selectFeedback(all.filter(i => i.yourHypothesis === r), cap) }));
  const items = per.flatMap(p => p.shown);
  const summary = per.map(p => ({ yourHypothesis: p.r, totalDiffering: all.filter(i => i.yourHypothesis === p.r).length, shown: p.shown.length, patternsTotal: p.patterns.length, patternsShown: p.patterns.filter(x => x.shown > 0).length, patterns: p.patterns }));
  const body = { schema: FEEDBACK_SCHEMA, session, evidenceUsed: parts, builds: [...new Set(parts.flatMap(p => builds(sits[p])))].sort(), notice: NOTICE, cap,
    totals: { differing: all.length, shown: items.length }, summary,
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

/** The feedback section; refuses any feedback whose items exceed its cap for a hypothesis (the cap holds at rendering too). */
export function renderFeedbackSection(f: AgentFeedback): string {
  const cap = Number(f.cap);
  if (!Number.isInteger(cap) || cap < 1 || cap > FEEDBACK_CAP) throw new AccessRefused(`feedback cap ${f.cap} is not the pre-registered cap (at most ${FEEDBACK_CAP})`);
  const count = new Map<string, number>(); for (const i of f.items) count.set(i.yourHypothesis, (count.get(i.yourHypothesis) ?? 0) + 1);
  for (const [h, n] of count) if (n > cap) throw new AccessRefused(`${n} items for ${h} exceed the cap of ${cap}`);
  for (const s of f.summary) if ((count.get(s.yourHypothesis) ?? 0) !== s.shown) throw new AccessRefused(`the summary for ${s.yourHypothesis} does not match the items shown`);
  const sections = f.summary.map(s => {
    const rows = f.items.filter(i => i.yourHypothesis === s.yourHypothesis).map(i => `<tr><td>${esc(i.page)}</td><td class="mono">${esc(i.situation)}</td><td>${esc(i.outcome)}</td><td>${esc(JSON.stringify(i.yourPrediction))}</td><td>${esc(JSON.stringify(i.recorded))}</td></tr>`).join('');
    return `<h3>${esc(s.yourHypothesis)}</h3><p class="shown">Showing ${s.shown} of ${s.totalDiffering} recorded observations that differ from this hypothesis (${s.patternsShown} of ${s.patternsTotal} distinct patterns shown; at most ${cap} per hypothesis).</p>`
      + `<table><tr><th>Page</th><th>Situation</th><th>Outcome</th><th>You predicted</th><th>Recorded</th></tr>${rows}</table>`;
  }).join('');
  const none = f.withoutCheck.map(x => `<li>${esc(x.yourHypothesis)}: ${esc(x.reason)}</li>`).join('');
  return `<p>${esc(f.notice)}</p><p>${f.totals.shown} of ${f.totals.differing} differing observations shown.</p>${sections || '<p>No recorded observation differs from your structured hypotheses.</p>'}`
    + (none ? `<h3>Not checked</h3><ul>${none}</ul>` : '');
}

export function renderAgentFeedback(f: AgentFeedback, banner = ''): string {
  return `<!doctype html><meta charset="utf-8"><title>Your hypotheses and the observations</title>${banner}<h1>Your hypotheses and the observations</h1>${renderFeedbackSection(f)}\n`;
}

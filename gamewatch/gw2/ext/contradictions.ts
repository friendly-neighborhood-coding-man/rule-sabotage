/**
 * Extension output C: Hypothesis Contradictions (D124), operator view.
 *
 * Deterministic hypothesis–observation contradictions: for each sealed structured representation, the recorded
 * situations whose outcome differs from its prediction, discovery and held-out listed separately. Conflicts between
 * hypotheses (two representations predicting different values for the same outcome of the same situation) are listed
 * as a third, separate table and are not resolved. Reads no specification.
 */
import { partitionReader, loadSubmissions, loadSituations, builds, idOf, type Hyp, type Sits, type BuildLabels } from './inputs.ts';
import { evalClause } from './clauses.ts';

export const CONTRADICTION_SCHEMA = 'gamewatch/gw2-ext-hypothesis-contradiction@1';
export const CONTRADICTION_PARTITIONS = ['discovery', 'heldout', 'eval'] as const; // never 'spec'

export function contradictionsCore(hyps: Hyp[], sits: Sits, labels: BuildLabels, partitions: ('discovery' | 'heldout' | 'feedback')[]) {
  const contradictions: any[] = [], conflicts: any[] = [], notEvaluable: any[] = [];
  const preds = new Map<string, Map<string, { rep: string; ref: string; hypothesis: string; value: unknown }[]>>(); // situation → field → predictions
  for (const h of hyps) {
    if (h.kind === 'abstention') continue;
    if (!h.representations.length) { notEvaluable.push({ hypothesis: h.id, ref: h.ref, session: h.session, reason: 'no structured representation: free text is not checked' }); continue; }
    for (const r of h.representations) {
      if (!r.clauses.length) { notEvaluable.push({ hypothesis: h.id, ref: h.ref, session: h.session, representation: r.id, reason: `representation ${r.status}` }); continue; }
      for (const p of partitions) for (const b of builds(sits[p])) r.clauses.forEach((c: any, ci: number) => {
        const own = (sits[p] ?? []).filter(s => s.build === b), e = evalClause(c, own), byId = new Map(own.map(s => [s.id, s]));
        for (const [sid, m] of e.predictions) for (const [field, value] of m) {
          const k = `${p}|${sid}`; if (!preds.has(k)) preds.set(k, new Map());
          const f = preds.get(k)!; f.set(field, [...(f.get(field) ?? []), { rep: r.id, ref: h.ref, hypothesis: h.id, value }]);
        }
        for (const x of e.counter) {
          const s = byId.get(x.id)!;
          const n = { hypothesis: { id: h.id, ref: h.ref, session: h.session, confidence: h.confidence }, representation: r.id, clause: ci, partition: p, build: { id: b, label: labels[b]?.label ?? null },
            field: x.field, predicted: x.predicted, observed: x.observed ?? null, ...(x.partner ? { comparedWith: x.partner } : {}), evidence: { situation: x.id, unit: s.source.id, unitType: s.source.type, pointer: s.source.pointer } };
          contradictions.push({ id: idOf(n), ...n });
        }
      });
    }
  }
  for (const [k, fields] of [...preds.entries()].sort(([a], [b]) => a.localeCompare(b))) for (const [field, ps] of [...fields.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const distinct = new Set(ps.map(x => JSON.stringify(x.value)));
    const hypsInvolved = new Set(ps.map(x => x.hypothesis));
    if (distinct.size > 1 && hypsInvolved.size > 1) { const [partition, situation] = k.split('|'); conflicts.push({ partition, situation, field, predictions: ps.map(x => ({ ref: x.ref, hypothesis: x.hypothesis, representation: x.rep, predicted: x.value })) }); }
  }
  contradictions.sort((a, b) => a.hypothesis.session.localeCompare(b.hypothesis.session) || a.hypothesis.ref.localeCompare(b.hypothesis.ref) || a.partition.localeCompare(b.partition) || a.evidence.situation.localeCompare(b.evidence.situation) || a.field.localeCompare(b.field));
  return { contradictions, conflictsBetweenHypotheses: conflicts, notEvaluable };
}

export function buildContradictions(exp: string) {
  const reader = partitionReader(exp, CONTRADICTION_PARTITIONS);
  const { hyps } = loadSubmissions(exp), { sits, labels } = loadSituations(reader, ['discovery', 'heldout']);
  return { schema: CONTRADICTION_SCHEMA, channel: 'hypothesis–observation', audience: 'operator (contains held-out results)', specification: 'not used',
    ...contradictionsCore(hyps, sits, labels, ['discovery', 'heldout']), partitionsRead: [...reader.reads].sort() };
}

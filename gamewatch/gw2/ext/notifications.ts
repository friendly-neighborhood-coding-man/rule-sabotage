/**
 * Extension output B: Unmatched Action Notifications (D123).
 *
 * Deterministic specification–observation discrepancies for the OPERATOR: for each encoded spec rule and each recorded
 * situation where the observed outcome differs from the outcome the encoded rule expects. Each notification carries
 * the specification reference (rule id, rule text, encoding id and its review status), the expected and observed
 * outcome, the evidence reference and the affected build. A notification is "unmatched"; it is never classified as a
 * bug, defect or error. It does not depend on any agent submission and reads no hypothesis.
 */
import { partitionReader, loadSituations, builds, idOf, type Sits, type BuildLabels } from './inputs.ts';
import { evalClause } from './clauses.ts';
import { loadEncoding } from '../verify.ts';
import { P5_ENCODING } from '../heldout.ts';

export const NOTIFICATION_SCHEMA = 'gamewatch/gw2-ext-unmatched-action@1';
export const NOTIFICATION_PARTITIONS = ['spec', 'discovery', 'heldout', 'eval'] as const;
export const CLASSIFICATION = 'unmatched: observed outcome differs from the encoded specification (not classified)';

type Enc = ReturnType<typeof loadEncoding>;
export function notificationsCore(rules: { id: string; text: string }[], enc: Enc, sits: Sits, labels: BuildLabels) {
  const status = { encoding: enc.enc.id, status: enc.enc.status, review: enc.enc.review?.status ?? 'unreviewed', authoritative: enc.authoritative,
    note: enc.authoritative ? 'encoding accepted by the operator' : 'PROVISIONAL: the encoding is not reviewed or accepted; an unmatched action may reflect the encoding rather than the build' };
  const out: any[] = [], missing: any[] = [];
  for (const r of enc.usable) {
    const text = rules.find(x => x.id === r.rule)?.text ?? null;
    for (const p of ['discovery', 'heldout'] as const) for (const b of builds(sits[p])) r.clauses.forEach((c: any, ci: number) => {
      const own = (sits[p] ?? []).filter(s => s.build === b), e = evalClause(c, own), byId = new Map(own.map(s => [s.id, s]));
      if (Object.keys(e.excluded).length || e.outcomeChecks.unknown) missing.push({ rule: r.rule, clause: ci, partition: p, build: b, excluded: e.excluded, outcomeUnknown: e.outcomeChecks.unknown });
      for (const x of e.counter) {
        const s = byId.get(x.id)!;
        const n = { rule: { id: r.rule, text, clause: ci }, specificationStatus: status.note, partition: p, build: { id: b, label: labels[b]?.label ?? null },
          field: x.field, expected: x.predicted, observed: x.observed ?? null, ...(x.partner ? { comparedWith: x.partner } : {}),
          evidence: { situation: x.id, kind: s.kind, unit: s.source.id, unitType: s.source.type, pointer: s.source.pointer }, classification: CLASSIFICATION };
        out.push({ id: idOf(n), ...n });
      }
    });
  }
  const notEncoded = (enc.inventory as any[]).filter(x => x.status !== 'encoded').map(x => ({ rule: x.rule, status: x.status, reason: x.reason ?? null, consequence: 'no notification can be produced for this rule' }));
  out.sort((a, b) => a.rule.id.localeCompare(b.rule.id, 'en', { numeric: true }) || a.partition.localeCompare(b.partition) || a.build.id.localeCompare(b.build.id) || a.evidence.situation.localeCompare(b.evidence.situation) || a.field.localeCompare(b.field));
  return { specification: status, notifications: out, notEncoded, missingInformation: missing };
}

export function buildNotifications(exp: string, o: { encoding?: string } = {}) {
  const reader = partitionReader(exp, NOTIFICATION_PARTITIONS);
  const spec = JSON.parse(reader.read('spec', 'spec.json')), enc = loadEncoding(o.encoding ?? P5_ENCODING, spec.game.rules);
  const { sits, labels } = loadSituations(reader, ['discovery', 'heldout']);
  return { schema: NOTIFICATION_SCHEMA, channel: 'specification–observation (system level)', audience: 'operator only: never served to a blinded agent', agentInvolved: false,
    ...notificationsCore(spec.game.rules, enc, sits, labels), partitionsRead: [...reader.reads].sort() };
}

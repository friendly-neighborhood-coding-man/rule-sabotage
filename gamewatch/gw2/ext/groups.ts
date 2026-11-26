/**
 * GW2 Extension V1: grouping of unmatched action notifications for the operator dashboard (D132).
 *
 * build → rule → outcome field. Each field group reports, separately and never combined:
 *   - discrepancy TYPES: the distinct (expected, observed, comparison) patterns, each with its own observation count;
 *   - OBSERVATION counts: notifications, distinct situations and distinct evidence units, per partition.
 * Every underlying notification is kept in its group with its full evidence reference and provenance (id, partition,
 * situation, kind, unit, unit type, JSON pointer, compared situation), so the grouping loses nothing:
 * the union of all groups is exactly the notification list. Nothing is classified as a bug.
 */
import { canon } from './inputs.ts';

const PARTS = ['discovery', 'heldout'] as const;
type N = any;
const byPartition = (ns: N[]) => Object.fromEntries(PARTS.map(p => [p, ns.filter(n => n.partition === p).length]));
const distinct = (ns: N[], f: (n: N) => string) => new Set(ns.map(f)).size;
const counts = (ns: N[]) => ({ observations: ns.length, observationsByPartition: byPartition(ns), situations: distinct(ns, n => n.evidence.situation), units: distinct(ns, n => n.evidence.unit) });
const num = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/**
 * V1 labelled every invariance discrepancy "cross-build invariance". That was wrong (correction D140): notifications.ts
 * evaluates each invariance clause on ONE build's situations at a time, so the compared situation is always a matched
 * situation of the SAME build that differs only in the clause's varied inputs. labels 'v2' says so and names the varied
 * inputs; 'v1' is kept only so that the committed V1 dashboard still reproduces byte for byte.
 */
export type LabelVersion = 'v1' | 'v2';
export function discrepancyTypeV2(n: N, vary: string[] | null) {
  const v = vary && vary.length ? vary.join(', ') : 'the varied inputs';
  return n.comparedWith
    ? { comparison: `within-build invariance (matched situation differing in ${v})`, expected: n.expected, observed: n.observed, description: `expected ${JSON.stringify(n.expected)} (the outcome of the matched situation in the same build, differing only in ${v}), observed ${JSON.stringify(n.observed)}` }
    : { comparison: 'value', expected: n.expected, observed: n.observed, description: `expected ${JSON.stringify(n.expected)}, observed ${JSON.stringify(n.observed)}` };
}
export function discrepancyType(n: N) {
  return n.comparedWith
    ? { comparison: 'cross-build invariance' as const, expected: n.expected, observed: n.observed, description: `expected ${JSON.stringify(n.expected)} (the outcome of the matched situation in the other build), observed ${JSON.stringify(n.observed)}` }
    : { comparison: 'value' as const, expected: n.expected, observed: n.observed, description: `expected ${JSON.stringify(n.expected)}, observed ${JSON.stringify(n.observed)}` };
}

export function groupNotifications(notifications: N[], allBuilds: { id: string; label: string | null }[], o: { labels?: LabelVersion; varyOf?: (rule: string, clause: number) => string[] | null } = {}) {
  const typeOf = (n: N): { comparison: string; expected: unknown; observed: unknown; description: string } => o.labels === 'v2' ? discrepancyTypeV2(n, o.varyOf?.(n.rule.id, n.rule.clause) ?? null) : discrepancyType(n);
  const buildIds = [...new Set([...allBuilds.map(b => b.id), ...notifications.map(n => n.build.id)])].sort();
  return buildIds.map(id => {
    const inB = notifications.filter(n => n.build.id === id);
    const label = allBuilds.find(b => b.id === id)?.label ?? inB[0]?.build.label ?? null;
    const rules = [...new Set(inB.map(n => n.rule.id))].sort(num).map(rid => {
      const inR = inB.filter(n => n.rule.id === rid);
      const fields = [...new Set(inR.map(n => n.field))].sort().map(field => {
        const inF = inR.filter(n => n.field === field), types = new Map<string, { type: ReturnType<typeof typeOf>; ns: N[] }>();
        for (const n of inF) { const t = typeOf(n), k = canon([t.comparison, t.expected, t.observed]); (types.get(k) ?? types.set(k, { type: t, ns: [] }).get(k)!).ns.push(n); }
        return { field, ...counts(inF), discrepancyTypes: [...types.values()].sort((a, b) => b.ns.length - a.ns.length || canon(a.type).localeCompare(canon(b.type))).map(t => ({ ...t.type, ...counts(t.ns) })),
          observationsList: inF.map(n => ({ id: n.id, partition: n.partition, situation: n.evidence.situation, kind: n.evidence.kind, unit: n.evidence.unit, unitType: n.evidence.unitType, pointer: n.evidence.pointer, comparedWith: n.comparedWith ?? null, expected: n.expected, observed: n.observed, classification: n.classification })) };
      });
      return { rule: { id: rid, text: inR[0].rule.text }, ...counts(inR), discrepancyTypes: fields.reduce((k, f) => k + f.discrepancyTypes.length, 0), fields };
    });
    return { build: { id, label }, ...counts(inB), rules };
  });
}

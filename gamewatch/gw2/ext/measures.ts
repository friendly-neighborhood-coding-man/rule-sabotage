/**
 * Separated measures (D126): system-level discrepancy detection, agent behavioural discovery and machine-verifiable
 * descriptions. Three blocks with their own units; never combined, never ranked.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function measures(exp: string, A: any, B: any, C: any) {
  const byRule: Record<string, Record<string, number>> = {};
  for (const n of B.notifications) { const k = `${n.partition}:${n.build.id}`; byRule[n.rule.id] = { ...(byRule[n.rule.id] ?? {}), [k]: (byRule[n.rule.id]?.[k] ?? 0) + 1 }; }
  const hyps = A.hypotheses.filter((h: any) => h.kind !== 'abstention');
  const checks = (p: 'discovery' | 'heldout') => hyps.flatMap((h: any) => h.representations.flatMap((r: any) => r.byBuild.flatMap((b: any) => b.clauses.map((c: any) => c[p].outcomeChecks))));
  const sum = (xs: any[], k: string) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
  const tw = existsSync(join(exp, 'evaluations')) ? readdirSync(join(exp, 'evaluations')).filter(f => /^three-way-\d+\.json$/.test(f)).sort() : [];
  const threeWay = tw.length ? JSON.parse(readFileSync(join(exp, 'evaluations', tw[tw.length - 1]), 'utf8')) : null;
  const readings = threeWay ? threeWay.hypotheses.flatMap((h: any) => (h.representations ?? []).flatMap((r: any) => (r.byPartition ?? []).flatMap((p: any) => (p.readings ?? []).map((x: any) => ({ hypothesis: h.hypothesis, partition: p.partition, build: p.build, rule: x.rule, reading: x.reading }))))) : null;
  return {
    systemDiscrepancyDetection: { unit: 'unmatched actions (situation × outcome field) found by the verifier against the encoded specification; a system result, not an agent result',
      specificationStatus: B.specification.note, unmatchedActions: B.notifications.length, rulesWithUnmatchedActions: Object.keys(byRule).length, byRule, rulesNotEncoded: B.notEncoded.length },
    agentBehaviouralDiscovery: { unit: 'agent submissions and what their structured representations predict; no specification involved',
      hypotheses: hyps.length, abstentions: A.hypotheses.length - hyps.length, withStructuredRepresentation: hyps.filter((h: any) => h.representations.length).length, freeTextOnly: hyps.filter((h: any) => !h.representations.length).length,
      contradictedByDiscovery: hyps.filter((h: any) => h.verificationStatus === 'contradicted by discovery evidence').length,
      heldoutOutcomeChecks: { matching: sum(checks('heldout'), 'matching'), contradicting: sum(checks('heldout'), 'contradicting'), unknown: sum(checks('heldout'), 'unknown'), note: 'outcome checks, correlated; not replications' },
      hypothesisContradictions: C.contradictions.length, conflictsBetweenHypotheses: C.conflictsBetweenHypotheses.length },
    machineVerifiableDescriptions: readings === null ? { unit: 'verifier readings', status: 'not evaluated (no three-way evaluation in this experiment)' } : {
      unit: 'held-out (rule, build) readings "accurate-description-of-a-defect" from the committed three-way evaluation; requires a structured representation, not the agent knowing the spec',
      source: `evaluations/${tw[tw.length - 1]}`, accurateDescriptions: readings.filter((x: any) => x.reading === 'accurate-description-of-a-defect' && x.partition === 'heldout').length,
      readings: Object.entries(readings.reduce((m: any, x: any) => ({ ...m, [x.reading]: (m[x.reading] ?? 0) + 1 }), {})).sort().map(([reading, n]) => ({ reading, n })) },
    combined: 'never: the three blocks answer different questions and have different units',
  };
}

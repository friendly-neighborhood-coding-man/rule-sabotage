/**
 * Extension output A: "How the Game Actually Works" (D122).
 *
 * The agent's discovered behavioural hypotheses, as submitted, with supporting evidence, declared confidence, coverage,
 * counterexamples and verification status. Built WITHOUT the specification: the reader for this output is not allowed
 * to open `spec`, so nothing in it can be spec-derived. Free-text hypotheses are kept verbatim and marked not
 * machine-evaluable; they are never interpreted. Operator-facing (it contains held-out results).
 */
import { partitionReader, loadSubmissions, loadSituations, builds, type Hyp, type Sits, type BuildLabels } from './inputs.ts';
import { evalClause, MAX_LISTED } from './clauses.ts';

export const BEHAVIOUR_SCHEMA = 'gamewatch/gw2-ext-behaviour@1';
export const BEHAVIOUR_PARTITIONS = ['discovery', 'heldout', 'eval'] as const; // never 'spec'

const statusOf = (h: Hyp, perBuild: any[]) => {
  if (h.kind === 'abstention') return 'abstention (no claim)';
  if (!h.representations.length) return 'not machine-evaluable: free text only (no structured representation)';
  if (h.representations.every(r => r.status === 'not-representable')) return 'not machine-evaluable: the structured representation could not be interpreted';
  const d = perBuild.flatMap(b => b.clauses.map((c: any) => c.discovery));
  if (!d.some(x => x.evaluated)) return 'no applicable discovery situation with a recorded outcome';
  if (d.some(x => x.counterexamples)) return 'contradicted by discovery evidence';
  return d.some(x => x.partial) ? 'consistent with discovery evidence (partly supported)' : 'consistent with discovery evidence';
};

export function behaviourCore(hyps: Hyp[], sits: Sits, labels: BuildLabels) {
  const total = { discovery: (sits.discovery ?? []).length, heldout: (sits.heldout ?? []).length };
  const bs = [...new Set([...builds(sits.discovery), ...builds(sits.heldout)])].sort();
  return hyps.map(h => {
    const reps = h.representations.map(r => ({ representation: r.id, structured: r.representation, origin: r.origin, author: r.author, fidelityDeclared: r.fidelity, fidelityChecked: false, status: r.status,
      byBuild: bs.map(b => ({ build: b, label: labels[b]?.label ?? null, clauses: r.clauses.map((c, i) => {
        const part = (p: 'discovery' | 'heldout') => {
          const e = evalClause(c, (sits[p] ?? []).filter(s => s.build === b));
          return { applicable: e.applicable, evaluated: e.evaluated.length, fullySupported: e.fit.length, partial: e.partial.length, counterexamples: new Set(e.counter.map(x => x.id)).size,
            outcomeChecks: e.outcomeChecks, excluded: e.excluded,
            listedCounterexamples: [...new Map(e.counter.map(x => [x.id + x.field, x])).values()].slice(0, MAX_LISTED).map(x => ({ situation: x.id, field: x.field, predicted: x.predicted, observed: x.observed ?? null })) };
        };
        return { clause: i, situation: c.situation, discovery: part('discovery'), heldout: part('heldout') };
      }) })) }));
    const predicted = (p: 'discovery' | 'heldout') => new Set(h.representations.flatMap(r => r.clauses.flatMap(c => evalClause(c, sits[p] ?? []).applicableIds))).size;
    return {
      hypothesis: h.id, ref: h.ref, session: h.session, kind: h.kind,
      submitted: { statement: h.statement, confidence: h.confidence, citedEvidence: h.evidence, structured: h.structured, verbatim: h.verbatim },
      verificationStatus: statusOf(h, reps.flatMap(r => r.byBuild)),
      coverage: { discovery: { k: predicted('discovery'), n: total.discovery }, heldout: { k: predicted('heldout'), n: total.heldout }, unit: 'situations to which a submitted clause applies ÷ situations' },
      representations: reps,
    };
  });
}

export function buildBehaviour(exp: string) {
  const reader = partitionReader(exp, BEHAVIOUR_PARTITIONS);
  const { hyps } = loadSubmissions(exp), { sits, labels } = loadSituations(reader, ['discovery', 'heldout']);
  return { schema: BEHAVIOUR_SCHEMA, channel: 'agent behavioural discovery', specification: 'not used: this output is built without the specification', audience: 'operator (contains held-out results)',
    builds: labels, hypotheses: behaviourCore(hyps, sits, labels), partitionsRead: [...reader.reads].sort(),
    notes: ['Statements are the agent\'s own words, kept verbatim and never interpreted.', 'Fidelity of a representation to its statement is declared by its author and not checked.', 'Counts are outcome checks and situations, not independent replications.'] };
}

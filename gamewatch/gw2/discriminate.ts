/**
 * GW2 P5: competing-hypothesis discrimination (PHASE_ROADMAP P5, AC-P5.2, AC-P5.3). No model, no Kane.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/discriminate.ts <expDir> [--at ISO] [--encoding f]
 *
 * Candidates are the SEALED representations of frozen hypotheses (representations.ts) and, as labelled reference
 * predictors, the encoded spec records (provisional). Explicit abstentions are listed and are never candidates.
 * For every pair of candidates from different hypotheses, per partition and build, every (situation, outcome field)
 * where at least one of them predicts is classified:
 *   identical        both predict the same value
 *   contradictory    both predict, different values: with a recorded outcome it SEPARATES them (the recorded value is
 *                    one candidate's prediction, the other's, or neither's); without one it is missing evidence
 *   non-overlapping  only one of them predicts (the other is silent there)
 * Verdict per pair, partition and build: `separated` (at least one separating pair with a recorded outcome),
 * `indistinguishable-on-available-evidence` (they never make different predictions where an outcome is recorded; the
 * reason is stated), or `no-common-predictions`. Two candidates are never called equivalent: identical predictions on
 * finitely many situations say nothing about situations not observed.
 * The pairs of most interest are listed first: declared competitors (alternative-to) and pairs that both fit discovery
 * and are separated on held-out.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { verifyLedger } from './freeze.ts';
import { checkRepresentation, type Clause, type LawClause, type Value } from './hypothesis.ts';
import type { Situation } from './situations.ts';
import { evalLaw, observational } from './verify.ts';
import { loadSealedInputs, primaryOf, type Cand, type Parts } from './heldout.ts';

export const DISCRIMINATION_SCHEMA = 'gamewatch/gw2-discrimination@1';
export const DISCRIMINATE_EVALUATOR = { id: 'gamewatch/gw2/discriminate.ts', version: '2' } as const; // v2: P5 corrections D88, D91, D92
const MAX = 12;

export type Candidate = { id: string; label: string; hypothesis: string | null; origin: string; clauses: Clause[]; primary?: boolean };
type Pred = Map<string, Map<string, Value>>;
/** A candidate whose own clauses predict two different values for one field of one situation (P5 correction 3, D92). */
export type SelfConflict = { conflict: Value[] };
export const isConflict = (v: unknown): v is SelfConflict => !!v && typeof v === 'object' && Array.isArray((v as SelfConflict).conflict);
const preds = (clauses: Clause[], sits: Situation[]): Pred => {
  const out: Pred = new Map();
  for (const c of clauses.filter((x): x is LawClause => x.form === 'law')) for (const [id, m] of evalLaw(c, sits).predictions) {
    const cur = out.get(id) ?? new Map<string, Value>();
    for (const [k, v] of m) {
      const prev = cur.get(k);
      if (!cur.has(k) || JSON.stringify(prev) === JSON.stringify(v)) { cur.set(k, v); continue; }
      const vals = isConflict(prev) ? prev.conflict : [prev as Value];
      cur.set(k, { conflict: vals.some(x => JSON.stringify(x) === JSON.stringify(v)) ? vals : [...vals, v] } as never); // never an ordinary prediction
    }
    out.set(id, cur);
  }
  return out;
};

/** Compare two candidates on one build's situations (pure). */
export function comparePair(a: Candidate, b: Candidate, sits: Situation[]) {
  const pa = preds(a.clauses, sits), pb = preds(b.clauses, sits), byId = new Map(sits.map(s => [s.id, s]));
  let identical = 0, aOnly = 0, bOnly = 0;
  const selfContradictory: { id: string; field: string; candidate: string; values: Value[] }[] = [];
  const separating: { id: string; field: string; predictions: Record<string, Value>; recordedOutcome: Value; matches: string }[] = [], missing: { id: string; field: string; predictions: Record<string, Value> }[] = [];
  for (const id of [...new Set([...pa.keys(), ...pb.keys()])].sort()) {
    const ma = pa.get(id) ?? new Map(), mb = pb.get(id) ?? new Map();
    for (const f of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
      if (!ma.has(f)) { if (isConflict(mb.get(f))) selfContradictory.push({ id, field: f, candidate: b.label, values: (mb.get(f) as SelfConflict).conflict }); else bOnly++; continue; }
      if (!mb.has(f)) { if (isConflict(ma.get(f))) selfContradictory.push({ id, field: f, candidate: a.label, values: (ma.get(f) as SelfConflict).conflict }); else aOnly++; continue; }
      const x = ma.get(f), y = mb.get(f);
      if (isConflict(x) || isConflict(y)) { // not compared: a candidate that predicts two values predicts nothing usable here
        if (isConflict(x)) selfContradictory.push({ id, field: f, candidate: a.label, values: x.conflict });
        if (isConflict(y)) selfContradictory.push({ id, field: f, candidate: b.label, values: y.conflict });
        continue;
      }
      if (JSON.stringify(x) === JSON.stringify(y)) { identical++; continue; }
      const o = byId.get(id)!.fields[f], predictions = { [a.label]: x as Value, [b.label]: y as Value };
      if (o === null || o === undefined) missing.push({ id, field: f, predictions });
      else separating.push({ id, field: f, predictions, recordedOutcome: o as Value, matches: o === x ? a.label : o === y ? b.label : 'neither' });
    }
  }
  const count = (w: string) => separating.filter(s => s.matches === w).length;
  const verdict = separating.length ? 'separated' : identical || missing.length ? 'indistinguishable-on-available-evidence' : 'no-common-predictions';
  const why = separating.length ? `${separating.length} situation-field pair(s) where the two predict different values and the outcome is recorded: the outcome matches ${a.label} in ${count(a.label)}, ${b.label} in ${count(b.label)}, neither in ${count('neither')}`
    : missing.length ? `the two predict different values in ${missing.length} situation-field pair(s), none with a recorded outcome; identical in ${identical}` + (identical ? '' : '')
    : identical ? `identical predictions on all ${identical} situation-field pair(s) where both predict (finite evidence: this does not make them the same rule)`
    : 'they never predict the same outcome field of the same situation';
  const selfBy = (l: string) => selfContradictory.filter(x => x.candidate === l).length;
  return { verdict, explanation: why + (selfContradictory.length ? `; ${selfContradictory.length} situation-field pair(s) excluded because a candidate is self-contradictory there` : ''),
    counts: { identical, contradictoryWithOutcome: separating.length, contradictoryWithoutOutcome: missing.length, nonOverlapping: { [a.label]: aOnly, [b.label]: bOnly }, selfContradictory: { [a.label]: selfBy(a.label), [b.label]: selfBy(b.label) } },
    selfContradictions: selfContradictory.slice(0, MAX),
    supportedBy: { [a.label]: count(a.label), [b.label]: count(b.label), neither: count('neither') },
    separatingSituations: separating.slice(0, MAX), separatingSituationIds: [...new Set(separating.map(s => s.id))].length, missingEvidence: missing.slice(0, MAX) };
}

/** Pure core: all candidate pairs on both partitions, per build label. */
export function discriminateCore(cands: Cand[], parts: Parts, spec: { rule: string; clauses: Clause[] }[], declared: [string, string][] = []) {
  const candidates: Candidate[] = [];
  for (const h of cands) if (h.kind !== 'abstention') for (const r of h.representations) {
    const chk = checkRepresentation(r.representation); if (chk.status === 'not-representable') continue;
    candidates.push({ id: r.id, label: `${h.ref}/${r.origin}/${r.id.slice(0, 8)}`, hypothesis: h.hypothesis, origin: r.origin, clauses: chk.clauses.flatMap(c => c.ok ? [c.clause] : []), primary: primaryOf(h).eligible });
  }
  for (const s of spec) candidates.push({ id: `spec:${s.rule}`, label: `spec ${s.rule}`, hypothesis: null, origin: 'spec-encoding (provisional)', clauses: s.clauses });
  const labels = [...new Set([...Object.keys(parts.discovery), ...Object.keys(parts.heldout)])].sort();
  const fits = (c: Candidate, label: string) => ['fits', 'fits-partially'].includes(observational('H↔O', c.clauses, parts.discovery[label] ?? [], 'discovery', label).value);
  const isDeclared = (a: Candidate, b: Candidate) => declared.some(([x, y]) => (x === a.hypothesis && y === b.hypothesis) || (x === b.hypothesis && y === a.hypothesis));
  const pairs = candidates.flatMap((a, i) => candidates.slice(i + 1).filter(b => !(a.hypothesis && a.hypothesis === b.hypothesis) && !(a.hypothesis === null && b.hypothesis === null)).map(b => {
    const byBuild = labels.map(label => {
      const d = comparePair(a, b, parts.discovery[label] ?? []), h = comparePair(a, b, parts.heldout[label] ?? []);
      return { build: label, bothFitDiscovery: fits(a, label) && fits(b, label), discovery: d, heldout: h,
        pattern: d.verdict !== 'separated' && h.verdict === 'separated' ? 'not separated on discovery, separated on held-out' : d.verdict === 'separated' ? 'separated on discovery' : h.verdict === 'indistinguishable-on-available-evidence' && d.verdict !== 'separated' ? 'indistinguishable on the available evidence' : 'no common predictions' };
    });
    const primary = [a, b].every(c => c.hypothesis === null || c.primary === true);
    return { candidates: [a.label, b.label], ids: [a.id, b.id], declaredCompetitors: isDeclared(a, b), involvesSpec: a.hypothesis === null || b.hypothesis === null, primaryAnalysis: primary, byBuild };
  }));
  const interest = (p: typeof pairs[number]) => (p.declaredCompetitors ? 0 : 2) + (p.byBuild.some(x => x.bothFitDiscovery && x.pattern === 'not separated on discovery, separated on held-out') ? 0 : 1);
  pairs.sort((x, y) => interest(x) - interest(y) || x.candidates.join().localeCompare(y.candidates.join()));
  return {
    schema: DISCRIMINATION_SCHEMA, evaluator: DISCRIMINATE_EVALUATOR,
    candidates: candidates.map(c => {
      const self = labels.flatMap(l => [...(parts.discovery[l] ?? []), ...(parts.heldout[l] ?? [])]), pr = preds(c.clauses, self);
      const conflicts = [...pr.values()].reduce((n, m) => n + [...m.values()].filter(isConflict).length, 0);
      return { id: c.id, label: c.label, hypothesis: c.hypothesis, origin: c.origin, primaryAnalysis: c.hypothesis === null ? 'reference' : c.primary === true, selfContradictory: conflicts > 0, selfContradictorySituationFields: conflicts };
    }),
    abstentions: cands.filter(h => h.kind === 'abstention').map(h => ({ hypothesis: h.hypothesis, ref: h.ref, note: 'explicit abstention: not a candidate and never treated as a prediction' })),
    withoutRepresentation: cands.filter(h => h.kind !== 'abstention' && !h.representations.length).map(h => h.ref),
    pairs,
    primaryRule: 'A pair enters the primary analysis only when every hypothesis candidate in it is primary-eligible (journal-verified, counted, from a session suitable for primary analysis; D91). Other pairs are preserved and flagged.',
    caveat: 'A self-contradictory candidate (two clauses predicting different values for one field of one situation) is flagged and those positions are never compared as predictions. Separation is by recorded outcomes on finitely many situations. "Indistinguishable on the available evidence" means these observations do not tell the candidates apart; it does not mean they are the same rule.',
  };
}

export function discriminate(exp: string, o: { at?: string; root?: string; encoding?: string } = {}) {
  const root = o.root ?? ROOT, inp = loadSealedInputs(exp, DISCRIMINATE_EVALUATOR, o);
  const declared = inp.nodes.filter(n => n.kind === 'hypothesis').flatMap(n => n.parents.filter(p => p.relation === 'alternative-to').map(p => [n.id, p.id] as [string, string]));
  const core = discriminateCore(inp.cands, inp.parts, inp.enc.usable, declared);
  const ledgerN = verifyLedger(join(exp, 'evaluation-ledger.ndjson')).count;
  const outF = assertWritableOutput(join(exp, 'evaluations', `discrimination-${ledgerN}.json`));
  mkdirSync(join(exp, 'evaluations'), { recursive: true });
  const report = { ...core, at: o.at ?? new Date().toISOString(), exp: (root === ROOT ? repoRelative(exp) : null) ?? exp, seal: { sha256: inp.seal.sealSha256 }, freeze: { sha256: inp.g.freezeSha256 }, specificationReference: { encoding: inp.enc.enc.id, review: inp.enc.enc.review.status } };
  writeFileSync(outF, JSON.stringify(report, null, 1) + '\n');
  return { report, file: outF };
}

if (process.argv[1]?.endsWith('gw2/discriminate.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const exp = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
  if (!exp) { console.error('usage: discriminate.ts <expDir> [--at ISO] [--encoding f]'); process.exit(2); }
  try { const r = discriminate(isAbsolute(exp) ? exp : join(process.cwd(), exp), { at: arg('--at'), encoding: arg('--encoding') }); console.log(`${r.report.pairs.length} pairs; report ${relative(process.cwd(), r.file)}`); }
  catch (e) { console.error((e as Error).message); process.exit(5); }
}

/**
 * GW2 P4: deterministic three-way verification (COMMON_SPEC §2.C). No model, no Kane, no generated code.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/verify.ts <expDir> [--encoding <file>] [--at <ISO>] [--confirmatory]
 *
 * Three relations, evaluated independently and never combined into a score:
 *   H↔O observational fit          a hypothesis's structured representation against recorded situations
 *                                  fits · fits-partially · contradicted (counter-examples) · insufficient-evidence · not-evaluable
 *   H↔S specification agreement    the representation's predictions against an encoded spec record's predictions on
 *                                  the same situations (inputs only; no outcome needed)
 *                                  agrees · disagrees (witnesses) · insufficient-evidence · not-evaluable
 *   O↔S implementation correctness an encoded spec record against recorded situations
 *                                  conforms · conforms-partially · deviates (witnesses) · insufficient-evidence · not-evaluable
 * Every result is scoped to one partition and one build and states its denominators: situations of the kind,
 * applicable, evaluated, and excluded with reasons (not applicable, missing input, missing outcome). Missing evidence is
 * never a counter-example. A finite set of situations never establishes a rule in general; outputs say so.
 *
 * The combined reading "accurate description of a defect" is given only when, for one spec rule, partition and build,
 * H↔O fits (fully or partially), H↔S disagrees and O↔S deviates, AND on every (situation, outcome field) where H and S
 * predict different values and that outcome is recorded, the recorded value is H's prediction (at least one such pair).
 * Agreement of the three relations on other situations or other outcome fields does not substitute for that.
 *
 * v2 (P4 corrections): outcome-level law checks (full vs partial support), cross-variant invariance comparisons with
 * partners, field-level correspondence triples, and separate denominators (unique situations, clause checks, outcome
 * checks, case/match units).
 *
 * Original hypotheses are never touched: the verifier reads `representation` nodes (separate nodes that `represents`
 * one hypothesis, with their own author and declared fidelity) appended BEFORE the first evaluation opening. Free text
 * is never interpreted. All partition content is read through the P3 gate (freeze.ts openEvaluation).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { verify as verifyGraph, append, fileSha256, sha256, type Node, type NodeInput } from './judgments.ts';
import { openEvaluation, verifyLedger, FreezeError } from './freeze.ts';
import { checkRepresentation, evalExpr, isUnknown, type Clause, type LawClause, type InvarianceClause, type Value } from './hypothesis.ts';
import { extractSituations, alignBuilds, type Situation } from './situations.ts';

export const VERIFIER = { id: 'gamewatch/gw2/verify.ts', version: '2.1' } as const; // 2.1: held-out builds aligned to discovery ids (D88)
export const DEFAULT_ENCODING = join(ROOT, 'gamewatch/gw2/spec-encodings/rule-sabotage-v6.1.json');
export const EVALUATION_SCHEMA = 'gamewatch/gw2-three-way@2';
const MAX_LIST = 12;

/** Denominators. Situations are counted once (unique ids); clause checks are (clause, situation) pairs; outcome checks
 * are (clause, situation, outcome field) triples; units are the distinct cases and matches the evaluated situations come
 * from (turns of one match are correlated, so a match is one unit, not one replicate per turn). */
export type OutcomeTally = { matching: number; contradicting: number; unknown: number; unpredicted: number; inconclusive: number };
export type Scope = {
  partition: string; build: string; situationKind: string;
  situationsOfKind: number; applicable: number; evaluated: number;
  support: { full: number; partial: number; counterExample: number; inconclusive: number };
  clauseChecks: number; outcomeChecks: OutcomeTally; comparisons?: number;
  units: { cases: number; matches: number };
  excluded: Record<string, number>; excludedUnit: string;
};
/** One outcome-level result. For a law: predicted = the clause's prediction. For an invariance: predicted = the value
 * recorded for the comparison partner (a situation of the same group with another combination of the varied fields). */
export type Pred = { id: string; field: string; predicted: Value; observed?: Value; partner?: string };
export type Check = { id: string; field: string; result: keyof OutcomeTally; predicted?: Value; observed?: Value; partner?: string };
export type SitStatus = 'full' | 'partial' | 'contradicted' | 'inconclusive';
export type ClauseEval = {
  evaluated: string[]; fit: string[]; partial: string[]; counter: Pred[]; excluded: Record<string, number>;
  applicable: number; applicableIds: string[]; ofKind: number; predictions: Map<string, Map<string, Value>>;
  status: Map<string, SitStatus>; checks: Check[]; outcomeChecks: OutcomeTally;
};
export type Comparison = { group: string; field: string; variants: [string, string]; values: [Value[], Value[]]; situations: [string, string]; result: 'consistent' | 'violation' | 'inconclusive' };

// ---------------------------------------------------------------- clause interpretation on situations
const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
const tally = (): OutcomeTally => ({ matching: 0, contradicting: 0, unknown: 0, unpredicted: 0, inconclusive: 0 });
const known = (v: unknown) => v !== null && v !== undefined;
const emptyEval = (ofKind: number): ClauseEval => ({ evaluated: [], fit: [], partial: [], counter: [], excluded: {}, applicable: 0, applicableIds: [], ofKind, predictions: new Map(), status: new Map(), checks: [], outcomeChecks: tally() });
/** Situation status from its outcome checks: any contradicted → contradicted; every expected outcome matched → full
 * support; at least one matched and the rest missing (no outcome recorded, or no prediction) → partial support. */
function sitStatus(cs: Check[]): SitStatus | null {
  if (cs.some(x => x.result === 'contradicting')) return 'contradicted';
  if (cs.length && cs.every(x => x.result === 'matching')) return 'full';
  if (cs.some(x => x.result === 'matching')) return 'partial';
  if (cs.some(x => x.result === 'inconclusive')) return 'inconclusive';
  return null;
}
function record(r: ClauseEval, id: string, cs: Check[], why: () => string) {
  r.checks.push(...cs); for (const x of cs) r.outcomeChecks[x.result]++;
  const st = sitStatus(cs);
  if (!st) { inc(r.excluded, why()); return; }
  r.evaluated.push(id); r.status.set(id, st);
  if (st === 'full') r.fit.push(id); else if (st === 'partial') r.partial.push(id);
  for (const x of cs) if (x.result === 'contradicting') r.counter.push({ id, field: x.field, predicted: x.predicted!, observed: x.observed, ...(x.partner ? { partner: x.partner } : {}) });
}

/** Interpret one law on situations, outcome by outcome: predictions (from inputs) and, where outcomes are recorded,
 * match / contradicted; an outcome that is not recorded is unknown and is neither support nor a counter-example. */
export function evalLaw(c: LawClause, sits: Situation[]): ClauseEval {
  const of = sits.filter(s => s.kind === c.situation), r = emptyEval(of.length);
  for (const s of of) {
    const w = c.when ? evalExpr(c.when, s.fields as Record<string, Value | null>) : true;
    if (isUnknown(w)) { inc(r.excluded, `missing input (${w.unknown.join(', ')})`); continue; }
    if (w !== true) { inc(r.excluded, 'not applicable (condition false)'); continue; }
    r.applicable++; r.applicableIds.push(s.id);
    const preds = new Map<string, Value>(), cs: Check[] = [], missingIn: string[] = [], missingOut: string[] = [];
    for (const x of c.expect) {
      const p = evalExpr(x.equals, s.fields as Record<string, Value | null>);
      if (isUnknown(p)) { missingIn.push(...p.unknown); cs.push({ id: s.id, field: x.field, result: 'unpredicted' }); continue; }
      preds.set(x.field, p);
      const o = s.fields[x.field];
      if (!known(o)) { missingOut.push(x.field); cs.push({ id: s.id, field: x.field, result: 'unknown', predicted: p }); continue; }
      cs.push({ id: s.id, field: x.field, result: o === p ? 'matching' : 'contradicting', predicted: p, observed: o as Value });
    }
    if (preds.size) r.predictions.set(s.id, preds);
    record(r, s.id, cs, () => missingIn.length && !preds.size ? `missing input (${[...new Set(missingIn)].sort().join(', ')})` : `missing outcome (${[...new Set(missingOut)].sort().join(', ')})`);
  }
  return r;
}

/**
 * Interpret one invariance: within a group (same groupBy values), the outcomes of DIFFERENT combinations of the varied
 * fields are compared, outcome field by outcome field, using recorded values only. Two variants violate the invariance
 * on a field only when their recorded value sets are disjoint; identical single values are consistent; overlapping but
 * different sets (values that already differ within one variant) are inconclusive, not a violation. A situation with
 * no recorded outcome, or without a partner variant that has one, is excluded (missing evidence is not invariance).
 */
export function evalInvariance(c: InvarianceClause, sits: Situation[]): ClauseEval & { groups: { key: string; variants: number; differing: boolean }[]; comparisons: Comparison[] } {
  const of = sits.filter(s => s.kind === c.situation), r = { ...emptyEval(of.length), groups: [] as { key: string; variants: number; differing: boolean }[], comparisons: [] as Comparison[] };
  const groups = new Map<string, Situation[]>();
  for (const s of of) {
    const w = c.when ? evalExpr(c.when, s.fields as Record<string, Value | null>) : true;
    if (isUnknown(w)) { inc(r.excluded, `missing input (${w.unknown.join(', ')})`); continue; }
    if (w !== true) { inc(r.excluded, 'not applicable (condition false)'); continue; }
    const miss = [...c.groupBy, ...c.vary].filter(k => !known(s.fields[k]));
    if (miss.length) { inc(r.excluded, `missing input (${miss.sort().join(', ')})`); continue; }
    r.applicable++; r.applicableIds.push(s.id);
    const key = JSON.stringify(c.groupBy.map(k => s.fields[k]));
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const [key, gs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const variants = new Map<string, Situation[]>();
    for (const s of gs) { const v = JSON.stringify(c.vary.map(k => s.fields[k])); variants.set(v, [...(variants.get(v) ?? []), s]); }
    const vs = [...variants.entries()].sort(([a], [b]) => a.localeCompare(b));
    const checks = new Map<string, Map<string, Check>>(); // situation → field → check (worst result kept)
    const rank: Record<keyof OutcomeTally, number> = { contradicting: 4, inconclusive: 3, matching: 2, unknown: 1, unpredicted: 0 };
    const put = (x: Check) => { const m = checks.get(x.id) ?? new Map<string, Check>(); const old = m.get(x.field); if (!old || rank[x.result] > rank[old.result]) m.set(x.field, x); checks.set(x.id, m); };
    let differing = false;
    for (const o of c.outcomes) {
      const withVal = vs.map(([v, ss]) => ({ v, ss: ss.filter(s => known(s.fields[o])) })).filter(x => x.ss.length);
      for (const [, ss] of vs) for (const s of ss) put({ id: s.id, field: o, result: known(s.fields[o]) ? 'unpredicted' : 'unknown' });
      for (let i = 0; i < withVal.length; i++) for (let j = i + 1; j < withVal.length; j++) {
        const A = withVal[i], B = withVal[j];
        const va = [...new Set(A.ss.map(s => JSON.stringify(s.fields[o])))].sort(), vb = [...new Set(B.ss.map(s => JSON.stringify(s.fields[o])))].sort();
        const disjoint = !va.some(x => vb.includes(x)), same = va.length === 1 && vb.length === 1 && va[0] === vb[0];
        const result = disjoint ? 'violation' : same ? 'consistent' : 'inconclusive';
        r.comparisons.push({ group: key, field: o, variants: [A.v, B.v], values: [va.map(x => JSON.parse(x)), vb.map(x => JSON.parse(x))], situations: [A.ss[0].id, B.ss[0].id], result });
        if (disjoint) differing = true;
        for (const [X, Y] of [[A, B], [B, A]] as const) for (const s of X.ss)
          put({ id: s.id, field: o, result: disjoint ? 'contradicting' : same ? 'matching' : 'inconclusive', predicted: Y.ss[0].fields[o] as Value, observed: s.fields[o] as Value, partner: Y.ss[0].id });
      }
    }
    for (const s of gs) {
      const cs = c.outcomes.map(o => checks.get(s.id)!.get(o)!);
      record(r, s.id, cs, () => variants.size < 2 ? 'no comparison partner (only one combination of the varied fields in its group)'
        : cs.every(x => x.result === 'unknown') ? `missing outcome (${c.outcomes.join(', ')})` : 'no comparison partner with a recorded outcome');
    }
    r.groups.push({ key, variants: variants.size, differing });
  }
  return r;
}

const evalClause = (c: Clause, sits: Situation[]) => c.form === 'law' ? evalLaw(c, sits) : evalInvariance(c, sits);
const firstN = <T>(xs: T[]) => xs.slice(0, MAX_LIST);
const scopeText = (n: number, p: string, b: string, kind: string) => `on ${n} evaluated ${kind} situation(s) from partition ${p}, build ${b}`;

/** Aggregate denominators over clause evaluations (unique situations; clause checks; outcome checks; case/match units). */
function scopeOf(per: ClauseEval[], clauses: Clause[], sits: Situation[], partition: string, build: string, comparisons?: number): Scope {
  const kinds = [...new Set(clauses.map(c => c.situation))];
  const evaluated = [...new Set(per.flatMap(r => r.evaluated))], src = new Map(sits.map(s => [s.id, s.source]));
  const support = { full: 0, partial: 0, counterExample: 0, inconclusive: 0 };
  for (const id of evaluated) {
    const st = per.flatMap(r => r.status.has(id) ? [r.status.get(id)!] : []);
    support[st.includes('contradicted') ? 'counterExample' : st.every(x => x === 'full') ? 'full' : st.includes('full') || st.includes('partial') ? 'partial' : 'inconclusive']++;
  }
  const outcomeChecks = tally(); for (const r of per) for (const k of Object.keys(outcomeChecks) as (keyof OutcomeTally)[]) outcomeChecks[k] += r.outcomeChecks[k];
  const excluded: Record<string, number> = {};
  per.forEach((r, i) => { for (const [k, n] of Object.entries(r.excluded)) { const key = per.length > 1 ? `clause ${i}: ${k}` : k; excluded[key] = (excluded[key] ?? 0) + n; } });
  const unit = (t: string) => new Set(evaluated.filter(id => src.get(id)?.type === t).map(id => src.get(id)!.id)).size;
  return { partition, build, situationKind: kinds.join('+') || 'none', situationsOfKind: sits.filter(s => kinds.includes(s.kind as never)).length,
    applicable: new Set(per.flatMap(r => r.applicableIds)).size, evaluated: evaluated.length, support,
    clauseChecks: per.reduce((n, r) => n + r.evaluated.length, 0), outcomeChecks, ...(comparisons !== undefined ? { comparisons } : {}),
    units: { cases: unit('case'), matches: unit('match') }, excluded, excludedUnit: 'clause-situation pairs (keyed by clause when there is more than one)' };
}

// ---------------------------------------------------------------- relations
type ObsRel = { relation: 'H↔O' | 'O↔S'; value: string; scope: Scope; statement: string; witnesses: string[]; witnessCount: number; witnessesBySource: { case: number; match: number }; counterExamples: Pred[]; counterCount: number;
  clauses: { index: number; value: string; applicable: number; evaluated: number; full: number; partial: number; counter: number; outcomeChecks: OutcomeTally; comparisons?: Comparison[]; comparisonCount?: number }[] };

/** H↔O (for a hypothesis) or O↔S (for a spec record): clauses evaluated on recorded outcomes. Full support (every
 * expected outcome recorded and matching) is kept apart from partial support (some outcomes not recorded). */
export function observational(rel: 'H↔O' | 'O↔S', clauses: Clause[], sits: Situation[], partition: string, build: string): ObsRel {
  const yes = rel === 'H↔O' ? 'fits' : 'conforms', part = `${yes}-partially`, no = rel === 'H↔O' ? 'contradicted' : 'deviates';
  const per = clauses.map((c, i) => ({ i, c, r: evalClause(c, sits) }));
  const vals = per.map(({ r }) => r.counter.length ? no : r.fit.length ? yes : r.partial.length ? part : 'insufficient-evidence');
  const value = vals.includes(no) ? no : vals.every(v => v === yes) ? yes : vals.every(v => v === yes || v === part) ? part : 'insufficient-evidence';
  const comps = per.flatMap(({ r }) => 'comparisons' in r ? [(r as { comparisons: Comparison[] }).comparisons] : []);
  const scope = scopeOf(per.map(x => x.r), clauses, sits, partition, build, comps.length ? comps.flat().length : undefined);
  const counter = per.flatMap(({ r }) => r.counter), kinds = scope.situationKind, n = scope.evaluated;
  const witnesses = value === no ? [...new Set(counter.map(x => x.id))] : [...new Set(per.flatMap(({ r }) => [...r.fit, ...r.partial]))];
  const sup = `${scope.support.full} with full support, ${scope.support.partial} with partial support (some expected outcomes not recorded)`;
  const statement = value === yes || value === part ? `${value} ${scopeText(n, partition, build, kinds)}: ${sup}; no counter-example among them (finite evidence: this does not establish the rule for situations not evaluated)`
    : value === no ? `${no} ${scopeText(n, partition, build, kinds)}: ${counter.length} contradicted outcome check(s) in ${new Set(counter.map(x => x.id)).size} situation(s)`
    : `insufficient evidence ${scopeText(n, partition, build, kinds)}: ${vals.filter(v => v === 'insufficient-evidence').length} of ${clauses.length} clause(s) had no evaluable situation`;
  const src = new Map(sits.map(s => [s.id, s.source.type]));
  return { relation: rel, value, scope, statement, witnesses: firstN(witnesses), witnessCount: witnesses.length, witnessesBySource: { case: witnesses.filter(id => src.get(id) === 'case').length, match: witnesses.filter(id => src.get(id) === 'match').length }, counterExamples: firstN(counter), counterCount: counter.length,
    clauses: per.map(({ i, r }, k) => ({ index: i, value: vals[k], applicable: r.applicable, evaluated: r.evaluated.length, full: r.fit.length, partial: r.partial.length, counter: r.counter.length, outcomeChecks: r.outcomeChecks,
      ...('comparisons' in r ? { comparisons: firstN((r as { comparisons: Comparison[] }).comparisons.filter(x => x.result !== 'consistent')), comparisonCount: (r as { comparisons: Comparison[] }).comparisons.length } : {}) })) };
}

/** One H↔S disagreement, at the level of situation AND outcome field. */
export type Disagreement = { id: string; field: string; hypothesisPrediction: Value; specPrediction: Value };
type SpecRel = { relation: 'H↔S'; rule: string; value: string; scope: Scope; statement: string; disagreements: Disagreement[]; disagreementCount: number; disagreementIds: string[]; agreementCount: number; comparedFields: string[]; fieldComparisons: number; reason?: string };

/** H↔S raw comparison: every (situation, field) where both a hypothesis law and a spec law predict a value. */
export function compareWithSpec(h: Clause[], s: Clause[], sits: Situation[]) {
  const hl = h.filter((c): c is LawClause => c.form === 'law'), sl = s.filter((c): c is LawClause => c.form === 'law');
  const pairs = hl.flatMap(a => sl.filter(b => b.situation === a.situation && b.expect.some(x => a.expect.some(y => y.field === x.field))).map(b => [a, b] as const));
  const dis: Disagreement[] = [], agree: { id: string; field: string }[] = [], excluded: Record<string, number> = {}, applicable = new Set<string>(), seen = new Set<string>();
  for (const [a, b] of pairs) {
    const ra = evalLaw(a, sits), rb = evalLaw(b, sits);
    for (const sit of sits.filter(x => x.kind === a.situation)) {
      const pa = ra.predictions.get(sit.id), pb = rb.predictions.get(sit.id);
      if (!pa && !pb) { inc(excluded, 'neither applies or inputs missing'); continue; }
      if (!pa) { inc(excluded, 'hypothesis silent (spec applies)'); continue; }
      if (!pb) { inc(excluded, 'spec silent (hypothesis applies)'); continue; }
      applicable.add(sit.id);
      const common = [...pa.keys()].filter(k => pb.has(k));
      if (!common.length) { inc(excluded, 'no common predicted field'); continue; }
      for (const k of common) {
        const key = JSON.stringify([sit.id, k, pa.get(k), pb.get(k)]); if (seen.has(key)) continue; seen.add(key);
        if (pa.get(k) !== pb.get(k)) dis.push({ id: sit.id, field: k, hypothesisPrediction: pa.get(k)!, specPrediction: pb.get(k)! }); else agree.push({ id: sit.id, field: k });
      }
    }
  }
  return { hl, sl, pairs, dis, agree, excluded, applicable };
}

/** H↔S for one spec record: predictions compared on the same situations and outcome fields (law clauses only). */
export function specAgreement(h: Clause[], s: Clause[], rule: string, sits: Situation[], partition: string, build: string): SpecRel {
  const x = compareWithSpec(h, s, sits), kinds = [...new Set(x.pairs.map(([a]) => a.situation))];
  const ids = (xs: { id: string }[]) => new Set(xs.map(y => y.id)), disIds = ids(x.dis), agreeIds = new Set([...ids(x.agree)].filter(id => !disIds.has(id)));
  const evaluated = agreeIds.size + disIds.size, src = new Map(sits.map(y => [y.id, y.source])), ev = [...agreeIds, ...disIds];
  const unit = (t: string) => new Set(ev.filter(id => src.get(id)?.type === t).map(id => src.get(id)!.id)).size;
  const scope: Scope = { partition, build, situationKind: kinds.join('+') || 'none', situationsOfKind: sits.filter(y => kinds.includes(y.kind as never)).length, applicable: x.applicable.size, evaluated,
    support: { full: 0, partial: 0, counterExample: 0, inconclusive: 0 }, clauseChecks: 0, outcomeChecks: tally(), comparisons: x.dis.length + x.agree.length, units: { cases: unit('case'), matches: unit('match') }, excluded: x.excluded, excludedUnit: 'clause-pair-situation triples' };
  if (!x.pairs.length) {
    const why = !x.hl.length ? 'the representation has no law clause (an invariance cannot be compared prediction by prediction)' : !x.sl.length ? `the encoded record ${rule} has no law clause` : `no clause of the representation predicts the same outcome field of the same situation kind as ${rule}`;
    return { relation: 'H↔S', rule, value: 'not-evaluable', scope, statement: `not evaluable against ${rule}: ${why}`, disagreements: [], disagreementCount: 0, disagreementIds: [], agreementCount: 0, comparedFields: [], fieldComparisons: 0, reason: why };
  }
  const value = disIds.size ? 'disagrees' : evaluated ? 'agrees' : 'insufficient-evidence';
  const statement = value === 'agrees' ? `agrees with ${rule} ${scopeText(evaluated, partition, build, scope.situationKind)} (same predicted values on ${x.agree.length} situation-field comparison(s); finite situations only)`
    : value === 'disagrees' ? `disagrees with ${rule} ${scopeText(evaluated, partition, build, scope.situationKind)}: different predictions for ${x.dis.length} situation-field pair(s) in ${disIds.size} situation(s)`
    : `insufficient evidence against ${rule}: no situation in partition ${partition}, build ${build} where both make a prediction`;
  return { relation: 'H↔S', rule, value, scope, statement, disagreements: firstN(x.dis), disagreementCount: x.dis.length, disagreementIds: [...disIds].sort(), agreementCount: agreeIds.size,
    comparedFields: [...new Set([...x.dis, ...x.agree].map(y => y.field))].sort(), fieldComparisons: x.dis.length + x.agree.length };
}

// ---------------------------------------------------------------- combined reading
/** A correspondence triple: one H↔S disagreement with the outcome recorded for that situation and field. */
export type Triple = Disagreement & { recordedOutcome: Value | null; corresponds: boolean | null };
/**
 * Combined reading for one (hypothesis representation, spec rule, partition, build), matched at the level of situation
 * AND outcome field. A disagreement (s, f) CORRESPONDS when the outcome of f in s is recorded, equals the hypothesis's
 * prediction and differs from the spec's prediction. One whose outcome is recorded and does not equal the hypothesis's
 * prediction is non-corresponding. One without a recorded outcome is counted and is evidence for neither reading. The
 * build's deviations from the spec on other (situation, field) pairs are reported, never used as support.
 */
export function combined(ho: ObsRel, hs: SpecRel, os: ObsRel | null, dis: Disagreement[], outcomeOf: (id: string, field: string) => Value | null, specDeviations: { id: string; field: string }[] = []) {
  if (!os || os.value === 'not-evaluable' || hs.value === 'not-evaluable' || ho.value === 'not-evaluable') return { reading: 'not-evaluable', explanation: 'at least one relation could not be evaluated' };
  if (ho.value === 'contradicted') return { reading: 'hypothesis-contradicted-by-observations', explanation: `H↔O contradicted in partition ${ho.scope.partition}, build ${ho.scope.build}` };
  if ([ho.value, hs.value, os.value].includes('insufficient-evidence')) return { reading: 'unresolved-ambiguity', explanation: 'at least one relation has insufficient evidence on these situations' };
  const hFits = ho.value === 'fits' || ho.value === 'fits-partially', sConf = os.value === 'conforms' || os.value === 'conforms-partially';
  const support = ho.value === 'fits' ? 'full' : 'partial';
  if (hFits && hs.value === 'disagrees' && os.value === 'deviates') {
    const triples: Triple[] = dis.map(d => { const o = outcomeOf(d.id, d.field); return { ...d, recordedOutcome: o, corresponds: o === null ? null : o === d.hypothesisPrediction && o !== d.specPrediction }; });
    const yes = triples.filter(t => t.corresponds === true), no = triples.filter(t => t.corresponds === false), none = triples.filter(t => t.corresponds === null);
    const key = (x: { id: string; field: string }) => `${x.id}\u0000${x.field}`, described = new Set(yes.map(key));
    const correspondence = { unit: 'situation-field pairs where the hypothesis and the spec predict different values', disagreements: triples.length, corresponding: yes.length, nonCorresponding: no.length, withoutRecordedOutcome: none.length,
      correspondingSituations: new Set(yes.map(t => t.id)).size, specDeviationsNotDescribed: specDeviations.filter(d => !described.has(key(d))).length,
      examples: { corresponding: firstN(yes), nonCorresponding: firstN(no), withoutRecordedOutcome: firstN(none) } };
    const extra = { correspondence, correspondingSituations: correspondence.correspondingSituations, disagreementsWithoutRecordedOutcome: none.length, hypothesisSupport: support };
    if (!yes.length && !no.length) return { reading: 'unresolved-ambiguity', explanation: `the hypothesis and the spec disagree on ${triples.length} situation-field pair(s), none with a recorded outcome for that field`, ...extra };
    if (no.length) return { reading: 'relations-do-not-correspond', explanation: `on ${no.length} of ${yes.length + no.length} disagreement situation-field pair(s) with a recorded outcome, the recorded outcome is not the hypothesis's prediction`, ...extra };
    return { reading: 'accurate-description-of-a-defect', explanation: `on every one of the ${yes.length} situation-field pair(s) where the hypothesis and the spec predict different values and that outcome is recorded, the recorded outcome is the hypothesis's prediction and not the spec's (${none.length} further pair(s) have no recorded outcome; ${correspondence.specDeviationsNotDescribed} deviation(s) of the build from this spec record are on other situation-field pairs and are not used); this describes the build's behaviour, not the intended rule`, ...extra };
  }
  if (hFits && hs.value === 'agrees' && sConf) return { reading: 'consistent-with-specification-and-observations', explanation: `all three relations agree on the evaluated situations (finite evidence; hypothesis support ${support}, spec ${os.value})`, hypothesisSupport: support };
  return { reading: 'relations-do-not-correspond', explanation: `H↔O ${ho.value}, H↔S ${hs.value}, O↔S ${os.value}${hFits && hs.value === 'agrees' && os.value === 'deviates' ? ': the build deviates from the spec in outcomes or situations this hypothesis does not predict' : ''}` };
}

// ---------------------------------------------------------------- spec encoding
export type EncodingRecord = { rule: string; sourceTextSha256: string; status: 'encoded' | 'unencoded'; supportedScope?: string; limitations?: string[]; reason?: string; representation?: unknown };
export type Encoding = { schema: string; id: string; status: string; review: { status: string; reviewer: string | null; acceptedBy: string | null }; encodingAuthor: unknown; source: unknown; records: EncodingRecord[] };
export function loadEncoding(file: string, rules: { id: string; text: string }[]) {
  const enc = JSON.parse(readFileSync(file, 'utf8')) as Encoding, usable: { rule: string; clauses: Clause[] }[] = [], inventory: Record<string, unknown>[] = [];
  if (enc.schema !== 'gamewatch/gw2-spec-encoding@1') throw new Error(`${file}: not a gw2-spec-encoding@1 file`);
  for (const r of enc.records) {
    const text = rules.find(x => x.id === r.rule)?.text;
    const bound = text !== undefined && sha256(text) === r.sourceTextSha256;
    const chk = r.status === 'encoded' ? checkRepresentation(r.representation) : null;
    const status = !bound ? 'source-mismatch' : r.status === 'unencoded' ? 'unencoded' : chk!.status === 'represented' ? 'encoded' : 'invalid-encoding';
    inventory.push({ rule: r.rule, status, ...(r.status === 'encoded' ? { clauses: chk!.clauses.length, scope: r.supportedScope, limitations: r.limitations?.length ?? 0 } : { reason: r.reason }), ...(status === 'invalid-encoding' ? { problems: chk!.problems } : {}) });
    if (status === 'encoded') usable.push({ rule: r.rule, clauses: chk!.clauses.flatMap(c => c.ok ? [c.clause] : []) });
  }
  for (const x of rules) if (!enc.records.some(r => r.rule === x.id)) inventory.push({ rule: x.id, status: 'not-listed' });
  return { enc, usable, inventory, sha256: fileSha256(file), authoritative: enc.review?.status === 'accepted' && typeof enc.review.acceptedBy === 'string' };
}

// ---------------------------------------------------------------- the pure evaluation core
export type HypInput = { id: string; kind: string; representations: { id: string; author: unknown; representation: unknown; fidelity: unknown }[] };
export type PartitionInput = { partition: string; builds: string[]; situations: Situation[] };

export const FIDELITY = ['faithful', 'narrower', 'broader', 'different', 'unknown'] as const;
const fidelityOf = (f: unknown) => { const d = (f as { declared?: unknown } | null)?.declared; return (FIDELITY as readonly unknown[]).includes(d) ? d as string : 'unknown'; };
const APPLIES_TO = 'the structured representation only (fidelity as declared by its author, not checked by the verifier); the free-text hypothesis is preserved verbatim and is not interpreted';

/** Pure and deterministic: the same inputs give the same JSON (no clock, no randomness, no file access). */
export function threeWay(hyps: HypInput[], parts: PartitionInput[], spec: { usable: { rule: string; clauses: Clause[] }[] }) {
  const specObs = parts.flatMap(p => p.builds.map(b => {
    const sits = p.situations.filter(s => s.build === b);
    return spec.usable.map(r => ({ rule: r.rule, partition: p.partition, build: b, os: observational('O↔S', r.clauses, sits, p.partition, b) }));
  })).flat();
  const osOf = (rule: string, p: string, b: string) => specObs.find(x => x.rule === rule && x.partition === p && x.build === b)?.os ?? null;
  const results = hyps.map(h => {
    if (h.kind === 'abstention') return { hypothesis: h.id, status: 'explicit-abstention', note: 'an explicit abstention is recorded as such; it is neither supported nor unsupported', representations: [] };
    if (!h.representations.length) return { hypothesis: h.id, status: 'not-evaluable', note: 'no structured representation was recorded before evaluation opened; free text is not interpreted by the verifier', representations: [] };
    const reps = h.representations.map(rep => {
      const chk = checkRepresentation(rep.representation);
      const clauses = chk.clauses.flatMap(c => c.ok ? [c.clause] : []);
      const notRep = chk.clauses.filter(c => !c.ok).map(c => ({ index: c.index, problems: (c as { problems: string[] }).problems }));
      if (chk.status === 'not-representable') return { representation: rep.id, representationStatus: chk.status, fidelityDeclared: fidelityOf(rep.fidelity), appliesTo: APPLIES_TO, problems: chk.problems, byPartition: [] };
      const byPartition = parts.flatMap(p => p.builds.map(b => {
        const sits = p.situations.filter(s => s.build === b), ho = observational('H↔O', clauses, sits, p.partition, b);
        const byId = new Map(sits.map(y => [y.id, y])), outcomeOf = (id: string, field: string) => { const v = byId.get(id)?.fields[field]; return v === null || v === undefined ? null : v as Value; };
        const hs = spec.usable.map(r => specAgreement(clauses, r.clauses, r.rule, sits, p.partition, b));
        const comparable = hs.filter(x => x.value !== 'not-evaluable');
        const readings = comparable.map(x => {
          const os = osOf(x.rule, p.partition, b), sr = spec.usable.find(r => r.rule === x.rule)!.clauses;
          const dis = compareWithSpec(clauses, sr, sits).dis;
          const dev = sr.flatMap(c => evalClause(c, sits).counter.map(y => ({ id: y.id, field: y.field })));
          return { rule: x.rule, ...combined(ho, x, os, dis, outcomeOf, dev), relations: { 'H↔O': ho.value, 'H↔S': x.value, 'O↔S': os?.value ?? 'not-evaluable' } };
        });
        const summary = ho.value === 'fits' ? 'supported-on-evaluated-situations' : ho.value === 'fits-partially' ? 'partially-supported-on-evaluated-situations' : ho.value === 'contradicted' ? 'unsupported' : ho.value;
        return { partition: p.partition, build: b, summary, 'H↔O': ho, 'H↔S': comparable, 'H↔S-not-comparable': hs.filter(x => x.value === 'not-evaluable').map(x => ({ rule: x.rule, reason: x.reason })), readings };
      }));
      return { representation: rep.id, representationStatus: chk.status, fidelityDeclared: fidelityOf(rep.fidelity), appliesTo: APPLIES_TO, notRepresentedClauses: notRep, byPartition };
    });
    const st = reps.map(r => r.representationStatus);
    return { hypothesis: h.id, status: st.every(s => s === 'not-representable') ? 'not-representable' : 'evaluated', representations: reps };
  });
  // identifiability: candidates that fit the same partition/build and predict identically on every common situation
  const fitting: { who: string; partition: string; build: string; preds: Map<string, Map<string, Value>> }[] = [];
  for (const h of hyps) for (const rep of h.representations) {
    const chk = checkRepresentation(rep.representation); if (chk.status === 'not-representable') continue;
    const laws = chk.clauses.flatMap(c => c.ok && c.clause.form === 'law' ? [c.clause] : []); if (!laws.length) continue;
    for (const p of parts) for (const b of p.builds) {
      const sits = p.situations.filter(s => s.build === b);
      if (!['fits', 'fits-partially'].includes(observational('H↔O', laws, sits, p.partition, b).value)) continue;
      const preds = new Map<string, Map<string, Value>>();
      for (const l of laws) for (const [id, m] of evalLaw(l, sits).predictions) preds.set(id, new Map([...(preds.get(id) ?? []), ...m]));
      fitting.push({ who: `representation ${rep.id}`, partition: p.partition, build: b, preds });
    }
  }
  for (const r of spec.usable) for (const p of parts) for (const b of p.builds) {
    const laws = r.clauses.filter((c): c is LawClause => c.form === 'law'), sits = p.situations.filter(s => s.build === b);
    if (!laws.length || !['conforms', 'conforms-partially'].includes(observational('O↔S', laws, sits, p.partition, b).value)) continue;
    const preds = new Map<string, Map<string, Value>>();
    for (const l of laws) for (const [id, m] of evalLaw(l, sits).predictions) preds.set(id, new Map([...(preds.get(id) ?? []), ...m]));
    fitting.push({ who: `spec ${r.rule}`, partition: p.partition, build: b, preds });
  }
  const identifiability = fitting.flatMap((a, i) => fitting.slice(i + 1).filter(b => b.partition === a.partition && b.build === a.build).flatMap(b => {
    const common = [...a.preds.keys()].filter(id => b.preds.has(id)).flatMap(id => [...a.preds.get(id)!.keys()].filter(k => b.preds.get(id)!.has(k)).map(k => [id, k] as const));
    if (!common.length) return [];
    const differ = common.filter(([id, k]) => a.preds.get(id)!.get(k) !== b.preds.get(id)!.get(k)).length;
    return differ ? [] : [{ partition: a.partition, build: a.build, candidates: [a.who, b.who], commonPredictions: common.length, note: 'both fit and predict the same values on every common situation here: these observations do not tell them apart' }];
  }));
  return {
    schema: EVALUATION_SCHEMA, evaluator: VERIFIER,
    criteria: 'COMMON_SPEC §2.C relations, evaluated separately per partition and build over situations extracted by gamewatch/gw2/situations.ts; law clauses checked outcome field by outcome field (full support only when every expected outcome is recorded and matches; partial support kept separate); invariance clauses by disjoint recorded value sets across different combinations of the varied fields, with comparison partners; unknown fields excluded as missing evidence; the combined reading is matched per situation and outcome field; denominators count unique situations, clause checks, outcome checks and case/match units separately',
    caveat: 'Every verdict is scoped to the evaluated situations. Finite observations do not establish a rule for situations that were not evaluated, and fitting observations does not identify a unique rule.',
    implementationCorrectness: specObs.map(x => ({ rule: x.rule, ...x.os })),
    hypotheses: results, identifiability,
  };
}

// ---------------------------------------------------------------- pipeline: gate → core → evaluates nodes
const refPath = (abs: string, root: string) => (root === ROOT ? repoRelative(abs) : null) ?? abs;

export function evaluateExperiment(exp: string, o: { encoding?: string; at?: string; root?: string; confirmatory?: boolean; partitions?: ('discovery' | 'heldout')[] } = {}) {
  const root = o.root ?? ROOT, graphF = join(exp, 'judgments.ndjson'), encF = o.encoding ?? DEFAULT_ENCODING;
  const g = openEvaluation(exp, VERIFIER, { root });
  const spec = JSON.parse(g.read('spec', 'spec.json')) as { game: { rules: { id: string; text: string }[] } };
  const enc = loadEncoding(encF, spec.game.rules);
  if (o.confirmatory && !enc.authoritative) throw new FreezeError(`confirmatory evaluation refused: the specification encoding ${enc.enc.id} is ${enc.enc.review?.status ?? 'unreviewed'} (Q3: only an encoding reviewed and accepted by the operator may be an authoritative reference)`);
  const evalMap = JSON.parse(g.read('eval', 'eval.json')).idMaps as Record<string, { builds: Record<string, string> }>;
  // D88: hypotheses are written in discovery build ids; held-out situations are relabelled to them (same original build)
  const buildLabels: Record<string, Record<string, string>> = {};
  const parts: PartitionInput[] = (o.partitions ?? ['discovery', 'heldout']).map(p => {
    const obs = JSON.parse(g.read(p, 'observations.json')), own = evalMap[p]?.builds ?? {};
    const al = alignBuilds(extractSituations(obs), own, evalMap.discovery?.builds ?? {});
    const ids = (obs.builds as string[]).map(b => al.alignment[b]?.discoveryId ?? b);
    buildLabels[p] = Object.fromEntries((obs.builds as string[]).map(b => [al.alignment[b]?.discoveryId ?? b, own[b] ?? b]));
    return { partition: p, builds: [...ids].sort(), situations: al.sits };
  });
  // representations: only those appended before the FIRST evaluation opening, representing a frozen hypothesis
  const firstOpen = verifyLedger(join(exp, 'evaluation-ledger.ndjson')).entries.find(e => e.event === 'opened');
  const cutoff = Number(firstOpen?.graphHead?.count ?? 0);
  const v = verifyGraph(graphF, { checkRefs: true, root });
  if (!v.ok) throw new FreezeError(`the judgment graph fails verification at line ${v.firstBadLine}; nothing evaluated`);
  const frozen = new Set(g.frozen), lateReps: string[] = [];
  const reps = v.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.kind === 'representation');
  const hyps: HypInput[] = v.nodes.filter(n => frozen.has(n.id)).map(n => ({
    id: n.id, kind: n.kind,
    representations: reps.filter(({ n: r }) => r.parents.some(p => p.id === n.id && p.relation === 'represents')).flatMap(({ n: r, i }) => {
      if (i >= cutoff) { lateReps.push(r.id); return []; }
      return [{ id: r.id, author: r.author, representation: (r.body as Record<string, unknown>).representation, fidelity: (r.body as Record<string, unknown>).fidelity }];
    }),
  }));
  const result = threeWay(hyps, parts, enc);
  const report = {
    ...result, exp: refPath(exp, root), operatorView: { buildLabels, note: 'neutral build ids mapped to the original labels (read from eval/ through the gate); for the operator, never shown to discovery sessions' },
    specificationReference: { encoding: enc.enc.id, file: refPath(encF, root), sha256: enc.sha256, status: enc.enc.status, review: enc.enc.review.status, authoritative: enc.authoritative, inventory: enc.inventory,
      note: enc.authoritative ? 'accepted by the operator' : 'provisional and unreviewed (Q3): H↔S and O↔S results are relative to this draft encoding and are not authoritative for confirmatory experiments' },
    freeze: { sha256: g.freezeSha256, frozen: g.frozen.length, notCoveredExcluded: g.notCovered },
    representationsExcluded: { appendedAfterFirstEvaluationOpening: lateReps },
  };
  // evaluates nodes (immutable): one per frozen hypothesis, one per O↔S spec record result
  const partRef = (p: string) => { const f = join(exp, 'partitions', p, 'observations.json'); return { path: refPath(f, root), sha256: fileSha256(f) }; };
  const specF = join(exp, 'partitions/spec/spec.json');
  const common = { author: { kind: 'verifier' as const, id: VERIFIER.id, version: VERIFIER.version }, origin: 'live' as const, at: o.at ?? new Date().toISOString(),
    criteria: `${EVALUATION_SCHEMA}: ${result.criteria}; spec encoding ${enc.enc.id} (${enc.enc.review.status})` };
  const refs = [...parts.map(p => partRef(p.partition)), { path: refPath(specF, root), sha256: fileSha256(specF) }, { path: refPath(encF, root), sha256: enc.sha256 }];
  const appended: string[] = [];
  for (const h of result.hypotheses) {
    const repIds = (h.representations as { representation: string }[]).map(r => r.representation);
    const node: NodeInput = { kind: 'evaluation', parents: [{ id: h.hypothesis, relation: 'evaluates' }, ...repIds.map(id => ({ id, relation: 'evaluates' as const }))], ...common, evidenceRefs: refs,
      reason: h.status === 'evaluated' ? `three-way verification of ${repIds.length} structured representation(s); results per partition and build in body` : `${h.status}: ${(h as { note?: string }).note ?? 'no clause could be represented'}`,
      body: { schema: EVALUATION_SCHEMA, relationSet: 'H↔O, H↔S, O↔S (separate, not combined into a score)', result: h, specificationReference: report.specificationReference.note, caveat: result.caveat } };
    appended.push(append(graphF, node, { root }).id);
  }
  for (const x of result.implementationCorrectness) {
    const node: NodeInput = { kind: 'evaluation', parents: [], ...common, evidenceRefs: refs, reason: `O↔S for ${x.rule}: ${x.statement}`, body: { schema: EVALUATION_SCHEMA, relation: 'O↔S', result: x, specificationReference: report.specificationReference.note } };
    appended.push(append(graphF, node, { root }).id);
  }
  const outF = assertWritableOutput(join(exp, 'evaluations', `three-way-${verifyLedger(join(exp, 'evaluation-ledger.ndjson')).count}.json`));
  mkdirSync(join(exp, 'evaluations'), { recursive: true });
  writeFileSync(outF, JSON.stringify({ ...report, graphNodes: appended }, null, 1) + '\n');
  return { report, nodes: appended, file: outF };
}

if (process.argv[1]?.endsWith('gw2/verify.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const exp = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
  if (!exp) { console.error('usage: verify.ts <expDir> [--encoding f] [--at ISO] [--confirmatory]'); process.exit(2); }
  try {
    const r = evaluateExperiment(isAbsolute(exp) ? exp : join(process.cwd(), exp), { encoding: arg('--encoding'), at: arg('--at'), confirmatory: a.includes('--confirmatory') });
    for (const h of r.report.hypotheses) console.log(`${h.hypothesis.slice(0, 12)} ${h.status}`);
    for (const x of r.report.implementationCorrectness) console.log(`O↔S ${x.rule} ${x.scope.partition}/${x.scope.build}: ${x.statement}`);
    console.log(`${r.nodes.length} evaluates/evaluation nodes appended; report ${relative(process.cwd(), r.file)}`);
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}

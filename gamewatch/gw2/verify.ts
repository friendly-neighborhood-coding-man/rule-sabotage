/**
 * GW2 P4: deterministic three-way verification (COMMON_SPEC §2.C). No model, no Kane, no generated code.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/verify.ts <expDir> [--encoding <file>] [--at <ISO>] [--confirmatory]
 *
 * Three relations, evaluated independently and never combined into a score:
 *   H↔O observational fit          a hypothesis's structured representation against recorded situations
 *                                  fits · contradicted (counter-examples) · insufficient-evidence · not-evaluable
 *   H↔S specification agreement    the representation's predictions against an encoded spec record's predictions on
 *                                  the same situations (inputs only; no outcome needed)
 *                                  agrees · disagrees (witnesses) · insufficient-evidence · not-evaluable
 *   O↔S implementation correctness an encoded spec record against recorded situations
 *                                  conforms · deviates (witnesses) · insufficient-evidence · not-evaluable
 * Every result is scoped to one partition and one build and states its denominators: situations of the kind,
 * applicable, evaluated, and excluded with reasons (not applicable, missing input, missing outcome). Missing evidence is
 * never a counter-example. A finite set of situations never establishes a rule in general; outputs say so.
 *
 * The combined reading "accurate description of a defect" is given only when, for one spec rule, partition and build,
 * H↔O fits, H↔S disagrees and O↔S deviates, AND every situation where H and S disagree is a situation where H fits and
 * the build deviates from S. Agreement of the three relations elsewhere does not substitute for that correspondence.
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
import { extractSituations, type Situation } from './situations.ts';

export const VERIFIER = { id: 'gamewatch/gw2/verify.ts', version: '1' } as const;
export const DEFAULT_ENCODING = join(ROOT, 'gamewatch/gw2/spec-encodings/rule-sabotage-v6.1.json');
export const EVALUATION_SCHEMA = 'gamewatch/gw2-three-way@1';
const MAX_LIST = 12;

export type Scope = { partition: string; build: string; situationKind: string; situationsOfKind: number; applicable: number; evaluated: number; excluded: Record<string, number> };
export type Pred = { id: string; field: string; predicted: Value; observed?: Value };
export type ClauseEval = { evaluated: string[]; fit: string[]; counter: Pred[]; excluded: Record<string, number>; applicable: number; ofKind: number; predictions: Map<string, Map<string, Value>> };

// ---------------------------------------------------------------- clause interpretation on situations
const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };

/** Interpret one law on situations: predictions (from inputs) and, where outcomes are recorded, fit / counter-example. */
export function evalLaw(c: LawClause, sits: Situation[]): ClauseEval {
  const of = sits.filter(s => s.kind === c.situation), r: ClauseEval = { evaluated: [], fit: [], counter: [], excluded: {}, applicable: 0, ofKind: of.length, predictions: new Map() };
  for (const s of of) {
    const w = c.when ? evalExpr(c.when, s.fields as Record<string, Value | null>) : true;
    if (isUnknown(w)) { inc(r.excluded, `missing input (${w.unknown.join(', ')})`); continue; }
    if (w !== true) { inc(r.excluded, 'not applicable (condition false)'); continue; }
    r.applicable++;
    const preds = new Map<string, Value>(), bad: Pred[] = [];
    let missingIn: string[] = [], checked = 0, missingOut: string[] = [];
    for (const x of c.expect) {
      const p = evalExpr(x.equals, s.fields as Record<string, Value | null>);
      if (isUnknown(p)) { missingIn = [...missingIn, ...p.unknown]; continue; }
      preds.set(x.field, p);
      const o = s.fields[x.field];
      if (o === null || o === undefined) { missingOut.push(x.field); continue; }
      checked++;
      if (o !== p) bad.push({ id: s.id, field: x.field, predicted: p, observed: o as Value });
    }
    if (preds.size) r.predictions.set(s.id, preds);
    if (!checked) { inc(r.excluded, missingIn.length && !preds.size ? `missing input (${[...new Set(missingIn)].sort().join(', ')})` : `missing outcome (${[...new Set(missingOut)].sort().join(', ')})`); continue; }
    r.evaluated.push(s.id);
    if (bad.length) r.counter.push(...bad); else r.fit.push(s.id);
  }
  return r;
}

/** Interpret one invariance: groups that agree on groupBy, compared across distinct vary values. */
export function evalInvariance(c: InvarianceClause, sits: Situation[]): ClauseEval & { groups: { key: string; variants: number; differing: boolean }[] } {
  const of = sits.filter(s => s.kind === c.situation), r = { evaluated: [] as string[], fit: [] as string[], counter: [] as Pred[], excluded: {} as Record<string, number>, applicable: 0, ofKind: of.length, predictions: new Map(), groups: [] as { key: string; variants: number; differing: boolean }[] };
  const groups = new Map<string, Situation[]>();
  for (const s of of) {
    const w = c.when ? evalExpr(c.when, s.fields as Record<string, Value | null>) : true;
    if (isUnknown(w)) { inc(r.excluded, `missing input (${w.unknown.join(', ')})`); continue; }
    if (w !== true) { inc(r.excluded, 'not applicable (condition false)'); continue; }
    const miss = [...c.groupBy, ...c.vary].filter(k => s.fields[k] === null || s.fields[k] === undefined);
    if (miss.length) { inc(r.excluded, `missing input (${miss.sort().join(', ')})`); continue; }
    r.applicable++;
    const key = JSON.stringify(c.groupBy.map(k => s.fields[k]));
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const [key, gs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const variants = new Map<string, Situation[]>();
    for (const s of gs) { const v = JSON.stringify(c.vary.map(k => s.fields[k])); variants.set(v, [...(variants.get(v) ?? []), s]); }
    if (variants.size < 2) { for (const s of gs) inc(r.excluded, 'no comparison partner (only one combination of the varied fields in its group)'); r.groups.push({ key, variants: variants.size, differing: false }); continue; }
    let differing = false;
    for (const o of c.outcomes) {
      const known = gs.filter(s => s.fields[o] !== null && s.fields[o] !== undefined);
      const byVal = new Map<string, Situation[]>();
      for (const s of known) { const v = JSON.stringify(s.fields[o]); byVal.set(v, [...(byVal.get(v) ?? []), s]); }
      if (byVal.size > 1) {
        differing = true;
        const [a, b] = [...byVal.values()].map(v => v[0]);
        r.counter.push({ id: a.id, field: o, predicted: b.fields[o] as Value, observed: a.fields[o] as Value });
      }
    }
    for (const s of gs) { r.evaluated.push(s.id); if (!differing) r.fit.push(s.id); }
    r.groups.push({ key, variants: variants.size, differing });
  }
  return r;
}

const evalClause = (c: Clause, sits: Situation[]) => c.form === 'law' ? evalLaw(c, sits) : evalInvariance(c, sits);
const firstN = <T>(xs: T[]) => xs.slice(0, MAX_LIST);
const scopeText = (n: number, p: string, b: string, kind: string) => `on ${n} evaluated ${kind} situation(s) from partition ${p}, build ${b}`;

// ---------------------------------------------------------------- relations
type ObsRel = { relation: 'H↔O' | 'O↔S'; value: string; scope: Scope; statement: string; witnesses: string[]; witnessCount: number; witnessesBySource: { case: number; match: number }; counterExamples: Pred[]; counterCount: number; clauses: { index: number; value: string; evaluated: number; counter: number }[] };

/** H↔O (for a hypothesis) or O↔S (for a spec record): clauses evaluated on recorded outcomes. */
export function observational(rel: 'H↔O' | 'O↔S', clauses: Clause[], sits: Situation[], partition: string, build: string): ObsRel {
  const yes = rel === 'H↔O' ? 'fits' : 'conforms', no = rel === 'H↔O' ? 'contradicted' : 'deviates';
  const per = clauses.map((c, i) => ({ i, c, r: evalClause(c, sits) }));
  const vals = per.map(({ r }) => r.counter.length ? no : r.evaluated.length ? yes : 'insufficient-evidence');
  const value = vals.includes(no) ? no : vals.every(v => v === yes) ? yes : 'insufficient-evidence';
  const excluded: Record<string, number> = {};
  for (const { i, r } of per) for (const [k, n] of Object.entries(r.excluded)) { const key = per.length > 1 ? `clause ${i}: ${k}` : k; excluded[key] = (excluded[key] ?? 0) + n; }
  const evaluated = [...new Set(per.flatMap(({ r }) => r.evaluated))], counter = per.flatMap(({ r }) => r.counter);
  const kinds = [...new Set(clauses.map(c => c.situation))].join('+');
  const scope: Scope = { partition, build, situationKind: kinds, situationsOfKind: Math.max(0, ...per.map(({ r }) => r.ofKind)), applicable: Math.max(0, ...per.map(({ r }) => r.applicable)), evaluated: evaluated.length, excluded };
  const witnesses = value === no ? [...new Set(counter.map(x => x.id))] : [...new Set(per.flatMap(({ r }) => r.fit))];
  const statement = value === yes ? `${yes} ${scopeText(evaluated.length, partition, build, kinds)}; no counter-example among them (finite evidence: this does not establish the rule for situations not evaluated)`
    : value === no ? `${no} ${scopeText(evaluated.length, partition, build, kinds)}: ${counter.length} counter-example check(s) in ${new Set(counter.map(x => x.id)).size} situation(s)`
    : `insufficient evidence ${scopeText(evaluated.length, partition, build, kinds)}: ${vals.filter(v => v === 'insufficient-evidence').length} of ${clauses.length} clause(s) had no evaluable situation`;
  const src = new Map(sits.map(s => [s.id, s.source.type]));
  return { relation: rel, value, scope, statement, witnesses: firstN(witnesses), witnessCount: witnesses.length, witnessesBySource: { case: witnesses.filter(id => src.get(id) === 'case').length, match: witnesses.filter(id => src.get(id) === 'match').length }, counterExamples: firstN(counter), counterCount: counter.length,
    clauses: per.map(({ i, r }, k) => ({ index: i, value: vals[k], applicable: r.applicable, evaluated: r.evaluated.length, counter: r.counter.length })) };
}

type SpecRel = { relation: 'H↔S'; rule: string; value: string; scope: Scope; statement: string; disagreements: Pred[]; disagreementCount: number; disagreementIds: string[]; agreementCount: number; comparedFields: string[]; reason?: string };

/** H↔S for one spec record: predictions compared on the same situations (law clauses only; same situation kind and outcome field). */
export function specAgreement(h: Clause[], s: Clause[], rule: string, sits: Situation[], partition: string, build: string): SpecRel {
  const hl = h.filter((c): c is LawClause => c.form === 'law'), sl = s.filter((c): c is LawClause => c.form === 'law');
  const pairs = hl.flatMap(a => sl.filter(b => b.situation === a.situation && b.expect.some(x => a.expect.some(y => y.field === x.field))).map(b => [a, b] as const));
  const base: Scope = { partition, build, situationKind: [...new Set(pairs.map(([a]) => a.situation))].join('+') || 'none', situationsOfKind: 0, applicable: 0, evaluated: 0, excluded: {} };
  if (!pairs.length) {
    const why = !hl.length ? 'the representation has no law clause (an invariance cannot be compared prediction by prediction)' : !sl.length ? `the encoded record ${rule} has no law clause` : `no clause of the representation predicts the same outcome field of the same situation kind as ${rule}`;
    return { relation: 'H↔S', rule, value: 'not-evaluable', scope: base, statement: `not evaluable against ${rule}: ${why}`, disagreements: [], disagreementCount: 0, disagreementIds: [], agreementCount: 0, comparedFields: [], reason: why };
  }
  const dis: Pred[] = [], agreeIds = new Set<string>(), disIds = new Set<string>(), excluded: Record<string, number> = {}, fields = new Set<string>();
  let ofKind = 0, applicable = 0;
  for (const [a, b] of pairs) {
    const ra = evalLaw(a, sits), rb = evalLaw(b, sits);
    ofKind = Math.max(ofKind, ra.ofKind);
    for (const sit of sits.filter(x => x.kind === a.situation)) {
      const pa = ra.predictions.get(sit.id), pb = rb.predictions.get(sit.id);
      if (!pa && !pb) { inc(excluded, 'neither applies or inputs missing'); continue; }
      if (!pa) { inc(excluded, 'hypothesis silent (spec applies)'); continue; }
      if (!pb) { inc(excluded, 'spec silent (hypothesis applies)'); continue; }
      applicable++;
      const common = [...pa.keys()].filter(k => pb.has(k));
      if (!common.length) { inc(excluded, 'no common predicted field'); continue; }
      let differs = false;
      for (const k of common) { fields.add(k); if (pa.get(k) !== pb.get(k)) { differs = true; dis.push({ id: sit.id, field: k, predicted: pa.get(k)!, observed: pb.get(k)! }); } }
      (differs ? disIds : agreeIds).add(sit.id);
    }
  }
  for (const id of disIds) agreeIds.delete(id);
  const evaluated = agreeIds.size + disIds.size, kinds = base.situationKind;
  const value = disIds.size ? 'disagrees' : evaluated ? 'agrees' : 'insufficient-evidence';
  const scope: Scope = { ...base, situationsOfKind: ofKind, applicable, evaluated, excluded };
  const statement = value === 'agrees' ? `agrees with ${rule} ${scopeText(evaluated, partition, build, kinds)} (same predicted values; finite situations only)`
    : value === 'disagrees' ? `disagrees with ${rule} ${scopeText(evaluated, partition, build, kinds)}: different predictions in ${disIds.size} situation(s)`
    : `insufficient evidence against ${rule}: no situation in partition ${partition}, build ${build} where both make a prediction`;
  // disagreement entries: predicted = hypothesis prediction, observed = spec prediction (named in the report)
  return { relation: 'H↔S', rule, value, scope, statement, disagreements: firstN(dis), disagreementCount: dis.length, disagreementIds: [...disIds].sort(), agreementCount: agreeIds.size, comparedFields: [...fields].sort() };
}

// ---------------------------------------------------------------- combined reading
export type Sets = { hEval: Set<string>; hFit: Set<string>; sEval: Set<string>; sDev: Set<string> };
/**
 * Combined reading for one (hypothesis representation, spec rule, partition, build). A disagreement situation whose
 * outcome both sides could check is CORRESPONDING evidence; one without a recorded outcome is evidence for neither
 * reading and is only counted.
 */
export function combined(ho: ObsRel, hs: SpecRel, os: ObsRel | null, x: Sets): { reading: string; explanation: string; correspondingSituations?: number; disagreementsWithoutRecordedOutcome?: number } {
  if (!os || os.value === 'not-evaluable' || hs.value === 'not-evaluable' || ho.value === 'not-evaluable') return { reading: 'not-evaluable', explanation: 'at least one relation could not be evaluated' };
  if (ho.value === 'contradicted') return { reading: 'hypothesis-contradicted-by-observations', explanation: `H↔O contradicted in partition ${ho.scope.partition}, build ${ho.scope.build}` };
  if ([ho.value, hs.value, os.value].includes('insufficient-evidence')) return { reading: 'unresolved-ambiguity', explanation: 'at least one relation has insufficient evidence on these situations' };
  if (ho.value === 'fits' && hs.value === 'disagrees' && os.value === 'deviates') {
    const observed = hs.disagreementIds.filter(id => x.hEval.has(id) && x.sEval.has(id)), unobserved = hs.disagreementIds.length - observed.length;
    const bad = observed.filter(id => !x.hFit.has(id) || !x.sDev.has(id));
    if (!observed.length) return { reading: 'unresolved-ambiguity', explanation: `the hypothesis and the spec disagree in ${hs.disagreementIds.length} situation(s), none of them with a recorded outcome both can be checked against`, correspondingSituations: 0, disagreementsWithoutRecordedOutcome: unobserved };
    if (bad.length) return { reading: 'relations-do-not-correspond', explanation: `in ${bad.length} of ${observed.length} disagreement situation(s) with a recorded outcome, the hypothesis does not fit or the build does not deviate from the spec`, correspondingSituations: observed.length - bad.length, disagreementsWithoutRecordedOutcome: unobserved };
    return { reading: 'accurate-description-of-a-defect', explanation: `in every one of the ${observed.length} situation(s) where the hypothesis and the spec disagree and the outcome is recorded, the hypothesis fits the observations and the build deviates from the spec (${unobserved} further disagreement situation(s) have no recorded outcome); this describes the build's behaviour, not the intended rule`, correspondingSituations: observed.length, disagreementsWithoutRecordedOutcome: unobserved };
  }
  if (ho.value === 'fits' && hs.value === 'agrees' && os.value === 'conforms') return { reading: 'consistent-with-specification-and-observations', explanation: 'all three relations agree on the evaluated situations (finite evidence)' };
  return { reading: 'relations-do-not-correspond', explanation: `H↔O ${ho.value}, H↔S ${hs.value}, O↔S ${os.value}${ho.value === 'fits' && hs.value === 'agrees' && os.value === 'deviates' ? ': the build deviates from the spec in outcomes or situations this hypothesis does not predict' : ''}` };
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
        const hl = clauses.flatMap(c => c.form === 'law' ? [evalLaw(c, sits)] : []);
        const hEval = new Set(hl.flatMap(r => r.evaluated)), hFit = new Set([...hEval].filter(id => !hl.some(r => r.counter.some(y => y.id === id))));
        const hs = spec.usable.map(r => specAgreement(clauses, r.clauses, r.rule, sits, p.partition, b));
        const comparable = hs.filter(x => x.value !== 'not-evaluable');
        const readings = comparable.map(x => {
          const os = osOf(x.rule, p.partition, b), sl = spec.usable.find(r => r.rule === x.rule)!.clauses.flatMap(c => c.form === 'law' ? [evalLaw(c, sits)] : []);
          const sets: Sets = { hEval, hFit, sEval: new Set(sl.flatMap(r => r.evaluated)), sDev: new Set(sl.flatMap(r => r.counter.map(y => y.id))) };
          return { rule: x.rule, ...combined(ho, x, os, sets), relations: { 'H↔O': ho.value, 'H↔S': x.value, 'O↔S': os?.value ?? 'not-evaluable' } };
        });
        const summary = ho.value === 'fits' ? 'supported-on-evaluated-situations' : ho.value === 'contradicted' ? 'unsupported' : ho.value;
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
      if (observational('H↔O', laws, sits, p.partition, b).value !== 'fits') continue;
      const preds = new Map<string, Map<string, Value>>();
      for (const l of laws) for (const [id, m] of evalLaw(l, sits).predictions) preds.set(id, new Map([...(preds.get(id) ?? []), ...m]));
      fitting.push({ who: `representation ${rep.id}`, partition: p.partition, build: b, preds });
    }
  }
  for (const r of spec.usable) for (const p of parts) for (const b of p.builds) {
    const laws = r.clauses.filter((c): c is LawClause => c.form === 'law'), sits = p.situations.filter(s => s.build === b);
    if (!laws.length || observational('O↔S', laws, sits, p.partition, b).value !== 'conforms') continue;
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
    criteria: 'COMMON_SPEC §2.C relations, evaluated separately per partition and build over situations extracted by gamewatch/gw2/situations.ts; law clauses compared by predicted value; invariance clauses by outcome differences within groups; unknown fields excluded as missing evidence',
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
  const parts: PartitionInput[] = (o.partitions ?? ['discovery', 'heldout']).map(p => {
    const obs = JSON.parse(g.read(p, 'observations.json'));
    return { partition: p, builds: [...obs.builds].sort(), situations: extractSituations(obs) };
  });
  const evalMap = JSON.parse(g.read('eval', 'eval.json')).idMaps as Record<string, { builds: Record<string, string> }>;
  const buildLabels = Object.fromEntries(parts.map(p => [p.partition, evalMap[p.partition]?.builds ?? {}]));
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

/**
 * GW2 P5: held-out predictive accuracy of FROZEN hypotheses through their SEALED structured representations
 * (PHASE_ROADMAP P5, AC-P5.1, AC-P5.4, AC-P5.5). No model, no Kane, no generated code.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/heldout.ts <expDir> [--at ISO] [--encoding f]
 *
 * Order of checks, fail-closed: the representation seal (representations.ts) must be valid BEFORE the gate is opened;
 * then every partition is read through the P3 gate (freeze.ts openEvaluation), which refuses without a valid freeze and
 * records the opening. Nothing under heldout/ or eval/ is read any other way.
 *
 * Reported per hypothesis, per sealed representation (submitter-authored and external translations reported
 * separately), per build (aligned across partitions by the build's original label, from eval/ through the gate):
 *   discovery fit        H↔O on discovery (verify.ts observational): fit is not predictive accuracy
 *   held-out prediction  outcome checks on held-out situations: matching / contradicting / unknown (not recorded) /
 *                        unpredicted (an input unknown); accuracy over outcome checks with a recorded outcome
 *                        (descriptive: checks within one match are correlated), situation-level (descriptive) and
 *                        unit-level (cases and matches: the independent units) rates, each with k, n and a Wilson 95%
 *                        interval; prediction coverage (held-out situations of the clause kinds with a prediction)
 *   invariance clauses   held-out cross-variant comparisons (consistent / violation / inconclusive); no accuracy
 * Kept apart and never combined into a score: explicit abstentions (own column), representation availability,
 * representation status, prediction coverage, accuracy, counter-examples.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { verify as verifyGraph, append, fileSha256, type Node, type NodeInput } from './judgments.ts';
import { openEvaluation, verifyLedger, FreezeError } from './freeze.ts';
import { checkRepresentation, type Clause, type LawClause, type InvarianceClause, type Value } from './hypothesis.ts';
import { extractSituations, type Situation } from './situations.ts';
import { evalLaw, evalInvariance, observational, loadEncoding } from './verify.ts';
import { verifyRepresentationSeal, type Origin } from './representations.ts';
import { wilson } from '../../server/balance/v3/stats.ts';

export const HELDOUT_SCHEMA = 'gamewatch/gw2-heldout@1';
export const HELDOUT_EVALUATOR = { id: 'gamewatch/gw2/heldout.ts', version: '1' } as const;
export const P5_ENCODING = join(ROOT, 'gamewatch/gw2/spec-encodings/rule-sabotage-v6.1-p5.json');
const MAX = 12;

/** A rate is never reported without its numerator, denominator and interval (AC-P5.5). */
export type Rate = { k: number; n: number; rate: number | null; wilson95: [number, number] | null; unit: string };
export const rate = (k: number, n: number, unit: string): Rate => ({ k, n, rate: n ? Math.round(k / n * 1000) / 1000 : null, wilson95: n ? wilson(k, n) : null, unit });

export type Cand = { hypothesis: string; ref: string; kind: string; representations: { id: string; origin: Origin; fidelity: string; author: string; representation: unknown }[] };
export type Parts = Record<'discovery' | 'heldout', Record<string, Situation[]>>; // partition → original build label → situations

/** Held-out prediction of one representation's clauses on one build's situations (pure). */
export function predictive(clauses: Clause[], sits: Situation[]) {
  const laws = clauses.filter((c): c is LawClause => c.form === 'law'), invs = clauses.filter((c): c is InvarianceClause => c.form === 'invariance');
  const per = laws.map(c => evalLaw(c, sits)), src = new Map(sits.map(s => [s.id, s.source]));
  const checks = per.flatMap(r => r.checks), recorded = checks.filter(x => x.result === 'matching' || x.result === 'contradicting');
  const bySit = new Map<string, boolean>(), byUnit = new Map<string, boolean>();
  for (const x of recorded) {
    const bad = x.result === 'contradicting', u = `${src.get(x.id)!.type}:${src.get(x.id)!.id}`;
    bySit.set(x.id, (bySit.get(x.id) ?? false) || bad); byUnit.set(u, (byUnit.get(u) ?? false) || bad);
  }
  const kinds = [...new Set(laws.map(c => c.situation))], ofKind = sits.filter(s => kinds.includes(s.kind)).length;
  const predictedSits = new Set(per.flatMap(r => [...r.predictions.keys()]));
  const unitCount = (t: string) => [...byUnit.keys()].filter(k => k.startsWith(t + ':')).length;
  const inv = invs.map(c => evalInvariance(c, sits).comparisons);
  return {
    lawClauses: laws.length, invarianceClauses: invs.length,
    outcomeChecks: { matching: checks.filter(x => x.result === 'matching').length, contradicting: checks.filter(x => x.result === 'contradicting').length, unknown: checks.filter(x => x.result === 'unknown').length, unpredicted: checks.filter(x => x.result === 'unpredicted').length },
    accuracy: {
      outcomeChecks: { ...rate(recorded.filter(x => x.result === 'matching').length, recorded.length, 'outcome checks with a recorded outcome'), note: 'descriptive: checks within one situation and situations within one match are correlated' },
      situations: { ...rate([...bySit.values()].filter(b => !b).length, bySit.size, 'situations with at least one recorded check, all matching'), note: 'descriptive: turns of one match are not independent replicates' },
      units: { ...rate([...byUnit.values()].filter(b => !b).length, byUnit.size, 'cases and matches with at least one recorded check, none contradicting'), cases: unitCount('case'), matches: unitCount('match'), note: 'independent units: one scripted case or one match counts once' },
    },
    coverage: rate(predictedSits.size, ofKind, `situations of kind ${kinds.join('+') || 'none'} where the representation makes at least one prediction`),
    counterExamples: per.flatMap(r => r.counter).slice(0, MAX), counterCount: per.reduce((n, r) => n + r.counter.length, 0),
    invariance: invs.length ? { comparisons: inv.flat().length, consistent: inv.flat().filter(x => x.result === 'consistent').length, violation: inv.flat().filter(x => x.result === 'violation').length, inconclusive: inv.flat().filter(x => x.result === 'inconclusive').length, violations: inv.flat().filter(x => x.result === 'violation').slice(0, MAX) } : null,
  };
}

/** Pure and deterministic core: discovery fit and held-out prediction, per hypothesis / representation / build. */
export function heldoutCore(cands: Cand[], parts: Parts) {
  const labels = [...new Set([...Object.keys(parts.discovery), ...Object.keys(parts.heldout)])].sort();
  const hypotheses = cands.map(h => {
    if (h.kind === 'abstention') return { hypothesis: h.hypothesis, ref: h.ref, status: 'explicit-abstention', representations: [] };
    if (!h.representations.length) return { hypothesis: h.hypothesis, ref: h.ref, status: 'no-sealed-representation', note: 'free text only; not interpreted', representations: [] };
    return { hypothesis: h.hypothesis, ref: h.ref, status: 'evaluated', representations: h.representations.map(r => {
      const chk = checkRepresentation(r.representation), clauses = chk.clauses.flatMap(c => c.ok ? [c.clause] : []);
      const base = { representation: r.id, origin: r.origin, author: r.author, fidelityDeclared: r.fidelity, representationStatus: chk.status, notRepresentedClauses: chk.clauses.filter(c => !c.ok).length };
      if (chk.status === 'not-representable') return { ...base, problems: chk.problems.slice(0, MAX), byBuild: [] };
      return { ...base, byBuild: labels.map(label => {
        const d = parts.discovery[label] ?? [], ho = parts.heldout[label] ?? [];
        const fit = observational('H↔O', clauses, d, 'discovery', label);
        return { build: label, discoveryFit: { value: fit.value, evaluated: fit.scope.evaluated, support: fit.scope.support, units: fit.scope.units, counterCount: fit.counterCount, statement: fit.statement },
          heldout: { situations: ho.length, ...predictive(clauses, ho) } };
      }) };
    }) };
  });
  const reps = hypotheses.flatMap(h => h.representations as { origin: Origin; representationStatus: string }[]);
  const tally = (o: Origin) => { const x = reps.filter(r => r.origin === o); return { representations: x.length, represented: x.filter(r => r.representationStatus === 'represented').length, partiallyRepresented: x.filter(r => r.representationStatus === 'partially-represented').length, notRepresentable: x.filter(r => r.representationStatus === 'not-representable').length }; };
  return {
    schema: HELDOUT_SCHEMA, evaluator: HELDOUT_EVALUATOR,
    columns: {
      explicitAbstentions: cands.filter(h => h.kind === 'abstention').length,
      hypotheses: cands.filter(h => h.kind !== 'abstention').length,
      withSubmitterRepresentation: cands.filter(h => h.representations.some(r => r.origin === 'submitter')).length,
      withExternalTranslation: cands.filter(h => h.representations.some(r => r.origin === 'external-translation')).length,
      withoutRepresentation: cands.filter(h => h.kind !== 'abstention' && !h.representations.length).length,
      submitter: tally('submitter'), externalTranslation: tally('external-translation'),
      note: 'Abstentions are their own column: they are neither predictions nor errors and enter no accuracy figure. Submitter-authored and externally translated representations are reported separately and never pooled.',
    },
    hypotheses,
    caveat: 'Discovery fit and held-out predictive accuracy are different measures. Held-out accuracy is over the representation as structured (fidelity declared by its author, not checked); it says nothing about situations not evaluated and does not identify a unique rule. No composite score is formed.',
  };
}

/** Gate-side inputs shared by heldout.ts and discriminate.ts. The seal is checked before the gate is opened. */
export function loadSealedInputs(exp: string, evaluator: { id: string; version: string }, o: { root?: string; encoding?: string } = {}) {
  const root = o.root ?? ROOT;
  const seal = verifyRepresentationSeal(exp, { root });
  if (!seal.ok) throw new FreezeError(`evaluation refused before opening: ${seal.problems.join('; ')}`);
  const g = openEvaluation(exp, evaluator, { root });
  const spec = JSON.parse(g.read('spec', 'spec.json')) as { game: { rules: { id: string; text: string }[] } };
  const evalMap = JSON.parse(g.read('eval', 'eval.json')).idMaps as Record<string, { builds: Record<string, string> }>;
  const parts = { discovery: {}, heldout: {} } as Parts, neutral: Record<string, Record<string, string>> = {};
  for (const p of ['discovery', 'heldout'] as const) {
    const obs = JSON.parse(g.read(p, 'observations.json')), map = evalMap[p]?.builds ?? {};
    const sits = extractSituations(obs);
    neutral[p] = map;
    for (const b of obs.builds as string[]) parts[p][map[b] ?? b] = sits.filter(s => s.build === b);
  }
  const v = verifyGraph(join(exp, 'judgments.ndjson'), { checkRefs: true, root }), sealed = new Map(seal.representations.map(r => [r.id, r]));
  const frozen = new Set(g.frozen), byId = new Map(v.nodes.map(n => [n.id, n]));
  const cands: Cand[] = v.nodes.filter(n => frozen.has(n.id)).map(n => ({
    hypothesis: n.id, ref: String(n.body.ref ?? ''), kind: n.kind,
    representations: seal.representations.filter(r => r.hypothesis === n.id).map(r => { const x = byId.get(r.id)!, b = x.body as Record<string, any>; return { id: r.id, origin: r.origin, fidelity: b.fidelity?.declared ?? 'unknown', author: `${x.author.kind}:${x.author.id}`, representation: b.representation }; }),
  }));
  const ignored = v.nodes.filter(n => n.kind === 'representation' && !sealed.has(n.id)).map(n => n.id);
  return { g, seal, spec, enc: loadEncoding(o.encoding ?? P5_ENCODING, spec.game.rules), parts, neutral, cands, nodes: v.nodes, ignored };
}

export function evaluateHeldout(exp: string, o: { at?: string; root?: string; encoding?: string } = {}) {
  const root = o.root ?? ROOT, inp = loadSealedInputs(exp, HELDOUT_EVALUATOR, o);
  const core = heldoutCore(inp.cands, inp.parts);
  const specRef = inp.enc.usable.map(r => ({ rule: r.rule, byBuild: Object.keys(inp.parts.heldout).sort().map(label => {
    const d = observational('O↔S', r.clauses, inp.parts.discovery[label] ?? [], 'discovery', label), h = observational('O↔S', r.clauses, inp.parts.heldout[label] ?? [], 'heldout', label);
    return { build: label, discovery: { value: d.value, evaluated: d.scope.evaluated }, heldout: { value: h.value, evaluated: h.scope.evaluated }, heldoutPrediction: predictive(r.clauses, inp.parts.heldout[label] ?? []).accuracy };
  }) }));
  const ledgerN = verifyLedger(join(exp, 'evaluation-ledger.ndjson')).count;
  const report = { ...core, exp: (root === ROOT ? repoRelative(exp) : null) ?? exp, seal: { sha256: inp.seal.sealSha256, representations: inp.seal.representations.length, notSealedIgnored: inp.ignored },
    freeze: { sha256: inp.g.freezeSha256, frozen: inp.g.frozen.length }, buildAlignment: inp.neutral,
    specificationReference: { encoding: inp.enc.enc.id, sha256: inp.enc.sha256, review: inp.enc.enc.review.status, note: 'provisional and unreviewed (Q3, D72): the spec records are shown as reference predictors, not as ground truth', records: specRef } };
  const graphF = join(exp, 'judgments.ndjson'), at = o.at ?? new Date().toISOString(), appended: string[] = [];
  const refs = ['discovery', 'heldout'].map(p => { const f = join(exp, 'partitions', p, 'observations.json'); return { path: (root === ROOT ? repoRelative(f) : null) ?? f, sha256: fileSha256(f) }; });
  for (const h of core.hypotheses) {
    const reps = (h.representations as { representation: string }[]).map(r => r.representation);
    const node: NodeInput = { kind: 'evaluation', parents: [{ id: h.hypothesis, relation: 'evaluates' }, ...reps.map(id => ({ id, relation: 'evaluates' as const }))], author: { kind: 'verifier', id: HELDOUT_EVALUATOR.id, version: HELDOUT_EVALUATOR.version }, origin: 'live', at,
      criteria: `${HELDOUT_SCHEMA}: discovery fit and held-out prediction reported separately; rates with k, n and Wilson 95% intervals; abstentions not scored`, evidenceRefs: refs,
      reason: h.status === 'evaluated' ? `held-out prediction of ${reps.length} sealed representation(s)` : h.status, body: { schema: HELDOUT_SCHEMA, result: h, caveat: core.caveat } };
    appended.push(append(graphF, node, { root }).id);
  }
  const outF = assertWritableOutput(join(exp, 'evaluations', `heldout-${ledgerN}.json`));
  mkdirSync(join(exp, 'evaluations'), { recursive: true });
  writeFileSync(outF, JSON.stringify({ ...report, graphNodes: appended }, null, 1) + '\n');
  return { report, file: outF, nodes: appended };
}

if (process.argv[1]?.endsWith('gw2/heldout.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const exp = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
  if (!exp) { console.error('usage: heldout.ts <expDir> [--at ISO] [--encoding f]'); process.exit(2); }
  try {
    const r = evaluateHeldout(isAbsolute(exp) ? exp : join(process.cwd(), exp), { at: arg('--at'), encoding: arg('--encoding') });
    console.log(`${r.report.hypotheses.length} frozen entries (${r.report.columns.explicitAbstentions} abstentions); report ${relative(process.cwd(), r.file)}`);
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}

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
import { extractSituations, alignBuilds, type Situation } from './situations.ts';
import { evalLaw, evalInvariance, observational, loadEncoding } from './verify.ts';
import { verifyRepresentationSeal, type Origin } from './representations.ts';
import { wilson } from '../../server/balance/v3/stats.ts';

export const HELDOUT_SCHEMA = 'gamewatch/gw2-heldout@1';
export const HELDOUT_EVALUATOR = { id: 'gamewatch/gw2/heldout.ts', version: '2' } as const; // v2: P5 corrections D88-D91
export const P5_ENCODING = join(ROOT, 'gamewatch/gw2/spec-encodings/rule-sabotage-v6.1-p5.json');
const MAX = 12;

/** A rate is never reported without its numerator, denominator and interval (AC-P5.5). */
export type Rate = { k: number; n: number; rate: number | null; wilson95: [number, number] | null; unit: string };
export const rate = (k: number, n: number, unit: string): Rate => ({ k, n, rate: n ? Math.round(k / n * 1000) / 1000 : null, wilson95: n ? wilson(k, n) : null, unit });

export type Cand = { hypothesis: string; ref: string; kind: string; primary?: { eligible: boolean; reasons: string[] }; representations: { id: string; origin: Origin; fidelity: string; author: string; representation: unknown }[] };
export type Parts = Record<'discovery' | 'heldout', Record<string, Situation[]>>; // partition → original build label → situations

/**
 * Independence groups for units (P5 correction 5, D90): a unit key (`case:<id>` / `match:<id>`) → its replication
 * group. Matches of one seed (paired across first movers) form one group; cases of one script form one family.
 * Without a mapping each unit is its own group and the report says the grouping is unknown.
 */
export type Groups = { of: Map<string, string>; basis: string };

/** Held-out prediction of one representation's clauses on one build's situations (pure). */
export function predictive(clauses: Clause[], sits: Situation[], groups?: Groups) {
  const laws = clauses.filter((c): c is LawClause => c.form === 'law'), invs = clauses.filter((c): c is InvarianceClause => c.form === 'invariance');
  const per = laws.map(c => evalLaw(c, sits)), src = new Map(sits.map(s => [s.id, s.source]));
  const checks = per.flatMap(r => r.checks), recorded = checks.filter(x => x.result === 'matching' || x.result === 'contradicting');
  const bySit = new Map<string, boolean>(), byUnit = new Map<string, boolean>();
  const unitOf = (id: string) => `${src.get(id)!.type}:${src.get(id)!.id}`;
  for (const x of recorded) {
    const bad = x.result === 'contradicting', u = unitOf(x.id);
    bySit.set(x.id, (bySit.get(x.id) ?? false) || bad); byUnit.set(u, (byUnit.get(u) ?? false) || bad);
  }
  // P5 correction 2 (D89): a situation or unit is FULLY evaluated only when every check of it has a recorded outcome
  // (no `unknown`, no `unpredicted`). Partially evaluated ones are reported apart and never as verified successes.
  const openSit = new Set(checks.filter(x => x.result === 'unknown' || x.result === 'unpredicted').map(x => x.id));
  const openUnit = new Set([...openSit].map(unitOf));
  const split = (m: Map<string, boolean>, open: Set<string>, what: string) => {
    const full = [...m].filter(([k]) => !open.has(k)), part = [...m].filter(([k]) => open.has(k));
    return {
      fullyEvaluated: { ...rate(full.filter(([, b]) => !b).length, full.length, `${what} with every check recorded, none contradicting`), note: 'verified on every check made' },
      partiallyEvaluated: { count: part.length, contradicted: part.filter(([, b]) => b).length, noContradictionOnRecordedChecks: part.filter(([, b]) => !b).length,
        note: `${what} where some checks have no recorded outcome or an unknown input: not counted as verified successes` },
      withoutAnyRecordedCheck: [...open].filter(k => !m.has(k)).length,
    };
  };
  const kinds = [...new Set(laws.map(c => c.situation))], ofKind = sits.filter(s => kinds.includes(s.kind)).length;
  const predictedSits = new Set(per.flatMap(r => [...r.predictions.keys()]));
  const unitCount = (t: string) => [...byUnit.keys()].filter(k => k.startsWith(t + ':')).length;
  const inv = invs.map(c => evalInvariance(c, sits).comparisons);
  // replication groups over units with a recorded check (P5 correction 5)
  const gOf = (u: string) => groups?.of.get(u) ?? u, byGroup = new Map<string, boolean>();
  for (const [u, bad] of byUnit) byGroup.set(gOf(u), (byGroup.get(gOf(u)) ?? false) || bad);
  const gCount = (t: string) => new Set([...byUnit.keys()].filter(k => k.startsWith(t + ':')).map(gOf)).size;
  return {
    lawClauses: laws.length, invarianceClauses: invs.length,
    outcomeChecks: { matching: checks.filter(x => x.result === 'matching').length, contradicting: checks.filter(x => x.result === 'contradicting').length, unknown: checks.filter(x => x.result === 'unknown').length, unpredicted: checks.filter(x => x.result === 'unpredicted').length },
    accuracy: {
      outcomeChecks: { ...rate(recorded.filter(x => x.result === 'matching').length, recorded.length, 'outcome checks with a recorded outcome'), note: 'descriptive, conditional on recorded checks: checks within one situation and situations within one match are correlated' },
      situations: { ...rate([...bySit.values()].filter(b => !b).length, bySit.size, 'situations with at least one recorded check, all matching'), note: 'descriptive, conditional on recorded checks: turns of one match are not independent replicates', ...split(bySit, openSit, 'situations') },
      units: { ...rate([...byUnit.values()].filter(b => !b).length, byUnit.size, 'cases and matches with at least one recorded check, none contradicting'), cases: unitCount('case'), matches: unitCount('match'),
        note: 'descriptive, conditional on recorded checks: one scripted case or one match counts once, but units are not independent replicates (matches of one seed are paired; cases of one script form a family)', ...split(byUnit, openUnit, 'units') },
    },
    replication: {
      groups: byGroup.size, consistentGroups: [...byGroup.values()].filter(b => !b).length, matchSeedGroups: gCount('match'), caseScriptFamilies: gCount('case'),
      basis: groups?.basis ?? 'unknown: no grouping available, each unit treated as its own group (an upper bound on independence)',
      note: 'Independent replication is at most the number of groups, not the number of units. Wilson intervals above are descriptive summaries of these observations; they are not confidence statements about the rule, and with few groups they overstate precision.',
    },
    coverage: rate(predictedSits.size, ofKind, `situations of kind ${kinds.join('+') || 'none'} where the representation makes at least one prediction`),
    counterExamples: per.flatMap(r => r.counter).slice(0, MAX), counterCount: per.reduce((n, r) => n + r.counter.length, 0),
    invariance: invs.length ? { comparisons: inv.flat().length, consistent: inv.flat().filter(x => x.result === 'consistent').length, violation: inv.flat().filter(x => x.result === 'violation').length, inconclusive: inv.flat().filter(x => x.result === 'inconclusive').length, violations: inv.flat().filter(x => x.result === 'violation').slice(0, MAX) } : null,
  };
}

/** Primary verified analysis eligibility (P5 correction 4, D91). Missing information is not eligibility. */
export function primaryOf(h: Cand): { eligible: boolean; reasons: string[] } {
  return h.primary ?? { eligible: false, reasons: ['no session validity or verification recorded for this entry'] };
}
export function primaryFromNode(n: { author: { id: string }; body: Record<string, any> }): { eligible: boolean; reasons: string[] } {
  const r: string[] = [], b = n.body;
  if (n.author.id === 'unverified-submitter') r.push('unverified submitter (nonce or session did not match)');
  if (b.verification !== 'journal-verified') r.push(`submission verification is ${String(b.verification ?? 'not recorded')}, not journal-verified`);
  if (b.counted !== true) r.push('the submission does not count for its session');
  if (b.sessionValidity?.primaryAnalysis !== true) r.push(`session experimental validity is ${String(b.sessionValidity?.status ?? 'not recorded')}: not suitable for primary analysis`);
  return { eligible: !r.length, reasons: r };
}

const BUILD_ID = /^build-[0-9a-f]{4}$/;
/** Neutral build ids a representation names in constants, split into those that exist in discovery and those that do not. */
export function buildReferences(clauses: Clause[], discoveryBuilds: string[]) {
  const found = new Set<string>();
  const walk = (x: unknown): void => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (o.op === 'const' && typeof o.value === 'string' && BUILD_ID.test(o.value)) found.add(o.value); Object.values(o).forEach(walk); } };
  walk(clauses);
  const all = [...found].sort();
  return { named: all, resolved: all.filter(b => discoveryBuilds.includes(b)), unresolved: all.filter(b => !discoveryBuilds.includes(b)),
    note: 'build conditions are written in discovery build ids; held-out situations are aligned to them through eval/ (D88). An unresolved id names no discovery build and can never apply.' };
}

export { alignBuilds } from './situations.ts';

/** Pure and deterministic core: discovery fit and held-out prediction, per hypothesis / representation / build. */
export type CoreCtx = { groups?: Record<string, Groups>; discoveryBuilds?: string[] };
export function heldoutCore(cands: Cand[], parts: Parts, ctx: CoreCtx = {}) {
  const labels = [...new Set([...Object.keys(parts.discovery), ...Object.keys(parts.heldout)])].sort();
  const hypotheses = cands.map(h => {
    const analysisSet = primaryOf(h);
    if (h.kind === 'abstention') return { hypothesis: h.hypothesis, ref: h.ref, status: 'explicit-abstention', analysisSet, representations: [] };
    if (!h.representations.length) return { hypothesis: h.hypothesis, ref: h.ref, status: 'no-sealed-representation', analysisSet, note: 'free text only; not interpreted', representations: [] };
    return { hypothesis: h.hypothesis, ref: h.ref, status: 'evaluated', analysisSet, representations: h.representations.map(r => {
      const chk = checkRepresentation(r.representation), clauses = chk.clauses.flatMap(c => c.ok ? [c.clause] : []);
      const base = { representation: r.id, origin: r.origin, author: r.author, fidelityDeclared: r.fidelity, representationStatus: chk.status, notRepresentedClauses: chk.clauses.filter(c => !c.ok).length,
        ...(ctx.discoveryBuilds ? { buildReferences: buildReferences(clauses, ctx.discoveryBuilds) } : {}) };
      if (chk.status === 'not-representable') return { ...base, problems: chk.problems.slice(0, MAX), byBuild: [] };
      return { ...base, byBuild: labels.map(label => {
        const d = parts.discovery[label] ?? [], ho = parts.heldout[label] ?? [];
        const fit = observational('H↔O', clauses, d, 'discovery', label);
        return { build: label, discoveryFit: { value: fit.value, evaluated: fit.scope.evaluated, support: fit.scope.support, units: fit.scope.units, counterCount: fit.counterCount, statement: fit.statement },
          heldout: { situations: ho.length, ...predictive(clauses, ho, ctx.groups?.[label]) } };
      }) };
    }) };
  });
  const reps = hypotheses.flatMap(h => h.representations as { origin: Origin; representationStatus: string }[]);
  const tally = (o: Origin) => { const x = reps.filter(r => r.origin === o); return { representations: x.length, represented: x.filter(r => r.representationStatus === 'represented').length, partiallyRepresented: x.filter(r => r.representationStatus === 'partially-represented').length, notRepresentable: x.filter(r => r.representationStatus === 'not-representable').length }; };
  const primaryIds = hypotheses.filter(h => h.analysisSet.eligible).map(h => h.hypothesis);
  return {
    schema: HELDOUT_SCHEMA, evaluator: HELDOUT_EVALUATOR,
    primaryAnalysis: { hypotheses: primaryIds, excluded: hypotheses.filter(h => !h.analysisSet.eligible).map(h => ({ hypothesis: h.hypothesis, ref: h.ref, reasons: h.analysisSet.reasons })),
      rule: 'Only journal-verified, counted submissions from sessions whose experimental validity allows primary analysis enter the primary verified metrics. Everything else is preserved and reported here, never pooled into primary figures (D91).' },
    columns: {
      explicitAbstentions: cands.filter(h => h.kind === 'abstention').length,
      hypotheses: cands.filter(h => h.kind !== 'abstention').length,
      withSubmitterRepresentation: cands.filter(h => h.representations.some(r => r.origin === 'submitter')).length,
      withExternalTranslation: cands.filter(h => h.representations.some(r => r.origin === 'external-translation')).length,
      withoutRepresentation: cands.filter(h => h.kind !== 'abstention' && !h.representations.length).length,
      primaryAnalysisSet: cands.filter(h => primaryOf(h).eligible).length,
      preservedNotPrimary: cands.filter(h => !primaryOf(h).eligible).length,
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
  const E = JSON.parse(g.read('eval', 'eval.json'));
  const evalMap = E.idMaps as Record<string, { builds: Record<string, string>; matchSeeds?: Record<string, number> }>;
  const parts = { discovery: {}, heldout: {} } as Parts, neutral: Record<string, Record<string, string>> = {};
  const groups = { discovery: {}, heldout: {} } as Record<'discovery' | 'heldout', Record<string, Groups>>, alignment: Record<string, unknown> = {};
  for (const p of ['discovery', 'heldout'] as const) {
    const obs = JSON.parse(g.read(p, 'observations.json')), map = evalMap[p]?.builds ?? {};
    const al = alignBuilds(extractSituations(obs), map, evalMap.discovery?.builds ?? {});
    neutral[p] = map; alignment[p] = { builds: al.alignment, notInDiscovery: al.notInDiscovery };
    const seeds: number[] = E.assignment?.[p]?.seeds ?? [], ms = evalMap[p]?.matchSeeds;
    const basis = ms ? 'matches grouped by seed (eval/ matchSeeds); cases grouped by script' : seeds.length === 1 ? `matches grouped by seed: the partition has the single seed ${seeds[0]}; cases grouped by script` : `cases grouped by script; matches ungrouped (${seeds.length} seeds, no per-match seed map): each match is an upper bound on independence`;
    for (const b of obs.builds as string[]) {
      const label = map[b] ?? b, of = new Map<string, string>();
      for (const c of obs.cases.filter((c: { build: string }) => c.build === b)) of.set(`case:${c.caseId}`, `script:${c.script}`);
      for (const m of obs.matches.filter((m: { build: string }) => m.build === b)) of.set(`match:${m.matchId}`, ms ? `seed:${ms[m.matchId]}` : seeds.length === 1 ? `seed:${seeds[0]}` : `match:${m.matchId}`);
      parts[p][label] = al.sits.filter(s => s.build === (al.alignment[b]?.discoveryId ?? b));
      groups[p][label] = { of, basis };
    }
  }
  const v = verifyGraph(join(exp, 'judgments.ndjson'), { checkRefs: true, root }), sealed = new Map(seal.representations.map(r => [r.id, r]));
  const frozen = new Set(g.frozen), byId = new Map(v.nodes.map(n => [n.id, n]));
  const cands: Cand[] = v.nodes.filter(n => frozen.has(n.id)).map(n => ({
    hypothesis: n.id, ref: String(n.body.ref ?? ''), kind: n.kind, primary: primaryFromNode(n as never),
    representations: seal.representations.filter(r => r.hypothesis === n.id).map(r => { const x = byId.get(r.id)!, b = x.body as Record<string, any>; return { id: r.id, origin: r.origin, fidelity: b.fidelity?.declared ?? 'unknown', author: `${x.author.kind}:${x.author.id}`, representation: b.representation }; }),
  }));
  const ignored = v.nodes.filter(n => n.kind === 'representation' && !sealed.has(n.id)).map(n => n.id);
  return { g, seal, spec, enc: loadEncoding(o.encoding ?? P5_ENCODING, spec.game.rules), parts, neutral, alignment, groups, discoveryBuilds: Object.keys(evalMap.discovery?.builds ?? {}).sort(), cands, nodes: v.nodes, ignored };
}

export function evaluateHeldout(exp: string, o: { at?: string; root?: string; encoding?: string } = {}) {
  const root = o.root ?? ROOT, inp = loadSealedInputs(exp, HELDOUT_EVALUATOR, o);
  const core = heldoutCore(inp.cands, inp.parts, { groups: inp.groups.heldout, discoveryBuilds: inp.discoveryBuilds });
  const specRef = inp.enc.usable.map(r => ({ rule: r.rule, byBuild: Object.keys(inp.parts.heldout).sort().map(label => {
    const d = observational('O↔S', r.clauses, inp.parts.discovery[label] ?? [], 'discovery', label), h = observational('O↔S', r.clauses, inp.parts.heldout[label] ?? [], 'heldout', label);
    return { build: label, discovery: { value: d.value, evaluated: d.scope.evaluated }, heldout: { value: h.value, evaluated: h.scope.evaluated }, heldoutPrediction: predictive(r.clauses, inp.parts.heldout[label] ?? [], inp.groups.heldout[label]).accuracy };
  }) }));
  const ledgerN = verifyLedger(join(exp, 'evaluation-ledger.ndjson')).count;
  const report = { ...core, exp: (root === ROOT ? repoRelative(exp) : null) ?? exp, seal: { sha256: inp.seal.sealSha256, representations: inp.seal.representations.length, notSealedIgnored: inp.ignored },
    freeze: { sha256: inp.g.freezeSha256, frozen: inp.g.frozen.length }, buildAlignment: inp.neutral, buildAlignmentToDiscovery: inp.alignment,
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

if (process.argv[1]?.replace(/\\/g, "/").endsWith('gw2/heldout.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const exp = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
  if (!exp) { console.error('usage: heldout.ts <expDir> [--at ISO] [--encoding f]'); process.exit(2); }
  try {
    const r = evaluateHeldout(isAbsolute(exp) ? exp : join(process.cwd(), exp), { at: arg('--at'), encoding: arg('--encoding') });
    console.log(`${r.report.hypotheses.length} frozen entries (${r.report.columns.explicitAbstentions} abstentions); report ${relative(process.cwd(), r.file)}`);
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}

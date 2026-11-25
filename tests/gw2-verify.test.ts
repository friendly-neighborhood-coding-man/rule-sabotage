/**
 * GW2 P4: deterministic three-way verification (AC-P4.1 – AC-P4.6). No Kane, no model, no generated code, no new engine
 * observation: the GW1 bundle and the committed fixtures are read; synthetic probe fixtures are hand-written
 * (tests/gw2-p4-fixtures.ts). Scratch experiments live in mkdtemp directories outside the repository.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { checkRepresentation, evalExpr, HYPOTHESIS_SCHEMA } from '../gamewatch/gw2/hypothesis.ts';
import { extractSituations, type Situation } from '../gamewatch/gw2/situations.ts';
import { threeWay, loadEncoding, evaluateExperiment, DEFAULT_ENCODING, specAgreement, observational, evalLaw, evalInvariance, type HypInput } from '../gamewatch/gw2/verify.ts';
import { verify, append, nodeId, canonical, type NodeInput } from '../gamewatch/gw2/judgments.ts';
import { verifyFreeze, openEvaluation, FreezeError } from '../gamewatch/gw2/freeze.ts';
import { runP4Demo, P4_SCRIPT } from '../gamewatch/gw2/p4-demo.ts';
import { syntheticProbeObservations } from './gw2-p4-fixtures.ts';

const GW1 = JSON.parse(readFileSync(join(ROOT, 'evidence/gamewatch/evidence.json'), 'utf8'));
const ENC = loadEncoding(DEFAULT_ENCODING, GW1.game.rules);
const f = (name: string) => ({ op: 'field', name }), c = (value: unknown) => ({ op: 'const', value });
const eq = (a: unknown, b: unknown) => ({ op: 'eq', args: [a, b] }), add = (a: unknown, b: unknown) => ({ op: 'add', args: [a, b] });
const rep = (...clauses: unknown[]) => ({ schema: HYPOTHESIS_SCHEMA, clauses });
const H = (id: string, r: unknown, kind = 'hypothesis'): HypInput => ({ id, kind, representations: r ? [{ id: `rep-${id}`, author: {}, representation: r, fidelity: { declared: 'faithful' } }] : [] });
const FIRST_MOVER_PLUS_ONE = rep({ form: 'law', situation: 'turn-start', when: eq(f('isFirstMover'), c(true)), expect: [{ field: 'actionsGranted', equals: add(add(f('piecesOnBoard'), f('pendingBonus')), c(1)) }] });
const R3_LIKE = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: add(f('piecesOnBoard'), f('pendingBonus')) }] });
const gw1 = () => [{ partition: 'gw1-bundle', builds: ['QX-41', 'QX-73'], situations: extractSituations(GW1) }];
const hypOut = (r: ReturnType<typeof threeWay>, id: string) => r.hypotheses.find(h => h.hypothesis === id) as any;
const os = (r: ReturnType<typeof threeWay>, rule: string, build: string) => r.implementationCorrectness.find(x => x.rule === rule && x.scope.build === build)!;

let demo: { d: string; exp: string; report: any } | null = null;
async function demoExp() {
  if (demo) return demo;
  const d = mkdtempSync(join(tmpdir(), 'gw2-p4-')), exp = join(d, 'exp');
  const r = await runP4Demo(exp, { at: '2026-11-25T16:00:00.000Z' });
  demo = { d, exp, report: r.evaluation.report };
  return demo;
}
test.after(() => { if (demo) rmSync(demo.d, { recursive: true, force: true }); });

test('representation: closed operator set; validator reports, never repairs; interpretation is a table lookup', () => {
  assert.equal(checkRepresentation(FIRST_MOVER_PLUS_ONE).status, 'represented');
  const bad = checkRepresentation(rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: { op: 'mul', args: [f('turn'), c(2)] } }] }));
  assert.equal(bad.status, 'not-representable'); assert.match(bad.problems.join(), /operator "mul" is not in the closed set/);
  for (const [what, r, re] of [
    ['unknown field', rep({ form: 'law', situation: 'turn-start', when: eq(f('gameStage'), c(1)), expect: [{ field: 'actionsGranted', equals: c(3) }] }), /not a recorded field/],
    ['outcome used as input', rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: f('actionsGranted') }] }), /is an outcome; only input fields/],
    ['input as expected field', rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'turn', equals: c(1) }] }), /not an outcome field/],
    ['unknown situation', rep({ form: 'law', situation: 'placement', expect: [] }), /not a supported situation kind/],
    ['unknown form', rep({ form: 'regex', situation: 'turn-start' }), /form "regex" is not supported/],
    ['string code as a field name', rep({ form: 'law', situation: 'turn-start', when: eq(f('process.exit(1)'), c(1)), expect: [{ field: 'actionsGranted', equals: c(3) }] }), /not a recorded field/],
    ['extra key smuggled', rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: { op: 'const', value: 3, code: 'x' } }] }), /unknown key "code"/],
    ['wrong arity', rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: { op: 'add', args: [c(1)] } }] }), /takes 2 argument/],
    ['not a representation', { clauses: [] }, /must be/],
  ] as [string, unknown, RegExp][]) { const k = checkRepresentation(r); assert.equal(k.status, 'not-representable', what); assert.match(k.problems.join(), re, what); }
  const part = checkRepresentation(rep(JSON.parse(JSON.stringify(FIRST_MOVER_PLUS_ONE)).clauses[0], { form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: { op: 'pow', args: [c(2), c(2)] } }] }));
  assert.equal(part.status, 'partially-represented'); assert.deepEqual(part.clauses.map(x => x.ok), [true, false]);
  // three-valued logic: unknown inputs stay unknown; "and" with a known false is false
  assert.deepEqual(evalExpr({ op: 'add', args: [{ op: 'field', name: 'a' }, { op: 'const', value: 1 }] }, { a: null }), { unknown: ['a'] });
  assert.equal(evalExpr({ op: 'and', args: [{ op: 'field', name: 'a' }, { op: 'const', value: false }] }, { a: null }), false);
  assert.equal(evalExpr({ op: 'in', args: [{ op: 'field', name: 'k' }], values: ['shove', 'freeze'] }, { k: 'freeze' }), true);
});

test('AC-P4.1 determinism: identical output across runs and for CRLF copies of the inputs', async () => {
  const a = canonical(threeWay([H('h1', FIRST_MOVER_PLUS_ONE), H('h2', R3_LIKE)], gw1(), ENC));
  const b = canonical(threeWay([H('h1', FIRST_MOVER_PLUS_ONE), H('h2', R3_LIKE)], gw1(), ENC));
  assert.equal(a, b);
  // the full pipeline on two copies of one frozen experiment, the second with CRLF line endings in every partition file
  const { exp } = await demoExp(), d = mkdtempSync(join(tmpdir(), 'gw2-p4-')), x = join(d, 'x'), y = join(d, 'y');
  const pristine = (p: string) => { cpSync(exp, p, { recursive: true }); for (const g of ['judgments.ndjson', 'evaluation-ledger.ndjson']) rmSync(join(p, g), { force: true }); rmSync(join(p, 'evaluations'), { recursive: true, force: true }); };
  // rebuild each copy's graph up to the representations (drop the evaluation nodes and the ledger from the copy)
  for (const p of [x, y]) {
    pristine(p);
    const lines = readFileSync(join(exp, 'judgments.ndjson'), 'utf8').trimEnd().split('\n').filter(l => JSON.parse(l).node.kind !== 'evaluation' || JSON.parse(l).node.body.assessment);
    writeFileSync(join(p, 'judgments.ndjson'), lines.join('\n') + '\n');
  }
  for (const part of ['discovery', 'spec', 'heldout', 'eval']) for (const file of readdirSync(join(y, 'partitions', part)).filter(n => n.endsWith('.json'))) {
    const fp = join(y, 'partitions', part, file); writeFileSync(fp, readFileSync(fp, 'utf8').replace(/\n/g, '\r\n'));
  }
  const rx = evaluateExperiment(x, { at: '2026-11-25T17:00:00.000Z' }).report, ry = evaluateExperiment(y, { at: '2026-11-25T17:00:00.000Z' }).report;
  for (const k of ['hypotheses', 'implementationCorrectness', 'identifiability', 'caveat', 'criteria'] as const) assert.equal(canonical((rx as any)[k]), canonical((ry as any)[k]), k);
  rmSync(d, { recursive: true, force: true });
});

test('AC-P4.2 no codegen: no GW2 module evaluates strings, builds functions, uses vm or imports a computed path', () => {
  const dir = join(ROOT, 'gamewatch/gw2');
  for (const file of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\beval\s*\(/, `${file}: eval`);
    assert.doesNotMatch(src, /new\s+Function\b|\bFunction\s*\(/, `${file}: Function constructor`);
    assert.doesNotMatch(src, /node:vm|from 'vm'|require\(/, `${file}: vm / require`);
    for (const m of src.matchAll(/\bimport\s*\(([^)]*)\)/g)) assert.match(m[1].trim(), /^'\.\/[a-z-]+\.ts'$/, `${file}: dynamic import of a literal module path only`);
    if (/child_process/.test(src)) assert.equal(file, 'coverage.ts', `${file}: child_process is only used by coverage.ts (a fixed script, the session dir as argument)`);
  }
  const hyp = readFileSync(join(dir, 'hypothesis.ts'), 'utf8') + readFileSync(join(dir, 'verify.ts'), 'utf8') + readFileSync(join(dir, 'situations.ts'), 'utf8');
  assert.doesNotMatch(hyp, /child_process|spawn|exec\(/, 'the verifier starts no process');
});

test('AC-P4.3 known answers on GW1 evidence: R3 conforms on QX-41 and deviates on QX-73 with turn rows as witnesses; first-mover +1 is an accurate description of a defect', () => {
  const r = threeWay([H('h1', FIRST_MOVER_PLUS_ONE)], gw1(), ENC);
  const a = os(r, 'R3', 'QX-41'), b = os(r, 'R3', 'QX-73');
  assert.equal(a.value, 'conforms'); assert.equal(a.counterCount, 0);
  assert.equal(b.value, 'deviates'); assert.ok(b.counterExamples.length && b.counterExamples.every(x => x.field === 'actionsGranted' && x.observed === (x.predicted as number) + 1));
  assert.ok(b.witnessesBySource.match > 0 && b.witnessesBySource.case > 0, 'match turn rows (and case turn starts) are witnesses');
  assert.equal(b.witnessesBySource.match + b.witnessesBySource.case, b.witnessCount);
  const sits = extractSituations(GW1), byId = new Map(sits.map(s => [s.id, s]));
  assert.ok(b.counterExamples.every(x => byId.get(x.id)!.fields.isFirstMover === true), 'every deviation is on a first-mover turn (B3)');
  const h = hypOut(r, 'h1').representations[0], q73 = h.byPartition.find((p: any) => p.build === 'QX-73'), q41 = h.byPartition.find((p: any) => p.build === 'QX-41');
  assert.equal(q73['H↔O'].value, 'fits'); assert.equal(q73['H↔S'][0].rule, 'R3'); assert.equal(q73['H↔S'][0].value, 'disagrees');
  assert.equal(q73.readings[0].reading, 'accurate-description-of-a-defect');
  assert.notEqual(q73.summary, 'unsupported', 'not reported as failed understanding');
  assert.equal(q41['H↔O'].value, 'contradicted', 'on the clean build the same hypothesis is contradicted');
  assert.equal(q41.readings[0].reading, 'hypothesis-contradicted-by-observations');
  // the spec-like hypothesis: consistent on QX-41, contradicted on QX-73 although it agrees with the spec there
  const r2 = threeWay([H('h2', R3_LIKE)], gw1(), ENC), p2 = hypOut(r2, 'h2').representations[0].byPartition;
  assert.equal(p2.find((p: any) => p.build === 'QX-41').readings[0].reading, 'consistent-with-specification-and-observations');
  assert.deepEqual(p2.find((p: any) => p.build === 'QX-73').readings[0].relations, { 'H↔O': 'contradicted', 'H↔S': 'agrees', 'O↔S': 'deviates' });
});

test('AC-P4.4 not-representable and insufficient-evidence are never reported as contradicted; missing fields and zero applicable situations', () => {
  const unsupportedOp = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: { op: 'max', args: [f('turn'), c(3)] } }] });
  const neverApplies = rep({ form: 'law', situation: 'turn-start', when: eq(f('turn'), c(999)), expect: [{ field: 'actionsGranted', equals: c(0) }] });
  const cellOnly = rep({ form: 'law', situation: 'effect-entry', when: eq(f('arrival'), c('forced')), expect: [{ field: 'cellUsedUp', equals: c(true) }] });
  const matchesOnly = [{ partition: 'matches-only', builds: ['QX-41', 'QX-73'], situations: extractSituations({ cases: [], matches: GW1.matches }) }];
  const r = threeWay([H('op', unsupportedOp), H('zero', neverApplies), H('cell', cellOnly), H('none', null), H('abst', null, 'abstention')], matchesOnly, ENC);
  assert.equal(hypOut(r, 'op').status, 'not-representable');
  assert.equal(hypOut(r, 'none').status, 'not-evaluable'); assert.equal(hypOut(r, 'abst').status, 'explicit-abstention');
  for (const id of ['zero', 'cell']) for (const p of hypOut(r, id).representations[0].byPartition) {
    assert.equal(p['H↔O'].value, 'insufficient-evidence', id); assert.equal(p.summary, 'insufficient-evidence', id);
  }
  const z = hypOut(r, 'zero').representations[0].byPartition[0]['H↔O'];
  assert.equal(z.scope.applicable, 0); assert.ok(z.scope.excluded['not applicable (condition false)'] > 0);
  const m = hypOut(r, 'cell').representations[0].byPartition[0]['H↔O'];
  assert.ok(m.scope.applicable > 0 && m.scope.evaluated === 0, 'applicable but no recorded outcome'); assert.ok(m.scope.excluded['missing outcome (cellUsedUp)'] > 0);
  assert.equal(m.counterCount, 0, 'missing evidence is not a counter-example');
  assert.ok(!JSON.stringify(r).includes('"contradicted"'), 'nothing here is reported as contradicted');
});

test('AC-P4.5 every verdict is scoped (N evaluated situations from partition P, build B); no "equivalent", "proved" or "always" in verifier output', async () => {
  const { report } = await demoExp();
  const statements: { statement: string; scope: { partition: string; build: string; evaluated: number } }[] = [
    ...report.implementationCorrectness,
    ...report.hypotheses.flatMap((h: any) => h.representations.flatMap((r: any) => r.byPartition.flatMap((p: any) => [p['H↔O'], ...p['H↔S']]))),
  ];
  assert.ok(statements.length > 20);
  for (const s of statements) {
    assert.ok(s.scope.partition && s.scope.build && Number.isInteger(s.scope.evaluated), s.statement);
    assert.match(s.statement, new RegExp(`partition ${s.scope.partition}, build ${s.scope.build}`), s.statement);
  }
  const text = JSON.stringify(report) + readFileSync(join(demo!.exp, 'judgments.ndjson'), 'utf8').split('\n').filter(l => l && JSON.parse(l).node.author.kind === 'verifier' && JSON.parse(l).node.body.schema === 'gamewatch/gw2-three-way@2').join('\n');
  assert.doesNotMatch(text, /equivalent|proved|always/i);
  assert.match(report.caveat, /does not identify a unique rule/);
});

test('AC-P4.6 mutation sanity: each of B1–B3 is detected by the matching spec record and by no unrelated one', () => {
  // (a) synthetic single-defect fixtures transcribed from the private probe setups (not engine observations)
  const obs = syntheticProbeObservations();
  const r = threeWay([], [{ partition: 'synthetic-probes', builds: obs.builds, situations: extractSituations(obs) }], ENC);
  const v = (rule: string, build: string) => os(r, rule, build).value;
  for (const rule of ['R3', 'R7', 'R8', 'R14']) assert.equal(v(rule, 'clean'), 'conforms', `${rule} on clean`);
  assert.deepEqual(['R3', 'R7', 'R8', 'R14'].map(x => v(x, 'B1')), ['conforms', 'deviates', 'conforms', 'deviates'], 'B1: asymmetric shield (R7, R14)');
  assert.deepEqual(['R3', 'R7', 'R8', 'R14'].map(x => v(x, 'B2')), ['conforms', 'conforms', 'deviates', 'conforms'], 'B2: forced arrival not used up (R8); symmetric, so R7 conforms');
  assert.deepEqual(['R3', 'R7', 'R8', 'R14'].map(x => v(x, 'B3')), ['deviates', 'conforms', 'conforms', 'conforms'], 'B3: first-mover extra action (R3)');
  // (b) recorded GW1 evidence: QX-73 carries all three; each deviation's witnesses are the corresponding situations
  const g = threeWay([], gw1(), ENC), sits = new Map(extractSituations(GW1).map(s => [s.id, s]));
  const w = (rule: string) => os(g, rule, 'QX-73').counterExamples.map(x => sits.get(x.id)!.fields);
  assert.ok(w('R14').length && w('R14').every(x => x.pieceSide === 'Human' && x.pieceShieldedBefore === true), 'R14 deviations: shielded Human entries (B1)');
  assert.ok(w('R8').length && w('R8').every(x => x.arrival === 'forced'), 'R8 deviations: forced arrivals (B2)');
  assert.ok(w('R3').every(x => x.isFirstMover === true), 'R3 deviations: first-mover turns (B3)');
  for (const rule of ['R3', 'R7', 'R14']) assert.equal(os(g, rule, 'QX-41').value, 'conforms', `${rule} on QX-41`);
  assert.equal(os(g, 'R8', 'QX-41').value, 'insufficient-evidence', 'R8 clause 3 (multi-cell) has no recorded multi-cell entry in GW1; reported, not passed');
  assert.equal(os(g, 'R8', 'QX-41').clauses.filter(x => x.value === 'conforms').length, 2);
});

test('contradictory hypotheses, self-contradiction, and observational fit that does not identify a rule', () => {
  const r = threeWay([H('first+1', FIRST_MOVER_PLUS_ONE), H('r3', R3_LIKE)], gw1(), ENC);
  const val = (id: string, b: string) => hypOut(r, id).representations[0].byPartition.find((p: any) => p.build === b)['H↔O'].value;
  assert.deepEqual([val('first+1', 'QX-73'), val('r3', 'QX-73')], ['fits', 'contradicted'], 'competing hypotheses: one fits QX-73, the other is contradicted');
  assert.deepEqual([val('first+1', 'QX-41'), val('r3', 'QX-41')], ['contradicted', 'fits']);
  const self = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] }, { form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(4) }] });
  assert.ok(hypOut(threeWay([H('self', self)], gw1(), ENC), 'self').representations[0].byPartition.every((p: any) => p['H↔O'].value === 'contradicted'), 'a self-contradictory representation is contradicted');
  // three pieces on board and no earned extras in every situation: "3 actions" and R3 both fit and predict the same
  const s: Situation[] = [1, 2, 3, 4].map(t => ({ id: `syn/t${t}/turn-start`, kind: 'turn-start', build: 'b', source: { type: 'match', id: 'syn', pointer: '' }, fields: { build: 'b', side: t % 2 ? 'Human' : 'AI', turn: t, isFirstMover: t % 2 === 1, piecesOnBoard: 3, pendingBonus: 0, actionsGranted: 3 } }));
  const three = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] });
  const u = threeWay([H('three', three)], [{ partition: 'p', builds: ['b'], situations: s }], ENC);
  assert.equal(hypOut(u, 'three').representations[0].byPartition[0].readings[0].reading, 'consistent-with-specification-and-observations');
  assert.deepEqual(u.identifiability.map(x => x.candidates), [['representation rep-three', 'spec R3']], 'fit does not identify: "3 actions" and R3 are not told apart here');
});

test('provisional spec encoding: inventory, binding to the rule text, unencoded rules left unencoded, confirmatory use refused', async () => {
  assert.deepEqual(ENC.inventory.filter((x: any) => x.status === 'encoded').map((x: any) => x.rule), ['R3', 'R7', 'R8', 'R14']);
  assert.equal(ENC.inventory.filter((x: any) => x.status === 'unencoded').length, 11);
  assert.equal(ENC.authoritative, false); assert.equal(ENC.enc.review.status, 'unreviewed');
  for (const r of ENC.enc.records.filter(x => x.status === 'encoded')) assert.ok(r.supportedScope && r.limitations?.length, r.rule);
  const changed = GW1.game.rules.map((x: any) => x.id === 'R8' ? { ...x, text: x.text + ' (edited)' } : x);
  const e2 = loadEncoding(DEFAULT_ENCODING, changed);
  assert.equal((e2.inventory.find((x: any) => x.rule === 'R8') as any).status, 'source-mismatch'); assert.ok(!e2.usable.some(x => x.rule === 'R8'), 'a record whose source text changed is not used');
  const { exp } = await demoExp();
  assert.throws(() => evaluateExperiment(exp, { confirmatory: true }), /confirmatory evaluation refused/);
  assert.match(demo!.report.specificationReference.note, /provisional and unreviewed/);
});

test('pipeline: hypotheses preserved verbatim; representations are separate nodes; evaluates nodes immutable and complete; partial representation and free-text/structured difference reported', async () => {
  const { exp, report } = await demoExp(), graph = join(exp, 'judgments.ndjson');
  const v = verify(graph, { checkRefs: true });
  assert.equal(v.ok, true, v.problems.map(p => p.problem).join());
  const hyps = v.nodes.filter(n => n.kind === 'hypothesis' || n.kind === 'abstention'), reps = v.nodes.filter(n => n.kind === 'representation');
  const lines = readFileSync(join(exp, 'sessions', readdirSync(join(exp, 'sessions'))[0], 'hypotheses.ndjson'), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(hyps.map(h => h.body.verbatim), lines, 'every submission preserved verbatim');
  assert.equal(reps.length, P4_SCRIPT.filter(x => x.representation).length);
  assert.ok(reps.every(r => r.parents.length === 1 && r.parents[0].relation === 'represents' && hyps.some(h => h.id === r.parents[0].id)));
  const evals = v.nodes.filter(n => n.kind === 'evaluation' && n.author.id === 'gamewatch/gw2/verify.ts');
  assert.equal(evals.length, hyps.length + report.implementationCorrectness.length);
  for (const e of evals) { assert.ok(e.author.version && e.criteria && e.reason && e.evidenceRefs.length >= 3, e.id); }
  assert.ok(evals.filter(e => e.parents.length).every(e => e.parents.every(p => p.relation === 'evaluates')));
  const byRef = (ref: string) => report.hypotheses.find((h: any) => h.hypothesis === hyps.find(x => x.body.ref === ref)!.id);
  assert.equal(byRef('H-5').status, 'not-representable');
  assert.equal(byRef('H-6').representations[0].representationStatus, 'partially-represented'); assert.equal(byRef('H-6').representations[0].notRepresentedClauses.length, 1);
  assert.equal(byRef('H-7').status, 'explicit-abstention'); assert.equal(byRef('H-8').status, 'not-evaluable');
  assert.equal(byRef('H-4').representations[0].fidelityDeclared, 'narrower'); assert.match(byRef('H-4').representations[0].appliesTo, /structured representation only/);
  // H-4 describes B2: an accurate description of a defect on the build that has it (corresponding situations only)
  const lbl = report.operatorView.buildLabels;
  const h4 = byRef('H-4').representations[0].byPartition.filter((p: any) => lbl[p.partition][p.build] === 'QX-73');
  assert.ok(h4.length === 2 && h4.every((p: any) => p.readings.find((x: any) => x.rule === 'R8').reading === 'accurate-description-of-a-defect'));
  assert.ok(h4.every((p: any) => p.readings.find((x: any) => x.rule === 'R8').disagreementsWithoutRecordedOutcome > 0), 'disagreements without a recorded outcome are counted, not used as evidence');
  // re-evaluation appends; earlier lines unchanged
  const before = readFileSync(graph);
  evaluateExperiment(exp, { at: '2026-11-25T18:00:00.000Z' });
  assert.ok(readFileSync(graph).subarray(0, before.length).equals(before), 'existing judgments untouched');
});

test('gate: freeze and manifest violations refuse evaluation; a representation appended after the first opening is not used', async () => {
  const { exp } = await demoExp(), d = mkdtempSync(join(tmpdir(), 'gw2-p4-')), x = join(d, 'x');
  cpSync(exp, x, { recursive: true });
  const graph = join(x, 'judgments.ndjson'), saved = readFileSync(graph, 'utf8');
  // a representation added now (after evaluation was opened) is excluded and listed
  const h = verify(graph).nodes.find(n => n.body.ref === 'H-8')!;
  const late: NodeInput = { kind: 'representation', parents: [{ id: h.id, relation: 'represents' }], author: { kind: 'test-double', id: 'late', version: '1' }, origin: 'live', at: '2026-11-25T19:00:00.000Z', evidenceRefs: [], reason: 'late representation', body: { representation: R3_LIKE } };
  const lateId = append(graph, late).id;
  const r = evaluateExperiment(x, { at: '2026-11-25T19:00:00.000Z' }).report;
  assert.deepEqual(r.representationsExcluded.appendedAfterFirstEvaluationOpening, [lateId]);
  assert.equal(r.hypotheses.find((y: any) => y.hypothesis === h.id).status, 'not-evaluable');
  // judgments: a representation must represent a hypothesis; only representations use "represents"
  assert.throws(() => append(graph, { ...late, parents: [{ id: verify(graph).nodes.find(n => n.kind === 'abstention')!.id, relation: 'represents' }] }), /must represent a hypothesis/);
  assert.throws(() => append(graph, { ...late, kind: 'label' }), /only a representation node may use the relation "represents"/);
  // a frozen hypothesis edited and re-hashed: refused
  const L = saved.trimEnd().split('\n'), i = L.findIndex(l => JSON.parse(l).node.body.ref === 'H-1'), y = JSON.parse(L[i]);
  y.node.body.statement = 'edited'; y.node.id = nodeId(y.node);
  writeFileSync(graph, [...L.slice(0, i), canonical(y), ...L.slice(i + 1)].join('\n') + '\n');
  assert.equal(verifyFreeze(x).ok, false);
  assert.throws(() => evaluateExperiment(x), FreezeError);
  writeFileSync(graph, saved);
  // a held-out file replaced together with its manifest: refused
  const mf = join(x, 'partitions/heldout/MANIFEST.json'), m = JSON.parse(readFileSync(mf, 'utf8'));
  appendFileSync(join(x, 'partitions/heldout/observations.json'), ' ');
  m.files['observations.json'] = 'f'.repeat(64); writeFileSync(mf, JSON.stringify(m));
  assert.throws(() => evaluateExperiment(x), /evaluation refused/);
  rmSync(d, { recursive: true, force: true });
});

test('committed P4 fixture: graph, freeze and three-way report verify and match a fresh evaluation of the same inputs', () => {
  const FIX = join(ROOT, 'evidence/gw2/p4-fixture');
  assert.equal(verifyFreeze(FIX).ok, true, verifyFreeze(FIX).problems.join('\n'));
  assert.equal(verify(join(FIX, 'judgments.ndjson'), { checkRefs: true }).ok, true);
  // three-way-1.json is the original v1 (pre-correction) report, kept unchanged; the latest is the corrected v2 re-evaluation
  const files = readdirSync(join(FIX, 'evaluations')).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  assert.equal(JSON.parse(readFileSync(join(FIX, 'evaluations', files[0]), 'utf8')).schema, 'gamewatch/gw2-three-way@1');
  const report = JSON.parse(readFileSync(join(FIX, 'evaluations', files.at(-1)!), 'utf8'));
  assert.equal(report.schema, 'gamewatch/gw2-three-way@2');
  // recompute the pure core from a copy of the committed fixture, reading the partitions through the gate
  const d = mkdtempSync(join(tmpdir(), 'gw2-p4-')), x = join(d, 'fix');
  cpSync(FIX, x, { recursive: true });
  const g = openEvaluation(x, { id: 'gw2-test-recompute', version: '0' });
  const parts = ['discovery', 'heldout'].map(p => { const o = JSON.parse(g.read(p as 'heldout', 'observations.json')); return { partition: p, builds: [...o.builds].sort(), situations: extractSituations(o) }; });
  const nodes = verify(join(FIX, 'judgments.ndjson')).nodes, frozen = new Set(JSON.parse(readFileSync(join(FIX, 'hypotheses/FREEZE.json'), 'utf8')).hypotheses.map((h: any) => h.id));
  const hyps: HypInput[] = nodes.filter(n => frozen.has(n.id)).map(n => ({ id: n.id, kind: n.kind, representations: nodes.filter(r => r.kind === 'representation' && r.parents[0].id === n.id).map(r => ({ id: r.id, author: r.author, representation: (r.body as any).representation, fidelity: (r.body as any).fidelity })) }));
  const spec = JSON.parse(g.read('spec', 'spec.json'));
  const fresh = threeWay(hyps, parts, loadEncoding(DEFAULT_ENCODING, spec.game.rules));
  assert.equal(canonical(fresh.hypotheses), canonical(report.hypotheses)); assert.equal(canonical(fresh.implementationCorrectness), canonical(report.implementationCorrectness));
  rmSync(d, { recursive: true, force: true });
});

test('H↔S compares predictions only where both make one; invariance records are not compared prediction by prediction', () => {
  const sits = extractSituations(GW1).filter(s => s.build === 'QX-41');
  const r7 = ENC.usable.find(x => x.rule === 'R7')!.clauses, r3 = ENC.usable.find(x => x.rule === 'R3')!.clauses;
  const ck = checkRepresentation(FIRST_MOVER_PLUS_ONE), cl = ck.clauses.flatMap(x => x.ok ? [x.clause] : []);
  assert.equal(specAgreement(cl, r7, 'R7', sits, 'p', 'QX-41').value, 'not-evaluable');
  const s = specAgreement(cl, r3, 'R3', sits, 'p', 'QX-41');
  assert.equal(s.value, 'disagrees'); assert.ok(s.scope.excluded['hypothesis silent (spec applies)'] > 0, 'second-mover turns: hypothesis silent, excluded');
  assert.equal(observational('O↔S', r7, sits, 'p', 'QX-41').value, 'conforms');
});

test('combined reading needs corresponding situations: disagreements without a recorded outcome are not evidence for a defect description', () => {
  const T = (id: string, side: string, pendingBonus: number | null, actionsGranted: number | null): Situation => ({ id, kind: 'turn-start', build: 'b', source: { type: 'match', id: 'syn', pointer: '' }, fields: { build: 'b', side, turn: 1, isFirstMover: side === 'Human', piecesOnBoard: 3, pendingBonus, actionsGranted } });
  // s2: H fits (S cannot predict: bonus unknown); s1: H and S disagree, outcome not recorded; s3: S deviates, H silent
  const sits = [T('s1', 'Human', 0, null), T('s2', 'Human', null, 4), T('s3', 'AI', 0, 4)];
  const h = rep({ form: 'law', situation: 'turn-start', when: eq(f('side'), c('Human')), expect: [{ field: 'actionsGranted', equals: add(f('piecesOnBoard'), c(1)) }] });
  const p = hypOut(threeWay([H('h', h)], [{ partition: 'p', builds: ['b'], situations: sits }], ENC), 'h').representations[0].byPartition[0];
  assert.deepEqual(p.readings[0].relations, { 'H↔O': 'fits', 'H↔S': 'disagrees', 'O↔S': 'deviates' });
  assert.equal(p.readings[0].reading, 'unresolved-ambiguity', 'the three relations hold on different situations; no defect description');
  assert.equal(p.readings[0].correspondingSituations, 0); assert.equal(p.readings[0].disagreementsWithoutRecordedOutcome, 1);
});

/**
 * GW2 P5: held-out evaluation, competing-hypothesis discrimination, representation seal, submitter-first structured
 * representations, generation provenance and real-engine mutation validation (AC-P5.1 – AC-P5.5, D69–D73).
 * No Kane, no model. The committed P5 observations are read, never regenerated; scratch experiments live in mkdtemp
 * directories outside the repository.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { HYPOTHESIS_SCHEMA } from '../gamewatch/gw2/hypothesis.ts';
import type { Situation } from '../gamewatch/gw2/situations.ts';
import { extractSituations } from '../gamewatch/gw2/situations.ts';
import { heldoutCore, predictive, rate, evaluateHeldout, type Cand } from '../gamewatch/gw2/heldout.ts';
import { comparePair, discriminateCore, discriminate } from '../gamewatch/gw2/discriminate.ts';
import { sealRepresentations, verifyRepresentationSeal, appendTranslation } from '../gamewatch/gw2/representations.ts';
import { loadGenerationProcedure, generate, GenerationError } from '../gamewatch/gw2/generate.ts';
import { verify, append, canonical, fileSha256 } from '../gamewatch/gw2/judgments.ts';
import { FreezeError, verifyLedger } from '../gamewatch/gw2/freeze.ts';
import { runP5Demo, P5_SCRIPT } from '../gamewatch/gw2/p5-demo.ts';
import { schemaPage } from '../gamewatch/gw2/blind-site.ts';

const f = (name: string) => ({ op: 'field', name }), c = (value: unknown) => ({ op: 'const', value });
const add = (a: unknown, b: unknown) => ({ op: 'add', args: [a, b] });
const rep = (...clauses: unknown[]) => ({ schema: HYPOTHESIS_SCHEMA, clauses });
const PIECES = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: add(f('piecesOnBoard'), f('pendingBonus')) }] });
const THREE = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] });
const PIECES_ONLY = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: f('piecesOnBoard') }] });
const T = (id: string, pieces: number, granted: number | null, src = id.split('/')[0]): Situation => ({ id, kind: 'turn-start', build: 'b', source: { type: 'match', id: src, pointer: '' }, fields: { build: 'b', side: 'Human', turn: 1, isFirstMover: true, piecesOnBoard: pieces, pendingBonus: 0, actionsGranted: granted } });
const cand = (ref: string, r: unknown, kind = 'hypothesis', origin: 'submitter' | 'external-translation' = 'submitter'): Cand => ({ hypothesis: `id-${ref}`, ref, kind, representations: r ? [{ id: `rep-${ref}`, origin, fidelity: 'faithful', author: 'test-double:x', representation: r }] : [] });
// discovery: three pieces everywhere (the candidates agree); held-out: a turn with two pieces (they differ)
const PARTS = { discovery: { b: [T('M-1/t1', 3, 3), T('M-1/t2', 3, 3), T('M-2/t1', 3, 3)] }, heldout: { b: [T('M-3/t1', 3, 3), T('M-3/t5', 2, 2), T('M-4/t1', 3, null)] } };
const BUNDLE = join(ROOT, 'evidence/gw2/p5-experiment/generated/bundle.json');

let demo: { d: string; exp: string; r: Awaited<ReturnType<typeof runP5Demo>> } | null = null;
async function demoExp() {
  if (demo) return demo;
  const d = mkdtempSync(join(tmpdir(), 'gw2-p5-')), exp = join(d, 'exp');
  demo = { d, exp, r: await runP5Demo(BUNDLE, exp, { at: '2026-11-25T20:00:00.000Z' }) };
  return demo;
}
test.after(() => { if (demo) rmSync(demo.d, { recursive: true, force: true }); });

test('AC-P5.2 hypotheses that agree on every discovery observation but differ on held-out ones are separated, with the separating situations and both predictions listed', () => {
  const r = discriminateCore([cand('H-1', PIECES), cand('H-2', THREE)], PARTS, []);
  const p = r.pairs.find(x => x.candidates.some(l => l.startsWith('H-1')) && x.candidates.some(l => l.startsWith('H-2')))!.byBuild[0];
  assert.equal(p.discovery.verdict, 'indistinguishable-on-available-evidence'); assert.equal(p.discovery.counts.identical, 3);
  assert.equal(p.heldout.verdict, 'separated'); assert.equal(p.pattern, 'not separated on discovery, separated on held-out');
  assert.equal(p.bothFitDiscovery, true);
  assert.deepEqual(p.heldout.separatingSituations, [{ id: 'M-3/t5', field: 'actionsGranted', predictions: { 'H-1/submitter/rep-H-1': 2, 'H-2/submitter/rep-H-2': 3 }, recordedOutcome: 2, matches: 'H-1/submitter/rep-H-1' }]);
  assert.equal(p.heldout.counts.identical, 2, 'M-3/t1 and M-4/t1 (3 pieces): identical predictions, with or without a recorded outcome');
  assert.equal(p.heldout.counts.contradictoryWithoutOutcome, 0);
  // contradictory predictions without a recorded outcome are missing evidence, not separation
  const miss = comparePair({ id: 'a', label: 'a', hypothesis: 'x', origin: 's', clauses: [PIECES.clauses[0] as never] }, { id: 'b', label: 'b', hypothesis: 'y', origin: 's', clauses: [THREE.clauses[0] as never] }, [T('M-9/t1', 2, null)]);
  assert.equal(miss.verdict, 'indistinguishable-on-available-evidence'); assert.equal(miss.counts.contradictoryWithoutOutcome, 1); assert.deepEqual(miss.missingEvidence[0].predictions, { a: 2, b: 3 });
});

test('AC-P5.3 hypotheses that agree on all available observations are "indistinguishable on the available evidence", never "equivalent"', () => {
  const parts = { discovery: { b: [T('M-1/t1', 3, 3)] }, heldout: { b: [T('M-3/t1', 3, 3), T('M-3/t3', 3, 3)] } };
  const r = discriminateCore([cand('H-1', PIECES), cand('H-2', THREE)], parts, []);
  const p = r.pairs[0].byBuild[0];
  assert.equal(p.heldout.verdict, 'indistinguishable-on-available-evidence'); assert.equal(p.pattern, 'indistinguishable on the available evidence');
  assert.match(p.heldout.explanation, /does not make them the same rule/);
  assert.doesNotMatch(JSON.stringify(r), /equivalen|proved|always/i);
  // non-overlapping predictions are counted, not compared
  const turnOnly = rep({ form: 'law', situation: 'turn-start', when: { op: 'eq', args: [f('turn'), c(99)] }, expect: [{ field: 'actionsGranted', equals: c(0) }] });
  assert.equal(discriminateCore([cand('H-1', PIECES), cand('H-9', turnOnly)], parts, []).pairs[0].byBuild[0].heldout.verdict, 'no-common-predictions');
});

test('AC-P5.4 explicit abstentions are their own column and never change an accuracy figure; missing representations are counted apart', () => {
  const base = heldoutCore([cand('H-1', PIECES)], PARTS), withAbst = heldoutCore([cand('H-1', PIECES), cand('H-2', null, 'abstention'), cand('H-3', null)], PARTS);
  assert.equal(withAbst.columns.explicitAbstentions, 1); assert.equal(withAbst.columns.withoutRepresentation, 1); assert.equal(base.columns.explicitAbstentions, 0);
  assert.equal(canonical(withAbst.hypotheses[0]), canonical(base.hypotheses[0]), 'the scored hypothesis is unchanged by an abstention');
  assert.equal((withAbst.hypotheses[1] as any).status, 'explicit-abstention'); assert.deepEqual((withAbst.hypotheses[1] as any).representations, []);
  assert.equal((withAbst.hypotheses[2] as any).status, 'no-sealed-representation');
  assert.ok(!JSON.stringify(withAbst.hypotheses[1]).includes('accuracy'));
  // an abstention is never a discrimination candidate
  const d = discriminateCore([cand('H-1', PIECES), cand('H-2', null, 'abstention')], PARTS, []);
  assert.equal(d.pairs.length, 0); assert.equal(d.abstentions.length, 1);
  // submitter-authored and external translations are reported separately
  const two = heldoutCore([cand('H-1', PIECES), cand('H-4', THREE, 'hypothesis', 'external-translation')], PARTS);
  assert.deepEqual([two.columns.submitter.representations, two.columns.externalTranslation.representations], [1, 1]);
});

test('AC-P5.5 every rate carries k, n, its unit and a Wilson 95% interval; descriptive situation rates and independent case/match units are separate', () => {
  const p = predictive(PIECES_ONLY.clauses as never, [T('M-1/t1', 3, 3), T('M-1/t2', 3, 4), T('M-2/t1', 3, 3), T('C-1/s1', 2, null, 'C-1')]);
  assert.deepEqual([p.accuracy.outcomeChecks.k, p.accuracy.outcomeChecks.n], [2, 3]);
  assert.deepEqual([p.accuracy.units.k, p.accuracy.units.n], [1, 2], 'match M-1 has a contradicting turn: one of two units correct');
  assert.equal(p.accuracy.units.matches, 2);
  assert.deepEqual(p.coverage.k === 4 && p.coverage.n === 4, true);
  assert.deepEqual(rate(0, 0, 'x'), { k: 0, n: 0, rate: null, wilson95: null, unit: 'x' }, 'no denominator, no rate');
  const walk = (x: unknown, path: string): void => {
    if (Array.isArray(x)) return x.forEach((y, i) => walk(y, `${path}[${i}]`));
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if ('rate' in o) { assert.ok(Number.isInteger(o.k) && Number.isInteger(o.n) && typeof o.unit === 'string', path); assert.ok(o.n ? Array.isArray(o.wilson95) : o.wilson95 === null, path); }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    }
  };
  walk(heldoutCore([cand('H-1', PIECES), cand('H-2', THREE)], PARTS), 'core');
  assert.match(p.accuracy.situations.note, /not independent/);
});

test('generation procedure: frozen code and build hashes verify; a changed input, an existing output or a run before the freeze are refused', async () => {
  const proc = join(ROOT, 'evidence/gw2/procedures/generation-p5-1.json');
  const p = loadGenerationProcedure(proc);
  assert.ok(p.code.some(x => x.path === 'gamewatch/gw2/scenarios-p5.ts') && Object.keys(p.buildHashes).length === 6);
  assert.equal(p.buildHashes['QX-41'].tree, p.buildHashes['gt-clean'].tree, 'the clean build is the unchanged engine');
  const d = mkdtempSync(join(tmpdir(), 'gw2-p5-')), bad = join(d, 'proc.json'), q = JSON.parse(readFileSync(proc, 'utf8'));
  q.code[0].sha256 = '0'.repeat(64); writeFileSync(bad, JSON.stringify(q));
  assert.throws(() => loadGenerationProcedure(bad), /does not match its frozen sha256/);
  await assert.rejects(generate(proc, 'experiment', join(ROOT, 'evidence/gw2/p5-experiment/generated')), /never regenerated or replaced/);
  await assert.rejects(generate(proc, 'experiment', join(d, 'out'), { now: () => new Date(Date.parse(p.frozenAt) - 1000) }), GenerationError);
  rmSync(d, { recursive: true, force: true });
});

test('generation provenance: the committed P5 bundles match their provenance records, use only the frozen builds and seeds, and are partitioned as an experiment (not a fixture)', () => {
  for (const dir of ['evidence/gw2/p5-experiment/generated', 'evidence/gw2/p5-validation/generated']) {
    const prov = JSON.parse(readFileSync(join(ROOT, dir, 'PROVENANCE.json'), 'utf8')), b = JSON.parse(readFileSync(join(ROOT, dir, 'bundle.json'), 'utf8'));
    assert.equal(fileSha256(join(ROOT, dir, 'bundle.json')), prov.bundle.sha256, dir);
    assert.equal(prov.procedure.sha256, fileSha256(join(ROOT, 'evidence/gw2/procedures/generation-p5-1.json')));
    assert.ok(Date.parse(prov.startedAt) > Date.parse(prov.procedure.frozenAt) && Date.parse(b.generatedAt) > Date.parse(prov.procedure.frozenAt), 'generated after the freeze');
    const p = JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/procedures/generation-p5-1.json'), 'utf8')), run = p.runs[prov.run];
    for (const x of prov.builds) assert.equal(x.sourceTree, p.buildHashes[x.label].tree, `${dir} ${x.label}`);
    assert.equal(b.cases.length, run.scripts.length * run.builds.length, 'every script on every build, nothing filtered');
    assert.equal(b.matches.length, run.matches ? run.matches.seeds.length * run.matches.firstMovers.length * run.builds.length : 0);
    if (run.matches) assert.deepEqual([...new Set(b.matches.map((m: any) => m.seed))].sort(), run.matches.seeds);
  }
  const part = JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/p5-experiment/partitions/PARTITION.json'), 'utf8'));
  assert.equal(part.fixture, undefined, 'an experimental partition, not a fixture');
  assert.equal(part.bundle.sha256, fileSha256(BUNDLE));
});

test('real-engine mutation validation (D69): probes and verifier on unchanged single-defect builds; observed deviations equal the declared expectations', () => {
  const v = JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/p5-validation/MUTATION_VALIDATION.json'), 'utf8'));
  assert.equal(v.probes.allAsExpected, true); assert.equal(v.verifier.allAsExpected, true); assert.deepEqual(v.verifier.unexpected, []);
  const dev = Object.fromEntries(v.verifier.matrix.map((m: any) => [m.build, m.rules.filter((x: any) => x.value === 'deviates').map((x: any) => x.rule).sort()]));
  assert.deepEqual(dev, { 'gt-B1': ['R14', 'R7'], 'gt-B2': ['R8'], 'gt-B3': ['R3'], 'gt-clean': [] });
  for (const m of v.verifier.matrix) for (const x of m.rules.filter((y: any) => y.value === 'deviates')) assert.equal(x.witnessesMatchIntendedViolation, true, `${m.build} ${x.rule}`);
  const r8 = v.verifier.matrix.find((m: any) => m.build === 'gt-clean').rules.find((x: any) => x.rule === 'R8');
  assert.equal(r8.value, 'conforms', 'R8 clause 3 is now evaluated (Q21 multi-cell cases)');
  assert.equal(v.bundle.sha256, fileSha256(join(ROOT, 'evidence/gw2/p5-validation/generated/bundle.json')));
});

test('Q20 submitter-first: the optional structured field is stored verbatim; readable ones become submitter representations, unreadable ones are recorded, never repaired; external translations are separate', async () => {
  const { exp, r } = await demoExp(), nodes = verify(join(exp, 'judgments.ndjson')).nodes;
  const hyps = nodes.filter(n => n.kind === 'hypothesis'), reps = nodes.filter(n => n.kind === 'representation');
  const typed = P5_SCRIPT.filter(x => x.form.representation).length;
  assert.equal(r.submitter.length, typed); assert.equal(r.translations.length, P5_SCRIPT.filter(x => x.translation).length);
  for (const n of reps.filter(x => (x.body as any).origin === 'submitter')) {
    const h = hyps.find(x => x.id === n.parents[0].id)!;
    assert.equal(n.author.id, h.author.id, 'authored by the submitter');
    assert.equal((n.body as any).rawSha256, (await import('../gamewatch/gw2/judgments.ts')).sha256(String(h.body.submittedRepresentation)));
  }
  const broken = reps.find(x => (x.body as any).parseError)!;
  assert.equal((broken.body as any).representation, null);
  const ho = r.heldout.report.hypotheses.find((h: any) => h.hypothesis === broken.parents[0].id) as any;
  assert.equal(ho.representations[0].representationStatus, 'not-representable');
  assert.ok(reps.filter(x => (x.body as any).origin === 'external-translation').every(x => canonical((x.body as any).translatorAccess) === canonical({ spec: false, heldout: false, eval: false })));
  assert.equal(r.heldout.report.columns.submitter.representations, typed); assert.equal(r.heldout.report.columns.externalTranslation.representations, 2);
  // the schema page states the format and fields, and no rule
  const page = schemaPage();
  assert.match(page, /effect-placement/); assert.match(page, /never corrected/); assert.doesNotMatch(page, /R\d+\b|Send home|first mover/i);
});

test('AC-P5.1 held-out files are never read before the hypothesis freeze, nor before the representation seal (file-access assertion)', async () => {
  const { exp } = await demoExp(), d = mkdtempSync(join(tmpdir(), 'gw2-p5-'));
  // an experiment copy with neither freeze nor seal; and one frozen but not sealed
  const unfrozen = join(d, 'u'), unsealed = join(d, 's');
  cpSync(exp, unfrozen, { recursive: true }); rmSync(join(unfrozen, 'hypotheses'), { recursive: true }); rmSync(join(unfrozen, 'evaluation-ledger.ndjson'));
  cpSync(exp, unsealed, { recursive: true }); rmSync(join(unsealed, 'hypotheses/REPRESENTATIONS.json')); rmSync(join(unsealed, 'evaluation-ledger.ndjson'));
  const reads: string[] = [], orig = fs.readFileSync;
  const spy = (p: fs.PathOrFileDescriptor, ...a: unknown[]) => { if (typeof p === 'string') reads.push(resolve(p)); return (orig as any)(p, ...a); };
  (fs as any).readFileSync = spy; syncBuiltinESMExports();
  try {
    for (const x of [unfrozen, unsealed]) {
      assert.throws(() => evaluateHeldout(x), FreezeError);
      assert.throws(() => discriminate(x), FreezeError);
    }
    assert.equal(verifyRepresentationSeal(exp).ok, true); // spy self-check: a module's named readFileSync import is intercepted
  } finally { (fs as any).readFileSync = orig; syncBuiltinESMExports(); }
  const forbidden = reads.filter(p => p.startsWith(resolve(d)) && /partitions[\\/](heldout|eval)[\\/]/.test(p));
  assert.deepEqual(forbidden, [], 'nothing under heldout/ or eval/ of the refused experiments was read, not even as bytes');
  assert.ok(reads.some(p => p.endsWith('REPRESENTATIONS.json')), 'the spy intercepts reads made by the GW2 modules');
  assert.equal(existsSync(join(unsealed, 'evaluation-ledger.ndjson')), false, 'refused before the gate was opened: nothing recorded as opened');
  rmSync(d, { recursive: true, force: true });
});

test('representation seal: written before any opening; a representation added later is excluded; sealing after an opening and translations claiming access are refused; a broken seal refuses evaluation', async () => {
  const { exp, r } = await demoExp(), d = mkdtempSync(join(tmpdir(), 'gw2-p5-')), x = join(d, 'x');
  assert.equal(verifyRepresentationSeal(exp).ok, true);
  assert.equal(r.seal.ledgerEntriesAtSeal, 0);
  const firstOpen = verifyLedger(join(exp, 'evaluation-ledger.ndjson')).entries.find(e => e.event === 'opened')!;
  assert.ok(firstOpen.graphHead.count >= r.seal.graphHead.count);
  cpSync(exp, x, { recursive: true });
  const h = verify(join(x, 'judgments.ndjson')).nodes.find(n => n.body.ref === 'H-11')!;
  assert.throws(() => appendTranslation(x, h.id, { representation: THREE, author: { kind: 'operator', id: 'operator-01', version: '1' }, fidelity: 'faithful', notes: '', access: { spec: false, heldout: false, eval: false }, method: 'late' }), /already been opened/);
  assert.throws(() => sealRepresentations(x), /already been opened|already sealed/);
  // a representation appended to the graph after the seal (bypassing the guard) is not used
  const late = append(join(x, 'judgments.ndjson'), { kind: 'representation', parents: [{ id: h.id, relation: 'represents' }], author: { kind: 'test-double', id: 'late', version: '1' }, origin: 'live', at: '2026-11-25T21:00:00.000Z', evidenceRefs: [], reason: 'late', body: { origin: 'external-translation', representation: THREE } }).id;
  const rep2 = evaluateHeldout(x, { at: '2026-11-25T21:00:00.000Z' }).report;
  assert.deepEqual(rep2.seal.notSealedIgnored, [late]);
  assert.equal((rep2.hypotheses.find((y: any) => y.hypothesis === h.id) as any).status, 'no-sealed-representation');
  // an edited seal refuses
  const sf = join(x, 'hypotheses/REPRESENTATIONS.json'), s = JSON.parse(readFileSync(sf, 'utf8'));
  s.representations.pop(); writeFileSync(sf, JSON.stringify(s));
  assert.throws(() => evaluateHeldout(x), /sealed list differs/);
  rmSync(d, { recursive: true, force: true });
});

test('P5 pipeline on the generated observations: discovery fit and held-out prediction reported separately; competing hypotheses discriminated; deterministic', async () => {
  const { r } = await demoExp(), h = r.heldout.report, byRef = (ref: string) => h.hypotheses.find((x: any) => x.ref === ref) as any;
  const q73 = (ref: string) => byRef(ref).representations[0].byBuild.find((b: any) => b.build === 'QX-73');
  const q41 = (ref: string) => byRef(ref).representations[0].byBuild.find((b: any) => b.build === 'QX-41');
  assert.equal(q73('H-1').discoveryFit.value, 'fits'); assert.equal(q73('H-1').heldout.accuracy.outcomeChecks.rate, 1);
  assert.ok(q41('H-1').heldout.accuracy.outcomeChecks.rate < 1, 'first-mover +1 mispredicts the clean build');
  assert.equal(q41('H-2').heldout.accuracy.outcomeChecks.rate, 1);
  assert.ok(q73('H-4').heldout.accuracy.outcomeChecks.n > 0, 'the asymmetric-shield claim is scored on held-out entries');
  assert.equal(byRef('H-10').status, 'explicit-abstention'); assert.equal(byRef('H-11').status, 'no-sealed-representation');
  // discrimination: the declared competitors H-1 / H-2 are separated, with the exact predictions listed
  const pair = r.discrimination.report.pairs.find((p: any) => p.declaredCompetitors && p.candidates.some((l: string) => l.startsWith('H-1/')) && p.candidates.some((l: string) => l.startsWith('H-2/')))!;
  const b73 = pair.byBuild.find((b: any) => b.build === 'QX-73')!;
  assert.equal(b73.heldout.verdict, 'separated'); assert.ok(b73.heldout.separatingSituations.every((s: any) => Object.keys(s.predictions).length === 2 && 'recordedOutcome' in s));
  assert.doesNotMatch(JSON.stringify(r.discrimination.report) + JSON.stringify(h), /equivalen/i);
  // determinism: the pure cores give the same JSON again
  assert.equal(canonical(heldoutCore([cand('H-1', PIECES)], PARTS)), canonical(heldoutCore([cand('H-1', PIECES)], PARTS)));
});

test('committed P5 demonstration and experiment directories verify: freeze, representation seal, graph, partitions; the experiment partition is unopened', async () => {
  const { verifyFreeze } = await import('../gamewatch/gw2/freeze.ts'), { verifyPartitions } = await import('../gamewatch/gw2/partition.ts');
  const DEMO = join(ROOT, 'evidence/gw2/p5-demo'), EXP = join(ROOT, 'evidence/gw2/p5-experiment');
  assert.equal(verifyFreeze(DEMO).ok, true); assert.equal(verifyRepresentationSeal(DEMO).ok, true);
  assert.equal(verify(join(DEMO, 'judgments.ndjson'), { checkRefs: true }).ok, true);
  assert.deepEqual(verifyPartitions(EXP), []);
  for (const f of ['judgments.ndjson', 'evaluation-ledger.ndjson', 'hypotheses', 'sessions']) assert.equal(existsSync(join(EXP, f)), false, `${f}: the experimental partition has not been used`);
  const lc = JSON.parse(readFileSync(join(EXP, 'LEAK_CHECK.json'), 'utf8'));
  assert.equal(lc.ok, true, 'leak check passed on the experimental input boundary');
});

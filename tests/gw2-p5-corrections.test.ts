/**
 * GW2 P5 corrections (operator review PHASE_5_CONDITIONALLY_APPROVED, D88–D92): regression tests.
 *   1. cross-partition build alignment for build-specific conditions
 *   2. fully vs partially evaluated situations and units
 *   3. self-contradictory predictions in discrimination
 *   4. unverified submissions and unsuitable sessions preserved, never in the primary analysis set
 *   5. descriptive rates vs independent replication
 * No Kane, no model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { HYPOTHESIS_SCHEMA } from '../gamewatch/gw2/hypothesis.ts';
import type { Situation } from '../gamewatch/gw2/situations.ts';
import { heldoutCore, predictive, alignBuilds, buildReferences, primaryFromNode, type Cand, type Groups } from '../gamewatch/gw2/heldout.ts';
import { comparePair, discriminateCore } from '../gamewatch/gw2/discriminate.ts';
import { runP5Demo } from '../gamewatch/gw2/p5-demo.ts';

const f = (name: string) => ({ op: 'field', name }), c = (value: unknown) => ({ op: 'const', value });
const eq = (a: unknown, b: unknown) => ({ op: 'eq', args: [a, b] });
const rep = (...clauses: unknown[]) => ({ schema: HYPOTHESIS_SCHEMA, clauses });
const T = (id: string, build: string, pieces: number, granted: number | null, src = id.split('/')[0], type: 'match' | 'case' = 'match'): Situation =>
  ({ id, kind: 'turn-start', build, source: { type, id: src, pointer: '' }, fields: { build, side: 'Human', turn: 1, isFirstMover: true, piecesOnBoard: pieces, pendingBonus: 0, actionsGranted: granted } });
const cand = (ref: string, r: unknown, primary?: { eligible: boolean; reasons: string[] }): Cand => ({ hypothesis: `id-${ref}`, ref, kind: 'hypothesis', ...(primary ? { primary } : {}), representations: [{ id: `rep-${ref}`, origin: 'submitter', fidelity: 'faithful', author: 'test-double:x', representation: r }] });
const OK = { eligible: true, reasons: [] };

test('correction 1: a build condition written with a discovery build id stays applicable on held-out after alignment', () => {
  // the same original build has different neutral ids in the two partitions
  const discMap = { 'build-aaaa': 'QX-41', 'build-bbbb': 'QX-73' }, heldMap = { 'build-cccc': 'QX-41', 'build-dddd': 'QX-73' };
  const onlyQX41 = rep({ form: 'law', situation: 'turn-start', when: eq(f('build'), c('build-aaaa')), expect: [{ field: 'actionsGranted', equals: f('piecesOnBoard') }] });
  const held = [T('M-1/t1', 'build-cccc', 3, 3), T('M-2/t1', 'build-dddd', 3, 4)];
  // without alignment the condition never applies on held-out: the silent failure being corrected
  const raw = predictive(onlyQX41.clauses as never, held.filter(s => s.build === 'build-cccc'));
  assert.equal(raw.accuracy.outcomeChecks.n, 0, 'unaligned: the discovery build id matches nothing on held-out');
  const al = alignBuilds(held, heldMap, discMap);
  assert.deepEqual(al.alignment['build-cccc'], { original: 'QX-41', discoveryId: 'build-aaaa' });
  assert.deepEqual(al.notInDiscovery, []);
  const p = predictive(onlyQX41.clauses as never, al.sits.filter(s => s.build === 'build-aaaa'));
  assert.deepEqual([p.accuracy.outcomeChecks.k, p.accuracy.outcomeChecks.n], [1, 1], 'aligned: QX-41 held-out turn is evaluated');
  assert.equal(predictive(onlyQX41.clauses as never, al.sits.filter(s => s.build === 'build-bbbb')).accuracy.outcomeChecks.n, 0, 'QX-73 is not QX-41');
  // a held-out build absent from discovery is reported, not silently renamed
  assert.deepEqual(alignBuilds([T('M-3/t1', 'build-eeee', 3, 3)], { 'build-eeee': 'QX-99' }, discMap).notInDiscovery, ['build-eeee']);
  // an id that names no discovery build is reported as unresolved
  const r = buildReferences(rep({ form: 'law', situation: 'turn-start', when: eq(f('build'), c('build-cccc')), expect: [{ field: 'actionsGranted', equals: c(3) }] }).clauses as never, Object.keys(discMap));
  assert.deepEqual([r.resolved, r.unresolved], [[], ['build-cccc']]);
});

test('correction 1 (pipeline): the committed P5 demonstration aligns every held-out build to a discovery build through the gate', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gw2-p5c-'));
  try {
    const r = await runP5Demo(join(ROOT, 'evidence/gw2/p5-experiment/generated/bundle.json'), join(d, 'exp'), { at: '2026-11-25T20:00:00.000Z' });
    const al = r.heldout.report.buildAlignmentToDiscovery as Record<string, { builds: Record<string, { original: string; discoveryId: string | null }>; notInDiscovery: string[] }>;
    assert.deepEqual(al.heldout.notInDiscovery, []);
    const disc = al.discovery.builds;
    for (const [, a] of Object.entries(al.heldout.builds)) assert.equal(disc[a.discoveryId!].original, a.original);
    // every demonstration hypothesis came from a verified test-double session: all in the primary set
    assert.equal(r.heldout.report.primaryAnalysis.excluded.length, 0);
    assert.equal(r.heldout.report.evaluator.version, '2');
    // the three-way verifier aligns held-out builds the same way (verify.ts 2.1)
    const discIds = new Set(Object.keys(disc));
    const heldBuilds = (r.threeWay.report.hypotheses as any[]).flatMap(h => (h.representations ?? []).flatMap((x: any) => (x.byPartition ?? []).filter((p: any) => p.partition === 'heldout').map((p: any) => p.build)));
    assert.ok(heldBuilds.length > 0 && heldBuilds.every(b => discIds.has(b)), 'held-out three-way results are keyed by discovery build ids');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('correction 2: partially evaluated situations and units are never counted as verified successes', () => {
  const PIECES = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: f('piecesOnBoard') }, { field: 'notRecorded', equals: c(1) }] });
  const full = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: f('piecesOnBoard') }] });
  const sits = [T('M-1/t1', 'b', 3, 3), T('M-2/t1', 'b', 3, 3), T('M-2/t2', 'b', 2, 2)];
  const p = predictive(PIECES.clauses as never, sits);
  // the conditional rate is preserved...
  assert.deepEqual([p.accuracy.units.k, p.accuracy.units.n], [2, 2]);
  // ...but no unit is fully evaluated, so none is a verified success
  assert.deepEqual([p.accuracy.units.fullyEvaluated.k, p.accuracy.units.fullyEvaluated.n], [0, 0]);
  assert.equal(p.accuracy.units.partiallyEvaluated.count, 2);
  assert.equal(p.accuracy.units.partiallyEvaluated.noContradictionOnRecordedChecks, 2);
  assert.equal(p.accuracy.situations.partiallyEvaluated.count, 3);
  const q = predictive(full.clauses as never, [...sits, T('M-3/t1', 'b', 3, null)]);
  assert.deepEqual([q.accuracy.units.fullyEvaluated.k, q.accuracy.units.fullyEvaluated.n], [2, 2]);
  assert.equal(q.accuracy.units.withoutAnyRecordedCheck, 1, 'M-3 has a check but no recorded outcome');
  assert.match(p.accuracy.units.note, /conditional on recorded checks/);
});

test('correction 3: self-contradictory predictions are identified and never compared as ordinary predictions', () => {
  const selfC = rep(
    { form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] },
    { form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(4) }] });
  const three = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] });
  const a = { id: 'a', label: 'a', hypothesis: 'x', origin: 's', clauses: selfC.clauses as never }, b = { id: 'b', label: 'b', hypothesis: 'y', origin: 's', clauses: three.clauses as never };
  const r = comparePair(a, b, [T('M-1/t1', 'b', 3, 3), T('M-1/t2', 'b', 3, 4)]);
  assert.equal(r.counts.selfContradictory.a, 2); assert.equal(r.counts.identical, 0); assert.equal(r.counts.contradictoryWithOutcome, 0);
  assert.equal(r.verdict, 'no-common-predictions', 'nothing usable was compared');
  assert.deepEqual(r.selfContradictions[0].values, [3, 4]);
  const core = discriminateCore([cand('H-1', selfC), cand('H-2', three)], { discovery: { b: [T('M-1/t1', 'b', 3, 3)] }, heldout: { b: [] } }, []);
  assert.equal(core.candidates.find(x => x.hypothesis === 'id-H-1')!.selfContradictory, true);
  assert.equal(core.candidates.find(x => x.hypothesis === 'id-H-2')!.selfContradictory, false);
});

test('correction 4: unverified submissions and unsuitable sessions are preserved but never enter the primary analysis set', () => {
  const ok = primaryFromNode({ author: { id: 'gw2-review-test-double' }, body: { verification: 'journal-verified', counted: true, sessionValidity: { status: 'verified', primaryAnalysis: true } } });
  assert.deepEqual(ok, { eligible: true, reasons: [] });
  const unv = primaryFromNode({ author: { id: 'unverified-submitter' }, body: { verification: 'journal-verified', counted: false, sessionValidity: { status: 'verified', primaryAnalysis: true } } });
  assert.equal(unv.eligible, false); assert.ok(unv.reasons.some(r => /unverified submitter/.test(r)));
  const uns = primaryFromNode({ author: { id: 'gw2-review-test-double' }, body: { verification: 'journal-verified', counted: true, sessionValidity: { status: 'unsuitable-for-primary-analysis', primaryAnalysis: false } } });
  assert.equal(uns.eligible, false); assert.match(uns.reasons.join(), /unsuitable-for-primary-analysis/);
  const note = primaryFromNode({ author: { id: 'gw2-review-test-double' }, body: { verification: 'unverified-session-note', counted: true, sessionValidity: { status: 'logging-disabled-condition', primaryAnalysis: false } } });
  assert.equal(note.eligible, false);
  assert.equal(primaryFromNode({ author: { id: 'x' }, body: {} }).eligible, false, 'missing information is not eligibility');
  const P = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: f('piecesOnBoard') }] });
  const parts = { discovery: { b: [T('M-1/t1', 'b', 3, 3)] }, heldout: { b: [T('M-2/t1', 'b', 3, 3)] } };
  const core = heldoutCore([cand('H-1', P, OK), cand('H-2', P, uns), cand('H-3', P, unv)], parts);
  assert.deepEqual(core.primaryAnalysis.hypotheses, ['id-H-1']);
  assert.deepEqual(core.primaryAnalysis.excluded.map(x => x.ref), ['H-2', 'H-3']);
  assert.equal(core.hypotheses.length, 3, 'preserved and still reported');
  assert.equal(core.columns.primaryAnalysisSet, 1); assert.equal(core.columns.preservedNotPrimary, 2);
  const d = discriminateCore([cand('H-1', P, OK), cand('H-2', rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] }), uns)], parts, []);
  assert.equal(d.pairs[0].primaryAnalysis, false, 'a pair with an excluded hypothesis is flagged, not primary');
});

test('correction 5: rates are descriptive; independent replication is counted in seed groups and script families', () => {
  const P = rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: f('piecesOnBoard') }] });
  const sits = [T('M-1/t1', 'b', 3, 3), T('M-2/t1', 'b', 3, 3), T('C-1/s1', 'b', 3, 3, 'C-1', 'case'), T('C-2/s1', 'b', 3, 3, 'C-2', 'case')];
  const groups: Groups = { of: new Map([['match:M-1', 'seed:1'], ['match:M-2', 'seed:1'], ['case:C-1', 'script:S-a'], ['case:C-2', 'script:S-a']]), basis: 'test' };
  const p = predictive(P.clauses as never, sits, groups);
  assert.equal(p.accuracy.units.n, 4, 'four units');
  assert.deepEqual([p.replication.groups, p.replication.matchSeedGroups, p.replication.caseScriptFamilies], [2, 1, 1], 'but only one seed group and one script family');
  assert.match(p.replication.note, /not confidence statements/);
  const u = predictive(P.clauses as never, sits);
  assert.match(u.replication.basis, /unknown/);
  for (const k of ['outcomeChecks', 'situations', 'units'] as const) assert.match(p.accuracy[k].note, /descriptive/);
});

test('correction 5 (pipeline): the P5 held-out partition has one seed, so its matches are one replication group per build', () => {
  const e = JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/p5-demo/partitions/eval/eval.json'), 'utf8'));
  assert.equal(e.assignment.heldout.seeds.length, 1, 'the P5 held-out split has a single seed (why U1 asks for a new P7 generation)');
});

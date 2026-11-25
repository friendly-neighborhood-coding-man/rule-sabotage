/**
 * GW2 P4 corrections (PHASE_4_CONDITIONALLY_APPROVED, item 1): regression tests for the four verifier defects found in
 * review. Hand-written situations only; no engine run, no model, no Kane.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { HYPOTHESIS_SCHEMA, type InvarianceClause, type LawClause } from '../gamewatch/gw2/hypothesis.ts';
import type { Situation } from '../gamewatch/gw2/situations.ts';
import { threeWay, loadEncoding, DEFAULT_ENCODING, observational, evalLaw, evalInvariance, type HypInput } from '../gamewatch/gw2/verify.ts';

const GW1 = JSON.parse(readFileSync(join(ROOT, 'evidence/gamewatch/evidence.json'), 'utf8'));
const ENC = loadEncoding(DEFAULT_ENCODING, GW1.game.rules);
const f = (name: string) => ({ op: 'field', name }), c = (value: unknown) => ({ op: 'const', value });
const eq = (a: unknown, b: unknown) => ({ op: 'eq', args: [a, b] }), and = (...args: unknown[]) => ({ op: 'and', args });
const rep = (...clauses: unknown[]) => ({ schema: HYPOTHESIS_SCHEMA, clauses });
const H = (id: string, r: unknown): HypInput => ({ id, kind: 'hypothesis', representations: [{ id: `rep-${id}`, author: {}, representation: r, fidelity: { declared: 'faithful' } }] });
type F = Record<string, string | number | boolean | null>;
const E = (id: string, fields: F, src = { type: 'case', id: id.split('/')[0] }): Situation => ({ id, kind: 'effect-entry', build: 'b', source: { ...src, pointer: '' }, fields: {
  build: 'b', effect: 'Send home', effectKind: 'send-home', pieceSide: 'Human', effectOwner: 'AI', ownerRelation: 'enemy', arrival: 'walk', chainDepth: 1, capped: false, pieceShieldedBefore: true, multiCell: false,
  fired: null, absorbed: null, cellUsedUp: null, shieldAfter: null, otherCellsRemain: null, ...fields } as Situation['fields'] });
const T = (id: string, fields: F, src = { type: 'match', id: id.split('/')[0] }): Situation => ({ id, kind: 'turn-start', build: 'b', source: { ...src, pointer: '' }, fields: { build: 'b', side: 'Human', turn: 1, isFirstMover: true, piecesOnBoard: 3, pendingBonus: 0, actionsGranted: null, ...fields } as Situation['fields'] });
const part = (sits: Situation[]) => [{ partition: 'p', builds: ['b'], situations: sits }];
const R14_LIKE: LawClause = { form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('capped'), c(false))) as never, expect: [{ field: 'absorbed', equals: c(true) as never }, { field: 'fired', equals: c(false) as never }, { field: 'shieldAfter', equals: c(false) as never }] };

test('correction 1: a multi-outcome law with one matching outcome and the rest missing is partial support, not full support; a counter-example stays a counter-example', () => {
  const sits = [E('c1/s1/e0', { absorbed: true }), E('c2/s1/e0', { absorbed: true, fired: false, shieldAfter: false })];
  const r = evalLaw(R14_LIKE, sits);
  assert.deepEqual(r.fit, ['c2/s1/e0'], 'only the situation with every expected outcome recorded and matching is full support');
  assert.deepEqual(r.partial, ['c1/s1/e0'], 'partial positive evidence is preserved');
  assert.deepEqual(r.outcomeChecks, { matching: 4, contradicting: 0, unknown: 2, unpredicted: 0, inconclusive: 0 });
  // only partial support anywhere → fits-partially, never fits
  const only = observational('H↔O', [R14_LIKE], [sits[0]], 'p', 'b');
  assert.equal(only.value, 'fits-partially'); assert.deepEqual(only.scope.support, { full: 0, partial: 1, counterExample: 0, inconclusive: 0 });
  assert.match(only.statement, /0 with full support, 1 with partial support/);
  const both = observational('H↔O', [R14_LIKE], sits, 'p', 'b');
  assert.equal(both.value, 'fits'); assert.deepEqual(both.scope.support, { full: 1, partial: 1, counterExample: 0, inconclusive: 0 });
  // one outcome contradicts while the others are missing: a counter-example, not partial support
  const bad = observational('H↔O', [R14_LIKE], [E('c3/s1/e0', { absorbed: false })], 'p', 'b');
  assert.equal(bad.value, 'contradicted'); assert.deepEqual(bad.counterExamples, [{ id: 'c3/s1/e0', field: 'absorbed', predicted: true, observed: false }]);
  assert.equal(bad.scope.outcomeChecks.unknown, 2, 'the missing outcomes are counted as unknown, not as agreement');
  // reported as "partially supported" in the per-hypothesis summary
  const t = threeWay([H('h', rep(R14_LIKE))], part([sits[0]]), ENC) as any;
  assert.equal(t.hypotheses[0].representations[0].byPartition[0].summary, 'partially-supported-on-evaluated-situations');
});

test('correction 2: invariance needs comparable recorded outcomes across different variants; missing outcomes and within-variant differences do not establish a violation', () => {
  const inv: InvarianceClause = { form: 'invariance', situation: 'effect-entry', groupBy: ['effectKind'], vary: ['pieceSide'], outcomes: ['fired', 'absorbed'] };
  // (a) one variant has no recorded outcome: no comparison, nothing evaluated, not "invariant"
  const a = evalInvariance(inv, [E('h/1', { fired: true, absorbed: false }), E('a/1', { pieceSide: 'AI' })]);
  assert.equal(a.evaluated.length, 0); assert.equal(a.comparisons.length, 0); assert.equal(a.counter.length, 0);
  assert.equal(observational('O↔S', [inv], [E('h/1', { fired: true, absorbed: false }), E('a/1', { pieceSide: 'AI' })], 'p', 'b').value, 'insufficient-evidence');
  assert.ok(a.excluded['missing outcome (fired, absorbed)'] === 1 && a.excluded['no comparison partner with a recorded outcome'] === 1, JSON.stringify(a.excluded));
  // (b) values differ WITHIN one variant (Human: fired true and false) and the other variant overlaps: inconclusive, no violation
  const b = evalInvariance({ ...inv, outcomes: ['fired'] }, [E('h/1', { fired: true }), E('h/2', { fired: false }), E('a/1', { pieceSide: 'AI', fired: true })]);
  assert.equal(b.counter.length, 0, 'a within-variant difference is not a cross-variant violation');
  assert.deepEqual(b.comparisons.map(x => x.result), ['inconclusive']);
  // (c) a within-variant difference with NO second variant at all: no partner, excluded
  const c0 = evalInvariance(inv, [E('h/1', { fired: true, absorbed: false }), E('h/2', { fired: false, absorbed: true })]);
  assert.equal(c0.counter.length, 0); assert.equal(c0.evaluated.length, 0); assert.equal(c0.excluded['no comparison partner (only one combination of the varied fields in its group)'], 2);
  // (d) disjoint recorded values across variants: violation, with comparison partners and outcome-specific witnesses
  const d = evalInvariance(inv, [E('h/1', { fired: true, absorbed: false }), E('a/1', { pieceSide: 'AI', fired: false, absorbed: null })]);
  assert.deepEqual([...d.counter].sort((x, y) => x.id.localeCompare(y.id)), [{ id: 'a/1', field: 'fired', predicted: true, observed: false, partner: 'h/1' }, { id: 'h/1', field: 'fired', predicted: false, observed: true, partner: 'a/1' }]);
  assert.deepEqual(d.comparisons, [{ group: '["send-home"]', field: 'fired', variants: ['["AI"]', '["Human"]'], values: [[false], [true]], situations: ['a/1', 'h/1'], result: 'violation' }], 'absorbed is not compared: the AI variant has no recorded value');
  // (e) identical values across variants: consistent
  const e = evalInvariance(inv, [E('h/1', { fired: false, absorbed: true }), E('a/1', { pieceSide: 'AI', fired: false, absorbed: true })]);
  assert.deepEqual(e.fit.sort(), ['a/1', 'h/1']); assert.ok(e.comparisons.every(x => x.result === 'consistent'));
});

test('correction 3: the combined reading matches H↔S disagreements to recorded outcomes per situation AND outcome field; an unrelated deviation is not evidence', () => {
  // H: a shielded Human piece is hit (fired true) and loses its shield (shieldAfter false). Spec R14: fired false,
  // shieldAfter false. In the one situation H's shieldAfter is recorded and matches (H fits partially), H and S
  // disagree on fired, which is NOT recorded, and the build deviates from R14 only on cellUsedUp (an unrelated field).
  // A situation-level match would call this an accurate defect description; the field-level match does not.
  const h = rep({ form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('pieceSide'), c('Human')), eq(f('capped'), c(false))), expect: [{ field: 'fired', equals: c(true) }, { field: 'shieldAfter', equals: c(false) }] });
  const sits = [E('c1/s1/e0', { fired: null, absorbed: true, shieldAfter: false, cellUsedUp: false })];
  const p = (threeWay([H('h', h)], part(sits), ENC) as any).hypotheses[0].representations[0].byPartition[0];
  const r14 = p.readings.find((x: any) => x.rule === 'R14');
  assert.deepEqual(r14.relations, { 'H↔O': 'fits-partially', 'H↔S': 'disagrees', 'O↔S': 'deviates' });
  assert.equal(r14.reading, 'unresolved-ambiguity', 'a deviation on cellUsedUp does not support a claim about fired');
  assert.equal(r14.correspondence.corresponding, 0); assert.equal(r14.correspondence.withoutRecordedOutcome, 1); assert.equal(r14.correspondence.specDeviationsNotDescribed, 1);
  // with fired recorded as true the same disagreement corresponds: the triple names both predictions and the outcome
  const s2 = [E('c1/s1/e0', { fired: true, absorbed: false, shieldAfter: false, cellUsedUp: true })];
  const q = (threeWay([H('h', h)], part(s2), ENC) as any).hypotheses[0].representations[0].byPartition[0].readings.find((x: any) => x.rule === 'R14');
  assert.equal(q.reading, 'accurate-description-of-a-defect');
  assert.deepEqual(q.correspondence.examples.corresponding, [{ id: 'c1/s1/e0', field: 'fired', hypothesisPrediction: true, specPrediction: false, recordedOutcome: true, corresponds: true }]);
  // recorded but equal to the spec's prediction: non-corresponding (and H↔O is contradicted first)
  const s3 = [E('c1/s1/e0', { fired: false, absorbed: true, shieldAfter: false, cellUsedUp: true })];
  assert.equal((threeWay([H('h', h)], part(s3), ENC) as any).hypotheses[0].representations[0].byPartition[0].readings.find((x: any) => x.rule === 'R14').reading, 'hypothesis-contradicted-by-observations');
});

test('correction 4: denominators distinguish unique situations, clause checks, outcome checks and case/match units for multi-clause, multi-kind representations', () => {
  const two = rep(
    { form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: { op: 'add', args: [f('piecesOnBoard'), f('pendingBonus')] } }] },
    { form: 'law', situation: 'turn-start', when: eq(f('isFirstMover'), c(true)), expect: [{ field: 'actionsGranted', equals: c(3) }] },
    { form: 'law', situation: 'effect-entry', when: eq(f('pieceShieldedBefore'), c(true)), expect: [{ field: 'absorbed', equals: c(true) }, { field: 'fired', equals: c(false) }] });
  const sits = [
    T('M-1/t1/turn-start', { actionsGranted: 3 }), T('M-1/t2/turn-start', { isFirstMover: false, side: 'AI', turn: 2, actionsGranted: 3 }), T('M-1/t3/turn-start', { turn: 3, actionsGranted: 3 }),
    T('M-2/t1/turn-start', { actionsGranted: 3 }), E('C-1/s1/e0', { absorbed: true, fired: false }), E('C-2/s1/e0', { absorbed: true }),
  ];
  const ho = (threeWay([H('h', two)], part(sits), ENC) as any).hypotheses[0].representations[0].byPartition[0]['H↔O'];
  assert.equal(ho.value, 'fits');
  assert.equal(ho.scope.situationKind, 'turn-start+effect-entry');
  assert.equal(ho.scope.situationsOfKind, 6, 'every situation of either kind, counted once (not the max over clauses)');
  assert.equal(ho.scope.applicable, 6, 'unique applicable situations across clauses');
  assert.equal(ho.scope.evaluated, 6);
  assert.equal(ho.scope.clauseChecks, 4 + 3 + 2, 'clause 0: 4 turns; clause 1: 3 first-mover turns; clause 2: 2 entries');
  assert.deepEqual(ho.scope.outcomeChecks, { matching: 4 + 3 + 3, contradicting: 0, unknown: 1, unpredicted: 0, inconclusive: 0 });
  assert.deepEqual(ho.scope.support, { full: 5, partial: 1, counterExample: 0, inconclusive: 0 });
  assert.deepEqual(ho.scope.units, { cases: 2, matches: 2 }, 'four turn rows come from two matches: two match units, not four replicates');
  assert.ok(Object.keys(ho.scope.excluded).every(k => /^clause \d: /.test(k)), 'exclusions keyed per clause');
  assert.equal(ho.scope.excluded['clause 1: not applicable (condition false)'], 1);
  // H↔S denominators: unique situations and situation-field comparisons, separately
  const hs = (threeWay([H('h', two)], part(sits), ENC) as any).hypotheses[0].representations[0].byPartition[0]['H↔S'].find((x: any) => x.rule === 'R3');
  assert.equal(hs.scope.evaluated, 4); assert.equal(hs.fieldComparisons, 4, 'unique situation-field comparisons: two hypothesis clauses predicting the same value for the same turn are one comparison');
  assert.deepEqual(hs.scope.units, { cases: 0, matches: 2 });
});

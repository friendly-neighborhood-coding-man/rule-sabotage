/**
 * P8: the P7 pilot results reproduce offline from the published (redacted) evidence alone, and the committed
 * REPRODUCTION.json is exactly what the reproduction computes. Nothing under evidence/gw2/p7-pilot/ is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run, lawCounts, novelInputs, PUB } from '../gamewatch/gw2/p8-reproduce.ts';

const ROOT = join(import.meta.dirname, '..');
const sha = (f: string) => createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex');
const rec = JSON.parse(readFileSync(join(ROOT, PUB, 'REDACTION_RECORD.json'), 'utf8'));

test('offline reproduction passes every check and equals the committed REPRODUCTION.json byte for byte', () => {
  const before = rec.files.map((f: any) => sha(f.file));
  const out = run();
  assert.equal(out.ok, true, JSON.stringify(out.checks.filter(c => !c.ok)));
  assert.equal(JSON.stringify(out, null, 1) + '\n', readFileSync(join(ROOT, 'evidence/gw2/p8/REPRODUCTION.json'), 'utf8'));
  assert.deepEqual(rec.files.map((f: any) => sha(f.file)), before, 'published P7 evidence unchanged');
  assert.deepEqual(before, rec.files.map((f: any) => f.publishedSha256));
});

test('counterexample classification: turn-start counterexamples were in accessible discovery; the Freeze ones were not', () => {
  const out = run(), get = (ref: string, build: string) => out.counterexamples.find(a => a.hypothesis === ref)!.byBuild.find((b: any) => b.build === build);
  const h1 = get('H-1', 'QX-41');
  assert.deepEqual([h1.discovery.contradicted, h1.discovery.contradictedInEvidenceOpenedBySession, h1.discovery.contradictedInAccessibleEvidenceNotOpened], [390, 26, 364]);
  assert.deepEqual(h1.discovery.openedUnitsWithCounterexample, ['M-22e2f2']);
  assert.deepEqual([h1.heldout.contradicted, h1.heldout.alreadyExemplifiedInDiscovery, h1.heldout.absentFromDiscovery], [187, 187, 0]);
  for (const [b, n] of [['QX-41', 2], ['QX-73', 1]] as const) {
    const h2 = get('H-2', b);
    assert.equal(h2.discovery.contradicted, 0); assert.equal(h2.heldout.absentFromDiscovery, n);
    for (const c of h2.heldout.absentCases) assert.deepEqual(c.novelInputs, ['pieceShieldedBefore=true']);
  }
  for (const b of ['QX-41', 'QX-73']) assert.equal(get('H-3', b).heldout.contradicted, 0);
});

test('spec deviations: all four were present in accessible discovery; only the R3 one was in a page any session opened', () => {
  const out = run(), disc = (rule: string) => out.specDeviations.find(d => d.rule === rule)!.byPartition.find((p: any) => p.partition === 'discovery')!;
  assert.deepEqual(out.specDeviations.map(d => d.rule), ['R14', 'R3', 'R7', 'R8']);
  assert.deepEqual(Object.keys(disc('R3').openedBySessions), ['C-0662fc']);
  assert.equal(disc('R3').openedBySessions['C-0662fc'].length, 3);
  for (const r of ['R7', 'R8', 'R14']) { assert.ok(disc(r).units >= 1); assert.deepEqual(disc(r).openedBySessions, {}); }
});

test('the own law evaluator and the novelty rule on small synthetic situations', () => {
  const S = (id: string, f: Record<string, any>) => ({ id, kind: 'effect-entry' as const, build: 'b', source: { type: 'case' as const, id, pointer: '' }, fields: { build: 'b', effect: 'Freeze', effectKind: 'freeze', pieceSide: 'AI', effectOwner: 'Human', ownerRelation: 'enemy', arrival: 'move', chainDepth: 1, capped: false, pieceShieldedBefore: false, multiCell: false, fired: true, ...f } });
  const clause = { form: 'law', situation: 'effect-entry', when: { op: 'eq', args: [{ op: 'field', name: 'effect' }, { op: 'const', value: 'Freeze' }] }, expect: [{ field: 'fired', equals: { op: 'const', value: true } }] };
  const d = [S('C-1/s1/e1', {}), S('C-2/s1/e1', { effect: 'Teleport' })];
  const h = [S('C-3/s1/e1', { pieceShieldedBefore: true, fired: false }), S('C-4/s1/e1', { fired: null })];
  const x = lawCounts(clause, h as any);
  assert.deepEqual([x.applicable.length, x.matching.length, x.contradicted.length], [2, 0, 1], 'an unrecorded outcome is neither matching nor contradicting');
  assert.deepEqual(novelInputs(x.contradicted[0] as any, lawCounts(clause, d as any).applicable as any), ['pieceShieldedBefore=true']);
});

/**
 * P8 corrections (D117-D120): output guard, value vs combination novelty, delivery before vs after submission,
 * and preservation of the original P8 output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { safeOutputPath, writeOutput, run as runV1 } from '../gamewatch/gw2/p8-reproduce.ts';
import { runV2, novelty, delivery } from '../gamewatch/gw2/p8-corrections.ts';

const ROOT = join(import.meta.dirname, '..');
const S = (id: string, f: Record<string, any>) => ({ id, kind: 'effect-entry' as const, build: 'b', source: { type: 'case' as const, id, pointer: '' },
  fields: { build: 'b', effect: 'Freeze', effectKind: 'freeze', pieceSide: 'AI', effectOwner: 'Human', ownerRelation: 'enemy', arrival: 'move', chainDepth: 1, capped: false, pieceShieldedBefore: false, multiCell: false, ...f } });

test('D117: the --out path can never overwrite evidence', () => {
  for (const f of ['evidence/gw2/p7-pilot/exp/judgments.ndjson', 'evidence/gw2/p7-pilot/new.json', 'evidence/gamewatch/review/x.json', 'docs/gw2/x.json', 'evidence/gw2/p8/REPRODUCTION.json', 'evidence/gw2/p8/REPRODUCTION-2.json'])
    assert.throws(() => safeOutputPath(join(ROOT, f)), /refusing --out/, f);
  const d = mkdtempSync(join(tmpdir(), 'gw2-p8-out-'));
  try {
    const f = join(d, 'r.json'); writeOutput(f, 'a'); assert.equal(readFileSync(f, 'utf8'), 'a');
    assert.throws(() => writeOutput(f, 'b'), /exists/); assert.equal(readFileSync(f, 'utf8'), 'a');
    assert.equal(safeOutputPath(join(ROOT, 'evidence/gw2/p8/not-yet-there.json')), join(ROOT, 'evidence/gw2/p8/not-yet-there.json'));
    assert.ok(!existsSync(join(ROOT, 'evidence/gw2/p8/not-yet-there.json')));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('D118: novel individual value vs novel combination of observed values', () => {
  const pool = [S('a', {}), S('b', { effect: 'Send home', effectKind: 'send-home', pieceShieldedBefore: true })];
  const x = S('x', { pieceShieldedBefore: true });
  assert.equal(novelty(x, pool.filter(p => p.fields.effect === 'Freeze')).class, 'novel-individual-value');
  const k = novelty(x, pool);
  assert.equal(k.class, 'novel-combination-of-observed-values');
  assert.deepEqual(k.combinations, [['effect="Freeze"', 'pieceShieldedBefore=true'], ['effectKind="freeze"', 'pieceShieldedBefore=true']]);
  assert.equal(novelty(S('y', {}), pool).class, 'observed-combination');
  assert.equal(novelty(S('z', { chainDepth: 4 }), pool).class, 'novel-individual-value');
  assert.deepEqual(novelty(S('n', { pieceShieldedBefore: null }), pool).unknownFields, ['pieceShieldedBefore'], 'unknown values are not compared');
  assert.equal(novelty(x, []).class, 'empty-pool');
});

test('D119: delivered before submission vs only after vs never; HTTP status other than 200 is not a delivery', () => {
  const j = [{ seq: 1, type: 'request', kind: 'evidence', evidenceId: 'C-1', status: 200 }, { seq: 2, type: 'request', kind: 'evidence', evidenceId: 'C-3', status: 404 },
    { seq: 3, type: 'hypothesis', hypIndex: 0 }, { seq: 4, type: 'request', kind: 'evidence', evidenceId: 'C-2', status: 200 }];
  assert.equal(delivery(j, 'C-1', 3), 'delivered-before-submission');
  assert.equal(delivery(j, 'C-2', 3), 'delivered-only-after-submission');
  assert.equal(delivery(j, 'C-3', 3), 'never-delivered');
  assert.equal(delivery(j, 'C-9', 3), 'never-delivered');
});

test('corrected P7 analyses: committed REPRODUCTION-2.json reproduces byte for byte; the original REPRODUCTION.json is untouched', () => {
  const v1 = readFileSync(join(ROOT, 'evidence/gw2/p8/REPRODUCTION.json'), 'utf8');
  assert.equal(JSON.stringify(runV1(), null, 1) + '\n', v1, 'original P8 output still reproduces unchanged');
  assert.equal(createHash('sha256').update(v1).digest('hex'), createHash('sha256').update(JSON.stringify(runV1(), null, 1) + '\n').digest('hex'));
  const out = runV2();
  assert.equal(JSON.stringify(out, null, 1) + '\n', readFileSync(join(ROOT, 'evidence/gw2/p8/REPRODUCTION-2.json'), 'utf8'));
  const get = (ref: string, b: string) => out.counterexamples.find(a => a.hypothesis === ref)!.byBuild.find((x: any) => x.build === b);
  const h1 = get('H-1', 'QX-41');
  assert.deepEqual(h1.discovery.byDelivery, { 'delivered-before-submission': 26, 'never-delivered': 364 });
  assert.deepEqual(h1.heldout.noveltyKindScope, { 'observed-combination': 187 });
  for (const b of ['QX-41', 'QX-73']) {
    const h2 = get('H-2', b);
    assert.equal(Object.keys(h2.heldout.noveltyApplicableScope)[0], 'novel-individual-value');
    assert.equal(Object.keys(h2.heldout.noveltyKindScope)[0], 'novel-combination-of-observed-values');
  }
  const r3 = out.specDeviations.find((d: any) => d.rule === 'R3').byPartition.find((p: any) => p.partition === 'discovery');
  assert.equal(r3.deliveredBeforeFirstSubmission['C-0662fc'].length, 3);
});

/**
 * The published (redacted) copy of the GW2 matched comparison: every file matches its redaction record, the evaluation
 * and pre-registration are byte for byte the files anchored in the external ledger, and the record's per-line hashes
 * cover the ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(import.meta.dirname, '..'), D = join(ROOT, 'evidence/gw2/matched-run');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

test('published matched evidence: files, anchors and ledger lines match the redaction record', () => {
  const rec = JSON.parse(readFileSync(join(D, 'REDACTION_RECORD.json'), 'utf8'));
  assert.deepEqual(rec.remainingForManualReview, []); assert.equal(rec.chainVerifiedOnOriginals, true);
  for (const f of rec.files) {
    assert.ok(existsSync(join(ROOT, f.file)), f.file);
    assert.equal(sha(readFileSync(join(ROOT, f.file))), f.publishedSha256, f.file);
    if (!f.redacted) assert.equal(f.originalSha256, f.publishedSha256, f.file);
  }
  const L = readFileSync(join(D, 'external-record/execution-ledger.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(L.length, rec.ledgerLines.length); assert.deepEqual(L.map(e => e.seq), rec.ledgerLines.map((x: any) => x.seq));
  // each line's prev is the ORIGINAL previous line's sha256 recorded in ledgerLines (the chain survives redaction)
  L.forEach((e, k) => assert.equal(e.prev, k ? rec.ledgerLines[k - 1].originalLineSha256 : null, `line ${k + 1}`));
  const evaluated = L.find(e => e.event === 'evaluated'), pre = L.find(e => e.event === 'preregistered');
  assert.equal(sha(readFileSync(join(D, 'EVALUATION.json'))), evaluated.data.evaluationSha256, 'EVALUATION.json is the anchored evaluation');
  assert.equal(L.filter(e => e.event === 'call-start').length, 20); assert.equal(L.filter(e => e.event === 'gate-opened').length, 1);
  assert.ok(pre, 'pre-registration anchored'); assert.ok(rec.rawSeals.every((s: any) => Object.values(s.matchesOriginal).every(v => v === true)));
  assert.equal(Math.round(rec.metering.reduce((a: number, m: any) => a + m.balanceDeltaUsed, 0) * 1000) / 1000, 786.378);
});

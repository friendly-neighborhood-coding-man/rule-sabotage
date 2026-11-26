/**
 * The published (redacted) P7 pilot evidence: what still verifies byte for byte, and how the redacted files are tied back to
 * the operator's originals. See evidence/gw2/p7-pilot/REDACTION_RECORD.json and docs/gw2/PHASE_7_REPORT.md section 9.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { residual, DEST } from '../scripts/gw2-p7-redact.ts';

const ROOT = join(import.meta.dirname, '..');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const rec = JSON.parse(readFileSync(join(ROOT, DEST, 'REDACTION_RECORD.json'), 'utf8'));
const byFile = new Map<string, any>(rec.files.map((f: any) => [f.file, f]));
const walk = (d: string): string[] => readdirSync(join(ROOT, d)).sort().flatMap(n => statSync(join(ROOT, d, n)).isDirectory() ? walk(`${d}/${n}`) : [`${d}/${n}`]);
const node = (args: string[]) => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('every published file is in the redaction record at its published hash; unredacted files keep the original hash', () => {
  const files = walk(DEST).filter(f => f !== `${DEST}/REDACTION_RECORD.json`);
  assert.deepEqual(files, [...byFile.keys()].sort());
  for (const f of files) {
    const r = byFile.get(f);
    assert.equal(sha(readFileSync(join(ROOT, f))), r.publishedSha256, f);
    if (!r.redacted) assert.equal(r.originalSha256, r.publishedSha256, f);
    else assert.notEqual(r.originalSha256, r.publishedSha256, f);
  }
});

test('no user path, Kane id, account link, email or absolute balance remains', () => {
  for (const f of walk(DEST)) if (!f.endsWith('REDACTION_RECORD.json')) assert.deepEqual(residual(readFileSync(join(ROOT, f), 'utf8')), [], f);
});

test('only raw Kane output, balances and operator paths are redacted; hypotheses, notes, sessions and evaluations are not', () => {
  const redacted = rec.files.filter((f: any) => f.redacted).map((f: any) => f.file);
  for (const f of redacted) assert.match(f, /\/kane-runs\/[0-9a-f]{16}\/(stdout\.ndjson|stderr\.txt|meta\.json)$|\/(INVESTIGATORS\.json|kane-ledger\.ndjson)$|\/skillflow\/(log\.ndjson|state\.json|runs\/00[5-7]-investigate-[123]\/stdout\.txt)$|\/external-record\/console-session-[123]\.log$/, f);
  for (const f of byFile.keys()) if (/\/(sessions|hypotheses|evaluations|imports)\/|judgments\.ndjson$|REPORT|execution-ledger|PREREGISTRATION|RAW_SEAL/.test(f)) assert.equal(byFile.get(f).redacted, false, f);
});

test('raw seals and the graph provenance point at the ORIGINAL bytes recorded in the redaction record', () => {
  const seals = walk(`${DEST}/exp/kane-runs`).filter(f => f.endsWith('/RAW_SEAL.json'));
  assert.equal(seals.length, 3);
  for (const s of seals) {
    const seal = JSON.parse(readFileSync(join(ROOT, s), 'utf8'));
    for (const [name, h] of Object.entries(seal.files)) assert.equal(byFile.get(s.replace('RAW_SEAL.json', name)).originalSha256, h, `${s} ${name}`);
  }
  for (const line of readFileSync(join(ROOT, DEST, 'exp/judgments.ndjson'), 'utf8').trim().split('\n'))
    for (const m of line.matchAll(/"kaneStdout":\{"path":"([^"]+)","sha256":"([0-9a-f]{64})"/g)) assert.equal(byFile.get(m[1]).originalSha256, m[2], m[1]);
});

test('the published external record verifies as a hash chain, unchanged', () => {
  const out = JSON.parse(node(['gamewatch/gw2/p7-exec.ts', 'verify-record', join(DEST, 'external-record')]));
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.events, ['preregistered', 'session-end', 'session-end', 'session-end', 'hypothesis-freeze', 'representation-seal', 'integrity']);
});

test('integrity of the published copy: everything passes except the checks that hash the redacted raw Kane files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gw2-p7-pub-'));
  try {
    cpSync(join(ROOT, DEST, 'exp'), join(tmp, 'exp'), { recursive: true });
    cpSync(join(ROOT, DEST, 'external-record'), join(tmp, 'rec'), { recursive: true }); // integrity appends a checkpoint: never the committed record
    try { node(['gamewatch/gw2/p6-steps.ts', 'integrity', join(tmp, 'int.json'), join(tmp, 'exp'), '--record', join(tmp, 'rec')]); } catch { /* exits non-zero by design */ }
    const checks: { check: string; ok: boolean; detail?: string }[] = JSON.parse(readFileSync(join(tmp, 'int.json'), 'utf8')).checks;
    const failed = checks.filter(c => !c.ok);
    assert.deepEqual(failed.map(c => c.check).sort(), ['hypothesis freeze', 'judgment graph', 'raw seal 1e26529c62afc36e', 'raw seal e95f5bc28e46532c', 'raw seal f6003f7e3d5f8469', 'representation seal']);
    for (const c of failed) for (const part of String(c.detail).split(/;\s*/)) assert.match(part, /(stdout\.ndjson|stderr\.txt|meta\.json) (does not match its recorded sha256|differs from its raw seal)/, `${c.check}: ${part}`);
    assert.equal(checks.filter(c => c.ok).length, 14);
    assert.ok(existsSync(join(tmp, 'rec', 'execution-ledger.ndjson')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

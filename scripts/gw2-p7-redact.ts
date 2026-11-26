/**
 * GW2 P7 pilot evidence redaction (before publishing the three real Kane sessions).
 *
 *   node --experimental-strip-types --no-warnings scripts/gw2-p7-redact.ts --source <unpacked results zip, OUTSIDE the repository>
 *
 * The source is the operator's results pack (gw2-p7-results.zip) unpacked unchanged: PACK.json, repo-pilot/p7-pilot/** and
 * external-record/**. The originals stay outside the repository (operator's machine and the private project thread).
 *
 * Same method and rules as GW1 (scripts/gw1-redact.ts, which extends the KS1 rules of scripts/evidence-redact.ts):
 *   1. every source file is hashed (originalSha256) before anything is changed;
 *   2. the narrow rules are applied to a copy written to evidence/gw2/p7-pilot/ (repo-pilot/p7-pilot/**) and
 *      evidence/gw2/p7-pilot/external-record/ (external-record/**); the source is never written;
 *   3. evidence/gw2/p7-pilot/REDACTION_RECORD.json lists per file the original and published sha256 and the rules applied,
 *      the metering check (balance delta vs Kane's own credits, on the originals), the raw seals as sealed, and a scan for
 *      anything that still looks like an identifier (must be empty).
 * Redaction is deterministic: re-applying GW2_P7_RULES to an original reproduces the published bytes, so anyone holding the
 * originals can check every published file against its originalSha256 and publishedSha256.
 * Credit consumption ("used", Kane's credits), steps, timings, every hypothesis, note and finding are kept unchanged.
 * Refuses if the source is inside the repository, if its PACK.json head is not given, or if the destination already holds a
 * REDACTION_RECORD.json (single use).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { redact, type Rule } from './evidence-redact.ts';
import { GW1_RULES } from './gw1-redact.ts';
import { ROOT } from './v6-fork.ts';

export const GW2_P7_RULES: Rule[] = [...GW1_RULES];
export const DEST = 'evidence/gw2/p7-pilot';
const MAP: [string, string][] = [['repo-pilot/p7-pilot', DEST], ['external-record', `${DEST}/external-record`], ['PACK.json', `${DEST}/external-record/PACK.json`]];

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const list = (base: string, d: string): string[] => {
  const p = join(base, d);
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [d];
  return readdirSync(p).sort().flatMap(n => list(base, `${d}/${n}`));
};
/** Residual scan: anything still shaped like a user path, a Kane id, a share link or a balance. */
export function residual(text: string): { kind: string; sample: string }[] {
  const out: { kind: string; sample: string }[] = [];
  const scan = (kind: string, re: RegExp) => { for (const m of text.matchAll(re)) out.push({ kind, sample: m[0].slice(0, 80) }); };
  scan('uuid', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  scan('user-path', /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)/g);
  scan('operator-path', /[A-Za-z]:(?:\\\\|\\|\/)Rule_Sabotage/g);
  scan('non-loopback-url', /https?:\/\/(?!127\.0\.0\.1[:/])[A-Za-z0-9.-]+/g);
  scan('email-like', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  scan('balance-like', /"(?:before|after|balance|availableCredits)"\s*:\s*-?\d{3,}(?:\.\d+)?/g);
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/gw2-p7-redact.ts')) {
  const i = process.argv.indexOf('--source'), src = i > 0 ? resolve(process.argv[i + 1]) : null;
  if (!src) throw new Error('give --source <unpacked results pack outside the repository>');
  if (src === resolve(ROOT) || src.startsWith(resolve(ROOT) + sep)) throw new Error('the source must be outside the repository');
  if (!existsSync(join(src, 'PACK.json'))) throw new Error('source has no PACK.json');
  if (existsSync(join(ROOT, DEST, 'REDACTION_RECORD.json'))) throw new Error(`${DEST}/REDACTION_RECORD.json exists (single use)`);
  const pack = JSON.parse(readFileSync(join(src, 'PACK.json'), 'utf8'));
  const files = MAP.flatMap(([from]) => list(src, from));
  const originals = new Map(files.map(f => [f, readFileSync(join(src, f))]));
  // metering on the originals, before any redaction: balance delta (boundary) vs Kane's own reported credits
  const metering = list(src, 'repo-pilot/p7-pilot/exp/kane-runs').filter(f => f.endsWith('/meta.json')).map(f => {
    const m = JSON.parse(originals.get(f)!.toString('utf8'));
    return { runId: m.runId, session: m.session, balanceDeltaUsed: m.spend?.used ?? null, kaneCreditsReported: m.kaneCreditsReported ?? null,
      differenceCredits: m.spend && m.kaneCreditsReported != null ? +(m.spend.used - m.kaneCreditsReported).toFixed(4) : null, steps: m.steps, ms: m.ms };
  });
  const seals = list(src, 'repo-pilot/p7-pilot/exp/kane-runs').filter(f => f.endsWith('/RAW_SEAL.json'))
    .map(f => ({ file: f.replace('repo-pilot/p7-pilot', DEST), seal: JSON.parse(originals.get(f)!.toString('utf8')) }));
  rmSync(join(ROOT, DEST), { recursive: true, force: true });
  const record: unknown[] = [], remaining: { file: string; kind: string; sample: string }[] = [];
  for (const f of files) {
    const [from, to] = MAP.find(([a]) => f === a || f.startsWith(a + '/'))!;
    const out = to + f.slice(from.length), buf = originals.get(f)!;
    const { text, applied } = redact(buf.toString('utf8'), GW2_P7_RULES);
    const changed = Object.keys(applied).length > 0, published = changed ? Buffer.from(text, 'utf8') : buf;
    mkdirSync(dirname(join(ROOT, out)), { recursive: true });
    writeFileSync(join(ROOT, out), published);
    for (const r of residual(published.toString('utf8'))) remaining.push({ file: out, ...r });
    record.push({ file: out, source: f, originalSha256: sha(buf), publishedSha256: sha(published), redacted: changed, ...(changed ? { rulesApplied: applied } : {}) });
  }
  writeFileSync(join(ROOT, DEST, 'REDACTION_RECORD.json'), JSON.stringify({
    schema: 'rule-sabotage/evidence-correction-record@1',
    appliedAt: new Date().toISOString(),
    pack: { head: pack.head, packedAt: pack.packedAt, operator: pack.operator },
    status: 'Published copy of the P7 pilot evidence, redacted before commit. The originals stay with the operator (results pack) and are not in the repository. originalSha256 is the hash of the operator\'s file; publishedSha256 is the hash of the committed file. Unredacted files have equal hashes.',
    consequences: [
      'RAW_SEAL.json files are published unchanged: they hold the sha256 of the ORIGINAL raw Kane output (stdout, stderr, args). Redacted raw files therefore no longer match their seal; the seal is checked against originalSha256 here instead (rawSeals[].matchesOriginal).',
      'The external execution ledger (external-record/execution-ledger.ndjson) and PREREGISTRATION.json contain no identifiers and are published byte for byte, so the hash chain and its anchors verify on the published copy (p7-exec.ts verify-record). The console logs lose only the operator\'s absolute folder path.',
      'kane-ledger.ndjson and meta.json lose only absolute balances; "used" (balance delta) and Kane\'s reported credits are kept, so cost accounting is unaffected.',
      'Integrity of the published copy is reproduced by: every unredacted file at its original hash, plus the redacted files mapped to their original hashes in this record. See docs/gw2/PHASE_7_REPORT.md section 9.',
    ],
    rules: GW2_P7_RULES.map(r => ({ id: r.id, reason: r.reason })),
    notRedacted: [
      'Operator first name in approvals and authorizations (as in GW1 approval.json).',
      'Loopback URLs (http://127.0.0.1:<ephemeral port>/index.html) of the local evidence server; ephemeral, no account information.',
      'Credit consumption per session (balance delta and Kane-reported), steps, timings, run ids, GW2 session ids (content hashes, not Kane identifiers).',
    ],
    metering,
    rawSeals: seals.map(s => ({ ...s, matchesOriginal: Object.fromEntries(Object.entries(s.seal.files ?? s.seal.sha256 ?? {}).map(([name, h]) => {
      const src = (s.file.replace(DEST, 'repo-pilot/p7-pilot').replace(/RAW_SEAL\.json$/, '')) + name;
      const o = originals.get(src); return [name, o ? sha(o) === h : 'not in pack'];
    })) })),
    files: record,
    remainingForManualReview: remaining,
  }, null, 1) + '\n');
  console.log(`${files.length} files: ${record.filter((r: any) => r.redacted).length} redacted; ${remaining.length} residual items`);
  if (remaining.length) { console.log(JSON.stringify(remaining, null, 1)); process.exitCode = 1; }
}

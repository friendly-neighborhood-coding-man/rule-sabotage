/**
 * GW2 matched comparison: evidence redaction before publishing the 20 real Kane calls (same method as P7).
 *
 *   node --experimental-strip-types --no-warnings scripts/gw2-matched-redact.ts --source <unpacked gw2-matched-results.zip, OUTSIDE the repository>
 *
 * The source is the operator's results pack unpacked unchanged: PACK.json, run/** and external-record/**. The originals
 * stay outside the repository (operator's machine and the private project thread). Same rules as P7 (GW2_P7_RULES =
 * GW1_RULES) and the same residual scan:
 *   1. every source file is hashed (originalSha256) before anything is changed;
 *   2. the rules are applied to a copy written to evidence/gw2/matched-run/ (run/**) and evidence/gw2/matched-run/
 *      external-record/ (external-record/**, PACK.json); the source is never written;
 *   3. evidence/gw2/matched-run/REDACTION_RECORD.json lists per file the original and published sha256 and the rules
 *      applied, the metering (balance delta vs Kane's own credits, on the originals), the raw seals as sealed and checked
 *      against the originals, and a residual scan (must be empty).
 * Unlike P7, the matched external ledger records absolute balances in its call-start/call-end entries, so it is redacted
 * too. Its hash chain is computed over the ORIGINAL lines; the record therefore lists every original line's sha256
 * (ledgerLines), and the chain is verified here on the originals before publishing (chainVerifiedOnOriginals).
 * Credit consumption ("used", Kane's credits), steps, timings, every submission, freeze and the evaluation are kept.
 * Refuses if the source is inside the repository or the destination already holds a REDACTION_RECORD.json (single use).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from './evidence-redact.ts';
import { GW2_P7_RULES, residual } from './gw2-p7-redact.ts';
import { ROOT } from './v6-fork.ts';

export const DEST = 'evidence/gw2/matched-run';
const MAP: [string, string][] = [['run', DEST], ['external-record', `${DEST}/external-record`], ['PACK.json', `${DEST}/external-record/PACK.json`]];
const BYTE_FOR_BYTE = ['run/EVALUATION.json', 'external-record/PREREGISTRATION.json'];
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const list = (base: string, d: string): string[] => {
  const p = join(base, d);
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [d];
  return readdirSync(p).sort().flatMap(n => list(base, `${d}/${n}`));
};

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/gw2-matched-redact.ts')) {
  const i = process.argv.indexOf('--source'), src = i > 0 ? resolve(process.argv[i + 1]) : null;
  if (!src) throw new Error('give --source <unpacked results pack outside the repository>');
  if (src === resolve(ROOT) || src.startsWith(resolve(ROOT) + sep)) throw new Error('the source must be outside the repository');
  if (!existsSync(join(src, 'PACK.json'))) throw new Error('source has no PACK.json');
  if (existsSync(join(ROOT, DEST, 'REDACTION_RECORD.json'))) throw new Error(`${DEST}/REDACTION_RECORD.json exists (single use)`);
  const pack = JSON.parse(readFileSync(join(src, 'PACK.json'), 'utf8'));
  const files = MAP.flatMap(([from]) => list(src, from));
  const originals = new Map(files.map(f => [f, readFileSync(join(src, f))]));
  const raws = files.filter(f => /^run\/sessions\/M\d\d\/raw-[12]\/meta\.json$/.test(f));
  const metering = raws.map(f => {
    const m = JSON.parse(originals.get(f)!.toString('utf8'));
    return { runId: m.runId, session: m.session, arm: m.arm, phase: m.phase, balanceDeltaUsed: m.spend?.used ?? null, kaneCreditsReported: m.facts?.kaneCreditsReported ?? null,
      differenceCredits: m.spend && m.facts?.kaneCreditsReported != null ? +(m.spend.used - m.facts.kaneCreditsReported).toFixed(4) : null, steps: m.facts?.steps ?? null, kaneDurationS: m.facts?.kaneDurationS ?? null };
  });
  const seals = files.filter(f => /\/raw-[12]\/RAW_SEAL\.json$/.test(f)).map(f => {
    const seal = JSON.parse(originals.get(f)!.toString('utf8')), dir = f.replace(/RAW_SEAL\.json$/, '');
    return { file: DEST + f.slice('run'.length), seal, matchesOriginal: Object.fromEntries(Object.entries(seal.files ?? {}).map(([n, h]) => { const o = originals.get(dir + n); return [n, o ? sha(o) === h : 'not in pack']; })) };
  });
  // the external ledger's hash chain, on the ORIGINAL lines (prev = sha256 of the previous line)
  const ledgerSrc = 'external-record/execution-ledger.ndjson', lines = originals.get(ledgerSrc)!.toString('utf8').split('\n').filter(Boolean);
  const chainProblems = lines.flatMap((l, k) => { const e = JSON.parse(l); return e.seq !== k + 1 || e.prev !== (k ? sha(lines[k - 1]) : null) ? [`line ${k + 1}`] : []; });
  const record: unknown[] = [], remaining: { file: string; kind: string; sample: string }[] = [], countsNotBalances: typeof remaining = [];
  for (const f of files) {
    const [from, to] = MAP.find(([a]) => f === a || f.startsWith(a + '/'))!;
    const out = to + f.slice(from.length), buf = originals.get(f)!;
    // EVALUATION.json and PREREGISTRATION.json hold no identifiers; their "before"/"after" are situation counts, not
    // balances, so they are published byte for byte (their sha256 are anchored in the ledger); the residual scan still runs
    const { text, applied } = BYTE_FOR_BYTE.includes(f) ? { text: '', applied: {} } : redact(buf.toString('utf8'), GW2_P7_RULES);
    const changed = Object.keys(applied).length > 0, published = changed ? Buffer.from(text, 'utf8') : buf;
    mkdirSync(dirname(join(ROOT, out)), { recursive: true });
    writeFileSync(join(ROOT, out), published, { flag: 'wx' });
    for (const r of residual(published.toString('utf8'))) (BYTE_FOR_BYTE.includes(f) && r.kind === 'balance-like' ? countsNotBalances : remaining).push({ file: out, ...r });
    record.push({ file: out, source: f, originalSha256: sha(buf), publishedSha256: sha(published), redacted: changed, ...(changed ? { rulesApplied: applied } : {}) });
  }
  writeFileSync(join(ROOT, DEST, 'REDACTION_RECORD.json'), JSON.stringify({
    schema: 'rule-sabotage/evidence-correction-record@1',
    appliedAt: new Date().toISOString(),
    pack: { candidate: pack.candidate, reviewed: pack.reviewed, packedAt: pack.packedAt, operator: pack.operator, evaluateOnly: pack.evaluateOnly },
    status: 'Published copy of the GW2 matched comparison evidence (20 Kane calls, M01-M10), redacted before commit. The originals stay with the operator (results pack) and are not in the repository. originalSha256 is the hash of the operator\'s file; publishedSha256 is the hash of the committed file. Unredacted files have equal hashes.',
    consequences: [
      'RAW_SEAL.json files are published unchanged: they hold the sha256 of the ORIGINAL raw Kane output. Redacted raw files no longer match their seal; the seal is checked against the originals here instead (rawSeals[].matchesOriginal).',
      'The external execution ledger records absolute balances in call-start and call-end, so it is redacted. Its hash chain covers the ORIGINAL lines: ledgerLines lists every original line\'s sha256, and the chain was verified on the originals (chainVerifiedOnOriginals). PREREGISTRATION.json and EVALUATION.json hold no identifiers and are published byte for byte, so their sha256 equal the anchors in the ledger (preregistered, evaluated).',
      'kane-ledger.ndjson, meta.json and the ledger lose only absolute balances; "used" (balance delta) and Kane\'s reported credits are kept, so cost accounting is unaffected. Console logs and raw output lose local paths and Kane local session/evidence ids.',
    ],
    rules: GW2_P7_RULES.map(r => ({ id: r.id, reason: r.reason })),
    notRedacted: [
      'Operator first name in approvals, authorizations and PACK.json (as in P7 and GW1).',
      'The written operator authorization text in the five treatment authorizations.',
      'Loopback URLs of the local evidence server; ephemeral, no account information.',
      'Credit consumption per call (balance delta and Kane-reported), steps, timings, run ids, GW2 server session ids (content hashes, not Kane identifiers).',
    ],
    metering,
    rawSeals: seals,
    ledgerLines: lines.map((l, k) => ({ seq: k + 1, originalLineSha256: sha(l) })),
    chainVerifiedOnOriginals: chainProblems.length === 0, chainProblems,
    files: record,
    remainingForManualReview: remaining,
    reviewedNotBalances: { note: 'Matched by the balance-like residual pattern in a byte-for-byte file, but these are counts of held-out situations (targets.situations.before/after), not balances.', items: countsNotBalances },
  }, null, 1) + '\n', { flag: 'wx' });
  console.log(`${files.length} files: ${record.filter((r: any) => r.redacted).length} redacted; ${remaining.length} residual items; chain on originals ${chainProblems.length ? 'FAILS' : 'OK'}`);
  if (remaining.length || chainProblems.length) { console.log(JSON.stringify({ remaining: remaining.slice(0, 40), chainProblems }, null, 1)); process.exitCode = 1; }
}

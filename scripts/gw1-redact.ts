/**
 * GW1 evidence redaction (operator, before publishing the GameWatch Kane run and repair evidence).
 *
 *   node --experimental-strip-types --no-warnings scripts/gw1-redact.ts --private <directory OUTSIDE the repository>
 *
 * Same method as the KS1 redaction (scripts/evidence-redact.ts, operator-accepted with PR #20):
 *   1. copies every original byte for byte to the private directory and writes ORIGINALS_SHA256.json there;
 *   2. redacts IN PLACE, applying only the narrow rules below (the KS1 rules plus absolute balances in any amount);
 *   3. writes evidence/gamewatch/review/REDACTION_RECORD.json: per file the original and published sha256 and the rules
 *      applied, the metering check (balance delta vs Kane's own credits_consumed, measured on the originals before any
 *      redaction), and a scan of what still looks like an email address or a balance (should be empty).
 * Credit consumption ("used", credits_consumed), estimates, timings and every finding are kept unchanged.
 * Refuses if the private directory is inside the repository or already holds originals (single use).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { RULES, redact, type Rule } from './evidence-redact.ts';
import { ROOT } from './v6-fork.ts';

export const DIRS = ['evidence/gamewatch/review', 'evidence/gamewatch/repair', 'evidence/gamewatch/qa'];
export const FILES = ['evidence/gamewatch/repair-console.log'];
const SKIP = /(^|\/)(PLAN\.json|REDACTION_RECORD(-\d+)?\.json)$|^evidence\/gamewatch\/repair\/(baseline-files|output)\//;

export const GW1_RULES: Rule[] = [
  ...RULES,
  { id: 'absolute-credit-balance', pattern: /("(?:before|after|availableCredits|parsed|balance|credits)"\s*:\s*)-?\d+(?:\.\d+)?/g, replace: '$1"<redacted:balance>"', reason: 'Absolute account balance (JSON field). Consumption ("used", credits_consumed) is kept.' },
  { id: 'absolute-credit-balance-text', pattern: /(Available credits:\s*)-?\d+(?:\.\d+)?/gi, replace: '$1<redacted:balance>', reason: 'Absolute account balance inside captured CLI text.' },
  { id: 'absolute-credit-balance-console', pattern: /(before\s+)-?\d+(?:\.\d+)?(\s+after\s+)-?\d+(?:\.\d+)?/g, replace: '$1<redacted:balance>$2<redacted:balance>', reason: 'Absolute balances in the manual script\'s console summary; the USED figure on the same line is kept.' },
  { id: 'email-address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: '<redacted:email>', reason: 'Account email address; not needed to interpret the result.' },
  { id: 'user-profile-path', pattern: /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\\/"\s]+/g, replace: '<user-home>', reason: 'Local user profile path (contains the account user name).' },
  { id: 'kane-local-session-id', pattern: /((?:sessions|evidence)(?:\\\\|\\|\/))[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, replace: '$1<redacted:kane-local-id>', reason: 'Kane local session / evidence-pack identifiers; not needed to interpret the result.' },
  { id: 'kane-test-manager-url', pattern: /https:\/\/test-manager\.lambdatest\.com\/projects\/[A-Za-z0-9]+\/test-cases\/[A-Za-z0-9]+/g, replace: '<redacted:kane-test-manager-url>', reason: 'Account-side project and test-case identifiers of the Kane service.' },
  { id: 'gw-repo-absolute-path', pattern: /[A-Za-z]:(?:\\\\|\\|\/)Rule_Sabotage(?:\\\\|\\|\/)/g, replace: '<operator>/', reason: 'Absolute local path of the operator\'s folders (repository, blind workspace).' },
];

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const list = (d: string): string[] => !existsSync(join(ROOT, d)) ? [] : readdirSync(join(ROOT, d)).flatMap(n => { const rel = `${d}/${n}`; return statSync(join(ROOT, rel)).isDirectory() ? list(rel) : [rel]; });

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/gw1-redact.ts')) {
  const i = process.argv.indexOf('--private'), priv = i > 0 ? resolve(process.argv[i + 1]) : null;
  if (!priv) throw new Error('give --private <directory outside the repository>');
  if (priv === resolve(ROOT) || priv.startsWith(resolve(ROOT) + sep)) throw new Error('the private directory must be outside the repository');
  if (existsSync(join(priv, 'ORIGINALS_SHA256.json'))) throw new Error('the private directory already holds originals (single use)');
  const files = [...DIRS.flatMap(list), ...FILES.filter(f => existsSync(join(ROOT, f)))].filter(f => !SKIP.test(f) && !/\.(png|jpg|webm|tar)$/i.test(f));
  // metering consistency on the originals, before anything is redacted
  const ledgerF = join(ROOT, 'evidence/gamewatch/review/ledger.ndjson'), stdoutF = join(ROOT, 'evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson');
  let metering: unknown = 'not checked (ledger or Kane output missing)';
  if (existsSync(ledgerF) && existsSync(stdoutF)) {
    const end = readFileSync(ledgerF, 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l)).find((e: { event: string }) => e.event === 'call-end');
    const runEnd = readFileSync(stdoutF, 'utf8').split(/\r?\n/).filter(l => l.includes('"type":"run_end"')).map(l => JSON.parse(l))[0];
    const consumed = runEnd?.credits_consumed ?? null;
    metering = { balanceDeltaUsed: end?.detail?.used ?? null, kaneRunEndCreditsConsumed: consumed, consistent: end && consumed !== null ? Math.abs(end.detail.used - consumed) < 0.01 : null, checkedOn: 'originals, before redaction' };
  }
  mkdirSync(priv, { recursive: true });
  const manifest: Record<string, string> = {}, record: unknown[] = [];
  for (const f of files) {
    const buf = readFileSync(join(ROOT, f)); manifest[f] = sha(buf);
    const t = join(priv, f); mkdirSync(dirname(t), { recursive: true }); copyFileSync(join(ROOT, f), t);
    if (sha(readFileSync(t)) !== manifest[f]) throw new Error(`private copy of ${f} does not match`);
  }
  writeFileSync(join(priv, 'ORIGINALS_SHA256.json'), JSON.stringify({ copiedAt: new Date().toISOString(), files: manifest }, null, 1) + '\n');
  const remaining: { file: string; kind: string; sample: string }[] = [];
  for (const f of files) {
    const { text, applied } = redact(readFileSync(join(ROOT, f), 'utf8'), GW1_RULES);
    const changed = Object.keys(applied).length > 0;
    if (changed) writeFileSync(join(ROOT, f), text);
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) remaining.push({ file: f, kind: 'email-like', sample: m[0] });
    for (const m of text.matchAll(/(?<![A-Za-z])(?:balance|credits?)"?\s*[:=]\s*"?\d{3,}(?:\.\d+)?/gi)) remaining.push({ file: f, kind: 'balance-like', sample: m[0] });
    record.push({ file: f, originalSha256: manifest[f], publishedSha256: changed ? sha(text) : manifest[f], redacted: changed, ...(changed ? { rulesApplied: applied } : {}) });
  }
  const ri = process.argv.indexOf('--record'), recordName = ri > 0 ? process.argv[ri + 1] : 'REDACTION_RECORD.json';
  writeFileSync(join(ROOT, 'evidence/gamewatch/review', recordName), JSON.stringify({
    schema: 'rule-sabotage/evidence-correction-record@1', appliedAt: new Date().toISOString(),
    status: 'Redacted in place before publishing; originals kept privately with their sha256 (ORIGINALS_SHA256.json, not in the repository).',
    rules: GW1_RULES.map(r => ({ id: r.id, reason: r.reason })), metering, files: record, remainingForManualReview: remaining,
  }, null, 1) + '\n');
  console.log(`${files.length} files: ${record.filter((r: any) => r.redacted).length} redacted; originals in ${priv}; ${remaining.length} items left for manual review`);
  if (remaining.length) console.log(JSON.stringify(remaining, null, 1));
}

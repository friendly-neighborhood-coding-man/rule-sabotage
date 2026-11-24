/**
 * Public evidence audit and PROPOSED minimal redaction for the published Kane KS1 evidence (evidence/v6/kane-preflight/).
 *
 * The repository is public. This script NEVER modifies, deletes or rewrites the originals (in the working tree or in Git
 * history). It:
 *   1. copies every original byte-for-byte to a PRIVATE directory outside the repository (argument --private <dir>) and
 *      writes a SHA-256 manifest there;
 *   2. writes PROPOSED redacted copies to evidence/v6/kane-preflight-public-proposed/ (same relative paths), applying only
 *      the rules below, each a narrow pattern with a stated reason;
 *   3. writes a correction record (evidence/v6/kane-preflight-public-proposed/CORRECTION_RECORD.json) listing, per file,
 *      the original and redacted SHA-256, every rule applied and how many times, and the provenance (commit 240b2bb).
 * Replacing the published files with the proposed ones, or removing the originals from Git history (force-push), needs
 * an explicit operator decision. Run: npm run evidence:redact-ks1 -- --private <directory outside the repository>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from './v6-fork.ts';

export const SRC = 'evidence/v6/kane-preflight';
export const OUT = 'evidence/v6/kane-preflight-public-proposed';
export const PROVENANCE_COMMIT = '240b2bb4677af8c18ee1363c1e1c1e8902e80ee8';

export type Rule = { id: string; pattern: RegExp; replace: string; reason: string };
/** Narrow, ordered rules. Each replaces only the matched value; structure and every number used in the analysis stay. */
export const RULES: Rule[] = [
  { id: 'kane-session-id', pattern: /("session_id"\s*:\s*")[0-9a-f-]{8,}(")/g, replace: '$1<redacted:kane-recording-session-id>$2', reason: 'Kane account-side recording session identifier; not needed to interpret the result.' },
  { id: 'process-id', pattern: /("pid"\s*:\s*)\d+/g, replace: '$1"<redacted:pid>"', reason: 'Local operating-system process id; no analytical value.' },
  { id: 'repo-absolute-path', pattern: /[A-Za-z]:(?:\\\\|\\|\/)Rule_Sabotage(?:\\\\|\\|\/)rule-sabotage-live(?:\\\\|\\|\/)/g, replace: '<repo>/', reason: 'Absolute local path of the checkout; replaced by a repository-relative marker.' },
  { id: 'temp-profile-path', pattern: /[A-Za-z]:(?:\\\\|\\|\/)Temp(?:\\\\|\\|\/)rs-kane-ks1-[A-Za-z0-9]+/g, replace: '<local-temp>/rs-kane-ks1-<id>', reason: 'Absolute local temporary path.' },
  { id: 'tool-install-path', pattern: /[A-Za-z]:(?:\\\\|\\|\/)Tools(?:\\\\|\\|\/)npm-global(?:\\\\|\\|\/)/g, replace: '<npm-global>/', reason: 'Absolute local tool installation path.' },
  { id: 'browser-install-path', pattern: /C:(?:\\\\|\\|\/)Program Files(?:\\\\|\\|\/)Google(?:\\\\|\\|\/)Chrome(?:\\\\|\\|\/)Application(?:\\\\|\\|\/)chrome\.exe/g, replace: '<chrome>', reason: 'Absolute local browser path.' },
  { id: 'internal-message-id', pattern: /,?\s*project thread message cmsg_[A-Za-z0-9]+/g, replace: ' (operator authorization in the private project thread)', reason: 'Internal project/thread identifier; the authorization itself and its time stay.' },
  { id: 'account-login-metadata', pattern: /"login"\s*:\s*\{[^}]*\}/g, replace: '"login": { "authenticated": true }', reason: 'Unneeded account metadata (environment, auth method, token status); only "authenticated" matters for the experiment.' },
];
/**
 * NOT redacted, with reasons (recorded in the correction record): the credit balances before/after (the result is their
 * difference; operator may decide to publish only the delta, see PROPOSED_OPTIONAL), the loopback CDP port (ephemeral,
 * 127.0.0.1 only), Kane's run_id "run-0" (a per-process counter), the operator's first name as approver (already the
 * public PR attribution), timestamps (needed for the audit trail).
 */
export const PROPOSED_OPTIONAL: Rule[] = [
  { id: 'absolute-credit-balance', pattern: /("?(?:before|after|availableCredits|parsed)"?\s*:\s*)(1\d{4}\.\d+)/g, replace: '$1"<redacted:balance>"', reason: 'Absolute account balance (JSON field). The credit consumption ("used") and Kane\'s own credits_consumed are kept.' },
  { id: 'absolute-credit-balance-text', pattern: /(Available credits:\s*)1\d{4}\.\d+/g, replace: '$1<redacted:balance>', reason: 'Absolute account balance inside captured CLI text.' },
];
/** Operator verdict 2026-11-24 (PR #20 accepted): all rules INCLUDING the balance rules are applied to the published files. */
export const APPLIED_RULES: Rule[] = [...RULES, ...PROPOSED_OPTIONAL];

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export function redact(text: string, rules = RULES): { text: string; applied: Record<string, number> } {
  const applied: Record<string, number> = {};
  let t = text;
  for (const r of rules) { const n = (t.match(r.pattern) ?? []).length; if (n) { applied[r.id] = n; t = t.replace(r.pattern, r.replace); } }
  return { text: t, applied };
}

if (process.argv[1]?.endsWith('evidence-redact.ts') && process.argv.includes('--apply')) {
  // APPLY (operator-approved): verify the private originals first, then redact the published files IN PLACE as a normal,
  // visible commit. Git history is not rewritten; the originals stay private with their hashes.
  const i = process.argv.indexOf('--private'), priv = i > 0 ? process.argv[i + 1] : null;
  if (!priv) throw new Error('give --private <directory with the private originals and ORIGINALS_SHA256.json>');
  const privManifest = JSON.parse(readFileSync(join(priv, 'ORIGINALS_SHA256.json'), 'utf8')) as { files: Record<string, string> };
  const files = execFileSync('git', ['ls-files', SRC], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean).filter(f => !f.endsWith('CORRECTION_RECORD.json'));
  // metering consistency, measured on the private originals before anything is redacted
  const ledger = readFileSync(join(priv, 'ledger.ndjson'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).find((e: { event: string }) => e.event === 'call-end');
  const runEnd = readFileSync(join(priv, 'run/KS1-v6.1-oa-v3-96001-t8/stdout.ndjson'), 'utf8').split(/\r?\n/).filter(l => l.includes('"type":"run_end"')).map(l => JSON.parse(l))[0];
  const diff = Math.abs(ledger.detail.used - runEnd.credits_consumed);
  const metering = { balanceDeltaUsed: ledger.detail.used, kaneRunEndCreditsConsumed: Math.round(runEnd.credits_consumed * 10000) / 10000, absoluteDifference: Math.round(diff * 10000) / 10000, consistent: diff < 0.01, checkedOn: 'private originals, before redaction' };
  const record: unknown[] = [];
  for (const f of files) {
    const rel = f.slice(SRC.length + 1), cur = readFileSync(join(ROOT, f));
    if (privManifest.files[rel] !== sha(cur)) throw new Error(`${f} differs from its private original (hash mismatch); refusing to redact`);
    const { text, applied } = redact(cur.toString('utf8'), APPLIED_RULES);
    const changed = Object.keys(applied).length > 0;
    if (changed) writeFileSync(join(ROOT, f), text);
    record.push({ file: f, originalSha256: privManifest.files[rel], publishedSha256: changed ? sha(text) : privManifest.files[rel], redacted: changed, ...(changed ? { rulesApplied: applied } : {}) });
  }
  writeFileSync(join(ROOT, SRC, 'CORRECTION_RECORD.json'), JSON.stringify({
    schema: 'rule-sabotage/evidence-correction-record@1', status: 'APPLIED (operator verdict 2026-11-24, PR #20 accepted): published files replaced by minimally redacted versions in a normal commit; Git history NOT rewritten',
    provenanceCommit: PROVENANCE_COMMIT, appliedAt: new Date().toISOString(),
    originalsPrivateCopy: 'kept by the operator outside the repository with ORIGINALS_SHA256.json; every originalSha256 below was verified against it before redaction',
    rules: APPLIED_RULES.map(r => ({ id: r.id, reason: r.reason })),
    kept: ['credit consumption: ledger "used" 9.097 and Kane run_end credits_consumed', 'loopback CDP port (127.0.0.1, ephemeral)', 'Kane run_id "run-0"', 'operator first name as approver (public PR attribution)', 'timestamps'],
    metering,
    historyNote: 'The unredacted originals remain reachable in Git history (commit 240b2bb and earlier). Removing them would need a history rewrite and force-push; not done (operator: do not rewrite history).',
    files: record,
  }, null, 1) + '\n');
  console.log(`applied: ${(record as { redacted: boolean }[]).filter(r => r.redacted).length} files redacted in place; metering consistent: ${metering.consistent}`);
} else if (process.argv[1]?.endsWith('evidence-redact.ts')) {
  const i = process.argv.indexOf('--private');
  const priv = i > 0 ? process.argv[i + 1] : null;
  if (!priv) throw new Error('give --private <directory outside the repository>');
  if (priv.toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error('the private copy must be outside the repository');
  const files = execFileSync('git', ['ls-files', SRC], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const privManifest: Record<string, string> = {}, record: unknown[] = [];
  for (const f of files) {
    const rel = f.slice(SRC.length + 1), orig = readFileSync(join(ROOT, f));
    const dst = join(priv, rel); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(join(ROOT, f), dst);
    privManifest[rel] = sha(orig);
    const binaryLike = /\.html$/.test(rel) && rel.includes('pages/');
    const { text, applied } = redact(orig.toString('utf8'));
    const changed = Object.keys(applied).length > 0;
    if (changed) { const o = join(ROOT, OUT, rel); mkdirSync(dirname(o), { recursive: true }); writeFileSync(o, text); }
    record.push({ file: `${SRC}/${rel}`, originalSha256: sha(orig), redacted: changed, ...(changed ? { proposedFile: `${OUT}/${rel}`, proposedSha256: sha(text), rulesApplied: applied } : { note: binaryLike ? 'trial page copy: no sensitive content found' : 'no sensitive content found' }) });
  }
  writeFileSync(join(priv, 'ORIGINALS_SHA256.json'), JSON.stringify({ source: SRC, provenanceCommit: PROVENANCE_COMMIT, copiedAt: new Date().toISOString(), files: privManifest }, null, 1) + '\n');
  mkdirSync(join(ROOT, OUT), { recursive: true });
  writeFileSync(join(ROOT, OUT, 'CORRECTION_RECORD.json'), JSON.stringify({
    schema: 'rule-sabotage/evidence-correction-record@1', status: 'PROPOSED, not applied: originals unchanged in the working tree and in Git history',
    provenanceCommit: PROVENANCE_COMMIT, createdAt: new Date().toISOString(),
    originalsPrivateCopy: 'kept by the operator outside the repository, with ORIGINALS_SHA256.json (the hashes below match it)',
    rules: RULES.map(r => ({ id: r.id, reason: r.reason })),
    optionalRuleNotApplied: PROPOSED_OPTIONAL.map(r => ({ id: r.id, reason: r.reason })),
    notRedacted: ['credit balances (optional rule above, operator choice)', 'loopback CDP port (127.0.0.1, ephemeral)', 'Kane run_id "run-0" (per-process counter)', 'operator first name as approver (already public PR attribution)', 'timestamps (audit trail)'],
    historyNote: 'The originals were published at the provenance commit and stay in Git history. Removing them from history needs a rewrite and force-push, which requires an explicit operator decision.',
    files: record,
  }, null, 1) + '\n');
  console.log(`private originals: ${Object.keys(privManifest).length} files -> ${priv}`);
  console.log(`proposed redactions: ${(record as { redacted: boolean }[]).filter(r => r.redacted).length} files -> ${OUT}`);
}
void existsSync;

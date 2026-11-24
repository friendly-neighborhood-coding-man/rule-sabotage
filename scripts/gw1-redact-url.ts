/**
 * GW1 redaction pass 3 (video-production housekeeping, 2026-11-25).
 *
 *   node --experimental-strip-types --no-warnings scripts/gw1-redact-url.ts
 *
 * Pass 2 replaced only the project/test-case prefix of Kane's `test_url`; the share path and its share identifier
 * stayed published. This pass replaces the WHOLE `test_url` value in the GW1 Kane output with one marker, and writes
 * evidence/gamewatch/review/REDACTION_RECORD-3.json (LF-normalised sha256 before and after). Nothing else changes.
 * The pre-pass-3 file is the one already published at commit c17bc50, so no new private copy is needed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './v6-fork.ts';

const FILE = 'evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson';
export const TEST_URL_RULE = { id: 'kane-test-url-whole-value', pattern: /("test_url"\s*:\s*)"[^"]*"/g, replace: '$1"<redacted:kane-test-url>"', reason: 'Whole Kane test URL value, including the share path and share identifier.' };
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const before = lf(readFileSync(join(ROOT, FILE), 'utf8'));
let n = 0;
const after = before.replace(TEST_URL_RULE.pattern, (_m, p1) => { n++; return `${p1}"<redacted:kane-test-url>"`; });
if (n === 0) throw new Error('no test_url found (already redacted?)');
if (/dashboard\/share|lambdatest\.com/.test(after)) throw new Error('a Kane URL fragment remains');
writeFileSync(join(ROOT, FILE), after);
writeFileSync(join(ROOT, 'evidence/gamewatch/review/REDACTION_RECORD-3.json'), JSON.stringify({
  schema: 'rule-sabotage/evidence-correction-record@1',
  appliedAt: new Date().toISOString(),
  status: 'Redacted in place. Pass 2 left the share path and share identifier of the Kane test URL published; this pass replaces the whole value. The previous published version is in git history at c17bc50.',
  rules: [{ id: TEST_URL_RULE.id, reason: TEST_URL_RULE.reason }],
  files: [{ file: FILE, beforeSha256Lf: sha(before), publishedSha256Lf: sha(after), redacted: true, rulesApplied: { [TEST_URL_RULE.id]: n } }],
  notRedactedHere: 'Kane test URLs in older V2/V3 evidence (evidence/balance/v2-runs/.../kane-stdout.ndjson, evidence/balance/v3/kane/.../kane-stdout.ndjson) are hash-locked by their journals, manifests and the frozen GW1 repair baseline; left for an operator decision.',
}, null, 1) + '\n');
console.log(`${FILE}: ${n} test_url value(s) redacted; ${sha(before)} -> ${sha(after)}`);

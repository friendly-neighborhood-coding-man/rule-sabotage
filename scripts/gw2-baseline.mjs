#!/usr/bin/env node
// GW2 Phase 0: record and verify the frozen GW1 baseline. Read-only with respect to GW1 artifacts.
// No dependencies, no network, no model calls, no Kane.
//
//   node scripts/gw2-baseline.mjs verify                 check the working tree against docs/gw2/BASELINE_MANIFEST.json
//   node scripts/gw2-baseline.mjs write  <commit>         (re)generate the manifest's file list from <commit> (Phase 0 only)
//
// For every protected file (both tiers) the manifest stores three digests:
//   gitBlob      the git object id at the baseline commit (what `git ls-tree` shows)
//   sha256       SHA-256 of the committed bytes
//   sha256LF     SHA-256 with CRLF -> LF, the convention of the existing GW1 freeze records (FREEZE.json, VENDOR.json),
//                so a Windows checkout with autocrlf verifies the same
// verify fails (exit 1) on any change, removal or addition under a FROZEN path and lists reference-tier differences.
// Exit 0 ok, 1 frozen mismatch, 2 usage error.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs/gw2/BASELINE_MANIFEST.json');
// Two tiers, kept in sync with docs/gw2/COMMON_SPEC.md §1:
//   FROZEN    GW1 evidence, frozen ground truth, the vendored runner, the playable V6 game and the GW1 reports.
//             Any change, removal or addition under these paths fails verify.
//   REFERENCE the GW1 GameWatch implementation as submitted. GW2 phases may extend it; verify lists every
//             difference so each one is deliberate and visible in review, but does not fail on it.
export const FROZEN = [
  /^evidence\/gamewatch\//, /^evidence\/corrections\//, /^evidence\/v6\/gameplay-freeze\.json$/,
  /^gamewatch\/private\//, /^gamewatch\/vendor\//, /^server\/v6\//,
  /^docs\/(GW1_FINAL_REPORT|SUBMISSION)\.md$/,
];
export const REFERENCE = [/^gamewatch\//, /^docs\/(GAMEWATCH|DEMO)\.md$/, /^README\.md$/];
const tierOf = p => (FROZEN.some(r => r.test(p)) ? 'frozen' : REFERENCE.some(r => r.test(p)) ? 'reference' : null);
const sha = b => createHash('sha256').update(b).digest('hex');
const lf = b => (b.includes(0) ? b : Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'buffer', maxBuffer: 1 << 28 });

const [mode, commit] = process.argv.slice(2);
if (mode === 'write') {
  if (!commit) { console.error('usage: gw2-baseline.mjs write <commit>'); process.exit(2); }
  const full = git('rev-parse', commit).toString().trim();
  const lines = git('ls-tree', '-r', full).toString().trim().split('\n');
  const files = {};
  for (const l of lines) {
    const [meta, path] = l.split('\t');
    const tier = tierOf(path);
    if (!tier) continue;
    const blob = meta.split(' ')[2];
    const bytes = git('cat-file', 'blob', blob);
    files[path] = { tier, gitBlob: blob, bytes: bytes.length, sha256: sha(bytes), sha256LF: sha(lf(bytes)) };
  }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const count = t => Object.values(files).filter(f => f.tier === t).length;
  m.protectedFiles = { commit: full, frozen: count('frozen'), reference: count('reference'), frozenScope: FROZEN.map(String), referenceScope: REFERENCE.map(String), files };
  writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + '\n');
  console.log(`wrote ${count('frozen')} frozen + ${count('reference')} reference files from ${full}`);
} else if (mode === 'verify') {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const bad = [], diff = [];
  const out = (p, why) => (tierOf(p) === 'frozen' ? bad : diff).push(`${why} ${p}`);
  for (const [p, h] of Object.entries(m.protectedFiles.files)) {
    const f = join(ROOT, p);
    if (!existsSync(f)) { out(p, 'missing'); continue; }
    if (sha(lf(readFileSync(f))) !== h.sha256LF) out(p, 'changed');
  }
  // Files on disk under a protected path that were not in the baseline (tracked or untracked, ignored files excluded).
  const present = git('ls-files', '--cached', '--others', '--exclude-standard').toString().trim().split('\n');
  for (const p of present) if (tierOf(p) && !m.protectedFiles.files[p] && existsSync(join(ROOT, p))) out(p, 'added');
  const n = Object.keys(m.protectedFiles.files).length, c = m.protectedFiles.commit.slice(0, 12);
  if (diff.length) console.log(`reference-tier differences from ${c} (allowed, must be deliberate):\n  ${diff.join('\n  ')}`);
  console.log(bad.length ? `GW1 FROZEN ARTIFACTS CHANGED (${bad.length}):\n  ${bad.join('\n  ')}`
    : `GW1 frozen artifacts OK: ${m.protectedFiles.frozen} frozen files match ${c}; ${diff.length} reference-tier differences (of ${n - m.protectedFiles.frozen})`);
  process.exit(bad.length ? 1 : 0);
} else { console.error('usage: gw2-baseline.mjs verify | write <commit>'); process.exit(2); }

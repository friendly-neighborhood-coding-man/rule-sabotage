/**
 * Workspace snapshots for the closed-loop repair: LF-normalised sha256 of every file, so a Windows checkout hashes the
 * same as a Linux one. Skips node_modules, .git and the evidence the playtest tools regenerate (evidence/gamewatch/raw,
 * evidence/gamewatch/site); the regenerated bundle evidence/gamewatch/evidence.json IS kept (it is the agent's own
 * before/after evidence).
 *   node gamewatch/skillbook/steps/repair-freeze.ts verify      check evidence/gamewatch/repair/output against FREEZE.json
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const SKIP = /^(node_modules|\.git|evidence\/gamewatch\/raw[^/]*|evidence\/gamewatch\/site|server\/v6-build-[^/]+)(\/|$)/;

export function hashFile(f: string): string {
  const b = readFileSync(f);
  // text files are LF-normalised (git autocrlf on Windows); binary files hashed as they are
  const text = b.includes(0) ? b : Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(text).digest('hex');
}

export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), rel = relative(root, p).split(sep).join('/');
      if (SKIP.test(rel)) continue;
      const s = statSync(p);
      if (s.isDirectory()) walk(p); else if (s.isFile()) out[rel] = hashFile(p);
    }
  };
  walk(root);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function diffSnapshots(a: Record<string, string>, b: Record<string, string>) {
  return {
    changed: Object.keys(b).filter(f => f in a && a[f] !== b[f]),
    added: Object.keys(b).filter(f => !(f in a)),
    removed: Object.keys(a).filter(f => !(f in b)),
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('steps/repair-freeze.ts') && process.argv[2] === 'verify') {
  const ROOT = join(import.meta.dirname, '../../..');
  const REP = join(ROOT, 'evidence/gamewatch/repair');
  const fr = JSON.parse(readFileSync(join(REP, 'FREEZE.json'), 'utf8'));
  const bad = Object.entries(fr.files as Record<string, { after: string }>).filter(([f, h]) => !existsSync(join(REP, 'output', f)) || hashFile(join(REP, 'output', f)) !== h.after).map(([f]) => f);
  console.log(JSON.stringify({ frozenAt: fr.frozenAt, files: Object.keys(fr.files).length, ok: !bad.length, mismatched: bad }, null, 1));
  process.exit(bad.length ? 1 : 0);
}

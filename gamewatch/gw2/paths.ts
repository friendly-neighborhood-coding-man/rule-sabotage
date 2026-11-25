/**
 * GW2 output-path guard. Every file a GW2 tool writes goes through assertWritableOutput():
 *  - a path inside the repository must be under evidence/gw2/ and must not match any FROZEN pattern recorded in
 *    docs/gw2/BASELINE_MANIFEST.json (the manifest is the single source of the frozen scope; it is read, never written);
 *  - a path outside the repository is accepted only because the caller passed it explicitly (a designated temporary
 *    workspace, e.g. a test's mkdtemp directory).
 * Reading frozen files (for example serving the GW1 site, or reading GW1 notes for a replay) is allowed.
 */
import { readFileSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MANIFEST = resolve(ROOT, 'docs/gw2/BASELINE_MANIFEST.json');

/** The frozen path patterns, parsed back from the manifest's "/regex/" strings. */
export function frozenPatterns(manifestFile = MANIFEST): RegExp[] {
  const m = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const scope: string[] = m.protectedFiles?.frozenScope;
  if (!Array.isArray(scope) || !scope.length) throw new Error('baseline manifest has no frozenScope');
  return scope.map(s => { const x = /^\/(.*)\/([a-z]*)$/.exec(s); if (!x) throw new Error(`bad frozen pattern ${s}`); return new RegExp(x[1], x[2]); });
}

/** Repository-relative POSIX path, or null when p is outside the repository. */
export function repoRelative(p: string): string | null {
  const r = relative(ROOT, resolve(p));
  if (r === '' ) return '';
  if (r.startsWith('..') || isAbsolute(r)) return null;
  return r.split(sep).join('/');
}

export class FrozenPathError extends Error {}

/** Throws FrozenPathError unless p may be written by a GW2 tool. Returns the resolved absolute path. */
export function assertWritableOutput(p: string, patterns = frozenPatterns()): string {
  const abs = resolve(p), rel = repoRelative(abs);
  if (rel === null) return abs; // explicit temporary workspace outside the repository
  const probe = rel.endsWith('/') ? rel : rel + '/';
  if (patterns.some(r => r.test(rel) || r.test(probe))) throw new FrozenPathError(`refusing to write into a frozen GW1 path: ${rel}`);
  if (rel !== 'evidence/gw2' && !rel.startsWith('evidence/gw2/')) throw new FrozenPathError(`GW2 output inside the repository must be under evidence/gw2/: ${rel || '.'}`);
  return abs;
}

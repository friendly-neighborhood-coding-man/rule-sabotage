#!/usr/bin/env node
// GW2 P1: read-only FILESYSTEM inventory of the frozen GW1 paths. Supplements scripts/gw2-baseline.mjs, whose
// "added" check uses `git ls-files --exclude-standard` and so cannot see git-ignored files. This walks the disk.
// It reads docs/gw2/BASELINE_MANIFEST.json (frozen scope and file list) and never writes anything.
//
//   node scripts/gw2-frozen-inventory.mjs [--root <dir>]
//
// Reports every regular file under a frozen path that is not in the manifest, marked "ignored" when git ignores it
// (for example evidence/gamewatch/raw/ written by GW1's evidence collector). Exit 0 none, 1 additions found.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const i = process.argv.indexOf('--root');
const ROOT = i > 0 ? process.argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(join(ROOT, 'docs/gw2/BASELINE_MANIFEST.json'), 'utf8')).protectedFiles;
const frozen = m.frozenScope.map(s => { const x = /^\/(.*)\/([a-z]*)$/.exec(s); return new RegExp(x[1], x[2]); });
const known = new Set(Object.entries(m.files).filter(([, f]) => f.tier === 'frozen').map(([p]) => p));
// Directories to walk: the fixed prefix of each frozen pattern (e.g. "evidence/gamewatch/", "server/v6/").
const roots = [...new Set(m.frozenScope.map(s => s.replace(/^\/\^/, '').replace(/\/[a-z]*$/, '').replace(/\\\//g, '/').replace(/\\\./g, '.').replace(/\(.*$|\$$/, '').replace(/[^/]*$/, '')))];
const found = [];
const walk = rel => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs)) {
    const r = rel ? `${rel}${e}` : e, st = lstatSync(join(ROOT, r));
    if (st.isDirectory()) walk(r + '/');
    else if (frozen.some(re => re.test(r))) found.push(r);
  }
};
for (const r of roots) walk(r);
const extra = found.filter(p => !known.has(p)).sort();
const missing = [...known].filter(p => !existsSync(join(ROOT, p)));
const ignored = new Set(extra.length ? spawnSync('git', ['-C', ROOT, 'check-ignore', '--stdin'], { input: extra.join('\n'), encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : []);
for (const p of extra) console.log(`added${ignored.has(p) ? ' (git-ignored)' : ''}: ${p}`);
for (const p of missing) console.log(`missing: ${p}`);
console.log(extra.length || missing.length
  ? `FROZEN PATH INVENTORY: ${extra.length} file(s) on disk not in the baseline, ${missing.length} missing (walked ${roots.join(', ')})`
  : `frozen path inventory OK: ${found.length} files on disk under frozen paths, all in the baseline (walked ${roots.join(', ')})`);
process.exit(extra.length || missing.length ? 1 : 0);

/**
 * GW2 operator dashboard V2 (D140): V1 with the invariance label corrected. Every invariance discrepancy is labelled
 * "within-build invariance (matched situation differing in <varied inputs>)", because the compared situation is always
 * of the same build (see groups.ts). Everything else is the V1 dashboard; V0 and V1 stay as committed.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/ext/dashboard-v2.ts <expDir> --out <new dir> [--label text]
 *
 * Output: a NEW directory, inside the repository only under evidence/gw2/ext-v2/. Deterministic, no timestamps.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { assertWritableOutput, repoRelative } from '../paths.ts';
import { buildAll } from './dashboard.ts';
import { renderV1, renderUnmatchedGrouped, pageV1 } from './dashboard-v1.ts';
import { partitionReader } from './inputs.ts';
import { loadEncoding } from '../verify.ts';
import { P5_ENCODING } from '../heldout.ts';

export const DASHBOARD_V2_ROOT = 'evidence/gw2/ext-v2/';
export function safeDashboardDirV2(d: string) {
  const abs = resolve(d), rel = repoRelative(abs);
  if (/(^|[\\/])(partitions|site)([\\/]|$)/.test(abs)) throw new Error(`refusing ${abs}: never inside a partitions/ or site/ directory`);
  if (rel !== null) { if (!rel.startsWith(DASHBOARD_V2_ROOT)) throw new Error(`refusing ${rel}: inside the repository the V2 dashboard may only be written under ${DASHBOARD_V2_ROOT}`); assertWritableOutput(abs); }
  if (existsSync(abs)) throw new Error(`refusing ${rel ?? abs}: the directory exists (never overwritten)`);
  return abs;
}

/** rule id → clause index → varied inputs of an invariance clause (operator side: reads the spec encoding). */
export function invarianceVary(exp: string) {
  const spec = JSON.parse(partitionReader(exp, ['spec']).read('spec', 'spec.json')), enc = loadEncoding(P5_ENCODING, spec.game.rules);
  const m = new Map<string, string[]>();
  for (const r of enc.usable as any[]) r.clauses.forEach((c: any, i: number) => { if (c.form === 'invariance') m.set(`${r.rule}#${i}`, [...c.vary]); });
  return (rule: string, clause: number) => m.get(`${rule}#${clause}`) ?? null;
}

export function renderV2(x: ReturnType<typeof buildAll>, label: string, exp: string): Record<string, string> {
  const v1 = renderV1(x, label), { A, B } = x;
  const allBuilds = Object.entries((A.builds ?? {}) as Record<string, { label: string | null }>).map(([id, l]) => ({ id, label: l.label }));
  const { html, groups } = renderUnmatchedGrouped(B, allBuilds, { labels: 'v2', varyOf: invarianceVary(exp) });
  return { ...v1, 'index.html': v1['index.html'].replace(/GW2 Extension V1: /g, 'GW2 operator dashboard V2: '),
    'unmatched-actions.html': pageV1('B. Unmatched action notifications', html.replace('</p><p>', '</p><p class="small">V2 correction: the comparison column says "within-build invariance" where V1 said "cross-build invariance"; the compared situation is always of the same build.</p><p>')),
    'unmatched-groups.json': JSON.stringify({ schema: 'gamewatch/gw2-ext-unmatched-groups@2', corrects: 'gamewatch/gw2-ext-unmatched-groups@1 (invariance label)', specification: B.specification, groups }, null, 1) + '\n' };
}

export function writeDashboardV2(exp: string, out: string, label: string) {
  const dir = safeDashboardDirV2(out), files = renderV2(buildAll(exp), label, exp);
  mkdirSync(dir, { recursive: true });
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t, { flag: 'wx' });
  return { dir, files: Object.keys(files) };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/ext/dashboard-v2.ts')) {
  const a = process.argv.slice(2), i = a.indexOf('--out'), li = a.indexOf('--label'), exp = a.find((x, k) => !x.startsWith('--') && a[k - 1] !== '--out' && a[k - 1] !== '--label');
  if (!exp || i < 0) { console.error('usage: dashboard-v2.ts <expDir> --out <new dir> [--label text]'); process.exit(2); }
  const r = writeDashboardV2(isAbsolute(exp) ? exp : join(process.cwd(), exp), a[i + 1], li >= 0 ? a[li + 1] : exp);
  console.log(`operator dashboard V2: ${r.files.length} files in ${r.dir}`);
}

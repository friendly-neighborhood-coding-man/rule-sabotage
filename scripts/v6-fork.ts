/**
 * V6 planner/referee fork generator (EXPERIMENTAL-V6-NOT-PRODUCTION).
 *
 * The V6 game (server/v6/) needs the referee (trial, tiers), the reaction text (flavor), the production planner
 * helpers (ai.ts) and the three frozen V5.3 opponent policies to run on the 13x9 V6 engine. Those files import
 * server/engine.ts (7x7) and a few contain hard-coded 7x7 geometry. They are FROZEN research code and must not change,
 * so this script produces mechanical copies in server/v6/forks/ instead:
 *
 *   1. every import of a forked file is redirected to its fork, every import of server/engine.ts to server/v6/engine.ts,
 *      every other import to the unchanged original (rules.ts, weights.ts);
 *   2. the explicit, listed substitutions below are applied, each of which must match exactly the stated number of times;
 *   3. a header naming the source file and its SHA-256 is prepended.
 *
 * Nothing else differs. tests/v6.test.ts re-runs the generator in memory and fails if a fork on disk is out of date, if a
 * frozen source changed, or if a fork still reaches server/engine.ts. Run:  npm run v6:fork
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FORK_DIR = 'server/v6/forks';
const V6_ENGINE = 'server/v6/engine.ts';

/** Frozen source -> fork file name. */
export const FORKS: Record<string, string> = {
  'server/ai.ts': 'ai.ts',
  'server/trial.ts': 'trial.ts',
  'server/tiers.ts': 'tiers.ts',
  'server/flavor.ts': 'flavor.ts',
  'server/balance/v4/evplanner.ts': 'evplanner.ts',
  'server/balance/v5/evk11.ts': 'evk11.ts',
  'server/balance/v5/policies.ts': 'policies5.ts',
  'server/balance/v5_1/ablation.ts': 'ablation.ts',
  'server/balance/v5_2/stream.ts': 'stream.ts',
  'server/balance/v5_2/planner.ts': 'planner52.ts',
  'server/balance/v5_3/policies.ts': 'policies53.ts',
};
/** Originals the forks may keep importing: they do not import the engine (checked below). */
const SHARED_OK = new Set(['server/rules.ts', 'server/weights.ts']);

export type Sub = { file: string; find: string; replace: string; count: number; why: string };
/** Every non-import difference between a fork and its frozen source. */
export const SUBSTITUTIONS: Sub[] = [
  { file: 'server/ai.ts', find: 'type Piece, SIZE, GOAL_X,', replace: 'type Piece, GOAL_X,', count: 1, why: 'SIZE (7) does not exist on the 13x9 board; ai.ts only re-exported it.' },
  { file: 'server/ai.ts', find: 'export { SIZE };', replace: 'export { W, H } from \'../engine.ts\';', count: 1, why: 'Re-export the V6 board width/height instead of SIZE.' },
  { file: 'server/balance/v4/evplanner.ts', find: 'teleportDestinations, teleportIndexProbabilities, parseKey,\n} from', replace: 'teleportDestinations, teleportIndexProbabilities, parseKey, GOAL_X, W,\n} from', count: 1, why: 'Needed by the two geometry fixes below.' },
  { file: 'server/balance/v4/evplanner.ts', find: "const goal = p === 'human' ? 6 : 0;", replace: 'const goal = GOAL_X[p];', count: 1, why: 'Hard-coded 7x7 goal column (6) in side-relative move ordering.' },
  { file: 'server/balance/v4/evplanner.ts', find: "(ctx.me === 'ai' ? 6 - x : x)", replace: "(ctx.me === 'ai' ? W - 1 - x : x)", count: 1, why: 'Hard-coded 7x7 mirror (6 - x) in the canonical state.' },
  { file: 'server/balance/v4/evplanner.ts', find: '`${sig}|${q.owner}${q.x}${q.y}${q.frozen}${q.shield ? 1 : 0}`', replace: '`${sig}|${q.owner}:${q.x},${q.y}:${q.frozen}:${q.shield ? 1 : 0}`', count: 1, why: 'Path-cost memo key: digits were concatenated without separators, which is unambiguous only while x and y are single digits. On 13 columns x=11,y=0 and x=1,y=1 would collide.' },
  { file: 'server/balance/v5/evk11.ts', find: 'parseKey, GOAL_X } from', replace: 'parseKey, GOAL_X, W } from', count: 1, why: 'Needed by the mirror fix below.' },
  { file: 'server/balance/v5/evk11.ts', find: "(p === 'ai' ? 6 - x : x)", replace: "(p === 'ai' ? W - 1 - x : x)", count: 1, why: 'Hard-coded 7x7 mirror (6 - x) for side-relative tie-breaking (K1).' },
  { file: 'server/balance/v5_1/ablation.ts', find: 'validatePlacement } from', replace: 'validatePlacement, W } from', count: 1, why: 'Needed by the mirror fix below.' },
  { file: 'server/balance/v5_1/ablation.ts', find: "(me === 'ai' ? 6 - x : x)", replace: "(me === 'ai' ? W - 1 - x : x)", count: 1, why: 'Hard-coded 7x7 mirror (6 - x) in the canonical state.' },
];

const lf = (s: string) => s.replace(/\r\n/g, '\n');
export const sha = (s: string) => createHash('sha256').update(lf(s)).digest('hex');
const read = (p: string) => lf(readFileSync(join(ROOT, p), 'utf8'));
const toPosix = (p: string) => p.split('\\').join('/');

function rewriteImports(src: string, file: string): { text: string; targets: string[] } {
  const targets: string[] = [];
  const text = src.replace(/(from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/g, (_m, pre: string, spec: string) => {
    const target = toPosix(relative(ROOT, resolve(ROOT, dirname(file), spec)));
    targets.push(target);
    let dest: string;
    if (target === 'server/engine.ts') dest = V6_ENGINE;
    else if (FORKS[target]) dest = posix.join(FORK_DIR, FORKS[target]);
    else if (SHARED_OK.has(target)) dest = target;
    else throw new Error(`${file} imports ${target}, which is neither forked nor known to be engine-free`);
    let rel = posix.relative(FORK_DIR, dest);
    if (!rel.startsWith('.')) rel = './' + rel;
    return `${pre}'${rel}'`;
  });
  return { text, targets };
}

export function generateForks(): { path: string; content: string; source: string; sourceSha: string }[] {
  for (const f of SHARED_OK) if (/from '\.\/(engine|ai)\.ts'/.test(read(f))) throw new Error(`${f} imports the engine; it must be forked`);
  const out: { path: string; content: string; source: string; sourceSha: string }[] = [];
  for (const [file, name] of Object.entries(FORKS)) {
    const src = read(file);
    let { text } = rewriteImports(src, file);
    for (const s of SUBSTITUTIONS.filter(x => x.file === file)) {
      const n = text.split(s.find).length - 1;
      if (n !== s.count) throw new Error(`${file}: substitution "${s.find}" matched ${n} times, expected ${s.count}`);
      text = text.split(s.find).join(s.replace);
    }
    if (/\b6 - x\b|'ABCDEFG'|\bSIZE\b/.test(text)) throw new Error(`${file}: a 7x7 assumption is left in the fork`);
    const subs = SUBSTITUTIONS.filter(x => x.file === file);
    const header = `/* GENERATED by scripts/v6-fork.ts. DO NOT EDIT. EXPERIMENTAL-V6-NOT-PRODUCTION.\n * Fork of ${file} (sha256 ${sha(src).slice(0, 16)}) for the 13x9 V6 engine.\n * Differences: imports redirected (engine -> server/v6/engine.ts, forked files -> server/v6/forks/)${subs.length ? '; plus\n' + subs.map(s => ` *  - ${s.why}`).join('\n') : '.'}\n */\n`;
    out.push({ path: posix.join(FORK_DIR, name), content: header + text, source: file, sourceSha: sha(src) });
  }
  return out;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('v6-fork.ts')) {
  mkdirSync(join(ROOT, FORK_DIR), { recursive: true });
  for (const f of generateForks()) { writeFileSync(join(ROOT, f.path), f.content); console.log(`wrote ${f.path}  <- ${f.source} ${f.sourceSha.slice(0, 16)}`); }
}

/**
 * Replays every recorded V1 game with the current (V2-hooked) engine and planner and checks it reproduces
 * byte for byte (ms excluded). Proves the V2 experiment hooks are inert in production conditions.
 *   npm run balance:v2:verify-v1-replay [-- --file cycle-1/baseline-heldout-games.ndjson]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJobs, type GameRec } from '../server/balance/selfplay.ts';
import { loadWeights } from '../server/weights.ts';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const argv = process.argv.slice(2);
const i = argv.indexOf('--file');
const rel = i >= 0 ? argv[i + 1] : 'cycle-1/baseline-training-games.ndjson';
const file = join(ROOT, 'evidence/balance/runs/2026-11-18T14-21-47Z-kane', rel);
const v1 = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as GameRec);
const w = loadWeights();
const out = await runJobs(v1.map(g => ({ seed: g.seed, first: g.first, weights: { human: w, ai: w } })));
const strip = (g: GameRec) => JSON.stringify({ ...g, ms: 0 });
const bad = v1.filter((g, k) => strip(g) !== strip(out[k])).map(g => `${g.seed}/${g.first}`);
console.log(`${rel}: ${v1.length - bad.length}/${v1.length} recorded V1 games reproduce exactly${bad.length ? `; DIFFERENT: ${bad.join(', ')}` : ''}`);
process.exit(bad.length ? 1 : 0);

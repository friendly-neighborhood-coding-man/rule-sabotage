/**
 * GameWatch evidence run (EXPERIMENTAL, QA demonstration only). Produces REAL execution evidence for the two builds
 * submitted for QA and writes the game-independent bundle evidence/gamewatch/evidence.json.
 *
 *   node --experimental-strip-types gamewatch/run-evidence.ts all          materialize builds, run everything (4 workers)
 *        ... all --keep-existing  keep an existing bundle (e.g. one frozen for review) instead of collecting again
 *   node --experimental-strip-types gamewatch/run-evidence.ts game <build> <seed> <first> <policy> <out.json>   one match (worker)
 *
 * Contents: every scripted playtest (gamewatch/scenarios.ts) on every build, and matched AI-vs-AI games: the same seeds
 * on every build, each seed played twice with the first mover swapped, both seats the same policy.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, materialize, loadBuild, type Change } from './builds.ts';
import { runScript, runSelfPlay } from './adapters/rule-sabotage.ts';
import { SCRIPTS } from './scenarios.ts';
import { RULES, SOURCE } from './rules-doc.ts';
import type { GWBundle, GWMatch, GWCase } from './evidence.ts';
import type { Player } from '../server/rules.ts';

const OUT = join(ROOT, 'evidence/gamewatch');
const RAW = join(OUT, 'raw');
export const SEEDS = [97001, 97002, 97003, 97004, 97005, 97006, 97007, 97008];
export const POLICY = 'softmax-v2' as const;
const FIRST: Player[] = ['human', 'ai'];

/** Anonymous id: a hash of the content key, so ids are stable but carry no meaning. */
const anon = (prefix: string, k: string) => `${prefix}-${createHash('sha256').update('gamewatch:' + k).digest('hex').slice(0, 6)}`;

/** The builds to run: the operator's build list if present, else GW_BUILDS (default: server/v6 as it stands). */
async function evidenceBuilds(): Promise<{ label: string; changes: Change[] }[]> {
  if (process.env.GW_BUILDS) return process.env.GW_BUILDS.split(',').map(label => ({ label, changes: [] }));
  const list = join(ROOT, 'gamewatch/private/evidence-builds.ts');
  if (existsSync(list)) return (await import(new URL(`file://${list}`).href)).evidenceBuilds();
  return [{ label: 'under-test', changes: [] }];
}

async function worker(args: string[]) {
  const [build, seed, first, policy, out] = args;
  const b = await loadBuild(build);
  const g = await runSelfPlay(b, Number(seed), first as Player, policy as typeof POLICY, anon('M', `${build}:${seed}:${first}:${policy}`), build);
  writeFileSync(out, JSON.stringify(g));
}

function runPool(jobs: string[][], n: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, failed = false;
    const launch = () => {
      if (failed) return;
      if (next >= jobs.length && running === 0) return resolve();
      while (running < n && next < jobs.length) {
        const j = jobs[next++]; running++;
        const t0 = Date.now();
        const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'gamewatch/run-evidence.ts'), 'game', ...j], { stdio: ['ignore', 'inherit', 'inherit'] });
        p.on('exit', code => {
          running--;
          if (code !== 0) { failed = true; return reject(new Error(`game ${j.join(' ')} exited ${code}`)); }
          console.log(`  done ${j.slice(0, 4).join(' ')} in ${Math.round((Date.now() - t0) / 1000)} s`);
          launch();
        });
      }
    };
    launch();
  });
}

async function all() {
  if (process.argv.includes('--keep-existing') && existsSync(join(OUT, 'evidence.json'))) {
    const b = JSON.parse(readFileSync(join(OUT, 'evidence.json'), 'utf8')) as GWBundle;
    console.log(`keeping the existing bundle evidence/gamewatch/evidence.json (${b.cases.length} cases, ${b.matches.length} matches, generated ${b.generatedAt}); delete it to collect again`);
    return;
  }
  mkdirSync(RAW, { recursive: true });
  const builds = await evidenceBuilds();
  for (const b of builds) materialize(b.label, b.changes);
  const cases: GWCase[] = [];
  for (const b of builds) {
    const mod = await loadBuild(b.label);
    for (const sc of SCRIPTS) cases.push(await runScript(mod, sc, anon('C', `${b.label}:${sc.id}`), b.label));
  }
  const jobs: string[][] = [];
  for (const b of builds) for (const seed of SEEDS) for (const first of FIRST) {
    const f = join(RAW, `${b.label}-${seed}-${first}-${POLICY}.json`);
    if (!existsSync(f)) jobs.push([b.label, String(seed), first, POLICY, f]);
  }
  console.log(`${cases.length} scripted cases; ${jobs.length} games to play`);
  await runPool(jobs, Number(process.env.GW_WORKERS ?? 4));
  const matches: GWMatch[] = [];
  for (const b of builds) for (const seed of SEEDS) for (const first of FIRST) matches.push(JSON.parse(readFileSync(join(RAW, `${b.label}-${seed}-${first}-${POLICY}.json`), 'utf8')));
  // Present cases and matches in an order unrelated to build or script.
  cases.sort((a, b) => a.caseId.localeCompare(b.caseId));
  matches.sort((a, b) => a.matchId.localeCompare(b.matchId));
  const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })();
  const bundle: GWBundle = {
    schema: 'gamewatch/evidence@1',
    game: { name: 'Rule Sabotage', version: 'V6.1 (13x9 board, no new effects next to any piece)', rules: RULES },
    source: SOURCE(SEEDS, POLICY),
    builds: builds.map(b => ({ label: b.label, note: 'Build submitted for QA. Build labels are arbitrary.' })).sort((a, b) => a.label.localeCompare(b.label)),
    cases, matches, generatedAt: new Date().toISOString(), generator: { commit, command: 'node --experimental-strip-types gamewatch/run-evidence.ts all' },
  };
  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(bundle, null, 1) + '\n');
  console.log(`wrote evidence/gamewatch/evidence.json: ${cases.length} cases, ${matches.length} matches`);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'game') await worker(rest);
else if (mode === 'all') await all();
else { console.error('usage: run-evidence.ts all | game <build> <seed> <first> <policy> <out>'); process.exit(2); }

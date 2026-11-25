/**
 * GW2 P5: deterministic generation of NEW engine observations (Q6 = yes, D73) from a FROZEN generation procedure.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/generate.ts build-hashes <procedure.json>
 *        materialize the procedure's builds and print their source hashes (to freeze them in the procedure; no play)
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/generate.ts run <procedure.json> <run> <outDir>
 *        run one named run of the procedure (e.g. "experiment" or "validation") into a NEW directory
 *
 * The procedure (gamewatch/gw2-generation-procedure@1) fixes, before anything is generated: the generator code and its
 * inputs by hash, the builds (mutation ids from gamewatch/private/mutations.json) and every materialized build file by
 * hash, the scripts, the match seeds, first movers and policy, and the selection rule. `run` refuses when any hash
 * differs, when the procedure is frozen after the run would start, or when the output directory already exists: an
 * output is never regenerated or replaced, and nothing is selected after the fact (every script on every build, every
 * seed × first mover × build; all outputs kept). Engine code is never changed: builds are materialized copies
 * (gamewatch/builds.ts, git-ignored), exactly as in GW1.
 *
 * Outputs: <outDir>/bundle.json (gamewatch/evidence@1, the input of partition.ts) and <outDir>/PROVENANCE.json.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { fileSha256 } from './judgments.ts';
import { materialize, loadBuild, type Change } from '../builds.ts';
import { runScript, runSelfPlay, type Script } from '../adapters/rule-sabotage.ts';
import { SCRIPTS } from '../scenarios.ts';
import { P5_SCRIPTS } from './scenarios-p5.ts';
import { RULES, SOURCE } from '../rules-doc.ts';
import type { GWBundle, GWCase, GWMatch } from '../evidence.ts';
import type { Player } from '../../server/rules.ts';

export const GENERATION_SCHEMA = 'gamewatch/gw2-generation-procedure@1';
export const PROVENANCE_SCHEMA = 'gamewatch/gw2-generation-provenance@1';
export const ALL_SCRIPTS: Script[] = [...SCRIPTS, ...P5_SCRIPTS];

export type RunSpec = { builds: { label: string; from: 'evidence' | 'groundTruth'; key: string }[]; scripts: string[]; matches: { seeds: number[]; firstMovers: Player[]; policy: 'softmax-v2' } | null; idSalt: string };
export type GenerationProcedure = {
  schema: typeof GENERATION_SCHEMA; id: string; frozenAt: string; purpose: string;
  code: { path: string; sha256: string }[]; mutations: { path: string; sha256: string };
  buildHashes: Record<string, Record<string, string>>; runs: Record<string, RunSpec>; selection: string[]; notes?: string[];
};
export class GenerationError extends Error {}

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const lf = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

/** The build's whole source tree, file by file (LF-normalised SHA-256), plus one hash over the sorted list. */
export function treeHashes(dir: string) {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.ts')) out[relative(dir, p).split('\\').join('/')] = sha(lf(p)); } };
  walk(dir);
  return { files: out, tree: sha(Object.entries(out).map(([k, v]) => `${k}\t${v}`).join('\n')) };
}

/** Materialize a build of the procedure under a GW2-specific label; returns its hashes. */
async function buildOf(b: RunSpec['builds'][number], mut: { mutations: Change[]; builds: Record<string, Record<string, string[]>> }) {
  const ids = mut.builds[b.from]?.[b.key];
  if (!ids) throw new GenerationError(`build ${b.label}: ${b.from}.${b.key} not found in mutations.json`);
  const info = materialize(`gw2p5-${b.label}`, mut.mutations.filter(m => ids.includes(m.id)));
  return { info, mutationIds: ids, hashes: treeHashes(info.dir) };
}

export function loadGenerationProcedure(file: string, root = ROOT): GenerationProcedure {
  const p = JSON.parse(readFileSync(file, 'utf8')) as GenerationProcedure, bad: string[] = [];
  if (p.schema !== GENERATION_SCHEMA) bad.push(`schema must be ${GENERATION_SCHEMA}`);
  if (typeof p.frozenAt !== 'string' || Number.isNaN(Date.parse(p.frozenAt))) bad.push('frozenAt must be an ISO time');
  for (const r of [...(p.code ?? []), p.mutations]) {
    if (!r || typeof r.path !== 'string') { bad.push('code and mutations entries must be {path, sha256}'); continue; }
    const abs = join(root, r.path);
    if (!existsSync(abs)) bad.push(`${r.path} not found`); else if (fileSha256(abs) !== r.sha256) bad.push(`${r.path} does not match its frozen sha256`);
  }
  for (const [name, r] of Object.entries(p.runs ?? {})) {
    for (const id of r.scripts) if (!ALL_SCRIPTS.some(s => s.id === id)) bad.push(`run ${name}: unknown script ${id}`);
    if (new Set(r.scripts).size !== r.scripts.length) bad.push(`run ${name}: duplicate scripts`);
  }
  if (!Array.isArray(p.selection) || !p.selection.length) bad.push('selection rule must be stated');
  if (bad.length) throw new GenerationError(`invalid generation procedure ${file}:\n  ${bad.join('\n  ')}`);
  return p;
}

/** The checked-out commit, read from the git files (no process is started). Null when it cannot be read. */
export function gitHead(root = ROOT): string | null {
  try {
    let dir = join(root, '.git');
    if (statSync(dir).isFile()) dir = readFileSync(dir, 'utf8').trim().replace(/^gitdir: /, '');
    const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5), common = existsSync(join(dir, 'commondir')) ? join(dir, readFileSync(join(dir, 'commondir'), 'utf8').trim()) : dir;
    for (const d of [dir, common]) if (existsSync(join(d, ref))) return readFileSync(join(d, ref), 'utf8').trim();
    const packed = existsSync(join(common, 'packed-refs')) ? readFileSync(join(common, 'packed-refs'), 'utf8') : '';
    return packed.split('\n').find(l => l.endsWith(' ' + ref))?.split(' ')[0] ?? null;
  } catch { return null; }
}

/** Print the hashes of the procedure's builds (used once, to freeze them). Generates no observation. */
export async function buildHashes(procFile: string) {
  const p = JSON.parse(readFileSync(procFile, 'utf8')) as GenerationProcedure;
  const mut = JSON.parse(readFileSync(join(ROOT, p.mutations.path), 'utf8'));
  const out: Record<string, Record<string, string>> = {};
  for (const r of Object.values(p.runs)) for (const b of r.builds) { const x = await buildOf(b, mut); out[b.label] = { tree: x.hashes.tree, 'engine.ts': x.hashes.files['engine.ts'], 'turn.ts': x.hashes.files['turn.ts'] }; rmSync(x.info.dir, { recursive: true, force: true }); }
  return out;
}

/** Run one named run of a frozen procedure into a new directory. */
export async function generate(procFile: string, runName: string, outDir: string, o: { now?: () => Date; log?: (s: string) => void } = {}) {
  const now = o.now ?? (() => new Date()), log = o.log ?? (() => {});
  const p = loadGenerationProcedure(procFile), run = p.runs[runName];
  if (!run) throw new GenerationError(`procedure ${p.id} has no run "${runName}"`);
  const startedAt = now();
  if (startedAt.getTime() <= Date.parse(p.frozenAt)) throw new GenerationError(`procedure ${p.id} is frozen at ${p.frozenAt}, not before this run; a procedure must be frozen before generation`);
  const out = assertWritableOutput(outDir);
  if (existsSync(out)) throw new GenerationError(`${repoRelative(out) ?? out} exists: generated observations are never regenerated or replaced`);
  const mut = JSON.parse(readFileSync(join(ROOT, p.mutations.path), 'utf8'));
  const builds: { label: string; dir: string; mutationIds: string[]; hashes: ReturnType<typeof treeHashes>; mod: Awaited<ReturnType<typeof loadBuild>> }[] = [];
  for (const b of run.builds) {
    const x = await buildOf(b, mut), frozen = p.buildHashes[b.label];
    if (!frozen || frozen.tree !== x.hashes.tree) throw new GenerationError(`build ${b.label}: materialized source tree ${x.hashes.tree.slice(0, 12)} differs from the frozen ${String(frozen?.tree).slice(0, 12)}`);
    builds.push({ label: b.label, dir: x.info.dir, mutationIds: x.mutationIds, hashes: x.hashes, mod: await loadBuild(`gw2p5-${b.label}`) });
  }
  const anon = (prefix: string, k: string) => `${prefix}-${sha(`${run.idSalt}:${k}`).slice(0, 6)}`;
  const cases: GWCase[] = [], matches: GWMatch[] = [];
  for (const b of builds) for (const id of run.scripts) {
    const sc = ALL_SCRIPTS.find(s => s.id === id)!;
    cases.push(await runScript(b.mod, sc, anon('C', `${b.label}:${sc.id}`), b.label));
  }
  log(`${cases.length} scripted cases`);
  if (run.matches) for (const b of builds) for (const seed of run.matches.seeds) for (const first of run.matches.firstMovers) {
    matches.push(await runSelfPlay(b.mod, seed, first, run.matches.policy, anon('M', `${b.label}:${seed}:${first}:${run.matches.policy}`), b.label));
    log(`  match ${b.label} ${seed} ${first}: ${matches.at(-1)!.turns} turns`);
  }
  cases.sort((a, b) => a.caseId.localeCompare(b.caseId)); matches.sort((a, b) => a.matchId.localeCompare(b.matchId));
  const generatedAt = now().toISOString(), commit = gitHead();
  const bundle: GWBundle = {
    schema: 'gamewatch/evidence@1',
    game: { name: 'Rule Sabotage', version: 'V6.1 (13x9 board, no new effects next to any piece)', rules: RULES },
    source: run.matches ? SOURCE(run.matches.seeds, run.matches.policy) : SOURCE([], 'none').slice(0, 2),
    builds: builds.map(b => ({ label: b.label, note: 'Build submitted for QA. Build labels are arbitrary.' })).sort((a, b) => a.label.localeCompare(b.label)),
    cases, matches, generatedAt, generator: { commit, command: `node --experimental-strip-types gamewatch/gw2/generate.ts run ${repoRelative(procFile) ?? procFile} ${runName} ${repoRelative(out) ?? out}` },
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'bundle.json'), JSON.stringify(bundle, null, 1) + '\n');
  const provenance = {
    schema: PROVENANCE_SCHEMA, procedure: { id: p.id, path: repoRelative(procFile) ?? procFile, sha256: fileSha256(procFile), frozenAt: p.frozenAt }, run: runName,
    startedAt: startedAt.toISOString(), generatedAt, node: process.version, platform: process.platform, git: { commit, note: 'the generator code is identified by the frozen sha256 values in code[] (checked before the run), not by the commit' },
    code: p.code, mutations: p.mutations,
    builds: builds.map(b => ({ label: b.label, mutationIds: b.mutationIds, sourceTree: b.hashes.tree, files: b.hashes.files, matchesFrozen: true })),
    scripts: run.scripts.map(id => ({ id, sha256: sha(JSON.stringify(ALL_SCRIPTS.find(s => s.id === id))) })), matches: run.matches,
    counts: { cases: cases.length, matches: matches.length, refusedSteps: cases.reduce((n, c) => n + c.steps.filter(s => s.outcome === 'refused').length, 0) },
    bundle: { path: 'bundle.json', sha256: fileSha256(join(out, 'bundle.json')) },
    selection: p.selection, note: 'Every output of the run is kept. Nothing was selected, filtered or regenerated, and no agent output was an input.',
  };
  writeFileSync(join(out, 'PROVENANCE.json'), JSON.stringify(provenance, null, 1) + '\n');
  for (const b of builds) rmSync(b.dir, { recursive: true, force: true });
  return { out, bundle, provenance };
}

if (process.argv[1]?.endsWith('gw2/generate.ts')) {
  const [mode, proc, run, outDir] = process.argv.slice(2);
  try {
    if (mode === 'build-hashes' && proc) console.log(JSON.stringify(await buildHashes(proc), null, 1));
    else if (mode === 'run' && proc && run && outDir) { const r = await generate(proc, run, outDir, { log: s => console.log(s) }); console.log(`wrote ${relative(process.cwd(), r.out)}: ${r.provenance.counts.cases} cases, ${r.provenance.counts.matches} matches`); }
    else { console.error('usage: generate.ts build-hashes <procedure.json> | run <procedure.json> <run> <outDir>'); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}

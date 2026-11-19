/**
 * Balance Designer V3: the 100-game exploratory screen (matrix, offline worker pool, dataset, replay check).
 *
 *  matrix (balance/v3/matrix.json) -> 100 jobs (5 conditions x 10 seeds x both first movers) -> bounded pool of
 *  offline worker threads (real engine + real planner, every turn recorded) -> dataset directory:
 *
 *    games.ndjson            one compact summary per game (no turn detail), stable order
 *    games/<gameId>.json     the full replayable record (turns, candidates, moves, engine events, RNG)
 *    run.json                configuration, hashes, guard counters, timing and resources
 *    replay-check.json       every game re-executed move by move through the engine (no planner)
 *    manifest.json           sha256 of every file
 *
 * Nothing here imports game.ts, kane.ts, openrouter.ts or tiers.ts; importGraph() proves it for the manifest.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  type StartingConfiguration, type GameEvent, type Dir, EXPERIMENTAL_START_CONFIG, init, applyPlacement, applyMove, endTurn, validatePlacement, validateMove,
} from '../../engine.ts';
import { type GameRec, type Job, stateHash } from '../selfplay.ts';
import { type Weights, effectFromId } from '../../weights.ts';
import { type Player, PLAYERS } from '../../rules.ts';
import { type GuardReport } from './offline.ts';

export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const MATRIX_FILE = join(ROOT, 'balance/v3/matrix.json');
/** A condition (screen) or arm (validation). `hooks` = experiment-only planner hooks passed to BOTH sides. */
export type Condition = { id: string; label: string; firstMover: number; secondMover: number; hooks?: import('../../ai.ts').PlannerHooks };
export type Matrix = { schema: string; id: string; totalGames: number; seeds: number[]; conditions: Condition[]; layout: 'spread' | 'center' | 'edge'; workers: number; maxMsPerGame: number; [k: string]: unknown };
const sortKeys = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : Array.isArray(v) ? v.map(sortKeys) : v);
export const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(sortKeys(v))).digest('hex').slice(0, 16);
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function loadMatrix(file = MATRIX_FILE): Matrix {
  const m = JSON.parse(readFileSync(file, 'utf8')) as Matrix;
  const n = m.conditions.length * m.seeds.length * 2;
  if (n !== m.totalGames) throw new Error(`matrix declares ${m.totalGames} games but defines ${n}`);
  if (new Set(m.seeds).size !== m.seeds.length) throw new Error('duplicate seeds in the matrix');
  return m;
}
export const startConfig = (c: Condition, layout: Matrix['layout'] = 'spread'): StartingConfiguration => ({ id: c.id, experimental: EXPERIMENTAL_START_CONFIG, pieces: { firstMover: c.firstMover, secondMover: c.secondMover }, layout });
export const gameId = (cond: string, seed: number, first: Player) => `${cond}-${seed}-${first}`;
export type BatchJob = Job & { gameId: string; condition: string };
export function buildJobs(m: Matrix, weights: Weights): BatchJob[] {
  return m.conditions.flatMap(c => m.seeds.flatMap(seed => PLAYERS.map(first => ({ gameId: gameId(c.id, seed, first), condition: c.id, seed, first, weights: { human: weights, ai: weights }, start: startConfig(c, m.layout), detail: true, ...(c.hooks ? { hooks: { human: c.hooks, ai: c.hooks } } : {}), ...(c.hooks?.blindRng ? { replanOnRandom: true } : {}) }))));
}

/** Source files whose content defines the engine and the planner (hashed into the run record). */
export const ENGINE_FILES = ['server/engine.ts', 'server/rules.ts'];
export const PLANNER_FILES = ['server/ai.ts', 'server/weights.ts', 'server/balance/selfplay.ts'];
export const filesHash = (fs: string[]) => sha256(fs.map(f => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')).join('\0')).slice(0, 16);

/** Static, transitive import graph from an entry file (relative imports only; bare/builtin modules listed separately). */
export function importGraph(entry: string): { files: string[]; builtins: string[] } {
  const seen = new Set<string>(), builtins = new Set<string>();
  const visit = (abs: string) => {
    if (seen.has(abs)) return; seen.add(abs);
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) visit(resolve(dirname(abs), spec)); else builtins.add(spec);
    }
  };
  visit(resolve(ROOT, entry));
  return { files: [...seen].map(f => relative(ROOT, f).split(sep).join('/')).sort(), builtins: [...builtins].sort() };
}
/** Modules that can reach a model, an API or Kane. None may be reachable from the batch worker. */
export const FORBIDDEN_MODULES = ['server/game.ts', 'server/kane.ts', 'server/openrouter.ts', 'server/tiers.ts', 'server/trial.ts', 'server/server.ts', 'server/balance/v2/kane2.ts'];
export function offlineImportCheck(entry = 'server/balance/v3/worker.ts') {
  const g = importGraph(entry);
  const forbidden = g.files.filter(f => FORBIDDEN_MODULES.includes(f));
  const netBuiltins = g.builtins.filter(b => /^(node:)?(http|https|http2|net|tls|dgram|child_process)$/.test(b));
  const badNet = netBuiltins.length && g.files.some(f => f !== 'server/balance/v3/offline.ts' && /from ['"]node:(http|https|http2|net|tls|dgram|child_process)['"]/.test(readFileSync(join(ROOT, f), 'utf8')));
  return { entry, files: g.files, builtins: g.builtins, forbidden, pass: forbidden.length === 0 && !badNet, note: 'network/child_process builtins may only be imported by offline.ts (which replaces them with blocking stubs)' };
}

export type WorkerResult = { recs: GameRec[]; guard: { attempts: number; blocked: GuardReport['blocked']; workers: number; strippedEnv: string[] }; cpuMs: number[] };
/** Bounded pool of offline workers. Results come back in job order. */
export async function runBatch(jobs: BatchJob[], o: { workers: number; maxMs?: number; onGame?: (done: number, total: number, r: GameRec, j: BatchJob) => void }): Promise<WorkerResult> {
  const n = Math.max(1, Math.min(jobs.length, o.workers));
  const out: GameRec[] = new Array(jobs.length), cpu: number[] = new Array(jobs.length).fill(0);
  const lastGuard: GuardReport[] = [];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, (_, wi) => new Promise<void>((res, rej) => {
    const wk = new Worker(new URL('./worker.ts', import.meta.url));
    const feed = () => { if (next >= jobs.length) { void wk.terminate(); res(); return; } const i = next++; const { gameId: _g, condition: _c, ...job } = jobs[i]; wk.postMessage({ i, job, maxMs: o.maxMs }); };
    wk.on('message', (m: { i: number; rec?: GameRec; error?: string; guard: GuardReport; cpuMs?: number }) => {
      lastGuard[wi] = m.guard;
      if (m.error) { rej(new Error(m.error)); void wk.terminate(); return; }
      out[m.i] = m.rec!; cpu[m.i] = m.cpuMs ?? 0; done++; o.onGame?.(done, jobs.length, m.rec!, jobs[m.i]); feed();
    });
    wk.on('error', rej);
    feed();
  })));
  const gs = lastGuard.filter(Boolean);
  return { recs: out, cpuMs: cpu, guard: { attempts: gs.reduce((a, g) => a + g.attempts, 0), blocked: gs.flatMap(g => g.blocked), workers: gs.length, strippedEnv: [...new Set(gs.flatMap(g => g.strippedEnv))].sort() } };
}

/** The compact per-game summary row (games.ndjson). */
export function summaryRow(r: GameRec, j: { gameId: string; condition: string }) {
  const { detail: _d, captured: _c, planTrace: _p, ...rest } = r;
  const firstMover = r.first, second: Player = r.first === 'human' ? 'ai' : 'human';
  const winnerRole = r.winner === 'draw' ? 'draw' : r.winner === firstMover ? 'first' : 'second';
  return { gameId: j.gameId, condition: j.condition, ...rest, secondMover: second, winnerRole, detailHash: r.detail ? hashOf(r.detail) : null, finalHash: r.detail?.finalHash ?? null };
}
export type SummaryRow = ReturnType<typeof summaryRow>;

/**
 * Re-execute one recorded game through the REAL engine only (no planner): same seed, first mover and starting
 * configuration, then every recorded placement and move in order. Every engine event, the RNG at every turn start,
 * the board at every turn start and the final state hash must match the record exactly.
 */
export function replayDetail(r: GameRec): { ok: boolean; problems: string[]; turns: number; moves: number } {
  const d = r.detail; const problems: string[] = [];
  if (!d) return { ok: false, problems: ['no detail record'], turns: 0, moves: 0 };
  const s = init(d.seed, { first: d.first, ...(d.start ? { start: { id: d.start.id, experimental: EXPERIMENTAL_START_CONFIG, pieces: { firstMover: d.start.count[d.first], secondMover: d.start.count[d.first === 'human' ? 'ai' : 'human'] }, layout: d.start.layout } } : {}) });
  let moves = 0;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const t of d.turns) {
    if (s.winner) { problems.push(`turn ${t.turn}: game already over in replay`); break; }
    if (s.turn !== t.turn || s.current !== t.p) { problems.push(`turn ${t.turn}: replay is at turn ${s.turn} (${s.current})`); break; }
    if (s.rng !== t.rngStart) problems.push(`turn ${t.turn}: rng ${s.rng} != recorded ${t.rngStart}`);
    if (s.actionsLeft !== t.actions) problems.push(`turn ${t.turn}: actions ${s.actionsLeft} != recorded ${t.actions}`);
    if (t.placement) {
      const e = effectFromId(t.placement.effect);
      const pl = { text: 'planner', effect: e!, cells: t.placement.cells, interpretedBy: 'planner' };
      const c = validatePlacement(s, t.p, pl);
      if (!e || !c.ok) { problems.push(`turn ${t.turn}: recorded placement is not legal in replay (${c.ok ? 'unknown effect' : c.reason})`); break; }
      if (!same(applyPlacement(s, t.p, pl), t.placement.events)) problems.push(`turn ${t.turn}: placement events differ`);
    }
    if (s.phase === 'place') s.phase = 'move';
    for (const m of t.moves) {
      if (s.rng !== m.rngBefore) problems.push(`turn ${t.turn}: rng before move ${s.rng} != ${m.rngBefore}`);
      const mv = { from: m.from, dir: m.dir as Dir, mode: m.mode as 'stack' | 'single' };
      const c = validateMove(s, t.p, mv);
      if (!c.ok) { problems.push(`turn ${t.turn}: recorded move ${m.from} ${m.dir} illegal in replay (${c.reason})`); break; }
      if (!same(applyMove(s, t.p, mv), m.events)) problems.push(`turn ${t.turn}: events of move ${m.from} ${m.dir} differ`);
      moves++;
    }
    if (s.winner) break;
    const ev: GameEvent[] = endTurn(s);
    if (!same(ev, t.endEvents)) problems.push(`turn ${t.turn}: end-of-turn events differ`);
  }
  if (stateHash(s) !== d.finalHash) problems.push(`final state hash ${stateHash(s)} != recorded ${d.finalHash}`);
  if ((s.winner ?? 'draw') !== r.winner) problems.push(`winner ${s.winner} != recorded ${r.winner}`);
  return { ok: problems.length === 0, problems: problems.slice(0, 10), turns: d.turns.length, moves };
}
export { existsSync };

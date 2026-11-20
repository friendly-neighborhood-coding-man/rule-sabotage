/**
 * V5.1 C1-C4 ablation (balance/v5_1/ablation-protocol.json): preregistered, exactly 96 offline games, run once.
 * Arms: frozen ev-k1 (its own historical code path), K1 + exactly one of C1..C4 (server/balance/v5_1/ablation.ts),
 * and the full ev-k1.1 (its own V5 code path). Seeds 69001-69008 x both first movers, every arm on the same seeds.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, platform, release } from 'node:os';
import { type Player, PLAYERS } from '../../rules.ts';
import { loadWeights } from '../../weights.ts';
import { type GameRec } from '../selfplay.ts';
import { ROOT, runBatch, summaryRow, replayDetail, offlineImportCheck, hashOf, sha256, filesHash, ENGINE_FILES, PLANNER_FILES, type BatchJob } from '../v3/batch.ts';
import { teleportForesight } from '../v3/evaluate.ts';
import { r3, mean, quant, xorshift, wilson } from '../v3/stats.ts';
import { appendJournal, readJournal, verifyJournal } from '../journal.ts';
import { listFiles } from '../v4/pilot.ts';
import { seedBlocked, pairedSeedDiff, RATE, type Game } from '../v5/metrics.ts';
import { type AblFlags } from './ablation.ts';

export const PROTOCOL = join(ROOT, 'balance/v5_1/ablation-protocol.json');
export const JOURNAL = join(ROOT, 'balance/v5_1/journal.ndjson');
const protoSha = () => sha256(readFileSync(PROTOCOL, 'utf8').replace(/\r\n/g, '\n'));
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
export const FILES = ['server/balance/v4/evplanner.ts', 'server/balance/v5/evk11.ts', 'server/balance/v5/policies.ts', 'server/balance/v5_1/ablation.ts', 'server/balance/v5_1/ablrun.ts', 'server/balance/v5/metrics.ts'];
export const implementationHashes = () => ({ engine: filesHash(ENGINE_FILES), plannerFiles: filesHash(PLANNER_FILES), ablation: filesHash(FILES), all: filesHash([...ENGINE_FILES, ...PLANNER_FILES, ...FILES]) });
export const SEEDS = [69001, 69002, 69003, 69004, 69005, 69006, 69007, 69008];
export const ARM_DEF: Record<string, { label: string; flags?: AblFlags; path: 'frozen-ev-k1' | 'ablation' | 'ev-k1.1' }> = {
  K1: { label: 'frozen ev-k1 (historical code path)', path: 'frozen-ev-k1' },
  C1: { label: 'K1 + C1 only', flags: { c1: true }, path: 'ablation' }, C2: { label: 'K1 + C2 only', flags: { c2: true }, path: 'ablation' },
  C3: { label: 'K1 + C3 only', flags: { c3: true }, path: 'ablation' }, C4: { label: 'K1 + C4 only', flags: { c4: true }, path: 'ablation' },
  K11: { label: 'full ev-k1.1 (V5 code path)', path: 'ev-k1.1' },
};
export type AblJob = BatchJob & { arm: string };
export function ablJobs(): AblJob[] {
  const w = loadWeights(), W = { human: w as never, ai: w as never };
  return Object.entries(ARM_DEF).flatMap(([arm, a]) => SEEDS.flatMap(seed => PLAYERS.map(first => {
    const j: AblJob = { gameId: `${arm}-${seed}-${first}`, condition: arm, arm, seed, first, weights: W, detail: true };
    if (a.path === 'frozen-ev-k1') Object.assign(j, { planner: { human: 'ev-v4', ai: 'ev-v4' }, evVariant: { human: { sideRelativeOrder: true }, ai: { sideRelativeOrder: true } } });
    else if (a.path === 'ablation') Object.assign(j, { ablation: { human: a.flags, ai: a.flags } });
    else Object.assign(j, { policy: { human: 'ev-k1.1', ai: 'ev-k1.1' } });
    return j;
  })));
}
export function preregister(preflightFile: string) {
  if (readJournal(JOURNAL).some(e => e.type === 'ablation-preregistered')) throw new Error('already preregistered');
  const dirty = git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']); if (dirty) throw new Error(`commit first:\n${dirty}`);
  return appendJournal(JOURNAL, 'ablation-preregistered', 'V5.1-ABLATION-96', null, { protocol: 'balance/v5_1/ablation-protocol.json', protocolSha256: protoSha(), implementation: implementationHashes(), commit: git(['rev-parse', 'HEAD']), preflightSha256: sha256(readFileSync(preflightFile)), assignments: ablJobs().map(j => j.gameId), note: 'frozen before any ablation game' });
}
export async function runAblation(log: (s: string) => void = console.log) {
  if (!verifyJournal(JOURNAL).ok) throw new Error('journal fails verification');
  const pre = readJournal(JOURNAL).find(e => e.type === 'ablation-preregistered'); if (!pre) throw new Error('not preregistered');
  const d = pre.data as { protocolSha256: string; implementation: ReturnType<typeof implementationHashes> };
  if (d.protocolSha256 !== protoSha() || JSON.stringify(d.implementation) !== JSON.stringify(implementationHashes())) throw new Error('protocol or implementation changed after preregistration');
  if (readJournal(JOURNAL).some(e => e.type === 'ablation-start')) throw new Error('already started once');
  const jobs = ablJobs(); if (jobs.length !== 96) throw new Error(`${jobs.length} games`);
  if (!offlineImportCheck().pass) throw new Error('offline import check failed');
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z-v51-ablation', dir = join(ROOT, 'evidence/balance/v5_1', runId);
  mkdirSync(join(dir, 'games'), { recursive: true });
  const env = { implementation: implementationHashes(), protocolSha256: protoSha(), commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']) !== '', node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism() };
  appendJournal(JOURNAL, 'ablation-start', runId, null, { games: jobs.length, ...env });
  log(`ablation ${runId}: ${jobs.length} games`);
  const t0 = Date.now();
  const res = await runBatch(jobs, { workers: Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))), maxMs: 1_800_000, onGame: (k, n, r, j) => { if (k % 8 === 0 || k === n) log(`  ${k}/${n} ${j.gameId} ${r.winner} t${r.turns} ${Math.round(r.ms / 1000)}s`); } });
  const wallMs = Date.now() - t0;
  for (let i = 0; i < jobs.length; i++) writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v51-ablation-game@1', gameId: jobs[i].gameId, arm: jobs[i].arm, rec: res.recs[i] }));
  writeFileSync(join(dir, 'games.ndjson'), res.recs.map((r, i) => JSON.stringify({ ...summaryRow(r, jobs[i]), arm: jobs[i].arm })).join('\n') + '\n');
  const replays = res.recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ ok: replays.every(r => r.ok), games: replays.length, failures: replays.filter(r => !r.ok) }, null, 2));
  const run = { schema: 'rule-sabotage/v51-ablation-run@1', runId, games: jobs.length, wallMs, externalCalls: res.guard.attempts, kaneCalls: 0, datasetHash: hashOf(res.recs.map(r => r.detail!.finalHash)), replayOk: replays.every(r => r.ok), ...env };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(Object.fromEntries(listFiles(dir).filter(f => f !== 'manifest.json').map(f => [f, sha256(readFileSync(join(dir, f)))])), null, 2));
  appendJournal(JOURNAL, 'ablation-complete', runId, null, { dir: relative(ROOT, dir).replace(/\\/g, '/'), datasetHash: run.datasetHash, replayOk: run.replayOk, externalCalls: run.externalCalls, wallMs, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) });
  log(`done in ${(wallMs / 60000).toFixed(1)} min: replay ${run.replayOk ? 'OK' : 'FAILED'}, external calls ${run.externalCalls}`);
  return dir;
}

const MOVE_RATE = (xs: Game[]) => (xs.length ? mean(xs.map(g => g.rec.detail!.turns.reduce((a, t) => a + t.moves.length, 0) / g.rec.detail!.turns.length)) : null);
const UNUSED = (xs: Game[]) => (xs.length ? mean(xs.map(g => g.rec.unusedActions.human + g.rec.unusedActions.ai)) : null);
const SCORED_BY_20 = (xs: Game[]) => (xs.length ? mean(xs.map(g => g.rec.detail!.turns.filter(t => t.turn <= 20).reduce((a, t) => a + t.moves.reduce((b, m) => b + m.events.filter(e => e.t === 'score').reduce((c, e) => c + (e as { pieces: string[] }).pieces.length, 0), 0), 0))) : null);
const ZERO_MOVE_TURNS = (xs: Game[]) => (xs.length ? mean(xs.map(g => g.rec.detail!.turns.filter(t => t.moves.length === 0).length / g.rec.detail!.turns.length)) : null);
export function evaluateAblation(dir: string) {
  const all: Game[] = readdirSync(join(dir, 'games')).sort().map(f => { const x = JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')) as { gameId: string; arm: string; rec: GameRec }; return { gameId: x.gameId, arm: x.arm, seed: x.rec.seed, rec: x.rec, policies: { human: x.arm, ai: x.arm } }; });
  const arm = (a: string) => all.filter(g => g.arm === a);
  const metrics: Record<string, (xs: Game[]) => number | null> = { turn_limit_rate: RATE.turn_limit_rate, mean_turns: RATE.mean_turns, first_mover_win_rate: RATE.first_mover_win_rate, moves_per_turn: MOVE_RATE, zero_move_turn_share: ZERO_MOVE_TURNS, unused_actions_per_game: UNUSED, pieces_scored_by_turn20: SCORED_BY_20, lead_changes: RATE.lead_changes };
  const perArm = Object.fromEntries(Object.keys(ARM_DEF).map(a => {
    const xs = arm(a), tl = xs.filter(g => g.rec.turnLimit).length, rows = xs.flatMap(g => teleportForesight([g.rec]).rows), adv = rows.map(r => r.realized - r.expected);
    const b = xorshift(69009), boots: number[] = []; for (let i = 0; i < 2000 && rows.length; i++) boots.push(mean(rows.map(() => adv[Math.floor(b() * rows.length)])));
    return [a, { label: ARM_DEF[a].label, games: xs.length, turnLimit: { k: tl, n: xs.length, wilson95: wilson(tl, xs.length) }, ...Object.fromEntries(Object.entries(metrics).map(([m, f]) => [m, seedBlocked(xs, f)])), medianTurns: [...xs.map(g => g.rec.turns)].sort((x, y) => x - y)[Math.floor((xs.length - 1) / 2)], draws: xs.filter(g => g.rec.winner === 'draw').length, integrity: { illegal: xs.reduce((s, g) => s + g.rec.illegal.length, 0), errors: xs.reduce((s, g) => s + g.rec.errors.length, 0) }, foresight: { moves: rows.length, advantage: r3(mean(adv)), ci95: rows.length ? [r3(quant(boots, 0.025)), r3(quant(boots, 0.975))] : null } }];
  }));
  const vsK1 = Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'K11'].map(a => [a, Object.fromEntries(Object.entries(metrics).map(([m, f]) => [m, pairedSeedDiff(arm(a), arm('K1'), f)]))]));
  const vsK11 = Object.fromEntries(['K1', 'C1', 'C2', 'C3', 'C4'].map(a => [a, Object.fromEntries(['turn_limit_rate', 'mean_turns', 'moves_per_turn'].map(m => [m, pairedSeedDiff(arm(a), arm('K11'), metrics[m])]))]));
  const causes = Object.entries(vsK1).filter(([a]) => a !== 'K11').map(([a, v]) => ({ arm: a, turnLimitUp: (v.turn_limit_rate.ci95?.[0] ?? -1) > 0, meanTurnsUp: (v.mean_turns.ci95?.[0] ?? -1) > 0 }));
  const out = { schema: 'rule-sabotage/v51-ablation-evaluation@1', dir: relative(ROOT, dir).replace(/\\/g, '/'), replayOk: JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')).ok, perArm, vsK1, vsK11, candidateCauses: causes.filter(c => c.turnLimitUp || c.meanTurnsUp).map(c => c.arm), rule: 'exploratory: a single correction is a CANDIDATE CAUSE if its paired seed-blocked 95% interval for turn-limit rate or mean turns versus K1 lies above 0. Interactions are unresolved (no pairwise arms).', scope: 'self-play of this planner family only' };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  return out;
}

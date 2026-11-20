/**
 * V5 policy-diversity experiment (balance/v5/protocol.json): preregistration with implementation hashes, exactly 300
 * offline games run once (V3 offline worker pool: network guard, engine replay of every game), preregistered evaluation.
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
import { r3, mean, quant, xorshift } from '../v3/stats.ts';
import { appendJournal, readJournal, verifyJournal } from '../journal.ts';
import { listFiles } from '../v4/pilot.ts';
import { type PolicyId } from './policies.ts';
import { describeArm, pairedSeedDiff, crossPlay, patternSurvives, RATE, seedBlocked, type Game } from './metrics.ts';

export const PROTOCOL = join(ROOT, 'balance/v5/protocol.json');
export const JOURNAL = join(ROOT, 'balance/v5/journal.ndjson');
export const PREFLIGHT = join(ROOT, 'evidence/balance/v5/preflight.json');
const protoSha = () => sha256(readFileSync(PROTOCOL, 'utf8').replace(/\r\n/g, '\n'));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
export const V5_FILES = ['server/balance/v4/evplanner.ts', 'server/balance/v5/evk11.ts', 'server/balance/v5/policies.ts', 'server/balance/v5/metrics.ts', 'server/balance/v5/run.ts'];
export const implementationHashes = () => ({ engine: filesHash(ENGINE_FILES), plannerFiles: filesHash(PLANNER_FILES), v5: filesHash(V5_FILES), all: filesHash([...ENGINE_FILES, ...PLANNER_FILES, ...V5_FILES]) });

const SELF: [string, PolicyId][] = [['S-REF', 'ev-k1.1'], ['S-OA', 'oa-v2'], ['S-SM', 'softmax-v2']];
const CROSS: [string, PolicyId, PolicyId][] = [['X-REF-OA', 'ev-k1.1', 'oa-v2'], ['X-REF-SM', 'ev-k1.1', 'softmax-v2'], ['X-OA-SM', 'oa-v2', 'softmax-v2']];
export type V5Job = BatchJob & { arm: string; policies: Record<Player, PolicyId> };
export function v5Jobs(selfSeeds = range(68001, 68030), crossSeeds = range(68031, 68040)): V5Job[] {
  const w = loadWeights(), W = { human: w as never, ai: w as never };
  const job = (arm: string, seed: number, first: Player, pol: Record<Player, PolicyId>, id: string): V5Job => ({ gameId: id, condition: arm, arm, seed, first, weights: W, detail: true, policy: pol, policies: pol });
  return [
    ...SELF.flatMap(([arm, p]) => selfSeeds.flatMap(seed => PLAYERS.map(first => job(arm, seed, first, { human: p, ai: p }, `${arm}-${seed}-${first}`)))),
    ...CROSS.flatMap(([arm, a, b]) => crossSeeds.flatMap(seed => [[a, b], [b, a]].flatMap(([h, x]) => PLAYERS.map(first => job(arm, seed, first, { human: h as PolicyId, ai: x as PolicyId }, `${arm}-${seed}-${first}-H${h}`))))),
  ];
}

export function preregister() {
  if (readJournal(JOURNAL).some(e => e.type === 'v5-preregistered')) throw new Error('already preregistered');
  const dirty = git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']);
  if (dirty) throw new Error(`commit first:\n${dirty}`);
  const pre = JSON.parse(readFileSync(PREFLIGHT, 'utf8'));
  return appendJournal(JOURNAL, 'v5-preregistered', 'V5-POLICY-DIVERSITY-300', null, { protocol: 'balance/v5/protocol.json', protocolSha256: protoSha(), implementation: implementationHashes(), commit: git(['rev-parse', 'HEAD']), preflightSha256: sha256(readFileSync(PREFLIGHT)), preflightHashes: pre.hashes, games: v5Jobs().length, assignments: v5Jobs().map(j => j.gameId), note: 'frozen before any V5 game' });
}

export async function runV5(o: { workers?: number; log?: (s: string) => void } = {}) {
  const log = o.log ?? console.log;
  if (!verifyJournal(JOURNAL).ok) throw new Error('journal fails verification');
  const pre = readJournal(JOURNAL).find(e => e.type === 'v5-preregistered'); if (!pre) throw new Error('not preregistered');
  const d = pre.data as { protocolSha256: string; implementation: ReturnType<typeof implementationHashes> };
  if (d.protocolSha256 !== protoSha()) throw new Error('protocol changed after preregistration');
  if (JSON.stringify(d.implementation) !== JSON.stringify(implementationHashes())) throw new Error(`implementation changed after preregistration ${JSON.stringify(implementationHashes())}`);
  if (readJournal(JOURNAL).some(e => e.type === 'v5-start')) throw new Error('the V5 experiment was already started once');
  const jobs = v5Jobs(); if (jobs.length !== 300) throw new Error(`${jobs.length} games`);
  if (!offlineImportCheck().pass) throw new Error('offline import check failed');
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z-v5';
  const dir = join(ROOT, 'evidence/balance/v5', runId); mkdirSync(join(dir, 'games'), { recursive: true });
  const env = { implementation: implementationHashes(), protocolSha256: protoSha(), commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']) !== '', node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism() };
  appendJournal(JOURNAL, 'v5-start', runId, null, { games: jobs.length, ...env });
  log(`V5 ${runId}: ${jobs.length} games, commit ${env.commit.slice(0, 8)}${env.dirty ? ' (dirty)' : ''}`);
  const t0 = Date.now();
  const res = await runBatch(jobs, { workers: o.workers ?? Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))), maxMs: 1_800_000, onGame: (k, n, r, j) => { if (k % 10 === 0 || k === n) log(`  ${k}/${n} ${j.gameId} ${r.winner} t${r.turns} ${Math.round(r.ms / 1000)}s`); } });
  const wallMs = Date.now() - t0;
  for (let i = 0; i < jobs.length; i++) writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v5-game@1', gameId: jobs[i].gameId, arm: jobs[i].arm, policies: jobs[i].policies, rec: res.recs[i] }));
  writeFileSync(join(dir, 'games.ndjson'), res.recs.map((r, i) => JSON.stringify({ ...summaryRow(r, jobs[i]), arm: jobs[i].arm, policies: jobs[i].policies })).join('\n') + '\n');
  const replays = res.recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ ok: replays.every(r => r.ok), games: replays.length, failures: replays.filter(r => !r.ok) }, null, 2));
  const run = { schema: 'rule-sabotage/v5-run@1', runId, games: jobs.length, wallMs, cpuMs: res.cpuMs.reduce((a, b) => a + b, 0), guard: res.guard, externalCalls: res.guard.attempts, kaneCalls: 0, datasetHash: hashOf(res.recs.map(r => r.detail!.finalHash)), replayOk: replays.every(r => r.ok), ...env };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(Object.fromEntries(listFiles(dir).filter(f => f !== 'manifest.json').map(f => [f, sha256(readFileSync(join(dir, f)))])), null, 2));
  appendJournal(JOURNAL, 'v5-complete', runId, null, { dir: relative(ROOT, dir).replace(/\\/g, '/'), datasetHash: run.datasetHash, games: jobs.length, replayOk: run.replayOk, externalCalls: run.externalCalls, wallMs, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) });
  log(`done in ${(wallMs / 60000).toFixed(1)} min: replay ${run.replayOk ? 'OK' : 'FAILED'}, external calls ${run.externalCalls}, dataset ${run.datasetHash}`);
  return { dir, run };
}

// ---------------------------------------------------------------- evaluation
function load(dir: string): Game[] {
  return readdirSync(join(dir, 'games')).sort().map(f => { const x = JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')) as { gameId: string; arm: string; policies: Record<Player, string>; rec: GameRec }; return { gameId: x.gameId, arm: x.arm, seed: x.rec.seed, rec: x.rec, policies: x.policies }; });
}
/** Planner/executor agreement in the real games: executed moves up to the first teleport equal the plan's committed moves. */
function agreement(xs: Game[]) {
  let turns = 0, agree = 0;
  for (const g of xs) for (const t of g.rec.detail!.turns) { if (!t.plannedMoves) continue; turns++; const tp = t.moves.findIndex(m => m.events.some(e => e.t === 'forced' && (e as { how: string }).how === 'teleport')); const exec = t.moves.slice(0, tp >= 0 ? tp + 1 : t.moves.length).map(m => m.from + m.dir + m.mode), plan = t.plannedMoves.map(m => m.from + m.dir + m.mode); if (JSON.stringify(exec.slice(0, plan.length)) === JSON.stringify(plan) && (tp >= 0 || exec.length === plan.length)) agree++; }
  return { turns, agree, rate: turns ? r3(agree / turns) : null };
}
function foresight(xs: Game[]) {
  const rows = xs.flatMap(g => teleportForesight([g.rec]).rows), adv = rows.map(r => r.realized - r.expected), b = xorshift(68003), boots: number[] = [];
  for (let i = 0; i < 2000 && rows.length; i++) boots.push(mean(rows.map(() => adv[Math.floor(b() * rows.length)])));
  return { moves: rows.length, advantage: r3(mean(adv)), ci95: rows.length ? [r3(quant(boots, 0.025)), r3(quant(boots, 0.975))] : null };
}
export function evaluateV5(dir: string) {
  const all = load(dir), arm = (id: string) => all.filter(g => g.arm === id);
  const replayOk = JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')).ok as boolean;
  const pre = JSON.parse(readFileSync(PREFLIGHT, 'utf8')) as { distinctVsReference: Record<string, { plans: number }> };
  const arms = Object.fromEntries([...SELF.map(x => x[0]), ...CROSS.map(x => x[0])].map(a => [a, { ...describeArm(arm(a)), planExecutionAgreement: agreement(arm(a)), foresight: foresight(arm(a)) }]));
  const pol = Object.fromEntries(SELF.map(([a, p]) => [p, a]));
  const dependence = Object.fromEntries(['first_mover_win_rate', 'human_side_win_rate', 'mean_turns', 'turn_limit_rate', 'lead_changes', 'turn2_captures'].map(m => [m, Object.fromEntries([['oa-v2', 'ev-k1.1'], ['softmax-v2', 'ev-k1.1'], ['oa-v2', 'softmax-v2']].map(([x, y]) => [`${x} - ${y}`, pairedSeedDiff(arm(pol[x]), arm(pol[y]), RATE[m])]))]));
  const cross = Object.fromEntries(CROSS.map(([a, x, y]) => [a, crossPlay(arm(a), x, y)]));
  const eligible = (p: string) => { const a = arms[pol[p]] as ReturnType<typeof describeArm> & { planExecutionAgreement: { rate: number | null } }; return replayOk && a.integrity.errors + a.integrity.illegal + a.integrity.softlocks === 0 && (a.planExecutionAgreement.rate ?? 0) === 1 && (p === 'ev-k1.1' || (pre.distinctVsReference[p]?.plans ?? 0) > 0); };
  const edge = (p: string, m: 'first_mover_win_rate' | 'human_side_win_rate') => { const sb = seedBlocked(arm(pol[p]), xs => { const v = RATE[m](xs); return v === null ? null : v - 0.5; }); return { eligible: eligible(p), ci95: sb.ci95, edge: sb.value }; };
  const robust = Object.fromEntries((['first_mover_win_rate', 'human_side_win_rate'] as const).map(m => { const per = Object.fromEntries(SELF.map(([, p]) => [p, edge(p, m)])); return [m, { perPolicy: per, verdict: patternSurvives(per) }]; }));
  const longGames = { perPolicy: Object.fromEntries(SELF.map(([a, p]) => [p, (arms[a] as ReturnType<typeof describeArm>).length.turnLimit])), rule: 'reported; a long-game pattern is robust only if every eligible policy has a turn-limit rate whose seed-blocked lower bound >= 0.10' };
  const out = { schema: 'rule-sabotage/v5-evaluation@1', dir: relative(ROOT, dir).replace(/\\/g, '/'), protocolSha256: protoSha(), replayOk, arms, policyDependence: dependence, crossPlay: cross, ruleRobustness: robust, longGames, eligibility: Object.fromEntries(SELF.map(([, p]) => [p, eligible(p)])), scope: 'Engine-based self-play with three policies. Robustness across these policies is not a proof about the rules and says nothing about human players.' };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  return out;
}

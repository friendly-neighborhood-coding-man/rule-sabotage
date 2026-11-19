/**
 * Balance Designer V4: the preregistered 180-game pilot (balance/v4/pilot-protocol.json), run once, and its
 * evaluation. Uses the V3 offline worker pool (network guard, 0 external calls) and the V3 replay checker.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, platform, release } from 'node:os';
import { type Player, PLAYERS } from '../../rules.ts';
import { loadWeights } from '../../weights.ts';
import { type GameRec } from '../selfplay.ts';
import { ROOT, runBatch, summaryRow, replayDetail, offlineImportCheck, hashOf, sha256, filesHash, ENGINE_FILES, PLANNER_FILES, type BatchJob } from '../v3/batch.ts';
import { derive, type Game } from '../v3/analysis.ts';
import { METRIC_FNS, pairedDiff, teleportForesight } from '../v3/evaluate.ts';
import { wilson, r3, mean, quant, xorshift } from '../v3/stats.ts';
import { appendJournal, readJournal, verifyJournal } from '../journal.ts';
import { EV_PLANNER_ID, EV_PLANNER_FILE, evPlannerHash, REPLY_STRATA } from './evplanner.ts';

export const PROTOCOL_FILE = join(ROOT, 'balance/v4/pilot-protocol.json');
export const V4_JOURNAL = join(ROOT, 'balance/v4/journal.ndjson');
export const protocolSha = () => sha256(readFileSync(PROTOCOL_FILE, 'utf8').replace(/\r\n/g, '\n'));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };

export type PilotJob = BatchJob & { arm: string; evSide: Player | 'both' | null };
export function pilotJobs(seedsAB = range(64001, 64030), seedsC = range(64001, 64015)): PilotJob[] {
  const w = loadWeights();
  const W = { human: w as never, ai: w as never };
  const base = (arm: string, seed: number, first: Player, planner: PilotJob['planner'], evSide: PilotJob['evSide'], id: string): PilotJob => ({ gameId: id, condition: arm, arm, seed, first, weights: W, detail: true, ...(planner ? { planner } : {}), evSide });
  return [
    ...seedsAB.flatMap(s => PLAYERS.map(f => base('A', s, f, undefined, null, `A-${s}-${f}`))),
    ...seedsAB.flatMap(s => PLAYERS.map(f => base('B', s, f, { human: 'ev-v4', ai: 'ev-v4' }, 'both', `B-${s}-${f}`))),
    ...seedsC.flatMap(s => PLAYERS.flatMap(ev => PLAYERS.map(f => base('C', s, f, { [ev]: 'ev-v4' } as PilotJob['planner'], ev, `C-${s}-${f}-ev${ev}`)))),
  ];
}

export async function runPilot(o: { smoke?: { seedsAB: number[]; seedsC: number[]; dir: string }; workers?: number; log?: (s: string) => void } = {}) {
  const log = o.log ?? console.log;
  const smoke = !!o.smoke;
  const journal = readJournal(V4_JOURNAL);
  if (!smoke) {
    if (!verifyJournal(V4_JOURNAL).ok) throw new Error('V4 journal fails verification');
    const pre = journal.find(e => e.type === 'pilot-preregistered');
    if (!pre) throw new Error('the pilot protocol is not preregistered in the journal');
    if ((pre.data as { protocolSha256: string }).protocolSha256 !== protocolSha()) throw new Error('pilot protocol changed after preregistration');
    if (journal.some(e => e.type === 'pilot-start')) throw new Error('the pilot was already started once (journal); it is run exactly once');
  }
  const jobs = smoke ? pilotJobs(o.smoke!.seedsAB, o.smoke!.seedsC) : pilotJobs();
  if (!smoke && jobs.length !== 180) throw new Error(`pilot defines ${jobs.length} games, protocol says 180`);
  const off = offlineImportCheck();
  if (!off.pass) throw new Error(`offline import check failed: ${off.forbidden.join(', ')}`);
  const runId = smoke ? `smoke-${Date.now()}` : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z-v4-pilot';
  const dir = smoke ? o.smoke!.dir : join(ROOT, 'evidence/balance/v4/pilot', runId);
  mkdirSync(join(dir, 'games'), { recursive: true });
  const commit = git(['rev-parse', 'HEAD']), dirty = git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']) !== '';
  const env = { engineFilesHash: filesHash(ENGINE_FILES), plannerFilesHash: filesHash(PLANNER_FILES), evPlanner: { id: EV_PLANNER_ID, file: EV_PLANNER_FILE, hash: evPlannerHash(), replyStrata: REPLY_STRATA }, protocolSha256: protocolSha(), weights: { version: loadWeights().version }, commit, dirty, node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism() };
  if (!smoke) appendJournal(V4_JOURNAL, 'pilot-start', runId, null, { games: jobs.length, seeds: '64001-64030 (A,B), 64001-64015 (C)', ...env });
  log(`${smoke ? 'SMOKE' : 'PILOT'} ${runId}: ${jobs.length} games, commit ${commit.slice(0, 8)}${dirty ? ' (dirty)' : ''}, EV ${env.evPlanner.hash}`);
  const t0 = Date.now();
  const workers = o.workers ?? Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2)));
  const res = await runBatch(jobs, { workers, maxMs: 900_000, onGame: (d, n, r, j) => { if (d % 10 === 0 || d === n) log(`  ${d}/${n} ${j.gameId} ${r.winner} t${r.turns} ${Math.round(r.ms / 1000)}s`); } });
  const wallMs = Date.now() - t0;
  const rows = res.recs.map((r, i) => ({ ...summaryRow(r, jobs[i]), arm: jobs[i].arm, evSide: jobs[i].evSide }));
  for (let i = 0; i < jobs.length; i++) writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v4-game@1', gameId: jobs[i].gameId, arm: jobs[i].arm, evSide: jobs[i].evSide, rec: res.recs[i] }));
  writeFileSync(join(dir, 'games.ndjson'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const replays = res.recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ ok: replays.every(r => r.ok), games: replays.length, failures: replays.filter(r => !r.ok) }, null, 2));
  const datasetHash = hashOf(res.recs.map(r => r.detail!.finalHash));
  const run = { schema: 'rule-sabotage/v4-pilot-run@1', runId, smoke, games: jobs.length, wallMs, cpuMs: res.cpuMs.reduce((a, b) => a + b, 0), workers, guard: res.guard, externalCalls: res.guard.attempts, kaneCalls: 0, datasetHash, replayOk: replays.every(r => r.ok), ...env };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  const manifest = Object.fromEntries(listFiles(dir).filter(f => f !== 'manifest.json').map(f => [f, sha256(readFileSync(join(dir, f)))]));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (!smoke) appendJournal(V4_JOURNAL, 'pilot-complete', runId, null, { dir: relative(ROOT, dir).replace(/\\/g, '/'), datasetHash, games: jobs.length, replayOk: run.replayOk, externalCalls: run.externalCalls, wallMs, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) });
  log(`done in ${(wallMs / 60000).toFixed(1)} min: replay ${run.replayOk ? 'OK' : 'FAILED'}, external calls ${run.externalCalls}, dataset ${datasetHash}`);
  return { dir, run };
}
function listFiles(dir: string, base = ''): string[] { return readdirSync(join(dir, base), { withFileTypes: true }).flatMap(d => d.isDirectory() ? listFiles(dir, join(base, d.name)) : [join(base, d.name).replace(/\\/g, '/')]); }

// ---------------------------------------------------------------- evaluation
type G = { g: Game; d: ReturnType<typeof derive>; arm: string; evSide: Player | 'both' | null };
export function loadPilot(dir: string): G[] {
  return readdirSync(join(dir, 'games')).sort().map(f => {
    const x = JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')) as { gameId: string; arm: string; evSide: G['evSide']; rec: GameRec };
    const row = summaryRow(x.rec, { gameId: x.gameId, condition: x.arm });
    const g = { row, rec: x.rec };
    return { g, d: derive(g), arm: x.arm, evSide: x.evSide };
  });
}
function foresight(xs: G[], side: (x: G) => Player | 'both' | null) {
  const rows = xs.flatMap(x => { const s = side(x); return teleportForesight([x.g.rec]).rows.filter(r => s === 'both' || r.p === s); });
  const adv = rows.map(r => r.realized - r.expected), b = xorshift(4243), boots: number[] = [];
  for (let i = 0; i < 2000 && rows.length; i++) boots.push(mean(rows.map(() => adv[Math.floor(b() * rows.length)])));
  return { moves: rows.length, realizedMean: r3(mean(rows.map(r => r.realized))), blindExpectedMean: r3(mean(rows.map(r => r.expected))), advantageMean: r3(mean(adv)), ci95: rows.length ? [r3(quant(boots, 0.025)), r3(quant(boots, 0.975))] as [number, number] : null, meanPercentile: r3(mean(rows.map(r => r.pctile))), turn1Moves: rows.filter(r => r.turn === 1).length };
}
const describe = (xs: G[]) => {
  const n = xs.length, dec = xs.filter(x => x.d.winner !== 'draw');
  const tpPl = xs.map(x => x.g.rec.placements.filter(p => p.effect === 'teleport').length), tpTr = xs.map(x => x.g.rec.triggers.filter(t => t.kind === 'teleport').length);
  const sorted = xs.map(x => x.d.turns).sort((a, b) => a - b);
  const fm = dec.filter(x => x.d.winnerRole === 'first').length;
  return {
    games: n, decisive: dec.length, draws: n - dec.length,
    firstMover: { k: fm, n: dec.length, rate: dec.length ? r3(fm / dec.length) : null, ci95: wilson(fm, dec.length) },
    humanSide: { k: dec.filter(x => x.d.winner === 'human').length, n: dec.length, ci95: wilson(dec.filter(x => x.d.winner === 'human').length, dec.length) },
    ...Object.fromEntries(Object.keys(METRIC_FNS).map(m => { const v = METRIC_FNS[m](xs); return [m, v === null ? null : r3(v)]; })),
    median_turns: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
    teleportPlacementsPerGame: r3(mean(tpPl)), teleportTriggersPerGame: r3(mean(tpTr)),
    distinctOpenings: new Set(xs.flatMap(x => PLAYERS.map(p => x.g.rec.signature[p]))).size,
    replansPerGame: r3(mean(xs.map(x => x.g.rec.replans ?? 0))),
    safety: { illegal: xs.reduce((a, x) => a + x.d.safety.illegal, 0), errors: xs.reduce((a, x) => a + x.d.safety.errors, 0), softlocks: xs.filter(x => x.d.safety.softlock).length },
    cpuSecondsPerGame: r3(mean(xs.map(x => x.g.rec.ms / 1000))),
  };
};
function edgeDiff(B: G[], A: G[], iters = 5000, seed = 64000) {
  const f = (xs: G[]) => { const v = METRIC_FNS.first_mover_win_rate(xs); return v === null ? null : Math.abs(v - 0.5); };
  const seeds = [...new Set(A.map(x => x.d.seed))].sort((a, b) => a - b);
  const rnd = xorshift(seed), ds: number[] = [];
  for (let i = 0; i < iters; i++) { const pick = seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]); const b = f(pick.flatMap(s => B.filter(x => x.d.seed === s))), a = f(pick.flatMap(s => A.filter(x => x.d.seed === s))); if (a !== null && b !== null) ds.push(b - a); }
  const b0 = f(B), a0 = f(A);
  return { treated: b0 === null ? null : r3(b0), control: a0 === null ? null : r3(a0), diff: b0 === null || a0 === null ? null : r3(b0 - a0), ci95: [r3(quant(ds, 0.025)), r3(quant(ds, 0.975))] as [number, number] };
}
const band = (ci: [number, number] | null, pass: (c: [number, number]) => boolean, fail: (c: [number, number]) => boolean) => (!ci ? 'INCONCLUSIVE' : pass(ci) ? 'PASS' : fail(ci) ? 'FAIL' : 'INCONCLUSIVE');

export function evaluatePilot(dir: string, unitTestsPassed: boolean) {
  const all = loadPilot(dir);
  const arm = (id: string) => all.filter(x => x.arm === id);
  const A = arm('A'), B = arm('B'), C = arm('C');
  const desc = { A: describe(A), B: describe(B), C: describe(C) };
  const d = (m: string) => pairedDiff(m, B.map(x => ({ g: x.g, d: x.d })), A.map(x => ({ g: x.g, d: x.d })), 5000, 64000);
  const diffs = Object.fromEntries(['mean_turns', 'turn_limit_rate', 'first_mover_win_rate', 'human_side_win_rate', 'turn1_score_rate', 'conveyor_per_game', 'self_trigger_share', 'effect_entropy', 'lead_changes', 'comeback_rate'].map(m => [m, d(m)]));
  const edge = edgeDiff(B, A);
  const fs = { A: foresight(A, () => 'both'), B: foresight(B, () => 'both'), C_ev: foresight(C, x => x.evSide), C_prod: foresight(C, x => (x.evSide === 'human' || x.evSide === 'ai' ? other(x.evSide) : 'both')) };
  const infoRule = (f: ReturnType<typeof foresight>) => (!f.ci95 ? 'INCONCLUSIVE' : f.ci95[0] <= 0 && f.ci95[1] >= 0 && Math.abs(f.advantageMean) < 0.3 ? 'PASS' : f.ci95[0] > 0 ? 'FAIL' : 'INCONCLUSIVE');
  const I = { I1: unitTestsPassed ? 'PASS' : 'FAIL', I2: infoRule(fs.B), I3: infoRule(fs.C_ev), I4: fs.A.ci95 && fs.A.ci95[0] > 0 ? 'HOLDS' : 'DOES_NOT_HOLD' };
  const aTurns = desc.A.mean_turns as number;
  const ci = (m: string) => diffs[m].ci95 as [number, number] | null;
  const Gt = {
    G1: band(ci('mean_turns'), c => c[1] <= 0.25 * aTurns, c => c[0] > 0.25 * aTurns),
    G2: band(ci('turn_limit_rate'), c => c[1] <= 0.10, c => c[0] > 0.10),
    G3: band(edge.ci95, c => c[1] <= 0.05, c => c[0] > 0.05),
    G4: band(ci('effect_entropy'), c => c[0] >= -0.10, c => c[1] < -0.10),
    G5: band(ci('comeback_rate'), c => c[0] >= -0.10, c => c[1] < -0.10),
    G6: desc.A.safety.illegal + desc.A.safety.errors + desc.A.safety.softlocks + desc.B.safety.illegal + desc.B.safety.errors + desc.B.safety.softlocks + desc.C.safety.illegal + desc.C.safety.errors + desc.C.safety.softlocks === 0 && JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')).ok ? 'PASS' : 'FAIL',
  };
  const cDec = C.filter(x => x.d.winner !== 'draw'), evWins = cDec.filter(x => x.d.winner === x.evSide).length, sCi = wilson(evWins, cDec.length);
  const byRole = Object.fromEntries(PLAYERS.map(p => { const xs = cDec.filter(x => x.evSide === p); const k = xs.filter(x => x.d.winner === p).length; return [`evAs_${p}`, { k, n: xs.length, rate: xs.length ? r3(k / xs.length) : null, ci95: wilson(k, xs.length) }]; }));
  const byFirst = Object.fromEntries(['evFirst', 'evSecond'].map(k => { const xs = cDec.filter(x => (x.d.first === x.evSide) === (k === 'evFirst')); const w = xs.filter(x => x.d.winner === x.evSide).length; return [k, { k: w, n: xs.length, rate: xs.length ? r3(w / xs.length) : null, ci95: wilson(w, xs.length) }]; }));
  const S1 = sCi[0] <= 0.5 && sCi[1] >= 0.5 ? 'no detectable loss' : sCi[1] < 0.35 ? 'substantially weaker' : sCi[0] > 0.5 ? 'stronger' : 'weaker';
  const informationFairness = I.I1 === 'PASS' && I.I2 === 'PASS' && I.I3 === 'PASS' && I.I4 === 'HOLDS' ? 'PASS' : I.I2 === 'FAIL' || I.I3 === 'FAIL' ? 'FAIL' : 'PARTIAL';
  const g = Object.values(Gt);
  const gameplayAdequacy = g.includes('FAIL') ? 'REGRESSION' : g.every(x => x === 'PASS') && S1 !== 'substantially weaker' ? 'SUFFICIENT (pilot only)' : g.every(x => x === 'PASS') ? 'PARTIAL' : 'INCONCLUSIVE';
  const out = { schema: 'rule-sabotage/v4-pilot-evaluation@1', dir: relative(ROOT, dir).replace(/\\/g, '/'), protocolSha256: protocolSha(), describe: desc, bMinusA: { ...diffs, abs_first_mover_edge: edge }, foresight: fs, strength: { evDecisiveWins: evWins, decisive: cDec.length, rate: cDec.length ? r3(evWins / cDec.length) : null, ci95: sCi, verdict: S1, ...byRole, ...byFirst, draws: C.length - cDec.length }, gates: { ...I, ...Gt, S1 }, verdicts: { informationFairness, gameplayAdequacy } };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  return out;
}
export { existsSync };

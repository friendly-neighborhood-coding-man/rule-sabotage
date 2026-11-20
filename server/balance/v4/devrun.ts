/**
 * V4.2: the frozen 300-game development experiment (balance/v4/v42-dev-protocol.json): preregistration with
 * implementation hashes, run once, preregistered evaluation. Offline worker pool (V3 guard), engine replay of every game.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, platform, release } from 'node:os';
import { type Player, PLAYERS } from '../../rules.ts';
import { loadWeights } from '../../weights.ts';
import { type GameRec } from '../selfplay.ts';
import { ROOT, runBatch, summaryRow, replayDetail, offlineImportCheck, hashOf, sha256, filesHash, ENGINE_FILES, PLANNER_FILES, type BatchJob } from '../v3/batch.ts';
import { derive } from '../v3/analysis.ts';
import { METRIC_FNS, pairedDiff, judge } from '../v3/evaluate.ts';
import { wilson, r3, mean, quant, xorshift } from '../v3/stats.ts';
import { appendJournal, readJournal, verifyJournal } from '../journal.ts';
import { evPlannerHash, type EVVariant } from './evplanner.ts';
import { describe, foresight, band, listFiles, type G } from './pilot.ts';
import { V4_JOURNAL } from './pilot.ts';

export const DEV_PROTOCOL = join(ROOT, 'balance/v4/v42-dev-protocol.json');
const protoSha = () => sha256(readFileSync(DEV_PROTOCOL, 'utf8').replace(/\r\n/g, '\n'));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
/** Every source file whose content can change a game of this experiment. */
export const FROZEN_FILES = [...ENGINE_FILES, ...PLANNER_FILES, 'server/balance/v4/evplanner.ts'];
export const implementationHashes = () => ({ engine: filesHash(ENGINE_FILES), planner: filesHash(PLANNER_FILES), evPlanner: evPlannerHash(), all: filesHash(FROZEN_FILES) });

const VARIANTS: Record<string, EVVariant> = { E0: {}, K1: { sideRelativeOrder: true }, K2: { placementAwareReply: true }, K3: { truncatedCandidates: true } };
export type DevJob = BatchJob & { arm: string; k1Side: Player | null };
export function devJobs(selfSeeds = range(66001, 66030), h2hSeeds = range(66001, 66015)): DevJob[] {
  const w = loadWeights(), W = { human: w as never, ai: w as never };
  const ev = { human: 'ev-v4' as const, ai: 'ev-v4' as const };
  const self = Object.keys(VARIANTS).flatMap(arm => selfSeeds.flatMap(seed => PLAYERS.map(first => ({ gameId: `${arm}-${seed}-${first}`, condition: arm, arm, seed, first, weights: W, detail: true, planner: ev, evVariant: { human: VARIANTS[arm], ai: VARIANTS[arm] }, k1Side: null }))));
  const h2h = h2hSeeds.flatMap(seed => PLAYERS.flatMap(k1 => PLAYERS.map(first => ({ gameId: `H1-${seed}-${first}-k1${k1}`, condition: 'H1', arm: 'H1', seed, first, weights: W, detail: true, planner: ev, evVariant: { [k1]: VARIANTS.K1, [k1 === 'human' ? 'ai' : 'human']: {} } as DevJob['evVariant'], k1Side: k1 }))));
  return [...self, ...h2h];
}

export function preregisterDev(manipulationFile: string) {
  const j = readJournal(V4_JOURNAL);
  if (j.some(e => e.type === 'dev-preregistered')) throw new Error('already preregistered');
  const dirty = git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']);
  if (dirty) throw new Error(`commit first: working tree has changes\n${dirty}`);
  return appendJournal(V4_JOURNAL, 'dev-preregistered', 'V4.2-DEV-300', null, { protocol: 'balance/v4/v42-dev-protocol.json', protocolSha256: protoSha(), implementation: implementationHashes(), commit: git(['rev-parse', 'HEAD']), manipulationSha256: sha256(readFileSync(manipulationFile)), games: devJobs().length, note: 'frozen before any game of this experiment' });
}

export async function runDev(o: { smoke?: { dir: string; seeds: number[] }; workers?: number; log?: (s: string) => void } = {}) {
  const log = o.log ?? console.log, smoke = !!o.smoke;
  if (!smoke) {
    if (!verifyJournal(V4_JOURNAL).ok) throw new Error('journal fails verification');
    const pre = readJournal(V4_JOURNAL).find(e => e.type === 'dev-preregistered');
    if (!pre) throw new Error('not preregistered');
    const d = pre.data as { protocolSha256: string; implementation: ReturnType<typeof implementationHashes> };
    if (d.protocolSha256 !== protoSha()) throw new Error('protocol changed after preregistration');
    if (JSON.stringify(d.implementation) !== JSON.stringify(implementationHashes())) throw new Error(`implementation changed after preregistration: ${JSON.stringify(implementationHashes())}`);
    if (readJournal(V4_JOURNAL).some(e => e.type === 'dev-start')) throw new Error('the development experiment was already started once');
  }
  const jobs = smoke ? devJobs(o.smoke!.seeds, o.smoke!.seeds) : devJobs();
  if (!smoke && jobs.length !== 300) throw new Error(`${jobs.length} games defined, protocol says 300`);
  const off = offlineImportCheck(); if (!off.pass) throw new Error('offline import check failed');
  const runId = smoke ? `smoke-${Date.now()}` : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z-v42-dev';
  const dir = smoke ? o.smoke!.dir : join(ROOT, 'evidence/balance/v4/v42', runId);
  mkdirSync(join(dir, 'games'), { recursive: true });
  const env = { implementation: implementationHashes(), protocolSha256: protoSha(), commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']) !== '', node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism() };
  if (!smoke) appendJournal(V4_JOURNAL, 'dev-start', runId, null, { games: jobs.length, ...env });
  log(`${smoke ? 'SMOKE' : 'DEV'} ${runId}: ${jobs.length} games, commit ${env.commit.slice(0, 8)}${env.dirty ? ' (dirty)' : ''}`);
  const t0 = Date.now();
  const res = await runBatch(jobs, { workers: o.workers ?? Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))), maxMs: 1_800_000, onGame: (d, n, r, j) => { if (d % 10 === 0 || d === n) log(`  ${d}/${n} ${j.gameId} ${r.winner} t${r.turns} ${Math.round(r.ms / 1000)}s`); } });
  const wallMs = Date.now() - t0;
  for (let i = 0; i < jobs.length; i++) writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v42-game@1', gameId: jobs[i].gameId, arm: jobs[i].arm, k1Side: jobs[i].k1Side, rec: res.recs[i] }));
  writeFileSync(join(dir, 'games.ndjson'), res.recs.map((r, i) => JSON.stringify({ ...summaryRow(r, jobs[i]), arm: jobs[i].arm, k1Side: jobs[i].k1Side })).join('\n') + '\n');
  const replays = res.recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ ok: replays.every(r => r.ok), games: replays.length, failures: replays.filter(r => !r.ok) }, null, 2));
  const run = { schema: 'rule-sabotage/v42-dev-run@1', runId, smoke, games: jobs.length, wallMs, cpuMs: res.cpuMs.reduce((a, b) => a + b, 0), guard: res.guard, externalCalls: res.guard.attempts, kaneCalls: 0, datasetHash: hashOf(res.recs.map(r => r.detail!.finalHash)), replayOk: replays.every(r => r.ok), ...env };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(Object.fromEntries(listFiles(dir).filter(f => f !== 'manifest.json').map(f => [f, sha256(readFileSync(join(dir, f)))])), null, 2));
  if (!smoke) appendJournal(V4_JOURNAL, 'dev-complete', runId, null, { dir: relative(ROOT, dir).replace(/\\/g, '/'), datasetHash: run.datasetHash, games: jobs.length, replayOk: run.replayOk, externalCalls: run.externalCalls, wallMs, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) });
  log(`done in ${(wallMs / 60000).toFixed(1)} min: replay ${run.replayOk ? 'OK' : 'FAILED'}, external calls ${run.externalCalls}, dataset ${run.datasetHash}`);
  return { dir, run };
}

// ---------------------------------------------------------------- evaluation
type DG = G & { k1Side: Player | null };
function load(dir: string): DG[] {
  return readdirSync(join(dir, 'games')).sort().map(f => {
    const x = JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')) as { gameId: string; arm: string; k1Side: Player | null; rec: GameRec };
    const row = summaryRow(x.rec, { gameId: x.gameId, condition: x.arm }); const g = { row, rec: x.rec };
    return { g, d: derive(g), arm: x.arm, evSide: 'both' as const, k1Side: x.k1Side };
  });
}
const turn2Caps = (x: G) => x.g.rec.detail!.turns[1]?.moves.reduce((a, m) => a + m.events.filter(e => e.t === 'capture').reduce((b, e) => b + (e as { pieces: string[] }).pieces.length, 0), 0) ?? 0;
const EXTRA: Record<string, (xs: G[]) => number | null> = {
  turn2_captures_per_game: xs => (xs.length ? mean(xs.map(turn2Caps)) : null),
  abs_human_side_edge: xs => { const v = METRIC_FNS.human_side_win_rate(xs); return v === null ? null : Math.abs(v - 0.5); },
};
function diff(metric: string, T: G[], C: G[], iters = 5000, seed = 66000) {
  if (METRIC_FNS[metric]) return pairedDiff(metric, T.map(x => ({ g: x.g, d: x.d })), C.map(x => ({ g: x.g, d: x.d })), iters, seed);
  const f = EXTRA[metric], seeds = [...new Set(C.map(x => x.d.seed))].sort((a, b) => a - b), rnd = xorshift(seed), ds: number[] = [];
  for (let i = 0; i < iters; i++) { const pick = seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]); const t = f(pick.flatMap(s => T.filter(x => x.d.seed === s))), c = f(pick.flatMap(s => C.filter(x => x.d.seed === s))); if (t !== null && c !== null) ds.push(t - c); }
  const t0 = f(T), c0 = f(C);
  return { metric, treated: t0 === null ? null : r3(t0), control: c0 === null ? null : r3(c0), diff: t0 === null || c0 === null ? null : r3(t0 - c0), ci95: [r3(quant(ds, 0.025)), r3(quant(ds, 0.975))] as [number, number] };
}
const combine = (st: string[]) => (st.some(s => s === 'contradicted') ? 'REFUTED' : st.every(s => s === 'met') ? 'SUPPORTED' : 'INCONCLUSIVE');

export function evaluateDev(dir: string, manipulation: { K1: { recorded: { mirrorMismatchK1: number }; synthetic: { mirrorMismatchK1: number } }; K2: { recorded: { chosenPlanChanged: number }; synthetic: { chosenPlanChanged: number } } }) {
  const all = load(dir), arm = (id: string) => all.filter(x => x.arm === id);
  const E0 = arm('E0'), H1 = arm('H1');
  const metrics = ['first_mover_win_rate', 'human_side_win_rate', 'abs_human_side_edge', 'turn2_captures_per_game', 'mean_turns', 'turn_limit_rate', 'effect_entropy', 'lead_changes', 'comeback_rate', 'turn1_score_rate', 'conveyor_per_game'];
  const desc = Object.fromEntries(['E0', 'K1', 'K2', 'K3', 'H1'].map(a => [a, { ...describe(arm(a)), turn2_captures_per_game: r3(EXTRA.turn2_captures_per_game(arm(a)) ?? 0), abs_human_side_edge: EXTRA.abs_human_side_edge(arm(a)), holdBackTurnsPerGame: r3(mean(arm(a).map(x => (x.g.rec.holdBackTurns?.human ?? 0) + (x.g.rec.holdBackTurns?.ai ?? 0)))), distinctTurn1Placements: new Set(arm(a).map(x => { const t = x.g.rec.detail!.turns[0]; return t.placement ? `${t.placement.effect}:${t.placement.cells.join(' ')}` : 'none'; })).size }]));
  const vs = Object.fromEntries(['K1', 'K2', 'K3'].map(k => [k, Object.fromEntries(metrics.map(m => [m, diff(m, arm(k), E0)]))]));
  const fs = Object.fromEntries(['E0', 'K1', 'K2', 'K3'].map(a => [a, foresight(arm(a), () => 'both')]));
  const proto = JSON.parse(readFileSync(DEV_PROTOCOL, 'utf8')) as { registeredHypotheses: { id: string; factor: string; predictions: { metric: string; comparison: string; direction: 'increase' | 'decrease'; minEffect: number }[] }[] };
  const manip = {
    K1: manipulation.K1.recorded.mirrorMismatchK1 + manipulation.K1.synthetic.mirrorMismatchK1 === 0 ? 'PASS' : 'FAIL',
    K2: manipulation.K2.recorded.chosenPlanChanged + manipulation.K2.synthetic.chosenPlanChanged > 0 || vs.K2.first_mover_win_rate.diff !== 0 ? 'PASS' : 'FAIL',
    K3: (desc.K3.holdBackTurnsPerGame as number) >= 0.1 ? 'PASS' : 'FAIL',
  } as Record<string, string>;
  const hyp = Object.fromEntries(proto.registeredHypotheses.map(h => {
    const preds = h.predictions.map(p => { const c = vs[h.factor][p.metric]; return { ...p, treated: c.treated, control: c.control, diff: c.diff, ci95: c.ci95, ...judge({ ...p }, c.diff, c.ci95) }; });
    return [h.id, { factor: h.factor, manipulation: manip[h.factor], outcome: manip[h.factor] === 'PASS' ? combine(preds.map(p => p.status)) : 'NOT_INFORMATIVE', predictions: preds }];
  }));
  const infoOk = (f: ReturnType<typeof foresight>) => (!f.ci95 ? 'INCONCLUSIVE' : f.ci95[0] <= 0 && f.ci95[1] >= 0 && Math.abs(f.advantageMean) < 0.3 ? 'PASS' : f.ci95[0] > 0 ? 'FAIL' : 'INCONCLUSIVE');
  const guards = Object.fromEntries(['K1', 'K2', 'K3'].map(k => {
    const ci = (m: string) => vs[k][m].ci95 as [number, number]; const e0Turns = desc.E0.mean_turns as number; const s = desc[k].safety as { illegal: number; errors: number; softlocks: number };
    return [k, { G1: band(ci('mean_turns'), c => c[1] <= 0.25 * e0Turns, c => c[0] > 0.25 * e0Turns), G2: band(ci('turn_limit_rate'), c => c[1] <= 0.1, c => c[0] > 0.1), G4: band(ci('effect_entropy'), c => c[0] >= -0.1, c => c[1] < -0.1), G5: band(ci('comeback_rate'), c => c[0] >= -0.1, c => c[1] < -0.1), G6: s.illegal + s.errors + s.softlocks === 0 && JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')).ok ? 'PASS' : 'FAIL', information: infoOk(fs[k]) }];
  }));
  const fmW = (a: string) => { const d = desc[a].firstMover as { k: number; n: number; ci95: [number, number] }; return d; };
  const crucial = (() => {
    const fixes = ['K2', 'K3', 'K1'].filter(k => manip[k] === 'PASS' && (vs[k].first_mover_win_rate.ci95 as [number, number])[0] > 0 && fmW(k).ci95[0] <= 0.5 && fmW(k).ci95[1] >= 0.5);
    if (fixes.length) return { firstMover: 'PLANNER-DRIVEN (this planner family)', by: fixes };
    const e0Excl = fmW('E0').ci95[1] < 0.5 || fmW('E0').ci95[0] > 0.5;
    if (e0Excl && ['K1', 'K2', 'K3'].every(k => (vs[k].first_mover_win_rate.ci95 as [number, number])[1] < 0.1)) return { firstMover: 'NOT EXPLAINED BY THESE PLANNER FACTORS', by: [] };
    return { firstMover: 'INCONCLUSIVE', by: [] };
  })();
  // Same structure for the Human/AI-side gap with K1: the edge must shrink (interval upper bound < 0) and K1's
  // Human-side interval must contain 0.5; "not explained" if E0's interval excludes 0.5 and K1 cannot shrink it by 0.10.
  const hs = (a: string) => (desc[a].humanSide as { ci95: [number, number] }).ci95, kci = vs.K1.abs_human_side_edge.ci95 as [number, number];
  const sideCrucial = manip.K1 === 'PASS' && kci[1] < 0 && hs('K1')[0] <= 0.5 && hs('K1')[1] >= 0.5 ? 'PLANNER-DRIVEN (tie-breaking), this planner family'
    : (hs('E0')[1] < 0.5 || hs('E0')[0] > 0.5) && kci[0] > -0.1 ? 'NOT EXPLAINED BY K1' : 'INCONCLUSIVE';
  const h1Dec = H1.filter(x => x.d.winner !== 'draw');
  const h1 = Object.fromEntries(PLAYERS.map(p => { const xs = h1Dec.filter(x => x.k1Side === p); const k = xs.filter(x => x.d.winner === p).length; return [`K1as_${p}`, { k, n: xs.length, rate: xs.length ? r3(k / xs.length) : null, ci95: wilson(k, xs.length) }]; }));
  const k1All = h1Dec.filter(x => x.d.winner === x.k1Side).length;
  const out = { schema: 'rule-sabotage/v42-dev-evaluation@1', dir: relative(ROOT, dir).replace(/\\/g, '/'), protocolSha256: protoSha(), describe: desc, kMinusE0: vs, foresight: fs, manipulation: manip, hypotheses: hyp, guards, headToHead: { K1wins: k1All, decisive: h1Dec.length, rate: h1Dec.length ? r3(k1All / h1Dec.length) : null, ci95: wilson(k1All, h1Dec.length), ...h1 }, crucialQuestion: { ...crucial, sideGap: sideCrucial, scope: 'planner-specific: this self-play planner family only; not about human players or other AI strategies' } };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  return out;
}

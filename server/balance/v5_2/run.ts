/** V5.2 2x2 experiment: preregistration, exactly 120 games once, preregistered evaluation. */
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
import { turns as turnViews } from '../v5_1/reanalysis.ts';
import { type Arm } from './planner.ts';

export const PROTOCOL = join(ROOT, 'balance/v5_2/protocol.json');
export const JOURNAL = join(ROOT, 'balance/v5_2/journal.ndjson');
export const AUDIT = join(ROOT, 'evidence/balance/v5_2/audit.json');
const protoSha = () => sha256(readFileSync(PROTOCOL, 'utf8').replace(/\r\n/g, '\n'));
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
export const FILES = ['server/balance/v4/evplanner.ts', 'server/balance/v5/evk11.ts', 'server/balance/v5_1/ablation.ts', 'server/balance/v5_2/stream.ts', 'server/balance/v5_2/planner.ts', 'server/balance/v5_2/run.ts', 'server/balance/v5/metrics.ts'];
export const implementationHashes = () => ({ engine: filesHash(ENGINE_FILES), plannerFiles: filesHash(PLANNER_FILES), v52: filesHash(FILES), all: filesHash([...ENGINE_FILES, ...PLANNER_FILES, ...FILES]) });
export const ARMS: Record<string, Arm> = { A1: { c4: false, stream: 'legacy' }, A2: { c4: true, stream: 'legacy' }, A3: { c4: false, stream: 'mixed' }, A4: { c4: true, stream: 'mixed' } };
const proto = () => JSON.parse(readFileSync(PROTOCOL, 'utf8')) as { seeds: { consecutive: number[]; dispersed: number[] } };
export type J52 = BatchJob & { arm: string; block: 'consecutive' | 'dispersed' };
export function jobs52(): J52[] {
  const w = loadWeights(), W = { human: w as never, ai: w as never }, p = proto();
  const seeds = [...p.seeds.consecutive.map(s => ({ s, block: 'consecutive' as const })), ...p.seeds.dispersed.map(s => ({ s, block: 'dispersed' as const }))];
  return Object.entries(ARMS).flatMap(([arm, a]) => seeds.flatMap(({ s, block }) => PLAYERS.map(first => ({ gameId: `${arm}-${s}-${first}`, condition: arm, arm, block, seed: s, first, weights: W, detail: true, v52: { human: a, ai: a } }))));
}
export function preregister() {
  if (readJournal(JOURNAL).some(e => e.type === 'v52-preregistered')) throw new Error('already preregistered');
  const audit = JSON.parse(readFileSync(AUDIT, 'utf8')); if (!audit.pass) throw new Error('audit did not pass: not preregistering');
  const dirty = git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']); if (dirty) throw new Error(`commit first:\n${dirty}`);
  return appendJournal(JOURNAL, 'v52-preregistered', 'V5.2-C4xMIXING-120', null, { protocol: 'balance/v5_2/protocol.json', protocolSha256: protoSha(), implementation: implementationHashes(), commit: git(['rev-parse', 'HEAD']), auditSha256: sha256(readFileSync(AUDIT)), assignments: jobs52().map(j => j.gameId), note: 'frozen before any V5.2 game' });
}
export async function run52(log: (s: string) => void = console.log) {
  if (!verifyJournal(JOURNAL).ok) throw new Error('journal fails verification');
  const pre = readJournal(JOURNAL).find(e => e.type === 'v52-preregistered'); if (!pre) throw new Error('not preregistered');
  const d = pre.data as { protocolSha256: string; implementation: ReturnType<typeof implementationHashes> };
  if (d.protocolSha256 !== protoSha() || JSON.stringify(d.implementation) !== JSON.stringify(implementationHashes())) throw new Error('protocol or implementation changed after preregistration');
  if (readJournal(JOURNAL).some(e => e.type === 'v52-start')) throw new Error('already started once');
  const jobs = jobs52(); if (jobs.length !== 120) throw new Error(`${jobs.length} games`);
  if (!offlineImportCheck().pass) throw new Error('offline import check failed');
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z-v52', dir = join(ROOT, 'evidence/balance/v5_2', runId);
  mkdirSync(join(dir, 'games'), { recursive: true });
  const env = { implementation: implementationHashes(), protocolSha256: protoSha(), commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']) !== '', node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism() };
  appendJournal(JOURNAL, 'v52-start', runId, null, { games: jobs.length, ...env });
  log(`V5.2 ${runId}: ${jobs.length} games`);
  const t0 = Date.now();
  const res = await runBatch(jobs, { workers: Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))), maxMs: 1_800_000, onGame: (k, n, r, j) => { if (k % 10 === 0 || k === n) log(`  ${k}/${n} ${j.gameId} ${r.winner} t${r.turns} ${Math.round(r.ms / 1000)}s`); } });
  const wallMs = Date.now() - t0;
  for (let i = 0; i < jobs.length; i++) writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v52-game@1', gameId: jobs[i].gameId, arm: jobs[i].arm, block: jobs[i].block, rec: res.recs[i] }));
  writeFileSync(join(dir, 'games.ndjson'), res.recs.map((r, i) => JSON.stringify({ ...summaryRow(r, jobs[i]), arm: jobs[i].arm, block: jobs[i].block })).join('\n') + '\n');
  const replays = res.recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ ok: replays.every(r => r.ok), games: replays.length, failures: replays.filter(r => !r.ok) }, null, 2));
  const run = { schema: 'rule-sabotage/v52-run@1', runId, games: jobs.length, wallMs, externalCalls: res.guard.attempts, kaneCalls: 0, datasetHash: hashOf(res.recs.map(r => r.detail!.finalHash)), replayOk: replays.every(r => r.ok), ...env };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(Object.fromEntries(listFiles(dir).filter(f => f !== 'manifest.json').map(f => [f, sha256(readFileSync(join(dir, f)))])), null, 2));
  appendJournal(JOURNAL, 'v52-complete', runId, null, { dir: relative(ROOT, dir).replace(/\\/g, '/'), datasetHash: run.datasetHash, replayOk: run.replayOk, externalCalls: run.externalCalls, wallMs, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) });
  log(`done in ${(wallMs / 60000).toFixed(1)} min: replay ${run.replayOk ? 'OK' : 'FAILED'}, external calls ${run.externalCalls}`);
  return dir;
}

// ---------------------------------------------------------------- evaluation
type G52 = Game & { block: string };
const sd = (a: number[]) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
function interaction(A: Record<string, G52[]>, f: (xs: Game[]) => number | null, seed = 70009) {
  const seeds = [...new Set(A.A1.map(g => g.seed))], rnd = xorshift(seed), out: number[] = [];
  const by = (xs: G52[]) => new Map(seeds.map(s => [s, xs.filter(g => g.seed === s)]));
  const m = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, by(v)])) as Record<string, Map<number, G52[]>>;
  const val = (pick: number[]) => { const g = (k: string) => f(pick.flatMap(s => m[k].get(s)!)); const a = g('A1'), b = g('A2'), c = g('A3'), d = g('A4'); return a === null || b === null || c === null || d === null ? null : (d - c) - (b - a); };
  const point = val(seeds);
  for (let i = 0; i < 5000; i++) { const v = val(seeds.map(() => seeds[Math.floor(rnd() * seeds.length)])); if (v !== null) out.push(v); }
  return { value: point === null ? null : r3(point), ci95: out.length ? [r3(quant(out, 0.025)), r3(quant(out, 0.975))] as [number, number] : null };
}
const judge = (ci: [number, number] | null, band: number) => (!ci ? 'INCONCLUSIVE' : ci[0] > 0 || ci[1] < 0 ? 'SUPPORTED' : ci[0] >= -band && ci[1] <= band ? 'NOT SUPPORTED' : 'INCONCLUSIVE');
export function evaluate52(dir: string) {
  const all: G52[] = readdirSync(join(dir, 'games')).sort().map(f => { const x = JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')) as { gameId: string; arm: string; block: string; rec: GameRec }; return { gameId: x.gameId, arm: x.arm, block: x.block, seed: x.rec.seed, rec: x.rec, policies: { human: x.arm, ai: x.arm } }; });
  const A = Object.fromEntries(Object.keys(ARMS).map(k => [k, all.filter(g => g.arm === k)])) as Record<string, G52[]>;
  const perArm = Object.fromEntries(Object.entries(A).map(([k, xs]) => {
    const rolls = new Map<number, number[]>(); let nearTurns = 0, nonTop = 0; const t21: string[] = [];
    for (const g of xs) for (const t of g.rec.detail!.turns) { if (t.plannerRoll != null) { (rolls.get(t.turn) ?? rolls.set(t.turn, []).get(t.turn)!).push(t.plannerRoll); } if ((t.nearCount ?? 0) > 1) { nearTurns++; if (t.chosen !== 'p1') nonTop++; if (t.turn === 21) t21.push(t.chosen); } }
    const rollSd = [...rolls.entries()].filter(([, v]) => v.length >= 5).map(([turn, v]) => ({ turn, n: v.length, sd: r3(sd(v)!) }));
    const views = xs.map(g => turnViews({ gameId: g.gameId, arm: g.arm, policies: { human: g.arm, ai: g.arm }, rec: g.rec } as never));
    let turnsChecked = 0, agree = 0;
    for (const v of views) for (const t of v) { if (!t.planned) continue; turnsChecked++; const fr = t.moves.findIndex(x => x.random); const exec = t.moves.slice(0, fr >= 0 ? fr + 1 : t.moves.length).map(x => `${x.m.from}${x.m.dir}${x.m.mode}`); if (JSON.stringify(exec) === JSON.stringify(t.planned)) agree++; }
    const prefixes = new Set(views.map(v => { const parts: string[] = []; for (const t of v.slice(0, 2)) { parts.push(t.decision); if (t.moves.some(x => x.random)) break; } return parts.join(' / '); })).size;
    const realized = new Set(views.map(v => v.slice(0, 2).map(t => `${t.decision}>${t.moves.map(x => x.destination ?? '').join(',')}`).join(' / '))).size;
    const fsRows = xs.flatMap(g => teleportForesight([g.rec]).rows), adv = fsRows.map(r => r.realized - r.expected);
    const tl = xs.filter(g => g.rec.turnLimit).length;
    return [k, { arm: ARMS[k], games: xs.length, turnLimit: { k: tl, n: xs.length, wilson95: wilson(tl, xs.length), seedBlocked: seedBlocked(xs, RATE.turn_limit_rate) }, meanTurns: seedBlocked(xs, RATE.mean_turns), medianTurns: [...xs.map(g => g.rec.turns)].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)], firstMover: seedBlocked(xs, RATE.first_mover_win_rate), draws: xs.filter(g => g.rec.winner === 'draw').length, byBlock: Object.fromEntries(['consecutive', 'dispersed'].map(b => [b, { turnLimit: r3(xs.filter(g => g.block === b && g.rec.turnLimit).length / xs.filter(g => g.block === b).length), meanTurns: r3(mean(xs.filter(g => g.block === b).map(g => g.rec.turns))) }])), rolls: { turnsWithAtLeast5Rolls: rollSd.length, sdByTurn: rollSd, meanSd: rollSd.length ? r3(mean(rollSd.map(x => x.sd))) : null }, nearTieTurns: nearTurns, nearTieNonTopChoices: nonTop, turn21NearTieChoices: t21, agreement: { turns: turnsChecked, agree, rate: turnsChecked ? r3(agree / turnsChecked) : null }, strategicPrefixes: prefixes, realizedTwoTurnTrajectories: realized, foresight: { moves: fsRows.length, advantage: r3(mean(adv)) }, integrity: { illegal: xs.reduce((a, g) => a + g.rec.illegal.length, 0), errors: xs.reduce((a, g) => a + g.rec.errors.length, 0) } }];
  }));
  const c = (a: string, b: string, f: (xs: Game[]) => number | null) => pairedSeedDiff(A[a], A[b], f);
  const contrasts = {
    H2_mixing_within_C4on: { turnLimit: c('A4', 'A2', RATE.turn_limit_rate), meanTurns: c('A4', 'A2', RATE.mean_turns), firstMover: c('A4', 'A2', RATE.first_mover_win_rate) },
    mixing_within_C4off: { turnLimit: c('A3', 'A1', RATE.turn_limit_rate), meanTurns: c('A3', 'A1', RATE.mean_turns), firstMover: c('A3', 'A1', RATE.first_mover_win_rate) },
    H3_C4_within_mixed: { turnLimit: c('A4', 'A3', RATE.turn_limit_rate), meanTurns: c('A4', 'A3', RATE.mean_turns), firstMover: c('A4', 'A3', RATE.first_mover_win_rate) },
    C4_within_legacy: { turnLimit: c('A2', 'A1', RATE.turn_limit_rate), meanTurns: c('A2', 'A1', RATE.mean_turns), firstMover: c('A2', 'A1', RATE.first_mover_win_rate) },
    H4_interaction: { turnLimit: interaction(A, RATE.turn_limit_rate), meanTurns: interaction(A, RATE.mean_turns), firstMover: interaction(A, RATE.first_mover_win_rate) },
  };
  const pa = perArm as Record<string, { rolls: { sdByTurn: { sd: number }[] }; agreement: { rate: number | null } }>;
  const h1 = (k: string, ok: (sd: number) => boolean) => pa[k].rolls.sdByTurn.length > 0 && pa[k].rolls.sdByTurn.every(x => ok(x.sd));
  const verdicts = {
    H1_coverage: h1('A3', s => s >= 0.2) && h1('A4', s => s >= 0.2) && !(h1('A1', s => s >= 0.2) || h1('A2', s => s >= 0.2)) ? 'SUPPORTED' : 'NOT AS PREDICTED (see rolls)',
    H2_mixing_effect: { turnLimit: judge(contrasts.H2_mixing_within_C4on.turnLimit.ci95, 0.1), meanTurns: judge(contrasts.H2_mixing_within_C4on.meanTurns.ci95, 3) },
    H3_C4_effect: { turnLimit: judge(contrasts.H3_C4_within_mixed.turnLimit.ci95, 0.1), meanTurns: judge(contrasts.H3_C4_within_mixed.meanTurns.ci95, 3) },
    H4_interaction: { turnLimit: judge(contrasts.H4_interaction.turnLimit.ci95, 0.1), meanTurns: judge(contrasts.H4_interaction.meanTurns.ci95, 3) },
    validity: { replayOk: JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')).ok, c4OnAgreement: { A2: pa.A2.agreement.rate, A4: pa.A4.agreement.rate } },
  };
  const out = { schema: 'rule-sabotage/v52-evaluation@1', dir: relative(ROOT, dir).replace(/\\/g, '/'), perArm, contrasts, verdicts, scope: 'exploratory, self-play of this planner family; no universal balance claim' };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  return out;
}

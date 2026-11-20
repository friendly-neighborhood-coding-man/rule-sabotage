/** V5.3 three-policy self-play comparison: preregistration, exactly 180 games once, preregistered evaluation. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, platform, release } from 'node:os';
import { type Player, PLAYERS } from '../../rules.ts';
import { loadWeights } from '../../weights.ts';
import { type GameRec } from '../selfplay.ts';
import { ROOT, runBatch, summaryRow, replayDetail, offlineImportCheck, hashOf, sha256, filesHash, ENGINE_FILES, PLANNER_FILES, type BatchJob } from '../v3/batch.ts';
import { teleportForesight } from '../v3/evaluate.ts';
import { r3, mean, quant, wilson } from '../v3/stats.ts';
import { appendJournal, readJournal, verifyJournal } from '../journal.ts';
import { listFiles } from '../v4/pilot.ts';
import { seedBlocked, pairedSeedDiff, patternSurvives, RATE, type Game } from '../v5/metrics.ts';
import { turns as turnViews } from '../v5_1/reanalysis.ts';
import { POLICIES53, type Policy53 } from './policies.ts';

export const PROTOCOL = join(ROOT, 'balance/v5_3/protocol.json');
export const JOURNAL = join(ROOT, 'balance/v5_3/journal.ndjson');
export const PREFLIGHT = join(ROOT, 'evidence/balance/v5_3/preflight.json');
const protoSha = () => sha256(readFileSync(PROTOCOL, 'utf8').replace(/\r\n/g, '\n'));
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
export const FILES = ['server/balance/v4/evplanner.ts', 'server/balance/v5/evk11.ts', 'server/balance/v5/policies.ts', 'server/balance/v5_1/ablation.ts', 'server/balance/v5_2/stream.ts', 'server/balance/v5_2/planner.ts', 'server/balance/v5_3/policies.ts', 'server/balance/v5_3/run.ts', 'server/balance/v5/metrics.ts', 'server/balance/v5_1/reanalysis.ts'];
export const implementationHashes = () => ({ engine: filesHash(ENGINE_FILES), plannerFiles: filesHash(PLANNER_FILES), v53: filesHash(FILES), all: filesHash([...ENGINE_FILES, ...PLANNER_FILES, ...FILES]) });
const proto = () => JSON.parse(readFileSync(PROTOCOL, 'utf8')) as { seeds: { consecutive: number[]; dispersed: number[] } };
export type J53 = BatchJob & { arm: Policy53; block: 'consecutive' | 'dispersed' };
export function jobs53(): J53[] {
  const w = loadWeights(), W = { human: w as never, ai: w as never }, p = proto();
  const seeds = [...p.seeds.consecutive.map(s => ({ s, block: 'consecutive' as const })), ...p.seeds.dispersed.map(s => ({ s, block: 'dispersed' as const }))];
  return POLICIES53.flatMap(pol => seeds.flatMap(({ s, block }) => PLAYERS.map(first => ({ gameId: `${pol}-${s}-${first}`, condition: pol, arm: pol, block, seed: s, first, weights: W, detail: true, policy53: { human: pol, ai: pol } }))));
}
export function preregister() {
  if (readJournal(JOURNAL).some(e => e.type === 'v53-preregistered')) throw new Error('already preregistered');
  const pf = JSON.parse(readFileSync(PREFLIGHT, 'utf8')); if (!pf.pass) throw new Error('preflight did not pass: not preregistering');
  const dirty = git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']); if (dirty) throw new Error(`commit first:\n${dirty}`);
  return appendJournal(JOURNAL, 'v53-preregistered', 'V5.3-POLICY-RELIABILITY-180', null, { protocol: 'balance/v5_3/protocol.json', protocolSha256: protoSha(), implementation: implementationHashes(), commit: git(['rev-parse', 'HEAD']), preflightSha256: sha256(readFileSync(PREFLIGHT)), assignments: jobs53().map(j => j.gameId), note: 'frozen before any V5.3 game' });
}
export async function run53(log: (s: string) => void = console.log) {
  if (!verifyJournal(JOURNAL).ok) throw new Error('journal fails verification');
  const pre = readJournal(JOURNAL).find(e => e.type === 'v53-preregistered'); if (!pre) throw new Error('not preregistered');
  const d = pre.data as { protocolSha256: string; implementation: ReturnType<typeof implementationHashes> };
  if (d.protocolSha256 !== protoSha() || JSON.stringify(d.implementation) !== JSON.stringify(implementationHashes())) throw new Error('protocol or implementation changed after preregistration');
  if (readJournal(JOURNAL).some(e => e.type === 'v53-start')) throw new Error('already started once');
  const jobs = jobs53(); if (jobs.length !== 180) throw new Error(`${jobs.length} games`);
  if (!offlineImportCheck().pass) throw new Error('offline import check failed');
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z-v53', dir = join(ROOT, 'evidence/balance/v5_3', runId);
  mkdirSync(join(dir, 'games'), { recursive: true });
  const env = { implementation: implementationHashes(), protocolSha256: protoSha(), commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', 'server', 'balance', 'tests', 'scripts']) !== '', node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism() };
  appendJournal(JOURNAL, 'v53-start', runId, null, { games: jobs.length, ...env });
  log(`V5.3 ${runId}: ${jobs.length} games`);
  const t0 = Date.now();
  const res = await runBatch(jobs, { workers: Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))), maxMs: 1_800_000, onGame: (k, n, r, j) => { if (k % 10 === 0 || k === n) log(`  ${k}/${n} ${j.gameId} ${r.winner} t${r.turns} ${Math.round(r.ms / 1000)}s`); } });
  const wallMs = Date.now() - t0;
  for (let i = 0; i < jobs.length; i++) writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v53-game@1', gameId: jobs[i].gameId, arm: jobs[i].arm, block: jobs[i].block, rec: res.recs[i] }));
  writeFileSync(join(dir, 'games.ndjson'), res.recs.map((r, i) => JSON.stringify({ ...summaryRow(r, jobs[i]), arm: jobs[i].arm, block: jobs[i].block })).join('\n') + '\n');
  const replays = res.recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ ok: replays.every(r => r.ok), games: replays.length, failures: replays.filter(r => !r.ok) }, null, 2));
  const run = { schema: 'rule-sabotage/v53-run@1', runId, games: jobs.length, wallMs, externalCalls: res.guard.attempts, kaneCalls: 0, datasetHash: hashOf(res.recs.map(r => r.detail!.finalHash)), replayOk: replays.every(r => r.ok), ...env };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(Object.fromEntries(listFiles(dir).filter(f => f !== 'manifest.json').map(f => [f, sha256(readFileSync(join(dir, f)))])), null, 2));
  appendJournal(JOURNAL, 'v53-complete', runId, null, { dir: relative(ROOT, dir).replace(/\\/g, '/'), datasetHash: run.datasetHash, replayOk: run.replayOk, externalCalls: run.externalCalls, wallMs, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) });
  log(`done in ${(wallMs / 60000).toFixed(1)} min: replay ${run.replayOk ? 'OK' : 'FAILED'}, external calls ${run.externalCalls}`);
  return dir;
}

// ---------------------------------------------------------------- evaluation
type G = Game & { block: string; aborted: boolean };
const aborted = (r: GameRec) => r.errors.some(e => /exceeded \d+ ms/.test(e));
export function evaluate53(dir: string) {
  const replayOk = JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')).ok as boolean;
  const all: G[] = readdirSync(join(dir, 'games')).sort().map(f => { const x = JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')) as { gameId: string; arm: string; block: string; rec: GameRec }; return { gameId: x.gameId, arm: x.arm, block: x.block, seed: x.rec.seed, rec: x.rec, policies: { human: x.arm, ai: x.arm }, aborted: aborted(x.rec) }; });
  const by = (p: string) => all.filter(g => g.arm === p), done = (xs: G[]) => xs.filter(g => !g.aborted);
  const per = Object.fromEntries(POLICIES53.map(p => {
    const xs = by(p), ok = done(xs), dec = ok.filter(g => g.rec.winner !== 'draw'), fm = dec.filter(g => g.rec.winner === g.rec.first).length, ab = xs.filter(g => g.aborted).length;
    const views = xs.map(g => turnViews({ gameId: g.gameId, arm: p, policies: { human: p, ai: p }, rec: g.rec } as never));
    let turns = 0, agree = 0; const groups = new Map<string, Set<string>>(), seen = new Map<string, number>();
    for (const v of views) for (const t of v) { if (t.planned) { turns++; const fr = t.moves.findIndex(x => x.random); if (JSON.stringify(t.moves.slice(0, fr >= 0 ? fr + 1 : t.moves.length).map(x => `${x.m.from}${x.m.dir}${x.m.mode}`)) === JSON.stringify(t.planned)) agree++; } seen.set(t.stateKey, (seen.get(t.stateKey) ?? 0) + 1); (groups.get(t.stateKey) ?? groups.set(t.stateKey, new Set()).get(t.stateKey)!).add(t.decision); }
    const rep = [...groups.entries()].filter(([k]) => (seen.get(k) ?? 0) >= 2);
    const prefixes = new Set(views.map(v => { const parts: string[] = []; for (const t of v.slice(0, 2)) { parts.push(t.decision); if (t.moves.some(x => x.random)) break; } return parts.join(' / '); })).size;
    const realized = new Set(views.map(v => v.slice(0, 2).map(t => `${t.decision}>${t.moves.map(x => x.destination ?? '').join(',')}`).join(' / '))).size;
    const firstTurn = new Set(views.map(v => v[0]?.decision ?? '')).size;
    const metas = xs.flatMap(g => g.rec.detail!.turns.map(t => t.policyMeta!).filter(Boolean)), ms = metas.map(m => m.ms);
    const fsRows = ok.flatMap(g => teleportForesight([g.rec]).rows), adv = fsRows.map(r => r.realized - r.expected);
    const integrity = { illegal: xs.reduce((a, g) => a + g.rec.illegal.length, 0), nonTimeoutErrors: xs.reduce((a, g) => a + g.rec.errors.filter(e => !/exceeded \d+ ms/.test(e)).length, 0) };
    const eligible = replayOk && integrity.illegal === 0 && integrity.nonTimeoutErrors === 0 && turns > 0 && agree === turns && ab <= 3;
    const t2 = (gs: Game[]) => (gs.length ? mean(gs.map(g => g.rec.detail!.turns[1]?.moves.reduce((a, m) => a + m.events.filter(e => e.t === 'capture').reduce((b, e) => b + (e as { pieces: string[] }).pieces.length, 0), 0) ?? 0)) : null);
    return [p, {
      games: xs.length, aborted: ab, completed: ok.length, decisive: dec.length, draws: ok.length - dec.length, eligible,
      firstMover: { k: fm, n: dec.length, wilson95: wilson(fm, dec.length), seedBlocked: seedBlocked(ok, RATE.first_mover_win_rate), sensitivity: { abortedAllFirstMoverWins: dec.length + ab ? r3((fm + ab) / (dec.length + ab)) : null, abortedAllFirstMoverLosses: dec.length + ab ? r3(fm / (dec.length + ab)) : null } },
      humanSide: { k: dec.filter(g => g.rec.winner === 'human').length, n: dec.length, wilson95: wilson(dec.filter(g => g.rec.winner === 'human').length, dec.length), seedBlocked: seedBlocked(ok, RATE.human_side_win_rate) },
      length: { mean: seedBlocked(ok, RATE.mean_turns), median: [...ok.map(g => g.rec.turns)].sort((a, b) => a - b)[Math.floor((ok.length - 1) / 2)], turnLimit: seedBlocked(ok, RATE.turn_limit_rate) },
      byBlock: Object.fromEntries(['consecutive', 'dispersed'].map(b => { const gs = done(xs.filter(g => g.block === b)), d = gs.filter(g => g.rec.winner !== 'draw'); return [b, { games: gs.length, firstMover: d.length ? r3(d.filter(g => g.rec.winner === g.rec.first).length / d.length) : null, turnLimit: gs.length ? r3(gs.filter(g => g.rec.turnLimit).length / gs.length) : null }]; })),
      counterplay: { leadChanges: seedBlocked(ok, RATE.lead_changes), comebacks: seedBlocked(ok, RATE.comeback_rate) }, turn2Captures: r3(t2(ok) ?? 0),
      diversity: { firstTurnChoices: firstTurn, strategicPrefixes: prefixes, realizedTwoTurnTrajectories: realized, repeatedIdenticalStates: rep.length, repeatedStatesWithDifferentDecisions: rep.filter(([, d]) => d.size > 1).length },
      compute: { decisions: metas.length, msP50: Math.round(quant(ms, 0.5)), msP90: Math.round(quant(ms, 0.9)), msP99: Math.round(quant(ms, 0.99)), msMax: Math.max(0, ...ms), budgetHits: metas.filter(m => m.budgetHit).length, fallbacks: metas.filter(m => m.fallback).length, secondLevelCollapsed: metas.reduce((a, m) => a + (m.secondLevelCollapsed ?? 0), 0), opponentOptionsPruned: metas.reduce((a, m) => a + (m.opponentOptionsPruned ?? 0), 0), temperatureRolls: metas.filter(m => m.roll !== undefined && m.roll !== null).length },
      agreement: { turns, agree, rate: turns ? r3(agree / turns) : null }, foresight: { moves: fsRows.length, advantage: r3(mean(adv)) }, integrity,
    }];
  }));
  const pairs: [Policy53, Policy53][] = [['softmax-v2', 'ev-k1.2'], ['oa-v3', 'ev-k1.2'], ['oa-v3', 'softmax-v2']];
  const dependence = Object.fromEntries(['first_mover_win_rate', 'human_side_win_rate', 'mean_turns', 'turn_limit_rate', 'lead_changes'].map(m => [m, Object.fromEntries(pairs.map(([a, b]) => [`${a} - ${b}`, pairedSeedDiff(done(by(a)), done(by(b)), RATE[m])]))]));
  const pd = Object.values(dependence.first_mover_win_rate).some(x => x.ci95 && (x.ci95[0] > 0 || x.ci95[1] < 0));
  const pp = per as Record<string, { eligible: boolean }>;
  const edge = (p: string) => { const sb = seedBlocked(done(by(p)), xs => { const v = RATE.first_mover_win_rate(xs); return v === null ? null : v - 0.5; }); return { eligible: pp[p].eligible, ci95: sb.ci95, edge: sb.value }; };
  const perPolicyEdge = Object.fromEntries(POLICIES53.map(p => [p, edge(p)]));
  const out = { schema: 'rule-sabotage/v53-evaluation@1', dir: relative(ROOT, dir).replace(/\\/g, '/'), replayOk, perPolicy: per, policyDependence: dependence, verdicts: { P1_policyDependence: pd ? 'POLICY-DEPENDENT' : 'NOT SHOWN', P2_ruleRobustness: { perPolicy: perPolicyEdge, verdict: patternSurvives(perPolicyEdge) } }, scope: 'engine-based self-play only: not evidence about human players or gameplay quality' };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  return out;
}

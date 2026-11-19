/**
 * Balance Designer V3: run the 100-game screen ONCE, then build and verify its evidence.
 *
 *  runScreen()   preflight (matrix, import graph, guard) -> 100 offline games -> acceptance checks -> dataset files
 *                -> engine-only replay of all 100 -> planner re-run of one game per condition (determinism) ->
 *                journal + registry. Refuses to run again for the same matrix unless an operator-approved rerun
 *                reason is given; a failed or invalid run is quarantined, never silently replaced.
 *  buildOutputs() analysis.json, dashboard, dossier, replay pages (deterministic from the stored files).
 *  verifyRun()   manifest hashes, journal chain, replay of every stored game, guard counters.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, totalmem, platform, release } from 'node:os';
import { type GameRec, playGame, jobOpts } from '../selfplay.ts';
import { loadWeights, freezeWeights } from '../../weights.ts';
import { appendJournal, verifyJournal } from '../journal.ts';
import { engineSourceHash } from '../invariants.ts';
import { installOfflineGuard, guardReport } from './offline.ts';
import { ROOT, loadMatrix, buildJobs, runBatch, summaryRow, replayDetail, offlineImportCheck, hashOf, sha256, filesHash, ENGINE_FILES, PLANNER_FILES, type Matrix, type SummaryRow, type BatchJob } from './batch.ts';
import { analyze, type Analysis, type Game } from './analysis.ts';
import { replayPage, dashboardPage, dossierPages, page } from './pages.ts';

export const V3_JOURNAL = join(ROOT, 'balance/v3/journal.ndjson');
export const V3_REGISTRY = join(ROOT, 'balance/v3/datasets.json');
export const V3_EVIDENCE = join(ROOT, 'evidence/balance/v3');
type Registry = { schema: 'rule-sabotage/v3-datasets@1'; note: string; runs: { runId: string; matrixId: string; matrixHash: string; status: 'accepted' | 'quarantined' | 'failed' | 'running'; at: string; dir: string; games: number; datasetHash: string | null; reason?: string }[] };
const readRegistry = (f = V3_REGISTRY): Registry => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { schema: 'rule-sabotage/v3-datasets@1', note: 'Append-only registry of V3 datasets. Old entries are never rewritten except to mark a run quarantined (with a reason).', runs: [] });
const writeRegistry = (r: Registry, f = V3_REGISTRY) => writeFileSync(f, JSON.stringify(r, null, 2) + '\n');
const now = () => new Date().toISOString();
function git(args: string[]) { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } }
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

export function writeManifest(dir: string) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f !== 'manifest.json') { const b = readFileSync(p); files.push({ path: relative(dir, p).split(sep).join('/'), bytes: b.length, sha256: sha256(b) }); } } };
  walk(dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ generatedAt: now(), note: 'sha256 of every file in this dataset directory.', files }, null, 2));
  return files.length;
}
/** The dataset hash covers exactly the evidence (summaries + full game records), not derived pages. */
export function datasetHash(dir: string) {
  const rows = readFileSync(join(dir, 'games.ndjson'));
  const games = readdirSync(join(dir, 'games')).sort().map(f => `${f}:${sha256(readFileSync(join(dir, 'games', f)))}`).join('\n');
  return sha256(Buffer.concat([rows, Buffer.from('\n'), Buffer.from(games)])).slice(0, 16);
}

export type ScreenOptions = { workers?: number; approvedRerun?: string; smoke?: { outDir: string; seeds: number[] }; log?: (l: string) => void };
export async function runScreen(o: ScreenOptions = {}) {
  const log = o.log ?? console.log;
  const matrix0 = loadMatrix();
  const matrix: Matrix = o.smoke ? { ...matrix0, id: `${matrix0.id}-SMOKE`, seeds: o.smoke.seeds, totalGames: matrix0.conditions.length * o.smoke.seeds.length * 2 } : matrix0;
  const mHash = hashOf(matrix);
  const reg = readRegistry();
  if (!o.smoke) {
    const prior = reg.runs.filter(r => r.matrixId === matrix.id && r.status !== 'quarantined');
    if (prior.length && !o.approvedRerun) throw new Error(`The ${matrix.id} screen already has run(s) ${prior.map(r => `${r.runId} (${r.status})`).join(', ')}. It runs exactly once. Quarantine with a reason and pass --approved-rerun "<operator approval>" to run a fresh full screen.`);
  }
  // ---- preflight (before the guard: git needs child_process)
  const commit = git(['rev-parse', '--short', 'HEAD']), dirty = git(['status', '--porcelain', '--', 'server', 'balance/v3', 'scripts']) !== '';
  const imports = offlineImportCheck();
  if (!imports.pass) throw new Error(`Offline import check failed: ${JSON.stringify(imports.forbidden)}`);
  const weights = loadWeights();
  const runId = `${now().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}-v3-${o.smoke ? 'smoke' : 'screen'}`;
  const dir = o.smoke ? o.smoke.outDir : join(V3_EVIDENCE, 'datasets', runId);
  mkdirSync(join(dir, 'games'), { recursive: true });
  const journal = (type: string, data: unknown) => { if (!o.smoke) appendJournal(V3_JOURNAL, type, runId, null, data); };
  const env = { engineHash: engineSourceHash(), engineFilesHash: filesHash(ENGINE_FILES), plannerHash: filesHash(PLANNER_FILES), weights: { version: weights.version, hash: weights.hash }, matrixHash: mHash, commit, dirty, node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? '?', logicalCores: availableParallelism(), memGB: Math.round(totalmem() / 2 ** 30) };
  const guardMain = installOfflineGuard();
  journal('screen-start', { matrix: matrix.id, matrixHash: mHash, games: matrix.totalGames, seeds: matrix.seeds, env, imports: { pass: imports.pass, files: imports.files }, guard: { installed: guardMain.installed, strippedEnv: guardMain.strippedEnv } });
  if (!o.smoke) { reg.runs.push({ runId, matrixId: matrix.id, matrixHash: mHash, status: 'running', at: now(), dir: rel(dir), games: 0, datasetHash: null }); writeRegistry(reg); }
  const jobs = buildJobs(matrix, weights);
  if (jobs.length !== matrix.totalGames) throw new Error(`built ${jobs.length} jobs, expected ${matrix.totalGames}`);
  const workers = o.workers ?? matrix.workers;
  log(`V3 screen ${runId}: ${jobs.length} games, ${workers} offline workers, matrix ${mHash}, engine ${env.engineHash}, planner ${env.plannerHash}, weights ${weights.version}#${weights.hash}`);
  const t0 = Date.now(), cpu0 = process.cpuUsage();
  let res; let failure: string | null = null;
  try {
    res = await runBatch(jobs, { workers, maxMs: matrix.maxMsPerGame, onGame: (d, n, r, j) => log(`  [${String(d).padStart(3)}/${n}] ${j.gameId.padEnd(16)} ${String(r.winner).padEnd(5)} ${String(r.turns).padStart(2)} turns ${(r.ms / 1000).toFixed(1).padStart(5)}s${r.errors.length || r.illegal.length ? ' PROBLEM' : ''}`) });
  } catch (e) { failure = (e as Error).message; }
  const wallMs = Date.now() - t0, cpuMain = process.cpuUsage(cpu0), ru = process.resourceUsage();
  const gMain = guardReport();
  const external = (res?.guard.attempts ?? 0) + gMain.attempts;
  const recs = res?.recs ?? [];
  const complete = recs.filter(Boolean).length;
  const problems: string[] = [];
  if (failure) problems.push(`batch failed: ${failure}`);
  if (complete !== matrix.totalGames) problems.push(`${complete}/${matrix.totalGames} games completed`);
  if (external !== 0) problems.push(`${external} external call attempt(s) were blocked`);
  const illegal = recs.reduce((a, r) => a + (r?.illegal.length ?? 0), 0), errors = recs.reduce((a, r) => a + (r?.errors.length ?? 0), 0), softlocks = recs.filter(r => r?.softlock).length;
  // ---- dataset files
  const rows: SummaryRow[] = recs.map((r, i) => summaryRow(r, jobs[i]));
  writeFileSync(join(dir, 'games.ndjson'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  recs.forEach((r, i) => writeFileSync(join(dir, 'games', `${jobs[i].gameId}.json`), JSON.stringify({ schema: 'rule-sabotage/v3-game@1', gameId: jobs[i].gameId, condition: jobs[i].condition, matrix: matrix.id, rec: r })));
  // ---- replay verification: every game through the engine alone, plus a full planner re-run of one game per condition
  const replays = recs.map((r, i) => ({ gameId: jobs[i].gameId, ...replayDetail(r) }));
  const rerunIds = matrix.conditions.map(c => jobs.findIndex(j => j.condition === c.id));
  const reruns = rerunIds.map(i => { const j = jobs[i]; const again = playGame(j.seed, j.first, { human: freezeWeights(j.weights.human), ai: freezeWeights(j.weights.ai) }, jobOpts(j)); const strip = (x: GameRec) => JSON.stringify({ ...x, ms: 0 }); return { gameId: j.gameId, identical: strip(again) === strip(recs[i]) }; });
  const replayOk = replays.filter(r => r.ok).length;
  if (replayOk !== recs.length) problems.push(`${recs.length - replayOk} game(s) failed engine replay`);
  if (reruns.some(r => !r.identical)) problems.push('planner re-run was not identical (non-determinism)');
  if (illegal || errors) problems.push(`${illegal} illegal action(s), ${errors} engine error(s)`);
  writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ note: 'Every recorded placement and move re-executed through the real engine (no planner). Plus a complete planner re-run of the first game of every condition, compared field by field (except wall time).', engineReplays: replays, plannerReruns: reruns, plannerRerunNote: `${reruns.length} verification re-runs: same seeds as dataset games, NOT new dataset games` }, null, 2));
  const dsHash = datasetHash(dir);
  const status = problems.length ? 'failed' : 'accepted';
  const run = {
    schema: 'rule-sabotage/v3-run@1', runId, status, problems, matrix, matrixHash: mHash, env, startedAt: new Date(t0).toISOString(), finishedAt: now(), wallMs,
    games: { planned: matrix.totalGames, completed: complete, illegal, errors, softlocks },
    externalCalls: { total: external, workers: res?.guard.attempts ?? null, main: gMain.attempts, blocked: [...(res?.guard.blocked ?? []), ...gMain.blocked], guardWorkers: res?.guard.workers ?? 0, strippedEnv: [...new Set([...(res?.guard.strippedEnv ?? []), ...gMain.strippedEnv])], kaneCalls: 0, kaneCredits: 0, note: 'Counted by the offline guard in the main thread and in every worker; every outbound channel is replaced by a counting stub that throws.' },
    imports, resources: { workers, mainCpuMs: Math.round((cpuMain.user + cpuMain.system) / 1000), workerCpuMs: (res?.cpuMs ?? []).reduce((a, b) => a + b, 0), maxRssMB: Math.round(ru.maxRSS / 1024), perGameMs: { min: Math.min(...recs.map(r => r.ms)), max: Math.max(...recs.map(r => r.ms)), total: recs.reduce((a, r) => a + r.ms, 0) } },
    replay: { engineReplayOk: replayOk, of: recs.length, plannerReruns: reruns },
    datasetHash: dsHash,
  };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  journal('screen-complete', { status, problems, datasetHash: dsHash, games: complete, externalCalls: external, replayOk, reruns, wallMs });
  if (!o.smoke) { const r2 = readRegistry(); const e = r2.runs.find(x => x.runId === runId)!; e.status = status; e.games = complete; e.datasetHash = dsHash; if (problems.length) e.reason = problems.join('; '); writeRegistry(r2); }
  log(`${status.toUpperCase()}: ${complete}/${matrix.totalGames} games, external calls ${external}, engine replay ${replayOk}/${recs.length}, planner re-runs ${reruns.filter(r => r.identical).length}/${reruns.length} identical, ${(wallMs / 60000).toFixed(1)} min, dataset ${dsHash}${problems.length ? `\n  problems: ${problems.join('; ')}` : ''}`);
  return { runId, dir, status, run };
}

/** Load a dataset directory back (summaries + full records). */
export function loadDataset(dir: string): { games: Game[]; run: Record<string, unknown> & { runId: string; matrix: Matrix; datasetHash: string; wallMs: number; externalCalls: { total: number }; replay: { engineReplayOk: number } } } {
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const rows = readFileSync(join(dir, 'games.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as SummaryRow);
  const games = rows.map(row => ({ row, rec: (JSON.parse(readFileSync(join(dir, 'games', `${row.gameId}.json`), 'utf8')) as { rec: GameRec }).rec }));
  return { games, run };
}

/** Fixed, rule-based selection of trajectories and counterexamples (no judgement involved). */
export function selections(a: Analysis) {
  const ds = a.games, ids = a.conditions.map(c => c.id);
  const top = <T>(xs: T[], f: (x: T) => number, n = 3) => [...xs].sort((p, q) => f(q) - f(p)).slice(0, n);
  const pick = (id: string) => ds.filter(d => d.condition === id);
  const trajectories = [
    { title: 'Longest games in every condition', why: 'Top 1 by number of turns per condition.', ids: ids.flatMap(id => top(pick(id), d => d.turns, 1).map(d => d.gameId)) },
    { title: 'Shortest games in every condition', why: 'Bottom 1 by number of turns per condition.', ids: ids.flatMap(id => top(pick(id), d => -d.turns, 1).map(d => d.gameId)) },
    { title: 'Most lead changes', why: 'Top 5 over all 100 games by lead changes (lead = pieces across, then squares left, normalized).', ids: top(ds, d => d.leadChanges, 5).map(d => d.gameId) },
    { title: 'Comebacks', why: 'Decisive games whose winner trailed after turn 4 (up to 6, in dataset order).', ids: ds.filter(d => d.comeback).slice(0, 6).map(d => d.gameId) },
    { title: 'Heaviest conveyor-belt use', why: 'Top 5 by squares gained from a side’s own traps.', ids: top(ds, d => d.conveyorSquares.human + d.conveyorSquares.ai, 5).map(d => d.gameId) },
    { title: 'Turn-limit and drawn games', why: 'Every game that reached the turn limit.', ids: ds.filter(d => d.turnLimit).map(d => d.gameId) },
    { title: 'Most forced movement', why: 'Top 5 by forced squares moved (forward plus backward).', ids: top(ds, d => d.forcedForward.human + d.forcedForward.ai + d.forcedBack.human + d.forcedBack.ai, 5).map(d => d.gameId) },
  ];
  const counterexamples = ids.flatMap(id => {
    const c = a.conditions.find(x => x.id === id)!, g = pick(id).filter(d => d.winner !== 'draw');
    const majority = (c.firstMover.rate ?? 0.5) >= 0.5 ? 'first' : 'second';
    const out = [{ claim: `${id}: the ${majority} mover usually won here (${c.firstMover.k}/${c.firstMover.n} first-mover wins); games the ${majority === 'first' ? 'second' : 'first'} mover won`, ids: g.filter(d => d.winnerRole !== majority).map(d => d.gameId) }];
    if (c.sideWithMorePieces) out.push({ claim: `${id}: games won by the side with FEWER pieces`, ids: g.filter(d => d.count[d.winner as 'human'] < d.count[d.winner === 'human' ? 'ai' : 'human']).map(d => d.gameId) });
    out.push({ claim: `${id}: games where the side with more conveyor squares LOST`, ids: g.filter(d => d.conveyorSquares.human !== d.conveyorSquares.ai && (d.conveyorSquares.human > d.conveyorSquares.ai ? 'human' : 'ai') !== d.winner).map(d => d.gameId) });
    return out;
  });
  const picks = Object.fromEntries(ids.map(id => {
    const c = a.conditions.find(x => x.id === id)!, g = pick(id), majority = (c.firstMover.rate ?? 0.5) >= 0.5 ? 'first' : 'second';
    const maj = g.filter(d => d.winnerRole === majority).sort((p, q) => Math.abs(p.turns - c.turns.median) - Math.abs(q.turns - c.turns.median))[0];
    const min = g.find(d => d.winnerRole !== majority);
    return [id, [maj?.gameId, min?.gameId].filter((x): x is string => !!x)];
  }));
  return { trajectories, counterexamples, picks };
}

export const V2_BACKGROUND = `<ul>
<li>V2 (draft PR #4) investigated 3-versus-3 games only, on seeds 1000–1011 (exploration), 3200–3215 (development) and 7100–7115 (holdout).</li>
<li>Kane proposed one hypothesis of its own (HK1: the V0.3 prior undervalues Teleport). Tested by setting the Teleport weight to its measured value: <b>INCONCLUSIVE</b>.</li>
<li>H3 (the planner's trap-cell search counts benefit to its own pieces, so it builds traps its own pieces then use) was <b>SUPPORTED</b> twice on independent seeds.</li>
<li>The H3 correction K1 (remove own-benefit from the cell search completely) reduced self-triggering but was a <b>REGRESSION</b>: mean game length rose from about 14.5 to 27.1 turns and the changed planner lost head-to-head.</li>
<li>Changing Teleport weights did not produce a convincing improvement. Production settings were not changed.</li>
<li>Kane's ability to design experiments independently was not demonstrated.</li></ul><p>Source: docs/BALANCE_V2_KANE_RESULT.md in the repository.</p>`;

export function buildOutputs(dir: string) {
  const { games, run } = loadDataset(dir);
  const ids = run.matrix.conditions.map(c => c.id);
  const a = analyze(games, ids, { runId: run.runId, datasetHash: run.datasetHash });
  const { trajectories, counterexamples, picks } = selections(a);
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify({ ...a, selections: { trajectories, counterexamples, picks } }, null, 2));
  const rc = JSON.parse(readFileSync(join(dir, 'replay-check.json'), 'utf8')) as { engineReplays: { gameId: string; ok: boolean; problems: string[] }[] };
  mkdirSync(join(dir, 'replays'), { recursive: true });
  games.forEach((g, i) => writeFileSync(join(dir, 'replays', `${g.row.gameId}.html`), replayPage(g.rec, a.games[i], rc.engineReplays.find(r => r.gameId === g.row.gameId) ?? { ok: false, problems: ['not checked'] })));
  mkdirSync(join(dir, 'dashboard'), { recursive: true });
  writeFileSync(join(dir, 'dashboard', 'index.html'), dashboardPage(a, { runId: run.runId, games: games.length, externalCalls: run.externalCalls.total, replayOk: run.replay.engineReplayOk, wallMs: run.wallMs, datasetHash: run.datasetHash }, picks));
  mkdirSync(join(dir, 'dossier'), { recursive: true });
  const pages = dossierPages(a, { runId: run.runId, datasetHash: run.datasetHash, trajectories, counterexamples, v2: V2_BACKGROUND, formAction: '/notebook', nonce: 'SET-AT-SERVE-TIME' });
  for (const [f, html] of Object.entries(pages)) writeFileSync(join(dir, 'dossier', f), html);
  writeFileSync(join(dir, 'index.html'), page('V3 dataset', `<h1>V3 dataset ${run.runId}</h1><ul><li><a href="dashboard/index.html">Operator dashboard</a></li><li><a href="dossier/index.html">Kane research dossier</a></li><li><a href="dossier/games.html">All 100 replays</a></li></ul>`));
  return { analysis: a, picks };
}

export function verifyRun(dir: string) {
  const out: { check: string; pass: boolean; detail: string }[] = [];
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
  const bad = m.files.filter(f => !existsSync(join(dir, f.path)) || sha256(readFileSync(join(dir, f.path))) !== f.sha256);
  out.push({ check: 'manifest', pass: bad.length === 0, detail: `${m.files.length - bad.length}/${m.files.length} files match their sha256${bad.length ? `; differ: ${bad.slice(0, 5).map(f => f.path).join(', ')}` : ''}` });
  const { games, run } = loadDataset(dir);
  out.push({ check: 'dataset hash', pass: datasetHash(dir) === run.datasetHash, detail: `${datasetHash(dir)} vs recorded ${run.datasetHash}` });
  out.push({ check: 'complete', pass: games.length === run.matrix.totalGames, detail: `${games.length}/${run.matrix.totalGames} games` });
  out.push({ check: 'external calls', pass: run.externalCalls.total === 0, detail: `${run.externalCalls.total} recorded external call attempts` });
  const rp = games.map(g => replayDetail(g.rec)), ok = rp.filter(r => r.ok).length;
  out.push({ check: 'engine replay', pass: ok === games.length, detail: `${ok}/${games.length} games re-executed identically through the engine` });
  const j = verifyJournal(V3_JOURNAL);
  out.push({ check: 'journal', pass: j.ok, detail: `${j.entries} entries${j.ok ? ', hash chain verified' : `: ${j.problem}`}` });
  return { pass: out.every(c => c.pass), checks: out };
}


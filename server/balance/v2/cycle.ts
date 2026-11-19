/**
 * Living Balance Designer V2: one bounded, hypothesis-driven investigation cycle.
 *
 *   observe (V1 evidence, verified) → Kane exploration (objective mode, own hypotheses) → register contracts
 *   (before any result) → seal holdout → controlled experiments on development seeds (real engine + planner,
 *   one factor each) → pre-registered evaluation → Kane challenge (independent raw-row conditions) →
 *   corrections from surviving hypotheses → re-observation on the unsealed holdout → independent adequacy
 *   review → decision (never applied to production) → hash-chained journal + manifest + report.
 *
 * Runs as its own process. The game server never waits for it and never reads anything it writes.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setPriority } from 'node:os';
import { type Weights, loadWeights, effectId, activationUtility, effectFromId, featureOf } from '../../weights.ts';
import { type GameRec, playGame } from '../selfplay.ts';
import { appendJournal, readJournal, verifyJournal } from '../journal.ts';
import { runInvariants, engineSourceHash } from '../invariants.ts';
import { writeManifest, redact } from '../loop.ts';
import { kaneVerify, kaneCredits, kaneProbe, type KaneVerifyResult } from '../../kane.ts';
import { freezeWeights } from '../../weights.ts';
import { EXPERIMENTS, experimentDesigns, SeedVault, runCondition, manipulationCheck, type ConditionRun, type Manipulation } from './experiments.ts';
import { Registry, evaluateHypothesis, applyKaneChallenge, type HypothesisContract, type Evaluation, type Design, sha256File } from './contracts.ts';
import { METRICS, metric, pairedEffect, type Effect } from './metrics.ts';
import { proposeCorrections, reviewCorrection, type Correction, type Review, type AdequacyConfig } from './corrections.ts';
import { openSession, acceptNote, kaneExplore, COMPONENTS, type Session, type ExploreResult, type Note } from './kane2.ts';
import { explorationPage, sectionHtml, comparisonPage, type Section, type Condition } from './pages.ts';
import { applySpec, componentOf } from './interventions.ts';
import { PLAYERS, type Player } from '../../rules.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const now = () => new Date().toISOString();
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
function git(args: string[]) { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } }

export type V2Config = {
  seeds: { exploration: number[]; development: number[]; holdout: number[]; headToHeadSeeds: number };
  v1: { runDir: string; games: string }; evaluation: { minUnits: number; bootstrap: number; maxSampleRows: number; minEvents?: number }; corrections: { max: number };
  adequacy: AdequacyConfig; kane: { maxCallsTotal: number; maxCreditsTotal: number; maxConcurrent: number; estimatedCredits?: { objective: number; analyzer: number }; stopOnCapabilityLimitation?: boolean; explore: { maxSteps: number; timeoutS: number }; challengeObjective: boolean; analyzerTimeoutS: number };
  budget: { maxGames: number; maxWallMinutes: number };
};
export type V2Options = {
  runKane: boolean; port: number; configFile?: string; hypothesesFile?: string; weightsFile?: string; journalFile?: string; evidenceRoot?: string;
  quick?: boolean; keepOpen?: boolean; log?: (l: string) => void; workers?: number;
};
type StageKey = 'observe' | 'explore' | 'register' | 'experiment' | 'evaluate' | 'challenge' | 'correct' | 'reobserve' | 'adequacy' | 'decide';
const STAGES: [StageKey, string, string][] = [
  ['observe', 'Observation', 'V1 evidence (hash-verified) + planner traces'],
  ['explore', 'Kane exploration', 'real kane-cli objective mode: Kane proposes explanations'],
  ['register', 'Competing hypotheses', 'pre-registered contracts (before any result)'],
  ['experiment', 'Controlled experiments', 'real engine + planner, one factor each, development seeds'],
  ['evaluate', 'Hypothesis evaluation', 'pre-registered predictions with uncertainty'],
  ['challenge', 'Kane challenge', 'real kane-cli analyzer: independent raw-row conditions'],
  ['correct', 'Corrections', 'typed, allowlisted, from surviving hypotheses only'],
  ['reobserve', 'Re-observation', 'unsealed holdout seeds, never used before'],
  ['adequacy', 'Adequacy review', 'implementation correctness vs balance adequacy'],
  ['decide', 'Decision', 'proposal / review-required / no change (never applied to production)'],
];
type Stage = { key: StageKey; title: string; source: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'checkpoint'; startedAt: string | null; endedAt: string | null; summary: string };
export type KaneCall = { callId: string; role: 'exploration' | 'challenge-analyzer' | 'challenge-objective' | 'correction-analyzer'; state: 'queued' | 'running' | 'done' | 'skipped'; url: string; objective?: string; conditions?: Condition[]; analyzer?: KaneVerifyResult | null; explore?: ExploreResult | null; liveLines: string[]; creditsBefore: number | null; creditsAfter: number | null; note: string };
export type HypRow = { id: string; title: string; origin: string; author: string; hash: string; journalSeq: number; mechanism: string; predictions: HypothesisContract['predictions']; evaluation: Evaluation | null; kaneNote?: Note };
export type V2Status = {
  schema: 'rule-sabotage/balance-v2-status@1'; runId: string; mode: 'dry-run' | 'run-kane'; startedAt: string; finishedAt: string | null; commit: string; dirty: boolean; engineHash: string; weights: string;
  stages: Stage[]; progress: { done: number; total: number; label: string } | null; checkpoint: string | null; log: string[];
  kaneCli: { installed: boolean; version: string | null; loggedIn: boolean | null; detail: string; isTestDouble: boolean };
  budgets: { kaneCallsUsed: number; kaneCallsMax: number; creditsUsed: number | null; creditsMax: number; gamesPlayed: number; gamesMax: number; creditLedger: { callId: string; role: string; before: number | null; after: number | null; used: number | null }[]; creditCapNote: string };
  seeds: { exploration: number[]; development: number[]; holdout: number[] | 'SEALED'; holdoutCommitment: string };
  observation: { v1RunId: string; v1Verified: boolean; v1Detail: string; metrics: Record<string, number | null>; effectTable: (string | number | null)[][] } | null;
  kane: KaneCall[]; exploration: { capability: string; execution: string; detail: string; notes: Note[] } | null;
  hypotheses: HypRow[]; experiments: { key: string; experiment: string; design: Design; title: string; description: string; component: string; diff: string[]; seedSet: string; games: number; ms: number; manipulation: Manipulation; summary: Record<string, number | null> }[];
  corrections: Correction[]; reviews: Review[]; decision: { overall: string; items: { correction: string; category: string; action: string; why: string }[] } | null;
  runDir: string; journalFile: string; pages: Record<string, string>;
};

export function loadV2Config(file = join(ROOT, 'balance/v2/config.json')): V2Config { return JSON.parse(readFileSync(file, 'utf8')); }
const HEALTH = ['tp_self_share', 'tp_per_game', 'tp_benefit', 'tp_self_benefit', 'tp_opp_benefit', 'tp_self_harm_rate', 'ew_share', 'ew_per_game', 'ew_aligned_share', 'ew_self_trigger_share', 'self_trigger_share', 'max_effect_share', 'effect_entropy', 'first_player_edge', 'human_side_edge', 'turns_mean', 'comeback_rate', 'lead_changes', 'draw_or_limit_rate', 'safety_events', 'conditional_win_tp'];
const summarize = (recs: GameRec[]) => Object.fromEntries(HEALTH.map(k => [k, ((v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000))(metric(k, { recs }))]));
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export async function runV2(o: V2Options): Promise<V2Status> {
  const cfg = loadV2Config(o.configFile);
  if (o.quick) {
    cfg.seeds.development = cfg.seeds.development.slice(0, 4); cfg.seeds.holdout = cfg.seeds.holdout.slice(0, 4); cfg.seeds.headToHeadSeeds = 2;
    cfg.evaluation.minUnits = 3; cfg.evaluation.minEvents = 5; cfg.evaluation.bootstrap = 200; cfg.adequacy.minUnits = 3; cfg.corrections.max = 1;
  }
  const t0 = Date.now();
  const evidenceRoot = resolve(o.evidenceRoot ?? join(ROOT, 'evidence/balance/v2-runs'));
  const runId = `${now().replace(/[:.]/g, '-').slice(0, 19)}Z-v2-${o.runKane ? 'kane' : 'dry'}`;
  const runDir = join(evidenceRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const journalFile = resolve(o.journalFile ?? join(runDir, 'journal.ndjson'));
  const lockFile = join(evidenceRoot, '.v2.lock');
  if (existsSync(lockFile)) { const pid = Number(readFileSync(lockFile, 'utf8')); let alive = false; try { process.kill(pid, 0); alive = pid !== process.pid; } catch { /* stale */ } if (alive) throw new Error(`Another V2 cycle is running (pid ${pid}).`); }
  writeFileSync(lockFile, String(process.pid));
  try { setPriority(10); } catch { /* best effort */ }
  const weights = loadWeights(o.weightsFile ? resolve(o.weightsFile) : undefined);
  const base: Weights = structuredClone(weights) as Weights;
  const vault = new SeedVault({ exploration: cfg.seeds.exploration, development: cfg.seeds.development, holdout: cfg.seeds.holdout });
  const salt = randomBytes(16).toString('hex');
  const commitment = sha(`${salt}|${cfg.seeds.holdout.join(',')}`);
  const st: V2Status = {
    schema: 'rule-sabotage/balance-v2-status@1', runId, mode: o.runKane ? 'run-kane' : 'dry-run', startedAt: now(), finishedAt: null, commit: git(['rev-parse', 'HEAD']) || 'unknown',
    dirty: git(['status', '--porcelain', '--', 'server', 'balance']) !== '', engineHash: engineSourceHash(), weights: `${weights.version}#${weights.hash}`,
    stages: STAGES.map(([key, title, source]) => ({ key, title, source, state: 'pending', startedAt: null, endedAt: null, summary: '' })), progress: null, checkpoint: null, log: [],
    kaneCli: { installed: false, version: null, loggedIn: null, detail: 'not probed', isTestDouble: false },
    budgets: { kaneCallsUsed: 0, kaneCallsMax: cfg.kane.maxCallsTotal, creditsUsed: null, creditsMax: cfg.kane.maxCreditsTotal, gamesPlayed: 0, gamesMax: cfg.budget.maxGames, creditLedger: [], creditCapNote: 'Operating ceiling, enforced between calls (balance check before each call, conservative per-call estimate, no call once spending reaches the ceiling). A single kane-cli call cannot be stopped mid-run, so it can overshoot; any overshoot is reported.' },
    seeds: { exploration: cfg.seeds.exploration, development: cfg.seeds.development, holdout: 'SEALED', holdoutCommitment: commitment },
    observation: null, kane: [], exploration: null, hypotheses: [], experiments: [], corrections: [], reviews: [], decision: null, runDir, journalFile, pages: {},
  };
  const statusFile = join(runDir, 'status.json'), logFile = join(runDir, 'cycle.log');
  const save = () => { const tmp = statusFile + '.tmp'; writeFileSync(tmp, JSON.stringify(st, null, 2)); renameSync(tmp, statusFile); };
  const log = (line: string) => { const l = redact(`[${now().slice(11, 19)}] ${line}`); st.log.push(l); if (st.log.length > 500) st.log.shift(); appendFileSync(logFile, l + '\n'); (o.log ?? console.log)(l); save(); };
  const J = (type: string, data: unknown) => appendJournal(journalFile, type, runId, null, data);
  const stage = (k: StageKey) => st.stages.find(s => s.key === k)!;
  const begin = (k: StageKey) => { const s = stage(k); s.state = 'running'; s.startedAt = now(); log(`▶ ${s.title} (${s.source})`); };
  const end = (k: StageKey, state: Stage['state'], summary: string) => { const s = stage(k); s.state = state; s.endedAt = now(); s.summary = summary; log(`${state === 'done' ? '✔' : state === 'skipped' ? '○' : '■'} ${s.title}: ${summary}`); };
  const overWall = () => (Date.now() - t0) / 60000 > cfg.budget.maxWallMinutes;
  let stopKane: string | null = null;
  const kaneCallAllowed = () => st.budgets.kaneCallsUsed < cfg.kane.maxCallsTotal && (st.budgets.creditsUsed ?? 0) < cfg.kane.maxCreditsTotal;

  // ---------- loopback server: dashboard, Kane pages, notebook endpoint
  const pages = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const server: Server = createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const send = (code: number, type: string, body: string | Buffer, csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:") => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
    if (req.method === 'POST') {
      const m = /^\/v2\/notes\/([\w-]+)$/.exec(p);
      const s = m ? sessions.get(m[1]) : null;
      if (!s) return send(404, 'text/plain', 'not found');
      let body = '';
      req.on('data', d => { body += d; if (body.length > 16384) req.destroy(); });
      req.on('end', () => { const n = acceptNote(s, body); log(`notebook: ${n.noteId} received (${n.problems.length ? `REJECTED: ${n.problems.join('; ')}` : 'valid'})`); send(200, MIME['.html'], `<!doctype html><title>Note recorded</title><p>Recorded note ${n.noteId}. ${n.problems.length ? `Not accepted: ${n.problems.join('; ')}.` : 'Thank you.'}</p><p><a href="${s.kind === 'exploration' ? '/v2/explore' : '/v2/challenge'}">Back</a></p>`, "default-src 'none'"); });
      return;
    }
    if (p === '/api/status') return send(200, MIME['.json'], JSON.stringify(st));
    const pg = /^\/v2\/(explore|challenge|correction)$/.exec(p);
    if (pg && pages.has(pg[1])) return send(200, MIME['.html'], pages.get(pg[1])!, "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    const dashRoot = resolve(ROOT, 'balance/dashboard-v2');
    const dash = resolve(dashRoot, '.' + (p === '/' ? '/index.html' : p));
    if (dash.startsWith(dashRoot + sep) && existsSync(dash) && statSync(dash).isFile()) return send(200, MIME[extname(dash)] ?? 'application/octet-stream', readFileSync(dash));
    send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(o.port, '127.0.0.1', () => r()); });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const putPage = (k: string, html: string) => { pages.set(k, html); const f = join(runDir, `page-${k}.html`); writeFileSync(f, html); st.pages[k] = relative(runDir, f); };

  log(`Balance Designer V2 ${runId} (${st.mode.toUpperCase()}) · dashboard ${baseUrl}/ · commit ${st.commit.slice(0, 10)}${st.dirty ? ' (uncommitted changes)' : ''} · engine ${st.engineHash} · weights ${st.weights}`);
  if (!o.runKane) log('DRY-RUN: kane-cli will NOT be invoked. Kane stages are SKIPPED, no finding is attributed to Kane, every adequacy verdict stays UNVERIFIED.');
  if (!existsSync(journalFile) || !readJournal(journalFile).length) J('genesis', { note: 'Balance Designer V2 journal. V1 evidence and balance/journal.ndjson are read, never modified.' });
  J('run-start', { mode: st.mode, commit: st.commit, dirty: st.dirty, engineHash: st.engineHash, weights: st.weights, seeds: { exploration: cfg.seeds.exploration, development: cfg.seeds.development, holdoutCommitment: commitment, holdoutCount: cfg.seeds.holdout.length }, config: cfg, quick: !!o.quick });

  let gamesPlayed = 0;
  const runs = new Map<string, ConditionRun>();
  const resultSeq = new Map<string, number>();
  const registry = new Registry(experimentDesigns, J);
  const play = async (experiment: string, design: Design, seedSet: ConditionRun['seedSet'], seeds: number[], spec?: ConditionRun['spec'], key?: string) => {
    const k = key ?? `${experiment}/${design}/${seedSet}`;
    const planned = seeds.length * (design === 'head-to-head' ? 4 : 2);
    if (gamesPlayed + planned > cfg.budget.maxGames) throw new Checkpoint(`CHECKPOINT: game budget (${cfg.budget.maxGames}) would be exceeded by ${k}`);
    if (overWall()) throw new Checkpoint(`CHECKPOINT: wall-clock budget (${cfg.budget.maxWallMinutes} min) reached before ${k}`);
    st.progress = { done: 0, total: planned, label: k };
    const run = await runCondition({ base, experiment, spec, design, seeds, seedSet, key: k, workers: o.workers, maxMs: 600_000, onGame: (d, t) => { st.progress = { done: d, total: t, label: k }; if (d % 4 === 0 || d === t) save(); } });
    gamesPlayed += run.games.length; st.budgets.gamesPlayed = gamesPlayed; st.progress = null;
    writeFileSync(join(runDir, `games-${k.replace(/\//g, '_')}.ndjson`), run.games.map(g => JSON.stringify(g)).join('\n') + '\n');
    runs.set(k, run);
    return run;
  };
  const record = (run: ConditionRun, control: ConditionRun | null) => {
    if (!registry.closed) registry.close(`first experiment result recorded (${run.key})`);
    const man = manipulationCheck(run, control);
    const e = J('experiment-result', { key: run.key, experiment: run.experiment, design: run.design, spec: run.spec, specHash: run.specHash, component: run.component, diff: run.diff, seedSet: run.seedSet, seeds: run.seeds, games: run.games.length, manipulation: man, summary: summarize(run.games), gamesFile: `games-${run.key.replace(/\//g, '_')}.ndjson`, gamesSha256: sha(readFileSync(join(runDir, `games-${run.key.replace(/\//g, '_')}.ndjson`))) });
    resultSeq.set(run.key, e.seq);
    st.experiments.push({ key: run.key, experiment: run.experiment, design: run.design, title: EXPERIMENTS[run.experiment]?.title ?? run.experiment, description: run.description, component: run.component, diff: run.diff, seedSet: run.seedSet, games: run.games.length, ms: run.ms, manipulation: man, summary: summarize(run.games) });
    log(`  ${run.key}: ${run.games.length} games, manipulation ${man.ok ? 'OK' : 'FAILED'} (${man.detail})`);
    return man;
  };
  const effectFor = (k: string, control: ConditionRun | null, run: ConditionRun, boot = cfg.evaluation.bootstrap) =>
    run.design === 'head-to-head' ? pairedEffect(k, null, run.games, { treated: run.treated, reference: 0.5, boot }) : run.design === 'observational' ? pairedEffect(k, null, run.games, { reference: 0, boot }) : pairedEffect(k, control!.games, run.games, { boot });

  const kaneCall = async (role: KaneCall['role'], callId: string, url: string, fn: (c: KaneCall) => Promise<void>): Promise<KaneCall> => {
    const c: KaneCall = { callId, role, state: 'queued', url, liveLines: [], creditsBefore: null, creditsAfter: null, note: '' };
    st.kane.push(c);
    if (!o.runKane) { c.state = 'skipped'; c.note = 'dry-run: kane-cli not invoked'; save(); return c; }
    const refuse = (why: string) => { c.state = 'skipped'; c.note = why; log(`Kane ${callId} REFUSED (no credits spent): ${why}`); J('kane-call-refused', { callId, role, why, budgets: st.budgets }); save(); return c; };
    if (stopKane) return refuse(stopKane);
    if (!kaneCallAllowed()) return refuse(`Kane budget exhausted (${st.budgets.kaneCallsUsed}/${cfg.kane.maxCallsTotal} calls, ${st.budgets.creditsUsed ?? 0}/${cfg.kane.maxCreditsTotal} credits used)`);
    // Credit gate. kane-cli cannot be stopped mid-call at a credit limit, so the cap is enforced BETWEEN calls only:
    // a successful balance check is required before every call, and the call is refused unless the remaining budget
    // covers a conservative estimate of its cost. A single call can still overshoot; that is reported, not hidden.
    let b: Awaited<ReturnType<typeof kaneCredits>> = null;
    if (!st.kaneCli.isTestDouble) {
      b = await kaneCredits();
      if (!b || b.credits === null) return refuse(`credit balance check failed (${b?.raw ?? 'kane-cli balance unavailable'}); no call without a verified balance`);
      const est = cfg.kane.estimatedCredits?.[role === 'exploration' || role === 'challenge-objective' ? 'objective' : 'analyzer'] ?? 0;
      const remaining = cfg.kane.maxCreditsTotal - (st.budgets.creditsUsed ?? 0);
      if (remaining < est) return refuse(`remaining budget ${remaining.toFixed(3)} credits < conservative estimate ${est} for a ${role} call`);
    }
    c.state = 'running'; st.budgets.kaneCallsUsed++;
    c.creditsBefore = b?.credits ?? null;
    await fn(c);
    if (!st.kaneCli.isTestDouble) {
      const a = await kaneCredits(); c.creditsAfter = a?.credits ?? null;
      if (c.creditsBefore !== null && c.creditsAfter !== null) st.budgets.creditsUsed = Math.round(((st.budgets.creditsUsed ?? 0) + (c.creditsBefore - c.creditsAfter)) * 1000) / 1000;
      else stopKane = `credit balance check after ${callId} failed; spending can no longer be accounted, so no further Kane calls`;
      st.budgets.creditLedger.push({ callId, role, before: c.creditsBefore, after: c.creditsAfter, used: c.creditsBefore !== null && c.creditsAfter !== null ? Math.round((c.creditsBefore - c.creditsAfter) * 1000) / 1000 : null });
      if ((st.budgets.creditsUsed ?? 0) >= cfg.kane.maxCreditsTotal) { stopKane = `actual spending ${st.budgets.creditsUsed} reached the ${cfg.kane.maxCreditsTotal}-credit ceiling`; log(`Kane credit ceiling reached: ${stopKane}`); }
    }
    c.state = 'done'; save();
    return c;
  };
  const live = (c: KaneCall) => (l: string) => { c.liveLines.push(redact(l).slice(0, 400)); if (c.liveLines.length > 60) c.liveLines.shift(); save(); };

  try {
    if (o.runKane) {
      const probe = await kaneProbe();
      st.kaneCli = { ...probe, isTestDouble: probe.version === '0.0.0-test-double' };
      log(`kane-cli: ${probe.detail} (version ${probe.version ?? 'none'})${st.kaneCli.isTestDouble ? ' — TEST DOUBLE: nothing it outputs is attributed to Kane' : ''}`);
    }
    // ================= 1. observe
    begin('observe');
    const v1Dir = resolve(ROOT, cfg.v1.runDir), v1File = join(v1Dir, cfg.v1.games);
    const v1Manifest = JSON.parse(readFileSync(join(v1Dir, 'manifest.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
    const v1Want = v1Manifest.files.find(x => x.path === cfg.v1.games)?.sha256;
    const v1Have = sha256File(v1File);
    const v1Verified = !!v1Want && v1Want === v1Have;
    if (!v1Verified) throw new Checkpoint(`FAILED: V1 evidence ${cfg.v1.games} does not match its manifest hash; refusing to build on altered evidence.`);
    const v1Games = readFileSync(v1File, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as GameRec);
    const expl = vault.exploration('observation + Kane exploration');
    const foreign = v1Games.filter(g => !expl.includes(g.seed));
    if (foreign.length) throw new Checkpoint(`FAILED: V1 games include non-exploration seeds ${foreign.map(g => g.seed).join(',')}`);
    const ids = [...new Set(v1Games.flatMap(g => [...g.placements.map(p => p.effect), ...g.triggers.map(t => t.effect)]))].sort();
    const mean = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100 : null);
    const effectTable = ids.map(id => {
      const tr = v1Games.flatMap(g => g.triggers.filter(t => t.effect === id && t.realized !== null));
      return [id, v1Games.reduce((a, g) => a + g.placements.filter(p => p.effect === id && p.p === 'human').length, 0), v1Games.reduce((a, g) => a + g.placements.filter(p => p.effect === id && p.p === 'ai').length, 0), tr.length, tr.filter(t => t.self).length, tr.filter(t => !t.self).length, mean(tr.filter(t => t.self).map(t => -t.realized!)), mean(tr.filter(t => !t.self).map(t => -t.realized!))];
    });
    const valuation = ids.map(id => { const e = effectFromId(id)!; const tr = v1Games.flatMap(g => g.triggers.filter(t => t.effect === id && t.realized !== null)); return { effect: id, prior: e.kind === 'shove' && /east|west/.test(id) ? `${activationUtility(e, 'human', base).toFixed(2)} for Human, ${activationUtility(e, 'ai', base).toFixed(2)} for AI` : `${activationUtility(e, 'human', base).toFixed(2)} (${featureOf(e)})`, measured: mean(tr.map(t => -t.realized!)), triggers: tr.length }; });
    st.observation = { v1RunId: cfg.v1.runDir.split('/').pop()!, v1Verified, v1Detail: `${cfg.v1.games} sha256 ${v1Have.slice(0, 16)}… matches the V1 manifest`, metrics: summarize(v1Games), effectTable };
    log(`V1 evidence verified (${v1Games.length} games). Observed: teleport self-trigger share ${st.observation.metrics.tp_self_share}, east/west shove self-trigger share ${st.observation.metrics.ew_self_trigger_share}, teleport benefit to activator ${st.observation.metrics.tp_benefit} squares.`);
    // planner choices with rejected alternatives: replay two exploration games with plan traces (must reproduce the recorded V1 game)
    const fw = freezeWeights(base);
    const traces: { game: string; trace: NonNullable<GameRec['planTrace']> }[] = [];
    let replay: GameRec = v1Games[0];
    for (const first of (o.quick ? ['human'] : PLAYERS) as Player[]) {
      const g = playGame(expl[0], first, { human: fw, ai: fw }, { traceTurns: o.quick ? 4 : 10 });
      const rec = v1Games.find(x => x.seed === expl[0] && x.first === first);
      const same = !!rec && rec.winner === g.winner && rec.turns === g.turns && JSON.stringify(rec.placements) === JSON.stringify(g.placements);
      if (!same) throw new Checkpoint(`FAILED: replay of V1 game ${expl[0]}/${first} does not reproduce the recorded game`);
      traces.push({ game: `${expl[0]}/${first}-first (replay reproduces the recorded V1 game)`, trace: g.planTrace ?? [] });
      if (first === 'human') replay = g;
      gamesPlayed++;
    }
    J('observation', { v1Run: cfg.v1.runDir, v1File: cfg.v1.games, v1Sha256: v1Have, v1Verified, metrics: st.observation.metrics, effectTable, replayReproduced: true });
    end('observe', 'done', `V1 evidence hash-verified; ${v1Games.length} games; replays reproduce the recorded games`);

    // ================= 2. Kane exploration
    begin('explore');
    const exploreSession = openSession(join(runDir, 'kane-explore'), 'KX1', 'exploration', 3);
    sessions.set(exploreSession.callId, exploreSession);
    const exploreHtml = explorationPage({ v1RunId: st.observation.v1RunId, v1Hash: v1Have, games: v1Games, traces, replay, valuation, effectTable }, exploreSession.nonce, `/v2/notes/${exploreSession.callId}`);
    if (vault.leaks(exploreHtml).length) throw new Checkpoint('FAILED: the exploration page contains holdout seed numbers');
    putPage('explore', exploreHtml);
    const exploreObjective = 'You are investigating an AI board-game planner. Read this whole page: how the game works, the per-effect summary, the prior valuation versus measured consequences, the raw trigger and placement histories, and the planner choices with their rejected alternatives. Work out WHY the AI uses Teleport and the east and west shoves the way it does. Consider at least two different explanations and look for rows that contradict them. Then, in the Investigation notebook form at the bottom, submit your best explanation, choose which part it involves, which measurement should change and in which direction, and write the alternative you considered. Submit at most 3 notes. Do not do anything else on the page.';
    const xc = await kaneCall('exploration', 'KX1', `${baseUrl}/v2/explore`, async c => {
      c.objective = exploreObjective;
      c.explore = await kaneExplore({ session: exploreSession, url: `${baseUrl}/v2/explore`, objective: exploreObjective, dir: join(runDir, 'kane-explore'), maxSteps: cfg.kane.explore.maxSteps, timeoutS: cfg.kane.explore.timeoutS, onLine: live(c) });
    });
    const xr = xc.explore ?? null;
    st.exploration = { capability: xr ? xr.capability : 'NOT_RUN', execution: xr ? xr.execution : 'NOT_RUN', detail: xr ? xr.capabilityDetail : xc.note, notes: exploreSession.notes };
    J('kane-exploration', { role: 'exploration (objective mode)', callId: 'KX1', state: xc.state, note: xc.note, objective: exploreObjective, url: '/v2/explore', pageSha256: sha(exploreHtml), result: xr, notes: exploreSession.notes.map(n => ({ noteId: n.noteId, problems: n.problems, receivedAt: n.receivedAt })), notesFileSha256: xr?.sha256.notes ?? null });
    // Operator rule: a real run whose exploration yields no valid hypothesis from a COMPLETE kane-cli execution stops here.
    if (o.runKane && !st.kaneCli.isTestDouble && (!xr || xr.capability !== 'OK') && cfg.kane.stopOnCapabilityLimitation !== false) {
      const why = xr ? xr.capabilityDetail : `the exploration call did not run (${xc.note})`;
      stopKane = `CAPABILITY_LIMITATION in exploration (${xr ? `${xr.execution}, ${xr.validNotes.length} valid note(s)` : 'not run'})`;
      end('explore', 'checkpoint', `${xr ? `kane-cli ${xr.version}: ${xr.capability}` : 'not run'} (${why})`);
      throw new Checkpoint(`CAPABILITY_LIMITATION: ${why}. The Kane experiment stops here; no further Kane calls, no retry without operator approval. Evidence and recording are preserved. READY_FOR_OPERATOR_V2_RESULT_REVIEW`);
    }
    if (!xr) end('explore', 'skipped', `${xc.note}. Fallback: only the labelled operator/Claude hypotheses are tested; nothing is attributed to Kane.`);
    else end('explore', 'done', `${xr.isTestDouble ? 'TEST DOUBLE' : `kane-cli ${xr.version}`}: ${xr.capability}${xr.capability === 'CAPABILITY_LIMITATION' ? ` (${xr.capabilityDetail}); fallback to labelled operator/Claude hypotheses` : ` (${xr.capabilityDetail})`}`);

    // ================= 3. register competing hypotheses (before any result exists)
    begin('register');
    const hfile = JSON.parse(readFileSync(resolve(o.hypothesesFile ?? join(ROOT, 'balance/v2/hypotheses.json')), 'utf8')) as { observation: HypothesisContract['observation']; hypotheses: Omit<HypothesisContract, 'observation'>[] };
    const contracts: HypothesisContract[] = hfile.hypotheses.map(h => ({ ...h, observation: hfile.observation } as HypothesisContract));
    // Kane's own notes become contracts only from the stored raw notes file, with checked provenance.
    const kaneOrigin = xr && !xr.isTestDouble ? 'kane' : 'kane-test-double';
    for (const n of exploreSession.notes.filter(n => !n.problems.length && xr?.capability === 'OK')) {
      const comp = COMPONENTS[n.fields.component];
      const id = `HK${contracts.filter(c => c.id.startsWith('HK')).length + 1}`;
      const base0 = { schema: 'rule-sabotage/hypothesis@1' as const, id, version: 1, title: `${kaneOrigin === 'kane' ? 'Kane' : 'Kane TEST DOUBLE'}: ${n.fields.explanation.slice(0, 80)}`, provenance: { origin: kaneOrigin as 'kane' | 'kane-test-double', author: kaneOrigin === 'kane' ? `kane-cli ${xr!.version} (objective mode, call KX1)` : 'kane-cli TEST DOUBLE', note: 'Verbatim notebook note; fields chosen by the browser agent from allowlisted options.', kane: { callId: 'KX1', rawFile: exploreSession.file, rawSha256: sha256File(exploreSession.file), noteId: n.noteId, cliVersion: xr!.version ?? 'unknown', isTestDouble: xr!.isTestDouble } }, observation: hfile.observation, mechanism: n.fields.explanation, competingExplanation: n.fields.alternative || '(none given)', competitors: ['H0'], requiredData: [], heldConstant: ['everything except the named component'], secondaryMetrics: [], safetyMetrics: ['safety_events'], rejectionCriteria: 'Refuted if the named measurement confidently does not move by the material amount in the stated direction when the named component is changed.', expectedFailureModes: ['Mapped from a browser-agent note to an allowlisted experiment; the mapping is mechanical.'], kaneRunIds: ['KX1'] };
      if (!comp?.experiment || !n.fields.metric || !n.fields.direction) { J('kane-proposal-untestable', { noteId: n.noteId, component: n.fields.component, reason: comp ? 'component has no allowlisted experiment (metric / no-defect / other)' : 'no component', fields: n.fields }); st.hypotheses.push({ id, title: base0.title, origin: kaneOrigin, author: base0.provenance.author, hash: '', journalSeq: 0, mechanism: n.fields.explanation, predictions: [], evaluation: { id, contractHash: '', outcome: 'NOT_TESTED', predictions: [], reasons: [`Kane's note names "${n.fields.component || 'nothing'}", which has no allowlisted experiment; recorded, not tested.`], counterexamples: [], kane: { corroboration: 'NOT_ASKED', detail: '' } }, kaneNote: n }); continue; }
      const design: Design = n.fields.metric === 'treated_win_rate' ? 'head-to-head' : 'selfplay';
      const exp = design === 'head-to-head' && !EXPERIMENTS[comp.experiment].designs.includes('head-to-head') ? null : comp.experiment;
      if (!exp) { J('kane-proposal-untestable', { noteId: n.noteId, reason: `${comp.experiment} has no head-to-head design`, fields: n.fields }); continue; }
      const minEffect = n.fields.metric === 'tp_self_benefit' ? 1 : n.fields.metric === 'tp_per_game' ? 0.3 : n.fields.metric === 'treated_win_rate' ? 0.05 : 0.1;
      const dir = n.fields.direction as 'decrease' | 'increase';
      contracts.push({ ...base0, interventions: [exp], primaryMetric: n.fields.metric, predictions: [
        { id: `${id}a`, experiment: exp, design, metric: n.fields.metric, direction: dir, minEffect, role: 'primary', text: `Kane: changing "${comp.label}" should make "${n.fields.metric}" ${dir}.` },
        { id: `${id}b`, experiment: exp, design, metric: n.fields.metric, direction: dir, minEffect, role: 'discriminating', versus: ['H0'], text: 'Same measurement, judged against the null hypothesis H0.' },
      ] });
    }
    for (const c of contracts) {
      const r = registry.register(c);
      st.hypotheses.push({ id: c.id, title: c.title, origin: c.provenance.origin, author: c.provenance.author, hash: r.hash, journalSeq: r.journalSeq, mechanism: c.mechanism, predictions: c.predictions, evaluation: null, ...(c.provenance.kane ? { kaneNote: exploreSession.notes.find(n => n.noteId === c.provenance.kane!.noteId) } : {}) });
      log(`  registered ${c.id} [${c.provenance.origin}] ${c.title} · hash ${r.hash} · journal #${r.journalSeq}`);
    }
    J('seeds-sealed', { holdoutCommitment: commitment, note: 'sha256(salt|holdout seeds); salt and seeds are revealed only when the holdout is unsealed' });
    end('register', 'done', `${contracts.length} contracts registered before any experiment result (${contracts.map(c => `${c.id}:${c.provenance.origin}`).join(', ')}); holdout sealed`);

    // ================= 4. controlled experiments (development seeds)
    begin('experiment');
    const dev = vault.development('controlled experiments');
    const h2hSeeds = dev.slice(0, cfg.seeds.headToHeadSeeds);
    const needed = new Map<string, { experiment: string; design: Design }>();
    for (const r of registry.all()) for (const p of r.contract.predictions) if (p.design !== 'observational') needed.set(`${p.experiment}/${p.design}`, { experiment: p.experiment, design: p.design });
    const control = await play('C0', 'selfplay', 'development', dev);
    record(control, null);
    for (const { experiment, design } of [...needed.values()].sort((a, b) => a.experiment.localeCompare(b.experiment) || a.design.localeCompare(b.design))) {
      if (experiment === 'C0') continue;
      const run = await play(experiment, design, 'development', design === 'head-to-head' ? h2hSeeds : dev);
      record(run, design === 'head-to-head' ? null : control);
    }
    end('experiment', 'done', `${st.experiments.length} conditions, ${gamesPlayed} games so far (seeds ${dev[0]}–${dev[dev.length - 1]}; head-to-head on ${h2hSeeds.length} seeds)`);

    // ================= 5. evaluate pre-registered predictions
    begin('evaluate');
    const effects = new Map<string, Effect>();
    const lookup = (experiment: string, design: Design, k: string) => {
      const key = design === 'observational' ? 'C0/selfplay/development' : `${experiment}/${design}/development`;
      const run = runs.get(key);
      if (!run) return null;
      const ek = `${experiment}/${design}/${k}`;
      if (!effects.has(ek)) effects.set(ek, design === 'observational' ? pairedEffect(k, null, run.games, { reference: 0, boot: cfg.evaluation.bootstrap }) : effectFor(k, control, run));
      const man = st.experiments.find(x => x.key === key)!.manipulation;
      return { effect: effects.get(ek)!, manipulationOk: man.ok, manipulationDetail: man.detail, resultSeq: resultSeq.get(key)! };
    };
    const evals: Evaluation[] = [];
    for (const r of registry.all()) {
      const ev = evaluateHypothesis(registry, r.contract.id, lookup, cfg.evaluation.minUnits, cfg.evaluation.minEvents ?? 0);
      evals.push(ev);
      st.hypotheses.find(h => h.id === ev.id)!.evaluation = ev;
      J('hypothesis-outcome', { id: ev.id, contractHash: ev.contractHash, outcome: ev.outcome, predictions: ev.predictions.map(p => ({ id: p.id, status: p.status, reason: p.reason, effect: p.effect && { effect: p.effect.effect, ci: p.effect.ci, units: p.effect.units, batches: p.effect.batches, sides: p.effect.sides } })), reasons: ev.reasons });
      log(`  ${ev.id}: ${ev.outcome} — ${ev.reasons[0] ?? ''}`.slice(0, 400));
    }
    end('evaluate', 'done', evals.map(e => `${e.id} ${e.outcome}`).join(' · '));

    // ================= 6. Kane challenge: independent raw-row conditions + counterexamples
    begin('challenge');
    const sections: { html: string; conds: Condition[]; id: string }[] = [];
    for (const r of registry.all()) {
      const ev = evals.find(e => e.id === r.contract.id)!;
      const p = r.contract.predictions.find(x => x.role === 'primary' && x.design !== 'observational' && (x.direction === 'decrease' || x.direction === 'increase'));
      if (!p) continue;
      const run = runs.get(`${p.experiment}/${p.design}/development`);
      if (!run) continue;
      const e = effects.get(`${p.experiment}/${p.design}/${p.metric}`) ?? effectFor(p.metric, control, run);
      const s: Section = { id: r.contract.id, title: r.contract.title, mechanism: r.contract.mechanism, origin: `${r.contract.provenance.origin} (${r.contract.provenance.author})`, intervention: `${EXPERIMENTS[p.experiment].title} [${p.design}]`, metric: p.metric, direction: p.direction as 'decrease' | 'increase', effect: e, controlGames: p.design === 'head-to-head' ? [] : control.games, treatGames: run.games, outcome: ev.outcome, reasons: ev.reasons.slice(0, 2) };
      sections.push({ ...sectionHtml(s, { control: p.design === 'head-to-head' ? 'Even (0.5)' : 'Control', treat: 'Intervention' }, cfg.evaluation.maxSampleRows), id: s.id });
    }
    const conds = sections.flatMap(s => s.conds);
    const challengeSession = openSession(join(runDir, 'kane-challenge'), 'KC2', 'challenge', 5);
    sessions.set(challengeSession.callId, challengeSession);
    const challengeHtml = comparisonPage('Rule Sabotage: competing hypotheses vs controlled experiments', `Development seeds only. Each section shows one hypothesis, the single factor that was changed, raw samples from the control and the intervention games, per-seed values, an example and a counterexample. Outcomes were decided by predictions registered before the games were played.`, sections, cfg.kane.challengeObjective ? { nonce: challengeSession.nonce, action: `/v2/notes/${challengeSession.callId}`, hypotheses: sections.map(s => s.id) } : null);
    if (vault.leaks(challengeHtml).length) throw new Checkpoint('FAILED: the challenge page contains holdout seed numbers');
    putPage('challenge', challengeHtml);
    const cc = conds.length ? await kaneCall('challenge-analyzer', 'KC1', `${baseUrl}/v2/challenge`, async c => {
      c.conditions = conds;
      c.analyzer = await kaneVerify({ url: `${baseUrl}/v2/challenge`, conditions: conds.map(x => x.text), dir: join(runDir, 'kane-challenge'), timeoutS: cfg.kane.analyzerTimeoutS, onLine: live(c) });
    }) : null;
    if (cc && !cc.conditions) cc.conditions = conds;
    let co: KaneCall | null = null;
    if (cfg.kane.challengeObjective && sections.length) co = await kaneCall('challenge-objective', 'KC2', `${baseUrl}/v2/challenge`, async c => {
      c.objective = 'Read every section on this page. For each hypothesis, decide whether its control-versus-intervention evidence really supports it, and look for counterexample seeds. Submit one note per hypothesis you judge in the Investigation notebook at the bottom. Do not do anything else.';
      c.explore = await kaneExplore({ session: challengeSession, url: `${baseUrl}/v2/challenge`, objective: c.objective, dir: join(runDir, 'kane-challenge'), maxSteps: cfg.kane.explore.maxSteps, timeoutS: cfg.kane.explore.timeoutS, onLine: live(c) });
    });
    const real = (a: KaneVerifyResult | null | undefined) => !!a && a.status === 'complete' && !a.isTestDouble;
    for (const s of sections) {
      const ev = evals.find(e => e.id === s.id)!;
      const idx = conds.map((c, i) => (c.section === s.id ? i : -1)).filter(i => i >= 0);
      let corroboration: Evaluation['kane']['corroboration'] = 'UNVERIFIED', detail = cc?.analyzer ? (cc.analyzer.isTestDouble ? 'kane-cli TEST DOUBLE: not evidence' : cc.analyzer.detail) : (cc?.note ?? 'not asked');
      if (real(cc?.analyzer)) {
        const mism = idx.filter(i => cc!.analyzer!.conditionResults[i] !== conds[i].ours);
        corroboration = mism.length ? 'DISAGREES' : 'AGREES';
        detail = mism.length ? `Kane's reading differs from ours on: ${mism.map(i => conds[i].id).join(', ')}` : `Kane independently re-derived ${idx.length} raw-row condition(s) and agrees`;
      }
      const kaneCounter = challengeSession.notes.filter(n => !n.problems.length && n.fields.hypothesis === s.id && n.fields.verdict === 'does-not-explain' && !(co?.explore?.isTestDouble)).map(n => `${n.noteId}: ${n.fields.counterexample || n.fields.explanation.slice(0, 120)}`);
      const upd = applyKaneChallenge(ev, { corroboration, detail, counterexamples: co?.explore && !co.explore.isTestDouble ? kaneCounter : [] });
      Object.assign(ev, upd);
      st.hypotheses.find(h => h.id === s.id)!.evaluation = ev;
    }
    J('kane-challenge', { role: 'verification (analyzer) + optional objective challenge', page: '/v2/challenge', pageSha256: sha(challengeHtml), conditions: conds, analyzer: cc?.analyzer ?? null, analyzerState: cc?.state ?? 'not-needed', analyzerNote: cc?.note ?? '', objective: co?.explore ?? null, outcomesAfter: evals.map(e => ({ id: e.id, outcome: e.outcome, kane: e.kane })) });
    end('challenge', cc?.state === 'done' ? 'done' : 'skipped', cc?.analyzer ? `${cc.analyzer.isTestDouble ? 'TEST DOUBLE (not evidence)' : `kane-cli ${cc.analyzer.version}`}: ${cc.analyzer.status}; ${conds.length} independent conditions over ${sections.length} hypotheses` : `${cc?.note ?? 'no testable section'}; outcomes stay as evaluated, Kane corroboration UNVERIFIED`);

    // ================= 7. corrections from surviving hypotheses
    begin('correct');
    const corrections = proposeCorrections(evals, cfg.corrections.max);
    for (const e of evals.filter(x => x.outcome === 'SUPPORTED' && x.id.startsWith('HK'))) {
      if (corrections.length >= cfg.corrections.max) break;
      const exp = registry.get(e.id)!.contract.interventions[0], spec = EXPERIMENTS[exp].spec;
      if (corrections.some(c => JSON.stringify(c.spec) === JSON.stringify(spec))) continue;
      const comp = componentOf(spec);
      corrections.push({ id: `K${corrections.length + 1}`, category: comp === 'weights' ? 'weight' : comp === 'rules' ? 'game-design' : 'planner', policy: comp === 'weights' ? 'PROPOSAL_ONLY' : comp === 'rules' ? 'EXPERIMENTAL_ONLY' : 'REVIEW_REQUIRED', basis: [e.id], origin: registry.get(e.id)!.contract.provenance.origin === 'kane' ? 'kane' : 'kane-test-double', spec, description: EXPERIMENTS[exp].title, rationale: `Proposed through ${e.id}; its experiment supported it.`, targets: registry.get(e.id)!.contract.predictions.filter(p => p.role === 'primary' && (p.direction === 'decrease' || p.direction === 'increase')).map(p => ({ metric: p.metric, direction: p.direction as 'decrease' | 'increase', minEffect: p.minEffect })) });
    }
    st.corrections = corrections;
    J('corrections-frozen', { corrections });
    end('correct', 'done', corrections.map(c => `${c.id} ${c.category}/${c.policy}: ${c.description}`).join(' · '));

    // ================= 8. re-observe on the unsealed holdout
    begin('reobserve');
    const testable = corrections.filter(c => c.spec);
    let hold: number[] = [];
    if (!testable.length) end('reobserve', 'skipped', 'no executable correction; holdout stays sealed');
    else {
      vault.unseal('corrections frozen; final evaluation');
      hold = vault.holdout('post-correction adequacy review');
      st.seeds.holdout = hold;
      if (sha(`${salt}|${hold.join(',')}`) !== commitment) throw new Checkpoint('FAILED: holdout seeds do not match their commitment');
      J('seeds-unsealed', { salt, holdout: hold, commitment, verified: true });
      const hc = await play('C0', 'selfplay', 'holdout', hold, undefined, 'C0/selfplay/holdout');
      record(hc, null);
      for (const c of testable) {
        const r = await play(`correction-${c.id}`, 'selfplay', 'holdout', hold, c.spec!, `${c.id}/selfplay/holdout`);
        record(r, hc);
        if (c.spec!.kind === 'planner') { const h = await play(`correction-${c.id}`, 'head-to-head', 'holdout', hold.slice(0, cfg.seeds.headToHeadSeeds), c.spec!, `${c.id}/head-to-head/holdout`); record(h, null); }
      }
      end('reobserve', 'done', `holdout ${hold[0]}–${hold[hold.length - 1]} unsealed once (commitment verified); ${testable.length} correction(s) re-observed`);
    }

    // ================= 9. adequacy review (+ Kane verification of the corrected behaviour)
    begin('adequacy');
    const hc = runs.get('C0/selfplay/holdout');
    const corrSections: { html: string; conds: Condition[]; id: string }[] = [];
    const prelim = new Map<string, { effects: Record<string, Effect>; run: ConditionRun; man: Manipulation }>();
    for (const c of testable) {
      const run = runs.get(`${c.id}/selfplay/holdout`)!;
      const effs: Record<string, Effect> = {};
      for (const t of c.targets) effs[t.metric] = pairedEffect(t.metric, hc!.games, run.games, { boot: cfg.evaluation.bootstrap });
      prelim.set(c.id, { effects: effs, run, man: st.experiments.find(x => x.key === `${c.id}/selfplay/holdout`)!.manipulation });
      const t = c.targets[0];
      if (t) corrSections.push({ ...sectionHtml({ id: c.id, title: `${c.category} correction: ${c.description}`, mechanism: c.rationale, origin: c.origin, intervention: c.description, metric: t.metric, direction: t.direction, effect: effs[t.metric], controlGames: hc!.games, treatGames: run.games }, { control: 'Control', treat: 'Intervention' }, cfg.evaluation.maxSampleRows), id: c.id });
    }
    const ccond = corrSections.flatMap(s => s.conds);
    let kc: KaneCall | null = null;
    if (corrSections.length) {
      const html = comparisonPage('Rule Sabotage: post-correction re-observation (holdout seeds)', 'Fresh holdout seeds, never used for hypotheses or experiment design. Each section compares the production planner/rules (control) with one correction (intervention).', corrSections, null);
      putPage('correction', html);
      kc = await kaneCall('correction-analyzer', 'KA1', `${baseUrl}/v2/correction`, async c => { c.conditions = ccond; c.analyzer = await kaneVerify({ url: `${baseUrl}/v2/correction`, conditions: ccond.map(x => x.text), dir: join(runDir, 'kane-correction'), timeoutS: cfg.kane.analyzerTimeoutS, onLine: live(c) }); });
      if (!kc.conditions) kc.conditions = ccond;
    }
    const inv = runInvariants(base);
    for (const c of corrections) {
      const pre = prelim.get(c.id);
      if (!pre) { const rv = reviewCorrection({ correction: c, effects: {}, control: {}, treated: {}, manipulation: { ok: false, detail: 'not executable', divergedGames: 0 }, invariantsPass: inv.pass, unrelatedChanged: [], kane: { status: 'UNVERIFIED', detail: 'nothing to verify', real: false }, topEffectShift: null, h2h: null }, cfg.adequacy); st.reviews.push(rv); J('adequacy-review', rv); continue; }
      const applied = applySpec(base, c.spec!);
      const unrelated: string[] = [];
      if (applied.component !== componentOf(c.spec!)) unrelated.push(`component ${applied.component}`);
      if (c.category === 'planner' && (applied.variant || applied.diff.some(d => !d.startsWith('hooks.')))) unrelated.push(applied.diff.join(','));
      if (c.category === 'weight' && applied.diff.length !== 1) unrelated.push(applied.diff.join(','));
      if (pre.run.games.some(g => (c.category !== 'game-design' && g.variant))) unrelated.push('rule variant present in a non-rule correction');
      const ctlS = summarize(hc!.games), trS = summarize(pre.run.games);
      const share = (g: GameRec[]) => { const m = new Map<string, number>(); const pl = g.flatMap(r => r.placements); pl.forEach(p => m.set(p.effect, (m.get(p.effect) ?? 0) + 1)); return { m, n: pl.length || 1 }; };
      const a = share(hc!.games), b = share(pre.run.games);
      const shift = [...b.m.keys()].map(k => ({ effect: k, before: (a.m.get(k) ?? 0) / a.n, after: (b.m.get(k) ?? 0) / b.n })).sort((x, y) => (y.after - y.before) - (x.after - x.before))[0] ?? null;
      const idx = ccond.map((x, i) => (x.section === c.id ? i : -1)).filter(i => i >= 0);
      const an = kc?.analyzer;
      const kane = !an ? { status: 'UNVERIFIED' as const, detail: kc?.note ?? 'not asked', real: false } : an.isTestDouble ? { status: 'UNVERIFIED' as const, detail: 'kane-cli TEST DOUBLE: not evidence', real: false } : an.status !== 'complete' ? { status: 'UNVERIFIED' as const, detail: `Kane ${an.status}: ${an.detail}`, real: false } : ((m: number[]) => ({ status: (m.length ? 'DISAGREES' : 'AGREES') as 'AGREES' | 'DISAGREES', detail: m.length ? `Kane's reading differs on ${m.map(i => ccond[i].id).join(', ')}` : `Kane re-derived ${idx.length} condition(s) on the holdout page and agrees`, real: true }))(idx.filter(i => an.conditionResults[i] !== ccond[i].ours));
      const h2hRun = runs.get(`${c.id}/head-to-head/holdout`);
      const rv = reviewCorrection({ correction: c, effects: pre.effects, control: ctlS, treated: trS, manipulation: pre.man, invariantsPass: inv.pass, unrelatedChanged: unrelated, kane, topEffectShift: shift, h2h: h2hRun ? pairedEffect('treated_win_rate', null, h2hRun.games, { treated: h2hRun.treated, reference: 0.5, boot: cfg.evaluation.bootstrap }) : null }, cfg.adequacy);
      st.reviews.push(rv);
      J('adequacy-review', { ...rv, invariants: inv, controlSummary: ctlS, correctionSummary: trS });
      log(`  ${c.id}: implementation ${rv.implementationCorrectness}, adequacy ${rv.balanceAdequacy} (provisional ${rv.provisionalAdequacy}) — ${rv.why}`.slice(0, 500));
    }
    end('adequacy', 'done', st.reviews.map(r => `${r.correction}: impl ${r.implementationCorrectness} / adequacy ${r.balanceAdequacy} (provisional ${r.provisionalAdequacy})`).join(' · '));

    // ================= 10. decision (never applied to production)
    begin('decide');
    const items = corrections.map(c => {
      const rv = st.reviews.find(r => r.correction === c.id)!;
      let action: string, why: string;
      if (c.policy === 'NO_CHANGE') { action = 'NO_CHANGE'; why = c.rationale; }
      else if (c.policy === 'RECORD_ONLY') { action = 'RECORDED (metric correction, no gameplay claim)'; why = c.rationale; }
      else if (rv.balanceAdequacy === 'SUFFICIENT') {
        if (c.category === 'weight') { const f = join(runDir, `proposal-${c.id}.weights.json`); writeFileSync(f, JSON.stringify(applySpec(base, c.spec!).weights, null, 2)); action = `PROPOSED (weights file ${relative(runDir, f)}; NOT applied — operator decides)`; }
        else if (c.category === 'planner') action = 'RECOMMENDED FOR REVIEWED IMPLEMENTATION (planner source change; not applied)';
        else action = 'EXPERIMENTAL ONLY (rule change needs explicit operator approval)';
        why = rv.why;
      } else { action = `NOT PROMOTED (${rv.balanceAdequacy})`; why = rv.why + (rv.nextExperiment ? ` Next: ${rv.nextExperiment}` : ''); }
      return { correction: c.id, category: c.category, action, why };
    });
    const overall = items.some(i => /^PROPOSED|^RECOMMENDED/.test(i.action)) ? 'CORRECTION RECOMMENDED (operator action required)' : corrections.every(c => !c.spec) ? `NO GAMEPLAY CHANGE (${corrections[0]?.category})` : `NO CORRECTION PROMOTED (${st.reviews.map(r => `${r.correction} ${r.balanceAdequacy}`).join(', ')})`;
    st.decision = { overall, items };
    J('decision', st.decision);
    end('decide', 'done', overall);
    st.checkpoint = !o.runKane ? 'READY_FOR_OPERATOR_REAL_KANE_V2' : st.kaneCli.isTestDouble ? 'READY_FOR_OPERATOR_REAL_KANE_V2 (pipeline exercised with the labelled Kane TEST DOUBLE)' : 'READY_FOR_OPERATOR_V2_RESULT_REVIEW';
  } catch (e) {
    const msg = e instanceof Checkpoint ? e.message : `FAILED: ${(e as Error).stack ?? e}`;
    st.checkpoint = msg;
    const running = st.stages.find(s => s.state === 'running');
    if (running) end(running.key, /^(CHECKPOINT|CAPABILITY_LIMITATION)/.test(msg) ? 'checkpoint' : 'failed', msg.slice(0, 300));
    log(msg.slice(0, 2000));
    try { J('failure', { message: msg.slice(0, 4000) }); } catch { /* journal problems are reported by verify */ }
  }
  st.finishedAt = now();
  try { J('run-end', { checkpoint: st.checkpoint, gamesPlayed, kaneCalls: st.budgets.kaneCallsUsed, credits: st.budgets.creditsUsed, wallMs: Date.now() - t0, holdoutAccess: vault.accessLog }); } catch { /* recorded in status */ }
  writeFileSync(join(runDir, 'REPORT.md'), reportV2(st));
  const vj = verifyJournal(journalFile);
  log(`Journal ${relative(ROOT, journalFile)}: ${vj.entries} entries, ${vj.ok ? 'hash chain verified' : `BROKEN: ${vj.problem}`}`);
  if (st.checkpoint) log(`■ ${st.checkpoint.split('\n')[0]}`);
  save();
  writeManifest(runDir);
  try { unlinkSync(lockFile); } catch { /* ignore */ }
  if (!o.keepOpen) await new Promise<void>(r => server.close(() => r()));
  else log(`Dashboard stays open at ${baseUrl}/ (Ctrl+C to stop)`);
  return st;
}
class Checkpoint extends Error {}

const f3 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Number(x).toFixed(3));
export function reportV2(st: V2Status): string {
  const L: string[] = [];
  L.push(`# Balance Designer V2 run ${st.runId}`, '', `**Mode:** ${st.mode}${st.kaneCli.isTestDouble ? ' with the kane-cli TEST DOUBLE (nothing from it is Kane evidence)' : ''} · **Checkpoint:** ${st.checkpoint ?? 'none'}`, '', `Commit ${st.commit}${st.dirty ? ' (uncommitted changes)' : ''} · engine ${st.engineHash} · weights ${st.weights} · ${st.budgets.gamesPlayed} games · Kane calls ${st.budgets.kaneCallsUsed}/${st.budgets.kaneCallsMax} · credits ${st.budgets.creditsUsed ?? 0}`, '');
  L.push('## Observation (V1 evidence, read-only)', '', st.observation ? `${st.observation.v1Detail}. Teleport self-trigger share ${f3(st.observation.metrics.tp_self_share)}, east/west shove self-trigger share ${f3(st.observation.metrics.ew_self_trigger_share)}, teleport benefit to the activator ${f3(st.observation.metrics.tp_benefit)} squares, conditional win rate of Teleport users ${f3(st.observation.metrics.conditional_win_tp)} (descriptive only).` : 'not reached', '');
  L.push('## Kane exploration', '', st.exploration ? `${st.exploration.capability}: ${st.exploration.detail}` : 'not reached', '');
  L.push('## Hypotheses (pre-registered) and outcomes', '', '| Id | Origin | Title | Outcome | Kane | Why |', '|---|---|---|---|---|---|');
  for (const h of st.hypotheses) L.push(`| ${h.id} | ${h.origin} | ${h.title.replace(/\|/g, '/')} | **${h.evaluation?.outcome ?? '—'}** | ${h.evaluation?.kane.corroboration ?? '—'} | ${(h.evaluation?.reasons ?? []).join('; ').replace(/\|/g, '/').slice(0, 400)} |`);
  L.push('', 'SUPPORTED means the pre-registered predictions held on these development seeds, not that the mechanism is proven.', '');
  L.push('## Experiments (real engine, real planner)', '', '| Condition | Factor changed | Seeds | Games | Manipulation check | tp_self_share | ew_self_trigger_share | tp_self_benefit | safety |', '|---|---|---|---|---|---|---|---|---|');
  for (const e of st.experiments) L.push(`| ${e.key} | ${e.description} | ${e.seedSet} | ${e.games} | ${e.manipulation.ok ? 'OK' : 'FAILED'}: ${e.manipulation.detail.replace(/\|/g, '/')} | ${f3(e.summary.tp_self_share)} | ${f3(e.summary.ew_self_trigger_share)} | ${f3(e.summary.tp_self_benefit)} | ${e.summary.safety_events} |`);
  L.push('', '## Corrections and adequacy review', '');
  for (const c of st.corrections) {
    const r = st.reviews.find(x => x.correction === c.id);
    L.push(`### ${c.id}: ${c.category} (${c.policy}) — ${c.description}`, '', `Basis: ${c.basis.join(', ')} (${c.origin}). ${c.rationale}`, '');
    if (r) {
      L.push(`**Implementation correctness:** ${r.implementationCorrectness} · **Balance adequacy:** ${r.balanceAdequacy} (provisional, before Kane: ${r.provisionalAdequacy})`, '', r.why, '');
      for (const ch of [...r.implementation, ...r.adequacy]) L.push(`- ${ch.pass === null ? '○' : ch.pass ? '✔' : '✘'} ${ch.q} ${ch.detail}`);
      if (r.unresolved.length) L.push('', `Unresolved: ${r.unresolved.join('; ')}`);
      if (r.nextExperiment) L.push('', `Next discriminating experiment: ${r.nextExperiment}`);
      L.push('');
    }
  }
  L.push('## Decision', '', st.decision ? `**${st.decision.overall}**` : 'not reached', '', ...(st.decision?.items ?? []).map(i => `- ${i.correction} (${i.category}): ${i.action}. ${i.why}`), '');
  L.push('## Kane calls', '', ...st.kane.map(k => `- ${k.callId} ${k.role}: ${k.state}${k.note ? ` (${k.note})` : ''}${k.analyzer ? ` · ${k.analyzer.isTestDouble ? 'TEST DOUBLE' : `kane-cli ${k.analyzer.version}`} ${k.analyzer.status}` : ''}${k.explore ? ` · ${k.explore.isTestDouble ? 'TEST DOUBLE' : `kane-cli ${k.explore.version}`} ${k.explore.status} ${k.explore.capability}` : ''}`), '');
  L.push('## Limitations', '', '- Divergence between control and treatment games is detected from placements, triggers and outcome; move-only differences are not logged.', '- Seed-level bootstrap intervals assume seeds are exchangeable; with 16 development seeds an effect needs to be large to be called.', '- The planner\'s heuristic path cost (basePenalty) still assumes production teleport geometry under the E4 rule variant.', '- Enjoyment is not measured. Health proxies only.', '');
  return L.join('\n');
}
export { METRICS };

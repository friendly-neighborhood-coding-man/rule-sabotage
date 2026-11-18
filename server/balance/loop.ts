/**
 * Living Balance Loop V1: one bounded, auditable closed loop.
 *
 *   baseline self-play (training seeds) → anomaly detection → Kane verification of selected
 *   anomalies (real kane-cli, only with --run-kane) → candidate weights → held-out self-play
 *   comparison → promotion or rollback → append-only journal + evidence manifest.
 *
 * Runs as its own process, never inside the game server, so live play is never blocked: the game
 * server only reads the promoted weights file when a new game starts.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync, appendFileSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setPriority } from 'node:os';
import { type Weights, type FrozenWeights, loadWeights, freezeWeights, validateWeights, weightsHash, plannerEffects, effectId, unsupportedEffects, WEIGHTS_FILE } from '../weights.ts';
import { pairedJobs, runJobs, aggregate, playGame, type GameRec, type Metrics, type Captured } from './selfplay.ts';
import { detect, type Anomaly, type Thresholds, ownAnswer } from './anomaly.ts';
import { renderEvidencePage, conditionsFor, findingFrom, type Finding } from './evidence.ts';
import { proposeCandidates, bundleCandidate, compare, nextVersion, type Candidate, type Comparison, type OptimizerConfig, type PromotionConfig } from './optimizer.ts';
import { appendJournal, readJournal, verifyJournal } from './journal.ts';
import { runInvariants, engineSourceHash } from './invariants.ts';
import { kaneVerify, kaneProbe, kaneCredits, kaneConfig, type KaneVerifyResult } from '../kane.ts';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export type LoopConfig = {
  seeds: { training: number[]; heldOut: number[] }; thresholds: Thresholds;
  kane: { maxCallsPerCycle: number; maxCallsTotal: number; maxCreditsTotal: number; maxConcurrent: number; timeoutS: number; maxEvidenceRows: number };
  optimizer: OptimizerConfig; promotion: PromotionConfig; budget: { maxCycles: number; maxGamesPerCycle: number; maxWallMinutes: number };
};
export type LoopOptions = {
  runKane: boolean; cycles: number; port: number; configFile?: string; weightsFile?: string; journalFile?: string; evidenceRoot?: string;
  quick?: boolean; runUnitTests?: boolean; keepOpen?: boolean; promote?: boolean; investigationsFile?: string; log?: (line: string) => void;
};
type StageKey = 'baseline' | 'detect' | 'kane' | 'propose' | 'evaluate' | 'decide' | 'journal';
const STAGES: [StageKey, string][] = [
  ['baseline', 'Baseline AI-vs-AI self-play (training seeds)'], ['detect', 'Statistical anomaly detection'], ['kane', 'Kane browser verification'],
  ['propose', 'Deterministic candidate weights'], ['evaluate', 'Held-out AI-vs-AI comparison'], ['decide', 'Promotion or rollback'], ['journal', 'Journal + evidence manifest'],
];
type Stage = { key: StageKey; title: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'checkpoint'; startedAt: string | null; endedAt: string | null; summary: string };
type KaneRow = { anomalyId: string; title: string; state: 'queued' | 'running' | 'done' | 'skipped' | 'reused'; url: string; page: string; conditions: Finding['conditions']; result: KaneVerifyResult | null; finding: Finding | null; startedAt: string | null; elapsedMs: number | null; liveLines: string[] };
export type CycleStatus = {
  n: number; baselineVersion: string; baselineHash: string; stages: Stage[]; progress: { done: number; total: number; label: string } | null;
  baseline: Metrics | null; anomalies: Anomaly[]; selected: string[]; kane: KaneRow[]; findings: Finding[]; candidates: Omit<Candidate, 'weights'>[];
  heldOutBaseline: Metrics | null; heldOut: Record<string, Metrics>; comparisons: Comparison[]; invariants: { pass: boolean; checked: number; failures: string[] } | null; unitTests: { pass: boolean; summary: string } | null;
  decision: { action: 'promote' | 'rollback'; candidate: string | null; fromVersion: string; toVersion: string; reasons: string[] } | null;
};
export type Status = {
  runId: string; mode: 'dry-run' | 'run-kane'; startedAt: string; finishedAt: string | null; commit: string; dirty: boolean; engineHash: string;
  node: string; platform: string; seeds: LoopConfig['seeds']; kaneCli: { installed: boolean; version: string | null; loggedIn: boolean | null; detail: string };
  budgets: { kaneCallsUsed: number; kaneCallsMax: number; creditsUsed: number | null; creditsMax: number; creditsBefore: number | null; creditsNow: number | null; gamesPlayed: number };
  cycles: CycleStatus[]; checkpoint: string | null; log: string[]; weightsHistory: { at: string; version: string; hash: string; type: string; changes: string }[];
  runDir: string; journalFile: string; unsupportedEffects: { id: string; note: string }[];
};

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const now = () => new Date().toISOString();
function git(args: string[]) { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } }

export function loadConfig(file = join(ROOT, 'balance/loop.config.json')): LoopConfig {
  const c = JSON.parse(readFileSync(file, 'utf8')) as LoopConfig;
  const overlap = c.seeds.training.filter(s => c.seeds.heldOut.includes(s));
  if (overlap.length) throw new Error(`Training and held-out seeds overlap: ${overlap.join(', ')}`);
  if (!c.seeds.training.length || !c.seeds.heldOut.length) throw new Error('Both seed sets must be non-empty.');
  return c;
}

/** Never let a key or token reach logs, the dashboard or recordings. */
export const redact = (s: string) => s.replace(/(sk-or-[\w-]{8,}|nvapi-[\w-]{8,}|gsk_\w{8,}|Bearer\s+[\w.-]{12,}|(?:api[_-]?key|token|secret)["'=: ]+[\w.-]{12,})/gi, '[REDACTED]');

class Semaphore { private q: (() => void)[] = []; private n: number; constructor(n: number) { this.n = Math.max(1, n); } async run<T>(f: () => Promise<T>): Promise<T> { if (this.n <= 0) await new Promise<void>(r => this.q.push(r)); this.n--; try { return await f(); } finally { this.n++; this.q.shift()?.(); } } }

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

export async function runLoop(o: LoopOptions): Promise<Status> {
  const cfg = loadConfig(o.configFile);
  if (o.quick) { cfg.seeds.training = cfg.seeds.training.slice(0, 4); cfg.seeds.heldOut = cfg.seeds.heldOut.slice(0, 4); cfg.thresholds.minTriggers = Math.min(cfg.thresholds.minTriggers, 4); cfg.thresholds.minGamesUsed = Math.min(cfg.thresholds.minGamesUsed, 3); cfg.optimizer.maxCandidates = Math.min(cfg.optimizer.maxCandidates, 2); }
  const cycles = Math.max(1, Math.min(o.cycles, cfg.budget.maxCycles));
  const weightsFile = resolve(o.weightsFile ?? WEIGHTS_FILE);
  const evidenceRoot = resolve(o.evidenceRoot ?? join(ROOT, 'evidence/balance/runs'));
  const runId = `${now().replace(/[:.]/g, '-').slice(0, 19)}Z-${o.runKane ? 'kane' : 'dry'}`;
  const runDir = join(evidenceRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const journalFile = resolve(o.journalFile ?? (o.runKane ? join(ROOT, 'balance/journal.ndjson') : join(runDir, 'journal.ndjson')));
  const investigationsFile = resolve(o.investigationsFile ?? join(ROOT, 'balance/investigations.json'));
  const lockFile = join(evidenceRoot, '..', '.loop.lock');
  if (existsSync(lockFile)) {
    const pid = Number(readFileSync(lockFile, 'utf8'));
    let alive = false; try { process.kill(pid, 0); alive = pid !== process.pid; } catch { /* stale */ }
    if (alive) throw new Error(`Another balance loop is running (pid ${pid}). Only one loop at a time.`);
  }
  writeFileSync(lockFile, String(process.pid));
  try { setPriority(10); } catch { /* best effort: stay out of the way of live games */ }
  const t0 = Date.now();
  const logFile = join(runDir, 'loop.log');
  const st: Status = {
    runId, mode: o.runKane ? 'run-kane' : 'dry-run', startedAt: now(), finishedAt: null, commit: git(['rev-parse', 'HEAD']) || 'unknown', dirty: git(['status', '--porcelain', '--', 'server', 'balance/loop.config.json', 'balance/balance.weights.json']) !== '',
    engineHash: engineSourceHash(), node: process.version, platform: process.platform, seeds: cfg.seeds, kaneCli: { installed: false, version: null, loggedIn: null, detail: 'not probed' },
    budgets: { kaneCallsUsed: 0, kaneCallsMax: Math.min(cfg.kane.maxCallsTotal, cfg.kane.maxCallsPerCycle * cycles), creditsUsed: null, creditsMax: cfg.kane.maxCreditsTotal, creditsBefore: null, creditsNow: null, gamesPlayed: 0 },
    cycles: [], checkpoint: null, log: [], weightsHistory: [], runDir, journalFile, unsupportedEffects: [],
  };
  const statusFile = join(runDir, 'status.json');
  const save = () => { const tmp = statusFile + '.tmp'; writeFileSync(tmp, JSON.stringify(st, null, 2)); renameSync(tmp, statusFile); writeFileSync(join(evidenceRoot, '..', 'current.json'), JSON.stringify({ runId, statusFile: relative(ROOT, statusFile) })); };
  const log = (line: string) => {
    const l = redact(`[${now().slice(11, 19)}] ${line}`);
    st.log.push(l); if (st.log.length > 400) st.log.shift();
    appendFileSync(logFile, l + '\n'); (o.log ?? console.log)(l); save();
  };
  const history = () => {
    st.weightsHistory = readJournal(journalFile).filter(e => ['baseline', 'promote', 'rollback'].includes(e.type)).map(e => { const d = e.data as Record<string, unknown>; return { at: e.at, version: String(d.version ?? d.toVersion ?? ''), hash: String(d.hash ?? ''), type: e.type, changes: String(d.changes ?? '') }; });
  };

  // ---------- dashboard + evidence server (loopback only)
  const server: Server = createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const send = (code: number, type: string, body: string | Buffer, csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'") => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
    if (p === '/api/status') return send(200, MIME['.json'], JSON.stringify(st));
    const ev = p.match(/^\/evidence\/([\w.-]+)\/([\w.-]+\.(?:html|json|md))$/);
    if (ev) {
      const f = resolve(evidenceRoot, ev[1], ev[2]);
      if (!f.startsWith(evidenceRoot + sep) || !existsSync(f)) return send(404, 'text/plain', 'not found');
      return send(200, MIME[extname(f)] ?? 'text/plain', readFileSync(f), "default-src 'none'; style-src 'unsafe-inline'");
    }
    const dash = resolve(ROOT, 'balance/dashboard', '.' + (p === '/' ? '/index.html' : p));
    if (dash.startsWith(resolve(ROOT, 'balance/dashboard') + sep) && existsSync(dash) && statSync(dash).isFile()) return send(200, MIME[extname(dash)] ?? 'application/octet-stream', readFileSync(dash));
    send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(o.port, '127.0.0.1', () => r()); });
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  log(`Balance loop ${runId} (${st.mode.toUpperCase()}) · dashboard ${base}/ · commit ${st.commit.slice(0, 10)}${st.dirty ? ' (uncommitted changes)' : ''} · engine ${st.engineHash}`);
  if (!o.runKane) log('DRY-RUN: kane-cli will NOT be invoked. Findings stay UNVERIFIED and nothing can be promoted. Pass --run-kane for real verification.');

  let current: FrozenWeights = loadWeights(weightsFile);
  st.unsupportedEffects = unsupportedEffects(current);
  if (st.unsupportedEffects.length) log(`Unsupported future effects in the weights file (never simulated): ${st.unsupportedEffects.map(u => u.id).join(', ')}`);
  if (!existsSync(journalFile) || !readJournal(journalFile).length) {
    // carry the V0.3 bundle's own append-only ledger forward verbatim (none of it is a Kane action)
    const ledger = join(ROOT, 'balance/v0.3-bundle/kane-balance-events.jsonl');
    if (existsSync(ledger)) appendJournal(journalFile, 'import-v0.3-ledger', runId, null, { source: 'balance/v0.3-bundle/kane-balance-events.jsonl', sha256: sha(readFileSync(ledger)), events: readFileSync(ledger, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) });
    appendJournal(journalFile, 'baseline', runId, null, { version: current.version, hash: current.hash, weights: current, changes: 'initial weights (Rule Space V0.3 human-prior-v0)' });
  }
  const jv = verifyJournal(journalFile);
  if (!jv.ok) throw new Error(`Journal ${journalFile} failed verification: ${jv.problem}`);
  history();
  appendJournal(journalFile, 'run-start', runId, null, { mode: st.mode, commit: st.commit, dirty: st.dirty, engineHash: st.engineHash, weights: `${current.version}#${current.hash}`, seeds: cfg.seeds, budgets: st.budgets, config: cfg });

  if (o.runKane) {
    const pr = await kaneProbe();
    st.kaneCli = pr;
    log(`kane-cli: ${pr.detail}${pr.version ? ` (version ${pr.version})` : ''}`);
    const cr = await kaneCredits();
    st.budgets.creditsBefore = cr?.credits ?? null; st.budgets.creditsNow = st.budgets.creditsBefore;
    log(`Kane credits before: ${cr?.raw ?? 'n/a'}`);
  }
  const sem = new Semaphore(cfg.kane.maxConcurrent);
  const investigations: Record<string, { finding: Finding; runId: string; at: string; evidence: string }> = existsSync(investigationsFile) ? JSON.parse(readFileSync(investigationsFile, 'utf8')) : {};
  const wallLeft = () => cfg.budget.maxWallMinutes * 60_000 - (Date.now() - t0);
  const plannerIds = plannerEffects(current).map(effectId);

  try {
    for (let n = 1; n <= cycles; n++) {
      const cy: CycleStatus = {
        n, baselineVersion: current.version, baselineHash: current.hash, stages: STAGES.map(([key, title]) => ({ key, title, state: 'pending', startedAt: null, endedAt: null, summary: '' })), progress: null,
        baseline: null, anomalies: [], selected: [], kane: [], findings: [], candidates: [], heldOutBaseline: null, heldOut: {}, comparisons: [], invariants: null, unitTests: null, decision: null,
      };
      st.cycles.push(cy);
      const cdir = join(runDir, `cycle-${n}`); mkdirSync(cdir, { recursive: true });
      const stage = (k: StageKey) => cy.stages.find(s => s.key === k)!;
      const begin = (k: StageKey) => { const s = stage(k); s.state = 'running'; s.startedAt = now(); log(`── cycle ${n} · ${s.title}`); };
      const end = (k: StageKey, state: Stage['state'], summary: string) => { const s = stage(k); s.state = state; s.endedAt = now(); s.summary = summary; log(`   ${state.toUpperCase()}: ${summary}`); };
      let gamesThisCycle = 0;
      const play = async (label: string, seeds: number[], w: Weights) => {
        const jobs = pairedJobs(seeds, w);
        if (gamesThisCycle + jobs.length > cfg.budget.maxGamesPerCycle) throw new Error(`experiment budget: ${label} would exceed ${cfg.budget.maxGamesPerCycle} games this cycle`);
        if (wallLeft() <= 0) throw new Error(`wall-clock budget of ${cfg.budget.maxWallMinutes} min exhausted`);
        cy.progress = { done: 0, total: jobs.length, label };
        const recs = await runJobs(jobs, { maxMs: 900_000, onGame: (d, t) => { cy.progress = { done: d, total: t, label }; if (d % 4 === 0 || d === t) save(); } });
        gamesThisCycle += jobs.length; st.budgets.gamesPlayed += jobs.length; cy.progress = null;
        return recs;
      };
      const writeGames = (file: string, recs: GameRec[]) => writeFileSync(join(cdir, file), recs.map(r => JSON.stringify(r)).join('\n') + '\n');

      // 1. baseline
      begin('baseline');
      const trainRecs = await play(`baseline ${current.version} on ${cfg.seeds.training.length} training seeds ×2`, cfg.seeds.training, current);
      writeGames('baseline-training-games.ndjson', trainRecs);
      cy.baseline = aggregate(trainRecs);
      writeFileSync(join(cdir, 'baseline-training-metrics.json'), JSON.stringify(cy.baseline, null, 2));
      const B = cy.baseline;
      end('baseline', 'done', `${B.games} games · wins H ${B.wins.human} / AI ${B.wins.ai} / draw ${B.wins.draw} · first-player win ${(B.firstPlayerWinRate * 100).toFixed(0)}% · median ${B.turns.median} turns · entropy ${B.diversity.effectEntropyNorm} · safety ${B.safety.illegal}/${B.safety.errors}/${B.safety.softlocks}`);

      // 2. detect
      begin('detect');
      cy.anomalies = detect(B, trainRecs, cfg.thresholds, cfg.kane.maxEvidenceRows, plannerIds);
      writeFileSync(join(cdir, 'anomalies.json'), JSON.stringify(cy.anomalies, null, 2));
      for (const a of cy.anomalies) log(`   ${a.id} [${a.type}] ${a.title} · severity ${a.severity}${a.knob ? '' : ' · not weight-tunable'}${a.kaneCheckable ? '' : ' · no Kane template'}`);
      end('detect', 'done', `${cy.anomalies.length} anomalies (hypotheses, not proof)`);
      if (cy.anomalies.some(a => a.type === 'safety-violation')) { st.checkpoint = 'STOPPED: self-play produced illegal actions, engine errors or softlocks. Weights cannot fix that.'; end('kane', 'checkpoint', st.checkpoint); break; }

      // 3. Kane
      begin('kane');
      // weight-tunable anomalies first (they can lead to a change); spare budget goes to rule-level ones (verified, recorded, never tuned)
      const checkable = cy.anomalies.filter(a => a.kaneCheckable && a.check && a.check.rows.length >= 3);
      const selectable = [...checkable.filter(a => a.knob), ...checkable.filter(a => !a.knob)];
      const sel = selectable.filter((a, i, l) => l.findIndex(b => b.fingerprint === a.fingerprint) === i).slice(0, cfg.kane.maxCallsPerCycle);
      cy.selected = sel.map(a => a.id);
      log(`   selected for Kane: ${sel.map(a => `${a.id}${a.knob ? '' : ' (rule-level)'}`).join(', ') || 'none'} (max ${cfg.kane.maxCallsPerCycle}/cycle; weight-tunable first)`);
      for (const a of sel) {
        // real-engine replay of the first evidence row (for trigger tables), and a reproducibility check of that game
        let replay: Captured | null = null;
        if (a.check!.replay?.length) {
          const r0 = a.check!.replay[0];
          const rr = playGame(r0.seed, r0.first, { human: current, ai: current }, { capture: { turn: r0.turn, cell: r0.cell } });
          const orig = trainRecs.find(r => r.seed === r0.seed && r.first === r0.first)!;
          const same = rr.winner === orig.winner && rr.turns === orig.turns && rr.triggers.length === orig.triggers.length;
          log(`   ${a.id}: replayed seed ${r0.seed}/${r0.first} on the real engine: ${same ? 'identical result (reproducible)' : 'DIFFERENT result (not reproducible!)'}`);
          replay = same ? rr.captured ?? null : null;
        }
        const conditions = conditionsFor(a, replay);
        const page = renderEvidencePage({ a, replay, commit: st.commit, weights: `${current.version}#${current.hash}`, cycle: n, generatedAt: now(), reproduce: `npm run balance:replay -- --seed ${a.check!.replay?.[0]?.seed ?? cfg.seeds.training[0]} --first ${a.check!.replay?.[0]?.first ?? 'human'}${a.check!.replay?.[0] ? ` --turn ${a.check!.replay[0].turn}` : ''} --weights balance/history/weights-${current.version}.json\n(training seeds ${cfg.seeds.training.join(',')}; each played with both sides starting)` });
        const file = `cycle-${n}-${a.id}-evidence.html`;
        writeFileSync(join(runDir, file), page);
        const pageKey = sha(page.replace(/Generated [^.]+\./, '').replace(/Cycle \d+\./, ''));
        cy.kane.push({ anomalyId: a.id, title: a.title, state: 'queued', url: `${base}/evidence/${runId}/${file}`, page: file, conditions, result: null, finding: null, startedAt: null, elapsedMs: null, liveLines: [] });
        (a as Anomaly & { pageKey?: string }).pageKey = pageKey;
      }
      save();
      await Promise.all(sel.map(a => sem.run(async () => {
        const row = cy.kane.find(k => k.anomalyId === a.id)!;
        const key = `${a.fingerprint}@${(a as Anomaly & { pageKey?: string }).pageKey}`;
        const prior = investigations[key];
        if (prior && prior.finding.verifier === 'kane-cli' && prior.finding.status !== 'UNVERIFIED') {
          row.state = 'reused'; row.finding = { ...prior.finding, anomalyId: a.id, reason: `${prior.finding.reason} (reused: identical evidence page was already verified by kane-cli in run ${prior.runId})` };
          cy.findings.push(row.finding); log(`   ${a.id}: identical evidence already verified in run ${prior.runId} → ${row.finding.status} (no new Kane call)`); return;
        }
        if (!o.runKane) { row.state = 'skipped'; row.finding = findingFrom(a, row.conditions, null); row.finding.reason = 'DRY-RUN: kane-cli was not invoked, so this anomaly is UNVERIFIED.'; cy.findings.push(row.finding); return; }
        if (!st.kaneCli.installed || st.kaneCli.loggedIn === false) { row.state = 'skipped'; row.finding = findingFrom(a, row.conditions, null); row.finding.reason = `CHECKPOINT: kane-cli unavailable (${st.kaneCli.detail}).`; cy.findings.push(row.finding); st.checkpoint = row.finding.reason; return; }
        if (st.budgets.kaneCallsUsed >= st.budgets.kaneCallsMax) { row.state = 'skipped'; row.finding = findingFrom(a, row.conditions, null); row.finding.reason = `BUDGET: Kane call budget (${st.budgets.kaneCallsMax}) exhausted.`; cy.findings.push(row.finding); st.checkpoint = row.finding.reason; return; }
        if (st.budgets.creditsUsed !== null && st.budgets.creditsUsed >= st.budgets.creditsMax) { row.state = 'skipped'; row.finding = findingFrom(a, row.conditions, null); row.finding.reason = `BUDGET: credit budget (${st.budgets.creditsMax}) exhausted (${st.budgets.creditsUsed} used).`; cy.findings.push(row.finding); st.checkpoint = row.finding.reason; return; }
        st.budgets.kaneCallsUsed++;
        row.state = 'running'; row.startedAt = now(); save();
        log(`   ${a.id}: kane-cli run --analyzer-only on ${row.url} (${row.conditions.length} conditions, timeout ${cfg.kane.timeoutS}s)`);
        const res = await kaneVerify({ url: row.url, conditions: row.conditions.map(c => c.text), dir: join(cdir, `kane-${a.id}`), timeoutS: cfg.kane.timeoutS, onLine: l => { row.liveLines.push(redact(l).slice(0, 300)); if (row.liveLines.length > 40) row.liveLines.shift(); save(); } });
        row.result = res; row.elapsedMs = res.elapsedMs; row.state = 'done';
        row.finding = findingFrom(a, row.conditions, res);
        cy.findings.push(row.finding);
        const cr = await kaneCredits();
        if (cr?.credits != null && st.budgets.creditsBefore != null) { st.budgets.creditsNow = cr.credits; st.budgets.creditsUsed = Math.round((st.budgets.creditsBefore - cr.credits) * 1000) / 1000; }
        log(`   ${a.id}: Kane ${res.status} in ${(res.elapsedMs / 1000).toFixed(1)} s (exit ${res.exitCode}) · conditions ${res.conditionResults.map(v => (v === null ? '?' : v ? 'T' : 'F')).join('')} → ${row.finding.status} · credits used so far ${st.budgets.creditsUsed ?? 'n/a'}`);
        if (row.finding.verifier === 'kane-cli' && row.finding.status !== 'UNVERIFIED') investigations[key] = { finding: row.finding, runId, at: now(), evidence: relative(ROOT, join(runDir, row.page)) };
      })));
      writeFileSync(investigationsFile, JSON.stringify(investigations, null, 2));
      writeFileSync(join(cdir, 'findings.json'), JSON.stringify({ findings: cy.findings, kane: cy.kane }, null, 2));
      const fs = cy.findings.map(f => `${f.anomalyId} ${f.status}`).join(', ') || 'none';
      end('kane', !o.runKane ? 'skipped' : st.checkpoint && !cy.findings.some(f => f.verifier === 'kane-cli') ? 'checkpoint' : 'done', `${o.runKane ? '' : 'DRY-RUN (kane-cli not invoked) · '}findings: ${fs}`);
      appendJournal(journalFile, 'investigation', runId, n, { mode: st.mode, anomalies: cy.anomalies.map(a => ({ id: a.id, type: a.type, subject: a.subject, value: a.value, threshold: a.threshold, severity: a.severity })), selected: cy.selected, findings: cy.findings.map(f => ({ ...f })), kane: cy.kane.map(k => ({ anomalyId: k.anomalyId, state: k.state, evidence: k.page, result: k.result && { status: k.result.status, version: k.result.version, isTestDouble: k.result.isTestDouble, conditionResults: k.result.conditionResults, elapsedMs: k.result.elapsedMs, exitCode: k.result.exitCode, files: k.result.files } })), creditsUsed: st.budgets.creditsUsed });

      // 4. propose
      begin('propose');
      const cands = proposeCandidates(current, cy.anomalies, cy.findings, cfg.optimizer, n);
      const bundleFile = join(ROOT, 'balance/v0.3-candidate.weights.json');
      if (existsSync(bundleFile)) { const bv = validateWeights(JSON.parse(readFileSync(bundleFile, 'utf8'))); const bc = bv.ok ? bundleCandidate(current, bv.weights, `C${cands.length + 1}`) : null; if (bc) cands.push(bc); }
      cy.candidates = cands.map(({ weights, ...c }) => { void weights; return c; });
      for (const c of cands) { writeFileSync(join(cdir, `candidate-${c.id}.weights.json`), JSON.stringify(c.weights, null, 2)); log(`   ${c.id} ${c.changes.map(x => `${x.path} ${x.old}→${x.proposed}`).join(', ')} · ${c.eligibilityReason}`); }
      if (!cands.length) {
        end('propose', 'done', 'no candidate: no investigated, non-refuted, weight-tunable anomaly');
        cy.decision = { action: 'rollback', candidate: null, fromVersion: current.version, toVersion: current.version, reasons: ['No candidate weights were proposed (nothing Kane-investigated and tunable survived).'] };
        stage('evaluate').state = 'skipped'; stage('decide').state = 'done'; stage('decide').summary = 'ROLLBACK (no candidate): weights unchanged';
        appendJournal(journalFile, 'rollback', runId, n, { version: current.version, hash: current.hash, reasons: cy.decision.reasons, changes: 'none' });
      } else {
        end('propose', 'done', `${cands.length} candidate(s); ${cands.filter(c => c.eligible).length} eligible for promotion`);
        // 5. evaluate on held-out seeds
        begin('evaluate');
        const hb = await play(`baseline ${current.version} on held-out seeds`, cfg.seeds.heldOut, current);
        writeGames('baseline-heldout-games.ndjson', hb);
        cy.heldOutBaseline = aggregate(hb);
        writeFileSync(join(cdir, 'baseline-heldout-metrics.json'), JSON.stringify(cy.heldOutBaseline, null, 2));
        for (const c of cands) {
          const recs = await play(`${c.id} (${c.version}) on held-out seeds`, cfg.seeds.heldOut, c.weights);
          writeGames(`candidate-${c.id}-heldout-games.ndjson`, recs);
          cy.heldOut[c.id] = aggregate(recs);
          writeFileSync(join(cdir, `candidate-${c.id}-heldout-metrics.json`), JSON.stringify(cy.heldOut[c.id], null, 2));
          log(`   ${c.id}: first-player win ${(cy.heldOut[c.id].firstPlayerWinRate * 100).toFixed(0)}% · median ${cy.heldOut[c.id].turns.median} turns · entropy ${cy.heldOut[c.id].diversity.effectEntropyNorm}`);
        }
        end('evaluate', 'done', `baseline + ${cands.length} candidate(s) on ${cfg.seeds.heldOut.length} held-out seeds ×2`);
        // 6. decide
        begin('decide');
        cy.invariants = runInvariants(current);
        const hashNow = engineSourceHash();
        log(`   engine invariant suite: ${cy.invariants.pass ? 'PASS' : 'FAIL'} (${cy.invariants.checked} trials) · engine source ${hashNow === st.engineHash ? 'unchanged' : 'CHANGED'}`);
        if (o.runUnitTests !== false && cands.some(c => c.eligible)) {
          log('   running unit test suite (npm test) as a hard safety gate…');
          cy.unitTests = await new Promise(res => {
            const ch = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', '--test', ...readdirSync(join(ROOT, 'tests')).filter(f => f.endsWith('.test.ts')).map(f => join('tests', f))], { cwd: ROOT, env: { ...process.env, KANE_REFEREE: 'off' } });
            let out = ''; ch.stdout.on('data', d => out += d); ch.stderr.on('data', d => out += d);
            ch.on('close', code => res({ pass: code === 0, summary: (out.match(/ℹ (tests|pass|fail) \d+/g) ?? []).join(', ') || `exit ${code}` }));
          });
          writeFileSync(join(cdir, 'unit-tests.txt'), JSON.stringify(cy.unitTests));
          log(`   unit tests: ${cy.unitTests!.pass ? 'PASS' : 'FAIL'} (${cy.unitTests!.summary})`);
        }
        const safety = { invariantsPass: cy.invariants.pass && (cy.unitTests?.pass ?? true), engineHashUnchanged: hashNow === st.engineHash, detail: `invariants ${cy.invariants.pass ? 'pass' : 'FAIL: ' + cy.invariants.failures.slice(0, 2).join('; ')}; unit tests ${cy.unitTests ? cy.unitTests.summary : 'not run (no eligible candidate)'}; engine source ${hashNow}` };
        cy.comparisons = cands.map(c => compare(c, cy.anomalies, cy.heldOutBaseline!, cy.heldOut[c.id], cfg.promotion, safety));
        for (const cmp of cy.comparisons) log(`   ${cmp.candidate}: ${cmp.pass ? 'PASSES all gates' : `rejected (${cmp.rejectReasons.length} gate(s) failed)`} · score ${cmp.score}`);
        const winner = cy.comparisons.filter(c => c.pass).sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))[0];
        if (winner && o.promote !== false) {
          const c = cands.find(x => x.id === winner.candidate)!;
          const promoted: Weights = { ...structuredClone(c.weights), version: nextVersion(current.version), parent: current.version, createdAt: now(), label: `Promoted in run ${runId} cycle ${n} from ${c.id}: ${c.changes.map(x => `${x.path} ${x.old}→${x.proposed}`).join(', ')}` };
          const v = validateWeights(promoted);
          if (!v.ok) throw new Error(`promotion produced invalid weights: ${v.errors.join('; ')}`);
          mkdirSync(join(ROOT, 'balance/history'), { recursive: true });
          writeFileSync(join(ROOT, `balance/history/weights-${promoted.version}.json`), JSON.stringify(promoted, null, 2) + '\n');
          writeFileSync(weightsFile, JSON.stringify(promoted, null, 2) + '\n');
          const fz = freezeWeights(promoted);
          cy.decision = { action: 'promote', candidate: c.id, fromVersion: current.version, toVersion: promoted.version, reasons: [`${c.id} passed every gate with the best score (${winner.score}).`, ...winner.target.map(t => `${t.metric}: ${t.baseline} → ${t.candidate}`), ...cy.comparisons.filter(x => x !== winner).map(x => `${x.candidate} not chosen: ${x.pass ? `lower score ${x.score}` : x.rejectReasons.join(' | ')}`)] };
          appendJournal(journalFile, 'promote', runId, n, { fromVersion: current.version, toVersion: promoted.version, version: promoted.version, hash: fz.hash, candidate: c.id, changes: c.changes.map(x => `${x.path} ${x.old}→${x.proposed}`).join(', '), changeRecords: c.changes, comparison: winner, allComparisons: cy.comparisons, heldOutBaseline: summary(cy.heldOutBaseline!), heldOutCandidate: summary(cy.heldOut[c.id]), weights: promoted });
          end('decide', 'done', `PROMOTE ${c.id}: ${current.version} → ${promoted.version}`);
          current = fz;
        } else {
          cy.decision = { action: 'rollback', candidate: null, fromVersion: current.version, toVersion: current.version, reasons: cy.comparisons.map(x => `${x.candidate}: ${x.pass ? (o.promote === false ? 'passed but promotion disabled (--no-promote)' : 'passed') : x.rejectReasons.join(' | ')}`) };
          appendJournal(journalFile, 'rollback', runId, n, { version: current.version, hash: current.hash, changes: 'none (kept baseline)', reasons: cy.decision.reasons, comparisons: cy.comparisons, candidates: cy.candidates, heldOutBaseline: summary(cy.heldOutBaseline!), heldOutCandidates: Object.fromEntries(Object.entries(cy.heldOut).map(([k, m]) => [k, summary(m)])) });
          end('decide', 'done', `ROLLBACK: kept ${current.version} (${cy.comparisons.filter(x => x.pass).length}/${cy.comparisons.length} candidates passed every gate)`);
        }
      }
      history();
      // 7. journal + manifest for this cycle
      begin('journal');
      writeFileSync(join(cdir, 'cycle.json'), JSON.stringify(cy, null, 2));
      end('journal', 'done', `journal ${relative(ROOT, journalFile)} (${readJournal(journalFile).length} entries, chain ${verifyJournal(journalFile).ok ? 'verified' : 'BROKEN'})`);
      if (st.checkpoint) { log(`CHECKPOINT: ${st.checkpoint}`); break; }
      if (n < cycles && !cy.findings.some(f => f.status === 'CONFIRMED') && cy.decision?.action === 'rollback' && !cy.anomalies.some(a => a.kaneCheckable && a.knob && !cy.selected.includes(a.id))) { log('No new investigable anomaly for another cycle; stopping early.'); break; }
    }
  } catch (e) {
    st.checkpoint = `FAILED: ${(e as Error).message}`;
    log(st.checkpoint);
    const cy = st.cycles[st.cycles.length - 1];
    const running = cy?.stages.find(s => s.state === 'running');
    if (running) { running.state = 'failed'; running.endedAt = now(); running.summary = (e as Error).message; }
    appendJournal(journalFile, 'failure', runId, cy?.n ?? null, { error: (e as Error).message, stage: running?.key ?? null });
  } finally {
    st.finishedAt = now();
    if (o.runKane) { const cr = await kaneCredits(); if (cr?.credits != null) { st.budgets.creditsNow = cr.credits; if (st.budgets.creditsBefore != null) st.budgets.creditsUsed = Math.round((st.budgets.creditsBefore - cr.credits) * 1000) / 1000; } log(`Kane credits after: ${cr?.raw ?? 'n/a'}`); }
    appendJournal(journalFile, 'run-end', runId, null, { checkpoint: st.checkpoint, weights: `${current.version}#${current.hash}`, kaneCalls: st.budgets.kaneCallsUsed, creditsUsed: st.budgets.creditsUsed, games: st.budgets.gamesPlayed, wallMs: Date.now() - t0 });
    history();
    if (resolve(journalFile) !== resolve(join(runDir, 'journal.ndjson'))) copyFileSync(journalFile, join(runDir, 'journal-snapshot.ndjson'));
    writeFileSync(join(runDir, 'REPORT.md'), report(st));
    log(`Report: ${relative(ROOT, join(runDir, 'REPORT.md'))}`);
    writeManifest(runDir);
    save();
    try { unlinkSync(lockFile); } catch { /* ignore */ }
    if (o.keepOpen) log(`Dashboard stays open at ${base}/ (Ctrl+C to stop)`); else await new Promise<void>(r => server.close(() => r()));
  }
  return st;
}

const summary = (m: Metrics) => ({ games: m.games, wins: m.wins, firstPlayerWinRate: m.firstPlayerWinRate, humanSideWinRate: m.humanSideWinRate, turns: m.turns, drawRate: m.drawRate, turnLimitRate: m.turnLimitRate, diversity: m.diversity, counterplay: m.counterplay, safety: m.safety, effects: Object.fromEntries(Object.entries(m.effects).map(([k, e]) => [k, { share: e.share, triggers: e.triggers, harmfulRate: e.harmfulRate, realizedMean: e.realizedMean, predictedMean: e.predictedMean, winRateWhenUsed: e.winRateWhenUsed, unusedRate: e.unusedRate }])) });

export function writeManifest(dir: string) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f !== 'manifest.json' && f !== 'status.json.tmp') { const b = readFileSync(p); files.push({ path: relative(dir, p).split(sep).join('/'), bytes: b.length, sha256: sha(b) }); } } };
  walk(dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ generatedAt: now(), note: 'sha256 of every evidence file in this run directory (status.json changes until the run ends; recordings are added by the recorder).', files }, null, 2));
}

function pct(x: number) { return `${(x * 100).toFixed(0)}%`; }
export function report(st: Status): string {
  const L: string[] = [];
  L.push(`# Living Balance Loop: run ${st.runId}`, '', `Mode **${st.mode.toUpperCase()}** · commit \`${st.commit}\`${st.dirty ? ' (with uncommitted changes)' : ''} · engine \`${st.engineHash}\` · ${st.node} on ${st.platform}`, `Started ${st.startedAt} · finished ${st.finishedAt}`, '');
  L.push(`Training seeds ${st.seeds.training.join(', ')} · held-out seeds ${st.seeds.heldOut.join(', ')} (each played twice, both sides starting).`, '');
  if (st.checkpoint) L.push(`> **Checkpoint:** ${st.checkpoint}`, '');
  L.push(`Kane: ${st.mode === 'dry-run' ? 'not invoked (dry-run)' : `kane-cli ${st.kaneCli.version ?? 'n/a'} · ${st.budgets.kaneCallsUsed} call(s) · credits used ${st.budgets.creditsUsed ?? 'n/a'} (before ${st.budgets.creditsBefore ?? 'n/a'}, after ${st.budgets.creditsNow ?? 'n/a'})`} · games played ${st.budgets.gamesPlayed}`, '');
  for (const c of st.cycles) {
    L.push(`## Cycle ${c.n} (baseline weights ${c.baselineVersion} #${c.baselineHash})`, '');
    if (c.baseline) { const b = c.baseline; L.push('### 1. Baseline AI-vs-AI (training seeds)', '', `${b.games} games: Human side ${b.wins.human}, AI side ${b.wins.ai}, draws ${b.wins.draw}. First player wins ${pct(b.firstPlayerWinRate)} of decisive games (${b.pairsSweptByFirst}/${b.pairs} seed pairs won by the first mover both times). Median ${b.turns.median} turns (p10 ${b.turns.p10}, p90 ${b.turns.p90}). Effect entropy ${b.diversity.effectEntropyNorm}, ${b.diversity.distinctOpenings} distinct openings. Illegal ${b.safety.illegal}, errors ${b.safety.errors}, softlocks ${b.safety.softlocks}.`, '', '| Effect | Placements (share) | Triggers | Self-trigger | Hurt the piece | Realized / predicted per trigger | Unused cells | Win rate when used |', '|---|---|---|---|---|---|---|---|');
      for (const [id, e] of Object.entries(b.effects)) L.push(`| ${id} | ${e.placements} (${pct(e.share)}) | ${e.triggers} | ${pct(e.selfTriggerRate)} | ${pct(e.harmfulRate)} | ${e.realizedMean} / ${e.predictedMean} | ${pct(e.unusedRate)} | ${e.winRateWhenUsed === null ? '-' : pct(e.winRateWhenUsed)} |`);
      L.push('');
    }
    L.push('### 2. What looked wrong (statistical anomalies: hypotheses, not proof)', '');
    for (const a of c.anomalies) L.push(`- **${a.id}** \`${a.type}\` ${a.title}. Severity ${a.severity}.${a.knob ? '' : ' Not weight-tunable.'}${a.note ? ` ${a.note}` : ''}`);
    L.push('', '### 3. What Kane verified (real kane-cli browser checks on the evidence page)', '');
    if (!c.kane.length) L.push('No anomaly was selected for Kane.');
    for (const k of c.kane) {
      L.push(`- **${k.anomalyId}** evidence page \`${k.page}\` · ${k.state}${k.result ? ` · kane-cli ${k.result.version}${k.result.isTestDouble ? ' (TEST DOUBLE, NOT KANE)' : ''} · ${k.result.status} in ${(k.result.elapsedMs / 1000).toFixed(1)} s · exit ${k.result.exitCode}` : ''} → **${k.finding?.status ?? 'UNVERIFIED'}**: ${k.finding?.reason ?? ''}`);
      for (const cd of k.finding?.conditions ?? k.conditions) L.push(`  - ${cd.id} (${cd.role}) Kane: **${cd.kane === null ? 'no answer' : cd.kane ? 'TRUE' : 'FALSE'}**${cd.kaneReason ? ` — “${String(cd.kaneReason).slice(0, 220)}”` : ''}. Statement: ${cd.text}`);
      if (k.finding && k.finding.ownAnswer !== null) L.push(`  - Our own computation on the same rows says the hypothesis statement is ${k.finding.ownAnswer ? 'true' : 'false'}${k.finding.kaneAgreesWithOwnData === null ? '' : `; Kane ${k.finding.kaneAgreesWithOwnData ? 'agrees' : 'DISAGREES'}`}.`);
    }
    L.push('', '### 4. What changed (deterministic candidates)', '');
    if (!c.candidates.length) L.push('No candidates.');
    for (const cd of c.candidates) L.push(`- **${cd.id}** ${cd.changes.map(x => `\`${x.path}\` ${x.old} → ${x.proposed}`).join(', ')}. ${cd.changes[0]?.reason ?? ''} · ${cd.eligibilityReason}`);
    L.push('', '### 5. Did it improve? (held-out seeds)', '');
    if (c.heldOutBaseline) {
      L.push('| Metric | Baseline | ' + c.candidates.map(x => x.id).join(' | ') + ' |', '|---|---|' + c.candidates.map(() => '---|').join(''));
      const row = (name: string, f: (m: Metrics) => string | number) => L.push(`| ${name} | ${f(c.heldOutBaseline!)} | ${c.candidates.map(x => f(c.heldOut[x.id])).join(' | ')} |`);
      row('First-player win rate', m => pct(m.firstPlayerWinRate)); row('Human-side win rate', m => pct(m.humanSideWinRate)); row('Median turns', m => m.turns.median); row('Draw rate', m => pct(m.drawRate));
      row('Effect entropy (norm.)', m => m.diversity.effectEntropyNorm); row('Distinct openings', m => m.diversity.distinctOpenings); row('Lead changes / game', m => m.counterplay.leadChangesPerGame); row('Illegal / errors / softlocks', m => `${m.safety.illegal}/${m.safety.errors}/${m.safety.softlocks}`);
      L.push('');
      for (const cmp of c.comparisons) { L.push(`**${cmp.candidate}** ${cmp.pass ? 'passed every gate' : 'was rejected'} (score ${cmp.score}):`); for (const g of cmp.gates) L.push(`- ${g.pass ? '✅' : '❌'} ${g.name}: ${g.detail}`); L.push(''); }
    }
    L.push('### 6. Decision', '', c.decision ? `**${c.decision.action.toUpperCase()}** ${c.decision.action === 'promote' ? `${c.decision.candidate}: ${c.decision.fromVersion} → ${c.decision.toVersion}` : `(weights stay ${c.decision.fromVersion})`}` : 'No decision (the cycle stopped early).', '', ...(c.decision?.reasons ?? []).map(r => `- ${r}`), '');
  }
  L.push('## Weight history (journal)', '', '| When | Event | Version | Hash | Changes |', '|---|---|---|---|---|', ...st.weightsHistory.map(h => `| ${h.at} | ${h.type} | ${h.version} | ${h.hash} | ${h.changes} |`), '');
  L.push(`Journal: \`${relative(ROOT, st.journalFile)}\` (append-only, hash-chained; verify with \`npm run balance:verify-journal\`). Evidence: \`${relative(ROOT, st.runDir)}\` (manifest.json has sha256 of every file).`);
  return L.join('\n') + '\n';
}

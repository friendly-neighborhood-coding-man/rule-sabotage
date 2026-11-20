/**
 * Kane CLI referee adapter. Runs the REAL kane-cli against a trial page:
 *
 *   mode "analyzer" (default): we open the trial page in a local headless Chrome with a
 *     CDP port, then run
 *       kane-cli run --analyzer-only --agent --cdp-endpoint <cdp> --timeout <s> --condition ... (x7)
 *     and read condition_results / condition_reasons from the NDJSON run_end event.
 *   mode "objective": kane-cli run "<objective>" --url <trial url> --agent --headless --max-steps N
 *     and read run_end.status.
 *
 * Nothing here fabricates a verdict: if the process fails, times out, or its output has no
 * run_end with one boolean per condition, the result is "unverified".
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

export type KaneStatus = 'approved' | 'rejected' | 'unverified';
/** Measured time per stage of one review (ms). null = the stage did not run. */
export type KaneTimings = {
  cache: 'hit' | 'miss' | 'joined-in-flight'; probeMs: number | null; evidenceWriteMs: number | null;
  browserSpawnMs: number | null; cdpReadyMs: number | null; cdpReady: boolean | null;
  cliMs: number | null; cliFirstOutputMs: number | null; cliRunEndMs: number | null;
  parseMs: number | null; cleanupMs: number | null; totalMs: number;
};
export type KaneResult = {
  status: KaneStatus; reason: string; conditionResults: (boolean | null)[]; conditionReasons: (string | null)[];
  elapsedMs: number; exitCode: number | null; evidencePath: string | null; mode: string; cached: boolean; version: string | null;
  /** version is whatever the CLI reported; the unit-test double reports 0.0.0-test-double. */
  cacheKey?: string; timings?: KaneTimings;
};

// Cache scope: a verdict is reused only for the same trial content, the same conditions, the same Kane CLI
// (path, version, mode) and the same rule-engine source. Changing engine/rules/trial/ai (the rollout uses the planner) changes ENGINE_HASH.
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
export const ENGINE_HASH = createHash('sha256').update(['./engine.ts', './rules.ts', './trial.ts', './ai.ts'].map(f => { try { return readFileSync(here(f), 'utf8'); } catch { return f; } }).join('\0')).digest('hex').slice(0, 12);
export const REFEREE_POLICY_VERSION = 'kane-conditions-v4.1';
/** The trial page without its run-specific id and timestamps, so two identical trials hash the same. */
export const normalizedPage = (html: string, trialId: string) => html.split(trialId).join('T????');
export function reviewCacheKey(o: { signature: string; html: string; trialId: string; conditions: string[]; cli: string; version: string | null; mode: string }) {
  return createHash('sha256').update(JSON.stringify({ v: REFEREE_POLICY_VERSION, engine: ENGINE_HASH, sig: o.signature, page: normalizedPage(o.html, o.trialId), conditions: o.conditions, cli: o.cli, version: o.version, mode: o.mode })).digest('hex').slice(0, 20);
}

export const kaneConfig = () => ({
  // V4.1 (operator decision 2026-11-20): the Kane referee is OPT-IN. Unset or anything but 'on' = engine-only referee.
  enabled: process.env.KANE_REFEREE === 'on',
  cli: process.env.KANE_CLI || 'kane-cli',
  mode: (process.env.KANE_MODE === 'objective' ? 'objective' : 'analyzer') as 'analyzer' | 'objective',
  timeoutS: Math.max(20, Math.min(600, Number(process.env.KANE_TIMEOUT_S) || 300)),
  chrome: process.env.KANE_CHROME || findChrome(),
  evidenceDir: resolve(process.env.KANE_EVIDENCE_DIR || 'evidence/kane'),
});

function findChrome(): string | null {
  const c = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return c.find(p => existsSync(p)) ?? null;
}

function spawnCli(args: string[]): ChildProcess {
  const cli = kaneConfig().cli;
  if (/\.(c?js|mjs)$/.test(cli)) return spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  if (process.platform === 'win32') {
    // .cmd shims need a shell on Windows. Our arguments never contain double quotes.
    const quoted = args.map(a => (/[\s&|<>^()]/.test(a) ? `"${a}"` : a));
    return spawn(cli, quoted, { shell: true, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  }
  return spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Exported for Balance Designer V2 (objective-mode exploration). Same process handling as the referee. */
export function runCapture(args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<{ code: number | null; stdout: string; stderr: string; ms: number; timedOut: boolean; firstOutputMs: number | null; runEndMs: number | null }> {
  return new Promise(res => {
    const t0 = Date.now();
    let stdout = '', stderr = '', timedOut = false, firstOutputMs: number | null = null, runEndMs: number | null = null;
    let child: ChildProcess;
    try { child = spawnCli(args); } catch (e) { res({ code: null, stdout, stderr: String(e), ms: 0, timedOut, firstOutputMs, runEndMs }); return; }
    const timer = setTimeout(() => {
      timedOut = true;
      // On Windows the .cmd shim runs under cmd.exe; killing it leaves kane-cli running and holding the pipes.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
      else child.kill();
    }, timeoutMs);
    child.stdout!.on('data', d => {
      if (firstOutputMs === null) firstOutputMs = Date.now() - t0;
      stdout += d;
      if (onLine) for (const l of String(d).split(/\r?\n/)) if (l.trim()) onLine(l.trim());
      if (runEndMs === null && /"type"\s*:\s*"run_end"/.test(stdout)) runEndMs = Date.now() - t0;
    });
    child.stderr!.on('data', d => { if (firstOutputMs === null) firstOutputMs = Date.now() - t0; stderr += d; });
    child.stdin!.end();
    child.on('error', e => { stderr += String(e); });
    child.on('close', code => { clearTimeout(timer); res({ code, stdout, stderr, ms: Date.now() - t0, timedOut, firstOutputMs, runEndMs }); });
  });
}

let versionCache: { at: number; cli: string; version: string | null; whoami: string | null } | null = null;
/** Probe whether kane-cli is installed (and logged in). Cached for 5 minutes. */
export async function kaneProbe(): Promise<{ installed: boolean; version: string | null; loggedIn: boolean | null; detail: string }> {
  const cfg = kaneConfig();
  if (!cfg.enabled) return { installed: false, version: null, loggedIn: null, detail: 'Kane referee is off (opt-in: set KANE_REFEREE=on)' };
  if (!versionCache || versionCache.cli !== cfg.cli || Date.now() - versionCache.at > 300_000) {
    const v = await runCapture(['--version'], 15_000);
    const version = v.code === 0 ? v.stdout.trim().split(/\s+/).pop() || null : null;
    let whoami: string | null = null;
    if (version) { const w = await runCapture(['whoami'], 20_000); whoami = w.code === 0 && !/not logged in/i.test(w.stdout + w.stderr) ? 'ok' : 'not logged in (run kane-cli login)'; }
    versionCache = { at: Date.now(), cli: cfg.cli, version, whoami };
  }
  const { version, whoami } = versionCache;
  return { installed: !!version, version, loggedIn: version ? whoami === 'ok' : null, detail: version ? (whoami === 'ok' ? 'kane-cli ready' : `kane-cli found but whoami failed: ${whoami}`) : 'kane-cli not found on PATH (set KANE_CLI)' };
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
}

async function openChrome(url: string): Promise<{ cdp: string; spawnMs: number; readyMs: number; ready: boolean; close: () => Promise<void> }> {
  const t0 = Date.now();
  const chrome = kaneConfig().chrome;
  if (!chrome) throw new Error('No Chrome/Chromium found for the trial page (set KANE_CHROME).');
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'rs-kane-'));
  const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), url], { stdio: 'ignore', windowsHide: true });
  // Without an 'error' listener a missing browser binary is an uncaught exception (it crashed Node on Windows).
  let spawnErr: Error | null = null;
  child.on('error', e => { spawnErr = e; });
  const spawnMs = Date.now() - t0;
  const cdp = `http://127.0.0.1:${port}`;
  let ready = false;
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (spawnErr) { await rm(profile, { recursive: true, force: true }).catch(() => {}); throw new Error(`could not start the browser at ${chrome}: ${(spawnErr as Error).message}`); }
    try {
      const r = await fetch(`${cdp}/json/list`);
      const pages = await r.json() as { url: string; type: string }[];
      if (pages.some(p => p.type === 'page' && p.url.startsWith(url))) { ready = true; break; }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return { cdp, spawnMs, readyMs: Date.now() - t0 - spawnMs, ready, close: async () => { child.kill(); await new Promise(r => setTimeout(r, 300)); await rm(profile, { recursive: true, force: true }).catch(() => {}); } };
}

/** Parse kane-cli --agent NDJSON. Only a run_end with one boolean per condition counts as a verdict. */
export function parseKaneOutput(stdout: string, nConditions: number, mode: 'analyzer' | 'objective') {
  let runEnd: Record<string, unknown> | null = null;
  const errors: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim(); if (!t.startsWith('{')) continue;
    try {
      const ev = JSON.parse(t);
      if (ev.type === 'run_end') runEnd = ev;
      if (ev.type === 'error' && ev.message) errors.push(String(ev.message));
    } catch { /* ignore non-JSON */ }
  }
  if (!runEnd) return { verdict: null as KaneStatus | null, results: [] as (boolean | null)[], reasons: [] as (string | null)[], detail: errors[0] || 'kane-cli produced no run_end event' };
  if (mode === 'analyzer') {
    const results = Array.isArray(runEnd.condition_results) ? (runEnd.condition_results as unknown[]).map(v => (typeof v === 'boolean' ? v : null)) : [];
    const reasons = Array.isArray(runEnd.condition_reasons) ? (runEnd.condition_reasons as unknown[]).map(v => (typeof v === 'string' ? v : null)) : [];
    if (results.length !== nConditions || results.some(v => v === null)) return { verdict: null, results, reasons, detail: String(runEnd.reason ?? runEnd.summary ?? 'incomplete condition results') };
    return { verdict: (results.every(Boolean) ? 'approved' : 'rejected') as KaneStatus, results, reasons, detail: '' };
  }
  const st = String(runEnd.status ?? '');
  if (st === 'passed') return { verdict: 'approved' as KaneStatus, results: [true], reasons: [String(runEnd.summary ?? '')], detail: '' };
  if (st === 'failed') return { verdict: 'rejected' as KaneStatus, results: [false], reasons: [String(runEnd.summary ?? '')], detail: '' };
  return { verdict: null, results: [], reasons: [], detail: `run_end status ${st || 'missing'}` };
}

/** The process is killed this long after start. KANE_KILL_AFTER_MS exists only so tests can exercise the timeout path quickly. */
const hardTimeoutMs = (timeoutS: number) => Number(process.env.KANE_KILL_AFTER_MS) || (timeoutS + 30) * 1000;
const cache = new Map<string, KaneResult>();
const inflight = new Map<string, Promise<KaneResult>>();
const CACHE_MAX = 500;
export const kaneCacheStats = () => ({ size: cache.size, inflight: inflight.size, engineHash: ENGINE_HASH, policy: REFEREE_POLICY_VERSION });
/** Test hook. */
export function clearKaneCache() { cache.clear(); }

/**
 * Judges one trial page with the real kane-cli. Verdicts are cached only when Kane gave a complete
 * verdict (approved/rejected); unverified results are never cached. Identical concurrent requests share one run.
 */
export async function kaneJudge(opts: { trialId: string; signature: string; url: string; html: string; conditions: string[] }): Promise<KaneResult> {
  const t0 = Date.now();
  const cfg = kaneConfig();
  const p0 = Date.now();
  const probe = await kaneProbe();
  const probeMs = Date.now() - p0;
  const timings = (o: Partial<KaneTimings>): KaneTimings => ({ cache: 'miss', probeMs, evidenceWriteMs: null, browserSpawnMs: null, cdpReadyMs: null, cdpReady: null, cliMs: null, cliFirstOutputMs: null, cliRunEndMs: null, parseMs: null, cleanupMs: null, totalMs: Date.now() - t0, ...o });
  const base = { conditionResults: [] as (boolean | null)[], conditionReasons: [] as (string | null)[], exitCode: null as number | null, evidencePath: null as string | null, mode: cfg.mode, cached: false, version: null as string | null };
  if (!probe.installed) return { ...base, status: 'unverified', reason: `Kane unavailable: ${probe.detail}`, elapsedMs: Date.now() - t0, timings: timings({}) };
  const cacheKey = reviewCacheKey({ signature: opts.signature, html: opts.html, trialId: opts.trialId, conditions: opts.conditions, cli: cfg.cli, version: probe.version, mode: cfg.mode });
  const hit = cache.get(cacheKey);
  if (hit) return { ...hit, cached: true, elapsedMs: 0, cacheKey, timings: timings({ cache: 'hit' }) };
  const running = inflight.get(cacheKey);
  if (running) {
    const r = await running;
    return { ...r, cached: true, cacheKey, timings: timings({ cache: 'joined-in-flight' }), reason: r.status === 'unverified' ? r.reason : `${r.reason} (shared with an identical review that was already running)` };
  }
  const run = runKane(opts, cfg, probe.version, cacheKey, t0, probeMs);
  inflight.set(cacheKey, run);
  try {
    const result = await run;
    if (result.status === 'approved' || result.status === 'rejected') {
      cache.set(cacheKey, result);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return result;
  } finally { inflight.delete(cacheKey); }
}

async function runKane(opts: { trialId: string; signature: string; url: string; html: string; conditions: string[] }, cfg: ReturnType<typeof kaneConfig>, version: string | null, cacheKey: string, t0: number, probeMs: number): Promise<KaneResult> {
  const tm: KaneTimings = { cache: 'miss', probeMs, evidenceWriteMs: null, browserSpawnMs: null, cdpReadyMs: null, cdpReady: null, cliMs: null, cliFirstOutputMs: null, cliRunEndMs: null, parseMs: null, cleanupMs: null, totalMs: 0 };
  const base = { conditionResults: [] as (boolean | null)[], conditionReasons: [] as (string | null)[], exitCode: null as number | null, evidencePath: null as string | null, mode: cfg.mode, cached: false, version, cacheKey };
  let w0 = Date.now();
  await mkdir(cfg.evidenceDir, { recursive: true });
  const dir = join(cfg.evidenceDir, `${opts.trialId}-${opts.signature}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'trial.html'), opts.html);
  tm.evidenceWriteMs = Date.now() - w0;
  let out: Awaited<ReturnType<typeof runCapture>>;
  let args: string[];
  if (cfg.mode === 'analyzer') {
    let browser: Awaited<ReturnType<typeof openChrome>> | null = null;
    try {
      browser = await openChrome(opts.url);
      tm.browserSpawnMs = browser.spawnMs; tm.cdpReadyMs = browser.readyMs; tm.cdpReady = browser.ready;
      args = ['run', '--analyzer-only', '--agent', '--cdp-endpoint', browser.cdp, '--timeout', String(cfg.timeoutS), ...opts.conditions.flatMap(c => ['--condition', c])];
      out = await runCapture(args, hardTimeoutMs(cfg.timeoutS));
    } catch (e) {
      tm.totalMs = Date.now() - t0;
      return { ...base, status: 'unverified', reason: `Kane run could not start: ${(e as Error).message}`, elapsedMs: Date.now() - t0, evidencePath: dir, timings: tm };
    } finally { const c0 = Date.now(); await browser?.close(); if (browser) tm.cleanupMs = Date.now() - c0; }
  } else {
    const objective = `Open the page and check every statement. Pass only if ALL are true: ${opts.conditions.map((c, i) => `(${i + 1}) ${c}`).join(' ')}`;
    args = ['run', objective, '--url', opts.url, '--agent', '--headless', '--max-steps', '8', '--timeout', String(cfg.timeoutS)];
    out = await runCapture(args, hardTimeoutMs(cfg.timeoutS));
  }
  tm.cliMs = out.ms; tm.cliFirstOutputMs = out.firstOutputMs; tm.cliRunEndMs = out.runEndMs;
  const pr0 = Date.now();
  const parsed = parseKaneOutput(out.stdout, opts.conditions.length, cfg.mode);
  tm.parseMs = Date.now() - pr0;
  const elapsedMs = Date.now() - t0;
  const failed = parsed.results.map((r, i) => (r === false ? `${opts.conditions[i]}${parsed.reasons[i] ? ` — Kane: ${parsed.reasons[i]}` : ''}` : null)).filter(Boolean);
  const result: KaneResult = {
    ...base, exitCode: out.code, evidencePath: dir, elapsedMs,
    conditionResults: parsed.results, conditionReasons: parsed.reasons,
    status: parsed.verdict ?? 'unverified',
    reason: parsed.verdict === 'approved' ? `Kane checked ${opts.conditions.length} conditions: all true.`
      : parsed.verdict === 'rejected' ? `Kane flagged: ${failed[0] ?? parsed.reasons[0] ?? 'a condition failed'}`
      : out.timedOut ? `Kane timed out after ${Math.round(elapsedMs / 1000)}s (unverified).` : `Kane gave no verdict: ${parsed.detail}`.slice(0, 300),
  };
  w0 = Date.now();
  await writeFile(join(dir, 'kane-stdout.ndjson'), out.stdout);
  await writeFile(join(dir, 'kane-stderr.txt'), out.stderr);
  tm.evidenceWriteMs = (tm.evidenceWriteMs ?? 0) + (Date.now() - w0);
  tm.totalMs = Date.now() - t0;
  result.timings = tm;
  await writeFile(join(dir, 'result.json'), JSON.stringify({ ...result, args: args.map(a => (a.length > 200 ? a.slice(0, 200) + '…' : a)), trialId: opts.trialId, signature: opts.signature, engineHash: ENGINE_HASH, policy: REFEREE_POLICY_VERSION, at: new Date().toISOString() }, null, 2));
  return result;
}

// ---------------------------------------------------------------- balance-loop verification
export type KaneVerifyResult = {
  /** complete = Kane returned one boolean per condition. Anything else is UNVERIFIED. */
  status: 'complete' | 'incomplete' | 'timeout' | 'unavailable' | 'error';
  conditionResults: (boolean | null)[]; conditionReasons: (string | null)[]; detail: string;
  exitCode: number | null; timedOut: boolean; version: string | null; isTestDouble: boolean; cli: string; mode: 'analyzer';
  args: string[]; startedAt: string; finishedAt: string; elapsedMs: number;
  timings: { browserSpawnMs: number | null; cdpReadyMs: number | null; cdpReady: boolean | null; cliMs: number | null; cliFirstOutputMs: number | null; cliRunEndMs: number | null };
  files: { stdout: string | null; stderr: string | null; result: string | null };
};
export const TEST_DOUBLE_VERSION = '0.0.0-test-double';
/**
 * Runs the REAL kane-cli (analyzer mode, one verdict per condition) on a page served at `url`.
 * No cache, no retries, no fallback: whatever kane-cli prints is stored verbatim in `dir`.
 */
export async function kaneVerify(opts: { url: string; conditions: string[]; dir: string; timeoutS?: number; onLine?: (line: string) => void }): Promise<KaneVerifyResult> {
  const cfg = kaneConfig(), t0 = Date.now(), startedAt = new Date().toISOString();
  const timeoutS = Math.max(20, Math.min(600, opts.timeoutS ?? cfg.timeoutS));
  const probe = await kaneProbe();
  const r: KaneVerifyResult = {
    status: 'unavailable', conditionResults: [], conditionReasons: [], detail: '', exitCode: null, timedOut: false, version: probe.version, isTestDouble: probe.version === TEST_DOUBLE_VERSION,
    cli: cfg.cli, mode: 'analyzer', args: [], startedAt, finishedAt: '', elapsedMs: 0,
    timings: { browserSpawnMs: null, cdpReadyMs: null, cdpReady: null, cliMs: null, cliFirstOutputMs: null, cliRunEndMs: null }, files: { stdout: null, stderr: null, result: null },
  };
  await mkdir(opts.dir, { recursive: true });
  const done = async () => {
    r.finishedAt = new Date().toISOString(); r.elapsedMs = Date.now() - t0;
    r.files.result = join(opts.dir, 'kane-result.json');
    await writeFile(r.files.result, JSON.stringify({ ...r, conditions: opts.conditions, url: opts.url }, null, 2));
    return r;
  };
  if (!probe.installed || probe.loggedIn === false) { r.detail = `Kane unavailable: ${probe.detail}`; return done(); }
  // V4 credit safety (research path only; kaneJudge, the game referee, is not affected): a REAL kane-cli run needs the paid-call token.
  const { paidCallTokenActive, isGateTestFixture } = await import('./balance/v4/kanebudget.ts');
  if (!r.isTestDouble && !isGateTestFixture(probe.version) && !paidCallTokenActive()) { r.detail = 'Paid Kane call refused (V4 credit safety: paid research calls are disabled by default).'; return done(); }
  let browser: Awaited<ReturnType<typeof openChrome>> | null = null;
  let out: Awaited<ReturnType<typeof runCapture>>;
  try {
    browser = await openChrome(opts.url);
    Object.assign(r.timings, { browserSpawnMs: browser.spawnMs, cdpReadyMs: browser.readyMs, cdpReady: browser.ready });
    r.args = ['run', '--analyzer-only', '--agent', '--cdp-endpoint', browser.cdp, '--timeout', String(timeoutS), ...opts.conditions.flatMap(c => ['--condition', c])];
    out = await runCapture(r.args, Number(process.env.KANE_KILL_AFTER_MS) || (timeoutS + 30) * 1000, opts.onLine);
  } catch (e) { r.status = 'error'; r.detail = `Kane run could not start: ${(e as Error).message}`; return done(); }
  finally { await browser?.close(); }
  Object.assign(r.timings, { cliMs: out.ms, cliFirstOutputMs: out.firstOutputMs, cliRunEndMs: out.runEndMs });
  r.exitCode = out.code; r.timedOut = out.timedOut;
  r.files.stdout = join(opts.dir, 'kane-stdout.ndjson'); r.files.stderr = join(opts.dir, 'kane-stderr.txt');
  await writeFile(r.files.stdout, out.stdout); await writeFile(r.files.stderr, out.stderr);
  const parsed = parseKaneOutput(out.stdout, opts.conditions.length, 'analyzer');
  r.conditionResults = parsed.results; r.conditionReasons = parsed.reasons;
  r.status = parsed.verdict ? 'complete' : out.timedOut ? 'timeout' : 'incomplete';
  r.detail = parsed.verdict ? `Kane returned ${opts.conditions.length} condition results.` : out.timedOut ? `kane-cli timed out after ${Math.round(out.ms / 1000)} s` : parsed.detail;
  return done();
}

/** `kane-cli balance` as printed (credits), or null. */
export async function kaneCredits(): Promise<{ raw: string; credits: number | null } | null> {
  const probe = await kaneProbe();
  if (!probe.installed) return null;
  const o = await runCapture(['balance'], 30_000);
  const raw = (o.stdout || o.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 400);
  const m = /([0-9][0-9,]*\.?[0-9]*)/.exec(raw.split(/credits?/i).pop() ?? raw);
  return { raw, credits: m ? Number(m[1].replace(/,/g, '')) : null };
}

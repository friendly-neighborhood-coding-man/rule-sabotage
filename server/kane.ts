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
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

export type KaneStatus = 'approved' | 'rejected' | 'unverified';
export type KaneResult = {
  status: KaneStatus; reason: string; conditionResults: (boolean | null)[]; conditionReasons: (string | null)[];
  elapsedMs: number; exitCode: number | null; evidencePath: string | null; mode: string; cached: boolean; version: string | null;
};

export const kaneConfig = () => ({
  enabled: process.env.KANE_REFEREE !== 'off',
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

function runCapture(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; ms: number; timedOut: boolean }> {
  return new Promise(res => {
    const t0 = Date.now();
    let stdout = '', stderr = '', timedOut = false;
    let child: ChildProcess;
    try { child = spawnCli(args); } catch (e) { res({ code: null, stdout, stderr: String(e), ms: 0, timedOut }); return; }
    const timer = setTimeout(() => {
      timedOut = true;
      // On Windows the .cmd shim runs under cmd.exe; killing it leaves kane-cli running and holding the pipes.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
      else child.kill();
    }, timeoutMs);
    child.stdout!.on('data', d => { stdout += d; });
    child.stderr!.on('data', d => { stderr += d; });
    child.stdin!.end();
    child.on('error', e => { stderr += String(e); });
    child.on('close', code => { clearTimeout(timer); res({ code, stdout, stderr, ms: Date.now() - t0, timedOut }); });
  });
}

let versionCache: { at: number; cli: string; version: string | null; whoami: string | null } | null = null;
/** Probe whether kane-cli is installed (and logged in). Cached for 5 minutes. */
export async function kaneProbe(): Promise<{ installed: boolean; version: string | null; loggedIn: boolean | null; detail: string }> {
  const cfg = kaneConfig();
  if (!cfg.enabled) return { installed: false, version: null, loggedIn: null, detail: 'KANE_REFEREE=off' };
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

async function openChrome(url: string): Promise<{ cdp: string; close: () => Promise<void> }> {
  const chrome = kaneConfig().chrome;
  if (!chrome) throw new Error('No Chrome/Chromium found for the trial page (set KANE_CHROME).');
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'rs-kane-'));
  const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), url], { stdio: 'ignore', windowsHide: true });
  // Without an 'error' listener a missing browser binary is an uncaught exception (it crashed Node on Windows).
  let spawnErr: Error | null = null;
  child.on('error', e => { spawnErr = e; });
  const cdp = `http://127.0.0.1:${port}`;
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (spawnErr) { await rm(profile, { recursive: true, force: true }).catch(() => {}); throw new Error(`could not start the browser at ${chrome}: ${(spawnErr as Error).message}`); }
    try {
      const r = await fetch(`${cdp}/json/list`);
      const pages = await r.json() as { url: string; type: string }[];
      if (pages.some(p => p.type === 'page' && p.url.startsWith(url))) break;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return { cdp, close: async () => { child.kill(); await new Promise(r => setTimeout(r, 300)); await rm(profile, { recursive: true, force: true }).catch(() => {}); } };
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

const cache = new Map<string, KaneResult>();

export async function kaneJudge(opts: { trialId: string; signature: string; url: string; html: string; conditions: string[] }): Promise<KaneResult> {
  const cfg = kaneConfig();
  const hit = cache.get(opts.signature);
  if (hit) return { ...hit, cached: true, elapsedMs: 0 };
  const t0 = Date.now();
  const base = { conditionResults: [] as (boolean | null)[], conditionReasons: [] as (string | null)[], exitCode: null as number | null, evidencePath: null as string | null, mode: cfg.mode, cached: false, version: null as string | null };
  const probe = await kaneProbe();
  if (!probe.installed) return { ...base, status: 'unverified', reason: `Kane unavailable: ${probe.detail}`, elapsedMs: Date.now() - t0 };
  base.version = probe.version;
  await mkdir(cfg.evidenceDir, { recursive: true });
  const dir = join(cfg.evidenceDir, `${opts.trialId}-${opts.signature}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'trial.html'), opts.html);
  let out: Awaited<ReturnType<typeof runCapture>>;
  let args: string[];
  if (cfg.mode === 'analyzer') {
    let browser: Awaited<ReturnType<typeof openChrome>> | null = null;
    try {
      browser = await openChrome(opts.url);
      args = ['run', '--analyzer-only', '--agent', '--cdp-endpoint', browser.cdp, '--timeout', String(cfg.timeoutS), ...opts.conditions.flatMap(c => ['--condition', c])];
      out = await runCapture(args, (cfg.timeoutS + 30) * 1000);
    } catch (e) {
      return { ...base, status: 'unverified', reason: `Kane run could not start: ${(e as Error).message}`, elapsedMs: Date.now() - t0, evidencePath: dir };
    } finally { await browser?.close(); }
  } else {
    const objective = `Open the page and check every statement. Pass only if ALL are true: ${opts.conditions.map((c, i) => `(${i + 1}) ${c}`).join(' ')}`;
    args = ['run', objective, '--url', opts.url, '--agent', '--headless', '--max-steps', '8', '--timeout', String(cfg.timeoutS)];
    out = await runCapture(args, (cfg.timeoutS + 30) * 1000);
  }
  const parsed = parseKaneOutput(out.stdout, opts.conditions.length, cfg.mode);
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
  await writeFile(join(dir, 'kane-stdout.ndjson'), out.stdout);
  await writeFile(join(dir, 'kane-stderr.txt'), out.stderr);
  await writeFile(join(dir, 'result.json'), JSON.stringify({ ...result, args: args.map(a => (a.length > 200 ? a.slice(0, 200) + '…' : a)), trialId: opts.trialId, signature: opts.signature, at: new Date().toISOString() }, null, 2));
  if (result.status !== 'unverified') cache.set(opts.signature, result);
  return result;
}

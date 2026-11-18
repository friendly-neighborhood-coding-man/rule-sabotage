/**
 * Records one complete, bounded balance-loop run:
 *   - terminal: the loop's real stdout/stderr as an asciicast v2 file (terminal.cast) + plain terminal.log
 *   - browser:  the operator dashboard in a real Chrome, captured with the DevTools screencast,
 *               encoded to raw.webm (unedited, real time) with ffmpeg
 *   - concise:  concise.webm, every Nth frame of the same capture, EVERY frame stamped
 *               "ACCELERATED N×" with its real timestamp (only made if ffmpeg is available)
 * Secrets are redacted from the terminal capture; the dashboard never shows any.
 *
 *   npm run balance:record                       dry-run cycle (no Kane)
 *   npm run balance:record -- --run-kane         REAL Kane cycle (uses credits; operator must authorise)
 * Any other flags are passed to the loop. Recorder flags: --fps 4 --speed 12 --width 1600 --height 1000
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readdirSync, createWriteStream, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const argv = process.argv.slice(2);
const take = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const fps = Number(take('fps', '4')), speed = Number(take('speed', '12')), W = Number(take('width', '1600')), H = Number(take('height', '1000'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const out = resolve(ROOT, 'evidence/balance/recordings', stamp);
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const SECRET = /(sk-or-[\w-]{8,}|nvapi-[\w-]{8,}|gsk_[\w]{8,}|Bearer\s+[\w.-]{12,}|(?:api[_-]?key|token|secret)["'=: ]+[\w.-]{12,})/gi;
const redact = (s: string) => s.replace(SECRET, '[REDACTED]');
const note = (s: string) => { const l = `[recorder ${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(l); appendFileSync(join(out, 'recorder.log'), l + '\n'); };

function findChrome() {
  return [process.env.KANE_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p)) ?? null;
}
function findFfmpeg() {
  if (process.env.RS_FFMPEG && existsSync(process.env.RS_FFMPEG)) return process.env.RS_FFMPEG;
  const pw = join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', '.cache'), 'ms-playwright');
  if (existsSync(pw)) for (const d of readdirSync(pw).filter(d => d.startsWith('ffmpeg')).sort().reverse()) for (const f of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) if (existsSync(join(pw, d, f))) return join(pw, d, f);
  return null;
}
const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });

// ---------- minimal CDP client (Node 22+ has a global WebSocket)
class CDP {
  private ws: WebSocket; private id = 0; private wait = new Map<number, (v: any) => void>(); handlers = new Map<string, (p: any) => void>();
  constructor(url: string) { this.ws = new WebSocket(url); this.ws.onmessage = ev => { const m = JSON.parse(String(ev.data)); if (m.id && this.wait.has(m.id)) { this.wait.get(m.id)!(m.result ?? m.error); this.wait.delete(m.id); } else if (m.method) this.handlers.get(m.method)?.(m.params); }; }
  open() { return new Promise<void>((r, j) => { this.ws.onopen = () => r(); this.ws.onerror = e => j(e); }); }
  send(method: string, params: object = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>(r => this.wait.set(id, r)); }
  close() { try { this.ws.close(); } catch { /* */ } }
}

const chrome = findChrome(), ffmpeg = findFfmpeg();
note(`output ${out}`);
note(`browser: ${chrome ?? 'NONE (browser capture not supported here)'} · ffmpeg: ${ffmpeg ?? 'NONE (frames are kept as JPEG files instead of video)'}`);
const dashPort = Number(take('port', '4100'));

// ---------- terminal capture (asciicast v2)
const cast = createWriteStream(join(out, 'terminal.cast'));
cast.write(JSON.stringify({ version: 2, width: 160, height: 48, timestamp: Math.floor(t0 / 1000), title: `Rule Sabotage balance loop ${argv.join(' ')}`, env: { SHELL: process.platform, TERM: 'xterm-256color' } }) + '\n');
const tlog = createWriteStream(join(out, 'terminal.log'));
const term = (d: string) => { const s = redact(d); cast.write(JSON.stringify([(Date.now() - t0) / 1000, 'o', s.replace(/\n/g, '\r\n')]) + '\n'); tlog.write(s); process.stdout.write(s); };
term(`$ npm run balance:loop -- ${[...argv, '--keep-open', '--port', String(dashPort)].join(' ')}\n`);
const loop: ChildProcess = spawn(process.execPath, ['--env-file-if-exists=.env', '--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'scripts/balance-loop.ts', 'loop', ...argv, '--keep-open', '--port', String(dashPort)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
let runDir: string | null = null, finished = false, dashboard: string | null = null;
const onOut = (d: Buffer) => {
  const s = String(d); term(s);
  const m = /dashboard (http:\/\/127\.0\.0\.1:\d+)\//.exec(s); if (m) dashboard = m[1] + '/';
  const r = /Evidence: (.+)$/m.exec(s); if (r) runDir = r[1].trim();
  if (/Dashboard stays open/.test(s)) finished = true;
};
loop.stdout!.on('data', onOut); loop.stderr!.on('data', onOut);
let loopExit: number | null = null;
loop.on('close', c => { loopExit = c; finished = true; });
const until = async (f: () => boolean, ms: number) => { const e = Date.now() + ms; while (!f() && Date.now() < e) await new Promise(r => setTimeout(r, 200)); return f(); };
await until(() => !!dashboard || finished, 60_000);

// ---------- browser capture
let encDone: Promise<unknown> = Promise.resolve();
let browser: ChildProcess | null = null, cdp: CDP | null = null, enc: ChildProcess | null = null, frames = 0, latest: Buffer | null = null, timer: NodeJS.Timeout | null = null;
const stillDir = join(tmpdir(), `rs-rec-${stamp}`); mkdirSync(stillDir, { recursive: true });
const kept: { file: string; t: number }[] = [];
if (chrome && dashboard) {
  const port = await freePort();
  const prof = join(tmpdir(), `rs-rec-prof-${stamp}`);
  browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), dashboard + '?follow=1'], { stdio: 'ignore' });
  browser.on('error', e => note(`browser failed: ${e.message}`));
  let wsUrl: string | null = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]; wsUrl = l.find(p => p.type === 'page')?.webSocketDebuggerUrl ?? null; } catch { /* not up yet */ }
    if (!wsUrl) await new Promise(r => setTimeout(r, 250));
  }
  if (wsUrl) {
    cdp = new CDP(wsUrl); await cdp.open();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    cdp.handlers.set('Page.screencastFrame', p => { latest = Buffer.from(p.data, 'base64'); cdp!.send('Page.screencastFrameAck', { sessionId: p.sessionId }); });
    await cdp.send('Page.enable');
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    if (ffmpeg) {
      enc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', '-c:v', 'libvpx-vp9', '-b:v', '1200k', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', join(out, 'raw.webm')], { stdio: ['pipe', 'ignore', 'pipe'] });
      enc.stderr!.on('data', d => note(`ffmpeg: ${String(d).trim()}`));
      encDone = new Promise(r => enc!.on('close', r));
      enc.stdin!.on('error', e => { note(`ffmpeg input closed: ${e.message}`); enc = null; });
    } else mkdirSync(join(out, 'raw-frames'), { recursive: true });
    timer = setInterval(() => {
      if (!latest) return;
      frames++;
      if (enc) enc.stdin!.write(latest); else { mkdirSync(join(out, 'raw-frames'), { recursive: true }); writeFileSync(join(out, 'raw-frames', `${String(frames).padStart(6, '0')}.jpg`), latest); }
      if (frames % speed === 1) { const f = join(stillDir, `${String(kept.length).padStart(6, '0')}.jpg`); writeFileSync(f, latest); kept.push({ file: f, t: (Date.now() - t0) / 1000 }); }
    }, 1000 / fps);
    note(`recording dashboard ${dashboard} at ${fps} fps (${W}×${H})`);
  } else note('could not attach to the browser; no browser recording');
} else note('no browser recording (no Chrome or no dashboard URL)');

await until(() => finished, 4 * 3600_000);
await new Promise(r => setTimeout(r, 8000)); // keep the final dashboard state on screen
if (timer) clearInterval(timer);
if (cdp) { await cdp.send('Page.stopScreencast').catch(() => {}); }
if (enc) enc.stdin!.end();
await encDone;

// ---------- concise, clearly labelled accelerated cut
let concise: string | null = null;
if (cdp && ffmpeg && kept.length) {
  const cfr = join(stillDir, 'labelled'); mkdirSync(cfr, { recursive: true });
  const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const frame = async (html: string, file: string) => {
    await cdp!.send('Page.navigate', { url: 'about:blank' });
    await cdp!.send('Runtime.evaluate', { expression: `document.open();document.write(${JSON.stringify(html)});document.close();new Promise(r=>{const i=document.querySelector('img');if(!i||i.complete)r(1);else i.onload=()=>r(1)})`, awaitPromise: true });
    const s = await cdp!.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    writeFileSync(file, Buffer.from(s.data, 'base64'));
  };
  const title = `<body style="margin:0;width:${W}px;height:${H}px;display:grid;place-items:center;background:#0f1218;color:#e6e9ef;font:28px system-ui"><div style="text-align:center;max-width:1200px"><div style="font-size:44px;font-weight:800;color:#f0b443">ACCELERATED ${speed}× SUMMARY</div><p>Every frame below is a real frame of the unedited recording <b>raw.webm</b>, shown ${speed}× faster. Nothing is added, re-ordered or removed except skipped in-between frames.</p><p style="font-size:20px;color:#9aa3b2">Loop arguments: ${argv.join(' ') || '(dry-run defaults)'} · recorded ${new Date(t0).toISOString()}</p></div></body>`;
  let n = 0;
  for (let i = 0; i < fps * 3; i++) await frame(title, join(cfr, `${String(n++).padStart(6, '0')}.jpg`));
  for (const k of kept) {
    const b64 = readFileSync(k.file).toString('base64');
    await frame(`<body style="margin:0;position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000"><img src="data:image/jpeg;base64,${b64}" style="width:${W}px;height:${H}px;display:block"><div style="position:absolute;right:14px;bottom:14px;background:#f0b443;color:#111;font:700 20px system-ui;padding:6px 12px;border-radius:8px">ACCELERATED ${speed}× · real time ${fmt(k.t)}</div></body>`, join(cfr, `${String(n++).padStart(6, '0')}.jpg`));
  }
  const enc2: ChildProcess = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', '-c:v', 'libvpx-vp9', '-b:v', '1200k', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', join(out, 'concise.webm')], { stdio: ['pipe', 'ignore', 'pipe'] });
  for (const f of readdirSync(cfr).sort()) enc2.stdin!.write(readFileSync(join(cfr, f)));
  const done2 = new Promise(r => enc2.on('close', r));
  enc2.stdin!.end(); await done2;
  concise = join(out, 'concise.webm');
  note(`concise cut: ${n} frames (${(n / fps).toFixed(0)} s), each labelled ACCELERATED ${speed}×`);
}
cdp?.close(); browser?.kill();
if (loopExit === null) loop.kill();
cast.end(); tlog.end();
await new Promise(r => setTimeout(r, 500));
rmSync(stillDir, { recursive: true, force: true });

// ---------- manifest (and copy into the run's evidence directory)
const files = readdirSync(out).filter(f => !f.endsWith('.json')).flatMap(f => (f === 'raw-frames' ? readdirSync(join(out, f)).map(x => join(f, x)) : [f]));
const manifest = { recordedAt: new Date(t0).toISOString(), durationS: Math.round((Date.now() - t0) / 1000), loopArgs: argv, runDir, fps, speed, raw: enc ? 'raw.webm (unedited, real time)' : 'raw-frames/*.jpg (unedited, real time)', concise: concise ? `concise.webm (ACCELERATED ${speed}×, every frame labelled)` : 'not produced (no ffmpeg or no browser capture)', terminal: 'terminal.cast (asciicast v2, secrets redacted) + terminal.log', rawFrames: frames, files: files.map(f => { const b = readFileSync(join(out, f)); return { path: f.split('\\').join('/'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }; }) };
writeFileSync(join(out, 'recording-manifest.json'), JSON.stringify(manifest, null, 2));
if (runDir && existsSync(runDir)) {
  const dst = join(runDir, 'recording'); mkdirSync(dst, { recursive: true });
  for (const f of ['recording-manifest.json', 'terminal.cast', 'terminal.log', 'recorder.log']) if (existsSync(join(out, f))) copyFileSync(join(out, f), join(dst, f));
  writeFileSync(join(dst, 'VIDEO-LOCATION.txt'), `Video files are kept outside the run directory (size): ${out}\n`);
  const { writeManifest } = await import('../server/balance/loop.ts');
  writeManifest(runDir);
}
note(`done: ${frames} raw frames · ${out}`);
process.exit(loopExit && loopExit !== 0 ? loopExit : 0);

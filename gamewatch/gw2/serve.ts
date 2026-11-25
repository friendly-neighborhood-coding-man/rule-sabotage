/**
 * GW2 review server: a thin wrapper with the SAME page and form behaviour as the GW1 review server
 * (gamewatch/kane/serve.ts, which is left unchanged and keeps GW1 behaviour), plus a server-side access journal that is
 * ON by default (gamewatch/gw2/journal.ts).
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/serve.ts --exp <id> [--out evidence/gw2/<id>]
 *        [--site dir] [--port 3210] [--label test-double|kane|human] [--no-access-log]
 *
 * One server process = one review session. Output goes to <out>/sessions/<session>/: session.json (logging on/off,
 * nonce hash, paths), notes.ndjson (findings, same format as GW1 plus the session id), access.ndjson (the journal).
 * <out> must be under evidence/gw2/ or outside the repository (gamewatch/gw2/paths.ts); frozen GW1 paths are refused.
 *
 * Shared with GW1: resolvePage (path normalisation and containment), the form field allow-list and the nonce check.
 * Differences, all outside the response body: `cache-control: no-store` (so a browser re-visit reaches the server and
 * is recorded), and the journal. Page bodies are byte-identical to GW1's (checked over all 56 GW1 pages in
 * tests/gw2-compat.test.ts; report.html differs only by its per-session nonce).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolvePage } from '../kane/serve.ts';
import { JournalWriter, sha256, clientToken, SERVER_ID, ACCESS_SCHEMA, type Kind } from './journal.ts';
import { assertWritableOutput, ROOT } from './paths.ts';

/** The GW1 form field allow-list (gamewatch/kane/serve.ts FIELDS); anything else in a POST body is dropped. */
export const FIELDS = ['category', 'rules', 'builds', 'claim', 'evidence', 'reproduce', 'suggestion', 'confidence', 'nonce'];
const EVIDENCE_PAGE = /^(?:case|match)-([CM]-[0-9a-f]{6})\.html$/;

export type Gw2ServerOptions = {
  exp: string; out: string; site: string; port?: number; label?: string; accessLog?: boolean;
  /** test seams: replace the journal's append (to simulate write failures) and pause before a response is written */
  journalAppend?: (file: string, data: string) => void; beforeRespond?: (path: string, req: IncomingMessage) => Promise<void>;
};
export type Gw2Server = { port: number; nonce: string; session: string; dir: string; journal: string | null; notes: string; failures: () => number; close: () => Promise<void> };

export function classify(page: string | null): { kind: Kind; evidenceId: string | null } {
  if (page === null) return { kind: 'rejected', evidenceId: null };
  const m = EVIDENCE_PAGE.exec(page);
  if (m) return { kind: 'evidence', evidenceId: m[1] };
  if (page === 'index.html') return { kind: 'index', evidenceId: null };
  if (page === 'report.html') return { kind: 'report-form', evidenceId: null };
  return { kind: 'other', evidenceId: null };
}

export async function startGw2Server(o: Gw2ServerOptions): Promise<Gw2Server> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.exp)) throw new Error(`invalid experiment id: ${o.exp}`);
  const out = assertWritableOutput(o.out);
  const NONCE = randomBytes(8).toString('hex'), SESSION = randomBytes(8).toString('hex');
  const dir = assertWritableOutput(join(out, 'sessions', SESSION));
  mkdirSync(dir, { recursive: true });
  const notes = join(dir, 'notes.ndjson'), journalFile = join(dir, 'access.ndjson'), logging = o.accessLog !== false, label = o.label ?? 'test-double';
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ schema: 'gamewatch/gw2-session@1', exp: o.exp, session: SESSION, logging: logging ? 'on' : 'off', accessSchema: ACCESS_SCHEMA, journal: logging ? 'access.ndjson' : null, notes: 'notes.ndjson', label, nonceSha256: sha256(NONCE), server: SERVER_ID, startedAt: new Date().toISOString() }, null, 1) + '\n');
  const files: Record<string, string> = {};
  for (const f of readdirSync(o.site).filter(f => f.endsWith('.html')).sort()) files[f] = sha256(readFileSync(join(o.site, f)));
  const j = logging ? new JournalWriter({ file: journalFile, exp: o.exp, session: SESSION, append: o.journalAppend }) : null;
  j?.event({ type: 'session-start', site: { files }, notes: 'notes.ndjson', server: SERVER_ID });
  let noteCount = 0;
  const failed = () => { if (j && j.failures) process.stderr.write(`GW2 ACCESS JOURNAL: ${j.failures} write failure(s) (${j.lastError}); coverage for this session is incomplete\n`); };

  /** Send a body and journal the request once the response has completed or the connection was closed first. */
  function send(req: IncomingMessage, res: ServerResponse, status: number, body: Buffer | string, meta: { path: string | null; kind: Kind; evidenceId: string | null }) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    let done = false;
    const record = (outcome: 'completed' | 'aborted') => {
      if (done) return; done = true;
      const sentBody = req.method !== 'HEAD';
      j?.event({ type: 'request', method: req.method ?? '?', path: meta.path, kind: meta.kind, evidenceId: meta.evidenceId, status, outcome,
        bytes: outcome === 'completed' ? (sentBody ? buf.length : 0) : null, sha256: status === 200 && sentBody && outcome === 'completed' ? sha256(buf) : null, client: clientToken(req.headers['user-agent']) });
      failed();
    };
    res.on('finish', () => record('completed'));
    res.on('close', () => record(res.writableFinished ? 'completed' : 'aborted'));
    if (req.socket.destroyed) { record('aborted'); return; }
    res.writeHead(status, { 'content-type': status === 200 || status === 201 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(buf);
  }

  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 64_000) req.destroy(); });
      req.on('end', () => {
        const f = Object.fromEntries([...new URLSearchParams(body)].filter(([k]) => FIELDS.includes(k)));
        const nonceValid = f.nonce === NONCE;
        // The note keeps GW1's fields (plus the session id). Its position in the server's ordering is the journal's
        // finding event, joined by noteIndex and noteSha256; the note itself never carries a server sequence number.
        const note = { at: new Date().toISOString(), source: label, nonceValid, session: SESSION, ...f };
        const line = JSON.stringify(note);
        mkdirSync(dir, { recursive: true });
        appendFileSync(notes, line + '\n');
        j?.event({ type: 'finding', noteIndex: noteCount++, noteSha256: sha256(line), nonceValid });
        failed();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(`<!doctype html><meta charset="utf-8"><p id="stored">Finding stored (${nonceValid ? 'valid session' : 'INVALID session nonce'}).</p><p><a href="/report.html">Submit another finding</a> · <a href="/index.html">GameWatch home</a></p>`);
      });
      return;
    }
    const r = resolvePage(url.pathname, o.site);
    const meta = r ? { path: r.page, ...classify(r.page) } : { path: null, ...classify(null) };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(req, res, 405, 'method not allowed', { ...meta, kind: 'post' }); return; }
    if (o.beforeRespond) await o.beforeRespond(meta.path ?? '', req);
    if (!r || !existsSync(r.file)) { send(req, res, 404, 'not found', meta); return; }
    let html = readFileSync(r.file, 'utf8');
    if (r.isReport) html = html.replace('__NONCE__', NONCE);
    send(req, res, 200, html, meta);
  });
  return new Promise((resolveP, reject) => {
    srv.on('error', reject);
    srv.listen(o.port ?? 0, '127.0.0.1', () => resolveP({
      port: (srv.address() as { port: number }).port, nonce: NONCE, session: SESSION, dir, journal: logging ? journalFile : null, notes,
      failures: () => j?.failures ?? 0,
      close: () => new Promise<void>(rs => { srv.closeAllConnections?.(); srv.close(() => { j?.close(); failed(); rs(); }); }),
    }));
  });
}

if (process.argv[1]?.endsWith('gw2/serve.ts')) {
  const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const exp = arg('--exp');
  if (!exp) { console.error('usage: serve.ts --exp <id> [--out dir] [--site dir] [--port n] [--label l] [--no-access-log]'); process.exit(2); }
  const s = await startGw2Server({ exp, out: arg('--out', join(ROOT, 'evidence/gw2', exp))!, site: arg('--site', join(ROOT, 'evidence/gamewatch/site'))!, port: Number(arg('--port', '3210')), label: arg('--label', 'test-double'), accessLog: !process.argv.includes('--no-access-log') });
  console.log(`GW2 review server on http://127.0.0.1:${s.port}/ session ${s.session} -> ${s.dir} (access log ${s.journal ? 'ON' : 'OFF'})`);
  const stop = async () => { await s.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

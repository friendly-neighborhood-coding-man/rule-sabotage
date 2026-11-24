/**
 * GameWatch review server: serves the static evidence site to the reviewer (Kane's browser agent, or a person) on
 * loopback, and stores every finding submitted through /report.html verbatim, with time and nonce, in one NDJSON file.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/kane/serve.ts [--port 3210] [--site dir] [--notes file] [--label kane|test-double|human]
 *
 * Nothing here calls Kane. The nonce changes every start, so a note can be tied to one review session.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, sep, posix } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT } from '../builds.ts';

/**
 * Map a URL path to a page: the URL is normalised with POSIX rules (URLs always use '/'), so the page name compared with
 * 'report.html' never depends on the OS separator (on Windows, path.normalize would turn '/report.html' into
 * '\\report.html'). Returns null for anything outside the site directory. `pathImpl` is injectable for tests.
 */
export function resolvePage(urlPath: string, site: string, pathImpl: { resolve: typeof resolve; sep: string } = { resolve, sep }) {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  const page = posix.normalize(decoded === '/' ? '/index.html' : decoded).replace(/^\/+/, '');
  if (!page || page.startsWith('..') || page.split('/').includes('..')) return null;
  const root = pathImpl.resolve(site), file = pathImpl.resolve(root, ...page.split('/'));
  if (!file.startsWith(root + pathImpl.sep)) return null;
  return { page, file, isReport: page === 'report.html' };
}

const FIELDS = ['category', 'rules', 'builds', 'claim', 'evidence', 'reproduce', 'suggestion', 'confidence', 'nonce'];

export function startServer(o: { port: number; site: string; notes: string; label: string }): Promise<{ nonce: string; port: number; close: () => Promise<void> }> {
  const { site, notes, label } = o;
  const NONCE = randomBytes(8).toString('hex');
  const srv = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'POST' && url.pathname === '/report') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64_000) req.destroy(); });
    req.on('end', () => {
      const f = Object.fromEntries([...new URLSearchParams(body)].filter(([k]) => FIELDS.includes(k)));
      const note = { at: new Date().toISOString(), source: label, nonceValid: f.nonce === NONCE, ...f };
      mkdirSync(dirname(notes), { recursive: true });
      appendFileSync(notes, JSON.stringify(note) + '\n');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><p id="stored">Finding stored (${note.nonceValid ? 'valid session' : 'INVALID session nonce'}).</p><p><a href="/report.html">Submit another finding</a> · <a href="/index.html">GameWatch home</a></p>`);
    });
    return;
  }
  const r = resolvePage(url.pathname, site);
  if (!r || !existsSync(r.file)) { res.writeHead(404); res.end('not found'); return; }
  let html = readFileSync(r.file, 'utf8');
  if (r.isReport) html = html.replace('__NONCE__', NONCE);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(o.port, '127.0.0.1', () => resolve({ nonce: NONCE, port: (srv.address() as { port: number }).port, close: () => new Promise<void>(r => srv.close(() => r())) }));
  });
}

if (process.argv[1]?.endsWith('serve.ts')) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const o = { port: Number(arg('--port', '3210')), site: arg('--site', join(ROOT, 'evidence/gamewatch/site')), notes: arg('--notes', join(ROOT, 'evidence/gamewatch/review/notes.ndjson')), label: arg('--label', 'test-double') };
  await startServer(o);
  console.log(`GameWatch review server on http://127.0.0.1:${o.port}/ (notes -> ${o.notes}, label ${o.label})`);
}

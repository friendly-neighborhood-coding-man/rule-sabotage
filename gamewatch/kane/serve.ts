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
import { join, dirname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT } from '../builds.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', '3210'));
const site = arg('--site', join(ROOT, 'evidence/gamewatch/site'));
const notes = arg('--notes', join(ROOT, 'evidence/gamewatch/review/notes.ndjson'));
const label = arg('--label', 'test-double');
export const NONCE = randomBytes(8).toString('hex');
const FIELDS = ['category', 'rules', 'builds', 'claim', 'evidence', 'reproduce', 'suggestion', 'confidence', 'nonce'];

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
  const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  const f = join(site, p);
  if (!f.startsWith(site) || !existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  let html = readFileSync(f, 'utf8');
  if (p === '/report.html') html = html.replace('__NONCE__', NONCE);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
srv.listen(port, '127.0.0.1', () => console.log(`GameWatch review server on http://127.0.0.1:${port}/ (notes -> ${notes}, label ${label})`));

/** Loopback HTTP server: static client + JSON API. Game state lives here, not in the browser. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGame, getGame, view, preview, placeHuman, moveHuman, endHumanTurn, trials, refereeMode } from './game.ts';
import { modelConfigured, modelName, stats } from './openrouter.ts';
import { kaneProbe, kaneConfig } from './kane.ts';

const HOST = process.env.HOST || '127.0.0.1', PORT = Number(process.env.PORT || 3000);
const ROOT = resolve(fileURLToPath(new URL('../client/', import.meta.url)));
const MAX_BODY = 16_000;
const hits = new Map<string, { n: number; until: number }>();

function json(res: ServerResponse, status: number, obj: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function limited(req: IncomingMessage, cost = 1) {
  const ip = req.socket.remoteAddress || '?', now = Date.now();
  const h = hits.get(ip);
  if (!h || h.until < now) { hits.set(ip, { n: cost, until: now + 60_000 }); return false; }
  h.n += cost; return h.n > 240;
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const origin = req.headers.origin;
  if (req.method === 'POST' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return json(res, 403, { error: 'origin_mismatch' });
  if (limited(req)) return json(res, 429, { error: 'rate_limited', reason: 'Too many requests, slow down for a minute.' });
  if (path === '/api/health' && req.method === 'GET') {
    const k = await kaneProbe();
    const recent = stats.slice(-50);
    return json(res, 200, {
      openrouter: { configured: modelConfigured(), model: modelConfigured() ? modelName() : null, recentCalls: recent.length, recentFailures: recent.filter(s => !s.ok).length },
      referee: { mode: refereeMode(), kane: k, kaneMode: kaneConfig().mode, timeoutS: kaneConfig().timeoutS, allowUnverified: process.env.ALLOW_UNVERIFIED_RULES === '1' },
      authority: 'server',
    });
  }
  if (path === '/api/stats' && req.method === 'GET') return json(res, 200, { openrouter: stats });
  let m = path.match(/^\/api\/trial\/(T\d{4})$/);
  if (m && req.method === 'GET') { const t = trials.get(m[1]); return t ? json(res, 200, t.trial) : json(res, 404, { error: 'no_such_trial' }); }
  if (path === '/api/game' && req.method === 'POST') {
    let b: any = {}; try { b = await body(req); } catch { return json(res, 400, { error: 'bad_json' }); }
    const seed = Number.isInteger(b?.seed) ? b.seed : undefined;
    const { g, ai } = await startGame(seed);
    return json(res, 200, { ...view(g), ai });
  }
  m = path.match(/^\/api\/game\/([0-9a-f-]{36})(\/(preview|place|move|end|progress))?$/);
  if (!m) return json(res, 404, { error: 'not_found' });
  const g = getGame(m[1]);
  if (!g) return json(res, 404, { error: 'no_such_game' });
  const action = m[3];
  if (!action && req.method === 'GET') return json(res, 200, view(g));
  if (action === 'progress' && req.method === 'GET') return json(res, 200, { busy: g.busy, progress: g.progress });
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  let b: any; try { b = await body(req); } catch { return json(res, 400, { error: 'bad_json' }); }
  const cellList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 49 && v.every(c => typeof c === 'string' && /^[0-6],[0-6]$/.test(c)));
  try {
    if (action === 'preview') {
      if (typeof b?.text !== 'string' || b.text.length > 400) return json(res, 400, { error: 'invalid_text' });
      return json(res, 200, await preview(g, b.text));
    }
    if (action === 'place') {
      if (!b || typeof b !== 'object' || (b.token !== undefined && typeof b.token !== 'string') || !cellList(b.cells) || !cellList(b.remove)) return json(res, 400, { error: 'invalid_placement' });
      return json(res, 200, await placeHuman(g, { token: b.token, cells: b.cells, remove: b.remove }));
    }
    if (action === 'move') {
      if (!b || typeof b.from !== 'string' || typeof b.dir !== 'string') return json(res, 400, { error: 'invalid_move' });
      return json(res, 200, moveHuman(g, { from: b.from, dir: b.dir, mode: b.mode === 'single' ? 'single' : 'stack' }));
    }
    if (action === 'end') return json(res, 200, await endHumanTurn(g));
  } catch (e) {
    const err = e as Error & { status?: number };
    return json(res, err.status ?? 409, { error: 'rejected', reason: err.message.slice(0, 300) });
  }
  return json(res, 404, { error: 'not_found' });
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
export const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  try {
    if (path.startsWith('/api/')) return await api(req, res, path);
    const tm = path.match(/^\/trial\/(T\d{4})$/);
    if (tm && req.method === 'GET') {
      const t = trials.get(tm[1]);
      if (!t) return json(res, 404, { error: 'no_such_trial' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      return res.end(t.html);
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    let rel: string;
    try { rel = decodeURIComponent(path === '/' ? '/index.html' : path); } catch { return json(res, 400, { error: 'bad_url' }); }
    const file = resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + sep)) return json(res, 403, { error: 'forbidden' });
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'" });
    res.end(content);
  } catch (e) {
    if (!res.headersSent) json(res, (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500, { error: 'server_error' });
  }
});

if (process.env.RULE_SABOTAGE_NO_LISTEN !== '1') {
  server.listen(PORT, HOST, async () => {
    const k = await kaneProbe();
    console.log(`Rule Sabotage on http://${HOST}:${PORT}`);
    console.log(`  OpenRouter: ${modelConfigured() ? `configured (${modelName()})` : 'NOT configured -> offline parser + local planner (labelled in UI)'}`);
    console.log(`  Referee:    ${refereeMode() === 'kane' ? `Kane (${k.detail})` : 'engine-only (KANE_REFEREE=off)'}`);
  });
}

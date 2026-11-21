/**
 * Rule Sabotage V6 EXPERIMENTAL game server (EXPERIMENTAL-V6-NOT-PRODUCTION). Start: npm run play:v6 -> http://127.0.0.1:3106
 *
 * Loopback only, separate port and page. 13x9 board, no new effects next to opponent pieces (rule A1), forked V6
 * opponents. No Kane, no language model, no network, nothing written to disk. The production server (server/server.ts),
 * the 7x7 game and the PR #14 playtest (server/playtest/) are unchanged and do not import this.
 */
for (const k of ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'LLM_PROVIDER', 'ALLOW_UNVERIFIED_RULES', 'REFEREE_TIERS']) delete process.env[k];
process.env.KANE_REFEREE = 'off';
globalThis.fetch = (() => Promise.reject(new Error('network disabled in the V6 server'))) as typeof fetch;

const { createServer } = await import('node:http');
const { readFile } = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');
const PL = await import('./pilot.ts'); // sets the V6 data directory (playtest-data/v6) before the storage module loads
const S = await import('./session.ts');
const O = await import('./opponents.ts');
const { trials } = await import('./turn.ts');
const E = await import('./engine.ts');
import type { IncomingMessage, ServerResponse } from 'node:http';

const HOST = '127.0.0.1', PORT = Number(process.env.V6_PORT || 3106);
const MAX_BODY = 16_000;

function json(res: ServerResponse, status: number, obj: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(obj));
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
// Server-side shape checks. Cell semantics (board bounds, A1, occupancy) are checked by the engine itself.
const cellList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= E.W * E.H && v.every(c => E.validKey(c)));

export async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const origin = req.headers.origin;
  if (req.method === 'POST' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return json(res, 403, { error: 'origin_mismatch' });
  let b: any = {};
  if (req.method === 'POST') { try { b = await body(req); } catch { return json(res, 400, { error: 'bad_json' }); } }
  if (path === '/api/health' && req.method === 'GET') return json(res, 200, { openrouter: { configured: false }, referee: { mode: 'engine-only', kane: { installed: false, detail: 'Kane is never called in V6' }, tiers: true }, authority: 'server', v6: true });
  if (path === '/api/v6/info' && req.method === 'GET') return json(res, 200, { mode: E.V6_MODE, ruleset: E.RULESET, board: { w: E.W, h: E.H, cols: E.COLS }, maxTurns: E.MAX_TURNS, noEffectRule: E.A1_EXPLANATION, rulesets: [{ id: 'v6.1', ruleset: E.RULESET_V61, label: 'V6.1: no new effects next to ANY piece (A2)', noEffectRule: E.A2_EXPLANATION }, { id: 'v6', ruleset: E.RULESET, label: 'V6: no new effects next to opponent pieces (A1)', noEffectRule: E.A1_EXPLANATION }], opponents: Object.values(O.OPPONENTS_V6), code: O.v6CodeHash() });
  // ---- V6.2 pilot readiness: consent session, match review, questionnaire, deletion (PR #14 storage, V6 directory) ----
  const ck = /(?:^|;\s*)v6s=([0-9a-f-]{36})/.exec(req.headers.cookie || '');
  const ps = PL.getSession(ck?.[1]);
  const current = () => (ps ? ps.games.map(id => S.getGame(id)).filter(Boolean).at(-1) ?? null : null);
  if (path === '/api/v6/consent' && req.method === 'GET') return json(res, 200, { version: PL.CONSENT_VERSION, statement: `${PL.CONSENT_STATEMENT} ${PL.SHADOW_STATEMENT}`, questionnaire: PL.QUESTIONNAIRE, session: ps ? { consented: ps.consented, participant: ps.participant, games: ps.games.length } : null });
  if (path === '/api/v6/session' && req.method === 'POST') {
    try {
      const old = current(); if (old) S.abandon(old);
      const n = PL.newSession({ consent: b?.consent, participant: b?.participant });
      return json(res, 200, { consented: n.consented, participant: n.participant }, { 'Set-Cookie': `v6s=${n.id}; HttpOnly; SameSite=Strict; Path=/` });
    } catch (e) { const err = e as Error & { status?: number }; return json(res, err.status ?? 422, { error: 'rejected', reason: err.message }); }
  }
  const rv = path.match(/^\/api\/v6\/review\/([0-9a-f-]{36})$/);
  if (rv && req.method === 'GET') { const g = S.getGame(rv[1]); if (!g || !ps || g.session !== ps) return json(res, 404, { error: 'no_such_game' }); return json(res, 200, { ...S.record(g), recorded: ps.consented }); }
  if (path === '/api/v6/feedback' && req.method === 'POST') {
    const g = typeof b?.gameId === 'string' ? S.getGame(b.gameId) : undefined;
    if (!g || !ps || g.session !== ps) return json(res, 404, { error: 'no_such_game' });
    if (!g.endedAt) return json(res, 409, { error: 'rejected', reason: 'The questionnaire is for finished games.' });
    if (g.feedback !== 'none') return json(res, 409, { error: 'rejected', reason: 'Already answered for this game.' });
    const r = PL.feedback(ps, g.id, b); g.feedback = r.skipped ? 'skipped' : 'submitted';
    return json(res, 200, { ok: true, stored: r.stored });
  }
  if (path === '/api/v6/withdraw' && req.method === 'POST') { if (!ps) return json(res, 404, { error: 'no_session' }); return json(res, 200, { ok: true, removedFiles: PL.withdraw(ps).length }); }
  try {
    if (path === '/api/game' && req.method === 'POST') {
      const old = current(); if (old?.busy) throw Object.assign(new Error('Wait until the opponent has finished its turn.'), { status: 409 });
      if (old) S.abandon(old);
      return json(res, 200, await S.startGame({ opponent: b?.opponent, first: b?.first, seed: b?.seed, ruleset: b?.ruleset, session: ps }));
    }
    const m = path.match(/^\/api\/game\/([0-9a-f-]{36})(\/(preview|place|move|end|progress))?$/);
    if (!m) return json(res, 404, { error: 'not_found' });
    const g = S.getGame(m[1]);
    if (!g || (g.session && g.session !== ps)) return json(res, 404, { error: 'no_such_game' });
    const action = m[3];
    if (!action && req.method === 'GET') return json(res, 200, S.view(g));
    if (action === 'progress' && req.method === 'GET') return json(res, 200, { busy: g.busy, progress: g.thinkingSince ? [{ at: Date.now(), text: `${g.opponent.label} is thinking (${((Date.now() - g.thinkingSince) / 1000).toFixed(1)} s)…` }] : [] });
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (action === 'preview') {
      if (typeof b?.text !== 'string' || b.text.length > 400) return json(res, 400, { error: 'invalid_text' });
      return json(res, 200, S.preview(g, b.text));
    }
    if (action === 'place') {
      if (!b || typeof b !== 'object' || (b.token !== undefined && typeof b.token !== 'string') || !cellList(b.cells) || !cellList(b.remove)) return json(res, 400, { error: 'invalid_placement' });
      return json(res, 200, S.placeHuman(g, { token: b.token, cells: b.cells, remove: b.remove }));
    }
    if (action === 'move') {
      if (!b || !E.validKey(b.from) || !['up', 'down', 'left', 'right'].includes(b.dir)) return json(res, 400, { error: 'invalid_move' });
      return json(res, 200, S.moveHuman(g, { from: b.from, dir: b.dir, mode: b.mode === 'single' ? 'single' : 'stack' }));
    }
    if (action === 'end') return json(res, 200, await S.endHuman(g));
  } catch (e) {
    const err = e as Error & { status?: number; code?: string | null; cell?: string | null };
    return json(res, err.status ?? 409, { error: 'rejected', reason: err.message.slice(0, 400), code: err.code ?? null, cell: err.cell ?? null });
  }
  return json(res, 404, { error: 'not_found' });
}

const CLIENT = new URL('../../client/', import.meta.url);
const STATIC: Record<string, [URL, string]> = {
  '/': [new URL('v6/index.html', CLIENT), 'text/html; charset=utf-8'],
  '/app-v6.js': [new URL('v6/app-v6.js', CLIENT), 'text/javascript; charset=utf-8'],
  '/style.css': [new URL('style.css', CLIENT), 'text/css; charset=utf-8'],
  '/v6.css': [new URL('v6/v6.css', CLIENT), 'text/css; charset=utf-8'],
  '/pilot-v6.js': [new URL('v6/pilot-v6.js', CLIENT), 'text/javascript; charset=utf-8'],
};
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
    const f = STATIC[path];
    if (!f || req.method !== 'GET') return json(res, 404, { error: 'not_found' });
    res.writeHead(200, { 'Content-Type': f[1], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'" });
    res.end(await readFile(fileURLToPath(f[0])));
  } catch {
    if (!res.headersSent) json(res, 500, { error: 'server_error' });
  }
});

if (process.env.V6_NO_LISTEN !== '1') {
  server.listen(PORT, HOST, () => {
    console.log(`Rule Sabotage V6 EXPERIMENTAL (not production) on http://${HOST}:${PORT}`);
    console.log(`  Rulesets: ${E.RULESET_V61} (A2, every piece) and ${E.RULESET} (A1, opponent pieces) · ${E.W}x${E.H} board, ${E.MAX_TURNS}-turn limit`);
    console.log(`  Opponents: ${Object.keys(O.OPPONENTS_V6).join(', ')} · code ${O.v6CodeHash()}`);
    console.log('  Referee: engine-only (no Kane) · interpreter: offline parser (no LLM) · network: disabled · nothing saved');
  });
}

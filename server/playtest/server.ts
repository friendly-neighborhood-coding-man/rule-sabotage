/**
 * Isolated local HUMAN PLAYTEST server (PLAYTEST-ONLY-NOT-PRODUCTION). Start: npm run playtest  ->  http://127.0.0.1:3100
 *
 * Separate process, separate port, separate page. It serves the unchanged production client (client/app.js, style.css)
 * inside a playtest page (client/playtest/) and implements the same game API, but the opponent is one of the three frozen
 * V5.3 policies. No Kane, no language model, no network: the provider keys and the Kane switch are removed from this
 * process's environment before anything is imported, fetch is disabled, and startup aborts if either is still reachable.
 * The production server (server/server.ts) and game (server/game.ts) are not modified and do not import this.
 */
for (const k of ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'LLM_PROVIDER', 'ALLOW_UNVERIFIED_RULES', 'REFEREE_TIERS']) delete process.env[k];
process.env.KANE_REFEREE = 'off';
globalThis.fetch = (() => Promise.reject(new Error('network disabled in the playtest server'))) as typeof fetch;

const { createServer } = await import('node:http');
const { readFile } = await import('node:fs/promises');
const { randomUUID } = await import('node:crypto');
const { fileURLToPath } = await import('node:url');
const { modelConfigured } = await import('../openrouter.ts');
const { kaneConfig } = await import('../kane.ts');
const { view, getGame, trials } = await import('../game.ts');
const S = await import('./session.ts');
const O = await import('./opponents.ts');
const T = await import('./telemetry.ts');
const P = await import('./pilot.ts');
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Policy53 } from '../balance/v5_3/policies.ts';
import type { Player } from '../rules.ts';

if (modelConfigured() || kaneConfig().enabled) { console.error('playtest: refusing to start, an LLM provider or the Kane referee is still enabled'); process.exit(1); }

const HOST = '127.0.0.1', PORT = Number(process.env.PLAYTEST_PORT || 3100);
const MAX_BODY = 16_000;

type PSession = {
  id: string; consented: boolean; participant: string | null; mode: 'pilot' | 'free'; plan: ReturnType<typeof P.planFor>; slotIndex: number; restarts: number;
  free: { opponent: Policy53 | null; first: Player | 'coin' }; current: string | null; games: string[]; createdAt: number;
};
const sessions = new Map<string, PSession>();

function json(res: ServerResponse, status: number, obj: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(obj));
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
const cookieSession = (req: IncomingMessage) => { const m = /(?:^|;\s*)pt=([0-9a-f-]{36})/.exec(req.headers.cookie || ''); return m ? sessions.get(m[1]) ?? null : null; };
const fail = (status: number, reason: string) => Object.assign(new Error(reason), { status });

function nextConfig(ps: PSession): { opponent: Policy53; first?: Player; seed?: number; pilot: S.PlaytestGame['pilot'] } {
  if (ps.mode === 'pilot') {
    const plan = ps.plan!; const slot = plan.slots[ps.slotIndex];
    if (!slot) throw fail(409, 'All three pilot games are done. Thank you!');
    return { opponent: slot.opponent, first: slot.first, seed: slot.seed + 500 * ps.restarts, pilot: { participant: plan.participant, slot: slot.slot, of: plan.slots.length } };
  }
  if (!ps.free.opponent) throw fail(409, 'Choose an opponent first.');
  return { opponent: ps.free.opponent, ...(ps.free.first !== 'coin' ? { first: ps.free.first } : {}), pilot: null };
}
/** A finished (not abandoned) pilot game moves the schedule to the next slot. Idempotent. */
function syncSlot(ps: PSession) {
  const cur = ps.current ? S.getPlaytest(ps.current) : null;
  if (ps.mode === 'pilot' && cur && cur.endedAt && !cur.abandoned && cur.pilot && ps.plan!.slots[ps.slotIndex]?.slot === cur.pilot.slot) { ps.slotIndex++; ps.restarts = 0; }
}
function sessionView(ps: PSession) {
  syncSlot(ps);
  const cur = ps.current ? S.getPlaytest(ps.current) : null;
  return {
    sessionId: ps.id, consented: ps.consented, participant: ps.participant, mode: ps.mode,
    plan: ps.plan ? { ...ps.plan, done: ps.slotIndex } : null, next: (() => { try { const c = nextConfig(ps); return { opponent: O.opponentInfo(c.opponent), first: c.first ?? 'coin' }; } catch (e) { return { error: (e as Error).message }; } })(),
    free: ps.free, current: cur ? { gameId: cur.g.id, opponent: cur.opponent, over: !!cur.g.state.winner || cur.abandoned, feedback: cur.feedback } : null, games: ps.games.length,
  };
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const origin = req.headers.origin;
  if (req.method === 'POST' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return json(res, 403, { error: 'origin_mismatch' });
  let b: any = {};
  if (req.method === 'POST') { try { b = await body(req); } catch { return json(res, 400, { error: 'bad_json' }); } }
  const ps = cookieSession(req);

  // ---- playtest endpoints ----
  if (path === '/api/health' && req.method === 'GET') return json(res, 200, { openrouter: { configured: false }, referee: { mode: 'engine-only', kane: { installed: false, detail: 'Kane is off in the playtest' }, tiers: false }, authority: 'server', playtest: true });
  if (path === '/api/playtest/info' && req.method === 'GET') {
    const i = O.integrity();
    return json(res, 200, { mode: O.PLAYTEST_MODE, opponents: O.POLICIES53.map(O.opponentInfo), integrity: i, consent: { version: T.CONSENT_VERSION, statement: T.CONSENT_STATEMENT }, holdout: S.HOLDOUT, pilotSize: P.PILOT_SIZE });
  }
  if (path === '/api/playtest/session' && req.method === 'GET') return ps ? json(res, 200, sessionView(ps)) : json(res, 404, { error: 'no_session' });
  if (path === '/api/playtest/session' && req.method === 'POST') {
    const mode = b?.mode === 'pilot' ? 'pilot' : 'free';
    const participant = typeof b?.participant === 'string' && b.participant.trim() ? b.participant.trim().toUpperCase().slice(0, 8) : null;
    if (participant && !/^[A-Z0-9-]{1,8}$/.test(participant)) return json(res, 422, { error: 'rejected', reason: 'Participant code: letters and digits only (for example P03). No names.' });
    const plan = mode === 'pilot' ? (participant ? P.planFor(participant) : null) : null;
    if (mode === 'pilot' && !plan) return json(res, 422, { error: 'rejected', reason: 'Pilot mode needs a participant code P01–P99.' });
    if (ps?.current) { const old = S.getPlaytest(ps.current); if (old) S.abandon(old); }
    const n: PSession = { id: randomUUID(), consented: b?.consent === true, participant, mode, plan, slotIndex: 0, restarts: 0, free: { opponent: null, first: 'coin' }, current: null, games: [], createdAt: Date.now() };
    sessions.set(n.id, n);
    T.saveConsent({ schema: T.CONSENT_VERSION, sessionId: n.id, participant, consented: n.consented, at: new Date().toISOString(), mode, statement: T.CONSENT_STATEMENT });
    return json(res, 200, sessionView(n), { 'Set-Cookie': `pt=${n.id}; HttpOnly; SameSite=Strict; Path=/` });
  }
  if (!ps && path.startsWith('/api/')) return json(res, 401, { error: 'no_session', reason: 'Open the playtest start screen first.' });
  const s = ps!;
  if (path === '/api/playtest/select' && req.method === 'POST') {
    if (s.mode !== 'free') return json(res, 409, { error: 'rejected', reason: 'The pilot schedule decides the opponent.' });
    if (!O.isPolicy(b?.opponent)) return json(res, 422, { error: 'rejected', reason: 'Unknown opponent.' });
    s.free = { opponent: b.opponent, first: b.first === 'human' || b.first === 'ai' ? b.first : 'coin' };
    return json(res, 200, sessionView(s));
  }
  if (path === '/api/playtest/live' && req.method === 'GET') {
    const cur = s.current ? S.getPlaytest(s.current) : null;
    if (!cur) return json(res, 200, { gameId: null });
    const lat = cur.turns.filter(t => t.ai).map(t => t.ai!.wallMs);
    return json(res, 200, { gameId: cur.g.id, opponent: cur.opponent, thinkingMs: cur.thinking ? Date.now() - cur.thinking.since : null, lastMs: lat.at(-1) ?? null, maxMs: lat.length ? Math.max(...lat) : null, aiTurns: lat.length, budgetHits: cur.turns.filter(t => t.ai?.meta.budgetHit).length });
  }
  let m = path.match(/^\/api\/playtest\/review\/([0-9a-f-]{36})$/);
  if (m && req.method === 'GET') {
    const pg = S.getPlaytest(m[1]);
    if (!pg || pg.sessionId !== s.id) return json(res, 404, { error: 'no_such_game' });
    return json(res, 200, { ...S.record(pg), recorded: pg.recorded });
  }
  if (path === '/api/playtest/feedback' && req.method === 'POST') {
    const pg = typeof b?.gameId === 'string' ? S.getPlaytest(b.gameId) : undefined;
    if (!pg || pg.sessionId !== s.id) return json(res, 404, { error: 'no_such_game' });
    if (!pg.endedAt) return json(res, 409, { error: 'rejected', reason: 'The questionnaire is for finished games.' });
    if (pg.feedback !== 'none') return json(res, 409, { error: 'rejected', reason: 'Already answered for this game.' });
    const ITEMS = ['enjoyment', 'challenge', 'predictability', 'strategicChoice', 'playAgain'] as const;
    const ratings: Record<string, number | null> = {};
    for (const k of ITEMS) { const v = b?.ratings?.[k]; ratings[k] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : null; }
    const TAGS = ['repetitive', 'unfair', 'confusing', 'satisfying'];
    const tags = Array.isArray(b?.tags) ? TAGS.filter(t => b.tags.includes(t)) : [];
    const comment = typeof b?.comment === 'string' ? b.comment.slice(0, 600) : '';
    const skipped = b?.skipped === true;
    pg.feedback = skipped ? 'skipped' : 'submitted';
    if (s.consented) T.saveFeedback(s.id, { schema: 'rule-sabotage/playtest-feedback@1', kind: 'subjective', gameId: pg.g.id, sessionId: s.id, participant: s.participant, at: new Date().toISOString(), skipped, ratings: skipped ? null : ratings, tags: skipped ? [] : tags, comment: skipped ? '' : comment, scale: '1 = not at all, 5 = very much; predictability: 5 = very predictable' });
    return json(res, 200, { ok: true, stored: s.consented });
  }
  if (path === '/api/playtest/withdraw' && req.method === 'POST') {
    const removed = T.withdraw(s.id);
    s.consented = false;
    for (const id of s.games) { const pg = S.getPlaytest(id); if (pg) pg.recorded = false; }
    return json(res, 200, { ok: true, removedFiles: removed.length });
  }
  if (path === '/api/playtest/end' && req.method === 'POST') {
    const cur = s.current ? S.getPlaytest(s.current) : null;
    if (cur?.g.busy) return json(res, 409, { error: 'rejected', reason: 'Wait until the opponent has finished its turn.' });
    if (cur && !cur.endedAt) { S.abandon(cur); if (s.mode === 'pilot') s.restarts++; }
    return json(res, 200, sessionView(s));
  }

  // ---- the production game API contract, used by the unchanged client/app.js ----
  try {
    if (path === '/api/game' && req.method === 'POST') {
      const cur = s.current ? S.getPlaytest(s.current) : null;
      if (cur?.g.busy) throw fail(409, 'Wait until the opponent has finished its turn.');
      if (cur && !cur.endedAt) { S.abandon(cur); if (s.mode === 'pilot') s.restarts++; }
      syncSlot(s);
      const c = nextConfig(s);
      const pg = S.startPlaytest({ sessionId: s.id, recorded: s.consented, opponent: c.opponent, seed: c.seed, first: c.first, pilot: c.pilot });
      s.current = pg.g.id; s.games.push(pg.g.id);
      const ai = await S.beginPlaytest(pg);
      return json(res, 200, { ...view(pg.g), ai, playtest: { opponent: O.opponentInfo(pg.opponent), seed: pg.seed, first: pg.first, pilot: pg.pilot, recorded: pg.recorded } });
    }
    m = path.match(/^\/api\/game\/([0-9a-f-]{36})(\/(preview|place|move|end|progress))?$/);
    if (!m) return json(res, 404, { error: 'not_found' });
    const pg = S.getPlaytest(m[1]);
    if (!pg || pg.sessionId !== s.id || !getGame(m[1])) return json(res, 404, { error: 'no_such_game' });
    const action = m[3];
    if (!action && req.method === 'GET') return json(res, 200, view(pg.g));
    if (action === 'progress' && req.method === 'GET') return json(res, 200, { busy: pg.g.busy, progress: pg.g.progress });
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (pg.abandoned) throw fail(409, 'This game was ended. Start the next game.');
    const cellList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 49 && v.every(c => typeof c === 'string' && /^[0-6],[0-6]$/.test(c)));
    if (action === 'preview') {
      if (typeof b?.text !== 'string' || b.text.length > 400) return json(res, 400, { error: 'invalid_text' });
      return json(res, 200, await S.humanPreview(pg, b.text));
    }
    if (action === 'place') {
      if (!b || typeof b !== 'object' || (b.token !== undefined && typeof b.token !== 'string') || !cellList(b.cells) || !cellList(b.remove)) return json(res, 400, { error: 'invalid_placement' });
      return json(res, 200, await S.humanPlace(pg, { token: b.token, cells: b.cells, remove: b.remove }));
    }
    if (action === 'move') {
      if (!b || typeof b.from !== 'string' || !/^[0-6],[0-6]$/.test(b.from) || !['up', 'down', 'left', 'right'].includes(b.dir)) return json(res, 400, { error: 'invalid_move' });
      return json(res, 200, S.humanMove(pg, { from: b.from, dir: b.dir, mode: b.mode === 'single' ? 'single' : 'stack' }));
    }
    if (action === 'end') return json(res, 200, await S.humanEnd(pg));
  } catch (e) {
    const err = e as Error & { status?: number };
    return json(res, err.status ?? 409, { error: 'rejected', reason: err.message.slice(0, 300) });
  }
  return json(res, 404, { error: 'not_found' });
}

const CLIENT = new URL('../../client/', import.meta.url);
const STATIC: Record<string, [URL, string]> = {
  '/': [new URL('playtest/index.html', CLIENT), 'text/html; charset=utf-8'],
  '/app.js': [new URL('app.js', CLIENT), 'text/javascript; charset=utf-8'],
  '/style.css': [new URL('style.css', CLIENT), 'text/css; charset=utf-8'],
  '/playtest.js': [new URL('playtest/playtest.js', CLIENT), 'text/javascript; charset=utf-8'],
  '/playtest.css': [new URL('playtest/playtest.css', CLIENT), 'text/css; charset=utf-8'],
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

if (process.env.PLAYTEST_NO_LISTEN !== '1') {
  server.listen(PORT, HOST, () => {
    const i = O.integrity();
    console.log(`Rule Sabotage HUMAN PLAYTEST (not production) on http://${HOST}:${PORT}`);
    console.log(`  Opponents: ${O.POLICIES53.join(', ')} · code ${i.current.all} ${i.matches ? '= frozen V5.3' : `MODIFIED since V5.3 (${i.mismatched.join(', ')})`}`);
    console.log('  Referee: engine-only (no Kane) · interpreter: offline parser (no LLM) · network: disabled');
    console.log(`  Data (only with consent): ${T.DATA_DIR}`);
  });
}

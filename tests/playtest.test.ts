/**
 * Human playtest shell: schedule balance, frozen opponents, isolation (no Kane, no LLM, no network), consent-gated storage,
 * and one short scripted API turn (a software check, not a human session: no questionnaire answers are invented, and the
 * temporary data directory is deleted).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DATA = mkdtempSync(join(tmpdir(), 'rs-playtest-'));
process.env.PLAYTEST_DATA_DIR = DATA; process.env.PLAYTEST_NO_LISTEN = '1'; process.env.OPENROUTER_API_KEY = 'must-be-removed';
const realFetch = globalThis.fetch;
const { server } = await import('../server/playtest/server.ts');
const P = await import('../server/playtest/pilot.ts');
const O = await import('../server/playtest/opponents.ts');
const S = await import('../server/playtest/session.ts');
test.after(() => { server.close(); S.stopPlanner(); rmSync(DATA, { recursive: true, force: true }); });

test('pilot schedule: every opponent in every position equally often, first mover balanced per opponent, seeds outside the holdout', () => {
  const plans = P.pilotSchedule(12), pos: Record<string, number[]> = {}, first: Record<string, Record<string, number>> = {}, seeds = new Set<number>();
  for (const p of plans) for (const s of p.slots) {
    (pos[s.opponent] ??= [0, 0, 0])[s.slot - 1]++;
    (first[s.opponent] ??= { human: 0, ai: 0 })[s.first]++;
    assert.ok(!S.isHoldout(s.seed)); seeds.add(s.seed);
  }
  for (const o of O.POLICIES53) { assert.deepEqual(pos[o], [4, 4, 4]); assert.deepEqual(first[o], { human: 6, ai: 6 }); }
  assert.equal(seeds.size, 36);
  assert.throws(() => S.startPlaytest({ sessionId: '00000000-0000-0000-0000-000000000000', recorded: false, opponent: 'ev-k1.2', seed: 65010 }), /holdout/);
});

test('opponents are the frozen V5.3 code; the process has no LLM, no Kane and no network', async () => {
  assert.equal(O.integrity().matches, true, `mismatched: ${O.integrity().mismatched}`);
  assert.equal(process.env.OPENROUTER_API_KEY, undefined);
  assert.equal(process.env.KANE_REFEREE, 'off');
  await assert.rejects(() => globalThis.fetch('https://example.com'), /network disabled/);
  assert.equal(O.OPPONENTS['oa-v3'].slow, true);
  assert.match(O.OPPONENTS['oa-v3'].latencyNote, /run past/);
});

test('scripted API turn: consent off writes nothing; consent on writes telemetry and feedback to separate files; withdraw deletes them', { timeout: 300_000 }, async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (cookie: string, path: string, body?: unknown) => {
    const r = await realFetch(base + path, body === undefined ? { headers: { cookie } } : { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() as any, setCookie: r.headers.get('set-cookie') };
  };
  const session = async (consent: boolean) => { const r = await call('', '/api/playtest/session', { consent, mode: 'free' }); return r.setCookie!.split(';')[0]; };

  // without consent
  const c1 = await session(false);
  assert.equal((await call(c1, '/api/game', {})).status, 409, 'an opponent must be chosen');
  await call(c1, '/api/playtest/select', { opponent: 'ev-k1.2', first: 'human' });
  const g = await call(c1, '/api/game', {});
  assert.equal(g.status, 200); assert.equal(g.json.current, 'human'); assert.equal(g.json.playtest.opponent.id, 'ev-k1.2'); assert.equal(g.json.playtest.recorded, false);
  const id = g.json.gameId;
  const pv = await call(c1, `/api/game/${id}/preview`, { text: 'Frozen for a turn' });
  assert.equal(pv.json.interpretation.source, 'offline-parser');
  const pl = await call(c1, `/api/game/${id}/place`, { token: pv.json.token, cells: ['3,0'] });
  assert.equal(pl.status, 200); assert.ok(['engine-approved', 'unverified', 'rejected'].includes(pl.json.verdicts[0].final));
  const mv = await call(c1, `/api/game/${id}/move`, { from: '0,1', dir: 'right', mode: 'stack' });
  assert.equal(mv.status, 200);
  const end = await call(c1, `/api/game/${id}/end`, {});
  assert.equal(end.status, 200); assert.equal(end.json.view.current, 'human'); assert.equal(typeof end.json.ai.playtest.wallMs, 'number');
  const rv = await call(c1, `/api/playtest/review/${id}`);
  assert.equal(rv.json.turns.length, 2); assert.equal(rv.json.turns[0].p, 'human'); assert.equal(rv.json.turns[0].moves[0].from, 'A2'); assert.ok(rv.json.turns[1].ai.wallMs >= 0);
  await call(c1, '/api/playtest/end', {});
  assert.ok(!existsSync(join(DATA, 'telemetry')) || readdirSync(join(DATA, 'telemetry')).length === 0, 'nothing recorded without consent');

  // with consent: an abandoned game is still recorded; feedback goes to a different file
  const c2 = await session(true);
  await call(c2, '/api/playtest/select', { opponent: 'softmax-v2', first: 'human' });
  const g2 = await call(c2, '/api/game', {});
  await call(c2, '/api/playtest/end', {});
  const fb = await call(c2, '/api/playtest/feedback', { gameId: g2.json.gameId, skipped: true });
  assert.equal(fb.json.stored, true);
  const tel = readdirSync(join(DATA, 'telemetry')), fbf = readdirSync(join(DATA, 'feedback'));
  assert.equal(tel.length, 1); assert.equal(fbf.length, 1);
  const rec = JSON.parse(readFileSync(join(DATA, 'telemetry', tel[0]), 'utf8').trim());
  assert.equal(rec.kind, 'telemetry'); assert.equal(rec.result.abandoned, true); assert.equal(rec.opponent.id, 'softmax-v2'); assert.equal(rec.ratings, undefined);
  const w = await call(c2, '/api/playtest/withdraw', {});
  assert.equal(w.json.removedFiles, 3);
  assert.equal(readdirSync(join(DATA, 'telemetry')).length + readdirSync(join(DATA, 'feedback')).length + readdirSync(join(DATA, 'sessions')).length, 0);
});

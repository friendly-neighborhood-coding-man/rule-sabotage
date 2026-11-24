/**
 * V6.2: Kane shadow-mode infrastructure (never invokes Kane), V6.1 pilot telemetry (consent, separate facts and answers,
 * deletion), and the referee-aware selection adapter. Deterministic; no Kane, no LLM, no network, no self-play batch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
const DATA = mkdtempSync(join(tmpdir(), 'rs-v62-'));
process.env.PLAYTEST_DATA_DIR = DATA;
const SHADOW = DATA + '-kane-shadow';
process.env.V6_KANE_SHADOW_DIR = SHADOW; // Kane evaluation data lives outside the pilot data directory
const realFetch = globalThis.fetch;
const E = await import('../server/v6/engine.ts');
const { makeEffect } = await import('../server/rules.ts');
const { loadWeights } = await import('../server/weights.ts');
const { refereeV6, trials } = await import('../server/v6/turn.ts');
const K = await import('../server/v6/kaneshadow.ts');
const RA = await import('../server/v6/referee-aware.ts');
type State = import('../server/v6/engine.ts').State;
type Player = import('../server/rules.ts').Player;
const W8 = loadWeights();
test.after(() => { rmSync(DATA, { recursive: true, force: true }); rmSync(SHADOW, { recursive: true, force: true }); });

const k = (x: number, y: number) => `${x},${y}`;
const pl = (cells: string[], effect = makeEffect('freeze')) => ({ text: 'test effect', effect, cells, interpretedBy: 'test' });
function pos(p: Player, pieces: Record<string, [number, number]>, ruleset: E.Ruleset = E.RULESET_V61): State {
  const s = E.init(4242, { first: p, ruleset });
  for (const q of s.pieces) { const at = pieces[q.id]; if (at) { q.x = at[0]; q.y = at[1]; } else q.scored = true; }
  s.current = p; s.phase = 'place'; s.actionsLeft = 3;
  return s;
}
const addRule = (s: State, id: number, owner: Player, cells: string[], effect = makeEffect('freeze')) => {
  s.rules.push({ id, owner, text: 'x', effect, label: 'x', summary: '', icon: '', cells: [...cells], placed: cells.length, turn: 1, hits: { human: 0, ai: 0 }, interpretedBy: 't' });
  for (const c of cells) s.cells[c] = id;
};
/** A corner effect whose cell cannot be entered in the trial (both neighbours hold effects): the referee leaves it at tier 3. */
function tier3Position(): { s: State; blocked: ReturnType<typeof pl> } {
  const s = pos('ai', { a1: [8, 4], h1: [4, 6] });
  addRule(s, 70, 'ai', [k(1, 0), k(0, 1)], makeEffect('shield'));
  return { s, blocked: pl([k(0, 0)]) };
}

// ---------------------------------------------------------------- Kane shadow mode
test('shadow: disagreement classification covers every engine/Kane combination', () => {
  const c = (e: string, kk: string) => K.classify({ final: e as never }, { status: kk as never });
  assert.equal(c('engine-approved', 'approved'), 'agree-approved');
  assert.equal(c('engine-approved', 'rejected'), 'engine-approved-kane-rejected');
  assert.equal(c('unverified', 'approved'), 'engine-unverified-kane-approved');
  assert.equal(c('unverified', 'rejected'), 'agree-not-approved');
  assert.equal(c('rejected', 'approved'), 'engine-rejected-kane-approved');
  assert.equal(c('rejected', 'rejected'), 'agree-not-approved');
  for (const e of ['engine-approved', 'unverified', 'rejected']) { assert.equal(c(e, 'unverified'), 'kane-inconclusive'); assert.equal(c(e, 'error'), 'kane-inconclusive'); }
});

test('shadow: a case records the engine decision as made; rule-stage refusals are not cases; inputs are not changed', () => {
  const { s, blocked } = tier3Position();
  const r = refereeV6(s, 'ai', blocked);
  assert.equal(r.verdict.final, 'unverified', r.verdict.message);
  const before = JSON.stringify(r.verdict);
  const c = K.shadowCase({ ruleset: s.ruleset, gameId: null, turn: s.turn, proposer: 'ai', placement: { text: blocked.text, effect: r.verdict.effect!, cells: r.verdict.cellKeys! }, verdict: r.verdict, trialHtml: trials.get(r.verdict.trialId!)!.html });
  assert.ok(c); assert.equal(c!.engine.final, 'unverified'); assert.equal(c!.engine.activated, false);
  assert.deepEqual(c!.placement.effect, makeEffect('freeze'), 'typed effect, never re-interpreted');
  assert.equal(JSON.stringify(r.verdict), before);
  // a placement refused by rule A2 had no trial: nothing for Kane
  const t = pos('human', { h1: [5, 4], a1: [12, 0] });
  const illegal = refereeV6(t, 'human', pl([k(6, 4)]));
  assert.equal(illegal.verdict.stage, 'rule');
  assert.equal(K.shadowCase({ ruleset: t.ruleset, gameId: null, turn: 1, proposer: 'human', placement: { text: 'x', effect: makeEffect('freeze'), cells: [k(6, 4)] }, verdict: illegal.verdict, trialHtml: null }), null);
});

test('shadow: execution is disabled in code; only a test double runs; Kane has no path to a game', async () => {
  assert.equal(K.SHADOW_EXECUTION, 'disabled');
  const src = readFileSync(new URL('../server/v6/kaneshadow.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/kane\.ts'|import\('\.\.\/kane\.ts'\)|kaneJudge|child_process|fetch\(/, 'no Kane client, no process, no network');
  assert.doesNotMatch(src, /applyPlacement|applyMove|activateLate|from '\.\/engine\.ts'/, 'no engine mutation');
  const { s, blocked } = tier3Position();
  const log = new K.ShadowLog(join(DATA, 'shadow-unit'));
  const r = refereeV6(s, 'ai', blocked);
  const html = trials.get(r.verdict.trialId!)!.html;
  log.addCase(K.shadowCase({ ruleset: s.ruleset, gameId: 'g', turn: s.turn, proposer: 'ai', placement: { text: blocked.text, effect: r.verdict.effect!, cells: r.verdict.cellKeys! }, verdict: r.verdict, trialHtml: html, refereeMs: r.verdict.ms })!, html);
  await assert.rejects(K.runShadow(log), K.ShadowExecutionDisabled);
  await assert.rejects(K.runShadow(log, { testDouble: false, judge: async () => ({}) } as never), K.ShadowExecutionDisabled);
  assert.equal(log.plan().pending, 1);
  const stateBefore = JSON.stringify(s);
  const n = await K.runShadow(log, { testDouble: true, judge: async () => ({ status: 'approved', reason: 'double', conditionResults: [true], elapsedMs: 5, kaneVersion: 'test-double', evidencePath: null }) });
  assert.equal(n, 1);
  assert.equal(JSON.stringify(s), stateBefore, 'a Kane approval changes nothing in the game');
  assert.equal(E.ruleAt(s, k(0, 0)), null, 'the unverified rule stays unplaced');
  const rep = log.report();
  assert.equal(rep.cases, 1); assert.equal(rep.rows[0].engine, 'unverified'); assert.equal(rep.rows[0].kane, 'approved');
  assert.equal(rep.rows[0].disagreement, 'engine-unverified-kane-approved'); assert.equal(rep.rows[0].testDouble, true);
  assert.equal(typeof rep.rows[0].engineMs, 'number'); assert.equal(rep.rows[0].kaneMs, 5);
  // append-only: a second (inconclusive) verdict is added, the first is kept
  log.addVerdict({ schema: K.SHADOW_SCHEMA, kind: 'kane', caseId: rep.rows[0].caseId, at: 'x', status: 'unverified', reason: 'r', conditionResults: [], elapsedMs: 1, kaneVersion: null, evidencePath: null, testDouble: true });
  assert.equal(log.read().verdicts.length, 2); assert.equal(log.report().rows[0].kaneAttempts, 2);
  assert.throws(() => log.addCase(log.read().cases[0], '<html>other</html>'), /does not match/);
});

// ---------------------------------------------------------------- referee-aware adapter
test('adapter: skips an effect the referee would not place, takes the next placeable plan, never touches the real state', () => {
  const { s, blocked } = tier3Position();
  const ok = pl([k(6, 2)], makeEffect('shove', 'west', 2));
  const mk = (id: string, placement: unknown, score: number) => ({ id, placement, moves: [], score, afterReply: 0, summary: id });
  const ranked = [mk('p1', { effect: blocked.effect, cells: blocked.cells }, 3), mk('p2', { effect: ok.effect, cells: ok.cells }, 2), mk('p3', null, 1)];
  const plan = { chosen: ranked[0], ranked, candidates: 3, sims: 0, ms: 0, meta: { policy: 'ev-k1.2', ms: 0, sims: 0 } } as never;
  const before = JSON.stringify(s), memo: RA.RAMemo = new Map();
  const r = RA.selectRefereeAware(s, 'ai', plan, memo);
  assert.equal(JSON.stringify(s), before, 'pre-check ran on a copy');
  assert.equal(r.chosen.id, 'p2'); assert.equal(r.ra.chosenRank, 2);
  assert.equal(r.ra.skippedUnenterable, 1, 'the un-enterable corner is skipped by the static check, without a trial'); assert.equal(r.ra.trials, 1);
  // repeat suppression: the same blocked proposal in the same situation costs no new trial
  const r2 = RA.selectRefereeAware(s, 'ai', plan, memo);
  assert.equal(r2.ra.skippedKnownBlocked, 1); assert.equal(r2.ra.trials, 0); assert.equal(r2.chosen.id, 'p2');
});

test('adapter: bounded trials, then the best plan without an effect; the real referee still decides', () => {
  const { s, blocked } = tier3Position();
  const mk = (id: string, placement: unknown, score: number) => ({ id, placement, moves: [], score, afterReply: 0, summary: id });
  // four different blocked proposals (corner cells made unenterable), then "no effect"
  addRule(s, 71, 'ai', [k(11, 0), k(12, 1), k(1, 8), k(0, 7), k(12, 7), k(11, 8)], makeEffect('shield'));
  const corners = [k(0, 0), k(12, 0), k(0, 8), k(12, 8)];
  const ranked = [...corners.map((c, i) => mk(`p${i + 1}`, { effect: blocked.effect, cells: [c] }, 10 - i)), mk('none', null, 1)];
  const plan = { chosen: ranked[0], ranked, candidates: 5, sims: 0, ms: 0, meta: { policy: 'ev-k1.2', ms: 0, sims: 0 } } as never;
  const r = RA.selectRefereeAware(s, 'ai', plan, new Map());
  assert.equal(r.chosen.id, 'none'); assert.equal(r.ra.skippedUnenterable, 4); assert.equal(r.ra.trials, 0, 'no trial needed for statically un-enterable cells');
  // four proposals the referee refuses only after running (cells next to the AI's own piece, rule A2): budget of 3 trials
  const near = [k(7, 4), k(9, 4), k(8, 3), k(8, 5)].map((c, i) => mk(`n${i + 1}`, { effect: blocked.effect, cells: [c] }, 10 - i));
  const plan2 = { chosen: near[0], ranked: [...near, mk('none', null, 1)], candidates: 5, sims: 0, ms: 0, meta: { policy: 'ev-k1.2', ms: 0, sims: 0 } } as never;
  const r2 = RA.selectRefereeAware(s, 'ai', plan2, new Map());
  assert.equal(r2.ra.trials, RA.MAX_TRIALS); assert.equal(r2.chosen.id, 'none'); assert.ok(r2.ra.fallback!.startsWith(`trial budget (${RA.MAX_TRIALS}) used up`), r2.ra.fallback!);
});

test('adapter: the static un-enterable check agrees with the real referee trial on 60 random placements', () => {
  let x = 12345; const rnd = (n: number) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
  let flagged = 0;
  for (let i = 0; i < 60; i++) {
    const s = pos('ai', { a1: [9, 4], a2: [11, 7], h1: [2, 2], h2: [3, 6] });
    // a crowded board: 30 random effect cells away from pieces
    const cells: string[] = [];
    for (let j = 0; j < 30; j++) { const c = k(rnd(13), rnd(9)); if (!cells.includes(c) && E.cellBlock(s, 'ai', c) === null) cells.push(c); }
    addRule(s, 80, 'human', cells.slice(0, 15), makeEffect('shield')); addRule(s, 81, 'ai', cells.slice(15), makeEffect('freeze'));
    const elig = E.eligibleCells(s, 'ai'); if (elig.length < 3) continue;
    const pick = [...new Set([elig[rnd(elig.length)], elig[rnd(elig.length)], elig[rnd(elig.length)]])];
    const p0 = pl(pick, makeEffect('freeze'));
    const predicted = RA.unenterableCell(s, p0);
    const v = refereeV6(structuredClone(s), 'ai', p0, { keepTrial: false }).verdict;
    const trialSaysUnenterable = /a new cell could not be entered in the trial/.test(v.message);
    assert.equal(predicted !== null, trialSaysUnenterable, `placement ${pick.join(' ')}: ${v.message}`);
    if (predicted) flagged++;
  }
  assert.ok(flagged > 2, `only ${flagged} un-enterable cases exercised`);
});

// ---------------------------------------------------------------- pilot telemetry (consent, separation, deletion)
test('pilot: consenting session records facts, answers and shadow cases separately; withdraw deletes all; no consent writes nothing', async () => {
  process.env.V6_NO_LISTEN = '1';
  const { server } = await import('../server/v6/server.ts');
  const S = await import('../server/v6/session.ts');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const call = async (p: string, b?: unknown, cookie = '') => { const r = await realFetch(`http://127.0.0.1:${port}${p}`, b === undefined ? { headers: { cookie } } : { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() as any, setCookie: r.headers.get('set-cookie') }; };
  try {
    const c = await call('/api/v6/consent'); assert.match(c.j.statement, /No name/); assert.match(c.j.statement, /not run now and never changes a game/);
    const sess = await call('/api/v6/session', { consent: true, participant: 'p07' });
    assert.equal(sess.j.consented, true); assert.equal(sess.j.participant, 'P07');
    const cookie = sess.setCookie!.split(';')[0];
    const sid = cookie.split('=')[1];
    const g = await call('/api/game', { ruleset: 'v6.1', opponent: 'v6-softmax-v2', first: 'human', seed: 99981 }, cookie);
    const pv = await call(`/api/game/${g.j.gameId}/preview`, { text: 'Frozen for a turn' }, cookie);
    assert.equal((await call(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['1,4'] }, cookie)).status, 422, 'A2 refusal');
    assert.equal((await call(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['5,4'] }, cookie)).status, 200);
    assert.equal((await call(`/api/game/${g.j.gameId}`)).status, 404, 'another session cannot read the game');
    // a new game abandons the first one, which is then recorded
    await call('/api/game', { ruleset: 'v6.1', opponent: 'v6-softmax-v2', first: 'human', seed: 99982 }, cookie);
    const fb = await call('/api/v6/feedback', { gameId: g.j.gameId, ratings: { enjoyment: 4, challenge: 9 }, tags: ['too-slow', 'bogus'], comment: 'ok' }, cookie);
    assert.equal(fb.j.stored, true);
    const tele = readFileSync(join(DATA, 'telemetry', `${sid}.ndjson`), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(tele.length, 1); assert.equal(tele[0].schema, 'rule-sabotage/v6-telemetry@1'); assert.equal(tele[0].ruleset, E.RULESET_V61);
    assert.equal(tele[0].result.abandoned, true); assert.equal(tele[0].placements.human.refusedByPlacementRule[0].code, 'near-own');
    assert.equal(JSON.stringify(tele[0]).includes('ratings'), false, 'facts carry no subjective field');
    const ans = JSON.parse(readFileSync(join(DATA, 'feedback', `${sid}.ndjson`), 'utf8').trim());
    assert.deepEqual(ans.ratings, { enjoyment: 4, challenge: null, predictability: null, strategicChoice: null, playAgain: null }, 'invalid or missing answers stay null');
    assert.deepEqual(ans.tags, ['too-slow']);
    const shadow = new K.ShadowLog(join(SHADOW, sid)).read();
    assert.ok(!existsSync(join(DATA, 'kane-shadow')), 'no Kane data inside the pilot data directory');
    assert.ok(shadow.cases.some(x => x.proposer === 'human' && x.engine.final === 'engine-approved'), 'the human placement became a shadow case');
    assert.equal(shadow.verdicts.length, 0, 'no Kane verdict exists: nothing was run');
    const rv = await call(`/api/v6/review/${g.j.gameId}`, undefined, cookie); assert.equal(rv.j.recorded, true);
    const w = await call('/api/v6/withdraw', {}, cookie);
    assert.ok(w.j.removedFiles >= 3);
    assert.ok(!existsSync(join(DATA, 'telemetry', `${sid}.ndjson`)) && !existsSync(join(DATA, 'feedback', `${sid}.ndjson`)) && !existsSync(join(SHADOW, sid)));
    // no consent: plays, writes nothing
    const n = await call('/api/v6/session', { consent: false }, '');
    const ncookie = n.setCookie!.split(';')[0], nid = ncookie.split('=')[1];
    const g2 = await call('/api/game', { ruleset: 'v6.1', opponent: 'v6-softmax-v2', first: 'human', seed: 99983 }, ncookie);
    assert.equal(g2.status, 200);
    await call('/api/game', { ruleset: 'v6.1', opponent: 'v6-softmax-v2', first: 'human', seed: 99984 }, ncookie);
    for (const d of ['telemetry', 'feedback', 'sessions']) assert.ok(!existsSync(join(DATA, d)) || !readdirSync(join(DATA, d)).some(f => f.startsWith(nid)), d);
    assert.equal((await call('/api/v6/session', { consent: true, participant: 'Jane Doe' })).status, 422, 'names refused');
  } finally { await new Promise(r => server.close(r)); S.stopPlanner(); }
});

// ---------------------------------------------------------------- latency: semantics-preserving optimisations
test('latency: cloneState is a full deep copy equal to structuredClone; withFastClone restores the native function', async () => {
  const FC = await import('../server/v6/fastclone.ts');
  const { aiTurnV6, planningView } = await import('../server/v6/turn.ts');
  const s = E.init(99991, { first: 'human', ruleset: E.RULESET_V61 });
  for (let i = 0; i < 4; i++) await aiTurnV6(s, s.current, 'softmax-v2', W8);
  s.pieces[0].frozen = 1; s.pieces[1].shield = true;
  assert.deepEqual(Object.keys(s).sort(), [...FC.STATE_KEYS].sort());
  const a = FC.cloneState(s), b = structuredClone(s);
  assert.deepEqual(a, b);
  a.pieces[0].home.x = 99; a.rules[0].cells.push('x'); a.rules[0].hits.human = 77; (a.rules[0].effect as { kind: string }).kind = 'zzz'; a.cells['0,0'] = 5; a.stats.activePerTurn.push(9); a.bonus.ai = 3;
  assert.deepEqual(s, b, 'no shared mutable object');
  const native = globalThis.structuredClone;
  assert.throws(() => FC.withFastClone(() => { throw new Error('x'); }));
  assert.equal(globalThis.structuredClone, native);
  // identical decisions on a mid-game position for every policy (the planning view and the fast copy together)
  const { planPolicy53 } = await import('../server/v6/forks/policies53.ts');
  for (const pol of ['softmax-v2', 'ev-k1.2', 'oa-v3'] as const) {
    const x = planPolicy53(pol, structuredClone(s), s.current, W8);
    const y = FC.withFastClone(() => planPolicy53(pol, planningView(s), s.current, W8));
    assert.deepEqual([y.chosen, y.ranked, y.sims], [x.chosen, x.ranked, x.sims], pol);
  }
});

test('latency: the optimised parseKey and teleportDestinations give exactly the old results', () => {
  const old = (k: string) => { const [x, y] = k.split(',').map(Number); return { x, y }; };
  for (const k of ['0,0', '12,8', '3,14', ',', '1,', ',2', 'a,b', '1,2,3', '', '7', ' 4, 5']) assert.deepEqual(E.parseKey(k), old(k), JSON.stringify(k));
  const s = pos('ai', { a1: [3, 4], a2: [3, 4], h1: [6, 2], h3: [11, 8] });
  addRule(s, 90, 'human', [k(2, 2), k(5, 5), k(11, 0)]);
  s.pieces.find(q => q.id === 'h2')!.x = 7; // a scored piece standing on a square does not occupy it
  const want: string[] = [];
  for (let x = 1; x < E.W - 1; x++) for (let y = 0; y < E.H; y++) { const c = k(x, y); if (!s.cells[c] && !E.piecesAt(s, c).length) want.push(c); }
  assert.deepEqual(E.teleportDestinations(s, { x: 0, y: 0 }), want);
});

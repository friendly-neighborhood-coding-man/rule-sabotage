/**
 * V6 experimental game (13x9 board, rule A1 "no new effects next to opponent pieces"). Engine, referee parity, AI
 * compatibility, replay, zero-move diagnosis, server-side enforcement, and isolation from the frozen V1-V5.3 code.
 * Small and deterministic: no self-play batch, no Kane, no LLM, no network, no holdout seed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
const E = await import('../server/v6/engine.ts');
const P = await import('../server/engine.ts');
const { makeEffect } = await import('../server/rules.ts');
const { loadWeights } = await import('../server/weights.ts');
const { refereeV6, aiTurnV6, diagnoseZeroMoves } = await import('../server/v6/turn.ts');
const { planPolicy53 } = await import('../server/v6/forks/policies53.ts');
const { candidatePlacements } = await import('../server/v6/forks/evk11.ts');
const { generateForks, ROOT, FORKS } = await import('../scripts/v6-fork.ts');
type State = import('../server/v6/engine.ts').State;
type Player = import('../server/rules.ts').Player;
const W8 = loadWeights();

const k = (x: number, y: number) => `${x},${y}`;
const pl = (cells: string[], effect = makeEffect('freeze')) => ({ text: 'test effect', effect, cells, interpretedBy: 'test' });
/** A position with the given pieces (others scored) and `p` to move in the placement step. */
function pos(p: Player, pieces: Record<string, [number, number]>): State {
  const s = E.init(123, { first: p });
  for (const q of s.pieces) { const at = pieces[q.id]; if (at) { q.x = at[0]; q.y = at[1]; } else q.scored = true; }
  s.current = p; s.phase = 'place'; s.actionsLeft = s.pieces.filter(q => q.owner === p && !q.scored).length;
  return s;
}
const mirror = (s: State): State => { const t = structuredClone(s); for (const q of t.pieces) { q.x = E.W - 1 - q.x; q.owner = q.owner === 'human' ? 'ai' : 'human'; } t.current = t.current === 'human' ? 'ai' : 'human'; return t; };

// ---------------------------------------------------------------- board and start
test('board is 13 columns x 9 rows; starts are symmetric (3 per side, rows 3/5/7)', () => {
  assert.equal(E.W, 13); assert.equal(E.H, 9); assert.equal(E.COLS.length, 13); assert.equal(E.MAX_TURNS, 60);
  const s = E.init(1);
  const h = s.pieces.filter(q => q.owner === 'human'), a = s.pieces.filter(q => q.owner === 'ai');
  assert.equal(h.length, 3); assert.equal(a.length, 3);
  assert.deepEqual(h.map(q => [q.x, q.y]), [[0, 2], [0, 4], [0, 6]]);
  assert.deepEqual(a.map(q => [q.x, q.y]), [[12, 2], [12, 4], [12, 6]]);
  for (const q of h) { assert.ok(a.some(r => r.x === E.W - 1 - q.x && r.y === q.y), 'left/right mirror'); assert.ok(h.some(r => r.y === E.H - 1 - q.y), 'top/bottom mirror'); }
  assert.deepEqual(E.GOAL_X, { human: 12, ai: 0 });
  assert.equal(E.cellName('12,8'), 'M9'); assert.equal(E.cellName('0,0'), 'A1');
  assert.ok(E.validKey('12,8')); assert.ok(!E.validKey('13,0')); assert.ok(!E.validKey('0,9')); assert.ok(!E.validKey('-1,0'));
  assert.equal(E.eligibleCells(s, s.current).length + Object.keys(E.blockedCells(s, s.current)).length, 13 * 9);
});

test('movement, board edges, scoring and the win condition on the enlarged board', () => {
  const s = pos('human', { h1: [11, 0], h2: [11, 8], h3: [5, 4], a1: [6, 0] });
  assert.ok(!E.validateMove(s, 'human', { from: k(11, 0), dir: 'up', mode: 'stack' }).ok, 'top edge');
  assert.ok(!E.validateMove(s, 'human', { from: k(11, 8), dir: 'down', mode: 'stack' }).ok, 'bottom edge');
  E.applyMove(s, 'human', { from: k(11, 0), dir: 'right', mode: 'stack' });
  assert.equal(E.scored(s, 'human'), 1, 'column M scores for the human');
  E.applyMove(s, 'human', { from: k(11, 8), dir: 'right', mode: 'stack' });
  assert.equal(s.winner, null);
  E.applyMove(s, 'human', { from: k(5, 4), dir: 'right', mode: 'stack' });
  assert.equal(s.pieces.find(q => q.id === 'h3')!.x, 6);
  // AI scores on column A
  const t = pos('ai', { a1: [1, 3], a2: [3, 3], h1: [6, 6] });
  const sc = E.scored(t, 'ai');
  E.applyMove(t, 'ai', { from: k(1, 3), dir: 'left', mode: 'stack' });
  assert.equal(E.scored(t, 'ai'), sc + 1);
  // a game where one side gets all 3 across ends immediately
  const u = pos('human', { h1: [11, 1], a1: [6, 6] }); u.pieces.filter(q => q.owner === 'human' && q.id !== 'h1').forEach(q => { q.scored = true; });
  const ev = E.applyMove(u, 'human', { from: k(11, 1), dir: 'right', mode: 'stack' });
  assert.equal(u.winner, 'human'); assert.ok(ev.some(e => e.t === 'win'));
  // capture sends the enemy home (its own start square on the far column)
  const c = pos('human', { h1: [5, 4], a2: [6, 4] });
  E.applyMove(c, 'human', { from: k(5, 4), dir: 'right', mode: 'stack' });
  assert.deepEqual([c.pieces.find(q => q.id === 'a2')!.x, c.pieces.find(q => q.id === 'a2')!.y], [12, 4]);
});

test('turn limit: 60 turns, then most across, then fewer squares left (unchanged rule)', () => {
  const s = E.init(5, { first: 'human' });
  s.turn = 60; s.pieces.find(q => q.id === 'h1')!.x = 9; // human 3 squares closer
  E.endTurn(s);
  assert.equal(s.winner, 'human'); assert.match(s.winReason, /Turn limit/);
});

// ---------------------------------------------------------------- rule A1
test('A1: a new effect is rejected on each of the 8 squares around an opponent piece (and on the piece itself)', () => {
  const s = pos('human', { h1: [0, 0], a2: [6, 4] });
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = E.validatePlacement(s, 'human', pl([k(6 + dx, 4 + dy)]));
    assert.equal(c.ok, false, `${dx},${dy}`);
    if (!c.ok) assert.equal(c.code, dx || dy ? 'near-opponent' : 'piece');
    if (!c.ok && (dx || dy)) assert.match(c.reason, /G5/);
  }
  assert.deepEqual(E.protectedCells(s, 'human'), ['5,3', '5,4', '5,5', '6,3', '6,5', '7,3', '7,4', '7,5']);
});

test('A1: squares at Chebyshev distance 2 or more are legal; the protected zone is clipped at the board edge', () => {
  const s = pos('human', { h1: [0, 0], a2: [6, 4] });
  for (const c of [k(4, 4), k(8, 4), k(6, 2), k(6, 6), k(4, 2), k(8, 6), k(4, 5)]) assert.ok(E.validatePlacement(s, 'human', pl([c])).ok, c);
  const e = pos('human', { h1: [0, 0], a1: [12, 0] });
  assert.deepEqual(E.protectedCells(e, 'human'), ['11,0', '11,1', '12,1']);
  assert.ok(E.validatePlacement(e, 'human', pl([k(10, 0), k(12, 2)])).ok);
});

test('A1: a multi-cell placement that partly touches the protected zone is rejected as a whole, nothing applied', () => {
  const s = pos('human', { h1: [0, 0], a2: [6, 4] });
  const before = JSON.stringify(s);
  const c = E.validatePlacement(s, 'human', pl([k(3, 4), k(4, 4), k(5, 5)]));
  assert.equal(c.ok, false);
  if (!c.ok) { assert.equal(c.cell, '5,5'); assert.match(c.reason, /3-cell placement is rejected as a whole/); }
  assert.throws(() => E.applyPlacement(s, 'human', pl([k(3, 4), k(4, 4), k(5, 5)])));
  const r = refereeV6(s, 'human', pl([k(3, 4), k(4, 4), k(5, 5)]));
  assert.equal(r.verdict.final, 'illegal'); assert.equal(r.verdict.stage, 'rule'); assert.equal(r.verdict.activated, false);
  assert.equal(JSON.stringify(s), before, 'no cell set, phase unchanged');
});

test('A1 applies to every opposing piece, including stacks and pieces sent home, and not to scored pieces', () => {
  const s = pos('human', { h1: [0, 0], a1: [12, 2], a2: [6, 4], a3: [6, 4] });
  assert.ok(!E.validatePlacement(s, 'human', pl([k(11, 3)])).ok, 'piece at its home square');
  assert.ok(!E.validatePlacement(s, 'human', pl([k(7, 4)])).ok, 'stack');
  s.pieces.find(q => q.id === 'a1')!.scored = true;
  assert.ok(E.validatePlacement(s, 'human', pl([k(11, 3)])).ok, 'a scored piece protects nothing');
});

test('A1 parity: the same function judges human and AI; mirrored positions give mirrored verdicts on every cell', () => {
  const s = pos('human', { h1: [2, 3], h2: [9, 7], a1: [5, 4], a2: [10, 1], a3: [10, 1] });
  s.cells[k(3, 0)] = 99; s.rules.push({ id: 99, owner: 'ai', text: 'x', effect: makeEffect('freeze'), label: 'Freeze', summary: '', icon: '', cells: [k(3, 0)], placed: 1, turn: 1, hits: { human: 0, ai: 0 }, interpretedBy: 't' });
  const m = mirror(s); m.rules[0].owner = 'human';
  m.cells = { [k(E.W - 1 - 3, 0)]: 99 }; m.rules[0].cells = [k(E.W - 1 - 3, 0)];
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
    const a = E.validatePlacement(s, 'human', pl([k(x, y)])), b = E.validatePlacement(m, 'ai', pl([k(E.W - 1 - x, y)]));
    assert.equal(a.ok, b.ok, `${x},${y}`);
    if (!a.ok && !b.ok) assert.equal(a.code, b.code, `${x},${y}`);
  }
  // the referee both sides go through rejects the same way
  assert.equal(refereeV6(s, 'human', pl([k(4, 4)])).verdict.final, 'illegal');
  assert.equal(refereeV6(m, 'ai', pl([k(E.W - 1 - 4, 4)])).verdict.final, 'illegal');
});

test('own-piece adjacency is allowed, and own effects propel own pieces (self-propulsion)', () => {
  const s = pos('human', { h1: [2, 4], a1: [12, 0] });
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) assert.ok(E.validatePlacement(s, 'human', pl([k(2 + dx, 4 + dy)])).ok, `${dx},${dy}`);
  const r = refereeV6(s, 'human', pl([k(3, 4)], makeEffect('shove', 'forward', 3)));
  assert.equal(r.verdict.activated, true, r.verdict.message);
  const ev = E.applyMove(s, 'human', { from: k(2, 4), dir: 'right', mode: 'stack' });
  assert.ok(ev.some(e => e.t === 'trigger' && e.self));
  assert.equal(s.pieces.find(q => q.id === 'h1')!.x, 6, 'one action moved the piece 4 columns');
});

test('existing effects stay live when an opponent piece walks up to them; own removal stays allowed', () => {
  const s = pos('ai', { a1: [9, 4], h1: [3, 4] });
  assert.ok(refereeV6(s, 'ai', pl([k(5, 4)], makeEffect('shove', 'west', 2))).verdict.activated);
  E.endTurn(s); s.actionsLeft = 3; // -> human
  E.applyMove(s, 'human', { from: k(3, 4), dir: 'right', mode: 'stack' }); // now adjacent to the AI effect at F5
  assert.equal(E.ruleAt(s, k(5, 4))?.owner, 'ai', 'effect not removed by proximity');
  E.applyMove(s, 'human', { from: k(4, 4), dir: 'right', mode: 'stack' });
  assert.equal(s.pieces.find(q => q.id === 'h1')!.x, 3, 'it still fires');
  // the AI may remove its own effect even when it is next to a human piece
  const t = pos('ai', { a1: [9, 4], h1: [4, 4] });
  t.cells[k(5, 4)] = 7; t.rules.push({ id: 7, owner: 'ai', text: 'x', effect: makeEffect('freeze'), label: 'Freeze', summary: '', icon: '', cells: [k(5, 4)], placed: 1, turn: 1, hits: { human: 0, ai: 0 }, interpretedBy: 't' });
  assert.ok(E.validatePlacement(t, 'ai', null, [k(5, 4)]).ok);
  E.applyPlacement(t, 'ai', null, [k(5, 4)]);
  assert.equal(E.ruleAt(t, k(5, 4)), null);
  // ...but may not re-use that own-effect cell for a NEW effect while it is next to a human piece
  const u = pos('ai', { a1: [9, 4], h1: [4, 4] });
  u.cells[k(5, 4)] = 7; u.rules.push(structuredClone(t.rules[0])); u.rules[0].cells = [k(5, 4)];
  assert.equal((E.validatePlacement(u, 'ai', pl([k(5, 4)])) as { code?: string }).code, 'near-opponent');
});

// ---------------------------------------------------------------- AI compatibility
test('AI candidates never include a protected square (all three policies use eligibleCells)', () => {
  const s = pos('ai', { a1: [7, 3], a2: [8, 5], a3: [12, 6], h1: [5, 3], h2: [6, 5], h3: [4, 4] });
  const prot = new Set(E.protectedCells(s, 'ai'));
  const cands = candidatePlacements(s, 'ai', W8).filter(Boolean);
  assert.ok(cands.length > 0);
  for (const c of cands) for (const cell of c!.cells) assert.ok(!prot.has(cell), `candidate on protected ${cell}`);
  const plan = planPolicy53('softmax-v2', s, 'ai', W8);
  for (const cell of plan.chosen.placement?.cells ?? []) assert.ok(!prot.has(cell));
});

test('AI turn when no new effect can be placed anywhere: it plays its moves with no placement attempt', async () => {
  const s = pos('ai', { a1: [10, 4], h1: [2, 4] });
  // every free square not next to the human piece holds a human effect, so the AI has no eligible cell
  const id = 50; s.rules.push({ id, owner: 'human', text: 'x', effect: makeEffect('shield'), label: 'Shield', summary: '', icon: '', cells: [], placed: 0, turn: 1, hits: { human: 0, ai: 0 }, interpretedBy: 't' });
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) { const c = k(x, y); if (E.cellBlock(s, 'ai', c) === null) { s.cells[c] = id; s.rules[0].cells.push(c); } }
  assert.equal(E.eligibleCells(s, 'ai').length, 0);
  const r = await aiTurnV6(s, 'ai', 'softmax-v2', W8);
  assert.equal(r.verdict, null, 'no placement proposed');
  assert.equal(r.eligibleCells, 0); assert.equal(r.error, null);
  assert.ok(r.moves.length > 0 || r.zeroMoves?.kind === 'unfavorable');
});

// ---------------------------------------------------------------- zero-move diagnosis
test('zero-move diagnosis: no legal move vs planner error vs unfavorable', async () => {
  const s = pos('ai', { a1: [8, 4], a2: [9, 6], h1: [2, 4] });
  for (const q of s.pieces) if (q.owner === 'ai') q.frozen = 1;
  const r = await aiTurnV6(s, 'ai', 'softmax-v2', W8);
  assert.equal(r.moves.length, 0); assert.equal(r.zeroMoves?.kind, 'no-legal-move'); assert.match(r.zeroMoves!.detail, /frozen/);
  const t = pos('ai', { a1: [8, 4], h1: [2, 4] });
  const bad = await aiTurnV6(t, 'ai', 'softmax-v2', W8, async () => { throw new Error('boom'); });
  assert.equal(bad.zeroMoves?.kind, 'planner-error'); assert.match(bad.error!, /boom/);
  const u = pos('ai', { a1: [8, 4], h1: [2, 4] }); u.phase = 'move';
  const d = diagnoseZeroMoves(u, 'ai', W8, null);
  assert.equal(d.kind, 'unfavorable'); assert.equal(typeof d.bestDelta, 'number'); assert.ok(d.legalMoves > 0);
});

// ---------------------------------------------------------------- replay
test('engine replay: recorded actions reproduce the same final state; AI turns are deterministic for a seed', async () => {
  const seed = 99961, first: Player = 'human';
  const s = E.init(seed, { first });
  const actions: { p: Player; pl: unknown; moves: unknown[] }[] = [];
  for (let i = 0; i < 6 && !s.winner; i++) {
    const p = s.current;
    const r = await aiTurnV6(s, p, 'softmax-v2', W8);
    const ev = r.events.find(e => e.t === 'place') as { ruleId: number; cells: string[] } | undefined;
    const placed = ev ? s.rules.find(x => x.id === ev.ruleId)! : null; // cells from the event: a rule's own list shrinks as cells burn
    actions.push({ p, pl: placed ? { text: placed.text, effect: placed.effect, cells: ev!.cells, interpretedBy: placed.interpretedBy } : null, moves: r.moves });
  }
  const t = E.init(seed, { first });
  for (const a of actions) {
    if (a.pl) E.applyPlacement(t, a.p, a.pl as never);
    for (const m of a.moves) E.applyMove(t, a.p, m as never);
    if (!t.winner) E.endTurn(t);
  }
  assert.deepEqual(t.pieces, s.pieces); assert.deepEqual(t.cells, s.cells); assert.equal(t.rng, s.rng); assert.equal(t.turn, s.turn);
  // same seed, same policy -> same decisions
  const a = E.init(seed, { first }), b = E.init(seed, { first });
  const ra = await aiTurnV6(a, 'human', 'oa-v3', W8), rb = await aiTurnV6(b, 'human', 'oa-v3', W8);
  assert.deepEqual(ra.moves, rb.moves); assert.deepEqual(a.pieces, b.pieces);
});

// ---------------------------------------------------------------- server-side enforcement
test('server: the place endpoint refuses an A1 violation with 422 and a reason; nothing is used up', async () => {
  process.env.V6_NO_LISTEN = '1';
  const realFetch = globalThis.fetch; // the V6 server disables fetch for its own process on import
  const { server } = await import('../server/v6/server.ts');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port, url = (p: string) => `http://127.0.0.1:${port}${p}`;
  const post = async (p: string, b: unknown) => { const r = await realFetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  try {
    const g = await post('/api/game', { opponent: 'v6-softmax-v2', first: 'human', seed: 99962 });
    assert.equal(g.status, 200); assert.equal(g.j.board.w, 13); assert.ok(g.j.blocked['11,4'] === 'near-opponent');
    const pv = await post(`/api/game/${g.j.gameId}/preview`, { text: 'Frozen for a turn' });
    const bad = await post(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['9,4', '11,4'] });
    assert.equal(bad.status, 422); assert.equal(bad.j.code, 'near-opponent'); assert.match(bad.j.reason, /next to the opponent piece on M5/);
    const ok = await post(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['9,4', '1,4'] });
    assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.verdicts[0].activated, true);
    const out = await post(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['13,4'] });
    assert.equal(out.status, 400, 'off-board cell refused by shape check');
    assert.equal(process.env.KANE_REFEREE, 'off');
  } finally { await new Promise(r => server.close(r)); (await import('../server/v6/session.ts')).stopPlanner(); }
});

// ---------------------------------------------------------------- isolation from the frozen game
test('frozen 7x7 game and V5.3 policies are untouched; forks are up to date and never reach server/engine.ts', () => {
  assert.equal(P.SIZE, 7, 'production engine is still 7x7');
  for (const f of generateForks()) {
    assert.equal(readFileSync(join(ROOT, f.path), 'utf8').replace(/\r\n/g, '\n'), f.content, `${f.path} is out of date: run npm run v6:fork`);
    assert.doesNotMatch(f.content, /server\/engine\.ts'|from '\.\.\/\.\.\/engine\.ts'|from '\.\/engine\.ts'/);
  }
  // no frozen/production file imports V6
  for (const src of Object.keys(FORKS).concat(['server/engine.ts', 'server/game.ts', 'server/server.ts', 'server/playtest/session.ts', 'server/playtest/server.ts']))
    assert.doesNotMatch(readFileSync(join(ROOT, src), 'utf8'), /v6\//, src);
  assert.ok(existsSync(join(ROOT, 'balance/v5_3/journal.ndjson')));
});

test('frozen V5.3 implementation hashes still match the preregistered journal', async () => {
  const { integrity } = await import('../server/playtest/opponents.ts');
  const i = integrity();
  assert.equal(i.matches, true, `mismatched: ${i.mismatched.join(', ')}`);
});

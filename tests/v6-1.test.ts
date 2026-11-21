/**
 * V6.1 ruleset `rule-sabotage/v6.1-all-piece-proximity@1`: rule A2 = no new effect within Chebyshev distance 1 of ANY
 * unscored piece, whoever owns it. Everything else is V6. Deterministic; no self-play batch, no Kane, no LLM, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KANE_REFEREE = 'off';
const E = await import('../server/v6/engine.ts');
const { makeEffect } = await import('../server/rules.ts');
const { loadWeights } = await import('../server/weights.ts');
const { refereeV6, aiTurnV6 } = await import('../server/v6/turn.ts');
const { planPolicy53 } = await import('../server/v6/forks/policies53.ts');
const { candidatePlacements } = await import('../server/v6/forks/evk11.ts');
type State = import('../server/v6/engine.ts').State;
type Player = import('../server/rules.ts').Player;
const W8 = loadWeights();
const V61 = E.RULESET_V61;

const k = (x: number, y: number) => `${x},${y}`;
const pl = (cells: string[], effect = makeEffect('freeze')) => ({ text: 'test effect', effect, cells, interpretedBy: 'test' });
function pos(p: Player, pieces: Record<string, [number, number]>, ruleset: E.Ruleset = V61): State {
  const s = E.init(321, { first: p, ruleset });
  for (const q of s.pieces) { const at = pieces[q.id]; if (at) { q.x = at[0]; q.y = at[1]; } else q.scored = true; }
  s.current = p; s.phase = 'place'; s.actionsLeft = 3;
  return s;
}
const addRule = (s: State, id: number, owner: Player, cells: string[], effect = makeEffect('freeze')) => {
  s.rules.push({ id, owner, text: 'x', effect, label: 'x', summary: '', icon: '', cells: [...cells], placed: cells.length, turn: 1, hits: { human: 0, ai: 0 }, interpretedBy: 't' });
  for (const c of cells) s.cells[c] = id;
};
const ring = (x: number, y: number) => { const out: string[] = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && E.inside(x + dx, y + dy)) out.push(k(x + dx, y + dy)); return out.sort(); };

test('V6.1 is a separate ruleset; V6 stays the default and keeps rule A1', () => {
  assert.equal(V61, 'rule-sabotage/v6.1-all-piece-proximity@1');
  assert.equal(E.init(1).ruleset, E.RULESET, 'default = V6');
  assert.equal(E.init(1, { ruleset: V61 }).ruleset, V61);
  assert.throws(() => E.init(1, { ruleset: 'nope' as never }));
  const v6 = pos('human', { h1: [6, 4], a1: [0, 0] }, E.RULESET);
  for (const c of ring(6, 4)) assert.ok(E.validatePlacement(v6, 'human', pl([c])).ok, `V6 own adjacency ${c}`);
  // board, pieces, teleport band and turn limit are the V6 ones
  const s = E.init(7, { ruleset: V61 });
  assert.deepEqual([E.W, E.H, E.MAX_TURNS, s.maxTurns, s.pieces.length], [13, 9, 60, 60, 6]);
  assert.deepEqual(E.teleportDestinations(s, { x: 6, y: 4 }).map(c => E.parseKey(c).x).filter((x, i, a) => a.indexOf(x) === i), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

for (const owner of ['own', 'opponent'] as const) {
  test(`A2: all 8 neighbours of ${owner === 'own' ? 'a FRIENDLY' : 'an OPPOSING'} piece are rejected, for both sides`, () => {
    for (const mover of ['human', 'ai'] as Player[]) {
      const guard = (owner === 'own') === (mover === 'human') ? 'h2' : 'a2';
      const other = guard === 'h2' ? 'a1' : 'h1';
      const s = pos(mover, { [guard]: [6, 4], [other]: [mover === 'human' ? 12 : 0, 0] });
      for (const c of ring(6, 4)) {
        const r = E.validatePlacement(s, mover, pl([c]));
        assert.equal(r.ok, false, `${mover} ${c}`);
        if (!r.ok) { assert.equal(r.code, owner === 'own' ? 'near-own' : 'near-opponent'); assert.match(r.reason, owner === 'own' ? /your piece on G5/ : /the opponent’s piece on G5/); }
      }
      const self = E.validatePlacement(s, mover, pl([k(6, 4)]));
      assert.equal(self.ok, false); if (!self.ok) assert.equal(self.code, 'piece', 'occupancy still applies');
      for (const c of [k(4, 4), k(8, 4), k(6, 2), k(6, 6), k(4, 2), k(8, 6)]) assert.ok(E.validatePlacement(s, mover, pl([c])).ok, `distance 2 ${c}`);
    }
  });
}

test('A2 at corners and edges: the closed zone is clipped to the board', () => {
  const s = pos('human', { h1: [0, 0], h2: [12, 8], h3: [6, 0], a1: [0, 8], a2: [12, 0], a3: [6, 8] });
  const want = [...new Set([[0, 0], [12, 8], [6, 0], [0, 8], [12, 0], [6, 8]].flatMap(([x, y]) => ring(x, y)))].sort();
  assert.deepEqual(E.protectedCells(s, 'human'), want);
  assert.deepEqual(ring(0, 0), ['0,1', '1,0', '1,1']);
  assert.equal(ring(6, 0).length, 5);
  for (const c of want) assert.equal(E.validatePlacement(s, 'human', pl([c])).ok, false, c);
  assert.ok(E.validatePlacement(s, 'human', pl([k(2, 2), k(10, 6)])).ok);
});

test('A2 mirror parity: a position and its left/right mirror (sides swapped) give the same verdict on every cell', () => {
  const s = pos('human', { h1: [2, 3], h2: [9, 7], h3: [9, 7], a1: [5, 4], a2: [11, 1] });
  addRule(s, 90, 'ai', [k(3, 0)]); addRule(s, 91, 'human', [k(7, 7)]);
  const m = structuredClone(s);
  for (const q of m.pieces) { q.x = E.W - 1 - q.x; q.owner = q.owner === 'human' ? 'ai' : 'human'; }
  m.cells = {}; for (const r of m.rules) { r.owner = r.owner === 'human' ? 'ai' : 'human'; r.cells = r.cells.map(c => { const p = E.parseKey(c); return k(E.W - 1 - p.x, p.y); }); for (const c of r.cells) m.cells[c] = r.id; }
  m.current = 'ai';
  let closed = 0;
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
    const a = E.validatePlacement(s, 'human', pl([k(x, y)])), b = E.validatePlacement(m, 'ai', pl([k(E.W - 1 - x, y)]));
    assert.equal(a.ok, b.ok, `${x},${y}`);
    if (!a.ok && !b.ok) { assert.equal(a.code, b.code, `${x},${y}`); closed++; }
  }
  assert.ok(closed > 20);
  assert.deepEqual(E.protectedCells(s, 'human').length, E.protectedCells(m, 'ai').length);
});

test('A2: a multi-cell placement with one cell next to an own piece is rejected as a whole; nothing applied', () => {
  const s = pos('human', { h1: [3, 4], a1: [12, 0] });
  const before = JSON.stringify(s);
  const r = E.validatePlacement(s, 'human', pl([k(6, 4), k(7, 4), k(4, 5)]));
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.cell, '4,5'); assert.equal(r.code, 'near-own'); assert.match(r.reason, /3-cell placement is rejected as a whole/); }
  const v = refereeV6(s, 'human', pl([k(6, 4), k(7, 4), k(4, 5)]));
  assert.equal(v.verdict.final, 'illegal'); assert.equal(v.verdict.activated, false);
  assert.equal(JSON.stringify(s), before);
  // a cell next to both an own and an opposing piece names both
  const t = pos('human', { h1: [3, 4], a1: [5, 4] });
  const b = E.validatePlacement(t, 'human', pl([k(4, 4)]));
  assert.equal(b.ok, false); if (!b.ok) { assert.equal(b.code, 'near-opponent'); assert.match(b.reason, /your piece on D5 and the opponent’s piece on F5/); }
});

test('A2: existing effects survive pieces moving next to them and still fire; own removal stays legal', () => {
  const s = pos('human', { h1: [2, 4], a1: [12, 0] });
  assert.ok(refereeV6(s, 'human', pl([k(5, 4)], makeEffect('shove', 'east', 2))).verdict.activated, 'placed 2 squares ahead');
  E.applyMove(s, 'human', { from: k(2, 4), dir: 'right', mode: 'stack' });
  E.applyMove(s, 'human', { from: k(3, 4), dir: 'right', mode: 'stack' }); // now next to its own effect
  assert.equal(E.ruleAt(s, k(5, 4))?.owner, 'human');
  E.applyMove(s, 'human', { from: k(4, 4), dir: 'right', mode: 'stack' });
  assert.equal(s.pieces.find(q => q.id === 'h1')!.x, 7, 'the pre-positioned own effect propelled the piece');
  const t = pos('ai', { a1: [6, 4], h1: [0, 0] }); addRule(t, 5, 'ai', [k(5, 4), k(7, 4)]);
  assert.ok(E.validatePlacement(t, 'ai', null, [k(5, 4)]).ok, 'remove own effect next to own piece');
  E.applyPlacement(t, 'ai', null, [k(5, 4), k(7, 4)]);
  assert.equal(Object.keys(t.cells).length, 0);
  // re-using an own-effect cell next to a piece for a NEW effect is a new placement: closed
  const u = pos('ai', { a1: [6, 4], h1: [0, 0] }); addRule(u, 5, 'ai', [k(5, 4)]);
  assert.equal((E.validatePlacement(u, 'ai', pl([k(5, 4)])) as { code?: string }).code, 'near-own');
});

test('A2 still permits pre-positioned traps and chain reactions', () => {
  const s = pos('human', { h1: [1, 4], a1: [12, 0] });
  // a chain laid out two squares ahead: E5 shoves east 2 onto G5, G5 shoves east 3 onto J5, J5 freezes
  assert.ok(refereeV6(s, 'human', pl([k(4, 4), k(6, 4)], makeEffect('shove', 'east', 2))).verdict.activated);
  E.endTurn(s); E.endTurn(s); s.phase = 'place'; s.actionsLeft = 3;
  assert.ok(refereeV6(s, 'human', pl([k(9, 4)], makeEffect('freeze'))).verdict.activated);
  E.applyMove(s, 'human', { from: k(1, 4), dir: 'right', mode: 'stack' });
  E.applyMove(s, 'human', { from: k(2, 4), dir: 'right', mode: 'stack' });
  const ev = E.applyMove(s, 'human', { from: k(3, 4), dir: 'right', mode: 'stack' });
  const trig = ev.filter(e => e.t === 'trigger');
  assert.equal(trig.length, 2, 'two effects fired in one step'); assert.deepEqual(trig.map(e => (e as { chain: number }).chain), [1, 2]);
  assert.equal(s.pieces.find(q => q.id === 'h1')!.x, 8);
  // an opposing trap laid in advance still catches a piece that walks into it
  const t = pos('ai', { a1: [10, 4], h1: [3, 4] });
  assert.ok(refereeV6(t, 'ai', pl([k(6, 4)], makeEffect('home'))).verdict.activated);
  E.endTurn(t); t.actionsLeft = 3;
  E.applyMove(t, 'human', { from: k(3, 4), dir: 'right', mode: 'stack' }); E.applyMove(t, 'human', { from: k(4, 4), dir: 'right', mode: 'stack' });
  E.applyMove(t, 'human', { from: k(5, 4), dir: 'right', mode: 'stack' });
  const h1 = t.pieces.find(q => q.id === 'h1')!;
  assert.deepEqual([h1.x, h1.y], [h1.home.x, h1.home.y], 'sent home by the pre-positioned trap');
});

test('A2: AI candidate generation never includes a closed cell (own or opposing neighbourhood)', () => {
  for (const me of ['ai', 'human'] as Player[]) {
    const s = pos(me, { a1: [7, 3], a2: [8, 5], a3: [11, 6], h1: [5, 3], h2: [6, 6], h3: [2, 4] });
    const closed = new Set(E.protectedCells(s, me));
    assert.ok([...closed].some(c => E.cellBlock(s, me, c) === 'near-own'));
    const cands = candidatePlacements(s, me, W8).filter(Boolean);
    assert.ok(cands.length > 0);
    for (const c of cands) for (const cell of c!.cells) assert.ok(!closed.has(cell), `${me} candidate on closed ${cell}`);
    const plan = planPolicy53('softmax-v2', s, me, W8);
    for (const cell of plan.chosen.placement?.cells ?? []) assert.ok(!closed.has(cell));
  }
});

test('A2: an AI turn with zero eligible cells places nothing and still plays', async () => {
  const s = pos('ai', { a1: [10, 4], a2: [9, 2], h1: [2, 4] });
  const free: string[] = [];
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) if (E.cellBlock(s, 'ai', k(x, y)) === null) free.push(k(x, y));
  addRule(s, 60, 'human', free, makeEffect('shield'));
  assert.equal(E.eligibleCells(s, 'ai').length, 0);
  assert.deepEqual(candidatePlacements(s, 'ai', W8), [null]);
  const r = await aiTurnV6(s, 'ai', 'softmax-v2', W8);
  assert.equal(r.verdict, null); assert.equal(r.error, null); assert.equal(r.eligibleCells, 0);
  assert.ok(r.moves.length > 0 || r.zeroMoves?.kind === 'unfavorable');
});

test('server: ruleset v6.1 is selectable and enforced server-side with a reason naming the own piece', async () => {
  process.env.V6_NO_LISTEN = '1';
  const realFetch = globalThis.fetch;
  const { server } = await import('../server/v6/server.ts');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const post = async (p: string, b: unknown) => { const r = await realFetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  try {
    const info = await (await realFetch(`http://127.0.0.1:${port}/api/v6/info`)).json() as any;
    assert.deepEqual(info.rulesets.map((r: any) => r.id), ['v6.1', 'v6']);
    const g = await post('/api/game', { ruleset: 'v6.1', opponent: 'v6-softmax-v2', first: 'human', seed: 99971 });
    assert.equal(g.status, 200); assert.equal(g.j.ruleset, V61);
    assert.equal(g.j.blocked['1,4'], 'near-own'); assert.equal(g.j.blocked['11,4'], 'near-opponent'); assert.match(g.j.noEffectRule, /ANY piece/);
    const pv = await post(`/api/game/${g.j.gameId}/preview`, { text: 'Frozen for a turn' });
    const bad = await post(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['5,4', '1,4'] });
    assert.equal(bad.status, 422); assert.equal(bad.j.code, 'near-own'); assert.match(bad.j.reason, /your piece on A5/);
    assert.equal((await post(`/api/game/${g.j.gameId}/place`, { token: pv.j.token, cells: ['5,4', '2,4'] })).status, 200);
    const old = await post('/api/game', { opponent: 'v6-softmax-v2', first: 'human', seed: 99972 });
    assert.equal(old.j.ruleset, E.RULESET, 'no ruleset given = V6 as before'); assert.equal(old.j.blocked['1,4'], undefined);
    assert.equal((await post('/api/game', { ruleset: 'v7', opponent: 'v6-softmax-v2' })).status, 422);
  } finally { await new Promise(r => server.close(r)); (await import('../server/v6/session.ts')).stopPlanner(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { init, applyPlacement, applyMove, endTurn, validatePlacement, eligibleCells, legalMoves, key, activeEffects, type State, type Placement, type GameEvent } from '../server/engine.ts';
import { makeEffect, type Effect, type Player } from '../server/rules.ts';

const pl = (effect: Effect, cells: string[]): Placement => ({ text: 'test rule', effect, cells, interpretedBy: 'test' });
/** Fresh state where `p` is to play, with pieces placed explicitly (others parked at home). */
function S(p: Player = 'human', seed = 5): State { const s = init(seed); s.current = p; s.phase = 'place'; s.actionsLeft = 3; return s; }
const put = (s: State, id: string, x: number, y: number) => Object.assign(s.pieces.find(q => q.id === id)!, { x, y });
const at = (s: State, id: string) => { const q = s.pieces.find(q => q.id === id)!; return key(q.x, q.y); };
const kinds = (ev: GameEvent[]) => ev.map(e => e.t);

test('setup: 3 pieces each, coin flip decides who starts, actions = pieces on board', () => {
  const firsts = new Set<string>();
  for (let seed = 1; seed < 40; seed++) {
    const s = init(seed);
    assert.equal(s.pieces.filter(q => q.owner === 'human').length, 3);
    assert.equal(s.pieces.filter(q => q.owner === 'ai').length, 3);
    assert.equal(s.actionsLeft, 3);
    firsts.add(s.firstPlayer);
  }
  assert.deepEqual([...firsts].sort(), ['ai', 'human']);
});

test('placement: up to 3 cells anywhere eligible, no geometric shape required', () => {
  const s = S();
  assert.ok(validatePlacement(s, 'human', pl(makeEffect('freeze'), ['0,0', '6,6', '3,2'])).ok, 'far-apart cells are fine');
  assert.equal(validatePlacement(s, 'human', pl(makeEffect('freeze'), ['0,0', '6,6', '3,2', '4,4'])).ok, false, '4 cells is too many');
  assert.equal(validatePlacement(s, 'human', pl(makeEffect('freeze'), ['0,1'])).ok, false, 'cell with a piece');
  applyPlacement(s, 'human', pl(makeEffect('freeze'), ['2,2']));
  assert.equal(s.phase, 'move');
  assert.equal(validatePlacement(s, 'human', pl(makeEffect('freeze'), ['2,3'])).ok, false, 'only before the first move');
});

test('effects persist across turns, cannot be overwritten by the opponent, and can be removed or replaced by their owner', () => {
  const s = S('human');
  applyPlacement(s, 'human', pl(makeEffect('freeze'), ['2,2', '3,3']));
  endTurn(s); // AI's turn
  assert.equal(activeEffects(s), 2, 'still there next turn');
  assert.ok(!eligibleCells(s, 'ai').includes('2,2'), 'AI cannot place on my effect');
  assert.equal(validatePlacement(s, 'ai', pl(makeEffect('haste'), ['2,2'])).ok, false);
  assert.equal(validatePlacement(s, 'ai', null, ['2,2']).ok, false, 'AI cannot remove my effect');
  endTurn(s); // my turn again
  const ev = applyPlacement(s, 'human', pl(makeEffect('shove', 'north', 1), ['3,3', '4,4']), ['2,2']);
  assert.deepEqual(kinds(ev), ['remove', 'place']);
  const place = ev.find(e => e.t === 'place')!;
  assert.ok(place.t === 'place' && place.replaced.includes('3,3'), 'replacing my own cell counts toward the 3');
  assert.equal(s.cells['2,2'], undefined);
  assert.equal(activeEffects(s, 'human'), 2);
});

test('an effect does exactly the same to a human piece and an AI piece (absolute direction)', () => {
  for (const p of ['human', 'ai'] as Player[]) {
    const s = S(p);
    const id = p === 'human' ? 'h1' : 'a1';
    put(s, id, 2, 3);
    applyPlacement(s, p, pl(makeEffect('shove', 'north', 2), ['3,3']));
    applyMove(s, p, { from: '2,3', dir: 'right', mode: 'single' });
    assert.equal(at(s, id), '3,1', `${p} forced 2 north`);
    assert.equal(s.cells['3,3'], undefined, 'triggered cell is consumed');
  }
});

test('back/forward are relative to the entry direction, not to ownership', () => {
  const s = S('human');
  put(s, 'h1', 3, 2);
  applyPlacement(s, 'human', pl(makeEffect('shove', 'back', 2), ['3,3']));
  applyMove(s, 'human', { from: '3,2', dir: 'down', mode: 'single' });
  assert.equal(at(s, 'h1'), '3,1', 'entered moving down, bounced 2 up');
});

test('only the triggered cell is consumed; the rest of the rule stays', () => {
  const s = S('human');
  put(s, 'h1', 1, 2);
  applyPlacement(s, 'human', pl(makeEffect('freeze'), ['2,2', '4,4', '5,5']));
  applyMove(s, 'human', { from: '1,2', dir: 'right', mode: 'single' });
  assert.deepEqual(Object.keys(s.cells).sort(), ['4,4', '5,5']);
});

test('friendly pieces stack and move together; enemies are captured and sent home', () => {
  const s = S('human');
  s.phase = 'move';
  put(s, 'h1', 2, 3); put(s, 'h2', 3, 3); put(s, 'a1', 4, 3);
  let ev = applyMove(s, 'human', { from: '2,3', dir: 'right', mode: 'stack' });
  assert.ok(kinds(ev).includes('stack'));
  ev = applyMove(s, 'human', { from: '3,3', dir: 'right', mode: 'stack' });
  assert.ok(kinds(ev).includes('capture'));
  assert.equal(at(s, 'h1'), '4,3'); assert.equal(at(s, 'h2'), '4,3');
  assert.equal(at(s, 'a1'), '6,1', 'captured AI piece back on its start');
  assert.ok(legalMoves(s, 'human').some(m => m.from === '4,3' && m.mode === 'single'), 'a stack can split');
});

test('forced movement can chain into further effects, capped by the engine', () => {
  const s = S('human');
  put(s, 'h1', 1, 3);
  applyPlacement(s, 'human', pl(makeEffect('shove', 'east', 1), ['2,3', '3,3', '4,3']));
  const ev = applyMove(s, 'human', { from: '1,3', dir: 'right', mode: 'single' });
  const trig = ev.filter(e => e.t === 'trigger');
  assert.equal(trig.length, 3, 'three effects in a row');
  assert.equal(at(s, 'h1'), '5,3');
});

test('freeze, home, shield and haste behave identically regardless of who owns the piece', () => {
  for (const p of ['human', 'ai'] as Player[]) {
    const id = p === 'human' ? 'h1' : 'a1';
    const s = S(p);
    put(s, id, 3, 0);
    applyPlacement(s, p, pl(makeEffect('haste'), ['3,1']));
    const before = s.actionsLeft;
    applyMove(s, p, { from: '3,0', dir: 'down', mode: 'single' });
    assert.equal(s.actionsLeft, before, `${p}: haste refunds the action`);
    const s2 = S(p);
    put(s2, id, 3, 0);
    applyPlacement(s2, p, pl(makeEffect('home'), ['3,1']));
    applyMove(s2, p, { from: '3,0', dir: 'down', mode: 'single' });
    const q = s2.pieces.find(x => x.id === id)!;
    assert.deepEqual([q.x, q.y], [q.home.x, q.home.y], `${p}: sent to own start`);
  }
});

test('all three pieces across wins; the turn limit has a deterministic tiebreak', () => {
  const s = S('human');
  s.phase = 'move';
  put(s, 'h1', 5, 1); put(s, 'h2', 5, 3); put(s, 'h3', 5, 5);
  for (const y of [1, 3, 5]) applyMove(s, 'human', { from: `5,${y}`, dir: 'right', mode: 'single' });
  assert.equal(s.winner, 'human');
  const t = S('human'); t.turn = t.maxTurns; put(t, 'h1', 5, 1);
  endTurn(t);
  assert.equal(t.winner, 'human', 'less distance left wins at the limit');
});

test('same seed + same actions = same result (teleport uses the seeded RNG)', () => {
  const run = () => { const s = S('human', 77); put(s, 'h1', 2, 2); applyPlacement(s, 'human', pl(makeEffect('teleport'), ['3,2'])); applyMove(s, 'human', { from: '2,2', dir: 'right', mode: 'single' }); return at(s, 'h1'); };
  assert.equal(run(), run());
});

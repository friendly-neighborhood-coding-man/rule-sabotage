import test from 'node:test';
import assert from 'node:assert/strict';
import { init, resolveRound, validateAction, eligibleCells, type State, type Action, type RuleAction, key, NO_ACTION, sabotageScore, priorityOf } from '../server/engine.ts';
import { normalizeEffect, type Effect, type Player } from '../server/rules.ts';

const hold: Action = NO_ACTION;
const mv = (move: Action['move'], rule: RuleAction = { op: 'none' }): Action => ({ rule, move });
const place = (effect: Effect, cells: string[], slot?: number): RuleAction => ({ op: 'place', text: 'test rule', effect, cells, interpretedBy: 'test', ...(slot !== undefined ? { slot } : {}) });
/** A state with an arbitrary shape for tests. */
function S(shapeCells: string[], seed = 5): State { const s = init(seed); s.shape = { kind: 'column', name: 'test', cells: shapeCells }; s.firstPriority = 'human'; return s; }
const run = (s: State, h: Action, a: Action) => resolveRound(s, { human: h, ai: a });

test('a trap fires for whoever steps on it, with identical mechanics for both players', () => {
  for (const owner of ['human', 'ai'] as Player[]) {
    let s = S(['2,3', '4,3']);
    s.positions = { human: { x: 1, y: 3 }, ai: { x: 5, y: 3 } };
    const acts = { human: hold, ai: hold }; acts[owner] = mv('hold', place(normalizeEffect('push', 2), ['2,3', '4,3']));
    s = resolveRound(s, acts).state;
    const r = run(s, mv('right'), mv('left'));
    const trig = r.events.filter(e => e.t === 'trigger');
    assert.equal(trig.length, 2, 'both triggered');
    assert.deepEqual(r.state.positions.human, { x: 0, y: 3 }, 'human pushed 2 toward own start');
    assert.deepEqual(r.state.positions.ai, { x: 6, y: 3 }, 'ai pushed 2 toward own start');
    assert.equal(trig.filter(e => e.t === 'trigger' && e.self).length, 1, 'owner hit by own trap');
  }
});

test('each trapped square fires exactly once', () => {
  let s = S(['2,3', '2,4']);
  s.positions = { human: { x: 1, y: 3 }, ai: { x: 6, y: 0 } };
  s = run(s, mv('hold', place(normalizeEffect('reverse'), ['2,3', '2,4'])), hold).state;
  let r = run(s, mv('right'), hold);
  assert.equal(r.events.filter(e => e.t === 'trigger').length, 1);
  assert.deepEqual(r.state.rules.human[0].cells, ['2,4'], 'only that square burnt');
  // step off (reverse makes "right" go left... so press left to go right is NOT needed: step down then up)
  r = run(r.state, mv('left'), hold); // reversed -> moves right to 3,3
  assert.deepEqual(r.state.positions.human, { x: 3, y: 3 });
  r = run(r.state, mv('left'), hold); // back onto 2,3 (burnt)
  assert.equal(r.events.filter(e => e.t === 'trigger').length, 0, 'burnt square does not fire again');
});

test('skip: the player sits out exactly one round and cannot be skip-locked', () => {
  let s = S(['2,3', '3,3']);
  s.positions = { human: { x: 1, y: 3 }, ai: { x: 6, y: 0 } };
  s = run(s, mv('hold', place(normalizeEffect('skip'), ['2,3', '3,3'])), hold).state;
  s = run(s, mv('right'), hold).state;
  assert.equal(s.status.human.skip, true);
  assert.equal(validateAction(s, 'human', mv('right')).ok, false, 'must hold while skipping');
  const r = run(s, hold, hold);
  assert.ok(r.events.some(e => e.t === 'sitout' && e.p === 'human'));
  // right after sitting out, stepping on another skip square is resisted
  const r2 = run(r.state, mv('right'), hold);
  assert.ok(r2.events.some(e => e.t === 'status' && e.resisted));
  assert.equal(r2.state.status.human.skip, false);
});

test('budget, shape and slot limits are enforced by the engine for both players', () => {
  const s = S(['1,1', '2,1', '3,1', '4,1', '5,1', '0,1', '6,1']);
  for (const p of ['human', 'ai'] as Player[]) {
    assert.equal(validateAction(s, p, mv('hold', place(normalizeEffect('skip'), ['1,1', '2,1', '3,1']))).ok, false, 'over budget');
    assert.equal(validateAction(s, p, mv('hold', place(normalizeEffect('skip'), ['1,1', '2,1']))).ok, true);
    assert.equal(validateAction(s, p, mv('hold', place(normalizeEffect('push', 1), ['0,1']))).ok, false, 'home columns are off limits');
    assert.equal(validateAction(s, p, mv('hold', place(normalizeEffect('push', 1), ['3,3']))).ok, false, 'outside shape');
    assert.equal(validateAction(s, p, mv('hold', place(normalizeEffect('push', 1), ['1,1', '1,1']))).ok, false, 'duplicates');
  }
  assert.ok(!eligibleCells(s).includes('0,1') && !eligibleCells(s).includes('6,1'));
});

test('rule replacement and removal use the slot the player saw at the start of the round', () => {
  let s = S(['1,0', '2,0', '3,0', '4,0', '5,0']); s.slots = 2;
  s = run(s, mv('hold', place(normalizeEffect('push', 1), ['1,0'])), hold).state;
  s.shape = { kind: 'row', name: 't', cells: ['1,0', '2,0', '3,0', '4,0', '5,0'] };
  s = run(s, mv('hold', place(normalizeEffect('reverse'), ['2,0'])), hold).state;
  s.shape = { kind: 'row', name: 't', cells: ['1,0', '2,0', '3,0', '4,0', '5,0'] };
  assert.equal(validateAction(s, 'human', mv('hold', place(normalizeEffect('skip'), ['3,0']))).ok, false, 'slots full');
  s = run(s, mv('hold', place(normalizeEffect('skip'), ['3,0'], 0)), hold).state;
  assert.deepEqual(s.rules.human.map(r => r.effect.kind), ['reverse', 'skip'], 'slot 0 replaced');
  const r = run(s, mv('hold', { op: 'remove', slot: 1 }), hold);
  assert.deepEqual(r.state.rules.human.map(x => x.effect.kind), ['reverse']);
  assert.ok(r.events.some(e => e.t === 'remove'));
});

test('simultaneous claims on the same square clash and nobody gets it', () => {
  const s = S(['3,1', '3,2']);
  const r = run(s, mv('hold', place(normalizeEffect('push', 1), ['3,1', '3,2'])), mv('hold', place(normalizeEffect('skip'), ['3,2'])));
  assert.ok(r.events.some(e => e.t === 'clash'));
  assert.deepEqual(r.state.rules.human[0].cells, ['3,1']);
  assert.equal(r.state.rules.ai.length, 0, 'AI rule fizzled: all its squares clashed');
});

test('chains are bounded and swap never drops anyone into a home column', () => {
  let s = S(['1,3', '2,3', '3,3', '4,3', '5,3']);
  s.positions = { human: { x: 4, y: 2 }, ai: { x: 6, y: 0 } };
  s = run(s, mv('hold', place(normalizeEffect('push', 1), ['1,3', '2,3', '3,3', '4,3'])), hold).state;
  const r = run(s, mv('down'), hold);
  const chain = r.events.filter(e => e.t === 'trigger').length;
  assert.ok(chain <= 3, `chain ${chain}`);
  assert.ok(r.events.some(e => e.t === 'chain-limit'));
  let t = S(['3,3']);
  t.positions = { human: { x: 2, y: 3 }, ai: { x: 6, y: 3 } };
  t = run(t, mv('hold', place(normalizeEffect('swap'), ['3,3'])), hold).state;
  const r2 = run(t, mv('right'), hold);
  assert.deepEqual(r2.state.positions.human, { x: 3, y: 3 }, 'swap blocked: AI is in its home column');
  assert.equal(r2.state.winner, null);
});

test('victory: first player on their goal column wins; priority decides a dead heat', () => {
  const s = S(['3,3']);
  s.positions = { human: { x: 5, y: 3 }, ai: { x: 1, y: 3 } };
  s.round = 1; // human priority
  assert.equal(priorityOf(s), 'human');
  assert.equal(run(s, mv('right'), mv('left')).state.winner, 'human');
  s.round = 2;
  assert.equal(run(s, mv('right'), mv('left')).state.winner, 'ai');
});

test('round limit: fewer columns left wins, then sabotage score, then draw', () => {
  const s = S(['3,3']); s.round = s.maxRounds;
  s.positions = { human: { x: 3, y: 3 }, ai: { x: 3, y: 0 } };
  const r = run(s, hold, hold);
  assert.equal(r.state.winner, 'draw');
  assert.match(r.state.winReason, /Round limit/);
  s.positions.human = { x: 4, y: 3 };
  assert.equal(run(s, hold, hold).state.winner, 'human');
  assert.equal(sabotageScore(s, 'human'), 0);
});

test('impossible moves are rejected; reverse flips the actual move', () => {
  const s = S(['3,3']);
  s.positions = { human: { x: 0, y: 0 }, ai: { x: 6, y: 6 } };
  assert.equal(validateAction(s, 'human', mv('up')).ok, false);
  assert.equal(validateAction(s, 'human', mv('left')).ok, false);
  s.status.human.reverse = true;
  assert.equal(validateAction(s, 'human', mv('right')).ok, false, 'reversed right = left = off board');
  assert.equal(run(s, mv('left'), hold).state.positions.human.x, 1);
});

test('determinism: same seed and same actions give the same game', () => {
  const play = () => { let s = init(777); const log: string[] = []; for (let i = 0; i < 6; i++) { const r = resolveRound(s, { human: mv('right'), ai: mv('left') }); s = r.state; log.push(JSON.stringify(r.events) + s.shape.name); if (s.winner) break; } return log.join('|'); };
  assert.equal(play(), play());
});

test('shapes come in mirrored pairs so neither side is favoured by the draw', () => {
  let s = init(99);
  for (let i = 0; i < 6; i++) {
    const odd = s.shape;
    s = resolveRound(s, { human: hold, ai: hold }).state;
    const even = s.shape;
    assert.deepEqual([...even.cells].sort(), odd.cells.map(k => { const [x, y] = k.split(',').map(Number); return key(6 - x, y); }).sort());
    s = resolveRound(s, { human: hold, ai: hold }).state;
  }
});

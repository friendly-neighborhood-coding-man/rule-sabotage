/**
 * Closed-loop regression tests for the Kane findings in KANE_FINDINGS.ndjson (and one extra defect found while
 * checking them). Each test runs the real server/v6 engine and referee; the scripted cases reuse the GameWatch
 * scripts and adapter unchanged, so they show the same behaviour as the evidence bundle.
 *
 *   node --experimental-strip-types --test tests/closed-loop.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KANE_REFEREE = 'off';
const engine = await import('../server/v6/engine.ts');
const turn = await import('../server/v6/turn.ts');
const selfplay = await import('../server/v6/selfplay.ts');
const { makeEffect } = await import('../server/rules.ts');
const { runScript } = await import('../gamewatch/adapters/rule-sabotage.ts');
const { SCRIPTS } = await import('../gamewatch/scenarios.ts');
type State = import('../server/v6/engine.ts').State;
type Player = import('../server/rules.ts').Player;

const B = { engine, turn, selfplay, dir: 'server/v6' } as Parameters<typeof runScript>[0];
const V61 = engine.RULESET_V61;
const k = (x: number, y: number) => `${x},${y}`;
const script = (id: string) => { const s = SCRIPTS.find(x => x.id === id); assert.ok(s, `script ${id}`); return s!; };
const addRule = (s: State, id: number, owner: Player, cells: string[], effect: ReturnType<typeof makeEffect>) => {
  s.rules.push({ id, owner, text: 'x', effect, label: 'x', summary: '', icon: '', cells: [...cells], placed: cells.length, turn: 1, hits: { human: 0, ai: 0 }, interpretedBy: 't' });
  for (const c of cells) s.cells[c] = id;
  s.nextId = Math.max(s.nextId, id + 1);
};

// ---------- Finding 3 (R3): one move action per own piece on the board, nothing else ----------
test('R3: every turn starts with exactly one action per own piece on the board (no parity bonus)', () => {
  for (const first of ['human', 'ai'] as Player[]) {
    const s = engine.init(97100, { first, ruleset: V61 });
    for (let t = 1; t <= 8; t++) {
      assert.equal(s.actionsLeft, engine.onBoard(s, s.current).length, `turn ${s.turn} (${s.current}, ${first} first)`);
      engine.endTurn(s);
    }
  }
});

test('R3: scripted shove-chain-ai case grants Human 3 actions on turns 1, 3 (was 4)', async () => {
  const c = await runScript(B, script('shove-chain-ai'), 'T-R3', 'test');
  const starts = c.steps.flatMap(st => st.events).filter(e => e.type === 'turn-start') as { side: string; actionsGranted: number; turn: number }[];
  for (const e of starts) assert.equal(e.actionsGranted, 3, `turn ${e.turn} ${e.side}`);
});

// ---------- Finding 2 (R8): a cell is used up on arrival, also when the piece was moved there by an effect ----------
test('R8: an effect cell reached by a shove is used up and cannot fire again', () => {
  const s = engine.init(1, { first: 'ai', ruleset: V61 });
  s.phase = 'move';
  addRule(s, 50, 'ai', [k(10, 4)], makeEffect('shove', 'west', 2));
  addRule(s, 51, 'ai', [k(8, 4)], makeEffect('haste'));
  const a = s.pieces.find(q => q.id === 'a2')!; a.x = 11; a.y = 4;
  const before = s.actionsLeft;
  const ev = engine.applyMove(s, 'ai', { from: k(11, 4), dir: 'left', mode: 'stack' });
  assert.deepEqual([a.x, a.y], [8, 4]);
  assert.equal(ev.filter(e => e.t === 'trigger').length, 2);
  assert.equal(s.cells[k(8, 4)], undefined, 'I5 is used up after the forced arrival');
  assert.equal(s.cells[k(10, 4)], undefined, 'K5 is used up after the walk-in');
  assert.equal(s.actionsLeft, before - 1 + 1);
  engine.applyMove(s, 'ai', { from: k(8, 4), dir: 'left', mode: 'stack' });
  const ev2 = engine.applyMove(s, 'ai', { from: k(7, 4), dir: 'right', mode: 'stack' });
  assert.equal(ev2.filter(e => e.t === 'trigger').length, 0, 're-entry does not fire');
});

test('R8: scripted shove-chain-ai case: I5 fires once, then the 5th move is refused', async () => {
  const c = await runScript(B, script('shove-chain-ai'), 'T-R8', 'test');
  const fired = c.steps.flatMap(st => st.events).filter(e => e.type === 'effect-fired' && (e as { square: string }).square === 'I5');
  assert.equal(fired.length, 1);
  const first = c.steps.find(st => st.events.some(e => e.type === 'effect-fired' && (e as { square: string }).square === 'I5'))!;
  assert.ok(!first.after.effects.some(e => e.square === 'I5'), 'I5 gone right after it fired');
  const last = c.steps.filter(st => st.actor === 'AI' && st.action === 'move I5 left').at(-1)!;
  assert.equal(last.outcome, 'refused');
});

test('R8: scripted shove-chain-human case: E5 fires once', async () => {
  const c = await runScript(B, script('shove-chain-human'), 'T-R8h', 'test');
  const fired = c.steps.flatMap(st => st.events).filter(e => e.type === 'effect-fired' && (e as { square: string }).square === 'E5');
  assert.equal(fired.length, 1);
});

// ---------- Extra defect (R14/R7), not reported by Kane: a Human piece's shield did nothing ----------
test('R14/R7: a shield protects a Human piece exactly as it protects an AI piece', () => {
  for (const p of ['human', 'ai'] as Player[]) {
    const s = engine.init(2, { first: p, ruleset: V61 });
    s.phase = 'move';
    const q = s.pieces.find(x => x.owner === p && x.y === 2)!;
    const x0 = p === 'human' ? 4 : 8, dx = p === 'human' ? 1 : -1;
    q.x = x0; q.y = 2; q.shield = true;
    addRule(s, 60, other(p), [k(x0 + dx, 2)], makeEffect('home'));
    const ev = engine.applyMove(s, p, { from: k(x0, 2), dir: p === 'human' ? 'right' : 'left', mode: 'stack' });
    assert.ok(ev.some(e => e.t === 'shielded'), `${p}: shield absorbed`);
    assert.ok(!ev.some(e => e.t === 'trigger'), `${p}: effect not applied`);
    assert.deepEqual([q.x, q.y], [x0 + dx, 2], `${p}: not sent home`);
    assert.equal(q.shield, false, `${p}: shield used up`);
    assert.equal(s.cells[k(x0 + dx, 2)], undefined, `${p}: cell used up`);
  }
});

test('R14: scripted shield-human case: the shielded Human piece is not sent home by E3', async () => {
  const c = await runScript(B, script('shield-human'), 'T-R14', 'test');
  const ev = c.steps.flatMap(st => st.events);
  assert.ok(ev.some(e => e.type === 'shield-absorbed' && (e as { square: string }).square === 'E3'));
  assert.ok(!ev.some(e => e.type === 'effect-fired' && (e as { square: string }).square === 'E3'));
});

const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');

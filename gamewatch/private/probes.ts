/** PRIVATE: independent probes for the planted defects (used by groundtruth.test.ts and score.ts). */
import type { Effect, Player } from '../../server/rules.ts';
import type { loadBuild } from '../builds.ts';
export type B = Awaited<ReturnType<typeof loadBuild>>;
type S = import('../../server/v6/engine.ts').State;

function addEffect(b: B, s: S, owner: Player, effect: Effect, x: number, y: number) {
  const id = s.nextId++, k = b.engine.key(x, y);
  s.rules.push({ id, owner, text: 'probe', effect, label: '', summary: '', icon: '', cells: [k], placed: 1, turn: s.turn, hits: { human: 0, ai: 0 }, interpretedBy: 'probe' });
  s.cells[k] = id;
  return id;
}
/** A position with `side` to move, one of its pieces at (x,y); every other piece is where init() put it (far away). */
function position(b: B, side: Player, x: number, y: number) {
  const s = b.engine.init(1, { first: side, ruleset: b.engine.RULESET_V61 });
  s.phase = 'move'; s.actionsLeft = 3;
  const q = s.pieces.find(p => p.owner === side)!;
  q.x = x; q.y = y;
  return { s, q };
}

/** P1: a shielded piece of `side` walks onto an enemy "send home" cell. */
export function probeShield(b: B, side: Player) {
  const { s, q } = position(b, side, 5, 4);
  q.shield = true;
  const dir = side === 'human' ? 'right' : 'left', tx = side === 'human' ? 6 : 4;
  addEffect(b, s, side === 'human' ? 'ai' : 'human', { kind: 'home' }, tx, 4);
  const ev = b.engine.applyMove(s, side, { from: b.engine.key(5, 4), dir, mode: 'stack' });
  return { absorbed: ev.some(e => e.t === 'shielded'), fired: ev.some(e => e.t === 'trigger'), at: b.engine.key(q.x, q.y), shieldLeft: q.shield, cellLive: !!s.cells[b.engine.key(tx, 4)] };
}
/** P2: a piece is shoved by one effect onto a second effect cell; is the second cell used up? Then re-enter it. */
export function probeChain(b: B, side: Player) {
  const sgn = side === 'human' ? 1 : -1, x0 = side === 'human' ? 3 : 9;
  const { s, q } = position(b, side, x0, 4);
  addEffect(b, s, side, { kind: 'shove', dir: side === 'human' ? 'east' : 'west', amount: 2 }, x0 + sgn, 4);
  const second = addEffect(b, s, side, { kind: 'haste' }, x0 + 3 * sgn, 4);
  const dir = side === 'human' ? 'right' : 'left', back = side === 'human' ? 'left' : 'right';
  const ev1 = b.engine.applyMove(s, side, { from: b.engine.key(x0, 4), dir, mode: 'stack' });
  const firedFirst = ev1.filter(e => e.t === 'trigger' && e.ruleId === second).length;
  const liveAfter = s.cells[b.engine.key(x0 + 3 * sgn, 4)] === second;
  b.engine.applyMove(s, side, { from: b.engine.key(q.x, q.y), dir, mode: 'stack' });
  const ev3 = b.engine.applyMove(s, side, { from: b.engine.key(q.x, q.y), dir: back, mode: 'stack' });
  return { firedFirst, liveAfter, firedAgain: ev3.some(e => e.t === 'trigger' && e.ruleId === second) };
}
/** P3: actions granted at the start of the first 6 turns, for a given first mover. */
export function probeActions(b: B, first: Player) {
  const s = b.engine.init(7, { first, ruleset: b.engine.RULESET_V61 });
  const out: { side: Player; actions: number }[] = [];
  for (let i = 0; i < 6; i++) { out.push({ side: s.current, actions: s.actionsLeft }); b.engine.endTurn(s); }
  return out;
}
/** Control C1: a plain walk onto an effect (no chain) uses the cell up, for both sides. */
export function controlWalk(b: B, side: Player) {
  const sgn = side === 'human' ? 1 : -1, x0 = side === 'human' ? 3 : 9;
  const { s } = position(b, side, x0, 4);
  addEffect(b, s, side, { kind: 'haste' }, x0 + sgn, 4);
  b.engine.applyMove(s, side, { from: b.engine.key(x0, 4), dir: side === 'human' ? 'right' : 'left', mode: 'stack' });
  return { cellLive: !!s.cells[b.engine.key(x0 + sgn, 4)] };
}
/** Control C2: an unshielded piece walks into a freeze cell: frozen for its next turn, for both sides. */
export function controlFreeze(b: B, side: Player) {
  const { s, q } = position(b, side, 5, 4);
  addEffect(b, s, side === 'human' ? 'ai' : 'human', { kind: 'freeze' }, side === 'human' ? 6 : 4, 4);
  b.engine.applyMove(s, side, { from: b.engine.key(5, 4), dir: side === 'human' ? 'right' : 'left', mode: 'stack' });
  return { frozen: q.frozen };
}


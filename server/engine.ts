/**
 * Authoritative, deterministic game engine. Pure functions over plain JSON state.
 * Same seed + same actions => same result (seeded xorshift RNG lives in the state).
 *
 * ROUND SEQUENCE (documented in docs/DESIGN.md):
 *  0. Both players lock in an action secretly: an optional rule action + a move.
 *     The AI decides from the start-of-round public snapshot only.
 *  1. A player with "lose next turn" pending sits out entirely (both parts void).
 *  2. Rule phase (simultaneous): removals, then placements. A cell claimed by BOTH
 *     players this round "clashes" and stays empty. Placing over an older trap replaces it.
 *  3. Move phase: the priority player moves first (odd rounds: human, even rounds: AI).
 *     Entering a trapped cell fires it (any owner) and burns that cell. Displacements
 *     that land on another trap chain-fire it (max 3 in a chain).
 *  4. The first player to stand on their goal column wins immediately (so in a dead-even
 *     race, priority decides; priority alternates and round 1 is a coin flip).
 *     After MAX_ROUNDS, fewer columns left wins; then Sabotage score; then draw.
 */
import {
  type Player, type Effect, PLAYERS, other, effectCost, maxCells, RULE_BUDGET,
  describeEffect, shortLabel, isEffect, EFFECT_ICON,
} from './rules.ts';

export const SIZE = 7;
export const SLOTS = 3;
export const MAX_ROUNDS = 20;
export const MAX_CHAIN = 3;
export const START: Record<Player, Pos> = { human: { x: 0, y: 3 }, ai: { x: 6, y: 3 } };
export const GOAL_X: Record<Player, number> = { human: 6, ai: 0 };
/** Traps may only live in the middle five columns, never in a start/goal column. */
export const TRAP_MIN_X = 1, TRAP_MAX_X = 5;

export type Pos = { x: number; y: number };
export type Dir = 'up' | 'down' | 'left' | 'right' | 'hold';
export const DIRS: Record<Exclude<Dir, 'hold'>, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const FLIP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left', hold: 'hold' };

export type ShapeKind = 'row' | 'column' | 'diagonal' | 'square';
export type Shape = { kind: ShapeKind; name: string; cells: string[]; mirrorOf?: string };

export type Rule = {
  id: number; owner: Player; text: string; effect: Effect; label: string; summary: string;
  cells: string[]; placedCells: number; round: number; hits: { human: number; ai: number };
  approxNote?: string; interpretedBy: string;
};
export type Status = { skip: boolean; skipImmune: boolean; reverse: boolean; shield: boolean };

export type RuleAction =
  | { op: 'none' }
  | { op: 'remove'; slot: number }
  | { op: 'place'; slot?: number; text: string; effect: Effect; cells: string[]; approxNote?: string; interpretedBy: string };
export type Action = { rule: RuleAction; move: Dir };

export type GameEvent =
  | { t: 'sitout'; p: Player }
  | { t: 'remove'; p: Player; ruleId: number; text: string }
  | { t: 'place'; p: Player; ruleId: number; text: string; cells: string[]; label: string; replaced?: number }
  | { t: 'overwrite'; p: Player; victimOwner: Player; victimId: number; cells: string[] }
  | { t: 'clash'; cells: string[] }
  | { t: 'fizzle'; p: Player; text: string }
  | { t: 'move'; p: Player; from: Pos; to: Pos; dir: Dir; reversed?: boolean; bump?: boolean }
  | { t: 'trigger'; p: Player; owner: Player; ruleId: number; text: string; label: string; kind: Effect['kind']; cell: string; chain: number; self: boolean }
  | { t: 'shielded'; p: Player; ruleId: number; cell: string }
  | { t: 'displace'; p: Player; from: Pos; to: Pos; how: 'push' | 'teleport' | 'swap' }
  | { t: 'status'; p: Player; status: 'skip' | 'reverse' | 'shield'; resisted?: boolean }
  | { t: 'chain-limit'; p: Player }
  | { t: 'win'; winner: Player | 'draw'; reason: string };

export type RoundRecord = { round: number; shape: Shape; priority: Player; actions: Record<Player, Action>; events: GameEvent[] };

export type State = {
  seed: number; rng: number; round: number; maxRounds: number; slots: number;
  shape: Shape; positions: Record<Player, Pos>; status: Record<Player, Status>;
  rules: Record<Player, Rule[]>; nextId: number;
  winner: Player | 'draw' | null; winReason: string; history: RoundRecord[];
  /** Coin flip at game start: who moves first in odd rounds. Even rounds swap. */
  firstPriority: Player;
};

export const key = (x: number, y: number) => `${x},${y}`;
export const parseKey = (k: string): Pos => { const [x, y] = k.split(',').map(Number); return { x, y }; };
export const inside = (x: number, y: number) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
export const cellName = (k: string) => { const { x, y } = parseKey(k); return 'ABCDEFG'[x] + (y + 1); };
const clone = <T>(v: T): T => structuredClone(v);
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

export function rand(s: State): number {
  let x = s.rng >>> 0; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  s.rng = x || 0x9e3779b9; return s.rng;
}

// ---------- shapes ----------
function makeShape(kind: ShapeKind, a: number, b: number): Shape {
  const cells: Pos[] = [];
  let name = '';
  if (kind === 'row') { for (let x = 0; x < SIZE; x++) cells.push({ x, y: a }); name = `Row ${a + 1}`; }
  if (kind === 'column') { for (let y = 0; y < SIZE; y++) cells.push({ x: a, y }); name = `Column ${'ABCDEFG'[a]}`; }
  if (kind === 'diagonal') { // a = start row at x=0, b = +1 (↘) or -1 (↗)
    for (let x = 0; x < SIZE; x++) { const y = a + b * x; if (inside(x, y)) cells.push({ x, y }); }
    name = b > 0 ? 'Diagonal ↘' : 'Diagonal ↗';
  }
  if (kind === 'square') { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push({ x: a + dx, y: b + dy }); name = `3×3 square around ${'ABCDEFG'[a]}${b + 1}`; }
  return { kind, name, cells: cells.map(c => key(c.x, c.y)) };
}
function randomShape(s: State): Shape {
  const kinds: ShapeKind[] = ['row', 'column', 'diagonal', 'square'];
  const kind = kinds[rand(s) % kinds.length];
  if (kind === 'row') return makeShape('row', rand(s) % SIZE, 0);
  if (kind === 'column') return makeShape('column', TRAP_MIN_X + (rand(s) % 5), 0);
  if (kind === 'diagonal') { const down = rand(s) % 2 === 0; return makeShape('diagonal', down ? rand(s) % 3 : 4 + (rand(s) % 3), down ? 1 : -1); }
  return makeShape('square', 2 + (rand(s) % 3), 1 + (rand(s) % 5));
}
/** Even rounds mirror the previous round's shape left↔right so neither side is favoured by the draw. */
function mirrorShape(prev: Shape): Shape {
  const cells = prev.cells.map(parseKey).map(c => key(SIZE - 1 - c.x, c.y)).sort();
  let name = prev.name;
  if (prev.kind === 'column') name = `Column ${'ABCDEFG'[SIZE - 1 - parseKey(prev.cells[0]).x]}`;
  if (prev.kind === 'diagonal') name = prev.name.includes('↘') ? 'Diagonal ↗' : 'Diagonal ↘';
  if (prev.kind === 'square') { const c = parseKey(prev.cells[4]); name = `3×3 square around ${'ABCDEFG'[SIZE - 1 - c.x]}${c.y + 1}`; }
  return { kind: prev.kind, name, cells, mirrorOf: prev.name };
}
function drawShape(s: State) { s.shape = s.round % 2 === 0 ? mirrorShape(s.shape) : randomShape(s); }

/** Cells of the current shape a trap may be placed on (middle columns, not under a player). */
export function eligibleCells(s: State): string[] {
  return s.shape.cells.filter(k => {
    const { x } = parseKey(k);
    return x >= TRAP_MIN_X && x <= TRAP_MAX_X && !PLAYERS.some(p => same(s.positions[p], parseKey(k)));
  });
}

export function init(seed: number = Date.now(), slots = SLOTS): State {
  if (!Number.isInteger(slots) || slots < 1 || slots > 5) throw new Error('slots must be 1..5');
  const s: State = {
    seed: seed >>> 0, rng: (seed >>> 0) || 123456789, round: 1, maxRounds: MAX_ROUNDS, slots,
    shape: { kind: 'row', name: '', cells: [] }, positions: clone(START),
    status: { human: freshStatus(), ai: freshStatus() }, rules: { human: [], ai: [] }, nextId: 1,
    winner: null, winReason: '', history: [], firstPriority: 'human',
  };
  for (let i = 0; i < 3; i++) rand(s);
  s.firstPriority = rand(s) % 2 === 0 ? 'human' : 'ai';
  drawShape(s);
  return s;
}
const freshStatus = (): Status => ({ skip: false, skipImmune: false, reverse: false, shield: false });
export const priorityOf = (s: State): Player => (s.round % 2 === 1 ? s.firstPriority : other(s.firstPriority));
export const allRules = (s: State) => [...s.rules.human, ...s.rules.ai];
export function ruleAt(s: State, k: string): Rule | null { return allRules(s).find(r => r.cells.includes(k)) ?? null; }
export const columnsLeft = (s: State, p: Player) => Math.abs(GOAL_X[p] - s.positions[p].x);

// ---------- validation ----------
export type Check = { ok: true } | { ok: false; reason: string };
export function validateAction(s: State, p: Player, a: Action): Check {
  if (s.winner) return { ok: false, reason: 'The game is over.' };
  if (!a || typeof a !== 'object' || !a.rule || typeof a.rule !== 'object') return { ok: false, reason: 'Malformed action.' };
  if (!['up', 'down', 'left', 'right', 'hold'].includes(a.move)) return { ok: false, reason: 'Unknown move.' };
  if (s.status[p].skip) return a.move === 'hold' && a.rule.op === 'none' ? { ok: true } : { ok: false, reason: 'You are skipping this turn.' };
  if (a.move !== 'hold') {
    const d = DIRS[(s.status[p].reverse ? FLIP[a.move] : a.move) as Exclude<Dir, 'hold'>];
    const pos = s.positions[p];
    if (!inside(pos.x + d.x, pos.y + d.y)) return { ok: false, reason: s.status[p].reverse ? 'Reversed: that move would leave the board.' : 'That move leaves the board.' };
  }
  const r = a.rule;
  if (r.op === 'none') return { ok: true };
  if (r.op === 'remove') return Number.isInteger(r.slot) && r.slot >= 0 && r.slot < s.rules[p].length ? { ok: true } : { ok: false, reason: 'No rule in that slot.' };
  if (r.op !== 'place') return { ok: false, reason: 'Unknown rule action.' };
  if (typeof r.text !== 'string' || r.text.length < 1 || r.text.length > 160) return { ok: false, reason: 'Rule text missing.' };
  if (!isEffect(r.effect)) return { ok: false, reason: 'Effect is not one the engine supports.' };
  if (r.slot !== undefined && (!Number.isInteger(r.slot) || r.slot < 0 || r.slot >= s.rules[p].length)) return { ok: false, reason: 'No rule in that slot to replace.' };
  if (r.slot === undefined && s.rules[p].length >= s.slots) return { ok: false, reason: `All ${s.slots} rule slots are full. Replace or remove one.` };
  if (!Array.isArray(r.cells) || r.cells.length === 0) return { ok: false, reason: 'Pick at least one highlighted square.' };
  if (new Set(r.cells).size !== r.cells.length) return { ok: false, reason: 'Duplicate squares.' };
  const elig = new Set(eligibleCells(s));
  const bad = r.cells.find(c => !elig.has(c));
  if (bad) return { ok: false, reason: `${/^\d,\d$/.test(bad) ? cellName(bad) : 'That square'} is not in this round's shape (or is a start/goal column or under a player).` };
  const cost = effectCost(r.effect) * r.cells.length;
  if (cost > RULE_BUDGET) return { ok: false, reason: `Too strong: ${shortLabel(r.effect)} costs ${effectCost(r.effect)} per square, so you can trap at most ${maxCells(r.effect)} square${maxCells(r.effect) === 1 ? '' : 's'} (budget ${RULE_BUDGET}).` };
  return { ok: true };
}

// ---------- resolution ----------
export function resolveRound(state: State, actions: Record<Player, Action>): { state: State; events: GameEvent[] } {
  for (const p of PLAYERS) { const c = validateAction(state, p, actions[p]); if (!c.ok) throw new Error(`${p}: ${c.reason}`); }
  const s = clone(state);
  const events: GameEvent[] = [];
  const priority = priorityOf(s);
  const order: Player[] = [priority, other(priority)];
  const acting: Record<Player, boolean> = { human: true, ai: true };

  for (const p of order) if (s.status[p].skip) {
    acting[p] = false; s.status[p].skip = false; s.status[p].skipImmune = true; events.push({ t: 'sitout', p });
  }

  // --- rule phase: removals (and replaced rules) first, resolved against the pre-round slots ---
  const placing: Partial<Record<Player, Extract<RuleAction, { op: 'place' }>>> = {};
  const replacedId: Partial<Record<Player, number>> = {};
  for (const p of order) {
    if (!acting[p]) continue;
    const r = actions[p].rule;
    if (r.op === 'remove' || (r.op === 'place' && r.slot !== undefined)) {
      const victim = state.rules[p][r.slot!];
      s.rules[p] = s.rules[p].filter(x => x.id !== victim.id);
      if (r.op === 'remove') events.push({ t: 'remove', p, ruleId: victim.id, text: victim.text });
      else replacedId[p] = victim.id;
    }
    if (r.op === 'place') placing[p] = r;
  }
  const claimed = new Map<string, number>();
  for (const p of order) for (const c of placing[p]?.cells ?? []) claimed.set(c, (claimed.get(c) ?? 0) + 1);
  const clashed = [...claimed].filter(([, n]) => n > 1).map(([c]) => c).sort();
  if (clashed.length) events.push({ t: 'clash', cells: clashed });
  for (const p of order) {
    const r = placing[p]; if (!r) continue;
    const cells = r.cells.filter(c => !clashed.includes(c));
    if (!cells.length) { events.push({ t: 'fizzle', p, text: r.text }); continue; }
    for (const owner of PLAYERS) for (const old of s.rules[owner]) {
      const hit = old.cells.filter(c => cells.includes(c));
      if (hit.length) { old.cells = old.cells.filter(c => !cells.includes(c)); events.push({ t: 'overwrite', p, victimOwner: owner, victimId: old.id, cells: hit }); }
    }
    const rule: Rule = {
      id: s.nextId++, owner: p, text: r.text.trim(), effect: clone(r.effect), label: shortLabel(r.effect), summary: describeEffect(r.effect),
      cells: [...cells].sort(), placedCells: cells.length, round: s.round, hits: { human: 0, ai: 0 }, interpretedBy: r.interpretedBy,
      ...(r.approxNote ? { approxNote: r.approxNote } : {}),
    };
    s.rules[p].push(rule);
    events.push({ t: 'place', p, ruleId: rule.id, text: rule.text, cells: rule.cells, label: rule.label, ...(replacedId[p] ? { replaced: replacedId[p] } : {}) });
  }
  pruneEmpty(s);

  // --- move phase: priority player first; the first player standing on their goal column wins at once ---
  for (const p of order) {
    if (!acting[p]) continue;
    let dir = actions[p].move;
    let reversed = false;
    if (dir !== 'hold' && s.status[p].reverse) { dir = FLIP[dir]; reversed = true; s.status[p].reverse = false; }
    if (dir === 'hold') { events.push({ t: 'move', p, from: clone(s.positions[p]), to: clone(s.positions[p]), dir: 'hold' }); continue; }
    const from = clone(s.positions[p]);
    const d = DIRS[dir as Exclude<Dir, 'hold'>];
    s.positions[p] = { x: from.x + d.x, y: from.y + d.y };
    events.push({ t: 'move', p, from, to: clone(s.positions[p]), dir, ...(reversed ? { reversed: true } : {}) });
    fireAt(s, p, events, 1);
    if (s.positions[p].x === GOAL_X[p]) {
      s.winner = p;
      s.winReason = `${p === 'human' ? 'You' : 'The AI'} reached the goal${p === priority && s.positions[other(p)].x !== GOAL_X[other(p)] ? '' : ''}.`;
      break;
    }
  }
  for (const p of PLAYERS) if (acting[p]) s.status[p].skipImmune = false;

  // --- round limit ---
  if (!s.winner && s.round >= s.maxRounds) {
    const h = columnsLeft(s, 'human'), a = columnsLeft(s, 'ai');
    const hs = sabotageScore(s, 'human', events), as = sabotageScore(s, 'ai', events);
    s.winner = h < a ? 'human' : a < h ? 'ai' : hs > as ? 'human' : as > hs ? 'ai' : 'draw';
    s.winReason = `Round limit reached. Columns left: you ${h}, AI ${a}.` + (h === a ? ` Sabotage score (hits on the other player): you ${hs}, AI ${as}.` : '');
  }
  if (s.winner) events.push({ t: 'win', winner: s.winner, reason: s.winReason });
  s.history.push({ round: s.round, shape: clone(s.shape), priority, actions: clone(actions), events: clone(events) });
  s.round++;
  if (!s.winner) drawShape(s);
  return { state: s, events };
}

function pruneEmpty(s: State) { for (const p of PLAYERS) s.rules[p] = s.rules[p].filter(r => r.cells.length > 0); }

function fireAt(s: State, p: Player, events: GameEvent[], depth: number) {
  const k = key(s.positions[p].x, s.positions[p].y);
  const rule = ruleAt(s, k);
  if (!rule) return;
  if (depth > MAX_CHAIN) { events.push({ t: 'chain-limit', p }); return; }
  rule.cells = rule.cells.filter(c => c !== k); // burn exactly this cell, exactly once
  rule.hits[p]++;
  if (s.status[p].shield) {
    s.status[p].shield = false;
    events.push({ t: 'shielded', p, ruleId: rule.id, cell: k });
    pruneEmpty(s); return;
  }
  events.push({ t: 'trigger', p, owner: rule.owner, ruleId: rule.id, text: rule.text, label: rule.label, kind: rule.effect.kind, cell: k, chain: depth, self: rule.owner === p });
  pruneEmpty(s);
  const e = rule.effect;
  const from = clone(s.positions[p]);
  const towardGoal = GOAL_X[p] > s.positions[p].x ? 1 : -1;
  if (e.kind === 'push') {
    const step = -towardGoal * e.amount;
    const nx = Math.max(0, Math.min(SIZE - 1, from.x + step));
    if (nx !== from.x) { s.positions[p] = { x: nx, y: from.y }; events.push({ t: 'displace', p, from, to: clone(s.positions[p]), how: e.kind }); fireAt(s, p, events, depth + 1); }
    else events.push({ t: 'displace', p, from, to: from, how: e.kind });
  } else if (e.kind === 'skip') {
    if (s.status[p].skipImmune || s.status[p].skip) events.push({ t: 'status', p, status: 'skip', resisted: true });
    else { s.status[p].skip = true; events.push({ t: 'status', p, status: 'skip' }); }
  } else if (e.kind === 'reverse') {
    s.status[p].reverse = true; events.push({ t: 'status', p, status: 'reverse' });
  } else if (e.kind === 'shield') {
    s.status[p].shield = true; events.push({ t: 'status', p, status: 'shield' });
  } else if (e.kind === 'teleport') {
    const opts: string[] = [];
    for (let x = TRAP_MIN_X; x <= TRAP_MAX_X; x++) for (let y = 0; y < SIZE; y++) {
      const c = key(x, y);
      if (!ruleAt(s, c) && !PLAYERS.some(q => same(s.positions[q], { x, y }))) opts.push(c);
    }
    if (opts.length) {
      s.positions[p] = parseKey(opts[rand(s) % opts.length]);
      events.push({ t: 'displace', p, from, to: clone(s.positions[p]), how: 'teleport' });
    }
  } else if (e.kind === 'swap') {
    const q = other(p), theirs = clone(s.positions[q]);
    // Hard limit: a swap may never drop anyone straight into a home column (no instant wins).
    if (theirs.x < TRAP_MIN_X || theirs.x > TRAP_MAX_X) { events.push({ t: 'displace', p, from, to: from, how: 'swap' }); return; }
    s.positions[q] = from; s.positions[p] = theirs;
    events.push({ t: 'displace', p, from, to: clone(theirs), how: 'swap' });
    events.push({ t: 'displace', p: q, from: theirs, to: clone(from), how: 'swap' });
  }
}

/** Times p's traps fired on the other player this game (this round's triggers included). */
export function sabotageScore(s: State, p: Player, current: GameEvent[] = []): number {
  let n = 0;
  for (const e of [...s.history.flatMap(r => r.events), ...current]) if (e.t === 'trigger' && e.owner === p && e.p !== p) n++;
  return n;
}

// ---------- read-only helpers used by the UI and the AI ----------
export function publicView(s: State) {
  return {
    round: s.round, maxRounds: s.maxRounds, slots: s.slots, budget: RULE_BUDGET, priority: priorityOf(s),
    shape: s.shape, eligible: s.winner ? [] : eligibleCells(s), positions: s.positions, status: s.status,
    goalX: GOAL_X, winner: s.winner, winReason: s.winReason, firstPriority: s.firstPriority,
    sabotage: { human: sabotageScore(s, 'human'), ai: sabotageScore(s, 'ai') }, history: s.history.length,
    rules: {
      human: s.rules.human.map(r => ruleView(r)), ai: s.rules.ai.map(r => ruleView(r)),
    },
  };
}
function ruleView(r: Rule) {
  return { id: r.id, owner: r.owner, text: r.text, label: r.label, summary: r.summary, icon: EFFECT_ICON[r.effect.kind], effect: r.effect, cells: r.cells, placedCells: r.placedCells, round: r.round, hits: r.hits, approxNote: r.approxNote, interpretedBy: r.interpretedBy };
}
export const NO_ACTION: Action = { rule: { op: 'none' }, move: 'hold' };

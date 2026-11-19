/**
 * Authoritative, deterministic game engine (pure functions over plain JSON state).
 * Same seed + same actions => same result (seeded xorshift RNG lives in the state).
 *
 * TURN SEQUENCE (players alternate; a coin flip picks who starts):
 *  1. Actions for this turn = your pieces still on the board + any banked +1 bonus.
 *  2. Placement phase (optional, before your first move): remove any of your own effects
 *     (free), then place ONE effect definition on up to 3 cells anywhere on the board.
 *     A cell with your own effect may be re-used (counts toward the 3); cells holding an
 *     opponent effect or any piece are not eligible. Every new definition is reviewed
 *     by the referee before it becomes live (see game.ts).
 *  3. Move phase: each action moves one piece, or your whole stack on a cell, one square
 *     orthogonally. Landing on enemy pieces captures them (back to their start squares).
 *     Landing on friendly pieces stacks. Entering a cell fires its effect (whoever owns it)
 *     and burns that cell. Forced movement can land on more effects (chain cap 4).
 *     Reaching the opposite column scores the piece (it leaves the board).
 *  4. End turn. Win: all 3 of your pieces scored. Turn limit: most scored, then least
 *     total distance left, then draw.
 */
import { type Player, type Effect, PLAYERS, other, isEffect, describeEffect, shortLabel, effectIcon, MAX_CELLS_PER_TURN } from './rules.ts';

export const SIZE = 7;
export const PIECES = 3;
export const MAX_TURNS = 60; // 30 each
export const MAX_CHAIN = 4;
export const GOAL_X: Record<Player, number> = { human: SIZE - 1, ai: 0 };
export const START_X: Record<Player, number> = { human: 0, ai: SIZE - 1 };
export const START_ROWS = [1, 3, 5];

export type Pos = { x: number; y: number };
export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Record<Dir, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const COMPASS: Record<string, Dir> = { north: 'up', south: 'down', east: 'right', west: 'left' };

export type Piece = { id: string; owner: Player; x: number; y: number; home: Pos; scored: boolean; frozen: number; shield: boolean };
export type Rule = { id: number; owner: Player; text: string; effect: Effect; label: string; summary: string; icon: string; cells: string[]; placed: number; turn: number; hits: Record<Player, number>; approxNote?: string; interpretedBy: string; verdict?: string };

export type Placement = { text: string; effect: Effect; cells: string[]; interpretedBy: string; approxNote?: string };
export type Move = { from: string; dir: Dir; mode: 'stack' | 'single' };

export type GameEvent =
  | { t: 'turn'; p: Player; actions: number; turn: number }
  | { t: 'remove'; p: Player; cells: string[] }
  | { t: 'place'; p: Player; ruleId: number; text: string; label: string; icon: string; cells: string[]; replaced: string[] }
  | { t: 'move'; p: Player; pieces: string[]; from: string; to: string; dir: Dir }
  | { t: 'trigger'; p: Player; owner: Player; pieces: string[]; ruleId: number; text: string; label: string; kind: Effect['kind']; cell: string; chain: number; self: boolean }
  | { t: 'shielded'; pieces: string[]; cell: string }
  | { t: 'forced'; pieces: string[]; from: string; to: string; how: 'shove' | 'home' | 'teleport' }
  | { t: 'status'; pieces: string[]; status: 'freeze' | 'shield'; }
  | { t: 'haste'; p: Player; now: boolean }
  | { t: 'capture'; by: Player; pieces: string[]; cell: string; forced: boolean }
  | { t: 'stack'; p: Player; pieces: string[]; cell: string }
  | { t: 'score'; p: Player; pieces: string[]; cell: string; total: number }
  | { t: 'chain-limit'; cell: string }
  | { t: 'end'; p: Player }
  | { t: 'win'; winner: Player | 'draw'; reason: string };

export type State = {
  seed: number; rng: number; turn: number; maxTurns: number; current: Player; firstPlayer: Player;
  phase: 'place' | 'move'; actionsLeft: number; bonus: Record<Player, number>;
  pieces: Piece[]; cells: Record<string, number>; rules: Rule[]; nextId: number;
  winner: Player | 'draw' | null; winReason: string; log: GameEvent[][]; stats: { activePerTurn: number[] };
  /** EXPERIMENT-ONLY rule variant (Balance Designer V2, intervention E4). Absent in every production game. */
  variant?: RuleVariant;
};
/**
 * An isolated, experiment-only change to ONE rule property. Only the V2 experiment executor creates one, and only
 * through init(seed, { variant }) with the explicit EXPERIMENTAL_RULE_VARIANT token; the game server never does
 * (tests check it). `teleport: 'same-column'` = a teleport moves the piece to a random empty square of the SAME
 * column (distance to every goal unchanged) instead of a random empty middle square.
 */
export type RuleVariant = { id: string; experimental: typeof EXPERIMENTAL_RULE_VARIANT; teleport?: 'same-column' };
export const EXPERIMENTAL_RULE_VARIANT = 'EXPERIMENT-ONLY-NOT-PRODUCTION' as const;

export const key = (x: number, y: number) => `${x},${y}`;
export const parseKey = (k: string): Pos => { const [x, y] = k.split(',').map(Number); return { x, y }; };
export const inside = (x: number, y: number) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
export const cellName = (k: string) => { const { x, y } = parseKey(k); return 'ABCDEFG'[x] + (y + 1); };
export const validKey = (k: unknown): k is string => typeof k === 'string' && /^[0-6],[0-6]$/.test(k);
const clone = <T>(v: T): T => structuredClone(v);

export function rand(s: State): number {
  let x = s.rng >>> 0; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  s.rng = x || 0x9e3779b9; return s.rng;
}

/** `first` forces who starts (paired self-play uses it to mirror a seed); omitted = seeded coin flip, as before. */
export function init(seed: number = Date.now(), opts: { first?: Player; variant?: RuleVariant } = {}): State {
  if (opts.variant && opts.variant.experimental !== EXPERIMENTAL_RULE_VARIANT) throw new Error('A rule variant must be explicitly marked experimental.');
  const pieces: Piece[] = [];
  for (const p of PLAYERS) START_ROWS.forEach((y, i) => pieces.push({ id: `${p === 'human' ? 'h' : 'a'}${i + 1}`, owner: p, x: START_X[p], y, home: { x: START_X[p], y }, scored: false, frozen: 0, shield: false }));
  const s: State = {
    seed: seed >>> 0, rng: (seed >>> 0) || 123456789, turn: 1, maxTurns: MAX_TURNS, current: 'human', firstPlayer: 'human',
    phase: 'place', actionsLeft: 0, bonus: { human: 0, ai: 0 }, pieces, cells: {}, rules: [], nextId: 1,
    winner: null, winReason: '', log: [], stats: { activePerTurn: [] },
  };
  for (let i = 0; i < 3; i++) rand(s);
  s.firstPlayer = s.current = rand(s) % 2 === 0 ? 'human' : 'ai';
  if (opts.first) s.firstPlayer = s.current = opts.first;
  if (opts.variant) s.variant = structuredClone(opts.variant);
  startTurn(s, []);
  return s;
}

export const onBoard = (s: State, p: Player) => s.pieces.filter(x => x.owner === p && !x.scored);
export const scored = (s: State, p: Player) => s.pieces.filter(x => x.owner === p && x.scored).length;
export const piecesAt = (s: State, k: string) => { const { x, y } = parseKey(k); return s.pieces.filter(q => !q.scored && q.x === x && q.y === y); };
export const ruleById = (s: State, id: number) => s.rules.find(r => r.id === id);
export const ruleAt = (s: State, k: string): Rule | null => (s.cells[k] ? ruleById(s, s.cells[k]) ?? null : null);
export const activeEffects = (s: State, p?: Player) => Object.values(s.cells).filter(id => !p || ruleById(s, id)?.owner === p).length;

function startTurn(s: State, events: GameEvent[]) {
  const p = s.current;
  s.actionsLeft = onBoard(s, p).length + s.bonus[p];
  s.bonus[p] = 0;
  s.phase = 'place';
  events.push({ t: 'turn', p, actions: s.actionsLeft, turn: s.turn });
}

export type Check = { ok: true } | { ok: false; reason: string };

/** Cells p may place on this turn: no piece, and no opponent effect. */
export function eligibleCells(s: State, p: Player): string[] {
  const out: string[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const k = key(x, y);
    if (piecesAt(s, k).length) continue;
    const r = ruleAt(s, k);
    if (r && r.owner !== p) continue;
    out.push(k);
  }
  return out;
}

export function validatePlacement(s: State, p: Player, pl: Placement | null, remove: string[] = []): Check {
  if (s.winner) return { ok: false, reason: 'The game is over.' };
  if (s.current !== p) return { ok: false, reason: 'Not your turn.' };
  if (s.phase !== 'place') return { ok: false, reason: 'Effects must be placed before your first move.' };
  if (!Array.isArray(remove) || remove.some(k => !validKey(k) || ruleAt(s, k)?.owner !== p)) return { ok: false, reason: 'You can only remove your own effects.' };
  if (!pl) return { ok: true };
  if (typeof pl.text !== 'string' || !pl.text.trim() || pl.text.length > 160) return { ok: false, reason: 'Rule text missing.' };
  if (!isEffect(pl.effect)) return { ok: false, reason: 'Effect is not one the engine supports.' };
  if (!Array.isArray(pl.cells) || pl.cells.length < 1 || pl.cells.length > MAX_CELLS_PER_TURN) return { ok: false, reason: `Pick 1 to ${MAX_CELLS_PER_TURN} cells.` };
  if (pl.cells.some(k => !validKey(k)) || new Set(pl.cells).size !== pl.cells.length) return { ok: false, reason: 'Invalid or duplicate cells.' };
  const ok = new Set(eligibleCells(s, p));
  const bad = pl.cells.find(k => !ok.has(k));
  if (bad) return { ok: false, reason: `${cellName(bad)} is not available (it has a piece on it, or your opponent’s effect).` };
  return { ok: true };
}

/** Apply removals and one placement (already approved by the referee). */
export function applyPlacement(s: State, p: Player, pl: Placement | null, remove: string[] = []): GameEvent[] {
  const c = validatePlacement(s, p, pl, remove);
  if (!c.ok) throw new Error(c.reason);
  const events: GameEvent[] = [];
  if (remove.length) {
    for (const k of remove) unsetCell(s, k);
    events.push({ t: 'remove', p, cells: [...remove].sort() });
  }
  if (pl) {
    const replaced = pl.cells.filter(k => s.cells[k]);
    for (const k of replaced) unsetCell(s, k);
    const rule: Rule = {
      id: s.nextId++, owner: p, text: pl.text.trim(), effect: clone(pl.effect), label: shortLabel(pl.effect), summary: describeEffect(pl.effect), icon: effectIcon(pl.effect),
      cells: [...pl.cells].sort(), placed: pl.cells.length, turn: s.turn, hits: { human: 0, ai: 0 }, interpretedBy: pl.interpretedBy, ...(pl.approxNote ? { approxNote: pl.approxNote } : {}),
    };
    s.rules.push(rule);
    for (const k of rule.cells) s.cells[k] = rule.id;
    events.push({ t: 'place', p, ruleId: rule.id, text: rule.text, label: rule.label, icon: rule.icon, cells: rule.cells, replaced });
  }
  s.phase = 'move';
  return events;
}
/**
 * Activate an effect whose referee review finished later (Kane runs in the background).
 * Works at any moment of the game, and only on cells that are STILL eligible for its owner
 * (no piece, no opponent effect). Returns the cells actually used and the event, if any.
 */
export function activateLate(s: State, p: Player, pl: Placement): { cells: string[]; skipped: string[]; events: GameEvent[] } {
  if (s.winner || !isEffect(pl.effect)) return { cells: [], skipped: pl.cells, events: [] };
  const ok = new Set(eligibleCells(s, p));
  const cells = pl.cells.filter(k => validKey(k) && ok.has(k)).slice(0, MAX_CELLS_PER_TURN), skipped = pl.cells.filter(k => !cells.includes(k));
  if (!cells.length) return { cells, skipped, events: [] };
  const replaced = cells.filter(k => s.cells[k]);
  for (const k of replaced) unsetCell(s, k);
  const rule: Rule = {
    id: s.nextId++, owner: p, text: pl.text.trim(), effect: clone(pl.effect), label: shortLabel(pl.effect), summary: describeEffect(pl.effect), icon: effectIcon(pl.effect),
    cells: [...cells].sort(), placed: cells.length, turn: s.turn, hits: { human: 0, ai: 0 }, interpretedBy: pl.interpretedBy, ...(pl.approxNote ? { approxNote: pl.approxNote } : {}),
  };
  s.rules.push(rule);
  for (const k of rule.cells) s.cells[k] = rule.id;
  return { cells, skipped, events: [{ t: 'place', p, ruleId: rule.id, text: rule.text, label: rule.label, icon: rule.icon, cells: rule.cells, replaced }] };
}
function unsetCell(s: State, k: string) {
  const r = ruleAt(s, k);
  if (r) r.cells = r.cells.filter(c => c !== k);
  delete s.cells[k];
}

function movable(s: State, p: Player, from: string, mode: 'stack' | 'single'): Piece[] {
  const here = piecesAt(s, from).filter(q => q.owner === p && q.frozen === 0);
  return mode === 'single' ? here.slice(0, 1) : here;
}

export function validateMove(s: State, p: Player, m: Move): Check {
  if (s.winner) return { ok: false, reason: 'The game is over.' };
  if (s.current !== p) return { ok: false, reason: 'Not your turn.' };
  if (s.actionsLeft <= 0) return { ok: false, reason: 'No actions left this turn.' };
  if (!m || !validKey(m.from) || !DIRS[m.dir] || (m.mode !== 'stack' && m.mode !== 'single')) return { ok: false, reason: 'Malformed move.' };
  const here = piecesAt(s, m.from).filter(q => q.owner === p);
  if (!here.length) return { ok: false, reason: 'You have no piece there.' };
  if (!movable(s, p, m.from, m.mode).length) return { ok: false, reason: 'That piece is frozen this turn.' };
  const f = parseKey(m.from), d = DIRS[m.dir];
  if (!inside(f.x + d.x, f.y + d.y)) return { ok: false, reason: 'That move leaves the board.' };
  return { ok: true };
}

export function applyMove(s: State, p: Player, m: Move): GameEvent[] {
  const c = validateMove(s, p, m);
  if (!c.ok) throw new Error(c.reason);
  if (s.phase === 'place') s.phase = 'move';
  const events: GameEvent[] = [];
  const group = movable(s, p, m.from, m.mode);
  const f = parseKey(m.from), d = DIRS[m.dir];
  const to = { x: f.x + d.x, y: f.y + d.y };
  for (const q of group) { q.x = to.x; q.y = to.y; }
  s.actionsLeft--;
  events.push({ t: 'move', p, pieces: group.map(q => q.id), from: m.from, to: key(to.x, to.y), dir: m.dir });
  land(s, group, m.dir, events, 1, false);
  checkWin(s, events);
  return events;
}

/** A group of same-owner pieces has just arrived at its current cell. */
function land(s: State, group: Piece[], dir: Dir, events: GameEvent[], depth: number, forced: boolean) {
  group = group.filter(q => !q.scored);
  if (!group.length) return;
  const owner = group[0].owner, k = key(group[0].x, group[0].y);
  // capture
  const enemies = piecesAt(s, k).filter(q => q.owner !== owner);
  if (enemies.length) {
    for (const e of enemies) { e.x = e.home.x; e.y = e.home.y; e.frozen = 0; e.shield = false; }
    events.push({ t: 'capture', by: owner, pieces: enemies.map(e => e.id), cell: k, forced });
  }
  const friends = piecesAt(s, k).filter(q => q.owner === owner && !group.includes(q));
  if (friends.length) events.push({ t: 'stack', p: owner, pieces: [...friends, ...group].map(q => q.id), cell: k });
  // effect
  const rule = ruleAt(s, k);
  if (rule) {
    if (depth > MAX_CHAIN) { events.push({ t: 'chain-limit', cell: k }); }
    else {
      unsetCell(s, k); // burn exactly this cell, exactly once
      rule.hits[owner]++;
      const shielded = group.filter(q => q.shield), hit = group.filter(q => !q.shield);
      for (const q of shielded) q.shield = false;
      if (shielded.length) events.push({ t: 'shielded', pieces: shielded.map(q => q.id), cell: k });
      if (hit.length) {
        events.push({ t: 'trigger', p: owner, owner: rule.owner, pieces: hit.map(q => q.id), ruleId: rule.id, text: rule.text, label: rule.label, kind: rule.effect.kind, cell: k, chain: depth, self: rule.owner === owner });
        applyEffect(s, hit, rule.effect, dir, events, depth);
        scoreIfGoal(s, hit, events);
        scoreIfGoal(s, shielded, events);
        return;
      }
    }
  }
  scoreIfGoal(s, group, events);
}
function scoreIfGoal(s: State, group: Piece[], events: GameEvent[]) {
  const g = group.filter(q => !q.scored && q.x === GOAL_X[q.owner]);
  if (!g.length) return;
  for (const q of g) { q.scored = true; q.frozen = 0; q.shield = false; }
  events.push({ t: 'score', p: g[0].owner, pieces: g.map(q => q.id), cell: key(g[0].x, g[0].y), total: scored(s, g[0].owner) });
}

function applyEffect(s: State, group: Piece[], e: Effect, dir: Dir, events: GameEvent[], depth: number) {
  const owner = group[0].owner;
  const from = key(group[0].x, group[0].y);
  if (e.kind === 'shove') {
    const d = e.dir === 'back' ? OPP[dir] : e.dir === 'forward' ? dir : COMPASS[e.dir];
    const v = DIRS[d];
    let x = group[0].x, y = group[0].y;
    for (let i = 0; i < e.amount && inside(x + v.x, y + v.y); i++) { x += v.x; y += v.y; }
    for (const q of group) { q.x = x; q.y = y; }
    events.push({ t: 'forced', pieces: group.map(q => q.id), from, to: key(x, y), how: 'shove' });
    if (key(x, y) !== from) land(s, group, d, events, depth + 1, true);
  } else if (e.kind === 'home') {
    for (const q of group) { q.x = q.home.x; q.y = q.home.y; }
    events.push({ t: 'forced', pieces: group.map(q => q.id), from, to: group.map(q => key(q.x, q.y)).join('|'), how: 'home' });
  } else if (e.kind === 'teleport') {
    const opts: string[] = [];
    if (s.variant?.teleport === 'same-column') { for (let y = 0; y < SIZE; y++) { const k = key(group[0].x, y); if (!s.cells[k] && !piecesAt(s, k).length) opts.push(k); } }
    else for (let x = 1; x < SIZE - 1; x++) for (let y = 0; y < SIZE; y++) { const k = key(x, y); if (!s.cells[k] && !piecesAt(s, k).length) opts.push(k); }
    if (opts.length) {
      const t = parseKey(opts[rand(s) % opts.length]);
      for (const q of group) { q.x = t.x; q.y = t.y; }
      events.push({ t: 'forced', pieces: group.map(q => q.id), from, to: key(t.x, t.y), how: 'teleport' });
    }
  } else if (e.kind === 'freeze') {
    for (const q of group) q.frozen = s.current === owner ? 2 : 1;
    events.push({ t: 'status', pieces: group.map(q => q.id), status: 'freeze' });
  } else if (e.kind === 'shield') {
    for (const q of group) q.shield = true;
    events.push({ t: 'status', pieces: group.map(q => q.id), status: 'shield' });
  } else if (e.kind === 'haste') {
    if (s.current === owner) s.actionsLeft++; else s.bonus[owner] = Math.min(1, s.bonus[owner] + 1);
    events.push({ t: 'haste', p: owner, now: s.current === owner });
  }
}

function checkWin(s: State, events: GameEvent[]) {
  if (s.winner) return;
  for (const p of PLAYERS) if (scored(s, p) === PIECES) {
    s.winner = p; s.winReason = `${p === 'human' ? 'You' : 'The AI'} got all ${PIECES} pieces across.`;
    events.push({ t: 'win', winner: p, reason: s.winReason });
    return;
  }
}

export function distanceLeft(s: State, p: Player) { return onBoard(s, p).reduce((a, q) => a + Math.abs(GOAL_X[p] - q.x), 0); }

/** End the current player's turn (also used when they run out of actions). */
export function endTurn(s: State): GameEvent[] {
  if (s.winner) return [];
  const events: GameEvent[] = [{ t: 'end', p: s.current }];
  for (const q of onBoard(s, s.current)) if (q.frozen > 0) q.frozen--;
  s.stats.activePerTurn.push(activeEffects(s));
  if (s.turn >= s.maxTurns) {
    const sh = scored(s, 'human'), sa = scored(s, 'ai'), dh = distanceLeft(s, 'human'), da = distanceLeft(s, 'ai');
    s.winner = sh > sa ? 'human' : sa > sh ? 'ai' : dh < da ? 'human' : da < dh ? 'ai' : 'draw';
    s.winReason = `Turn limit. Pieces across: you ${sh}, AI ${sa}.` + (sh === sa ? ` Squares left: you ${dh}, AI ${da}.` : '');
    events.push({ t: 'win', winner: s.winner, reason: s.winReason });
    return events;
  }
  s.turn++;
  s.current = other(s.current);
  startTurn(s, events);
  // a player whose every piece is frozen still gets the turn; they simply end it.
  return events;
}

/** Legal moves for the current player (for UIs and the AI). */
export function legalMoves(s: State, p: Player): Move[] {
  if (s.current !== p || s.winner || s.actionsLeft <= 0) return [];
  const out: Move[] = [];
  const cells = [...new Set(onBoard(s, p).filter(q => q.frozen === 0).map(q => key(q.x, q.y)))].sort();
  for (const from of cells) {
    const n = piecesAt(s, from).filter(q => q.owner === p && q.frozen === 0).length;
    for (const dir of Object.keys(DIRS) as Dir[]) for (const mode of (n > 1 ? ['stack', 'single'] : ['stack']) as Move['mode'][]) {
      const m = { from, dir, mode };
      if (validateMove(s, p, m).ok) out.push(m);
    }
  }
  return out;
}

export function publicView(s: State) {
  return {
    turn: s.turn, maxTurns: s.maxTurns, current: s.current, firstPlayer: s.firstPlayer, phase: s.phase, actionsLeft: s.actionsLeft, bonus: s.bonus,
    pieces: s.pieces.map(q => ({ ...q })), cells: s.cells, goalX: GOAL_X, winner: s.winner, winReason: s.winReason,
    rules: s.rules.filter(r => r.cells.length).map(r => ({ ...r })), scored: { human: scored(s, 'human'), ai: scored(s, 'ai') },
    active: { human: activeEffects(s, 'human'), ai: activeEffects(s, 'ai') },
    eligible: s.winner ? [] : eligibleCells(s, s.current),
  };
}

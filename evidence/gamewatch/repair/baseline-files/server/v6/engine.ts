/**
 * Rule Sabotage V6 EXPERIMENTAL engine (EXPERIMENTAL-V6-NOT-PRODUCTION).
 *
 * A separately versioned game. The production / research engine (server/engine.ts, 7x7) is NOT modified and nothing in
 * the V1–V5.3 code imports this file. This file is a fork of server/engine.ts with exactly these rule changes:
 *
 *  G1  Board 13 columns x 9 rows (W x H) instead of 7 x 7. Columns A..M, rows 1..9. The race still runs along x:
 *      Human starts on column A and scores on column M; the AI starts on column M and scores on column A.
 *  G2  Three pieces per side on rows 3, 5, 7 (0-based 2, 4, 6): centred and mirror-symmetric top/bottom, with the
 *      production spacing of 2 rows. The two sides are mirror images left/right.
 *  G3  Teleport destinations: every empty square of the middle columns B..L (production: B..F), same row-major rule.
 *  A1  NO NEW EFFECTS NEXT TO OPPONENT PIECES. A proposed effect cell is rejected when it is within Chebyshev distance 1
 *      (the 8 surrounding squares: orthogonal and diagonal) of ANY opposing piece still on the board. A multi-cell
 *      placement is rejected as a whole if any one of its cells violates this. Own-piece adjacency is allowed. The
 *      piece's own cell is still excluded by the existing occupancy rule. Effects already on the board are never
 *      removed or disabled when a piece moves next to them. Removing your own effects is always allowed. The check is
 *      part of validatePlacement (the server-side authority) and of eligibleCells (what the UI and every AI candidate
 *      generator offer), so a human request and an AI request are judged by the same function.
 *
 *  A2  (V6.1 ruleset only, `rule-sabotage/v6.1-all-piece-proximity@1`): A1 widened to ANY unscored piece, friendly or
 *      opposing. Chosen per game at init({ ruleset }); V6 (A1) remains the default. Nothing else differs between V6 and V6.1.
 *
 * Unchanged from production: actions per turn, stacking, capture, the six effects, burn-on-entry, chain cap 4,
 * max 3 cells per placement, scoring, win condition, and the 60-turn limit (MAX_TURNS) with its tie-break. The turn
 * limit is deliberately NOT changed here; see docs/V6_GAMEPLAY_EXPANSION.md for the turn-limit evidence.
 *
 * The experiment-only V2 rule variant and V3 starting configurations of server/engine.ts are not carried over.
 */
import { type Player, type Effect, PLAYERS, other, isEffect, describeEffect, shortLabel, effectIcon, MAX_CELLS_PER_TURN } from '../rules.ts';

export const RULESET = 'rule-sabotage/v6-13x9-no-adjacent-effects@1' as const;
/**
 * V6.1 (EXPERIMENTAL, separately versioned): rule A2 replaces A1. No new effect within Chebyshev distance 1 of ANY unscored
 * piece, whoever owns it. Everything else is the V6 ruleset unchanged (board, pieces, teleport B-L, turn limit, referee).
 * A game's ruleset is fixed at init() and stored in its state; V6 (A1) stays the default so V6 games are unchanged.
 */
export const RULESET_V61 = 'rule-sabotage/v6.1-all-piece-proximity@1' as const;
export type Ruleset = typeof RULESET | typeof RULESET_V61;
export const RULESETS: Record<'v6' | 'v6.1', Ruleset> = { 'v6': RULESET, 'v6.1': RULESET_V61 };
/** True when own pieces also close the squares around them (V6.1 rule A2). */
export const allPieceProximity = (s: { ruleset: Ruleset }) => s.ruleset === RULESET_V61;
export const V6_MODE = 'EXPERIMENTAL-V6-NOT-PRODUCTION' as const;

export const W = 13;
export const H = 9;
export const PIECES = 3;
export const MAX_TURNS = 60; // 30 each (unchanged; see the turn-limit evidence before changing it)
export const MAX_CHAIN = 4;
/** Chebyshev radius around an opposing piece where NEW effects may not be placed (rule A1). */
export const NO_EFFECT_RADIUS = 1;
export const GOAL_X: Record<Player, number> = { human: W - 1, ai: 0 };
export const START_X: Record<Player, number> = { human: 0, ai: W - 1 };
export const START_ROWS = [2, 4, 6];
export const COLS = 'ABCDEFGHIJKLM';

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
  ruleset: Ruleset;
  seed: number; rng: number; turn: number; maxTurns: number; current: Player; firstPlayer: Player;
  phase: 'place' | 'move'; actionsLeft: number; bonus: Record<Player, number>;
  pieces: Piece[]; cells: Record<string, number>; rules: Rule[]; nextId: number;
  winner: Player | 'draw' | null; winReason: string; log: GameEvent[][]; stats: { activePerTurn: number[] };
};

export const key = (x: number, y: number) => `${x},${y}`;
/** V6.2: same result as k.split(',').map(Number) for every input, without the array allocations (hot in the planners). */
export const parseKey = (k: string): Pos => {
  const i = k.indexOf(',');
  if (i < 0 || k.indexOf(',', i + 1) >= 0) { const [x, y] = k.split(',').map(Number); return { x, y }; }
  return { x: Number(k.slice(0, i)), y: Number(k.slice(i + 1)) };
};
export const inside = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;
export const cellName = (k: string) => { const { x, y } = parseKey(k); return COLS[x] + (y + 1); };
export const validKey = (k: unknown): k is string => {
  if (typeof k !== 'string' || !/^\d{1,2},\d$/.test(k)) return false;
  const { x, y } = parseKey(k); return inside(x, y);
};
const clone = <T>(v: T): T => structuredClone(v);

export function rand(s: State): number {
  let x = s.rng >>> 0; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  s.rng = x || 0x9e3779b9; return s.rng;
}

/**
 * `first` forces who starts; omitted = seeded coin flip (same RNG sequence as production). `maxTurns` is for the
 * turn-limit MEASUREMENT script only (scripts/v6-turn-limit.ts); every playable V6 game uses MAX_TURNS.
 */
export function init(seed: number = Date.now(), opts: { first?: Player; maxTurns?: number; ruleset?: Ruleset } = {}): State {
  if (opts.ruleset !== undefined && opts.ruleset !== RULESET && opts.ruleset !== RULESET_V61) throw new Error(`Unknown V6 ruleset ${String(opts.ruleset)}`);
  const pieces: Piece[] = [];
  for (const p of PLAYERS) START_ROWS.forEach((y, i) => pieces.push({ id: `${p === 'human' ? 'h' : 'a'}${i + 1}`, owner: p, x: START_X[p], y, home: { x: START_X[p], y }, scored: false, frozen: 0, shield: false }));
  const s: State = {
    ruleset: opts.ruleset ?? RULESET,
    seed: seed >>> 0, rng: (seed >>> 0) || 123456789, turn: 1, maxTurns: opts.maxTurns ?? MAX_TURNS, current: 'human', firstPlayer: 'human',
    phase: 'place', actionsLeft: 0, bonus: { human: 0, ai: 0 }, pieces, cells: {}, rules: [], nextId: 1,
    winner: null, winReason: '', log: [], stats: { activePerTurn: [] },
  };
  for (let i = 0; i < 3; i++) rand(s);
  s.firstPlayer = s.current = rand(s) % 2 === 0 ? 'human' : 'ai';
  if (opts.first) s.firstPlayer = s.current = opts.first;
  startTurn(s, []);
  return s;
}

export const onBoard = (s: State, p: Player) => s.pieces.filter(x => x.owner === p && !x.scored);
export const scored = (s: State, p: Player) => s.pieces.filter(x => x.owner === p && x.scored).length;
export const piecesAt = (s: State, k: string) => { const { x, y } = parseKey(k); return s.pieces.filter(q => !q.scored && q.x === x && q.y === y); };
export const ruleById = (s: State, id: number) => s.rules.find(r => r.id === id);
export const ruleAt = (s: State, k: string): Rule | null => (s.cells[k] ? ruleById(s, s.cells[k]) ?? null : null);
/** Pieces a side started with (always 3 in V6). Kept for API compatibility with the forked planners. */
export const piecesOf = (_s: State, _p: Player) => PIECES;
export const activeEffects = (s: State, p?: Player) => Object.values(s.cells).filter(id => !p || ruleById(s, id)?.owner === p).length;

function startTurn(s: State, events: GameEvent[]) {
  const p = s.current;
  s.actionsLeft = onBoard(s, p).length + s.bonus[p] + (s.turn % 2);
  s.bonus[p] = 0;
  s.phase = 'place';
  events.push({ t: 'turn', p, actions: s.actionsLeft, turn: s.turn });
}

export type Check = { ok: true } | { ok: false; reason: string; code?: CellBlock; cell?: string };

// ---------- rule A1 (V6): no new effects next to opponent pieces; rule A2 (V6.1): next to ANY piece ----------
export const chebyshev = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
/** Pieces whose rule counts for a placement by p: opposing pieces (A1), or every piece (A2). Scored pieces never count. */
const counts = (s: State, p: Player, q: Piece) => !q.scored && (q.owner !== p || allPieceProximity(s));
/** The pieces (still on the board) whose 8-neighbourhood contains cell k and that close it for a placement by p. */
export function guardsOf(s: State, p: Player, k: string): Piece[] {
  const c = parseKey(k);
  return s.pieces.filter(q => counts(s, p, q) && chebyshev(q, c) <= NO_EFFECT_RADIUS && !(q.x === c.x && q.y === c.y));
}
/** Every cell where p may NOT place a new effect because of rule A1/A2 (excludes the pieces' own cells). */
export function protectedCells(s: State, p: Player): string[] {
  const out = new Set<string>();
  for (const q of s.pieces) {
    if (!counts(s, p, q)) continue;
    for (let dy = -NO_EFFECT_RADIUS; dy <= NO_EFFECT_RADIUS; dy++) for (let dx = -NO_EFFECT_RADIUS; dx <= NO_EFFECT_RADIUS; dx++) {
      const x = q.x + dx, y = q.y + dy;
      if ((dx || dy) && inside(x, y)) out.add(key(x, y));
    }
  }
  return [...out].sort();
}
export type CellBlock = 'piece' | 'opponent-effect' | 'near-opponent' | 'near-own';
/** Why p cannot put a new effect on k (null = allowed). Occupancy first, then opponent effect, then rule A1. */
export function cellBlock(s: State, p: Player, k: string): CellBlock | null {
  if (piecesAt(s, k).length) return 'piece';
  const r = ruleAt(s, k);
  if (r && r.owner !== p) return 'opponent-effect';
  const g = guardsOf(s, p, k);
  if (g.some(q => q.owner !== p)) return 'near-opponent';
  if (g.length) return 'near-own'; // only possible under A2 (V6.1)
  return null;
}
/** Cells p may place on this turn: no piece, no opponent effect, and not next to an opposing piece (rule A1). */
export function eligibleCells(s: State, p: Player): string[] {
  const out: string[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = key(x, y);
    if (cellBlock(s, p, k) === null) out.push(k);
  }
  return out;
}
/** The reason, per blocked cell, for the interface: { cell: code }. */
export function blockedCells(s: State, p: Player): Record<string, CellBlock> {
  const out: Record<string, CellBlock> = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = key(x, y), b = cellBlock(s, p, k); if (b) out[k] = b; }
  return out;
}
export const A1_EXPLANATION = 'New effects cannot be placed on the 8 squares around an opponent piece (orthogonally or diagonally next to it). Squares next to your own pieces are fine, and effects already on the board stay.';
export const A2_EXPLANATION = 'New effects cannot be placed on the 8 squares around ANY piece, yours or your opponent’s (orthogonally or diagonally next to it). Effects already on the board stay and still fire when a piece walks onto them, and you can always remove your own.';
export const noEffectRule = (s: { ruleset: Ruleset }) => (allPieceProximity(s) ? A2_EXPLANATION : A1_EXPLANATION);

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
  // Removals happen before the placement, so a cell being removed this turn counts as empty here (as in production,
  // where an own-effect cell is always eligible). Rule A1 does not depend on removals.
  for (const k of pl.cells) {
    const b = cellBlock(s, p, k);
    if (b === 'piece') return { ok: false, code: b, cell: k, reason: `${cellName(k)} is not available: it has a piece on it.` };
    if (b === 'opponent-effect') return { ok: false, code: b, cell: k, reason: `${cellName(k)} is not available: your opponent’s effect is on it.` };
  }
  for (const k of pl.cells) {
    const g = guardsOf(s, p, k);
    if (g.length && allPieceProximity(s)) {
      const near = [...new Set(g.map(q => `${q.owner === p ? 'your' : 'the opponent’s'} piece on ${cellName(key(q.x, q.y))}`))].join(' and ');
      const n = pl.cells.length;
      return { ok: false, code: g.some(q => q.owner !== p) ? 'near-opponent' : 'near-own', cell: k, reason: `${cellName(k)} is next to ${near}. New effects cannot be placed on the 8 squares around any piece, yours or your opponent’s${n > 1 ? `, so this ${n}-cell placement is rejected as a whole` : ''}. Pick squares at least one square away from every piece.` };
    }
    if (g.length) {
      const near = [...new Set(g.map(q => cellName(key(q.x, q.y))))].join(', ');
      const n = pl.cells.length;
      return { ok: false, code: 'near-opponent', cell: k, reason: `${cellName(k)} is next to the opponent piece on ${near}. New effects cannot be placed on the 8 squares around an opponent piece${n > 1 ? `, so this ${n}-cell placement is rejected as a whole` : ''}. Pick squares at least one square away from every opponent piece.` };
    }
  }
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

/** See server/engine.ts: a planner-supplied resolver for random outcomes (the engine RNG is then neither read nor advanced). */
export type ChanceResolver = { teleport: (destinations: readonly string[]) => number };
/** Teleport destinations: every square of the middle columns B..L holding no piece and no live effect, row-major by column. */
export function teleportDestinations(s: State, _from: Pos): string[] {
  const opts: string[] = [];
  // V6.2: occupied squares collected once (same squares and order as testing piecesAt(s, k) per square).
  const occupied = new Set(s.pieces.filter(q => !q.scored).map(q => key(q.x, q.y)));
  for (let x = 1; x < W - 1; x++) for (let y = 0; y < H; y++) { const k = key(x, y); if (!s.cells[k] && !occupied.has(k)) opts.push(k); }
  return opts;
}
/** Exact probability of each destination index under rand(s) % n (identical to server/engine.ts). */
export function teleportIndexProbabilities(n: number): number[] {
  const N = 0xffffffff, out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i === 0 ? Math.floor(N / n) : Math.floor((N - i) / n) + 1) / N);
  return out;
}

export function applyMove(s: State, p: Player, m: Move, chance?: ChanceResolver): GameEvent[] {
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
  land(s, group, m.dir, events, 1, false, chance);
  checkWin(s, events);
  return events;
}

/** A group of same-owner pieces has just arrived at its current cell. */
function land(s: State, group: Piece[], dir: Dir, events: GameEvent[], depth: number, forced: boolean, chance?: ChanceResolver) {
  group = group.filter(q => !q.scored);
  if (!group.length) return;
  const owner = group[0].owner, k = key(group[0].x, group[0].y);
  const enemies = piecesAt(s, k).filter(q => q.owner !== owner);
  if (enemies.length) {
    for (const e of enemies) { e.x = e.home.x; e.y = e.home.y; e.frozen = 0; e.shield = false; }
    events.push({ t: 'capture', by: owner, pieces: enemies.map(e => e.id), cell: k, forced });
  }
  const friends = piecesAt(s, k).filter(q => q.owner === owner && !group.includes(q));
  if (friends.length) events.push({ t: 'stack', p: owner, pieces: [...friends, ...group].map(q => q.id), cell: k });
  const rule = ruleAt(s, k);
  if (rule) {
    if (depth > MAX_CHAIN) { events.push({ t: 'chain-limit', cell: k }); }
    else {
      if (!forced) unsetCell(s, k);
      rule.hits[owner]++;
      const shielded = group.filter(q => q.shield && q.owner === 'ai'), hit = group.filter(q => !shielded.includes(q));
      for (const q of group) q.shield = false;
      if (shielded.length) events.push({ t: 'shielded', pieces: shielded.map(q => q.id), cell: k });
      if (hit.length) {
        events.push({ t: 'trigger', p: owner, owner: rule.owner, pieces: hit.map(q => q.id), ruleId: rule.id, text: rule.text, label: rule.label, kind: rule.effect.kind, cell: k, chain: depth, self: rule.owner === owner });
        applyEffect(s, hit, rule.effect, dir, events, depth, chance);
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

function applyEffect(s: State, group: Piece[], e: Effect, dir: Dir, events: GameEvent[], depth: number, chance?: ChanceResolver) {
  const owner = group[0].owner;
  const from = key(group[0].x, group[0].y);
  if (e.kind === 'shove') {
    const d = e.dir === 'back' ? OPP[dir] : e.dir === 'forward' ? dir : COMPASS[e.dir];
    const v = DIRS[d];
    let x = group[0].x, y = group[0].y;
    for (let i = 0; i < e.amount && inside(x + v.x, y + v.y); i++) { x += v.x; y += v.y; }
    for (const q of group) { q.x = x; q.y = y; }
    events.push({ t: 'forced', pieces: group.map(q => q.id), from, to: key(x, y), how: 'shove' });
    if (key(x, y) !== from) land(s, group, d, events, depth + 1, true, chance);
  } else if (e.kind === 'home') {
    for (const q of group) { q.x = q.home.x; q.y = q.home.y; }
    events.push({ t: 'forced', pieces: group.map(q => q.id), from, to: group.map(q => key(q.x, q.y)).join('|'), how: 'home' });
  } else if (e.kind === 'teleport') {
    const opts = teleportDestinations(s, group[0]);
    if (opts.length) {
      let i: number;
      if (chance) { i = chance.teleport(opts); if (!Number.isInteger(i) || i < 0 || i >= opts.length) throw new Error(`chance resolver returned ${i} for ${opts.length} destinations`); }
      else i = rand(s) % opts.length;
      const t = parseKey(opts[i]);
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
  const p = s.current;
  return {
    ruleset: s.ruleset, board: { w: W, h: H, cols: COLS, noEffectRadius: NO_EFFECT_RADIUS },
    turn: s.turn, maxTurns: s.maxTurns, current: s.current, firstPlayer: s.firstPlayer, phase: s.phase, actionsLeft: s.actionsLeft, bonus: s.bonus,
    pieces: s.pieces.map(q => ({ ...q })), cells: s.cells, goalX: GOAL_X, winner: s.winner, winReason: s.winReason,
    rules: s.rules.filter(r => r.cells.length).map(r => ({ ...r })), scored: { human: scored(s, 'human'), ai: scored(s, 'ai') },
    active: { human: activeEffects(s, 'human'), ai: activeEffects(s, 'ai') },
    eligible: s.winner ? [] : eligibleCells(s, p),
    /** Why each other cell is not available to the player to move (piece / opponent-effect / near-opponent / near-own). */
    blocked: s.winner ? {} : blockedCells(s, p),
    noEffectRule: noEffectRule(s),
  };
}

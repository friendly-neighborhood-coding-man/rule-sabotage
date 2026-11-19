/**
 * Simulation-based opponent planner. It plans from the public state at the start of its
 * own turn (there is no hidden information in an alternating game: the human's turn is
 * already fully revealed). Every candidate is evaluated by running the real engine.
 */
import {
  type State, type Placement, type Move, type Piece, SIZE, GOAL_X, DIRS, key, parseKey, inside, cellName,
  applyPlacement, applyMove, endTurn, legalMoves, eligibleCells, ruleAt, onBoard, scored, validatePlacement, piecesOf,
} from './engine.ts';
import { type Player, type Effect, other, makeEffect, shortLabel, MAX_CELLS_PER_TURN } from './rules.ts';
import { type Weights, DEFAULT_WEIGHTS, effectUpkeep, plannerEffects, activationUtility } from './weights.ts';

/**
 * EXPERIMENT-ONLY planner hooks (Balance Designer V2). Each hook changes exactly one explanatory factor.
 * Production never passes hooks: with `hooks` undefined every code path below is the V1 planner
 * (tests/balance-v2.test.ts replays recorded V1 games and checks they reproduce exactly).
 *  - selfBenefitFactor (E2, valuation): multiplies the benefit a piece gets from a trap its OWN side installed,
 *    in the simulated path cost and in the V0.3 overlay's own-activation term. 1 = unchanged, 0 = ignored.
 *  - searchOwnBenefit (E3, placement search): false = candidate cells are scored only by harm to the opponent and
 *    harm to self; benefit to own pieces no longer makes a cell a candidate. Valuation is untouched.
 *  - blindRng (E5, information): the planner's look-ahead simulations use a perturbed copy of the engine RNG, so it
 *    can no longer foresee where a random effect (teleport) will send a piece. The real game RNG is untouched.
 *  - searchOwnBenefitFactor (V3, placement search, PARTIAL): benefit to own pieces counts only this fraction when a
 *    cell is scored as a trap candidate. 1 = unchanged, 0 = the same as searchOwnBenefit:false. Valuation untouched.
 *  - normalizedEval (V3, valuation under unequal piece counts): path costs and pieces across are compared as
 *    per-piece FRACTIONS (scaled to 3 pieces) instead of raw sums. For 3 v 3 it is exactly the production evaluation.
 */
export type PlannerHooks = { selfBenefitFactor?: number; searchOwnBenefit?: boolean; blindRng?: boolean; searchOwnBenefitFactor?: number; normalizedEval?: boolean };
const blind = (st: State, salt: number) => { let x = (st.rng ^ Math.imul(salt + 1, 0x85ebca6b) ^ 0x5bd1e995) >>> 0; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; st.rng = (x >>> 0) || 0x2545f491; };

export type TurnPlan = { placement: Placement | null; moves: Move[]; score: number; afterReply: number; summary: string; id: string };
export type Plan = { chosen: TurnPlan; ranked: TurnPlan[]; candidates: number; sims: number; ms: number };

const dist = (p: Player, x: number) => Math.abs(GOAL_X[p] - x);
const towardGoal = (p: Player) => (GOAL_X[p] > 0 ? DIRS.right : DIRS.left);

/** Turn-equivalent cost for a piece of `p` entering cell k (assuming it travels toward its goal). */
export function cellPenalty(s: State, p: Player, k: string, e?: Effect, w: Weights = DEFAULT_WEIGHTS): number {
  const eff = e ?? ruleAt(s, k)?.effect;
  if (!eff) return 0;
  void w; // the planner's path costs use the engine's own geometry; weights act through the placement overlay below
  return basePenalty(p, k, eff);
}
/** Unweighted geometric estimate from the engine's own geometry (no balance weight applied). */
export function basePenalty(p: Player, k: string, eff: Effect): number {
  const c = parseKey(k), here = dist(p, c.x);
  switch (eff.kind) {
    case 'shove': {
      const fwd = towardGoal(p);
      const v = eff.dir === 'back' ? { x: -fwd.x, y: 0 } : eff.dir === 'forward' ? fwd : DIRS[({ north: 'up', south: 'down', east: 'right', west: 'left' } as const)[eff.dir]];
      let x = c.x, y = c.y;
      for (let i = 0; i < eff.amount && inside(x + v.x, y + v.y); i++) { x += v.x; y += v.y; }
      return dist(p, x) - here + (v.y !== 0 ? 0.15 : 0);
    }
    case 'freeze': return 1.2;
    case 'home': return dist(p, GOAL_X[other(p)]) - here;
    case 'teleport': return 3 - here;
    case 'shield': return -0.3;
    case 'haste': return -0.8;
  }
}

/** Dijkstra: estimated actions for piece q to reach its goal column, traps priced in. */
export function pieceCost(s: State, q: Piece, w: Weights = DEFAULT_WEIGHTS, hooks?: PlannerHooks): number {
  if (q.scored) return 0;
  const p = q.owner;
  const best = new Map<string, number>([[key(q.x, q.y), 0]]);
  const done = new Set<string>();
  while (true) {
    let b = Infinity, node = '';
    for (const [k, d] of best) if (!done.has(k) && d < b) { b = d; node = k; }
    if (!node) return dist(p, q.x) + q.frozen;
    const { x, y } = parseKey(node);
    if (x === GOAL_X[p]) return b + q.frozen * 1.2 - (q.shield ? 0.3 : 0);
    done.add(node);
    for (const d of Object.values(DIRS)) {
      const nx = x + d.x, ny = y + d.y;
      if (!inside(nx, ny)) continue;
      const nk = key(nx, ny);
      let pen = cellPenalty(s, p, nk, undefined, w);
      if (hooks?.selfBenefitFactor !== undefined && pen < 0 && ruleAt(s, nk)?.owner === p) pen *= hooks.selfBenefitFactor;
      if (q.shield && pen > 0) pen = 0;
      const nd = b + Math.max(0.1, 1 + pen);
      if (nd < (best.get(nk) ?? Infinity)) best.set(nk, nd);
    }
  }
}

/** Positive = good for `me`. */
export function evaluate(s: State, me: Player, w: Weights = DEFAULT_WEIGHTS, hooks?: PlannerHooks): number {
  const opp = other(me);
  if (s.winner === me) return 1000;
  if (s.winner === opp) return -1000;
  if (s.winner === 'draw') return 0;
  const cost = (p: Player) => onBoard(s, p).reduce((a, q) => a + pieceCost(s, q, w, hooks), 0);
  if (hooks?.normalizedEval) { const n = (p: Player) => piecesOf(s, p) / 3; return cost(opp) / n(opp) - cost(me) / n(me) + w.planner.scoredBonus * (scored(s, me) / n(me) - scored(s, opp) / n(opp)); }
  return cost(opp) - cost(me) + w.planner.scoredBonus * (scored(s, me) - scored(s, opp));
}

/** Per-cell value of placing `e` for player p: expected harm to the opponent minus harm to self. */
export function bestCells(s: State, p: Player, e: Effect, w: Weights = DEFAULT_WEIGHTS, hooks?: PlannerHooks): string[] {
  const pieces = s.pieces.filter(q => !q.scored);
  const scoredCells = eligibleCells(s, p).filter(k => !ruleAt(s, k)).map(k => {
    const c = parseKey(k);
    let v = 0;
    for (const q of pieces) {
      const ahead = (GOAL_X[q.owner] - q.x) * (GOAL_X[q.owner] - c.x) >= 0 ? 1 : 0.3; // cells still in front of the piece
      const d = Math.abs(q.x - c.x) + Math.abs(q.y - c.y);
      const lateral = Math.abs(q.y - c.y);
      const wt = ahead / (1 + 0.6 * d + 0.8 * lateral);
      let pen = cellPenalty(s, q.owner, k, e, w);
      if (hooks?.searchOwnBenefit === false && q.owner === p) pen = Math.max(0, pen);
      else if (hooks?.searchOwnBenefitFactor !== undefined && q.owner === p && pen < 0) pen *= hooks.searchOwnBenefitFactor;
      v += (q.owner === p ? -w.planner.selfHarmFactor : 1) * wt * pen;
    }
    return { k, v };
  }).filter(o => o.v > 0.05).sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
  return scoredCells.slice(0, MAX_CELLS_PER_TURN).map(o => o.k).sort();
}

export const CANDIDATE_EFFECTS: Effect[] = [
  makeEffect('shove', 'back', 2), makeEffect('shove', 'back', 3), makeEffect('shove', 'west', 2), makeEffect('shove', 'east', 2),
  makeEffect('shove', 'north', 2), makeEffect('shove', 'south', 2), makeEffect('freeze'), makeEffect('home'), makeEffect('teleport'),
  makeEffect('haste'), makeEffect('shield'), makeEffect('shove', 'forward', 2),
];

function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; }

/** Greedy move sequence with the engine as simulator. Stops early if every move makes things worse. */
export function planMoves(s0: State, p: Player, noise = 0, rnd = Math.random, w: Weights = DEFAULT_WEIGHTS, hooks?: PlannerHooks): { moves: Move[]; state: State; sims: number } {
  let s = structuredClone(s0), sims = 0;
  const moves: Move[] = [];
  while (s.current === p && !s.winner && s.actionsLeft > 0) {
    const base = evaluate(s, p, w, hooks);
    let best: { m: Move; v: number; st: State } | null = null;
    for (const m of legalMoves(s, p)) {
      const t = structuredClone(s);
      if (hooks?.blindRng) blind(t, sims);
      applyMove(t, p, m); sims++;
      const v = evaluate(t, p, w, hooks) + (noise ? (rnd() - 0.5) * noise : 0);
      if (!best || v > best.v) best = { m, v, st: t };
    }
    if (!best || best.v < base - 0.25) break;
    moves.push(best.m); s = best.st;
  }
  return { moves, state: s, sims };
}

export function describeTurn(pl: Placement | null, moves: Move[]): string {
  const parts: string[] = [];
  if (pl) parts.push(`place “${shortLabel(pl.effect)}” on ${pl.cells.map(cellName).join(' ')}`);
  parts.push(moves.length ? `${moves.length} move${moves.length > 1 ? 's' : ''}: ${moves.map(m => `${cellName(m.from)}${({ up: '↑', down: '↓', left: '←', right: '→' })[m.dir]}${m.mode === 'single' ? '(one)' : ''}`).join(' ')}` : 'no moves');
  return parts.join(', then ');
}

/** Rule Space V0.3 §11: how much entering `pl`'s cells is expected to be worth to `p`, using signed activator utilities. */
function riskExposure(s: State, p: Player, x: number, y: number): number {
  let prob = 0;
  for (const q of s.pieces) {
    if (q.owner !== p || q.scored) continue;
    if ((GOAL_X[p] - q.x) * (GOAL_X[p] - x) < 0) continue;
    prob += 1 / (1 + 0.6 * Math.abs(q.x - x) + 0.8 * Math.abs(q.y - y));
  }
  return prob;
}
export function placementValue(s: State, p: Player, pl: Placement, w: Weights, hooks?: PlannerHooks): number {
  let v = 0;
  let own = activationUtility(pl.effect, p, w);
  if (hooks?.selfBenefitFactor !== undefined && own > 0) own *= hooks.selfBenefitFactor;
  for (const k of pl.cells) {
    const { x, y } = parseKey(k);
    v += -activationUtility(pl.effect, other(p), w) * riskExposure(s, other(p), x, y);
    v += own * riskExposure(s, p, x, y);
  }
  return v;
}

/** Plan a whole turn for `me` (default AI). */
export function planTurn(s: State, opts: { me?: Player; temperature?: number; weights?: Weights; hooks?: PlannerHooks } = {}): Plan {
  const t0 = performance.now();
  const w = opts.weights ?? DEFAULT_WEIGHTS, hooks = opts.hooks;
  const me = opts.me ?? 'ai', opp = other(me), temperature = opts.temperature ?? w.planner.temperature;
  const r = rng((s.seed ^ Math.imul(s.turn + 7, 0x9e3779b1)) >>> 0);
  const placements: (Placement | null)[] = [null];
  for (const e of plannerEffects(w)) {
    const cells = bestCells(s, me, e, w, hooks);
    if (!cells.length) continue;
    const pl: Placement = { text: 'planner', effect: e, cells, interpretedBy: 'planner' };
    if (validatePlacement(s, me, pl).ok) placements.push(pl);
  }
  let sims = 0;
  const ranked: TurnPlan[] = [];
  for (const pl of placements) {
    const st = structuredClone(s);
    if (hooks?.blindRng) blind(st, ranked.length + 101);
    if (pl) applyPlacement(st, me, pl);
    const mv = planMoves(st, me, 0.02, r, w, hooks); sims += mv.sims;
    const afterMine = mv.state;
    let afterReply = evaluate(afterMine, me, w, hooks);
    if (!afterMine.winner) {
      const rep = structuredClone(afterMine);
      endTurn(rep);
      if (!rep.winner && rep.current === opp) { const reply = planMoves(rep, opp, 0, Math.random, w, hooks); sims += reply.sims; afterReply = evaluate(reply.state, me, w, hooks); }
    }
    const upkeep = pl ? effectUpkeep(w, pl.effect) : 0;
    const overlay = pl && w.weightMix ? w.weightMix * placementValue(s, me, pl, w, hooks) : 0;
    ranked.push({ id: '', placement: pl, moves: mv.moves, score: evaluate(afterMine, me, w, hooks) * w.planner.immediateWeight + afterReply * w.planner.replyWeight - upkeep + overlay, afterReply, summary: describeTurn(pl, mv.moves) });
  }
  ranked.sort((a, b) => b.score - a.score || a.summary.localeCompare(b.summary));
  ranked.forEach((c, i) => { c.id = 'p' + (i + 1); });
  let chosen = ranked[0];
  const near = ranked.filter(c => c.score >= ranked[0].score - temperature);
  if (temperature > 0 && near.length > 1) {
    const w = near.map(c => Math.exp((c.score - ranked[0].score) / temperature * 2.5));
    let roll = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { roll -= w[i]; if (roll <= 0) { chosen = near[i]; break; } }
  }
  return { chosen, ranked, candidates: placements.length, sims, ms: Math.round(performance.now() - t0) };
}

// ---------- the AI's own words for its effects (offline mode). Every phrase must parse back to its effect. ----------
export function aiPhrase(e: Effect, pick: number): string {
  const lists: Record<string, string[]> = {
    shove: [`Any piece entering here gets shoved ${e.kind === 'shove' ? e.amount : 1} square${e.kind === 'shove' && e.amount > 1 ? 's' : ''} ${e.kind === 'shove' ? e.dir : ''}.`, `Step here and you are pushed ${e.kind === 'shove' ? e.amount : 1} ${e.kind === 'shove' && e.amount > 1 ? 'squares' : 'square'} ${e.kind === 'shove' ? e.dir : ''}. Nothing personal.`],
    freeze: ['Any piece entering here is frozen for one turn.', 'Step here and you freeze solid for a turn.'],
    home: ['Any piece entering here is sent back to its starting square.', 'Step here and go back to the start. Bye!'],
    teleport: ['Any piece entering here is teleported to a random square.', 'Step here and warp somewhere random. Good luck.'],
    shield: ['Any piece entering here gets a shield against the next trap.'],
    haste: ['Whoever steps here gets an extra move action.'],
  };
  const l = lists[e.kind];
  return l[Math.abs(pick) % l.length];
}
export { SIZE };

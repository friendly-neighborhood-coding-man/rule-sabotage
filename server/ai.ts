/**
 * Simulation-based opponent planner. It sees exactly the start-of-round State
 * (which never contains the human's pending action) and simulates every candidate
 * against a model of plausible human replies using the real engine.
 */
import {
  type State, type Action, type RuleAction, type Dir, type Pos, SIZE, GOAL_X, TRAP_MIN_X, TRAP_MAX_X,
  resolveRound, validateAction, eligibleCells, ruleAt, key, parseKey, inside, cellName, DIRS,
} from './engine.ts';
import { type Player, type Effect, other, maxCells, shortLabel, normalizeEffect } from './rules.ts';

export type Candidate = { id: string; action: Action; score: number; mean: number; worst: number; summary: string };
export type Plan = { chosen: Candidate; ranked: Candidate[]; scenarios: number; candidates: number; ms: number };

const MOVES: Dir[] = ['left', 'right', 'up', 'down', 'hold'];
const NO_ACTION_LOCAL = (s: State, p: Player): Action => ({ rule: { op: 'none' }, move: 'hold' });

/** Turn-equivalent cost of entering a trapped cell, from the stepping player's point of view. */
function trapPenalty(s: State, p: Player, k: string): number {
  const r = ruleAt(s, k);
  if (!r) return 0;
  const e = r.effect, { x } = parseKey(k), left = Math.abs(GOAL_X[p] - x);
  switch (e.kind) {
    case 'push': return e.amount * 1.1;
    case 'skip': return 1.05;
    case 'reverse': return 0.5;
    case 'shield': return -0.3;
    case 'teleport': return 3 - left;
    case 'swap': {
      const q = s.positions[other(p)];
      if (q.x < TRAP_MIN_X || q.x > TRAP_MAX_X) return 0;
      return Math.abs(GOAL_X[p] - q.x) - left;
    }
  }
}

/** Dijkstra: estimated turns for p to reach its goal column, treating traps as extra cost. */
export function pathCost(s: State, p: Player): number {
  const start = s.positions[p];
  if (start.x === GOAL_X[p]) return 0;
  const dist = new Map<string, number>([[key(start.x, start.y), 0]]);
  const done = new Set<string>();
  const shield = s.status[p].shield;
  while (true) {
    let best = Infinity, node = '';
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; node = k; }
    if (!node) break;
    const { x, y } = parseKey(node);
    if (x === GOAL_X[p]) return best + statusCost(s, p);
    done.add(node);
    for (const d of Object.values(DIRS)) {
      const nx = x + d.x, ny = y + d.y;
      if (!inside(nx, ny)) continue;
      const nk = key(nx, ny);
      let pen = trapPenalty(s, p, nk);
      if (shield && pen > 0) pen = 0;
      const nd = best + Math.max(0.15, 1 + pen);
      if (nd < (dist.get(nk) ?? Infinity)) dist.set(nk, nd);
    }
  }
  return Math.abs(GOAL_X[p] - start.x) + statusCost(s, p);
}
function statusCost(s: State, p: Player) {
  const st = s.status[p];
  return (st.skip ? 1 : 0) + (st.reverse ? 0.35 : 0) - (st.shield ? 0.5 : 0);
}

/** Positive is good for `me`. */
export function evaluate(s: State, me: Player): number {
  if (s.winner === me) return 1000 - s.round;
  if (s.winner === other(me)) return -1000 + s.round;
  if (s.winner === 'draw') return 0;
  return pathCost(s, other(me)) - pathCost(s, me);
}

/** Shortest-path "slack" field: 0 on a shortest path for p, larger off it. */
function slackField(s: State, p: Player): Map<string, number> {
  const from = bfs(s, s.positions[p]);
  const toGoal = new Map<string, number>();
  for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) toGoal.set(key(x, y), Math.abs(GOAL_X[p] - x));
  const best = Math.abs(GOAL_X[p] - s.positions[p].x);
  const out = new Map<string, number>();
  for (const [k, d] of from) out.set(k, d + toGoal.get(k)! - best + d * 0.35);
  return out;
}
function bfs(s: State, start: Pos): Map<string, number> {
  const m = new Map<string, number>([[key(start.x, start.y), 0]]), q: Pos[] = [start];
  while (q.length) {
    const c = q.shift()!, d = m.get(key(c.x, c.y))!;
    for (const v of Object.values(DIRS)) {
      const n = { x: c.x + v.x, y: c.y + v.y }, k = key(n.x, n.y);
      if (inside(n.x, n.y) && !m.has(k)) { m.set(k, d + 1); q.push(n); }
    }
  }
  return m;
}

const HARMFUL: Effect[] = [normalizeEffect('push', 2), normalizeEffect('skip'), normalizeEffect('push', 1), normalizeEffect('reverse'), normalizeEffect('teleport'), normalizeEffect('swap')];
const HELPFUL: Effect[] = [normalizeEffect('shield')];

/** Picks the best cells of this round's shape for `p` to place `effect` on. */
export function bestCells(s: State, p: Player, effect: Effect): string[] {
  const opp = other(p);
  const sOpp = slackField(s, opp), sMe = slackField(s, p);
  const helpful = effect.kind === 'shield';
  const scored = eligibleCells(s).map(c => {
    const hitOpp = 1 / (1 + (sOpp.get(c) ?? 9)), hitMe = 1 / (1 + (sMe.get(c) ?? 9));
    return { c, v: helpful ? hitMe - hitOpp * 1.1 : hitOpp - hitMe * 1.1 };
  }).filter(o => o.v > 0.02).sort((a, b) => b.v - a.v || a.c.localeCompare(b.c));
  return scored.slice(0, maxCells(effect)).map(o => o.c).sort();
}

/** Rule-phase options for player p: none, place/replace each effect on its best cells, remove a stale rule. */
export function ruleOptions(s: State, p: Player, effects: Effect[] = [...HARMFUL, ...HELPFUL]): RuleAction[] {
  const out: RuleAction[] = [{ op: 'none' }];
  if (s.status[p].skip) return out;
  const full = s.rules[p].length >= s.slots;
  let replaceSlot: number | undefined;
  if (full) {
    // Replace the rule with the fewest live squares (ties: the oldest).
    let bestIdx = 0;
    s.rules[p].forEach((r, i) => { const b = s.rules[p][bestIdx]; if (r.cells.length < b.cells.length || (r.cells.length === b.cells.length && r.round < b.round)) bestIdx = i; });
    replaceSlot = bestIdx;
  }
  for (const effect of effects) {
    const cells = bestCells(s, p, effect);
    if (!cells.length) continue;
    out.push({ op: 'place', text: '', effect, cells, interpretedBy: 'planner', ...(full ? { slot: replaceSlot } : {}) });
  }
  if (s.rules[p].length) {
    // Offer removing a rule that currently hurts its owner more than the opponent.
    const sOpp = slackField(s, other(p)), sMe = slackField(s, p);
    s.rules[p].forEach((r, i) => {
      if (r.effect.kind === 'shield') return;
      const net = r.cells.reduce((a, c) => a + 1 / (1 + (sOpp.get(c) ?? 9)) - 1 / (1 + (sMe.get(c) ?? 9)), 0);
      if (net < 0) out.push({ op: 'remove', slot: i });
    });
  }
  return out;
}

function legalActions(s: State, p: Player, rules: RuleAction[]): Action[] {
  if (s.status[p].skip) return [{ rule: { op: 'none' }, move: 'hold' }];
  const out: Action[] = [];
  for (const rule of rules) for (const move of MOVES) {
    const a: Action = { rule: rule.op === 'place' ? { ...rule, text: rule.text || 'planner' } : rule, move };
    if (validateAction(s, p, a).ok) out.push(a);
  }
  return out;
}

export function describeAction(a: Action): string {
  const r = a.rule;
  const mv = a.move === 'hold' ? 'hold position' : `move ${a.move}`;
  if (r.op === 'none') return mv;
  if (r.op === 'remove') return `remove rule in slot ${r.slot + 1}, ${mv}`;
  return `${r.slot !== undefined ? `replace slot ${r.slot + 1} with` : 'place'} "${shortLabel(r.effect)}" on ${r.cells.map(cellName).join(' ')}, ${mv}`;
}

/** Deterministic per-round RNG for tie-breaking/variety, independent of game RNG. */
function roundRng(seed: number, round: number) {
  let x = (seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; };
}

/**
 * Plan the AI's action from the public start-of-round state.
 * `temperature` controls variety among near-best options (0 = always best).
 */
export function planAI(s: State, opts: { temperature?: number; me?: Player } = {}): Plan {
  const t0 = performance.now();
  const me: Player = opts.me ?? 'ai', opp = other(me);
  const temperature = opts.temperature ?? 0.35;
  const mine = legalActions(s, me, ruleOptions(s, me));
  // Human reply model: every legal move, with no rule or one of their two most damaging traps.
  const theirRules = ruleOptions(s, opp, HARMFUL.slice(0, 3)).filter(r => r.op !== 'remove').slice(0, 3);
  const replies = legalActions(s, opp, theirRules);
  // Level-1 opponent model: replies that look good for the opponent are more likely.
  const weights = replies.map(r => {
    const acts = me === 'ai' ? { ai: NO_ACTION_LOCAL(s, me), human: r } : { human: NO_ACTION_LOCAL(s, me), ai: r };
    try { return evaluate(resolveRound(s, acts).state, opp); } catch { return -50; }
  });
  const top = Math.max(...weights);
  const w = weights.map(v => Math.exp((v - top) / 0.6));
  const wsum = w.reduce((a, b) => a + b, 0) || 1;
  const ranked: Candidate[] = [];
  for (const a of mine) {
    let mean = 0, worst = Infinity, any = false;
    replies.forEach((r, i) => {
      const acts = me === 'ai' ? { ai: a, human: r } : { human: a, ai: r };
      try { const v = evaluate(resolveRound(s, acts).state, me); mean += v * w[i] / wsum; worst = Math.min(worst, v); any = true; } catch { /* impossible combo */ }
    });
    if (!any) continue;
    // Small upkeep cost: a trap that changes nothing isn't worth a slot (prevents aimless placements).
    const upkeep = a.rule.op === 'place' ? 0.25 : a.rule.op === 'remove' ? 0.1 : 0;
    ranked.push({ id: '', action: a, mean, worst, score: mean * 0.7 + worst * 0.3 - upkeep, summary: describeAction(a) });
  }
  ranked.sort((x, y) => y.score - x.score || x.summary.localeCompare(y.summary));
  ranked.forEach((c, i) => { c.id = 'c' + (i + 1); });
  const rng = roundRng(s.seed, s.round);
  let chosen = ranked[0];
  if (temperature > 0 && ranked.length > 1) {
    const near = ranked.filter(c => c.score >= ranked[0].score - temperature);
    const w = near.map(c => Math.exp((c.score - ranked[0].score) / Math.max(temperature, 1e-6) * 3));
    let roll = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { roll -= w[i]; if (roll <= 0) { chosen = near[i]; break; } }
  }
  return { chosen: chosen ?? { id: 'c0', action: { rule: { op: 'none' }, move: 'hold' }, score: 0, mean: 0, worst: 0, summary: 'hold position' }, ranked, scenarios: replies.length, candidates: mine.length, ms: Math.round(performance.now() - t0) };
}

/** A diverse shortlist for the language model: best overall, best per rule-kind, best move-only. */
export function shortlist(plan: Plan, n = 8): Candidate[] {
  const out: Candidate[] = [], seen = new Set<string>();
  const tag = (c: Candidate) => c.action.rule.op === 'place' ? 'place:' + shortLabel(c.action.rule.effect) : c.action.rule.op;
  for (const c of plan.ranked) { const t = tag(c); if (!seen.has(t)) { seen.add(t); out.push(c); } if (out.length >= n) break; }
  for (const c of plan.ranked) { if (out.length >= n) break; if (!out.includes(c)) out.push(c); }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- the AI's own words for its traps (offline mode). Every phrase must parse back to its effect. ----------
export const AI_PHRASES: Record<string, string[]> = {
  'push2': ['Anyone stepping here gets shoved back two squares.', 'Step here and you get pushed back 2 spaces. Nothing personal.', 'Whoever lands here is knocked backward two squares.'],
  'push1': ['Anyone stepping here gets pushed back one square.', 'Step here, bounce back 1 space.', 'Whoever lands here is knocked back one square.'],
  'skip1': ['Anyone stepping here loses their next turn.', 'Whoever lands here falls asleep and skips a turn.', 'Step here and you are stunned for one turn.'],
  'reverse1': ['Anyone stepping here has their controls reversed for the next move.', 'Step here and your next move goes the opposite direction.'],
  'teleport1': ['Anyone stepping here is teleported to a random square.', 'Step here and warp somewhere random. Good luck.'],
  'swap1': ['Whoever steps here swaps places with the other player.', 'Step here and you trade places with your rival.'],
  'shield1': ['Whoever steps here gets a shield against the next trap.'],
};
export function aiPhrase(effect: Effect, pick: number): string {
  const list = AI_PHRASES[effect.kind + effect.amount] ?? AI_PHRASES[effect.kind + '1'];
  return list[Math.abs(pick) % list.length];
}

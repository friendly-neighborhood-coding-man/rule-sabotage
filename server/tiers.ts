/**
 * Referee tiers (feature flag REFEREE_TIERS=on; default off = every new rule goes to real Kane, as before).
 *
 *   Tier 1  engine     a supported, entry-independent effect with nothing nearby to interact with.
 *                      The trial's engine checks E1-E6 are the whole review.
 *   Tier 2  bounded    the effect can interact (teleport RNG, entry-relative shoves, effects nearby, chains)
 *           simulation but every interaction can be enumerated: each new cell is entered from EVERY side by a
 *                      lone Human piece and a lone AI piece, and the outcomes must match exactly.
 *   Tier 3  Kane       anything else: approximated requests, untestable cells, chains at the engine cap,
 *                      a near-softlock, or any extra simulation that does not come out clean.
 *
 * Selection is a pure function of the placement and the board, so it is reproducible and auditable, and it
 * is the same function for human and AI rules. It only ever escalates when unsure. Engine approvals are
 * labelled "engine-approved", never "Kane approved".
 *
 * Why the engine can stand in for Kane on tiers 1-2: Kane's six conditions are symmetry (E2), no re-fire (E3),
 * chain cap (E4), no softlock (E5), cell limit (E1), and "nothing permanently traps, targets one side or decides
 * the game". The last one holds by construction for the closed effect set in rules.ts (no permanent, targeted
 * or game-deciding kind exists), and E2/E5/E6 check it on the actual board.
 */
import { type State, type Placement, type Dir, key, parseKey, inside, cellName, MAX_CHAIN } from './engine.ts';
import { isEffect, MAX_CELLS_PER_TURN } from './rules.ts';
import { type Trial, enter, sameOutcome, withPlacement } from './trial.ts';

export type Tier = 1 | 2 | 3;
export type TierDecision = { tier: Tier; reasons: string[]; extraScenarios: number; ms: number };

export const tiersEnabled = () => process.env.REFEREE_TIERS === 'on';
/** Effect kinds this tier logic was written and tested for. A kind added to rules.ts later goes to Kane until it is reviewed here. */
export const TIER_REVIEWED_KINDS = ['shove', 'freeze', 'home', 'teleport', 'shield', 'haste'] as const;
/** Manhattan distance within which an existing effect counts as a possible interaction (max shove 3, plus one step). */
export const INTERACTION_RADIUS = 4;

const SIDES: [number, number, Dir][] = [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down'], [0, 1, 'up']];

export function selectTier(s: State, proposer: State['current'], pl: Placement, trial: Trial): TierDecision {
  const t0 = performance.now();
  const up: string[] = [], mid: string[] = [];
  const done = (tier: Tier, reasons: string[], extra = 0): TierDecision => ({ tier, reasons, extraScenarios: extra, ms: Math.round(performance.now() - t0) });

  // ---- conservative escalations straight to Kane ----
  if (!trial.engineChecks.every(c => c.pass)) up.push('an engine check failed');
  if (!isEffect(pl.effect)) up.push('effect is not in the engine’s supported set');
  else if (!(TIER_REVIEWED_KINDS as readonly string[]).includes(pl.effect.kind)) up.push(`effect kind “${pl.effect.kind}” has not been reviewed for engine-only approval`);
  if (pl.approxNote) up.push('the request was approximated');
  if (pl.cells.length < 1 || pl.cells.length > MAX_CELLS_PER_TURN) up.push('cell count outside the limit');
  if (trial.symmetry.length !== pl.cells.length) up.push('a new cell could not be entered in the trial');
  if (trial.chains.some(c => c.length >= MAX_CHAIN)) up.push(`a chain reaches the engine cap (${MAX_CHAIN})`);
  if (trial.rollout.longestStuck.human > 0 || trial.rollout.longestStuck.ai > 0) up.push('the rollout shows a player with no legal move');
  if (up.length) return done(3, up);

  // ---- does anything need the bounded simulation? ----
  const e = pl.effect;
  if (e.kind === 'teleport') mid.push('random destination (seeded RNG)');
  if (e.kind === 'shove' && (e.dir === 'back' || e.dir === 'forward')) mid.push('direction depends on how the piece enters');
  if (trial.chains.length) mid.push('chain reactions with existing effects');
  const near = s.rules.filter(r => r.cells.some(c => pl.cells.some(n => { const a = parseKey(c), b = parseKey(n); return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= INTERACTION_RADIUS; }))).length;
  if (near) mid.push(`${near} existing effect(s) within ${INTERACTION_RADIUS} squares`);
  if (!mid.length) return done(1, ['supported effect, absolute or no movement, nothing nearby to interact with; engine checks E1–E6 passed']);

  // ---- tier 2: enter every new cell from every side, Human vs AI ----
  const h = withPlacement(s, proposer, pl);
  const rule = h.rules[h.rules.length - 1];
  let extra = 0;
  for (const cell of rule.cells) {
    const c = parseKey(cell);
    let tested = 0;
    for (const [dx, dy, dir] of SIDES) {
      const fx = c.x + dx, fy = c.y + dy;
      if (!inside(fx, fy)) continue;
      const from = key(fx, fy);
      const hu = enter(h, 'human', from, dir, rule.id, cell), ai = enter(h, 'ai', from, dir, rule.id, cell);
      extra++; tested++;
      if (!hu.out.fired || !ai.out.fired) return done(3, [...mid, `bounded simulation: entering ${cellName(cell)} from ${cellName(from)} did not fire`], extra);
      if (!sameOutcome(hu.out, ai.out)) return done(3, [...mid, `bounded simulation: Human and AI differ entering ${cellName(cell)} from ${cellName(from)}`], extra);
      if (hu.secondVisitFired || ai.secondVisitFired) return done(3, [...mid, `bounded simulation: ${cellName(cell)} fired twice`], extra);
      if (Math.max(hu.out.chain.length, ai.out.chain.length) >= MAX_CHAIN) return done(3, [...mid, `bounded simulation: chain reaches the cap from ${cellName(from)}`], extra);
    }
    if (!tested) return done(3, [...mid, `bounded simulation: ${cellName(cell)} cannot be entered`], extra);
  }
  return done(2, [...mid, `bounded simulation: ${extra} entries (every side of every new cell, Human and AI) matched exactly`], extra);
}

/**
 * V4.2 manipulation checks: does each single-factor variant actually change the behaviour it targets?
 * Pure planner calls on positions; no game is played.
 *
 *  K1 sideRelativeOrder  : mirror mismatches (a position vs its left-right mirror with sides swapped) must drop to 0;
 *                          how often it changes the chosen plan / next moves relative to E0 (default).
 *  K2 placementAwareReply: how often the predicted after-reply value changes, how much closer it gets to the value
 *                          after the opponent's REAL reply (default EV opponent with placement), and how often the
 *                          CHOSEN plan changes. Better prediction is not assumed to change actions.
 *  K3 truncatedCandidates: how often a hold-back candidate is chosen (at temperature 0).
 *
 * Positions: recorded turn starts from the V4 pilot (arms A, B, C; a different sampling offset than V4.1's sample),
 * plus synthetic positions reached by seeded random legal play (placements on random eligible cells).
 */
import { type State, type Move, init, applyPlacement, applyMove, endTurn, legalMoves, eligibleCells, validatePlacement } from '../../engine.ts';
import { type Player } from '../../rules.ts';
import { loadWeights, plannerEffects, effectId } from '../../weights.ts';
import { planTurnEV, nextMovesEV, type EVVariant } from './evplanner.ts';
import { loadRecs, positions, mirror } from './diagnose.ts';
import { xorshift, r3, mean } from '../v3/stats.ts';
import { evaluate } from '../../ai.ts';

const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
export type Pos = { id: string; s: State; p: Player };

export function recordedPositions(dir: string, n: number, offset = 3, every = 11): Pos[] {
  const out: Pos[] = [];
  for (const r of loadRecs(dir)) positions(r.rec).forEach((x, i) => { if (!x.s.winner && (i + offset) % every === 0) out.push({ id: `${r.gameId}@t${x.turn}`, s: x.s, p: x.p }); });
  const step = Math.max(1, Math.floor(out.length / n));
  return out.filter((_, i) => i % step === 0).slice(0, n);
}
/** Seeded random legal play: random placement (sometimes none) on random eligible cells, then random legal moves. */
export function syntheticPositions(n: number, seed = 424242): Pos[] {
  const rnd = xorshift(seed), w = loadWeights(), effects = plannerEffects(w), out: Pos[] = [];
  for (let g = 0; out.length < n; g++) {
    const s = init(880000 + g, { first: rnd() < 0.5 ? 'human' : 'ai' });
    const turns = 1 + Math.floor(rnd() * 9);
    for (let t = 0; t < turns && !s.winner; t++) {
      const p = s.current;
      if (rnd() < 0.7) { const cells = eligibleCells(s, p).sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3)); const pl = { text: 'x', effect: effects[Math.floor(rnd() * effects.length)], cells, interpretedBy: 'synthetic' }; if (cells.length && validatePlacement(s, p, pl).ok) applyPlacement(s, p, pl); }
      if (s.phase === 'place') s.phase = 'move';
      for (let k = 0; k < 4 && !s.winner && s.current === p; k++) { const ms = legalMoves(s, p); if (!ms.length) break; applyMove(s, p, ms[Math.floor(rnd() * ms.length)]); }
      if (!s.winner) endTurn(s);
    }
    if (!s.winner) { s.phase = 'place'; out.push({ id: `synthetic-${g}`, s, p: s.current }); }
  }
  return out;
}

const sigMoves = (ms: Move[]) => JSON.stringify(ms);
const plan = (s: State, p: Player, v: EVVariant) => planTurnEV(s, { me: p, weights: loadWeights(), temperature: 0, variant: v });
const chosenSig = (c: ReturnType<typeof plan>['chosen']) => JSON.stringify([c.placement ? [effectId(c.placement.effect), [...c.placement.cells].sort()] : null, c.moves]);
const mvState = (s: State) => (s.phase === 'place' ? { ...structuredClone(s), phase: 'move' as const } : s);

/** K1: mirror mismatches with and without the variant, and behaviour change vs E0. */
export function checkK1(ps: Pos[]) {
  const w = loadWeights();
  let mmBase = 0, mmK1 = 0, changed = 0;
  const mk = (m: Move): Move => { const [x, y] = m.from.split(',').map(Number); return { from: `${6 - x},${y}`, dir: m.dir === 'left' ? 'right' : m.dir === 'right' ? 'left' : m.dir, mode: m.mode }; };
  for (const { s, p } of ps) {
    const m = mirror(s), q = other(p);
    for (const [v, inc] of [[{}, () => mmBase++], [{ sideRelativeOrder: true }, () => mmK1++]] as const) {
      const a = nextMovesEV(mvState(s), p, w, v).moves, b = nextMovesEV(mvState(m), q, w, v).moves;
      const pa = plan(s, p, v), pb = plan(m, q, v);
      if (sigMoves(a.map(mk)) !== sigMoves(b) || Math.abs(pa.chosen.score - pb.chosen.score) > 1e-6) inc();
    }
    if (sigMoves(nextMovesEV(mvState(s), p, w, {}).moves) !== sigMoves(nextMovesEV(mvState(s), p, w, { sideRelativeOrder: true }).moves) || chosenSig(plan(s, p, {}).chosen) !== chosenSig(plan(s, p, { sideRelativeOrder: true }).chosen)) changed++;
  }
  return { positions: ps.length, mirrorMismatchE0: mmBase, mirrorMismatchK1: mmK1, behaviourChangedVsE0: changed, behaviourChangedRate: r3(changed / ps.length) };
}

/** Value for `p` after the default EV opponent really replies (placement included) to the chosen plan. */
function realReply(s: State, p: Player, c: ReturnType<typeof plan>['chosen']) {
  const w = loadWeights(), st = structuredClone(s);
  if (c.placement && validatePlacement(st, p, c.placement).ok) applyPlacement(st, p, c.placement);
  st.phase = 'move';
  for (const m of c.moves) { if (st.winner || st.current !== p) break; applyMove(st, p, m, { teleport: () => 0 }); }
  if (!st.winner) endTurn(st);
  if (!st.winner && st.current === other(p)) { const rp = planTurnEV(st, { me: other(p), weights: w, temperature: 0 }); if (rp.chosen.placement && validatePlacement(st, other(p), rp.chosen.placement).ok) applyPlacement(st, other(p), rp.chosen.placement); st.phase = 'move'; for (const m of nextMovesEV(st, other(p), w).moves) { if (st.winner) break; applyMove(st, other(p), m, { teleport: () => 0 }); } }
  return evaluate(st, p, w);
}
/** K2: prediction change, prediction error against the real reply, and action change. */
export function checkK2(ps: Pos[]) {
  let predChanged = 0, actionChanged = 0; const errE0: number[] = [], errK2: number[] = [];
  for (const { s, p } of ps) {
    const a = plan(s, p, {}), b = plan(s, p, { placementAwareReply: true });
    if (Math.abs(a.chosen.afterReply - b.chosen.afterReply) > 1e-6) predChanged++;
    if (chosenSig(a.chosen) !== chosenSig(b.chosen)) actionChanged++;
    // prediction accuracy for the SAME plan (E0's choice), so only the opponent model differs
    const sameInB = b.ranked.find(c => chosenSig(c) === chosenSig(a.chosen)) ?? b.chosen;
    const real = realReply(s, p, a.chosen);
    if (Math.abs(real) < 500) { errE0.push(Math.abs(a.chosen.afterReply - real)); errK2.push(Math.abs(sameInB.afterReply - real)); }
  }
  return { positions: ps.length, predictionChanged: predChanged, chosenPlanChanged: actionChanged, chosenPlanChangedRate: r3(actionChanged / ps.length), meanAbsPredictionErrorE0: r3(mean(errE0)), meanAbsPredictionErrorK2: r3(mean(errK2)), comparedPositions: errE0.length };
}
/** K3: how often a hold-back candidate is chosen. */
export function checkK3(ps: Pos[]) {
  let chosen = 0, offered = 0; const kept: number[] = [];
  for (const { s, p } of ps) {
    const b = plan(s, p, { truncatedCandidates: true });
    if (b.ranked.some(c => (c as { holdBack?: boolean }).holdBack)) offered++;
    if ((b.chosen as { holdBack?: boolean }).holdBack) { chosen++; kept.push(b.chosen.moves.length); }
  }
  return { positions: ps.length, holdBackOffered: offered, holdBackChosen: chosen, holdBackChosenRate: r3(chosen / ps.length), meanMovesWhenHoldingBack: kept.length ? r3(mean(kept)) : null };
}

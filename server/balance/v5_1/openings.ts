/**
 * V5.1 workstream D: why turn 1 is fixed, and wider legal opening candidates (no game played).
 *
 * scorePlacement11 scores ANY placement exactly as ev-k1.1 scores its own candidates (same move model, ends, strata,
 * reply and score formula); a test checks it reproduces planTurn11's scores for planTurn11's own candidates.
 *
 * openingCandidatesV2 widens the candidate set while staying legal and purposeful (no random filler):
 *  - per effect, the top-3 cells (current generator), plus every 1- and 2-cell subset of its top-4 cells, plus the
 *    top-3 cells restricted to each own piece's lane (cells in front of one piece);
 *  - "no placement" stays a candidate.
 * A candidate counts as a genuine alternative only if its ev-k1.1 score is within the reference's measured prediction
 * error band (T = 1.3255) of the best; poor moves are reported but never counted as coverage.
 */
import { type State, type Placement, applyPlacement, endTurn, validatePlacement, eligibleCells, ruleAt, parseKey } from '../../engine.ts';
import { type Player, other } from '../../rules.ts';
import { type Weights, DEFAULT_WEIGHTS, effectUpkeep, plannerEffects, effectId } from '../../weights.ts';
import { placementValue } from '../../ai.ts';
import { maskHidden, evaluateCached, newCtx, REPLY_STRATA, type Ctx } from '../v4/evplanner.ts';
import { greedy11, ownEnds11, stratify11, symBestCells, flipEW, candidatePlacements, rCell, K1 } from '../v5/evk11.ts';

export const BAND = 2.651 / 2;
function reply(s: State, me: Player, ctx: Ctx) {
  if (s.winner) return evaluateCached(s, me, ctx);
  const rep = structuredClone(s); endTurn(rep);
  const opp = other(me);
  if (rep.winner || rep.current !== opp) return evaluateCached(rep, me, ctx);
  const r = greedy11(rep, opp, ctx);
  return r.pending ? r.pending.reduce((a, o) => a + o.p * evaluateCached(o.state, me, ctx), 0) : evaluateCached(r.state!, me, ctx);
}
export function scorePlacement11(s0: State, me: Player, pl: Placement | null, w: Weights = DEFAULT_WEIGHTS, ctx?: Ctx) {
  const s = maskHidden(s0), c = ctx ?? (() => { const x = newCtx(w, REPLY_STRATA, K1); x.me = me; return x; })();
  const st = structuredClone(s); if (pl) applyPlacement(st, me, pl); if (st.phase === 'place') st.phase = 'move';
  const first = greedy11(st, me, c), ends = ownEnds11(st, me, c);
  const immediate = ends.reduce((a, e) => a + e.p * e.v, 0);
  const afterReply = stratify11(ends, me, REPLY_STRATA).reduce((a, e) => a + e.p * reply(e.state, me, c), 0);
  const upkeep = pl ? effectUpkeep(w, pl.effect) : 0, overlay = pl && w.weightMix ? w.weightMix * placementValue(s, me, pl, w) : 0;
  return { score: immediate * w.planner.immediateWeight + afterReply * w.planner.replyWeight - upkeep + overlay, parts: { immediate, afterReply, upkeep, overlay }, moves: first.moves.length, endsAtChance: !!first.pending };
}
const subsets = <T>(xs: T[], k: number): T[][] => (k === 0 ? [[]] : xs.flatMap((x, i) => subsets(xs.slice(i + 1), k - 1).map(r => [x, ...r])));
export function openingCandidatesV2(s: State, me: Player, w: Weights = DEFAULT_WEIGHTS): { pl: Placement | null; origin: string }[] {
  const out = new Map<string, { pl: Placement | null; origin: string }>();
  const add = (pl: Placement | null, origin: string) => { const k = pl ? `${effectId(pl.effect)}@${[...pl.cells].sort().join(' ')}` : 'none'; if (!out.has(k) && (!pl || validatePlacement(s, me, pl).ok)) out.set(k, { pl, origin }); };
  for (const pl of candidatePlacements(s, me, w)) add(pl, 'v1 (current generator)');
  const lanes = [...new Set(s.pieces.filter(q => q.owner === me && !q.scored).map(q => q.y))];
  for (const e of me === 'ai' ? plannerEffects(w).map(flipEW) : plannerEffects(w)) {
    const top4 = symBestCells4(s, me, e, w);
    for (const k of [1, 2]) for (const cells of subsets(top4, k)) add({ text: 'planner', effect: e, cells: cells.sort(), interpretedBy: 'planner' }, `${k}-cell subset of top 4`);
    for (const y of lanes) { const cells = top4.length ? lane(s, me, e, w, y) : []; if (cells.length) add({ text: 'planner', effect: e, cells, interpretedBy: 'planner' }, `lane ${y + 1}`); }
  }
  return [...out.values()];
}
/** The same per-cell value as symBestCells, but returning the top 4 (and, for lanes, filtered to one row). */
function ranked(s: State, me: Player, e: Placement['effect'], w: Weights, filter: (k: string) => boolean, n: number) {
  // reuse symBestCells' value by asking for each single cell: rank by symBestCells on a board where only that cell is free is
  // too slow; instead compute via the same public formula through symBestCells on candidate cells in turn.
  const free = eligibleCells(s, me).filter(k => !ruleAt(s, k) && filter(k));
  const vals = free.map(k => ({ k, v: cellValue(s, me, e, w, k) })).filter(o => o.v > 0.05).sort((a, b) => (Math.abs(b.v - a.v) < 1e-7 ? 0 : b.v - a.v) || (rCell(me, a.k) < rCell(me, b.k) ? -1 : 1));
  return vals.slice(0, n).map(o => o.k);
}
import { cellPenalty } from '../../ai.ts';
import { GOAL_X } from '../../engine.ts';
function cellValue(s: State, p: Player, e: Placement['effect'], w: Weights, k: string) {
  const c = parseKey(k); let v = 0;
  for (const q of s.pieces.filter(q => !q.scored)) { const ahead = (GOAL_X[q.owner] - q.x) * (GOAL_X[q.owner] - c.x) >= 0 ? 1 : 0.3; const d = Math.abs(q.x - c.x) + Math.abs(q.y - c.y), lat = Math.abs(q.y - c.y); v += (q.owner === p ? -w.planner.selfHarmFactor : 1) * (ahead / (1 + 0.6 * d + 0.8 * lat)) * cellPenalty(s, q.owner, k, e, w); }
  return v;
}
const symBestCells4 = (s: State, me: Player, e: Placement['effect'], w: Weights) => ranked(s, me, e, w, () => true, 4);
const lane = (s: State, me: Player, e: Placement['effect'], w: Weights, y: number) => ranked(s, me, e, w, k => parseKey(k).y === y, 3).sort();
void symBestCells;

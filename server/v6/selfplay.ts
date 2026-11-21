/**
 * V6 self-play of the forked policies (EXPERIMENTAL-V6-NOT-PRODUCTION). Small, explicit measurements only (turn-limit
 * evidence, smoke checks, tests); this is not a balance study and its numbers are never V5.3 claims.
 * Both sides use aiTurnV6, i.e. the same referee and executor as the playable game.
 */
import { type State, type Placement, init, legalMoves, scored, distanceLeft, W } from './engine.ts';
import { type Player } from '../rules.ts';
import { loadWeights } from '../weights.ts';
import { aiTurnV6, type AITurn, type Policy53 } from './turn.ts';

export const HOLDOUT = { from: 65001, to: 65060 } as const;
export const isHoldout = (seed: number) => seed >= HOLDOUT.from && seed <= HOLDOUT.to;

export type V6TurnRow = { turn: number; p: Player; moves: number; placed: boolean; blocked: string | null; zero: AITurn['zeroMoves']; ms: number; protectedCells: number; eligibleCells: number; candidates: number; budgetHit: boolean };
export type V6Game = {
  seed: number; first: Player; policies: Record<Player, Policy53>; maxTurns: number;
  winner: Player | 'draw'; reason: string; turns: number; turnLimit: boolean; scored: Record<Player, number>; distanceLeft: Record<Player, number>;
  /** Turn on which each side scored its k-th piece (null = never). */
  scoreTurns: Record<Player, (number | null)[]>; rows: V6TurnRow[]; ms: number; maxDecisionMs: number;
};

export async function playGameV6(seed: number, policies: Record<Player, Policy53>, opts: { first?: Player; maxTurns?: number; onTurn?: (r: V6TurnRow, s: State) => void } = {}): Promise<V6Game> {
  if (isHoldout(seed)) throw new Error(`seed ${seed} is in the reserved holdout range`);
  const w = loadWeights();
  const s = init(seed, { first: opts.first, maxTurns: opts.maxTurns });
  const rows: V6TurnRow[] = [];
  const scoreTurns: Record<Player, (number | null)[]> = { human: [null, null, null], ai: [null, null, null] };
  const t0 = performance.now();
  let maxDecisionMs = 0;
  while (!s.winner) {
    const p = s.current, turn = s.turn, before = { human: scored(s, 'human'), ai: scored(s, 'ai') };
    const a = performance.now();
    const r = await aiTurnV6(s, p, policies[p], w);
    const ms = Math.round(performance.now() - a);
    maxDecisionMs = Math.max(maxDecisionMs, r.plannerMs);
    for (const q of ['human', 'ai'] as Player[]) for (let k = before[q]; k < scored(s, q); k++) scoreTurns[q][k] = turn;
    const row: V6TurnRow = { turn, p, moves: r.moves.length, placed: !!r.verdict?.activated, blocked: r.placementBlocked, zero: r.zeroMoves, ms, protectedCells: r.protectedCells, eligibleCells: r.eligibleCells, candidates: r.candidatePlacements, budgetHit: !!r.plan?.meta.budgetHit };
    rows.push(row); opts.onTurn?.(row, s);
    if (r.error && !r.moves.length && rows.filter(x => x.zero?.kind === 'planner-error').length > 3) throw new Error(`repeated planner errors: ${r.error}`);
  }
  return {
    seed, first: s.firstPlayer, policies, maxTurns: s.maxTurns, winner: s.winner, reason: s.winReason, turns: s.turn, turnLimit: /Turn limit/.test(s.winReason),
    scored: { human: scored(s, 'human'), ai: scored(s, 'ai') }, distanceLeft: { human: distanceLeft(s, 'human'), ai: distanceLeft(s, 'ai') },
    scoreTurns, rows, ms: Math.round(performance.now() - t0), maxDecisionMs,
  };
}
export { W, legalMoves };
export type { Placement };

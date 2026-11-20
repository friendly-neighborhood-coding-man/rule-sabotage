/**
 * V5.2 Phase 3: why do the four wider-generator openings outscore the original, and are they conveyor rushes?
 * Simulates turn 1 (placement + the ev-k1.1 executor's moves) and the opponent's ev-k1.1 turn 2 from the start position.
 * No game is played; teleports resolve with a fixed example index (none occur in these lines).
 *   npm run balance:v52:openings-check -> evidence/balance/v5_2/openings-check.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { init, applyPlacement, applyMove, endTurn, GOAL_X, type State, type Placement } from '../server/engine.ts';
import { makeEffect } from '../server/rules.ts';
import { loadWeights } from '../server/weights.ts';
import { evaluate } from '../server/ai.ts';
import { nextMoves11, planTurn11 } from '../server/balance/v5/evk11.ts';
import { scorePlacement11 } from '../server/balance/v5_1/openings.ts';
const w = loadWeights();
const C = (cells: string[], e: Placement['effect']): Placement => ({ text: 'planner', effect: e, cells, interpretedBy: 'planner' });
const lines: Record<string, Placement> = {
  'original: Shove east 2 @ B2 B4 B6': C(['1,1', '1,3', '1,5'], makeEffect('shove', 'east', 2)),
  'new: Shove forward 2 @ lane 4 (B4 C4 D4)': C(['1,3', '2,3', '3,3'], makeEffect('shove', 'forward', 2)),
  'new: Shove forward 2 @ lane 2 (B2 C2 D2)': C(['1,1', '2,1', '3,1'], makeEffect('shove', 'forward', 2)),
  'new: Shove forward 2 @ lane 6 (B6 C6 D6)': C(['1,5', '2,5', '3,5'], makeEffect('shove', 'forward', 2)),
  'new: +1 action @ lane 2 (B2 C2 D2)': C(['1,1', '2,1', '3,1'], makeEffect('haste')),
};
const dist = (s: State, p: 'human' | 'ai') => s.pieces.filter(q => q.owner === p && !q.scored).reduce((a, q) => a + Math.abs(GOAL_X[p] - q.x), 0);
const rows: unknown[] = [];
for (const [name, pl] of Object.entries(lines)) {
  const s = init(99651, { first: 'human' }), sc = scorePlacement11(s, 'human', pl, w);
  const before = dist(s, 'human');
  applyPlacement(s, 'human', pl); s.phase = 'move';
  let triggers = 0, selfTriggers = 0, maxChain = 0, scoredT1 = 0, movesT1 = 0;
  for (let guard = 0; guard < 10 && s.current === 'human' && !s.winner && s.actionsLeft > 0; guard++) {
    const mv = nextMoves11(s, 'human', w).moves; if (!mv.length) break;
    for (const m of mv) { movesT1++; for (const e of applyMove(s, 'human', m, { teleport: () => 0 })) { if (e.t === 'trigger') { triggers++; if (e.self) selfTriggers++; maxChain = Math.max(maxChain, e.chain); } if (e.t === 'score') scoredT1 += e.pieces.length; } if (s.winner) break; }
  }
  const afterT1 = dist(s, 'human'), unusedT1 = s.actionsLeft;
  endTurn(s);
  const rep = planTurn11(s, { me: 'ai', weights: w, temperature: 0 });
  if (rep.chosen.placement) applyPlacement(s, 'ai', rep.chosen.placement); s.phase = 'move';
  let captures = 0; for (const m of nextMoves11(s, 'ai', w).moves) { for (const e of applyMove(s, 'ai', m, { teleport: () => 0 })) if (e.t === 'capture') captures += e.pieces.length; if (s.winner) break; }
  rows.push({ line: name, score: +sc.score.toFixed(3), parts: Object.fromEntries(Object.entries(sc.parts).map(([k, v]) => [k, +(v as number).toFixed(2)])), turn1: { movesPlayed: movesT1, unusedActions: unusedT1, squaresGained: before - afterT1, piecesScored: scoredT1, trapTriggers: triggers, ownTrapTriggers: selfTriggers, longestChain: maxChain }, turn2Reply: { placement: rep.chosen.summary, capturesOfOurPieces: captures }, evalForFirstMoverAfterTurn2: +evaluate(s, 'human', w).toFixed(2) });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
writeFileSync(join(ROOT, 'evidence/balance/v5_2/openings-check.json'), JSON.stringify({ newGamesPlayed: 0, note: 'two-turn simulation from the start position; a higher heuristic score is not evidence of a better or more enjoyable opening', rows }, null, 2));

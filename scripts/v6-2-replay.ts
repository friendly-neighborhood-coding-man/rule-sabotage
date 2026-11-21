/**
 * V6.2 investigation, step 1 (EXPERIMENTAL). Re-plays the six existing V6.1 smoke games (seed 96001, both first movers,
 * each policy against itself; deterministic, so they reproduce evidence/v6/v6-1-smoke.json) and records
 *  - the position before every opponent decision that took >= 8 s (for profiling), and
 *  - every AI placement attempt with its full referee verdict (for the referee-rejection breakdown).
 * Not a new experiment: same seeds, same games. Output: evidence/v6/v6-2-replay.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { init, RULESET_V61, type State } from '../server/v6/engine.ts';
import { aiTurnV6 } from '../server/v6/turn.ts';
import { loadWeights } from '../server/weights.ts';
import { ROOT } from './v6-fork.ts';
import type { Policy53 } from '../server/v6/forks/policies53.ts';

const W8 = loadWeights();
const out: { game: string; turn: number; p: string; policy: Policy53; plannerMs: number; state: State }[] = [];
const games: { policy: Policy53; first: string; turns: number; winner: string; ms: number }[] = [];
const attempts: unknown[] = [];
for (const policy of ['softmax-v2', 'ev-k1.2', 'oa-v3'] as Policy53[]) for (const first of ['human', 'ai'] as const) {
  const s = init(96001, { first, ruleset: RULESET_V61 }), t0 = Date.now();
  while (!s.winner) {
    const before = structuredClone(s), p = s.current;
    const r = await aiTurnV6(s, p, policy, W8);
    if (r.verdict) attempts.push({ game: `${policy}/96001/${first}-first`, turn: before.turn, p, final: r.verdict.final, stage: r.verdict.stage, code: r.verdict.code, tier: r.verdict.tier, label: r.verdict.label, cells: r.verdict.cells, message: r.verdict.message, eligible: r.eligibleCells, candidates: r.candidatePlacements });
    if (r.plannerMs >= 8000) { out.push({ game: `${policy}/96001/${first}-first`, turn: before.turn, p, policy, plannerMs: r.plannerMs, state: before }); console.log(policy, 'turn', before.turn, p, r.plannerMs, 'ms'); }
  }
  games.push({ policy, first, turns: s.turn, winner: s.winner, ms: Date.now() - t0 });
  console.log(policy, 'game done', s.turn, s.winner);
}
mkdirSync(join(ROOT, 'evidence/v6'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/v6/v6-2-replay.json'), JSON.stringify({ schema: 'rule-sabotage/v6-2-replay@1', ruleset: RULESET_V61, thresholdMs: 8000, games, attempts, positions: out }, null, 1) + '\n');

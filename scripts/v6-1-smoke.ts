/**
 * V6.1 gameplay smoke (EXPERIMENTAL). 6 games: each forked policy against itself under rule A2, seed 96001, both first
 * movers. The same seeds/first movers were played under V6 (A1) in evidence/v6/turn-limit.json, so each game has a paired
 * V6 counterpart. A smoke check of how A2 changes play, NOT a balance study. Run once: npm run v6.1:smoke
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { playGameV6 } from '../server/v6/selfplay.ts';
import { RULESET_V61, init, protectedCells } from '../server/v6/engine.ts';
import { POLICIES53 } from '../server/v6/forks/policies53.ts';
import { ROOT } from './v6-fork.ts';
import type { Player } from '../server/rules.ts';

const v6 = JSON.parse(readFileSync(join(ROOT, 'evidence/v6/turn-limit.json'), 'utf8'));
const rows = [];
for (const pol of POLICIES53) for (const first of ['human', 'ai'] as Player[]) {
  let chains = 0, selfTriggers = 0, triggers = 0;
  const g = await playGameV6(96001, { human: pol, ai: pol }, { first, ruleset: RULESET_V61 });
  const base = v6.games.find((x: any) => x.seed === 96001 && x.first === first && x.policy === pol);
  const rs = g.rows;
  const row = {
    policy: pol, first, v61: { winner: g.winner, turns: g.turns, turnLimit: g.turnLimit, firstAcross: Math.min(...(['human', 'ai'] as Player[]).map(p => g.scoreTurns[p][0] ?? 99)), placements: rs.filter(r => r.placed).length, blocked: rs.filter(r => r.blocked).length, blockedByProximity: rs.filter(r => r.blocked && /next to/.test(r.blocked)).length, zeroMove: rs.filter(r => r.zero).map(r => r.zero!.kind), closedCellsMedian: rs.map(r => r.protectedCells).sort((a, b) => a - b)[Math.floor(rs.length / 2)], maxDecisionMs: g.maxDecisionMs },
    v6: base ? { winner: base.winner, turns: base.turns, turnLimit: base.turnLimit, firstAcross: Math.min(...(['human', 'ai'] as Player[]).map(p => base.scoreTurns[p][0] ?? 99)) } : null,
  };
  void chains; void selfTriggers; void triggers;
  rows.push(row);
  console.log(JSON.stringify(row));
}
const start = init(96001, { ruleset: RULESET_V61 });
mkdirSync(join(ROOT, 'evidence/v6'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/v6/v6-1-smoke.json'), JSON.stringify({ schema: 'rule-sabotage/v6-1-smoke@1', ruleset: RULESET_V61, createdAt: new Date().toISOString(), note: '6 games, seed 96001 x 2 first movers x 3 policies (self-play); paired with the V6 games of the same seed. Smoke only, not a balance study.', closedCellsAtStart: protectedCells(start, start.current).length, games: rows }, null, 2) + '\n');

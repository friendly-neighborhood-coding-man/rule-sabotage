/**
 * V6 turn-limit evidence (EXPERIMENTAL-V6-NOT-PRODUCTION). Run ONCE: npm run v6:turn-limit
 *
 * Question: is the unchanged 60-turn limit (30 turns each) still suitable on the 13x9 board? The rule is NOT changed by
 * this script; it only measures. 24 games: each of the three forked V6 policies against itself, 4 dev seeds x both
 * first movers, under the real 60-turn rule. Seeds 96001-96004 (never used before; not the 65001-65060 holdout).
 * Also records the zero-move diagnosis, placements blocked by any rule, and how many cells rule A1 protected.
 * Output: evidence/v6/turn-limit.json (+ printed summary). Small by design: this is not a balance study.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { playGameV6, type V6Game } from '../server/v6/selfplay.ts';
import { RULESET, MAX_TURNS } from '../server/v6/engine.ts';
import { POLICIES53, type Policy53 } from '../server/v6/forks/policies53.ts';
import { ROOT } from './v6-fork.ts';
import type { Player } from '../server/rules.ts';

const SEEDS = [96001, 96002, 96003, 96004];
const FIRST: Player[] = ['human', 'ai'];
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

const games: V6Game[] = [];
for (const pol of POLICIES53 as Policy53[]) for (const seed of SEEDS) for (const first of FIRST) {
  const g = await playGameV6(seed, { human: pol, ai: pol }, { first });
  games.push(g);
  console.log(`${pol.padEnd(10)} seed ${seed} first ${first.padEnd(5)} -> ${g.winner.padEnd(5)} in ${String(g.turns).padStart(2)} turns${g.turnLimit ? ' (TURN LIMIT)' : ''}  ${Math.round(g.ms / 1000)} s, max decision ${g.maxDecisionMs} ms`);
}

const by = (pol: string) => games.filter(g => g.policies.human === pol);
const rows = games.flatMap(g => g.rows);
const summarise = (gs: V6Game[]) => {
  const t = gs.map(g => g.turns), rs = gs.flatMap(g => g.rows);
  const firstScore = gs.flatMap(g => (['human', 'ai'] as Player[]).map(p => g.scoreTurns[p][0]).filter((x): x is number => x !== null));
  return {
    games: gs.length, turnLimitHits: gs.filter(g => g.turnLimit).length, turns: { min: Math.min(...t), median: q(t, 0.5), p90: q(t, 0.9), max: Math.max(...t) },
    shareOfLimitUsed: { median: q(t.map(x => x / MAX_TURNS), 0.5), max: Math.max(...t) / MAX_TURNS },
    firstPieceAcrossTurn: { median: q(firstScore, 0.5), min: firstScore.length ? Math.min(...firstScore) : null },
    firstMoverWins: gs.filter(g => g.winner === g.first).length, draws: gs.filter(g => g.winner === 'draw').length,
    zeroMoveTurns: { total: rs.filter(r => r.zero).length, noLegalMove: rs.filter(r => r.zero?.kind === 'no-legal-move').length, unfavorable: rs.filter(r => r.zero?.kind === 'unfavorable').length, plannerError: rs.filter(r => r.zero?.kind === 'planner-error').length },
    placements: { made: rs.filter(r => r.placed).length, blocked: rs.filter(r => r.blocked).length, blockedByA1: rs.filter(r => r.blocked && /next to the opponent piece/.test(r.blocked)).length, blockedTier3: rs.filter(r => r.blocked && /^unverified/.test(r.blocked)).length },
    a1ProtectedCellsPerTurn: { median: q(rs.map(r => r.protectedCells), 0.5), max: Math.max(...rs.map(r => r.protectedCells)) },
    maxDecisionMs: Math.max(...gs.map(g => g.maxDecisionMs)), budgetHits: rs.filter(r => r.budgetHit).length,
  };
};
const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })();
const out = {
  schema: 'rule-sabotage/v6-turn-limit@1', mode: 'EXPERIMENTAL-V6-NOT-PRODUCTION', ruleset: RULESET, maxTurns: MAX_TURNS, commit, createdAt: new Date().toISOString(),
  design: { policies: POLICIES53, pairing: 'self-play (same policy both sides)', seeds: SEEDS, firstMovers: FIRST, games: games.length, note: 'Measurement only. The 60-turn rule was not changed. Not a balance study; no V5.3 claim carries over.' },
  overall: summarise(games), byPolicy: Object.fromEntries((POLICIES53 as string[]).map(p => [p, summarise(by(p))])),
  zeroMoveExamples: rows.filter(r => r.zero).slice(0, 12).map(r => ({ turn: r.turn, p: r.p, ...r.zero })),
  games: games.map(g => ({ seed: g.seed, first: g.first, policy: g.policies.human, winner: g.winner, turns: g.turns, turnLimit: g.turnLimit, reason: g.reason, scoreTurns: g.scoreTurns, ms: g.ms, maxDecisionMs: g.maxDecisionMs })),
};
mkdirSync(join(ROOT, 'evidence/v6'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/v6/turn-limit.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.overall, null, 2));

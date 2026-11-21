/**
 * Zero-game audit for the human playtest (reads the frozen V5.3 records; plays nothing, calls nothing):
 *  1. decision latency per policy as recorded in the 180 V5.3 self-play games (worker pool, under parallel load);
 *  2. OA-v3 work-budget use: how far one decision can run past the 20,000-simulation budget;
 *  3. how often the playtest's engine-only referee would NOT have placed a V5.3 policy's chosen effect (tier 3 or an
 *     engine check failure). Each game is re-executed through the engine move by move and, at every placement, the
 *     production buildTrial + selectTier are applied to the real position. The recorded game continues unchanged.
 * Output: evidence/playtest/latency-audit.json
 */
process.env.KANE_REFEREE = 'off';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { init, applyPlacement, applyMove, endTurn, validatePlacement, type Dir } from '../server/engine.ts';
import { effectFromId } from '../server/weights.ts';
import { buildTrial } from '../server/trial.ts';
import { selectTier } from '../server/tiers.ts';
import { OA3 } from '../server/balance/v5_3/policies.ts';

const RUN = 'evidence/balance/v5_3/2026-11-20T22-04-35Z-v53';
const files = readdirSync(join(RUN, 'games')).sort();
const q = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), i = p * (s.length - 1), lo = Math.floor(i); return Math.round(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)); };
const per: Record<string, { ms: number[]; budget: number[]; hits: number; placements: number; tier: Record<string, number>; notPlaced: number; games: number }> = {};
let trialNo = 90000;
for (const f of files) {
  const { arm, rec } = JSON.parse(readFileSync(join(RUN, 'games', f), 'utf8'));
  const P = (per[arm] ??= { ms: [], budget: [], hits: 0, placements: 0, tier: { '1': 0, '2': 0, '3': 0, rejected: 0 }, notPlaced: 0, games: 0 });
  P.games++;
  const d = rec.detail, s = init(d.seed, { first: d.first });
  for (const t of d.turns) {
    const m = t.policyMeta;
    if (m) { P.ms.push(m.ms); if (typeof m.budgetSims === 'number') P.budget.push(m.budgetSims); if (m.budgetHit) P.hits++; }
    if (t.placement) {
      const pl = { text: 'audit', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'audit' };
      if (validatePlacement(s, t.p, pl).ok) {
        P.placements++;
        const trial = buildTrial(s, t.p, pl, ++trialNo);
        if (trial.engineChecks.some(c => !c.pass)) { P.tier.rejected++; P.notPlaced++; }
        else { const tier = selectTier(s, t.p, pl, trial).tier; P.tier[String(tier)]++; if (tier === 3) P.notPlaced++; }
      }
      applyPlacement(s, t.p, pl);
    }
    if (s.phase === 'place') s.phase = 'move';
    for (const mv of t.moves) applyMove(s, t.p, { from: mv.from, dir: mv.dir as Dir, mode: mv.mode });
    if (s.winner) break;
    endTurn(s);
  }
}
const out = {
  schema: 'rule-sabotage/playtest-latency-audit@1', source: RUN, games: files.length, newGames: 0, externalCalls: 0,
  note: 'Decision times were measured in V5.3 worker threads running in parallel (CPU contention); the playtest runs one decision at a time in one worker, so they are indicative only. The playtest records the real time of every decision.',
  policies: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, {
    games: v.games, decisions: v.ms.length, decisionMs: { median: q(v.ms, 0.5), p90: q(v.ms, 0.9), p99: q(v.ms, 0.99), max: v.ms.length ? Math.max(...v.ms) : null, over5s: v.ms.filter(x => x > 5000).length, over10s: v.ms.filter(x => x > 10000).length },
    ...(v.budget.length ? { budget: { limit: OA3.budgetSims, maxUsed: Math.max(...v.budget), overLimit: v.budget.filter(x => x > OA3.budgetSims).length, maxOvershoot: Math.max(0, Math.max(...v.budget) - OA3.budgetSims), hits: v.hits } } : {}),
    placements: v.placements, refereeTiers: v.tier, wouldNotBePlaced: v.notPlaced, wouldNotBePlacedShare: v.placements ? Math.round(1000 * v.notPlaced / v.placements) / 1000 : null,
  }])),
};
mkdirSync('evidence/playtest', { recursive: true });
writeFileSync('evidence/playtest/latency-audit.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.policies, null, 1));

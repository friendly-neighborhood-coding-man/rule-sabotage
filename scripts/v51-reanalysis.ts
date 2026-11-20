/**
 * V5.1 strategy-vs-RNG reanalysis of the 300 stored V5 games (no game played). Originals untouched.
 *   npm run balance:v51:reanalysis -> evidence/balance/v5_1/reanalysis.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { loadV5, reanalyse, turns } from '../server/balance/v5_1/reanalysis.ts';
import { planPolicy, POLICIES } from '../server/balance/v5/policies.ts';
import { canonicalPlan } from '../server/balance/v5/evk11.ts';
import { init, applyPlacement, applyMove, endTurn, type Dir, type Move } from '../server/engine.ts';
import { effectFromId, loadWeights } from '../server/weights.ts';
const DIR = join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5');
const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const games = loadV5(DIR);
log(`games ${games.length}`);
const out: Record<string, unknown> = { source: 'evidence/balance/v5/2026-11-20T16-11-56Z-v5 (unchanged)', newGamesPlayed: 0, ...reanalyse(games) };
log('per-arm measures done');
// Policy-dependent variation on MATCHED public states: the same stored start-of-turn states given to every policy.
const w = loadWeights(), sample: { s: ReturnType<typeof init>; p: 'human' | 'ai'; id: string }[] = [];
for (const g of games.filter((_, i) => i % 10 === 0)) {
  const d = g.rec.detail!, s = init(d.seed, { first: d.first });
  for (const t of d.turns) {
    if (t.turn % 4 === 1) sample.push({ s: structuredClone(s), p: t.p, id: `${g.gameId}@t${t.turn}` });
    if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' });
    if (s.phase === 'place') s.phase = 'move';
    for (const m of t.moves) applyMove(s, t.p, { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] });
    if (s.winner) break; endTurn(s);
  }
}
const pick = sample.filter((_, i) => i % Math.max(1, Math.floor(sample.length / 60)) === 0).slice(0, 60);
const dec = Object.fromEntries(POLICIES.map(id => [id, pick.map(x => canonicalPlan(x.p, planPolicy(id, x.s, x.p, w).chosen))]));
const pairs = [['ev-k1.1', 'oa-v2'], ['ev-k1.1', 'softmax-v2'], ['oa-v2', 'softmax-v2']];
out.matchedStates = { states: pick.length, ids: pick.map(x => x.id), disagreement: Object.fromEntries(pairs.map(([a, b]) => [`${a} vs ${b}`, { plan: dec[a].filter((x, i) => x !== dec[b][i]).length, placement: dec[a].filter((x, i) => x.split('|')[0] !== dec[b][i].split('|')[0]).length }])) };
log(`matched states: ${JSON.stringify(out.matchedStates)}`);
void turns;
writeFileSync(join(ROOT, 'evidence/balance/v5_1/reanalysis.json'), JSON.stringify(out, null, 2));
log('written');

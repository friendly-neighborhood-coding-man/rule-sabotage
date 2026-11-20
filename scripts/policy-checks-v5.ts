/**
 * V5 policy-diversity preparation: mandatory requirement checks and decision-level manipulation checks.
 * Plays NO game: only planner decisions on recorded / synthetic / initial positions.
 *   npm run balance:v5:checks -> evidence/balance/v5/policy-checks.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { recordedPositions, syntheticPositions } from '../server/balance/v4/manipulation.ts';
import { mirror } from '../server/balance/v4/diagnose.ts';
import { planPolicy, canonicalPlan, policiesHash, PARAMS, type PolicyId } from '../server/balance/v5/policies.ts';
import { evPlannerHash } from '../server/balance/v4/evplanner.ts';
import { init } from '../server/engine.ts';
import { loadWeights } from '../server/weights.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const V42 = join(ROOT, 'evidence/balance/v4/v42/2026-11-20T08-33-47Z-v42-dev');
const positions = [...recordedPositions(V42, 20, 5, 13), ...syntheticPositions(20, 2026)];
const ids: PolicyId[] = ['ev-k1', 'softmax-v1', 'oa-v1'];
const out: Record<string, unknown> = { policiesHash: policiesHash(), evPlannerHash: evPlannerHash(), params: PARAMS, positions: positions.length, newGamesPlayed: 0 };
const req: Record<string, unknown> = {}, chosen: Record<string, string[]> = {};
for (const id of ids) {
  const t0 = Date.now(); let mirrorMismatch = 0, rngChanged = 0; chosen[id] = [];
  for (const { s, p } of positions) {
    const q = p === 'human' ? 'ai' : 'human';
    const a = planPolicy(id, s, p, w); chosen[id].push(canonicalPlan(p, a.chosen));
    const b = planPolicy(id, mirror(s), q, w);
    if (canonicalPlan(p, a.chosen) !== canonicalPlan(q, b.chosen) || Math.abs(a.chosen.score - b.chosen.score) > 1e-6) mirrorMismatch++;
    for (const r of [1, 0xcafebabe]) { const s2 = structuredClone(s); s2.rng = r; if (canonicalPlan(p, planPolicy(id, s2, p, w).chosen) !== canonicalPlan(p, a.chosen)) { rngChanged++; break; } }
  }
  req[id] = { mirrorMismatch, hiddenRngChanged: rngChanged, msPerDecision: Math.round((Date.now() - t0) / (positions.length * 4)) };
  log(`${id}: ${JSON.stringify(req[id])}`);
}
out.requirements = req;
out.decisionDifferenceVsRef = Object.fromEntries(['softmax-v1', 'oa-v1'].map(id => [id, chosen[id].filter((c, i) => c !== chosen['ev-k1'][i]).length]));
// Opening behaviour from the initial position (no game played): distinct turn-1 placements over 30 seeds x both first movers
const openings: Record<string, number> = {};
for (const id of ids) { const set = new Set<string>(); for (let seed = 67901; seed <= 67930; seed++) for (const first of ['human', 'ai'] as const) { const s = init(seed, { first }); set.add(canonicalPlan(first, planPolicy(id, s, first, w).chosen).split('|')[0]); } openings[id] = set.size; }
out.distinctTurn1PlacementsFromStart = openings;
writeFileSync(join(ROOT, 'evidence/balance/v5/policy-checks.json'), JSON.stringify(out, null, 2));
log(JSON.stringify({ requirements: out.requirements, decisionDifferenceVsRef: out.decisionDifferenceVsRef, distinctTurn1PlacementsFromStart: openings }));

/**
 * V5 preflight (operator requirement B). Position checks play no game; the agreement/replay part plays a few smoke games
 * on THROWAWAY seeds 99601-99603 (not a dataset, not evidence about balance).
 *   npm run balance:v5:preflight -> evidence/balance/v5/preflight.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, replayDetail } from '../server/balance/v3/batch.ts';
import { recordedPositions, syntheticPositions } from '../server/balance/v4/manipulation.ts';
import { mirror } from '../server/balance/v4/diagnose.ts';
import { planTurnEV, evPlannerHash } from '../server/balance/v4/evplanner.ts';
import { planPolicy, policyMoves, canonicalPlan, POLICIES, PARAMS, policiesHash, type PolicyId } from '../server/balance/v5/policies.ts';
import { evk11Hash, planTurn11 } from '../server/balance/v5/evk11.ts';
import { playGame } from '../server/balance/selfplay.ts';
import { init, type Move } from '../server/engine.ts';
import { loadWeights } from '../server/weights.ts';
import { type Player } from '../server/rules.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
const mk = (m: Move): Move => { const [x, y] = m.from.split(',').map(Number); return { from: `${6 - x},${y}`, dir: m.dir === 'left' ? 'right' : m.dir === 'right' ? 'left' : m.dir, mode: m.mode }; };
const asMove = (s: ReturnType<typeof init>) => (s.phase === 'place' ? { ...structuredClone(s), phase: 'move' as const } : s);

// New position sets (different from the 40 used in PR #9): V4 pilot arm B and V4.2 arms, new offsets, + new synthetic seed.
const positions = [
  ...recordedPositions(join(ROOT, 'evidence/balance/v4/pilot/2026-11-19T21-42-56Z-v4-pilot'), 20, 7, 17),
  ...recordedPositions(join(ROOT, 'evidence/balance/v4/v42/2026-11-20T08-33-47Z-v42-dev'), 20, 2, 19),
  ...syntheticPositions(30, 303030),
];
const out: Record<string, unknown> = { hashes: { evk11: evk11Hash(), policies: policiesHash(), evK1Frozen: evPlannerHash() }, params: PARAMS, positions: positions.length, positionIds: positions.map(p => p.id) };
log(`positions: ${positions.length}`);

const perPolicy: Record<string, unknown> = {}, chosenBy: Record<string, string[]> = {}, execBy: Record<string, string[]> = {};
for (const id of POLICIES) {
  const t0 = Date.now(); let mirrorPlan = 0, mirrorExec = 0, rngPlan = 0, rngExec = 0, determinism = 0, nearTies = 0; chosenBy[id] = []; execBy[id] = [];
  for (const { s, p } of positions) {
    const q = other(p), a = planPolicy(id, s, p, w), b = planPolicy(id, mirror(s), q, w);
    chosenBy[id].push(canonicalPlan(p, a.chosen));
    if (canonicalPlan(p, a.chosen) !== canonicalPlan(q, b.chosen) || Math.abs(a.chosen.score - b.chosen.score) > 1e-6) mirrorPlan++;
    const ea = policyMoves(asMove(s), p, w).moves, eb = policyMoves(asMove(mirror(s)), q, w).moves;
    execBy[id].push(JSON.stringify(ea));
    if (JSON.stringify(ea.map(mk)) !== JSON.stringify(eb)) mirrorExec++;
    for (const r of [7, 0xcafebabe]) { const s2 = structuredClone(s); s2.rng = r; if (canonicalPlan(p, planPolicy(id, s2, p, w).chosen) !== canonicalPlan(p, a.chosen)) { rngPlan++; break; } }
    { const s2 = structuredClone(s); s2.rng = 0x1234567; if (JSON.stringify(policyMoves(asMove(s2), p, w).moves) !== JSON.stringify(ea)) rngExec++; }
    if (canonicalPlan(p, planPolicy(id, s, p, w).chosen) !== canonicalPlan(p, a.chosen)) determinism++;
    if (a.ranked.length > 1 && Math.abs(a.ranked[0].score - a.ranked[1].score) < 1e-6) nearTies++;
  }
  perPolicy[id] = { mirrorPlanMismatch: mirrorPlan, mirrorExecutedMovesMismatch: mirrorExec, hiddenRngPlanChanged: rngPlan, hiddenRngExecutedMovesChanged: rngExec, nonDeterministic: determinism, topTwoWithin1e6: nearTies, msPerCall: Math.round((Date.now() - t0) / (positions.length * 6)) };
  log(`${id}: ${JSON.stringify(perPolicy[id])}`);
}
out.requirements = perPolicy;
out.distinctVsReference = Object.fromEntries(['oa-v2', 'softmax-v2'].map(id => [id, { plans: chosenBy[id].filter((c, i) => c !== chosenBy['ev-k1.1'][i]).length, placementOnly: chosenBy[id].filter((c, i) => c.split('|')[0] !== chosenBy['ev-k1.1'][i].split('|')[0]).length }]));

// ev-k1 (frozen) vs ev-k1.1: where do the corrections change the decision? (temperature 0 for both)
let same = 0, samePlacement = 0;
for (const { s, p } of positions) { const a = planTurnEV(s, { me: p, weights: w, temperature: 0, variant: { sideRelativeOrder: true } }), b = planTurn11(s, { me: p, weights: w, temperature: 0 }); if (canonicalPlan(p, a.chosen) === canonicalPlan(p, b.chosen)) same++; if (canonicalPlan(p, a.chosen).split('|')[0] === canonicalPlan(p, b.chosen).split('|')[0]) samePlacement++; }
out.k1VersusK11 = { positions: positions.length, sameChosenPlan: same, sameChosenPlacement: samePlacement, note: 'differences come from C1-C4 (cell ties, reply ordering, near-ties, and planning without the 0.02 noise)' };
log(`k1 vs k1.1: ${JSON.stringify(out.k1VersusK11)}`);

// Openings from the start position (decisions only): 30 public seeds x both first movers
out.turn1PlacementsFromStart = Object.fromEntries(POLICIES.map(id => { const set = new Set<string>(); for (let seed = 99611; seed <= 99640; seed++) for (const f of ['human', 'ai'] as const) set.add(canonicalPlan(f, planPolicy(id, init(seed, { first: f }), f, w).chosen).split('|')[0]); return [id, set.size]; }));
log(`turn-1 placements from start: ${JSON.stringify(out.turn1PlacementsFromStart)}`);

// Smoke games on throwaway seeds: replay, plan/execution agreement, cost
const smoke: Record<string, unknown>[] = [];
const pairs: [PolicyId, PolicyId][] = [['ev-k1.1', 'ev-k1.1'], ['oa-v2', 'oa-v2'], ['softmax-v2', 'softmax-v2'], ['ev-k1.1', 'oa-v2'], ['softmax-v2', 'ev-k1.1'], ['oa-v2', 'softmax-v2']];
pairs.forEach(([h, a], i) => {
  const t0 = Date.now();
  const r = playGame(99601 + (i % 3), i % 2 ? 'ai' : 'human', { human: w, ai: w }, { detail: true, policy: { human: h, ai: a }, maxMs: 1_800_000 });
  let turns = 0, agree = 0, disagree: string[] = [];
  for (const t of r.detail!.turns) {
    if (!t.plannedMoves) continue; turns++;
    const firstTp = t.moves.findIndex(m => m.events.some(e => e.t === 'forced' && (e as { how: string }).how === 'teleport'));
    const exec = t.moves.slice(0, firstTp >= 0 ? firstTp + 1 : t.moves.length).map(m => `${m.from}${m.dir}${m.mode}`);
    const plan = t.plannedMoves.map(m => `${m.from}${m.dir}${m.mode}`);
    if (JSON.stringify(exec.slice(0, plan.length)) === JSON.stringify(plan) && (firstTp >= 0 || exec.length === plan.length)) agree++; else if (disagree.length < 3) disagree.push(`t${t.turn}: planned ${plan.join(' ')} / executed ${exec.join(' ')}`);
  }
  const rp = replayDetail(r);
  smoke.push({ human: h, ai: a, seed: r.seed, first: r.first, winner: r.winner, turns: r.turns, ms: Date.now() - t0, replayOk: rp.ok, planExecAgree: `${agree}/${turns}`, disagreements: disagree, errors: r.errors, illegal: r.illegal });
  log(`smoke ${h} vs ${a}: ${JSON.stringify(smoke[smoke.length - 1])}`);
});
out.smoke = smoke;
mkdirSync(join(ROOT, 'evidence/balance/v5'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/balance/v5/preflight.json'), JSON.stringify(out, null, 2));
log('written evidence/balance/v5/preflight.json');

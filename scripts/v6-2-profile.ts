/**
 * V6.2 latency investigation, step 2 (EXPERIMENTAL). Profiles the slow opponent decisions captured by
 * `npm run v6.2:replay` (evidence/v6/v6-2-replay.json) with the V8 CPU profiler, in process, one decision at a time,
 * and attributes INCLUSIVE time to the parts of a decision:
 *   planner total        planPolicy53 (whole decision)
 *   chance enumeration   moveOutcomes (every teleport destination enumerated, each a structuredClone + applyMove)
 *   evaluation           evaluateCached -> pieceCost (Dijkstra path costs)
 *   state copying        structuredClone (anywhere inside the planner)
 *   move simulation      applyMove / land (engine)
 *   reply / strata       stratify11, replyValue11, worst3
 * plus, timed separately, the referee (refereeV6 on the chosen placement) and the move executor (moves53).
 * Then the same decision is re-run on planningView(state) (the V6.2 semantics-preserving optimisation) and the two
 * decisions are compared field by field. Measurement only; nothing about a decision changes. Output: evidence/v6/v6-2-profile.json. Run: npm run v6.2:profile
 */
import { Session } from 'node:inspector/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planPolicy53, moves53, type Policy53 } from '../server/v6/forks/policies53.ts';
import { refereeV6, planningView } from '../server/v6/turn.ts';
import { resolveAIRuleText } from '../server/rules.ts';
import { aiPhrase } from '../server/v6/forks/ai.ts';
import { loadWeights } from '../server/weights.ts';
import { ROOT } from './v6-fork.ts';
import type { State } from '../server/v6/engine.ts';

const W8 = loadWeights();
const BUCKETS: Record<string, string[]> = {
  'chance enumeration (moveOutcomes)': ['moveOutcomes'],
  'evaluation (evaluateCached)': ['evaluateCached'],
  'path cost Dijkstra (pieceCost)': ['pieceCost'],
  'state copying (structuredClone)': ['structuredClone'],
  'engine move simulation (applyMove)': ['applyMove'],
  'own greedy move loop (greedy11)': ['greedy11'],
  'candidate placements (candidatePlacements)': ['candidatePlacements'],
  'opponent reply model (replyValue11 / worst3)': ['replyValue11', 'worst3'],
  'strata (stratify11)': ['stratify11'],
};
type Prof = { nodes: { id: number; callFrame: { functionName: string; url: string }; children?: number[] }[]; samples: number[]; timeDeltas: number[] };
function inclusive(p: Prof): { total: number; byFn: Map<string, number>; selfTop: [string, number][] } {
  const parent = new Map<number, number>(), byId = new Map(p.nodes.map(n => [n.id, n]));
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const byFn = new Map<string, number>(), self = new Map<string, number>();
  let total = 0;
  p.samples.forEach((id, i) => {
    const dt = (p.timeDeltas[i] ?? 0) / 1000; total += dt;
    const leaf = byId.get(id)!; const lk = `${leaf.callFrame.functionName || '(anon)'} ${leaf.callFrame.url.split('/').pop()}`;
    self.set(lk, (self.get(lk) ?? 0) + dt);
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) { const f = byId.get(cur)!.callFrame.functionName; if (f && !seen.has(f)) { seen.add(f); byFn.set(f, (byFn.get(f) ?? 0) + dt); } }
  });
  return { total, byFn, selfTop: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12) };
}

const replay = JSON.parse(readFileSync(join(ROOT, 'evidence/v6/v6-2-replay.json'), 'utf8')) as { positions: { game: string; turn: number; p: 'human' | 'ai'; policy: Policy53; plannerMs: number; state: State }[] };
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 500 });
const rows = [];
// The 3 slowest recorded decisions of each policy (9 of the captured positions): enough to see where the time goes.
const picked = (['softmax-v2', 'ev-k1.2', 'oa-v3'] as Policy53[]).flatMap(pol => replay.positions.filter(x => x.policy === pol).sort((a, b) => b.plannerMs - a.plannerMs).slice(0, 3));
for (const pos of picked) {
  await session.post('Profiler.start');
  const t0 = performance.now();
  const plan = planPolicy53(pos.policy, structuredClone(pos.state), pos.p, W8);
  const plannerMs = performance.now() - t0;
  const { profile } = await session.post('Profiler.stop') as unknown as { profile: Prof };
  const inc = inclusive(profile);
  const s = structuredClone(pos.state);
  let refereeMs: number | null = null;
  if (plan.chosen.placement) {
    const e = plan.chosen.placement.effect, rt = resolveAIRuleText(e, aiPhrase(e, s.turn + s.seed));
    const r0 = performance.now(); refereeV6(s, pos.p, { text: rt.text, effect: e, cells: plan.chosen.placement.cells, interpretedBy: 'profile' }, { keepTrial: false }); refereeMs = performance.now() - r0;
  }
  if (s.phase === 'place') s.phase = 'move';
  const x0 = performance.now(); moves53(s, pos.p, W8); const executorMs = performance.now() - x0;
  const pct = (ms: number) => Math.round((ms / inc.total) * 1000) / 10;
  const buckets = Object.fromEntries(Object.entries(BUCKETS).map(([k, fns]) => { const ms = Math.max(...fns.map(f => inc.byFn.get(f) ?? 0)); return [k, { ms: Math.round(ms), pct: pct(ms) }]; }));
  const v0 = performance.now();
  const planV = planPolicy53(pos.policy, planningView(pos.state), pos.p, W8);
  const viewMs = performance.now() - v0;
  const sig = (c: typeof plan.chosen) => JSON.stringify([c.summary, c.placement, c.moves, c.score]);
  const identical = sig(plan.chosen) === sig(planV.chosen) && JSON.stringify(plan.ranked.map(sig)) === JSON.stringify(planV.ranked.map(sig)) && plan.sims === planV.sims;
  const row = { game: pos.game, turn: pos.turn, side: pos.p, policy: pos.policy, recordedMs: pos.plannerMs, plannerMs: Math.round(plannerMs), planningViewMs: Math.round(viewMs), planningViewIdentical: identical, stateBytes: JSON.stringify(pos.state).length, viewBytes: JSON.stringify(planningView(pos.state)).length, sims: plan.sims, candidates: plan.candidates, refereeMs: refereeMs && Math.round(refereeMs), executorMs: Math.round(executorMs), buckets, topSelfTime: inc.selfTop.map(([f, ms]) => ({ fn: f, ms: Math.round(ms), pct: pct(ms) })) };
  rows.push(row);
  console.log(`${pos.game} t${pos.turn} ${pos.policy}: planner ${row.plannerMs} ms (recorded ${pos.plannerMs}), with planningView ${row.planningViewMs} ms identical=${identical}, referee ${row.refereeMs} ms, executor ${row.executorMs} ms`);
  for (const [k, v] of Object.entries(buckets)) console.log(`   ${k.padEnd(48)} ${String(v.ms).padStart(6)} ms ${String(v.pct).padStart(5)}%`);
}
writeFileSync(join(ROOT, 'evidence/v6/v6-2-profile.json'), JSON.stringify({ schema: 'rule-sabotage/v6-2-profile@1', note: 'Inclusive CPU time per function from the V8 sampling profiler (0.5 ms). Buckets overlap (nested calls): percentages do not add to 100.', selection: '3 slowest recorded decisions per policy', positions: rows }, null, 1) + '\n');

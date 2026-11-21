/**
 * V6.3 latency-bounded prototype: END-TO-END validation on the recorded slow positions (no new games).
 *
 * For each of the 31 positions captured in evidence/v6/v6-2-replay.json (opponent decisions that took >= 8 s in the
 * V6.1 replay), the whole opponent turn is run with the -ra-b@1 variant through aiTurnV6, exactly as in the game:
 * planner in an isolated worker (terminated at 8 s), time-bounded referee pre-check, the referee on the real state,
 * the move executor with teleport re-planning. The wall time of the whole turn is recorded.
 * For the 9 profiled positions the decision is compared with the unbounded referee-aware decision (-ra@1).
 * Output: evidence/v6/v6-3-latency.json. Run: npm run v6.3:latency
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiTurnV6, planningView } from '../server/v6/turn.ts';
import { PlannerPool, decideBudgeted, SOFT_MS, HARD_MS, PRECHECK_DEADLINE_MS, type BudgetMeta } from '../server/v6/budgeted.ts';
import { selectRefereeAware } from '../server/v6/referee-aware.ts';
import { planPolicy53, type Policy53 } from '../server/v6/forks/policies53.ts';
import { withFastClone } from '../server/v6/fastclone.ts';
import { loadWeights } from '../server/weights.ts';
import { ROOT } from './v6-fork.ts';
import type { State } from '../server/v6/engine.ts';

const W8 = loadWeights();
const replay = JSON.parse(readFileSync(join(ROOT, 'evidence/v6/v6-2-replay.json'), 'utf8')) as { positions: { game: string; turn: number; p: 'human' | 'ai'; policy: Policy53; plannerMs: number; state: State }[] };
const profiled = new Set((JSON.parse(readFileSync(join(ROOT, 'evidence/v6/v6-2-profile.json'), 'utf8')).positions as { game: string; turn: number }[]).map(x => `${x.game}#${x.turn}`));
const pool = new PlannerPool();
// warm-up decision so the measured turns do not include the very first worker start-up (reported separately)
const w0 = performance.now(); await pool.run('softmax-v2', planningView(replay.positions[0].state), replay.positions[0].p, 60_000); const warmupMs = Math.round(performance.now() - w0);
const rows = [];
for (const pos of replay.positions) {
  const s = structuredClone(pos.state);
  let meta: BudgetMeta | null = null;
  const t0 = performance.now();
  const r = await aiTurnV6(s, pos.p, pos.policy, W8, decideBudgeted(pool, new Map(), m => { meta = m; }));
  const turnMs = Math.round(performance.now() - t0);
  const row: Record<string, unknown> = { game: pos.game, turn: pos.turn, policy: pos.policy, recordedPlannerMs: pos.plannerMs, turnMs, outcome: meta!.outcome, plannerMs: meta!.plannerMs, precheckMs: meta!.precheck.ms, precheckTrials: meta!.precheck.trials, respawnMs: meta!.respawnMs, fallback: meta!.fallback, executorMs: r.executorMs, refereeMs: r.verdict?.ms ?? null, placed: r.verdict?.activated ?? false, budgetedPlacement: r.verdict ? `${r.verdict.label}@${r.verdict.cells.join('+')}` : null, moves: r.moves.length };
  if (profiled.has(`${pos.game}#${pos.turn}`)) {
    const f0 = performance.now();
    const full = selectRefereeAware(pos.state, pos.p, withFastClone(() => planPolicy53(pos.policy, planningView(pos.state), pos.p, W8)), new Map());
    row.unboundedRaMs = Math.round(performance.now() - f0);
    row.unboundedRaPlacement = full.chosen.placement ? `${full.chosen.placement.effect.kind}@${[...full.chosen.placement.cells].sort().join('+')}` : null;
    const bp = meta!.outcome === 'terminated' ? null : (r.verdict ? `${r.verdict.effect?.kind}@${[...(r.verdict.cellKeys ?? [])].sort().join('+')}` : null);
    row.samePlacementAsUnbounded = bp === row.unboundedRaPlacement;
  }
  rows.push(row); console.log(JSON.stringify(row));
}
await pool.close();
const t = rows.map(r => r.turnMs as number).sort((a, b) => a - b), q = (p: number) => t[Math.min(t.length - 1, Math.floor(p * (t.length - 1) + 0.5))];
const summary = { positions: rows.length, turnMs: { median: q(0.5), p90: q(0.9), max: t.at(-1) }, over8s: t.filter(x => x > HARD_MS).length, over10s: t.filter(x => x > 10_000).length, outcomes: rows.reduce((a: Record<string, number>, r) => (a[r.outcome as string] = (a[r.outcome as string] ?? 0) + 1, a), {}), compared: rows.filter(r => 'samePlacementAsUnbounded' in r).length, samePlacement: rows.filter(r => r.samePlacementAsUnbounded === true).length, warmupMs };
console.log(JSON.stringify(summary));
writeFileSync(join(ROOT, 'evidence/v6/v6-3-latency.json'), JSON.stringify({ schema: 'rule-sabotage/v6-3-latency@1', variant: 'latency-bounded@1 (-ra-b@1)', softMs: SOFT_MS, hardMs: HARD_MS, precheckDeadlineMs: PRECHECK_DEADLINE_MS, note: 'turnMs = the whole opponent turn (planner worker, pre-check, referee on the real state, executor with teleport re-planning). Positions: the 31 slow decisions of the V6.1 replay.', summary, rows }, null, 1) + '\n');

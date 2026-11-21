/**
 * V6.3 LATENCY-BOUNDED prototype (EXPERIMENTAL, separately versioned, NOT promoted): opponents `v6-*-ra-b@1`.
 *
 * Built on the referee-aware adapter's idea; the original policies (v6-*@1) and the referee-aware ones (v6-*-ra@1) are
 * unchanged and stay selectable. What this variant adds:
 *
 *  1. The unchanged forked policy runs in an ISOLATED worker thread. Target: the policy's own exact decision within
 *     SOFT_MS (5 s). If it is not done by then the variant keeps waiting, up to HARD_MS (8 s).
 *  2. At HARD_MS the worker is TERMINATED (Worker.terminate(), not a cooperative check) and the turn uses the
 *     FALLBACK. A warm spare worker is kept so the next decision does not pay the start-up cost; the replacement is
 *     started in the background.
 *  3. FALLBACK (deterministic, legal, no hidden information): no new effect this turn; the moves are chosen by the
 *     shared executor (moves53) exactly as for every other opponent. It runs on the masked planning view, so it sees
 *     no hidden RNG. It is the same move model the policies themselves use after their placement.
 *  4. Referee pre-check (as in -ra@1: un-enterable static check, repeat suppression, real referee on copies), but bounded
 *     by time too: no new pre-check starts after PRECHECK_DEADLINE_MS since the decision began, and at most 3 run. If the
 *     time runs out, the best-ranked plan without an effect is played.
 *  5. Every decision records: exact / late-but-exact / terminated, planner ms, pre-check ms and trials, whether a
 *     fallback was used and why. The variant never silently becomes the original policy and never substitutes another.
 *
 * A planning deadline is not an end-to-end guarantee: the referee on the real state, the move executor and teleport
 * re-planning still run after it. scripts/v6-3-latency.ts measures the whole turn.
 */
import { Worker } from 'node:worker_threads';
import { type State, type Placement } from './engine.ts';
import { type Player, resolveAIRuleText } from '../rules.ts';
import { aiPhrase } from './forks/ai.ts';
import { type Policy53, type Plan53 } from './forks/policies53.ts';
import { refereeV6 } from './turn.ts';
import { unenterableCell, proposalKey, type RAMemo } from './referee-aware.ts';

export const BUDGETED_ID = 'latency-bounded@1' as const;
export const SOFT_MS = 5_000, HARD_MS = 8_000, PRECHECK_DEADLINE_MS = 9_000, MAX_PRECHECKS = 3;

export type BudgetMeta = {
  variant: typeof BUDGETED_ID; outcome: 'exact' | 'late-exact' | 'terminated' | 'worker-error';
  plannerMs: number; softMs: number; hardMs: number; terminated: boolean; respawnMs: number | null;
  precheck: { trials: number; skippedUnenterable: number; skippedKnownBlocked: number; ms: number; stoppedByDeadline: boolean };
  chosenRank: number | null; fallback: string | null;
};

/** One active planner worker plus a warm spare. terminate() swaps in the spare and starts a new one in the background. */
export class PlannerPool {
  private active: Worker | null = null; private spare: Worker | null = null; private n = 0;
  private readonly url = new URL('./planworker.ts', import.meta.url);
  lastRespawnMs: number | null = null;
  private spawn() { const w = new Worker(this.url); w.unref(); return w; }
  private ensure() { if (!this.active) this.active = this.spare ?? this.spawn(); this.spare = null; if (!this.spare) this.spare = this.spawn(); return this.active; }
  /** Runs one decision; resolves with the plan, or { timedOut } after hardMs (the worker is then terminated). */
  run(policy: Policy53, state: State, me: Player, hardMs: number): Promise<{ plan?: Plan53; timedOut?: boolean; error?: string; ms: number }> {
    const w = this.ensure(), id = ++this.n, t0 = performance.now();
    return new Promise(res => {
      const done = (r: { plan?: Plan53; timedOut?: boolean; error?: string }) => { clearTimeout(timer); w.off('message', onMsg); w.off('error', onErr); res({ ...r, ms: Math.round(performance.now() - t0) }); };
      const onMsg = (m: { id: number; ok: boolean; plan?: Plan53; error?: string }) => { if (m.id === id) done(m.ok ? { plan: m.plan } : { error: m.error }); };
      const onErr = (e: Error) => { this.active = null; done({ error: `planner worker failed: ${e.message}` }); };
      const timer = setTimeout(() => {
        const r0 = performance.now();
        void w.terminate(); this.active = null; this.ensure(); // swap in the warm spare, start a new spare
        this.lastRespawnMs = Math.round(performance.now() - r0);
        done({ timedOut: true });
      }, hardMs);
      w.on('message', onMsg); w.on('error', onErr);
      w.postMessage({ id, policy, state, me });
    });
  }
  async close() { await Promise.all([this.active?.terminate(), this.spare?.terminate()]); this.active = this.spare = null; }
}

const toPlacement = (s: State, pl: NonNullable<Plan53['chosen']['placement']>): Placement => {
  const rt = resolveAIRuleText(pl.effect, aiPhrase(pl.effect, s.turn + s.seed));
  return { text: rt.text, effect: pl.effect, cells: pl.cells, interpretedBy: 'engine canonical text (V6 opponent)' };
};
const fallbackPlan = (why: string, policy: Policy53): Plan53 => ({ chosen: { id: 'fallback', placement: null, moves: [], score: 0, afterReply: 0, summary: `no effect; moves by the shared executor (${why})` }, ranked: [], candidates: 0, sims: 0, ms: 0, meta: { policy, ms: 0, sims: 0, fallback: why } as Plan53['meta'] });

/** The variant's decision function for aiTurnV6. `memo` = per-game repeat-suppression memo; `t0` = turn start. */
export function decideBudgeted(pool: PlannerPool, memo: RAMemo, onMeta?: (m: BudgetMeta) => void) {
  return async (policy: Policy53, s: State, me: Player): Promise<Plan53 & { budget: BudgetMeta }> => {
    const start = performance.now();
    const meta: BudgetMeta = { variant: BUDGETED_ID, outcome: 'exact', plannerMs: 0, softMs: SOFT_MS, hardMs: HARD_MS, terminated: false, respawnMs: null, precheck: { trials: 0, skippedUnenterable: 0, skippedKnownBlocked: 0, ms: 0, stoppedByDeadline: false }, chosenRank: null, fallback: null };
    const r = await pool.run(policy, s, me, HARD_MS);
    meta.plannerMs = r.ms;
    let plan: Plan53;
    if (r.plan) { plan = r.plan; meta.outcome = r.ms <= SOFT_MS ? 'exact' : 'late-exact'; }
    else if (r.timedOut) { meta.outcome = 'terminated'; meta.terminated = true; meta.respawnMs = pool.lastRespawnMs; meta.fallback = `planner terminated at ${HARD_MS} ms`; const p = fallbackPlan(meta.fallback, policy); onMeta?.(meta); return { ...p, budget: meta }; }
    else { meta.outcome = 'worker-error'; meta.fallback = `planner error: ${r.error}`; const p = fallbackPlan(meta.fallback, policy); onMeta?.(meta); return { ...p, budget: meta }; }
    // time-bounded referee pre-check over the policy's own ranking
    const p0 = performance.now();
    const order = [plan.chosen, ...plan.ranked.filter(c => c !== plan.chosen)];
    let pick: Plan53['chosen'] | null = null;
    for (const c of order) {
      if (!c.placement) { pick = c; break; }
      const pl = toPlacement(s, c.placement), k = proposalKey(s, me, pl), known = memo.get(k);
      if (known && known.final !== 'engine-approved') { meta.precheck.skippedKnownBlocked++; continue; }
      if (known?.final === 'engine-approved') { pick = c; break; }
      if (unenterableCell(s, pl)) { meta.precheck.skippedUnenterable++; memo.set(k, { final: 'unverified', code: 'tier-3-unenterable', turn: s.turn }); continue; }
      if (meta.precheck.trials >= MAX_PRECHECKS || performance.now() - start > PRECHECK_DEADLINE_MS) { meta.precheck.stoppedByDeadline = performance.now() - start > PRECHECK_DEADLINE_MS; meta.fallback = meta.precheck.stoppedByDeadline ? `pre-check deadline (${PRECHECK_DEADLINE_MS} ms) reached` : `pre-check budget (${MAX_PRECHECKS}) used up`; break; }
      meta.precheck.trials++;
      const copy = structuredClone(s); copy.phase = 'place';
      const v = refereeV6(copy, me, pl, { keepTrial: false }).verdict;
      memo.set(k, { final: v.final, code: v.code, turn: s.turn });
      if (v.activated) { pick = c; break; }
    }
    if (!pick) { pick = order.find(c => !c.placement) ?? null; meta.fallback = `${meta.fallback ?? 'no effect passed the pre-check'}: ${pick ? 'best plan without an effect' : 'no effect-free plan ranked, so no effect and executor moves'}`; }
    meta.precheck.ms = Math.round(performance.now() - p0);
    const chosen = pick ?? fallbackPlan(meta.fallback ?? 'no plan', policy).chosen;
    meta.chosenRank = pick ? order.indexOf(pick) + 1 : null;
    onMeta?.(meta);
    return { ...plan, chosen, budget: meta };
  };
}

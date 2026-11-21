/**
 * V6.2 referee-aware candidate-selection ADAPTER (EXPERIMENTAL, separately versioned; not used by the v6-*@1 opponents).
 *
 * Problem (docs/V6_2_PLAYABILITY_AND_KANE_SHADOW.md §2): the forked policies choose an effect without knowing whether
 * the engine-only referee will place it; about 30% of V6.1 AI placement attempts were not placed, and a policy can
 * propose the same blocked effect again and again.
 *
 * The adapter wraps an unchanged policy decision (planPolicy53). It does NOT change how the policy ranks plans. It only
 * changes which ranked plan is executed when the top one's effect would not be placed:
 *   1. Walk the policy's ranked plans in order. A plan with no effect is always acceptable.
 *   2. A plan whose effect is a known-blocked proposal (same effect, same cells, same local situation) is skipped without
 *      a trial: that is the repeat suppression.
 *   3. A cheap static check first: if a new cell would have no orthogonal neighbour free of effects once the placement is
 *      on the board, the referee's trial cannot enter it and the referee always answers tier 3 ("a new cell could not be
 *      entered in the trial", 81% of the V6.1 non-placements). Such a plan is skipped without running a trial. The check
 *      mirrors the trial's own approach() rule exactly (left, right, up, down; inside the board; no effect).
 *   4. Otherwise run the REAL referee (refereeV6) on a COPY of the state, without keeping its trial page. If it would be
 *      engine-approved, choose that plan. If not, remember it as blocked and go on.
 *   5. At most MAX_TRIALS referee trials per decision. If the budget runs out or no effect passes, the best-ranked plan
 *      WITHOUT an effect is chosen (the policy's own no-effect candidate, which every forked policy ranks), and the
 *      fallback is recorded in the decision meta.
 * Then the chosen plan goes through aiTurnV6 exactly like any other: refereeV6 on the real state is still the only way an
 * effect is placed. The pre-check can only make the adapter more conservative, never place something the referee
 * would not; engine checks are never skipped and an unverified rule is never activated.
 */
import { type State, type Placement, inside, key } from './engine.ts';
import { type Player, resolveAIRuleText } from '../rules.ts';
import { type Weights } from '../weights.ts';
import { aiPhrase } from './forks/ai.ts';
import { planPolicy53, type Policy53, type Plan53 } from './forks/policies53.ts';
import { effectId } from '../weights.ts';
import { refereeV6 } from './turn.ts';

export const RA_ADAPTER = 'referee-aware-select@1' as const;
export const MAX_TRIALS = 3;

/** The local situation a referee verdict depends on most: proposer, effect, cells, the pieces and effects within 2 squares of them, turn parity. */
export function proposalKey(s: State, p: Player, pl: Placement): string {
  const cells = [...pl.cells].sort();
  const near = (x: number, y: number) => cells.some(c => { const [cx, cy] = c.split(',').map(Number); return Math.max(Math.abs(cx - x), Math.abs(cy - y)) <= 2; });
  const pcs = s.pieces.filter(q => !q.scored && near(q.x, q.y)).map(q => `${q.owner[0]}${q.x},${q.y}${q.frozen ? 'f' : ''}${q.shield ? 's' : ''}`).sort().join(';');
  const fx = Object.keys(s.cells).filter(k => { const [x, y] = k.split(',').map(Number); return near(x, y); }).sort().map(k => `${k}=${s.cells[k]}`).join(';');
  return `${p}|${effectId(pl.effect)}|${cells.join('+')}|${pcs}|${fx}`;
}

/** True when some new cell of pl could not be entered by the referee trial (see step 3). Pure. */
export function unenterableCell(s: State, pl: Placement): string | null {
  const after = new Set([...Object.keys(s.cells), ...pl.cells]);
  for (const c of pl.cells) {
    const [x, y] = c.split(',').map(Number);
    const free = ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).some(([dx, dy]) => inside(x + dx, y + dy) && !after.has(key(x + dx, y + dy)));
    if (!free) return c;
  }
  return null;
}
export type RAMemo = Map<string, { final: string; code: string | null; turn: number }>;
export type RAMeta = { adapter: typeof RA_ADAPTER; policyChoice: string; chosenRank: number; trials: number; skippedKnownBlocked: number; skippedUnenterable: number; rejectedByPrecheck: { rank: number; final: string; code: string | null }[]; fallback: string | null; precheckMs: number };

const toPlacement = (s: State, pl: NonNullable<Plan53['chosen']['placement']>): Placement => {
  const rt = resolveAIRuleText(pl.effect, aiPhrase(pl.effect, s.turn + s.seed));
  return { text: rt.text, effect: pl.effect, cells: pl.cells, interpretedBy: 'engine canonical text (V6 opponent)' };
};

/** Picks among an already-computed policy plan's ranked options. `memo` persists for one game (repeat suppression). */
export function selectRefereeAware(s: State, me: Player, plan: Plan53, memo: RAMemo): Plan53 & { ra: RAMeta } {
  const t0 = performance.now();
  const meta: RAMeta = { adapter: RA_ADAPTER, policyChoice: plan.chosen.summary, chosenRank: 0, trials: 0, skippedKnownBlocked: 0, skippedUnenterable: 0, rejectedByPrecheck: [], fallback: null, precheckMs: 0 };
  const ranked = plan.ranked.length ? plan.ranked : [plan.chosen];
  // the policy's own choice first, then the rest of its ranking in order
  const order = [plan.chosen, ...ranked.filter(c => c !== plan.chosen)];
  let pick: Plan53['chosen'] | null = null, rank = 0;
  for (const c of order) {
    rank++;
    if (!c.placement) { pick = c; break; }
    const pl = toPlacement(s, c.placement), k = proposalKey(s, me, pl), known = memo.get(k);
    if (known && known.final !== 'engine-approved') { meta.skippedKnownBlocked++; continue; }
    if (known?.final === 'engine-approved') { pick = c; break; }
    if (unenterableCell(s, pl)) { meta.skippedUnenterable++; memo.set(k, { final: 'unverified', code: 'tier-3-unenterable', turn: s.turn }); continue; }
    if (meta.trials >= MAX_TRIALS) { meta.fallback = `trial budget (${MAX_TRIALS}) used up`; break; }
    meta.trials++;
    const copy = structuredClone(s); copy.phase = 'place';
    const v = refereeV6(copy, me, pl, { keepTrial: false }).verdict;
    memo.set(k, { final: v.final, code: v.code, turn: s.turn });
    if (v.activated) { pick = c; break; }
    meta.rejectedByPrecheck.push({ rank, final: v.final, code: v.code });
  }
  if (!pick) {
    const none = order.find(c => !c.placement);
    if (none) { pick = none; meta.fallback = `${meta.fallback ?? 'no effect passed the referee pre-check'}: best plan without an effect chosen`; }
    else { pick = plan.chosen; meta.fallback = `${meta.fallback ?? 'no effect passed the pre-check'} and the policy ranked no effect-free plan: policy choice kept (the referee decides as usual)`; }
  }
  meta.chosenRank = order.indexOf(pick) + 1;
  meta.precheckMs = Math.round(performance.now() - t0);
  return { ...plan, chosen: pick, ra: meta };
}

/** The adapter as a decision function for aiTurnV6 (in-process). */
export function decideRA(memo: RAMemo, w: Weights) {
  return async (policy: Policy53, s: State, me: Player) => selectRefereeAware(s, me, planPolicy53(policy, structuredClone(s), me, w), memo);
}

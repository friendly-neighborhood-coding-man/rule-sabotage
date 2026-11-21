/**
 * V6 shared turn machinery (EXPERIMENTAL-V6-NOT-PRODUCTION): ONE referee for both sides, the opponent's turn executor,
 * and the zero-move diagnosis. Used by the playable V6 server (session.ts), V6 self-play (selfplay.ts) and the tests,
 * so what is tested is what is played.
 *
 * Referee (identical for the human and the AI, function refereeV6):
 *   1. validatePlacement on the V6 engine: occupancy, opponent effect, 1..3 cells, and rule A1 (no new effect within
 *      Chebyshev distance 1 of an opposing piece). A violation is rejected before anything else runs.
 *   2. the sandbox trial (fork of server/trial.ts) and its engine checks E1..E6;
 *   3. the referee tier (fork of server/tiers.ts): tier 1/2 = engine-approved and placed, tier 3 = not placed
 *      (needs Kane, and Kane is never called in V6). This is the PR #14 Option A engine-only policy.
 *
 * Opponent turn (aiTurnV6): the forked V5.3 policy picks a placement and a first move sequence; the placement goes
 * through refereeV6; moves are played by the shared forked executor (moves53), re-planning after every teleport, as in
 * the V5.3 self-play loop and the PR #14 playtest.
 */
import {
  type State, type Placement, type Move, type GameEvent, applyPlacement, applyMove, endTurn, validatePlacement, validateMove, legalMoves,
  onBoard, cellName, protectedCells, eligibleCells,
} from './engine.ts';
import { type Player, shortLabel, resolveAIRuleText } from '../rules.ts';
import { type Weights } from '../weights.ts';
import { aiPhrase } from './forks/ai.ts';
import { buildTrial, renderTrialPage, type Trial } from './forks/trial.ts';
import { selectTier, type TierDecision } from './forks/tiers.ts';
import { planPolicy53, moves53, type Policy53, type Plan53, type Meta } from './forks/policies53.ts';
import { evaluateCached, newCtx, moveOutcomes } from './forks/evplanner.ts';
import { K1 } from './forks/evk11.ts';
import { withFastClone } from './fastclone.ts';

/**
 * V6.2 latency, semantics-preserving: the copy of the state a policy plans on. The planners copy the state thousands of
 * times per decision (once per enumerated teleport destination), and the full game state carries history no planner
 * reads: burnt rules (no cells left), the per-turn statistics, and the rules' display text. Dropping exactly those
 * leaves every value a decision depends on unchanged: piece positions and status, live effects (id, owner, effect,
 * cells), turn, actions, bonus, rule ids (nextId), the RNG field and the ruleset. tests/v6-2.test.ts and
 * scripts/v6-2-profile.ts check that decisions are identical with and without it.
 */
export function planningView(s: State): State {
  const v = structuredClone(s);
  v.rules = v.rules.filter(r => r.cells.length).map(r => ({ ...r, text: '', summary: '', interpretedBy: '', ...(r.approxNote !== undefined ? { approxNote: '' } : {}) }));
  v.stats = { activePerTurn: [] }; v.log = [];
  return v;
}

export type RefVerdict = {
  player: Player; ruleText: string; label: string; cells: string[];
  final: 'engine-approved' | 'rejected' | 'unverified' | 'illegal';
  /** 'rule' = rejected by validatePlacement before the trial (for example rule A1); 'engine' = trial/tier. */
  stage: 'rule' | 'engine'; code: string | null; tier: number | null; message: string; activated: boolean; placedCells: string[]; trialId: string | null;
  /** V6.2 (additive, for telemetry and Kane shadow cases): turn, the typed effect and cell keys judged, referee wall time. */
  turn?: number; effect?: Placement['effect']; cellKeys?: string[]; ms?: number;
};
export const trials = new Map<string, { trial: Trial; html: string }>();
let trialNo = 6000;

/** The one referee. Applies the placement if (and only if) it is legal and engine-approved. */
export function refereeV6(s: State, p: Player, pl: Placement, opts: { keepTrial?: boolean } = {}): { verdict: RefVerdict; events: GameEvent[] } {
  const t0 = performance.now();
  const r = refereeCore(s, p, pl, opts);
  Object.assign(r.verdict, { turn: s.turn, effect: structuredClone(pl.effect), cellKeys: Array.isArray(pl.cells) ? [...pl.cells] : [], ms: Math.round(performance.now() - t0) });
  return r;
}
function refereeCore(s: State, p: Player, pl: Placement, opts: { keepTrial?: boolean }): { verdict: RefVerdict; events: GameEvent[] } {
  const base = { player: p, ruleText: pl.text, label: shortLabel(pl.effect), cells: pl.cells.map(c => (typeof c === 'string' && /^\d+,\d+$/.test(c) ? cellName(c) : String(c))) };
  const c = validatePlacement(s, p, pl);
  if (!c.ok) return { verdict: { ...base, final: 'illegal', stage: 'rule', code: c.code ?? 'invalid', tier: null, message: c.reason, activated: false, placedCells: [], trialId: null }, events: [] };
  const trial = buildTrial(s, p, pl, ++trialNo);
  if (opts.keepTrial !== false) { trials.set(trial.trialId, { trial, html: renderTrialPage(trial) }); if (trials.size > 300) trials.delete(trials.keys().next().value!); }
  const failed = trial.engineChecks.find(x => !x.pass);
  if (failed) return { verdict: { ...base, final: 'rejected', stage: 'engine', code: failed.id, tier: null, message: `Engine safety check failed: ${failed.text} (${failed.detail}).`, activated: false, placedCells: [], trialId: trial.trialId }, events: [] };
  const t: TierDecision = selectTier(s, p, pl, trial);
  if (t.tier < 3) {
    const events = applyPlacement(s, p, pl);
    return { verdict: { ...base, final: 'engine-approved', stage: 'engine', code: null, tier: t.tier, message: `Engine-approved (tier ${t.tier}). Not reviewed by Kane: ${t.reasons.join('; ')}.`, activated: true, placedCells: pl.cells.map(cellName), trialId: trial.trialId }, events };
  }
  return { verdict: { ...base, final: 'unverified', stage: 'engine', code: 'tier-3', tier: 3, message: `Not placed. This rule needs Kane review (tier 3: ${t.reasons.join('; ')}); V6 never calls Kane, so unverified rules never go live.`, activated: false, placedCells: [], trialId: trial.trialId }, events: [] };
}

/**
 * Zero-move diagnosis. A turn in which the mover made no move is classified as exactly one of:
 *  - no-legal-move     the engine offered no legal move (no piece on the board, or every piece frozen);
 *  - unfavorable       legal moves existed, but the policy's executor judged every one worse than standing still
 *                      (its stop rule: best expected value < value of standing still - 0.25); bestDelta is that margin;
 *  - planner-error     the policy threw, or proposed a move the engine refused.
 */
export type ZeroMove = { kind: 'no-legal-move' | 'unfavorable' | 'planner-error'; detail: string; legalMoves: number; frozen: number; onBoard: number; bestDelta?: number };
export function diagnoseZeroMoves(s: State, p: Player, w: Weights, error: string | null): ZeroMove {
  const on = onBoard(s, p), frozen = on.filter(q => q.frozen > 0).length, legal = legalMoves(s, p);
  if (error) return { kind: 'planner-error', detail: error, legalMoves: legal.length, frozen, onBoard: on.length };
  if (!legal.length) return { kind: 'no-legal-move', detail: !on.length ? 'no piece on the board' : frozen === on.length ? `all ${on.length} piece(s) frozen` : s.actionsLeft <= 0 ? 'no actions left' : 'no legal move', legalMoves: 0, frozen, onBoard: on.length };
  const ctx = newCtx(w, 16, K1); ctx.me = p;
  const base = evaluateCached(s, p, ctx);
  let best = -Infinity;
  for (const m of legal) { const v = moveOutcomes(s, p, m).reduce((a, o) => a + o.p * evaluateCached(o.state, p, ctx), 0); if (v > best) best = v; }
  const bestDelta = Math.round((best - base) * 1000) / 1000;
  return { kind: 'unfavorable', detail: `${legal.length} legal move(s); the best one changes the policy's evaluation by ${bestDelta} (it stops when that is below -0.25)`, legalMoves: legal.length, frozen, onBoard: on.length, bestDelta };
}

export type AITurn = {
  policy: Policy53; plan: Pick<Plan53, 'candidates' | 'sims' | 'meta'> & { chosen: string; score: number; ranked: { id: string; summary: string; score: number }[] } | null;
  plannerMs: number; executorMs: number; verdict: RefVerdict | null; placementBlocked: string | null; events: GameEvent[]; endEvents: GameEvent[]; moves: Move[]; replans: number;
  /** Candidate placements the policy could choose from this turn (incl. "no effect"), and cells A1 protected. */
  candidatePlacements: number; protectedCells: number; eligibleCells: number;
  zeroMoves: ZeroMove | null; error: string | null;
  /** V6.2 referee-aware adapter metadata, when that adapter made the decision. */
  ra?: unknown;
};

/**
 * The opponent's whole turn on the real state `s` (mutated). `decide` defaults to the in-process forked policy; the
 * playable server passes a worker-backed equivalent so the page stays responsive.
 */
export async function aiTurnV6(s: State, me: Player, policy: Policy53, w: Weights, decide?: (policy: Policy53, s: State, me: Player) => Promise<Plan53>): Promise<AITurn> {
  const t0 = performance.now();
  const prot = protectedCells(s, me).length, elig = eligibleCells(s, me).length;
  let plan: Plan53 | null = null, error: string | null = null;
  try { plan = decide ? await decide(policy, planningView(s), me) : withFastClone(() => planPolicy53(policy, planningView(s), me, w)); } catch (e) { error = `policy threw: ${(e as Error).message}`; }
  const plannerMs = Math.round(performance.now() - t0);
  const events: GameEvent[] = [];
  let verdict: RefVerdict | null = null, blocked: string | null = null;
  if (plan?.chosen.placement) {
    const planned = plan.chosen.placement.effect;
    const rt = resolveAIRuleText(planned, aiPhrase(planned, s.turn + s.seed));
    const pl: Placement = { text: rt.text, effect: planned, cells: plan.chosen.placement.cells, interpretedBy: 'engine canonical text (V6 opponent)' };
    const r = refereeV6(s, me, pl);
    verdict = r.verdict; events.push(...r.events);
    if (!r.verdict.activated) blocked = `${r.verdict.final}: ${r.verdict.message}`;
  }
  if (s.phase === 'place') s.phase = 'move';
  const e0 = performance.now();
  const executed: Move[] = [];
  let replans = 0;
  if (!error) {
    try {
      let nx = withFastClone(() => moves53(planningView(s), me, w)), moves = nx.moves, mi = 0, done = !nx.endsAtChance;
      while (mi < moves.length || (!done && !s.winner && s.current === me && s.actionsLeft > 0)) {
        if (mi >= moves.length) { nx = withFastClone(() => moves53(planningView(s), me, w)); moves = nx.moves; mi = 0; done = !nx.endsAtChance; replans++; if (!moves.length) break; }
        const m = moves[mi++];
        if (s.winner || s.current !== me) break;
        const v = validateMove(s, me, m);
        if (!v.ok) { error = `executor proposed an illegal move ${cellName(m.from)} ${m.dir}: ${v.reason}`; break; }
        const evt = applyMove(s, me, m);
        events.push(...evt); executed.push(m);
        if (evt.some(e => e.t === 'forced' && e.how === 'teleport') && mi < moves.length) { moves = moves.slice(0, mi); done = false; }
      }
    } catch (e) { error = `executor threw: ${(e as Error).message}`; }
  }
  const zeroMoves = executed.length === 0 && !s.winner ? diagnoseZeroMoves(s, me, w, error) : null;
  const executorMs = Math.round(performance.now() - e0);
  const endEvents = s.winner ? [] : endTurn(s);
  return {
    policy, plannerMs, executorMs, verdict, placementBlocked: blocked, events, endEvents, moves: executed, replans,
    plan: plan ? { candidates: plan.candidates, sims: plan.sims, meta: plan.meta, chosen: plan.chosen.summary, score: plan.chosen.score, ranked: plan.ranked.slice(0, 6).map(c => ({ id: c.id, summary: c.summary, score: c.score })) } : null,
    candidatePlacements: plan?.candidates ?? 0, protectedCells: prot, eligibleCells: elig, zeroMoves, error, ...(plan && 'ra' in plan ? { ra: (plan as { ra: unknown }).ra } : {}),
  };
}
export type { Policy53, Meta };

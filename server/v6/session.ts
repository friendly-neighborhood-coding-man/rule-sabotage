/**
 * V6 playable game sessions (EXPERIMENTAL-V6-NOT-PRODUCTION). In memory only: nothing is written to disk, no Kane, no
 * language model, no network. The human's text is read by the offline parser; both sides' effects go through the same
 * refereeV6 (turn.ts), which enforces rule A1 server-side before the engine-only referee runs.
 */
import { randomUUID, randomInt } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  type State, type Placement, type Move, type GameEvent, init, applyPlacement, applyMove, validatePlacement, validateMove, endTurn,
  publicView, legalMoves, cellName, V6_MODE, RULESET, RULESETS, A1_EXPLANATION,
} from './engine.ts';
import { type Player, type Interpretation, offlineInterpret, shortLabel, MAX_CELLS_PER_TURN } from '../rules.ts';
import { loadWeights } from '../weights.ts';
import { reactionsFor, achievementsFor } from './forks/flavor.ts';
import { refereeV6, aiTurnV6, type AITurn, type RefVerdict } from './turn.ts';
import { type Policy53, type Plan53 } from './forks/policies53.ts';
import { OPPONENTS_V6, isOpponentV6, type OpponentV6 } from './opponents.ts';
import { isHoldout, HOLDOUT } from './selfplay.ts';
import { PlannerPool, decideBudgeted } from './budgeted.ts';
import type { RAMemo } from './referee-aware.ts';
import { type PSessionV6, captureShadow, saveGameRecord, V6_TELEMETRY_SCHEMA } from './pilot.ts';
import { scored as scoredN } from './engine.ts';

const W = loadWeights();

// ---------- planner worker (keeps the server responsive while OA-v3 searches) ----------
let worker: Worker | null = null, nextId = 0;
const waiting = new Map<number, { ok: (p: Plan53) => void; err: (e: Error) => void }>();
function planner(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./planworker.ts', import.meta.url));
  worker.on('message', (r: { id: number; ok: boolean; plan?: Plan53; error?: string }) => { const w = waiting.get(r.id); waiting.delete(r.id); if (!w) return; r.ok ? w.ok(r.plan!) : w.err(new Error(r.error)); });
  worker.on('error', e => { for (const [, w] of waiting) w.err(new Error(`planner worker failed: ${e.message}`)); waiting.clear(); worker = null; });
  worker.unref();
  return worker;
}
const decideInWorker = (adapter?: string, gameId?: string) => (policy: Policy53, s: State, me: Player) => new Promise<Plan53>((ok, err) => { const id = ++nextId; waiting.set(id, { ok, err }); planner().postMessage({ id, policy, state: s, me, adapter, gameId }); });
export function stopPlanner() { worker?.terminate(); worker = null; }

export type GameV6 = {
  id: string; state: State; opponent: OpponentV6; busy: boolean; thinkingSince: number | null;
  interpretations: Map<string, { text: string; interpretation: Interpretation }>; turnEvents: GameEvent[];
  verdicts: RefVerdict[]; aiTurns: (Omit<AITurn, 'events' | 'endEvents'> & { turn: number })[];
  history: { turn: number; p: Player; events: GameEvent[]; verdicts: never[] }[]; achievements: Record<Player, { title: string; detail: string }[]>;
  humanRejections: { turn: number; reason: string; code: string | null }[];
  /** V6.2 pilot readiness: the consenting session (null = not recorded), lifecycle and the record state. */
  /** V6.3 latency-bounded prototype: its own planner pool (active + warm spare) and repeat-suppression memo. */
  pool?: PlannerPool; raMemo?: RAMemo;
  session: PSessionV6 | null; startedAt: number; endedAt: number | null; abandoned: boolean; saved: boolean; feedback: 'none' | 'submitted' | 'skipped';
};
const games = new Map<string, GameV6>();
export const getGame = (id: string) => games.get(id);
export function freeSeed(): number { for (;;) { const s = randomInt(1, 2 ** 31 - 1); if (!isHoldout(s)) return s; } }
const fail = (status: number, reason: string) => Object.assign(new Error(reason), { status });

export function view(g: GameV6) {
  const s = g.state;
  return {
    mode: V6_MODE, gameId: g.id, ...publicView(s), busy: g.busy, thinkingMs: g.thinkingSince ? Date.now() - g.thinkingSince : null,
    legal: legalMoves(s, 'human'), maxCells: MAX_CELLS_PER_TURN, refereeMode: 'engine-only', refereeTiers: true,
    achievements: g.achievements, opponent: { id: g.opponent.id, label: g.opponent.label, version: g.opponent.version },
    reviews: g.verdicts.slice(-8), lastAI: g.aiTurns.at(-1) ?? null, seed: s.seed,
  };
}

export async function startGame(o: { opponent: unknown; first?: unknown; seed?: unknown; ruleset?: unknown; session?: PSessionV6 | null }) {
  if (!isOpponentV6(o.opponent)) throw fail(422, 'Unknown opponent.');
  // 'v6' = rule A1 (opponent pieces only), 'v6.1' = rule A2 (every piece). Default: V6 (A1), as before.
  if (o.ruleset !== undefined && o.ruleset !== 'v6' && o.ruleset !== 'v6.1') throw fail(422, 'Unknown ruleset (v6 or v6.1).');
  const ruleset = RULESETS[(o.ruleset as 'v6' | 'v6.1' | undefined) ?? 'v6'];
  const seed = Number.isInteger(o.seed) ? (o.seed as number) : freeSeed();
  if (isHoldout(seed)) throw fail(422, `Seed ${seed} is in the reserved holdout range ${HOLDOUT.from}–${HOLDOUT.to}.`);
  const first: Player = o.first === 'human' || o.first === 'ai' ? o.first : randomInt(2) === 0 ? 'human' : 'ai';
  const g: GameV6 = {
    id: randomUUID(), state: init(seed, { first, ruleset }), opponent: OPPONENTS_V6[o.opponent], busy: false, thinkingSince: null, interpretations: new Map(), turnEvents: [],
    verdicts: [], aiTurns: [], history: [], achievements: { human: [], ai: [] }, humanRejections: [],
    session: o.session ?? null, startedAt: Date.now(), endedAt: null, abandoned: false, saved: false, feedback: 'none',
  };
  o.session?.games.push(g.id);
  games.set(g.id, g);
  if (games.size > 100) games.delete(games.keys().next().value!);
  let ai = null;
  if (g.state.current === 'ai') { g.busy = true; try { ai = await aiTurn(g); } finally { g.busy = false; } }
  return { ...view(g), ai };
}

function guard(g: GameV6) {
  if (g.busy) throw fail(409, 'Busy, one moment.');
  if (g.state.winner) throw fail(409, 'The game is over. Start a new game.');
  if (g.state.current !== 'human') throw fail(409, 'Not your turn.');
}
export function preview(g: GameV6, text: string) {
  const i = offlineInterpret(text);
  const token = randomUUID();
  if (i.status !== 'reject') g.interpretations.set(token, { text: text.trim(), interpretation: i });
  return { token: i.status === 'reject' ? null : token, interpretation: i, fallback: null, ms: 0, ...(i.status !== 'reject' ? { label: shortLabel(i.effect), maxCells: MAX_CELLS_PER_TURN } : {}) };
}

/** Human removals and/or one new effect. A rule violation (including A1) is refused with 422 and costs nothing. */
export function placeHuman(g: GameV6, req: { token?: string; cells?: string[]; remove?: string[] }) {
  guard(g);
  const s = g.state;
  let pl: Placement | null = null;
  if (req.token) {
    const pend = g.interpretations.get(req.token);
    if (!pend || pend.interpretation.status === 'reject') throw fail(422, 'Interpret the rule first.');
    const i = pend.interpretation;
    pl = { text: pend.text, effect: i.effect, cells: req.cells ?? [], interpretedBy: i.source, ...(i.status === 'approximate' ? { approxNote: i.note } : {}) };
  }
  const remove = req.remove ?? [];
  const c = validatePlacement(s, 'human', pl, remove);
  if (!c.ok) { g.humanRejections.push({ turn: s.turn, reason: c.reason, code: c.code ?? null }); throw Object.assign(fail(422, c.reason), { code: c.code ?? null, cell: c.cell ?? null }); }
  const events = applyPlacement(s, 'human', null, remove);
  const verdicts: RefVerdict[] = [];
  if (pl) {
    s.phase = 'place'; // the removals above must not end the placement step
    const r = refereeV6(s, 'human', pl);
    verdicts.push(r.verdict); g.verdicts.push(r.verdict); events.push(...r.events);
    s.phase = 'move';
    captureShadow(g.session, { ruleset: s.ruleset, gameId: g.id, proposer: 'human', verdict: r.verdict, text: pl.text });
  }
  g.turnEvents.push(...events);
  return { events, verdicts, view: view(g) };
}
export function moveHuman(g: GameV6, m: Move) {
  guard(g);
  const c = validateMove(g.state, 'human', m);
  if (!c.ok) throw fail(422, c.reason);
  const events = applyMove(g.state, 'human', m);
  g.turnEvents.push(...events);
  if (g.state.winner) finish(g);
  return { events, reactions: reactionsFor(events), view: view(g) };
}
export async function endHuman(g: GameV6) {
  guard(g);
  g.busy = true;
  try {
    const endEv = endTurn(g.state);
    g.history.push({ turn: g.state.turn - 1, p: 'human', events: [...g.turnEvents, ...endEv], verdicts: [] });
    g.turnEvents = [];
    const ai = g.state.winner ? null : await aiTurn(g);
    if (g.state.winner) finish(g);
    return { humanEnd: endEv, ai, view: view(g) };
  } finally { g.busy = false; }
}
function finish(g: GameV6) {
  g.achievements = achievementsFor(g.state as never, g.history.concat([{ turn: g.state.turn, p: g.state.current, events: g.turnEvents, verdicts: [] }]) as never) as GameV6['achievements'];
  if (g.turnEvents.length) { g.history.push({ turn: g.state.turn, p: 'human', events: g.turnEvents, verdicts: [] }); g.turnEvents = []; }
  g.endedAt = Date.now(); persist(g);
}
/** A game left unfinished (new game, session end) is recorded as abandoned, never dropped. */
export function abandon(g: GameV6) {
  if (g.endedAt || g.state.winner || g.busy) return;
  g.abandoned = true; g.endedAt = Date.now(); persist(g); void g.pool?.close();
}
function persist(g: GameV6) { if (g.saved) return; g.saved = true; saveGameRecord(g.session, record(g)); }

/** Gameplay FACTS only, derived from the engine: no subjective field. */
export function record(g: GameV6) {
  const s = g.state;
  const evs = g.history.flatMap(h => h.events.map(e => ({ p: h.p, e })));
  const trig = evs.filter(x => x.e.t === 'trigger').map(x => x.e as Extract<GameEvent, { t: 'trigger' }>);
  const aiMs = g.aiTurns.map(t => t.plannerMs).sort((a, b) => a - b);
  const q = (p: number) => (aiMs.length ? aiMs[Math.min(aiMs.length - 1, Math.floor(p * (aiMs.length - 1) + 0.5))] : null);
  const v = (p: Player) => g.verdicts.filter(x => x.player === p);
  return {
    schema: V6_TELEMETRY_SCHEMA, kind: 'telemetry', mode: V6_MODE, ruleset: s.ruleset, gameId: g.id, sessionId: g.session?.id ?? null, participant: g.session?.participant ?? null,
    opponent: { id: g.opponent.id, version: g.opponent.version, frozenReference: g.opponent.frozenReference },
    rules: { referee: 'engine-only (tier 1/2 placed, tier 3 not placed; no Kane, no LLM)', interpreter: 'offline parser', maxTurns: s.maxTurns },
    seed: s.seed, first: s.firstPlayer, startedAt: new Date(g.startedAt).toISOString(), endedAt: g.endedAt ? new Date(g.endedAt).toISOString() : null, durationMs: (g.endedAt ?? Date.now()) - g.startedAt,
    result: { winner: s.winner, reason: s.winReason || (g.abandoned ? 'abandoned' : ''), abandoned: g.abandoned, turnLimit: /Turn limit/.test(s.winReason || ''), turns: s.turn, scored: { human: scoredN(s, 'human'), ai: scoredN(s, 'ai') } },
    placements: {
      human: { attempts: v('human').length + g.humanRejections.filter(r => r.code).length, refusedByPlacementRule: g.humanRejections.filter(r => r.code).map(r => ({ turn: r.turn, code: r.code })), placed: v('human').filter(x => x.activated).length, notPlaced: v('human').filter(x => !x.activated).map(x => ({ turn: x.turn, final: x.final, code: x.code })) },
      ai: { attempts: v('ai').length, placed: v('ai').filter(x => x.activated).length, notPlaced: v('ai').filter(x => !x.activated).map(x => ({ turn: x.turn, final: x.final, code: x.code, label: x.label, cells: x.cells })) },
    },
    interactions: { triggers: trig.length, selfTriggers: trig.filter(t => t.self).length, chains: trig.filter(t => t.chain > 1).length, captures: evs.filter(x => x.e.t === 'capture').length },
    // the opponent's first turn: its effect proposal (and whether it was placed) plus its moves, for counting repeated openings
    opening: { ai: (() => { const t = g.history.find(h => h.p === 'ai'); if (!t) return null; const v0 = g.verdicts.find(x => x.player === 'ai' && x.turn === t.turn); return [v0 ? `p${v0.label}@${v0.cells.join('+')}${v0.activated ? '' : '(not placed)'}` : 'p-none', ...t.events.filter(e => e.t === 'move').map(e => `m${cellName((e as { from: string }).from)}>${cellName((e as { to: string }).to)}`)].join(','); })() },
    ai: { deadline: g.aiTurns.filter(t => t.budget).map(t => ({ turn: t.turn, ...(t.budget as object) })), referee: { attempts: v('ai').length, notPlaced: v('ai').filter(x => !x.activated).length, rate: v('ai').length ? Math.round((v('ai').filter(x => !x.activated).length / v('ai').length) * 1000) / 1000 : null }, turns: g.aiTurns.length, latencyMs: { median: q(0.5), p90: q(0.9), max: aiMs.at(-1) ?? null, over10s: aiMs.filter(x => x > 10_000).length }, zeroMoveTurns: g.aiTurns.filter(t => t.zeroMoves).map(t => ({ turn: t.turn, kind: t.zeroMoves!.kind })), errors: g.aiTurns.filter(t => t.error).map(t => ({ turn: t.turn, error: t.error })) },
    turns: g.history.map(h => ({ turn: h.turn, p: h.p, events: h.events.map(e => e.t + ('cell' in e && typeof e.cell === 'string' ? ` ${cellName(e.cell)}` : '') + ('from' in e && 'to' in e && e.t === 'move' ? ` ${cellName(e.from)}>${cellName(e.to)}` : '')) })),
  };
}

const raText = (ra: unknown) => {
  if (!ra) return '';
  const m = ra as { chosenRank: number; trials: number; skippedKnownBlocked: number; fallback: string | null };
  return ` Referee-aware: played its rank-${m.chosenRank} plan after ${m.trials} referee pre-check(s)${m.skippedKnownBlocked ? `, skipped ${m.skippedKnownBlocked} known-blocked proposal(s)` : ''}${m.fallback ? ` (${m.fallback})` : ''}.`;
};
const budgetText = (b: unknown) => {
  if (!b) return '';
  const m = b as { outcome: string; plannerMs: number; fallback: string | null; precheck: { trials: number } };
  return ` Deadline prototype: ${m.outcome} (planner ${(m.plannerMs / 1000).toFixed(1)} s, ${m.precheck.trials} pre-check(s))${m.fallback ? `; fallback: ${m.fallback}` : ''}.`;
};
async function aiTurn(g: GameV6) {
  const s = g.state, turn = s.turn;
  g.thinkingSince = Date.now();
  let r: AITurn;
  const decide = g.opponent.adapter === 'latency-bounded@1' ? decideBudgeted((g.pool ??= new PlannerPool()), (g.raMemo ??= new Map())) : decideInWorker(g.opponent.adapter, g.id);
  try { r = await aiTurnV6(s, 'ai', g.opponent.policy, W, decide); } finally { g.thinkingSince = null; }
  if (s.winner) void g.pool?.close();
  const { events, endEvents, ...rest } = r;
  g.aiTurns.push({ ...rest, turn });
  if (r.verdict) { g.verdicts.push(r.verdict); captureShadow(g.session, { ruleset: s.ruleset, gameId: g.id, proposer: 'ai', verdict: r.verdict, text: r.verdict.ruleText }); }
  g.history.push({ turn, p: 'ai', events: [...events.filter(e => e.t !== 'place'), ...endEvents], verdicts: [] });
  const o = g.opponent;
  const zero = r.zeroMoves ? ` It made no move: ${r.zeroMoves.kind === 'no-legal-move' ? `no legal move (${r.zeroMoves.detail})` : r.zeroMoves.kind === 'unfavorable' ? `it judged every legal move worse than standing still (${r.zeroMoves.detail})` : `planner error (${r.zeroMoves.detail})`}.` : '';
  const decision = {
    source: 'local-planner', model: null, fallbackReason: null, taunt: '',
    rationale: `${o.label} [${o.version}] decided in ${(r.plannerMs / 1000).toFixed(1)} s from ${r.candidatePlacements} candidate turn plans; ${r.protectedCells} squares were closed to its new effects by the proximity rule.${r.placementBlocked ? ` Its effect was not placed (${r.placementBlocked}).` : ''}${zero}${raText(r.ra)}${budgetText(r.budget)}`,
    plan: { candidates: r.candidatePlacements, sims: r.plan?.sims ?? 0, ms: r.plannerMs, chosen: r.plan?.chosen ?? '(no plan)', score: Math.round((r.plan?.score ?? 0) * 100) / 100 },
    ruleText: r.verdict?.ruleText ?? null, ruleInterpretation: null, decidedAt: new Date().toISOString(), ms: r.plannerMs + r.executorMs,
  };
  return { events, endEvents, verdicts: r.verdict ? [r.verdict] : [], decision, reactions: reactionsFor(events), diagnosis: { zeroMoves: r.zeroMoves, error: r.error, placementBlocked: r.placementBlocked, plannerMs: r.plannerMs, budgetHit: !!r.plan?.meta.budgetHit, adapter: r.ra ?? null, deadline: r.budget ?? null } };
}
export { A1_EXPLANATION, RULESET, cellName };

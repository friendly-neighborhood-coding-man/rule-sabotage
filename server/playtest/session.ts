/**
 * Playtest game sessions (PLAYTEST-ONLY). The rules are the production engine's, unchanged: same board, pieces, effects,
 * scoring, 60-turn limit and starting position. What differs from the production game, and only here:
 *
 *  - the opponent is one of the frozen V5.3 self-play policies (opponents.ts), chosen explicitly, never substituted;
 *  - the first mover is assigned (pilot schedule) or drawn by a coin flip, instead of derived from the seed;
 *  - no Kane and no language model: the human's text goes through the offline parser, and BOTH players' effects go
 *    through the same engine-only referee (tier 1/2 engine-approved, tier 3 not placed), exactly the production
 *    engine-only path. The production planner (ai.ts) is not used for decisions;
 *  - every turn is recorded for the match review, and written to disk only with consent (telemetry.ts).
 *
 * The opponent's turn is executed exactly as in the V5.3 self-play loop (server/balance/selfplay.ts): placement chosen by
 * planPolicy53, moves by the shared executor moves53, which re-plans after every teleport from the now public position.
 */
import { randomUUID, randomInt } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  type State, type Placement, type GameEvent, type Move, init, applyPlacement, applyMove, endTurn, validatePlacement, validateMove,
  cellName, distanceLeft, scored as scoredN,
} from '../engine.ts';
import { type Player, shortLabel, resolveAIRuleText } from '../rules.ts';
import { aiPhrase } from '../ai.ts';
import { buildTrial, renderTrialPage } from '../trial.ts';
import { selectTier } from '../tiers.ts';
import { reactionsFor, achievementsFor } from '../flavor.ts';
import { newGame, view, preview, placeHuman, moveHuman, trials, type Game, type Verdict, type AIDecision } from '../game.ts';
import { moves53, type Policy53, type Meta } from '../balance/v5_3/policies.ts';
import { loadWeights } from '../weights.ts';
import { opponentInfo, PLAYTEST_MODE, PLAYTEST_SCHEMA } from './opponents.ts';
import { saveGame } from './telemetry.ts';

const W = loadWeights();
export const HOLDOUT = { from: 65001, to: 65060 } as const;
export const isHoldout = (seed: number) => seed >= HOLDOUT.from && seed <= HOLDOUT.to;
export function freeSeed(): number { for (;;) { const s = randomInt(1, 2 ** 31 - 1); if (!isHoldout(s)) return s; } }

// ---------- the planner worker ----------
type PlanReply = { id: number; ok: boolean; error?: string; wallMs: number; plan: { chosen: { placement: Placement | null; moves: Move[]; summary: string; score: number; id: string }; candidates: number; sims: number; meta: Meta; ranked: { id: string; summary: string; score: number }[] } };
let worker: Worker | null = null, nextId = 0;
const waiting = new Map<number, (r: PlanReply) => void>();
function planner(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./planworker.ts', import.meta.url));
  worker.on('message', (r: PlanReply) => { waiting.get(r.id)?.(r); waiting.delete(r.id); });
  worker.on('error', e => { for (const [id, f] of waiting) f({ id, ok: false, error: `planner worker failed: ${e.message}` } as PlanReply); waiting.clear(); worker = null; });
  worker.unref();
  return worker;
}
function decide(policy: Policy53, s: State, me: Player): Promise<PlanReply> {
  const id = ++nextId;
  return new Promise(res => { waiting.set(id, res); planner().postMessage({ id, policy, state: s, me }); });
}
export function stopPlanner() { worker?.terminate(); worker = null; }

// ---------- records ----------
export type TurnRec = {
  turn: number; p: Player; startedAt: number;
  placement: null | { text: string; effect: string; cells: string[]; interpretedBy: string; approx: string | null; verdict: Verdict['final']; tier: number | null; placed: string[] };
  removed: string[]; rejectedAttempts: { what: string; reason: string }[];
  moves: { from: string; dir: string; mode: string; msFromTurnStart: number; events: string[] }[];
  triggers: { mover: Player; owner: Player; self: boolean; kind: string; label: string; cell: string; chain: number; pieces: number }[];
  captures: { by: Player; cell: string; pieces: number }[]; scoredAfter: Record<Player, number>; lead: number;
  ai?: { policy: Policy53; wallMs: number; plannerMs: number; executorMs: number; candidates: number; sims: number; meta: Meta; chosen: string; topScores: number[]; replans: number; placementBlocked: string | null; error?: string };
  durationMs: number;
};
export type PlaytestGame = {
  g: Game; sessionId: string; recorded: boolean; opponent: Policy53; seed: number; first: Player; pilot: null | { participant: string; slot: number; of: number };
  startedAt: number; endedAt: number | null; abandoned: boolean; turns: TurnRec[]; current: TurnRec | null; thinking: null | { since: number };
  leadChanges: number; lastLead: number; trailed: Record<Player, boolean>; saved: boolean; feedback: 'none' | 'submitted' | 'skipped';
};
const games = new Map<string, PlaytestGame>();
export const getPlaytest = (gameId: string) => games.get(gameId);

const lead = (s: State) => Math.sign((scoredN(s, 'human') - scoredN(s, 'ai')) * 100 + (distanceLeft(s, 'ai') - distanceLeft(s, 'human')));
const evText = (e: GameEvent) => e.t + ('cell' in e && typeof e.cell === 'string' ? ` ${cellName(e.cell)}` : '') + (e.t === 'forced' ? ` ${e.how}` : '');
function openTurn(pg: PlaytestGame): TurnRec {
  const s = pg.g.state;
  return (pg.current = { turn: s.turn, p: s.current, startedAt: Date.now(), placement: null, removed: [], rejectedAttempts: [], moves: [], triggers: [], captures: [], scoredAfter: { human: 0, ai: 0 }, lead: 0, durationMs: 0 });
}
function noteEvents(t: TurnRec, events: GameEvent[]) {
  for (const e of events) {
    if (e.t === 'trigger') t.triggers.push({ mover: e.p, owner: e.owner, self: e.self, kind: e.kind, label: e.label, cell: cellName(e.cell), chain: e.chain, pieces: e.pieces.length });
    if (e.t === 'capture') t.captures.push({ by: e.by, cell: cellName(e.cell), pieces: e.pieces.length });
  }
}
function closeTurn(pg: PlaytestGame) {
  const t = pg.current; if (!t) return;
  const s = pg.g.state;
  t.durationMs = Date.now() - t.startedAt; t.scoredAfter = { human: scoredN(s, 'human'), ai: scoredN(s, 'ai') };
  const l = lead(s); t.lead = l;
  if (l !== 0 && pg.lastLead !== 0 && l !== pg.lastLead) pg.leadChanges++;
  if (l !== 0) pg.lastLead = l;
  if (t.turn > 4 && l !== 0) pg.trailed[l > 0 ? 'ai' : 'human'] = true;
  pg.turns.push(t); pg.current = null;
}

// ---------- engine-only referee (the production engine-only branch of game.ts referee(), for the opponent's effects) ----------
let trialNo = 5000;
function engineReferee(g: Game, s: State, p: Player, pl: Placement): { verdict: Verdict; events: GameEvent[] } {
  const submittedAt = Date.now();
  const trial = buildTrial(s, p, pl, ++trialNo);
  trials.set(trial.trialId, { trial, html: renderTrialPage(trial) });
  const verdict: Verdict = {
    reviewId: ++g.nextReview, player: p, ruleText: pl.text, label: shortLabel(pl.effect), cells: pl.cells.map(cellName), final: 'pending', message: '',
    decidedBy: null, tier: null, timing: { submittedAt, trialBuildMs: trial.buildMs, tierMs: null, resolvedAt: null, submitToVerdictMs: null },
    proposedTurn: s.turn, resolvedTurn: s.turn, placedCells: [], skippedCells: [],
    trial: { trialId: trial.trialId, buildMs: trial.buildMs, engineChecks: trial.engineChecks, scenarioIds: trial.scenarioIds }, kane: null, activated: false,
  };
  const rec = { verdict, events: [] as GameEvent[] };
  g.reviews.push(rec); if (g.reviews.length > 60) g.reviews.shift();
  const stamp = () => { verdict.timing.resolvedAt = Date.now(); verdict.timing.submitToVerdictMs = verdict.timing.resolvedAt - submittedAt; };
  const failed = trial.engineChecks.find(c => !c.pass);
  if (failed) { Object.assign(verdict, { final: 'rejected', decidedBy: 'engine', message: `Engine safety check failed: ${failed.text} (${failed.detail}).` }); stamp(); return rec; }
  const t = selectTier(s, p, pl, trial);
  verdict.tier = t; verdict.timing.tierMs = t.ms;
  if (t.tier < 3) {
    Object.assign(verdict, { final: 'engine-approved', decidedBy: 'engine', message: `Engine-approved (tier ${t.tier}). Not reviewed by Kane: ${t.reasons.join('; ')}.` });
    stamp();
    rec.events = applyPlacement(s, p, pl);
    verdict.activated = true; verdict.placedCells = pl.cells.map(cellName);
    return rec;
  }
  Object.assign(verdict, { final: 'unverified', decidedBy: 'engine-only', message: `Not placed. This rule needs Kane review (tier 3: ${t.reasons.join('; ')}) and the Kane referee is off in the playtest. Unverified rules never go live.` });
  stamp();
  return rec;
}

// ---------- lifecycle ----------
export function startPlaytest(o: { sessionId: string; recorded: boolean; opponent: Policy53; seed?: number; first?: Player; pilot?: PlaytestGame['pilot'] }): PlaytestGame {
  const seed = o.seed ?? freeSeed();
  if (isHoldout(seed)) throw Object.assign(new Error(`Seed ${seed} is in the reserved holdout range ${HOLDOUT.from}–${HOLDOUT.to}.`), { status: 422 });
  const first: Player = o.first ?? (randomInt(2) === 0 ? 'human' : 'ai');
  const g = newGame(seed);
  g.state = init(seed, { first }); // same rules and start; only the first mover is assigned explicitly
  const pg: PlaytestGame = { g, sessionId: o.sessionId, recorded: o.recorded, opponent: o.opponent, seed, first, pilot: o.pilot ?? null, startedAt: Date.now(), endedAt: null, abandoned: false, turns: [], current: null, thinking: null, leadChanges: 0, lastLead: 0, trailed: { human: false, ai: false }, saved: false, feedback: 'none' };
  games.set(g.id, pg);
  if (games.size > 300) games.delete(games.keys().next().value!);
  return pg;
}
export async function beginPlaytest(pg: PlaytestGame) {
  let ai = null;
  if (pg.g.state.current === 'ai') { pg.g.busy = true; try { ai = await aiTurn(pg); } finally { pg.g.busy = false; } }
  if (!pg.g.state.winner) openTurn(pg);
  return ai;
}

function guard(pg: PlaytestGame) {
  const g = pg.g;
  if (g.busy) throw Object.assign(new Error('Busy, one moment.'), { status: 409 });
  if (g.state.winner) throw Object.assign(new Error('The game is over. Start the next game.'), { status: 409 });
  if (g.state.current !== 'human') throw Object.assign(new Error('Not your turn.'), { status: 409 });
}
export async function humanPreview(pg: PlaytestGame, text: string) { return preview(pg.g, text); }
export async function humanPlace(pg: PlaytestGame, req: { token?: string; cells?: string[]; remove?: string[] }) {
  const t = pg.current ?? openTurn(pg);
  const pend = req.token ? pg.g.interpretations.get(req.token) : undefined;
  try {
    const r = await placeHuman(pg.g, req);
    t.removed.push(...(req.remove ?? []).map(cellName));
    const v = r.verdicts[0];
    if (pend && pend.interpretation.status !== 'reject') {
      const i = pend.interpretation;
      t.placement = { text: pend.text, effect: shortLabel(i.effect), cells: (req.cells ?? []).map(cellName), interpretedBy: i.source, approx: i.status === 'approximate' ? i.note : null, verdict: v?.final ?? 'pending', tier: v?.tier?.tier ?? null, placed: v?.placedCells ?? [] };
    }
    noteEvents(t, r.events);
    return r;
  } catch (e) { t.rejectedAttempts.push({ what: pend ? `place “${pend.text}”` : 'remove effects', reason: (e as Error).message.slice(0, 200) }); throw e; }
}
export function humanMove(pg: PlaytestGame, m: Move) {
  const t = pg.current ?? openTurn(pg);
  try {
    const r = moveHuman(pg.g, m);
    t.moves.push({ from: cellName(m.from), dir: m.dir, mode: m.mode, msFromTurnStart: Date.now() - t.startedAt, events: r.events.map(evText) });
    noteEvents(t, r.events);
    if (pg.g.state.winner) { closeTurn(pg); finishPlaytest(pg); }
    return r;
  } catch (e) { t.rejectedAttempts.push({ what: `move ${m.from} ${m.dir}`, reason: (e as Error).message.slice(0, 200) }); throw e; }
}
export async function humanEnd(pg: PlaytestGame) {
  guard(pg);
  const g = pg.g; g.busy = true; g.progress = [];
  try {
    const endEv = endTurn(g.state);
    g.history.push({ turn: g.state.turn - 1, p: 'human', events: [...g.turnEvents, ...endEv], verdicts: [] });
    g.turnEvents = [];
    closeTurn(pg);
    const ai = g.state.winner ? null : await aiTurn(pg);
    if (g.state.winner) finishPlaytest(pg); else openTurn(pg);
    return { humanEnd: endEv, ai, view: view(g) };
  } finally { g.busy = false; }
}

/** The opponent's whole turn: V5.3 policy decision (worker) -> engine-only referee -> shared executor, as in self-play. */
async function aiTurn(pg: PlaytestGame) {
  const g = pg.g, s = g.state, t = openTurn(pg), t0 = performance.now();
  pg.thinking = { since: Date.now() };
  g.progress.push({ at: Date.now(), text: `${opponentInfo(pg.opponent).label} is deciding its turn…` });
  let r: PlanReply;
  try { r = await decide(pg.opponent, structuredClone(s), 'ai'); } finally { pg.thinking = null; }
  const events: GameEvent[] = [], verdicts: Verdict[] = [];
  if (!r.ok) {
    // Never substitute another policy: the game stops and says why.
    t.ai = { policy: pg.opponent, wallMs: Math.round(performance.now() - t0), plannerMs: 0, executorMs: 0, candidates: 0, sims: 0, meta: { policy: pg.opponent, ms: 0, sims: 0 }, chosen: '', topScores: [], replans: 0, placementBlocked: null, error: r.error };
    pg.current = null; pg.turns.push(t);
    throw Object.assign(new Error(`The experimental opponent failed (${r.error}). It was not replaced by another opponent; start a new game.`), { status: 500 });
  }
  const plan = r.plan.chosen;
  let blocked: string | null = null;
  if (plan.placement) {
    const planned = plan.placement.effect;
    const rt = resolveAIRuleText(planned, aiPhrase(planned, s.turn + s.seed));
    const pl: Placement = { text: rt.text, effect: planned, cells: plan.placement.cells, interpretedBy: 'engine canonical text (playtest opponent)' };
    const c = validatePlacement(s, 'ai', pl);
    if (!c.ok) blocked = `illegal: ${c.reason}`;
    else {
      const rr = engineReferee(g, s, 'ai', pl);
      verdicts.push(rr.verdict); events.push(...rr.events);
      if (!rr.verdict.activated) blocked = `referee: ${rr.verdict.final}`;
      t.placement = { text: rt.text, effect: shortLabel(planned), cells: pl.cells.map(cellName), interpretedBy: pl.interpretedBy, approx: null, verdict: rr.verdict.final, tier: rr.verdict.tier?.tier ?? null, placed: rr.verdict.placedCells };
    }
  }
  if (s.phase === 'place') s.phase = 'move';
  const e0 = performance.now();
  let nx = moves53(s, 'ai', W), moves = nx.moves, mi = 0, done = !nx.endsAtChance, replans = 0;
  const executed: Move[] = [];
  while (mi < moves.length || (!done && !s.winner && s.current === 'ai' && s.actionsLeft > 0)) {
    if (mi >= moves.length) { nx = moves53(s, 'ai', W); moves = nx.moves; mi = 0; done = !nx.endsAtChance; replans++; if (!moves.length) break; }
    const m = moves[mi++];
    if (s.winner || s.current !== 'ai') break;
    if (!validateMove(s, 'ai', m).ok) break;
    const evt = applyMove(s, 'ai', m);
    events.push(...evt); executed.push(m);
    t.moves.push({ from: cellName(m.from), dir: m.dir, mode: m.mode, msFromTurnStart: Date.now() - t.startedAt, events: evt.map(evText) });
    if (evt.some(e => e.t === 'forced' && e.how === 'teleport') && mi < moves.length) { moves = moves.slice(0, mi); done = false; }
  }
  const executorMs = Math.round(performance.now() - e0);
  noteEvents(t, events);
  const endEv = s.winner ? [] : endTurn(s);
  const wallMs = Math.round(performance.now() - t0), o = opponentInfo(pg.opponent);
  t.ai = { policy: pg.opponent, wallMs, plannerMs: r.wallMs, executorMs, candidates: r.plan.candidates, sims: r.plan.sims, meta: r.plan.meta, chosen: plan.summary, topScores: r.plan.ranked.map(c => Math.round(c.score * 1000) / 1000), replans, placementBlocked: blocked };
  const decision: AIDecision = {
    source: 'local-planner', model: null, fallbackReason: null, taunt: '',
    rationale: `${o.label} [${o.version}, code ${o.implementation.all}${o.implementation.matchesFrozenV53 ? '' : ' MODIFIED'}] answered in ${(wallMs / 1000).toFixed(1)} s${r.plan.meta.budgetHit ? ' (work budget reached, fallback recorded)' : ''}${blocked ? `; its effect was not placed (${blocked})` : ''}.`,
    plan: { candidates: r.plan.candidates, sims: r.plan.sims, ms: wallMs, chosen: plan.summary, score: Math.round(plan.score * 100) / 100 }, ruleText: t.placement?.text ?? null, ruleInterpretation: null, decidedAt: new Date().toISOString(), ms: wallMs,
  };
  g.history.push({ turn: s.turn - (s.winner ? 0 : 1), p: 'ai', events: [...events.filter(e => e.t !== 'place'), ...endEv], verdicts, ai: decision });
  closeTurn(pg);
  return { events, endEvents: endEv, verdicts, decision, reactions: reactionsFor(events), playtest: { wallMs, plannerMs: r.wallMs, budgetHit: !!r.plan.meta.budgetHit, fallback: r.plan.meta.fallback ?? null } };
}

function finishPlaytest(pg: PlaytestGame) {
  const g = pg.g;
  g.achievements = achievementsFor(g.state, g.history.concat([{ turn: g.state.turn, p: g.state.current, events: g.turnEvents, verdicts: [] }]));
  pg.endedAt = Date.now();
  persist(pg);
}
/** A game left unfinished (restart, opponent change, session end) is kept as abandoned, never dropped. */
export function abandon(pg: PlaytestGame) {
  if (pg.endedAt || pg.g.state.winner) return;
  if (pg.current) closeTurn(pg);
  pg.abandoned = true; pg.endedAt = Date.now();
  persist(pg);
}

// ---------- the record ----------
const sig = (t?: TurnRec) => (t ? `${t.placement ? `${t.placement.effect}@${t.placement.cells.join('+')}` : 'no-effect'}|${t.moves.map(m => `${m.from}${m.dir[0]}`).join(',')}` : null);
export function record(pg: PlaytestGame) {
  const s = pg.g.state, o = opponentInfo(pg.opponent);
  const aiT = pg.turns.filter(t => t.p === 'ai'), huT = pg.turns.filter(t => t.p === 'human');
  const lat = aiT.map(t => t.ai?.wallMs ?? 0).sort((a, b) => a - b);
  const q = (p: number) => { if (!lat.length) return null; const i = p * (lat.length - 1), lo = Math.floor(i); return Math.round(lat[lo] + (lat[Math.min(lo + 1, lat.length - 1)] - lat[lo]) * (i - lo)); };
  const trig = pg.turns.flatMap(t => t.triggers);
  const winner = s.winner ?? null;
  return {
    schema: PLAYTEST_SCHEMA, mode: PLAYTEST_MODE, kind: 'telemetry', gameId: pg.g.id, sessionId: pg.sessionId, pilot: pg.pilot,
    opponent: { id: o.id, label: o.label, version: o.version, implementation: o.implementation, ...(o.bounds ? { bounds: o.bounds } : {}) },
    rules: { engine: o.implementation.engine, referee: 'engine-only (tier 1/2 engine-approved, tier 3 not placed; no Kane, no LLM)', interpreter: 'offline parser', maxTurns: 60 },
    seed: pg.seed, first: pg.first, startedAt: new Date(pg.startedAt).toISOString(), endedAt: pg.endedAt ? new Date(pg.endedAt).toISOString() : null,
    result: { winner, reason: s.winReason || (pg.abandoned ? 'abandoned' : ''), abandoned: pg.abandoned, turnLimit: /Turn limit/.test(s.winReason || ''), turns: s.turn, scored: { human: scoredN(s, 'human'), ai: scoredN(s, 'ai') }, humanWon: winner === 'human', firstMoverWon: winner ? winner === pg.first : null },
    durationMs: (pg.endedAt ?? Date.now()) - pg.startedAt,
    aiLatencyMs: { turns: lat.length, median: q(0.5), p90: q(0.9), max: lat.length ? lat[lat.length - 1] : null, over10s: lat.filter(x => x > 10_000).length, over30s: lat.filter(x => x > 30_000).length, budgetHits: aiT.filter(t => t.ai?.meta.budgetHit).length },
    openings: { ai: sig(aiT[0]), human: sig(huT[0]), aiTwoTurns: aiT.slice(0, 2).map(sig).join(' / ') },
    interactions: {
      triggers: trig.length, selfTriggers: trig.filter(x => x.self).length,
      byOwner: { human: trig.filter(x => x.owner === 'human').length, ai: trig.filter(x => x.owner === 'ai').length },
      hitHuman: trig.filter(x => x.mover === 'human').length, hitAI: trig.filter(x => x.mover === 'ai').length,
      chains: trig.filter(x => x.chain > 1).length, captures: pg.turns.reduce((a, t) => a + t.captures.length, 0),
      placements: { human: huT.filter(t => t.placement).length, ai: aiT.filter(t => t.placement).length },
      notPlaced: { human: huT.filter(t => t.placement && !t.placement.placed.length).length, ai: aiT.filter(t => t.ai?.placementBlocked).length },
    },
    reversals: { leadChanges: pg.leadChanges, comeback: winner && winner !== 'draw' ? pg.trailed[winner as Player] : null },
    turns: pg.turns,
  };
}
function persist(pg: PlaytestGame) {
  if (pg.saved) return;
  pg.saved = true;
  if (pg.recorded) saveGame(pg.sessionId, record(pg));
}

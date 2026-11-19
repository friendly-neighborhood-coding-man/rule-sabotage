/**
 * Server-authoritative game sessions.
 * Turn API: preview (interpret) -> place (referee + apply) -> move xN -> end (AI plays its turn).
 * Every new effect definition, human or AI, goes through the same referee() before it is live.
 */
import { randomUUID } from 'node:crypto';
import {
  type State, type Placement, type Move, type GameEvent, init, applyPlacement, applyMove, endTurn, validatePlacement,
  validateMove, publicView, cellName, legalMoves, activateLate,
} from './engine.ts';
import {
  type Player, type Interpretation, PLAYERS, offlineInterpret, parseModelInterpretation, shortLabel, guardText, policyReject, resolveAIRuleText, MAX_CELLS_PER_TURN,
} from './rules.ts';
import { planTurn, planMoves, aiPhrase, describeTurn, type Plan, type TurnPlan } from './ai.ts';
import { chatJSON, modelConfigured, modelName, providerLabel, ProviderError, INTERPRET_SYSTEM, INTERPRET_SCHEMA, interpretUserPrompt, OPPONENT_SYSTEM, OPPONENT_SCHEMA } from './openrouter.ts';
import { buildTrial, renderTrialPage, KANE_CONDITIONS, type Trial } from './trial.ts';
import { kaneJudge, kaneConfig, type KaneResult } from './kane.ts';
import { selectTier, tiersEnabled, type TierDecision } from './tiers.ts';
import { reactionsFor, achievementsFor, type Achievement } from './flavor.ts';
import { loadWeights, type FrozenWeights } from './weights.ts';

export type Verdict = {
  reviewId: number; player: Player; ruleText: string; label: string; cells: string[];
  /** 'approved' means Kane approved it. 'engine-approved' means the referee tiers let the engine decide: never shown as Kane. */
  final: 'pending' | 'approved' | 'engine-approved' | 'rejected' | 'unverified';
  /** Who decided: kane | engine (tier 1/2) | engine-only (Kane switched off). */
  decidedBy: 'kane' | 'engine' | 'engine-only' | null; tier: TierDecision | null;
  timing: { submittedAt: number; trialBuildMs: number; tierMs: number | null; resolvedAt: number | null; submitToVerdictMs: number | null };
  message: string; proposedTurn: number; resolvedTurn: number | null; placedCells: string[]; skippedCells: string[]; trial: Pick<Trial, 'trialId' | 'buildMs' | 'engineChecks'> & { scenarioIds: string[] }; kane: KaneResult | null; activated: boolean;
};
export type AIDecision = {
  source: 'openrouter' | 'local-planner'; provider?: string; model: string | null; fallbackReason: string | null; taunt: string; rationale: string;
  plan: { candidates: number; sims: number; ms: number; chosen: string; score: number }; ruleText: string | null; ruleInterpretation: Interpretation | null; decidedAt: string; ms: number;
  /** The model's or planner's own sentence, and whether it was used as the rule text (only if it parses to exactly the planned effect). */
  proseText?: string | null; ruleTextSource?: 'prose' | 'canonical'; ruleTextCheck?: string;
};
type Pending = { token: string; text: string; interpretation: Interpretation; at: number };
export type Progress = { at: number; text: string };
export type Game = {
  id: string; state: State; busy: boolean; progress: Progress[]; interpretations: Map<string, Pending>;
  achievements: Record<Player, Achievement[]>; refereeMode: 'kane' | 'engine-only'; tiers: boolean; turnEvents: GameEvent[];
  reviews: { verdict: Verdict; events: GameEvent[] }[]; nextReview: number;
  history: { turn: number; p: Player; events: GameEvent[]; verdicts: Verdict[]; ai?: AIDecision }[];
  /** Balance weights frozen for this whole game (the promoted version at game start). Balance learning never runs here. */
  weights: FrozenWeights;
};

const games = new Map<string, Game>();
export const trials = new Map<string, { trial: Trial; html: string }>();
let trialCounter = 0;
export const refereeMode = (): 'kane' | 'engine-only' => (kaneConfig().enabled ? 'kane' : 'engine-only');
const allowUnverified = () => process.env.ALLOW_UNVERIFIED_RULES === '1';

// ---------- interpretation (same pipeline for human and AI text) ----------
const interpCache = new Map<string, Interpretation>();
export async function interpretRule(text: string): Promise<{ interpretation: Interpretation; fallback: string | null; ms: number }> {
  const t0 = Date.now();
  const g = guardText(text);
  if (g) return { interpretation: { status: 'reject', reason: g, source: 'input-guard' }, fallback: null, ms: 0 };
  const p = policyReject(text);
  if (p) return { interpretation: { status: 'reject', reason: p, source: 'input-guard' }, fallback: null, ms: 0 };
  const k = text.trim().toLowerCase();
  const hit = interpCache.get(k);
  if (hit) return { interpretation: hit, fallback: null, ms: 0 };
  if (!modelConfigured()) return { interpretation: offlineInterpret(text), fallback: 'no LLM provider configured: offline parser used', ms: Date.now() - t0 };
  try {
    const raw = await chatJSON('interpret_rule', INTERPRET_SYSTEM, interpretUserPrompt(text.trim()), INTERPRET_SCHEMA, { temperature: 0, maxTokens: 200, timeoutMs: 15_000 });
    const interpretation = parseModelInterpretation(raw, text);
    interpCache.set(k, interpretation);
    return { interpretation, fallback: null, ms: Date.now() - t0 };
  } catch (e) {
    const why = e instanceof ProviderError ? `${e.kind}: ${e.message}` : `invalid model output: ${(e as Error).message}`;
    return { interpretation: offlineInterpret(text), fallback: `${providerLabel()} failed (${why}); offline parser used`, ms: Date.now() - t0 };
  }
}

// ---------- referee: sandbox trial + Kane ----------
// Kane takes about 1-5 minutes per new rule on real hardware, so its review runs in the
// background: the game goes on, and the effect goes live only when (and if) Kane approves it.
const QUICK_MS = 1500; // a cached or very fast verdict is applied before the request returns

function engineTrial(g: Game, s: State, p: Player, pl: Placement) {
  const trial = buildTrial(s, p, pl, ++trialCounter);
  const html = renderTrialPage(trial);
  trials.set(trial.trialId, { trial, html });
  if (trials.size > 300) trials.delete(trials.keys().next().value!);
  return { trial, html };
}

/** Starts the review of one placement. Resolves within QUICK_MS with either a final or a 'pending' verdict. */
async function referee(g: Game, s: State, p: Player, pl: Placement): Promise<{ verdict: Verdict; events: GameEvent[] }> {
  const submittedAt = Date.now();
  const { trial, html } = engineTrial(g, s, p, pl);
  const who = p === 'human' ? 'your' : 'the AI’s';
  const scenarioIds = trial.scenarioIds;
  g.progress.push({ at: Date.now(), text: `Sandbox ran ${scenarioIds.length} what-if scenarios for ${who} rule (${trial.trialId}, ${trial.buildMs} ms).` });
  const verdict: Verdict = {
    reviewId: ++g.nextReview, player: p, ruleText: pl.text, label: shortLabel(pl.effect), cells: pl.cells.map(cellName), final: 'pending', message: '',
    decidedBy: null, tier: null, timing: { submittedAt, trialBuildMs: trial.buildMs, tierMs: null, resolvedAt: null, submitToVerdictMs: null },
    proposedTurn: s.turn, resolvedTurn: null, placedCells: [], skippedCells: [],
    trial: { trialId: trial.trialId, buildMs: trial.buildMs, engineChecks: trial.engineChecks, scenarioIds }, kane: null, activated: false,
  };
  const rec = { verdict, events: [] as GameEvent[] };
  g.reviews.push(rec);
  if (g.reviews.length > 60) g.reviews.shift();
  const failed = trial.engineChecks.find(c => !c.pass);
  if (failed) { Object.assign(verdict, { final: 'rejected', decidedBy: 'engine', resolvedTurn: s.turn, message: `Engine safety check failed: ${failed.text} (${failed.detail}).` }); stamp(verdict); return rec; }
  if (g.tiers) {
    const t = selectTier(s, p, pl, trial);
    verdict.tier = t; verdict.timing.tierMs = t.ms;
    g.progress.push({ at: Date.now(), text: `Referee tier ${t.tier} for ${who} rule: ${t.reasons.join('; ')}.` });
    if (t.tier < 3) {
      Object.assign(verdict, { final: 'engine-approved', decidedBy: 'engine', message: `Engine-approved (tier ${t.tier}${t.tier === 2 ? `, ${t.extraScenarios} extra simulated entries` : ''}). Not reviewed by Kane: ${t.reasons.join('; ')}.` });
      stamp(verdict);
      activate(g, p, pl, rec);
      return rec;
    }
  }
  if (g.refereeMode === 'engine-only') {
    verdict.final = 'unverified'; verdict.decidedBy = 'engine-only'; verdict.message = 'Engine checks passed. Kane referee is switched off, so this rule is NOT Kane-verified.';
    stamp(verdict);
    activate(g, p, pl, rec);
    return rec;
  }
  g.progress.push({ at: Date.now(), text: `Kane is examining ${who} rule…` });
  verdict.message = 'Kane is examining this rule. It goes live only if Kane approves it; play on meanwhile.';
  const port = Number(process.env.PORT || 3000);
  const done = kaneJudge({ trialId: trial.trialId, signature: trial.signature, url: `http://127.0.0.1:${port}/trial/${trial.trialId}`, html, conditions: KANE_CONDITIONS })
    .catch((e): KaneResult => ({ status: 'unverified', reason: `Kane run failed: ${(e as Error).message}`, conditionResults: [], conditionReasons: [], elapsedMs: 0, exitCode: null, evidencePath: null, mode: kaneConfig().mode, cached: false, version: null }))
    .then(kane => finishReview(g, p, pl, rec, kane));
  settledReviews.set(verdict, done.then(() => {}, () => {}));
  await Promise.race([done, new Promise(r => setTimeout(r, QUICK_MS))]);
  return rec;
}

function finishReview(g: Game, p: Player, pl: Placement, rec: { verdict: Verdict; events: GameEvent[] }, kane: KaneResult) {
  const v = rec.verdict, who = p === 'human' ? 'your' : 'the AI’s';
  v.kane = kane; v.final = kane.status; v.message = kane.reason; v.decidedBy = 'kane';
  stamp(v);
  g.progress.push({ at: Date.now(), text: kane.status === 'approved' ? `Kane approved ${who} rule${kane.cached ? ' (identical trial seen before: cached verdict)' : ` in ${(kane.elapsedMs / 1000).toFixed(1)}s`}.` : kane.status === 'rejected' ? `Kane rejected ${who} rule.` : `Kane could not verify ${who} rule.` });
  if (kane.status === 'approved' || (kane.status === 'unverified' && allowUnverified())) activate(g, p, pl, rec);
  else v.resolvedTurn = g.state.turn;
}

/**
 * V4 (observability only, no behaviour change): the promise of every background Kane review, so a caller can wait
 * for the review's genuine terminal state instead of polling with a fixed wall-clock budget. The review itself is
 * bounded by kane.ts (browser readiness wait + the CLI hard kill timer), so this promise always settles.
 */
const settledReviews = new WeakMap<Verdict, Promise<void>>();
export function reviewSettled(v: Verdict): Promise<void> { return settledReviews.get(v) ?? Promise.resolve(); }

function stamp(v: Verdict) { v.timing.resolvedAt = Date.now(); v.timing.submitToVerdictMs = v.timing.resolvedAt - v.timing.submittedAt; }

/** Puts an approved effect on the board, on whichever of its cells are still eligible now. */
function activate(g: Game, p: Player, pl: Placement, rec: { verdict: Verdict; events: GameEvent[] }) {
  const s = g.state, v = rec.verdict;
  v.resolvedTurn = s.turn;
  if (s.winner) { v.message += ' The game ended before it could go live.'; return; }
  // The board may have changed during the review: re-run the deterministic engine checks on the current board.
  const still = pl.cells.filter(k => { const r = s.rules.find(x => x.id === s.cells[k]); return !s.pieces.some(q => !q.scored && `${q.x},${q.y}` === k) && (!r || r.owner === p); });
  if (still.length) {
    const recheck = buildTrial(s, p, { ...pl, cells: still }, ++trialCounter).engineChecks.find(c => !c.pass);
    if (recheck) { v.message += ` Not placed: on the current board the engine check “${recheck.text}” fails (${recheck.detail}).`; v.skippedCells = pl.cells.map(cellName); return; }
  }
  const r = activateLate(s, p, { ...pl, cells: still });
  v.placedCells = r.cells.map(cellName); v.skippedCells = pl.cells.filter(k => !r.cells.includes(k)).map(cellName);
  v.activated = r.cells.length > 0;
  if (v.skippedCells.length) v.message += ` ${v.skippedCells.join(', ')} ${v.skippedCells.length > 1 ? 'were' : 'was'} no longer free, so ${v.activated ? 'it went live on the rest' : 'nothing was placed'}.`;
  rec.events = r.events;
  if (r.events.length) g.history.push({ turn: s.turn, p, events: r.events, verdicts: [v] });
}

// ---------- sessions ----------
export function newGame(seed?: number): Game {
  const g: Game = {
    id: randomUUID(), state: init(seed ?? (Date.now() & 0x7fffffff)), busy: false, progress: [], interpretations: new Map(),
    achievements: { human: [], ai: [] }, refereeMode: refereeMode(), tiers: tiersEnabled(), turnEvents: [], history: [], reviews: [], nextReview: 0, weights: loadWeights(),
  };
  games.set(g.id, g);
  if (games.size > 200) games.delete(games.keys().next().value!);
  return g;
}
export const getGame = (id: string) => games.get(id);

export function view(g: Game) {
  return {
    gameId: g.id, ...publicView(g.state), busy: g.busy, refereeMode: g.refereeMode, refereeTiers: g.tiers, achievements: g.achievements,
    model: modelConfigured() ? modelName() : null, provider: modelConfigured() ? providerLabel() : null, legal: legalMoves(g.state, 'human'), maxCells: MAX_CELLS_PER_TURN,
    reviews: g.reviews.slice(-12).map(r => ({ ...r.verdict, events: r.events })),
    balance: { version: g.weights.version, hash: g.weights.hash },
  };
}

export async function preview(g: Game, text: string) {
  const r = await interpretRule(text);
  const i = r.interpretation;
  const token = randomUUID();
  if (i.status !== 'reject') g.interpretations.set(token, { token, text: text.trim(), interpretation: i, at: Date.now() });
  return { token: i.status === 'reject' ? null : token, interpretation: i, fallback: r.fallback, ms: r.ms, ...(i.status !== 'reject' ? { label: shortLabel(i.effect), maxCells: MAX_CELLS_PER_TURN } : {}) };
}

function guardTurn(g: Game) {
  if (g.busy) throw Object.assign(new Error('Busy, one moment.'), { status: 409 });
  if (g.state.winner) throw Object.assign(new Error('The game is over. Start a rematch.'), { status: 409 });
  if (g.state.current !== 'human') throw Object.assign(new Error('Not your turn.'), { status: 409 });
}

/** Human placement: removals + optional new rule (from a previewed token), reviewed by the referee. */
export async function placeHuman(g: Game, req: { token?: string; cells?: string[]; remove?: string[] }) {
  guardTurn(g);
  g.busy = true; g.progress = [];
  try {
    const s = g.state;
    let pl: Placement | null = null;
    if (req.token) {
      const pend = g.interpretations.get(req.token);
      if (!pend || pend.interpretation.status === 'reject') throw Object.assign(new Error('Interpret the rule first.'), { status: 422 });
      const i = pend.interpretation;
      pl = { text: pend.text, effect: i.effect, cells: req.cells ?? [], interpretedBy: i.source, ...(i.status === 'approximate' ? { approxNote: i.note } : {}) };
    }
    const remove = req.remove ?? [];
    const c = validatePlacement(s, 'human', pl, remove);
    if (!c.ok) throw Object.assign(new Error(c.reason), { status: 422 });
    const events = applyPlacement(s, 'human', null, remove); // removals now; sets the move phase
    const verdicts: Verdict[] = [];
    if (pl) { const r = await referee(g, s, 'human', pl); verdicts.push(r.verdict); events.push(...r.events); }
    g.turnEvents.push(...events.filter(e => e.t === 'remove'));
    return { events, verdicts, view: view(g) };
  } finally { g.busy = false; }
}

export function moveHuman(g: Game, m: Move) {
  guardTurn(g);
  const c = validateMove(g.state, 'human', m);
  if (!c.ok) throw Object.assign(new Error(c.reason), { status: 422 });
  const events = applyMove(g.state, 'human', m);
  g.turnEvents.push(...events);
  const reactions = reactionsFor(events);
  if (g.state.winner) finish(g);
  return { events, reactions, view: view(g) };
}

function finish(g: Game) { g.achievements = achievementsFor(g.state, g.history.concat([{ turn: g.state.turn, p: g.state.current, events: g.turnEvents, verdicts: [] }])); }

/** Human ends their turn; the AI plays its whole turn; returns everything for the client to animate. */
export async function endHumanTurn(g: Game) {
  guardTurn(g);
  g.busy = true; g.progress = [];
  try {
    const endEv = endTurn(g.state);
    g.history.push({ turn: g.state.turn - 1, p: 'human', events: [...g.turnEvents, ...endEv], verdicts: [] });
    g.turnEvents = [];
    const ai = g.state.winner ? null : await aiTurn(g);
    if (g.state.winner) finish(g);
    return { humanEnd: endEv, ai, view: view(g) };
  } finally { g.busy = false; }
}

/** Starts a game; if the AI won the coin flip it moves first. */
export async function startGame(seed?: number) {
  const g = newGame(seed);
  let ai = null;
  if (g.state.current === 'ai') { g.busy = true; try { ai = await aiTurn(g); } finally { g.busy = false; } }
  return { g, ai };
}

// ---------- the AI's turn ----------
export async function decideAI(s: State, weights?: FrozenWeights): Promise<{ decision: AIDecision; plan: TurnPlan; text: string | null }> {
  const t0 = Date.now();
  const plan: Plan = planTurn(s, { weights });
  const meta = (c: TurnPlan) => ({ candidates: plan.candidates, sims: plan.sims, ms: plan.ms, chosen: c.summary, score: Number(c.score.toFixed(2)) });
  const local = (reason: string | null) => {
    const c = plan.chosen;
    return {
      plan: c, text: c.placement ? aiPhrase(c.placement.effect, s.turn + s.seed) : null,
      decision: { source: 'local-planner' as const, model: null, fallbackReason: reason, taunt: localTaunt(c, s), rationale: `Simulated ${plan.candidates} turn plans (${plan.sims} engine runs, including your best reply); chose “${c.summary}”.`, plan: meta(c), ruleText: null, ruleInterpretation: null, decidedAt: new Date().toISOString(), ms: Date.now() - t0 },
    };
  };
  if (!modelConfigured()) return local('no LLM provider configured');
  const options = plan.ranked.slice(0, 6);
  const pieceView = (p: Player) => s.pieces.filter(q => q.owner === p).map(q => (q.scored ? 'scored' : cellName(`${q.x},${q.y}`) + (q.frozen ? ' (frozen)' : '')));
  const payload = {
    you: 'ai (moving toward column A)', opponent: 'human (moving toward column G)', turn: s.turn, actionsThisTurn: s.actionsLeft,
    yourPieces: pieceView('ai'), humanPieces: pieceView('human'),
    effects: s.rules.filter(r => r.cells.length).map(r => ({ owner: r.owner === 'ai' ? 'you' : 'human', effect: r.label, cells: r.cells.map(cellName) })),
    options: options.map(c => ({ id: c.id, plan: c.summary, score: Number(c.score.toFixed(2)) })),
  };
  try {
    const schema = { ...OPPONENT_SCHEMA, properties: { ...OPPONENT_SCHEMA.properties, choice: { type: 'string', enum: options.map(c => c.id) } } };
    const raw = await chatJSON('opponent', OPPONENT_SYSTEM, JSON.stringify(payload), schema, { temperature: 0.7, maxTokens: 350, timeoutMs: Number(process.env.LLM_OPPONENT_TIMEOUT_MS) || 20_000 }) as Record<string, unknown>;
    const chosen = options.find(c => c.id === raw?.choice);
    if (!chosen) throw new ProviderError('invalid_reply', `unknown option ${String(raw?.choice).slice(0, 20)}`);
    const text = chosen.placement ? (typeof raw.ruleText === 'string' && raw.ruleText.trim() ? raw.ruleText.trim().slice(0, 160) : aiPhrase(chosen.placement.effect, s.turn)) : null;
    return { plan: chosen, text, decision: { source: 'openrouter', provider: providerLabel(), model: modelName(), fallbackReason: null, taunt: typeof raw.taunt === 'string' ? raw.taunt.slice(0, 90) : '', rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 240) : '', plan: meta(chosen), ruleText: text, ruleInterpretation: null, decidedAt: new Date().toISOString(), ms: Date.now() - t0 } };
  } catch (e) {
    return local(`${providerLabel()} failed (${e instanceof ProviderError ? `${e.kind}: ${e.message}` : (e as Error).message})`);
  }
}
function localTaunt(c: TurnPlan, s: State): string {
  const lines = c.placement ? ['I have prepared a little surprise.', 'Watch your step. Or don’t. I’d prefer you don’t.', 'Constructing… something.', 'These squares have my full attention now.'] : ['Just walking. Totally normal walking.', 'I see your traps. I respect your traps.', 'Calculating… calculating…', 'Nothing up my sleeve.'];
  return lines[(s.turn * 7 + s.seed) % lines.length];
}

async function aiTurn(g: Game) {
  const s = g.state;
  const { decision, plan, text } = await decideAI(structuredClone(s), g.weights);
  const events: GameEvent[] = [], verdicts: Verdict[] = [];
  if (plan.placement) {
    // The planner's typed effect is what gets installed. Model prose is only used as the rule text when the
    // deterministic parser reads it as exactly that effect; otherwise the engine's canonical sentence is used.
    const planned = plan.placement.effect;
    const rt = resolveAIRuleText(planned, text);
    Object.assign(decision, { proseText: text, ruleText: rt.text, ruleTextSource: rt.source, ruleTextCheck: rt.check, ruleInterpretation: rt.parsed });
    const pl: Placement = { text: rt.text, effect: planned, cells: plan.placement.cells, interpretedBy: rt.source === 'prose' ? `${decision.source} sentence, checked by the offline parser` : 'engine canonical text' };
    // Same validation and referee pipeline as a human placement.
    if (validatePlacement(s, 'ai', pl).ok) {
      const r = await referee(g, s, 'ai', pl);
      verdicts.push(r.verdict);
      events.push(...r.events);
    }
  }
  if (s.phase === 'place') s.phase = 'move';
  // Re-plan moves on the real board (the placement may have been rejected or reinterpreted).
  const moves = planMoves(s, 'ai', 0, Math.random, g.weights).moves;
  for (const m of moves) { if (s.winner || !validateMove(s, 'ai', m).ok) break; events.push(...applyMove(s, 'ai', m)); }
  const v0 = verdicts[0];
  decision.plan.chosen = describeTurn(v0 && (v0.final === 'pending' || v0.activated) ? plan.placement : null, moves) + (v0?.final === 'pending' ? ' (effect waiting for Kane)' : '');
  const endEv = s.winner ? [] : endTurn(s);
  g.history.push({ turn: s.turn - (s.winner ? 0 : 1), p: 'ai', events: [...events.filter(e => e.t !== 'place'), ...endEv], verdicts, ai: decision });
  return { events, endEvents: endEv, verdicts, decision, reactions: reactionsFor(events) };
}
export { PLAYERS };

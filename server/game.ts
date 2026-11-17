/**
 * Server-authoritative game sessions.
 * Turn API: preview (interpret) -> place (referee + apply) -> move xN -> end (AI plays its turn).
 * Every new effect definition, human or AI, goes through the same referee() before it is live.
 */
import { randomUUID } from 'node:crypto';
import {
  type State, type Placement, type Move, type GameEvent, init, applyPlacement, applyMove, endTurn, validatePlacement,
  validateMove, publicView, cellName, legalMoves,
} from './engine.ts';
import {
  type Player, type Interpretation, PLAYERS, offlineInterpret, parseModelInterpretation, shortLabel, guardText, policyReject, sameEffect, MAX_CELLS_PER_TURN,
} from './rules.ts';
import { planTurn, planMoves, aiPhrase, describeTurn, type Plan, type TurnPlan } from './ai.ts';
import { chatJSON, modelConfigured, modelName, ProviderError, INTERPRET_SYSTEM, INTERPRET_SCHEMA, interpretUserPrompt, OPPONENT_SYSTEM, OPPONENT_SCHEMA } from './openrouter.ts';
import { buildTrial, renderTrialPage, KANE_CONDITIONS, type Trial } from './trial.ts';
import { kaneJudge, kaneConfig, type KaneResult } from './kane.ts';
import { reactionsFor, achievementsFor, type Achievement } from './flavor.ts';

export type Verdict = {
  player: Player; ruleText: string; label: string; cells: string[]; final: 'approved' | 'rejected' | 'unverified';
  message: string; trial: Pick<Trial, 'trialId' | 'buildMs' | 'engineChecks'> & { scenarioIds: string[] }; kane: KaneResult | null; activated: boolean;
};
export type AIDecision = {
  source: 'openrouter' | 'local-planner'; model: string | null; fallbackReason: string | null; taunt: string; rationale: string;
  plan: { candidates: number; sims: number; ms: number; chosen: string; score: number }; ruleText: string | null; ruleInterpretation: Interpretation | null; decidedAt: string; ms: number;
};
type Pending = { token: string; text: string; interpretation: Interpretation; at: number };
export type Progress = { at: number; text: string };
export type Game = {
  id: string; state: State; busy: boolean; progress: Progress[]; interpretations: Map<string, Pending>;
  achievements: Record<Player, Achievement[]>; refereeMode: 'kane' | 'engine-only'; turnEvents: GameEvent[];
  history: { turn: number; p: Player; events: GameEvent[]; verdicts: Verdict[]; ai?: AIDecision }[];
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
  if (!modelConfigured()) return { interpretation: offlineInterpret(text), fallback: 'OpenRouter not configured: offline parser used', ms: Date.now() - t0 };
  try {
    const raw = await chatJSON('interpret_rule', INTERPRET_SYSTEM, interpretUserPrompt(text.trim()), INTERPRET_SCHEMA, { temperature: 0, maxTokens: 200, timeoutMs: 15_000 });
    const interpretation = parseModelInterpretation(raw, text);
    interpCache.set(k, interpretation);
    return { interpretation, fallback: null, ms: Date.now() - t0 };
  } catch (e) {
    const why = e instanceof ProviderError ? `${e.kind}: ${e.message}` : `invalid model output: ${(e as Error).message}`;
    return { interpretation: offlineInterpret(text), fallback: `OpenRouter failed (${why}); offline parser used`, ms: Date.now() - t0 };
  }
}

// ---------- referee: sandbox trial + Kane ----------
async function referee(g: Game, s: State, p: Player, pl: Placement): Promise<Verdict> {
  const trial = buildTrial(s, p, pl, ++trialCounter);
  const html = renderTrialPage(trial);
  trials.set(trial.trialId, { trial, html });
  if (trials.size > 300) trials.delete(trials.keys().next().value!);
  const who = p === 'human' ? 'your' : 'the AI’s';
  const scenarioIds = trial.scenarioIds;
  g.progress.push({ at: Date.now(), text: `Sandbox ran ${scenarioIds.length} what-if scenarios for ${who} rule (${trial.trialId}, ${trial.buildMs} ms).` });
  const base = { player: p, ruleText: pl.text, label: shortLabel(pl.effect), cells: pl.cells.map(cellName), trial: { trialId: trial.trialId, buildMs: trial.buildMs, engineChecks: trial.engineChecks, scenarioIds } };
  const failed = trial.engineChecks.find(c => !c.pass);
  if (failed) return { ...base, final: 'rejected', message: `Engine safety check failed: ${failed.text} (${failed.detail}).`, kane: null, activated: false };
  if (g.refereeMode === 'engine-only') return { ...base, final: 'unverified', message: 'Engine checks passed. Kane referee is switched off, so this rule is NOT Kane-verified.', kane: null, activated: true };
  g.progress.push({ at: Date.now(), text: `Kane is examining ${who} rule…` });
  const port = Number(process.env.PORT || 3000);
  const kane = await kaneJudge({ trialId: trial.trialId, signature: trial.signature, url: `http://127.0.0.1:${port}/trial/${trial.trialId}`, html, conditions: KANE_CONDITIONS });
  g.progress.push({ at: Date.now(), text: kane.status === 'approved' ? `Kane approved ${who} rule${kane.cached ? ' (identical trial seen before: cached verdict)' : ` in ${(kane.elapsedMs / 1000).toFixed(1)}s`}.` : kane.status === 'rejected' ? `Kane rejected ${who} rule.` : `Kane could not verify ${who} rule.` });
  return { ...base, final: kane.status, message: kane.reason, kane, activated: kane.status === 'approved' || (kane.status === 'unverified' && allowUnverified()) };
}

// ---------- sessions ----------
export function newGame(seed?: number): Game {
  const g: Game = {
    id: randomUUID(), state: init(seed ?? (Date.now() & 0x7fffffff)), busy: false, progress: [], interpretations: new Map(),
    achievements: { human: [], ai: [] }, refereeMode: refereeMode(), turnEvents: [], history: [],
  };
  games.set(g.id, g);
  if (games.size > 200) games.delete(games.keys().next().value!);
  return g;
}
export const getGame = (id: string) => games.get(id);

export function view(g: Game) {
  return {
    gameId: g.id, ...publicView(g.state), busy: g.busy, refereeMode: g.refereeMode, achievements: g.achievements,
    model: modelConfigured() ? modelName() : null, legal: legalMoves(g.state, 'human'), maxCells: MAX_CELLS_PER_TURN,
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
    const verdicts: Verdict[] = [];
    if (pl) { const v = await referee(g, s, 'human', pl); verdicts.push(v); if (!v.activated) pl = null; }
    const events = (pl || remove.length) ? applyPlacement(s, 'human', pl, remove) : [];
    if (!pl && !remove.length) s.phase = 'move';
    g.turnEvents.push(...events);
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
export async function decideAI(s: State): Promise<{ decision: AIDecision; plan: TurnPlan; text: string | null }> {
  const t0 = Date.now();
  const plan: Plan = planTurn(s);
  const meta = (c: TurnPlan) => ({ candidates: plan.candidates, sims: plan.sims, ms: plan.ms, chosen: c.summary, score: Number(c.score.toFixed(2)) });
  const local = (reason: string | null) => {
    const c = plan.chosen;
    return {
      plan: c, text: c.placement ? aiPhrase(c.placement.effect, s.turn + s.seed) : null,
      decision: { source: 'local-planner' as const, model: null, fallbackReason: reason, taunt: localTaunt(c, s), rationale: `Simulated ${plan.candidates} turn plans (${plan.sims} engine runs, including your best reply); chose “${c.summary}”.`, plan: meta(c), ruleText: null, ruleInterpretation: null, decidedAt: new Date().toISOString(), ms: Date.now() - t0 },
    };
  };
  if (!modelConfigured()) return local('OpenRouter not configured');
  const options = plan.ranked.slice(0, 6);
  const pieceView = (p: Player) => s.pieces.filter(q => q.owner === p).map(q => (q.scored ? 'scored' : cellName(`${q.x},${q.y}`) + (q.frozen ? ' (frozen)' : '')));
  const payload = {
    you: 'ai (moving toward column A)', opponent: 'human (moving toward column G)', turn: s.turn, actionsThisTurn: s.actionsLeft,
    yourPieces: pieceView('ai'), humanPieces: pieceView('human'),
    effects: s.rules.filter(r => r.cells.length).map(r => ({ owner: r.owner === 'ai' ? 'you' : 'human', effect: r.label, cells: r.cells.map(cellName) })),
    options: options.map(c => ({ id: c.id, plan: c.summary, score: Number(c.score.toFixed(2)) })),
  };
  try {
    const raw = await chatJSON('opponent', OPPONENT_SYSTEM, JSON.stringify(payload), OPPONENT_SCHEMA, { temperature: 0.7, maxTokens: 350, timeoutMs: 20_000 }) as Record<string, unknown>;
    const chosen = options.find(c => c.id === raw?.choice);
    if (!chosen) throw new ProviderError('invalid_reply', `unknown option ${String(raw?.choice).slice(0, 20)}`);
    const text = chosen.placement ? (typeof raw.ruleText === 'string' && raw.ruleText.trim() ? raw.ruleText.trim().slice(0, 160) : aiPhrase(chosen.placement.effect, s.turn)) : null;
    return { plan: chosen, text, decision: { source: 'openrouter', model: modelName(), fallbackReason: null, taunt: typeof raw.taunt === 'string' ? raw.taunt.slice(0, 90) : '', rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 240) : '', plan: meta(chosen), ruleText: text, ruleInterpretation: null, decidedAt: new Date().toISOString(), ms: Date.now() - t0 } };
  } catch (e) {
    return local(`OpenRouter failed (${e instanceof ProviderError ? `${e.kind}: ${e.message}` : (e as Error).message})`);
  }
}
function localTaunt(c: TurnPlan, s: State): string {
  const lines = c.placement ? ['I have prepared a little surprise.', 'Watch your step. Or don’t. I’d prefer you don’t.', 'Constructing… something.', 'These squares have my full attention now.'] : ['Just walking. Totally normal walking.', 'I see your traps. I respect your traps.', 'Calculating… calculating…', 'Nothing up my sleeve.'];
  return lines[(s.turn * 7 + s.seed) % lines.length];
}

async function aiTurn(g: Game) {
  const s = g.state;
  const { decision, plan, text } = await decideAI(structuredClone(s));
  const events: GameEvent[] = [], verdicts: Verdict[] = [];
  let placedOk = false;
  if (plan.placement && text) {
    // The AI's own words go through the same interpreter and referee as the human's.
    const r = await interpretRule(text);
    decision.ruleText = text; decision.ruleInterpretation = r.interpretation;
    if (r.interpretation.status !== 'reject') {
      const i = r.interpretation;
      const pl: Placement = { text, effect: i.effect, cells: plan.placement.cells, interpretedBy: i.source, ...(i.status === 'approximate' ? { approxNote: i.note } : {}) };
      if (validatePlacement(s, 'ai', pl).ok) {
        const v = await referee(g, s, 'ai', pl);
        verdicts.push(v);
        if (v.activated) { events.push(...applyPlacement(s, 'ai', pl)); placedOk = sameEffect(i.effect, plan.placement.effect); void placedOk; }
      }
    }
  }
  if (s.phase === 'place') s.phase = 'move';
  // Re-plan moves on the real board (the placement may have been rejected or reinterpreted).
  const moves = planMoves(s, 'ai').moves;
  for (const m of moves) { if (s.winner || !validateMove(s, 'ai', m).ok) break; events.push(...applyMove(s, 'ai', m)); }
  decision.plan.chosen = describeTurn(events.some(e => e.t === 'place') ? plan.placement : null, moves);
  const endEv = s.winner ? [] : endTurn(s);
  g.history.push({ turn: s.turn - (s.winner ? 0 : 1), p: 'ai', events: [...events, ...endEv], verdicts, ai: decision });
  return { events, endEvents: endEv, verdicts, decision, reactions: reactionsFor(events) };
}
export { PLAYERS };

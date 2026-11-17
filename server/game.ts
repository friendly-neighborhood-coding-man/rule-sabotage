/**
 * Server-authoritative game sessions.
 *
 * Fairness of information: at the START of every round we snapshot the public state
 * and immediately start the AI's decision from that snapshot. The human's action for
 * that round is only accepted afterwards and is never passed to the AI.
 */
import { randomUUID } from 'node:crypto';
import {
  type State, type Action, type RuleAction, type GameEvent, init, resolveRound, validateAction, publicView, eligibleCells,
  cellName, NO_ACTION,
} from './engine.ts';
import {
  type Player, type Interpretation, type Effect, PLAYERS, offlineInterpret, parseModelInterpretation, effectCost, maxCells,
  RULE_BUDGET, shortLabel, guardText, policyReject,
} from './rules.ts';
import { planAI, shortlist, aiPhrase, describeAction, type Plan } from './ai.ts';
import { chatJSON, modelConfigured, modelName, ProviderError, INTERPRET_SYSTEM, INTERPRET_SCHEMA, interpretUserPrompt, OPPONENT_SYSTEM, OPPONENT_SCHEMA } from './openrouter.ts';
import { buildTrial, renderTrialPage, KANE_CONDITIONS, type Trial } from './trial.ts';
import { kaneJudge, kaneConfig, type KaneResult } from './kane.ts';
import { reactionsFor, achievementsFor, type Achievement } from './flavor.ts';

export type AIDecision = {
  action: Action; source: 'openrouter' | 'local-planner'; model: string | null; fallbackReason: string | null;
  taunt: string; rationale: string; plan: { candidates: number; scenarios: number; ms: number; chosen: string; score: number };
  ruleInterpretation: Interpretation | null; decidedAt: string; ms: number;
};
export type Verdict = {
  player: Player; ruleText: string; label: string; cells: string[]; final: 'approved' | 'rejected' | 'unverified';
  message: string; trial: Pick<Trial, 'trialId' | 'buildMs' | 'engineChecks'> & { scenarioIds: string[] }; kane: KaneResult | null; activated: boolean;
};
type Pending = { token: string; text: string; interpretation: Interpretation; at: number };
export type Progress = { at: number; text: string };

export type Game = {
  id: string; state: State; aiDecision: Promise<AIDecision>; aiReady: boolean;
  interpretations: Map<string, Pending>; busy: boolean; progress: Progress[];
  achievements: Record<Player, Achievement[]>; lastRound: unknown; refereeMode: 'kane' | 'engine-only';
  ruleOrigin: Map<number, { by: Player; source: string }>;
};

const games = new Map<string, Game>();
export const trials = new Map<string, { trial: Trial; html: string }>();
let trialCounter = 0;

export const refereeMode = (): 'kane' | 'engine-only' => (kaneConfig().enabled ? 'kane' : 'engine-only');

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

// ---------- AI decision ----------
export async function decideAI(snapshot: State): Promise<AIDecision> {
  const t0 = Date.now();
  const plan: Plan = planAI(snapshot);
  const base = (c = plan.chosen): Omit<AIDecision, 'source' | 'model' | 'fallbackReason' | 'taunt' | 'rationale' | 'ruleInterpretation' | 'action'> => ({
    plan: { candidates: plan.candidates, scenarios: plan.scenarios, ms: plan.ms, chosen: c.summary, score: Number(c.score.toFixed(2)) }, decidedAt: new Date().toISOString(), ms: Date.now() - t0,
  });
  const local = async (reason: string | null): Promise<AIDecision> => {
    const a = structuredClone(plan.chosen.action);
    let ruleInterpretation: Interpretation | null = null;
    if (a.rule.op === 'place') {
      const text = aiPhrase(a.rule.effect, snapshot.round + snapshot.seed);
      const res = await interpretRule(text); // same pipeline as human rules
      ruleInterpretation = res.interpretation;
      a.rule = applyInterpretation(snapshot, 'ai', a.rule, text, res.interpretation);
    }
    return { ...base(), action: safe(snapshot, a), source: 'local-planner', model: null, fallbackReason: reason, taunt: localTaunt(a, snapshot), rationale: `Simulated ${plan.candidates} options against ${plan.scenarios} possible human replies; picked “${plan.chosen.summary}” (score ${plan.chosen.score.toFixed(2)}).`, ruleInterpretation };
  };
  if (!modelConfigured()) return local('OpenRouter not configured');
  const options = shortlist(plan, 7);
  const payload = {
    you: 'ai', round: snapshot.round, maxRounds: snapshot.maxRounds, shape: snapshot.shape.name,
    positions: { you: cellName(`${snapshot.positions.ai.x},${snapshot.positions.ai.y}`), human: cellName(`${snapshot.positions.human.x},${snapshot.positions.human.y}`) },
    goals: { you: 'column A', human: 'column G' }, status: snapshot.status,
    traps: PLAYERS.flatMap(p => snapshot.rules[p].map(r => ({ owner: p === 'ai' ? 'you' : 'human', effect: r.label, squares: r.cells.map(cellName) }))),
    options: options.map(c => ({ id: c.id, does: c.summary, score: Number(c.score.toFixed(2)), worst: Number(c.worst.toFixed(2)) })),
  };
  try {
    const raw = await chatJSON('opponent', OPPONENT_SYSTEM, JSON.stringify(payload), OPPONENT_SCHEMA, { temperature: 0.7, maxTokens: 350, timeoutMs: 20_000 }) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || typeof raw.choice !== 'string') throw new ProviderError('invalid_reply', 'no choice');
    const chosen = options.find(c => c.id === raw.choice);
    if (!chosen) throw new ProviderError('invalid_reply', `unknown option ${String(raw.choice).slice(0, 20)}`);
    const a = structuredClone(chosen.action);
    let ruleInterpretation: Interpretation | null = null;
    if (a.rule.op === 'place') {
      const text = typeof raw.ruleText === 'string' && raw.ruleText.trim() ? raw.ruleText.trim().slice(0, 160) : aiPhrase(a.rule.effect, snapshot.round);
      const res = await interpretRule(text);
      ruleInterpretation = res.interpretation;
      a.rule = applyInterpretation(snapshot, 'ai', a.rule, text, res.interpretation);
    }
    return {
      ...base(chosen), action: safe(snapshot, a), source: 'openrouter', model: modelName(), fallbackReason: null,
      taunt: typeof raw.taunt === 'string' ? raw.taunt.slice(0, 90) : '', rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 240) : '', ruleInterpretation,
    };
  } catch (e) {
    const why = e instanceof ProviderError ? `${e.kind}: ${e.message}` : (e as Error).message;
    return local(`OpenRouter failed (${why})`);
  }
}

/** The AI's rule is whatever its own words mean to the judge. If that no longer fits, the trap is dropped. */
function applyInterpretation(s: State, p: Player, planned: Extract<RuleAction, { op: 'place' }>, text: string, i: Interpretation): RuleAction {
  if (i.status === 'reject') return { op: 'none' };
  const cells = planned.cells.slice(0, maxCells(i.effect));
  const r: RuleAction = { op: 'place', text, effect: i.effect, cells, interpretedBy: i.source, ...(planned.slot !== undefined ? { slot: planned.slot } : {}), ...(i.status === 'approximate' ? { approxNote: i.note } : {}) };
  return validateAction(s, p, { rule: r, move: 'hold' }).ok ? r : { op: 'none' };
}
function safe(s: State, a: Action): Action {
  if (validateAction(s, 'ai', a).ok) return a;
  const m = { rule: { op: 'none' } as RuleAction, move: a.move };
  return validateAction(s, 'ai', m).ok ? m : NO_ACTION;
}
function localTaunt(a: Action, s: State): string {
  const lines = a.rule.op === 'place'
    ? ['I have prepared a little surprise.', 'Watch your step. Or don’t. I’d prefer you don’t.', 'Constructing… something.', 'This square has my full attention now.']
    : ['Just walking. Totally normal walking.', 'I see your traps. I respect your traps.', 'Calculating… calculating…', 'Nothing up my sleeve.'];
  return lines[(s.round * 7 + s.seed) % lines.length];
}

function startRound(g: Game) {
  const snapshot = structuredClone(g.state); // public start-of-round state; contains no human action
  g.aiReady = false;
  if (g.state.winner) { g.aiDecision = Promise.resolve(null as unknown as AIDecision); return; }
  g.aiDecision = decideAI(snapshot).then(d => { g.aiReady = true; return d; });
  g.aiDecision.catch(() => {});
}

export function newGame(seed?: number): Game {
  const id = randomUUID();
  const g: Game = {
    id, state: init(seed ?? (Date.now() & 0x7fffffff)), aiDecision: Promise.resolve(null as unknown as AIDecision), aiReady: false,
    interpretations: new Map(), busy: false, progress: [], achievements: { human: [], ai: [] }, lastRound: null, refereeMode: refereeMode(), ruleOrigin: new Map(),
  };
  games.set(id, g);
  if (games.size > 200) games.delete(games.keys().next().value!);
  startRound(g);
  return g;
}
export const getGame = (id: string) => games.get(id);

export function view(g: Game) {
  return { gameId: g.id, ...publicView(g.state), aiReady: g.aiReady, busy: g.busy, refereeMode: g.refereeMode, achievements: g.achievements, model: modelConfigured() ? modelName() : null };
}

export async function preview(g: Game, text: string) {
  const r = await interpretRule(text);
  const i = r.interpretation;
  const token = randomUUID();
  if (i.status !== 'reject') g.interpretations.set(token, { token, text: text.trim(), interpretation: i, at: Date.now() });
  return {
    token: i.status === 'reject' ? null : token, interpretation: i, fallback: r.fallback, ms: r.ms,
    ...(i.status !== 'reject' ? { costPerSquare: effectCost(i.effect), maxSquares: maxCells(i.effect), budget: RULE_BUDGET, label: shortLabel(i.effect) } : {}),
  };
}

export type HumanTurn = { move: Action['move']; rule: { op: 'none' } | { op: 'remove'; slot: number } | { op: 'place'; token: string; cells: string[]; slot?: number } };

async function referee(g: Game, s: State, p: Player, r: Extract<RuleAction, { op: 'place' }>): Promise<Verdict> {
  const trial = buildTrial(s, p, r, ++trialCounter);
  const html = renderTrialPage(trial);
  trials.set(trial.trialId, { trial, html });
  if (trials.size > 300) trials.delete(trials.keys().next().value!);
  const who = p === 'human' ? 'your' : 'the AI’s';
  const scenarioIds = [...trial.triggers.map(t => t.scenarioId), trial.rollout.scenarioId];
  g.progress.push({ at: Date.now(), text: `Sandbox ran ${scenarioIds.length} what-if scenarios for ${who} rule (${trial.trialId}, ${trial.buildMs} ms).` });
  const base = { player: p, ruleText: r.text, label: shortLabel(r.effect), cells: r.cells.map(cellName), trial: { trialId: trial.trialId, buildMs: trial.buildMs, engineChecks: trial.engineChecks, scenarioIds } };
  const failed = trial.engineChecks.find(c => !c.pass);
  if (failed) return { ...base, final: 'rejected', message: `Engine safety check failed: ${failed.text} (${failed.detail}).`, kane: null, activated: false };
  if (g.refereeMode === 'engine-only') return { ...base, final: 'unverified', message: 'Engine checks passed. Kane referee is switched off, so this rule is NOT Kane-verified.', kane: null, activated: false };
  g.progress.push({ at: Date.now(), text: `Kane is examining ${who} rule…` });
  const port = Number(process.env.PORT || 3000);
  const kane = await kaneJudge({ trialId: trial.trialId, signature: trial.signature, url: `http://127.0.0.1:${port}/trial/${trial.trialId}`, html, conditions: KANE_CONDITIONS });
  g.progress.push({ at: Date.now(), text: kane.status === 'approved' ? `Kane approved ${who} rule${kane.cached ? ' (same trial seen before, cached verdict)' : ` in ${(kane.elapsedMs / 1000).toFixed(1)}s`}.` : kane.status === 'rejected' ? `Kane rejected ${who} rule.` : `Kane could not verify ${who} rule.` });
  return { ...base, final: kane.status, message: kane.reason, kane, activated: false };
}

/** Whether unverified rules may go live. Default: no (only Kane-approved rules activate). */
const allowUnverified = () => process.env.ALLOW_UNVERIFIED_RULES === '1';

export async function playTurn(g: Game, turn: HumanTurn) {
  if (g.busy) throw new Error('A turn is already being resolved.');
  if (g.state.winner) throw new Error('The game is over. Start a rematch.');
  g.busy = true; g.progress = [];
  try {
    const s = g.state;
    // Build the human action from the stored, previously shown interpretation (no re-interpretation drift).
    let rule: RuleAction = { op: 'none' };
    if (turn.rule?.op === 'remove') rule = { op: 'remove', slot: turn.rule.slot };
    if (turn.rule?.op === 'place') {
      const pend = g.interpretations.get(turn.rule.token);
      if (!pend || pend.interpretation.status === 'reject') throw new Error('Preview the rule first.');
      const i = pend.interpretation;
      rule = { op: 'place', text: pend.text, effect: i.effect, cells: turn.rule.cells, interpretedBy: i.source, ...(turn.rule.slot !== undefined ? { slot: turn.rule.slot } : {}), ...(i.status === 'approximate' ? { approxNote: i.note } : {}) };
    }
    const human: Action = s.status.human.skip ? NO_ACTION : { rule, move: turn.move };
    const chk = validateAction(s, 'human', human);
    if (!chk.ok) throw Object.assign(new Error(chk.reason), { status: 422 });
    g.progress.push({ at: Date.now(), text: g.aiReady ? 'AI had already locked in its move before yours arrived.' : 'Waiting for the AI to lock in (it cannot see your move)…' });
    const ai = await g.aiDecision;
    const aiAction: Action = s.status.ai.skip ? NO_ACTION : ai.action;

    // Referee: every new rule from either side gets the same trial + Kane review before activation.
    const verdicts: Verdict[] = [];
    const final: Record<Player, Action> = { human, ai: aiAction };
    await Promise.all(PLAYERS.map(async p => {
      const r = final[p].rule;
      if (r.op !== 'place') return;
      const v = await referee(g, s, p, r);
      v.activated = v.final === 'approved' || (v.final === 'unverified' && (g.refereeMode === 'engine-only' || allowUnverified()));
      verdicts.push(v);
      if (!v.activated) final[p] = { rule: { op: 'none' }, move: final[p].move };
    }));
    verdicts.sort((a, b) => (a.player === 'human' ? -1 : 1) - (b.player === 'human' ? -1 : 1));

    const before = g.state;
    const { state, events } = resolveRound(before, final);
    g.state = state;
    for (const e of events) if (e.t === 'place') g.ruleOrigin.set(e.ruleId, { by: e.p, source: 'placed' });
    const reactions = reactionsFor(events, before, state);
    if (state.winner) {
      const ach = achievementsFor(state);
      g.achievements = ach;
    }
    const result = {
      round: before.round, events, verdicts, reactions,
      ai: { source: ai.source, model: ai.model, fallbackReason: ai.fallbackReason, taunt: ai.taunt, rationale: ai.rationale, plan: ai.plan, decidedAt: ai.decidedAt, ruleInterpretation: ai.ruleInterpretation, action: describeAction(aiAction) },
      humanAction: describeAction(human),
    };
    g.lastRound = result;
    startRound(g);
    return { result, view: view(g) };
  } finally { g.busy = false; }
}

export const eligible = (g: Game) => eligibleCells(g.state);
export type { Effect, GameEvent };

/**
 * Reproducible AI-vs-AI self-play with the REAL engine and the REAL planner for both players.
 * Every game: fixed seed, forced first player (paired: each seed is played once with each side
 * starting), weights frozen per player for the whole game. Consequences of every effect trigger
 * are measured from engine events, not estimated.
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  type State, type GameEvent, type Placement, type RuleVariant, init, applyPlacement, applyMove, endTurn, validatePlacement, validateMove,
  legalMoves, onBoard, parseKey, GOAL_X, ruleById, scored as scoredN, distanceLeft,
  type StartingConfiguration, type StartState, compareStanding,
} from '../engine.ts';
import { createHash } from 'node:crypto';
import { planTurn, planMoves, basePenalty, type PlannerHooks } from '../ai.ts';
import { planTurnEV, nextMovesEV, EV_PLANNER_ID, type EVVariant } from './v4/evplanner.ts';
import { planPolicy, policyMoves, type PolicyId } from './v5/policies.ts';
import { planTurnAbl, nextMovesAbl, type AblFlags } from './v5_1/ablation.ts';
import { planTurn52, type Arm as Arm52 } from './v5_2/planner.ts';
import { nextMoves11 } from './v5/evk11.ts';
import { planPolicy53, type Policy53, type Meta as Meta53 } from './v5_3/policies.ts';
import { type Player, type Effect, PLAYERS, other } from '../rules.ts';
import { type Weights, type FrozenWeights, effectId, activationUtility, freezeWeights, weightsHash } from '../weights.ts';

export type TriggerRec = {
  turn: number; mover: Player; owner: Player; self: boolean; effect: string; kind: Effect['kind']; cell: string; pieces: number; chain: number;
  /** Measured cost to the entering piece's owner, in actions (positive = harm, negative = help). null = not resolved by game end. */
  realized: number | null; how: string;
  /** What the placer's weights predicted (weighted) and the unweighted geometric estimate. */
  predicted: number; base: number;
};
export type PlacementRec = { turn: number; p: Player; effect: string; cells: string[] };
export type GameRec = {
  seed: number; first: Player; weights: Record<Player, { version: string; hash: string }>;
  winner: Player | 'draw'; reason: string; turns: number; turnLimit: boolean;
  placements: PlacementRec[]; triggers: TriggerRec[]; unusedCells: Record<string, number>; placedCells: Record<string, number>;
  unusedActions: Record<Player, number>; illegal: string[]; errors: string[]; softlock: boolean; longestStuck: Record<Player, number>;
  signature: Record<Player, string>; ms: number;
  /** Counterplay: how often the lead (pieces across, then squares left) changed hands, and whether the winner ever trailed after turn 4. */
  leadChanges: number; trailed: Record<Player, boolean>;
  /** Board before/after the move that set off the trigger asked for in opts.capture (replays only). */
  captured?: Captured;
  /** V2 experiments only (absent in production-condition games): the rule variant id and planner hooks in force. */
  variant?: string; hooks?: Partial<Record<Player, PlannerHooks>>;
  /** V2 exploration replays only: the planner's chosen plan and its best rejected alternatives per turn. */
  planTrace?: PlanTrace[];
  /** V3 experiments only: the resolved experimental starting configuration (absent in production-condition games). */
  start?: StartState;
  /** V3 only (opts.detail): pieces across per side at the end, and the replayable turn-by-turn record. */
  scored?: Record<Player, number>;
  /** V3 only (opts.replanOnRandom): how often a side re-planned after a teleport during its turn. */
  replans?: number;
  /** V4 only (opts.planner): which side used the experiment-only expected-value candidate. Absent = production planner on both sides. */
  planners?: Partial<Record<Player, string>>;
  /** V4.2 only: EV planner variants in force per side, and how many turns each side deliberately held back (K3). */
  evVariants?: Partial<Record<Player, EVVariant>>; holdBackTurns?: Record<Player, number>;
  /** V5 only (opts.policy): the policy each side played (prepared; no V5 game has been run yet). */
  policies?: Partial<Record<Player, PolicyId>>;
  /** V5.1 only (opts.ablation): the C1-C4 flags each side played with. */
  ablation?: Partial<Record<Player, AblFlags>>;
  /** V5.2 only (opts.v52): the C4 x stream arm each side played. */
  v52?: Partial<Record<Player, Arm52>>;
  /** V5.3 only (opts.policy53). */
  policies53?: Partial<Record<Player, Policy53>>;
  detail?: GameDetail;
};
/** One move as executed by the real engine, with the engine RNG before it and every engine event it produced. */
export type DetailMove = { from: string; dir: string; mode: string; rngBefore: number; events: GameEvent[] };
export type DetailCandidate = { id: string; summary: string; score: number; effect: string | null; cells: string[]; moves: number };
export type DetailTurn = {
  turn: number; p: Player; actions: number; rngStart: number;
  /** Compact board at the start of the turn: piece id@x,y (s = across, fN = frozen N, + = shield) and live effect cells. */
  board: { pieces: string[]; cells: string[] };
  /** Every whole-turn candidate the planner evaluated (placement variants x greedy moves), ranked; `chosen` is its id. */
  candidates: DetailCandidate[]; chosen: string; considered: number; sims: number;
  placement: { effect: string; cells: string[]; events: GameEvent[] } | null; moves: DetailMove[]; endEvents: GameEvent[]; unused: number;
  /** V5 only: the chosen plan's committed moves (to check planner/executor agreement against `moves`). */
  plannedMoves?: { from: string; dir: string; mode: string }[];
  /** V5.2 only: the temperature-roll draw used this turn (null = no roll needed) and how many candidates were in the window. */
  plannerRoll?: number | null; nearCount?: number;
  /** V5.3 only: per-decision computation and approximation metadata of the policy. */
  policyMeta?: Meta53;
};
export type GameDetail = { schema: 'rule-sabotage/game-detail@1'; seed: number; first: Player; start: StartState | null; turns: DetailTurn[]; finalHash: string };
export type PlanTrace = { turn: number; p: Player; chosen: string; chosenScore: number; alternatives: { summary: string; score: number }[] };
export type PlayOpts = { maxMs?: number; capture?: { turn: number; cell: string }; hooks?: Partial<Record<Player, PlannerHooks>>; variant?: RuleVariant; traceTurns?: number; start?: StartingConfiguration; detail?: boolean; replanOnRandom?: boolean; planner?: Partial<Record<Player, 'ev-v4'>>; evVariant?: Partial<Record<Player, EVVariant>>; policy?: Partial<Record<Player, PolicyId>>; ablation?: Partial<Record<Player, AblFlags>>; v52?: Partial<Record<Player, Arm52>>; policy53?: Partial<Record<Player, Policy53>> };
export type BoardSnap = { pieces: { id: string; owner: Player; x: number; y: number; scored: boolean; frozen: number }[]; cells: { cell: string; label: string; owner: Player }[] };
export type Captured = { turn: number; cell: string; mover: Player; move: string; before: BoardSnap; after: BoardSnap; events: GameEvent[] };

const dist = (p: Player, x: number) => Math.abs(GOAL_X[p] - x);

type Pending = { rec: TriggerRec; owner: Player; nPieces: number; kind: 'freeze' | 'haste-now' | 'haste-later'; dueTurnsOf: Player; seen: number };

/** Play one complete game. Weights are frozen copies; nothing here can change the engine. */
export function playGame(seed: number, first: Player, weights: Record<Player, FrozenWeights>, opts: PlayOpts = {}): GameRec {
  const t0 = Date.now();
  const s: State = init(seed, { first, ...(opts.variant ? { variant: opts.variant } : {}), ...(opts.start ? { start: opts.start } : {}) });
  const detail: DetailTurn[] | null = opts.detail ? [] : null;
  const compactBoard = () => ({
    pieces: s.pieces.map(q => `${q.id}@${q.x},${q.y}${q.scored ? 's' : ''}${q.frozen ? `f${q.frozen}` : ''}${q.shield ? '+' : ''}`),
    cells: Object.entries(s.cells).sort(([a], [b]) => a.localeCompare(b)).map(([k, id]) => { const r = ruleById(s, id)!; return `${k}=${effectId(r.effect)}:${r.owner}`; }),
  });
  const rec: GameRec = {
    seed, first, weights: { human: { version: weights.human.version, hash: weights.human.hash }, ai: { version: weights.ai.version, hash: weights.ai.hash } },
    winner: 'draw', reason: '', turns: 0, turnLimit: false, placements: [], triggers: [], unusedCells: {}, placedCells: {},
    unusedActions: { human: 0, ai: 0 }, illegal: [], errors: [], softlock: false, longestStuck: { human: 0, ai: 0 }, signature: { human: '', ai: '' }, ms: 0,
    leadChanges: 0, trailed: { human: false, ai: false },
  };
  let lastLead = 0;
  const pending: Pending[] = [];
  const shields = new Map<string, TriggerRec>(); // piece id -> the shield trigger that gave it
  const stuck = { human: 0, ai: 0 };
  const placedBy: Record<Player, string[]> = { human: [], ai: [] };

  const handle = (events: GameEvent[], cellEffect: Map<string, { effect: Effect; owner: Player }>) => {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'shielded') {
        const snap = cellEffect.get(e.cell);
        for (const id of e.pieces) {
          const tr = shields.get(id); shields.delete(id);
          if (tr && snap) { const q = s.pieces.find(x => x.id === id)!; tr.realized = (tr.realized ?? 0) - Math.max(0, basePenalty(q.owner, e.cell, snap.effect)); tr.how = 'blocked a trap'; }
        }
      }
      if (e.t !== 'trigger') continue;
      const rule = ruleById(s, e.ruleId)!;
      const eff = rule.effect, id = effectId(eff);
      const base = basePenalty(e.p, e.cell, eff);
      const tr: TriggerRec = { turn: s.turn, mover: e.p, owner: e.owner, self: e.self, effect: id, kind: eff.kind, cell: e.cell, pieces: e.pieces.length, chain: e.chain, realized: null, how: '', predicted: -activationUtility(eff, e.p, weights[e.owner]) * e.pieces.length, base: base * e.pieces.length };
      rec.triggers.push(tr);
      if (eff.kind === 'shove' || eff.kind === 'home' || eff.kind === 'teleport') {
        let forced: Extract<GameEvent, { t: 'forced' }> | null = null;
        for (let j = i + 1; j < events.length; j++) { const f = events[j]; if (f.t === 'trigger') break; if (f.t === 'forced') { forced = f; break; } }
        if (!forced) { tr.realized = 0; tr.how = 'no movement (no free square)'; continue; }
        const fx = parseKey(forced.from).x;
        tr.realized = forced.to.split('|').reduce((a, k) => a + dist(e.p, parseKey(k).x) - dist(e.p, fx), 0) * (forced.to.includes('|') ? 1 : e.pieces.length);
        tr.how = `moved ${forced.from}→${forced.to}`;
      } else if (eff.kind === 'freeze') {
        tr.realized = 0; tr.how = 'pending: next own turn';
        pending.push({ rec: tr, owner: e.p, nPieces: e.pieces.length, kind: 'freeze', dueTurnsOf: e.p, seen: s.current === e.p ? 0 : 0 });
      } else if (eff.kind === 'haste') {
        tr.realized = 0; tr.how = 'pending';
        pending.push({ rec: tr, owner: e.p, nPieces: 1, kind: s.current === e.p ? 'haste-now' : 'haste-later', dueTurnsOf: e.p, seen: 0 });
      } else if (eff.kind === 'shield') {
        tr.realized = 0; tr.how = 'shield never used';
        for (const id2 of e.pieces) shields.set(id2, tr);
      }
    }
  };
  const board = (): BoardSnap => ({ pieces: s.pieces.map(q => ({ id: q.id, owner: q.owner, x: q.x, y: q.y, scored: q.scored, frozen: q.frozen })), cells: Object.entries(s.cells).map(([k, id]) => { const r = ruleById(s, id)!; return { cell: k, label: r.label, owner: r.owner }; }) });
  const snapshot = () => new Map(Object.entries(s.cells).map(([k, id]) => { const r = ruleById(s, id)!; return [k, { effect: r.effect, owner: r.owner }]; }));

  let guard = 0;
  while (!s.winner && guard++ < 400) {
    if (opts.maxMs && Date.now() - t0 > opts.maxMs) { rec.errors.push(`game exceeded ${opts.maxMs} ms`); break; }
    const p = s.current, w = weights[p];
    const turnNo = s.turn;
    const lm = legalMoves(s, p).length;
    if (onBoard(s, p).length && lm === 0) { stuck[p]++; rec.longestStuck[p] = Math.max(rec.longestStuck[p], stuck[p]); } else stuck[p] = 0;
    const dt: DetailTurn | null = detail ? { turn: turnNo, p, actions: s.actionsLeft, rngStart: s.rng, board: compactBoard(), candidates: [], chosen: '', considered: 0, sims: 0, placement: null, moves: [], endEvents: [], unused: 0 } : null;
    if (dt) detail!.push(dt);
    try {
      // V5: a policy decides the turn (placement); moves always use the reference EV executor with K1.
      const pol = opts.policy?.[p];
      const abl = opts.ablation?.[p];
      const a52 = opts.v52?.[p];
      const p53 = opts.policy53?.[p];
      const ev = opts.planner?.[p] === 'ev-v4' || !!pol || !!abl || !!a52 || !!p53;
      const evv = opts.evVariant?.[p] ?? {};
      // V5 policies all execute with ev-k1.1's shared executor (policyMoves), never with the ev-k1 executor.
      const nextMv = () => (a52 || p53 ? nextMoves11(s, p, w) : abl ? nextMovesAbl(s, p, abl, w) : pol ? policyMoves(s, p, w) : nextMovesEV(s, p, w, evv));
      const full = p53 ? planPolicy53(p53, s, p, w) : a52 ? planTurn52(s, a52, { me: p, weights: w }) : abl ? planTurnAbl(s, abl, { me: p, weights: w }) : pol ? planPolicy(pol, s, p, w) : ev ? planTurnEV(s, { me: p, weights: w, variant: evv }) : planTurn(s, { me: p, weights: w, ...(opts.hooks?.[p] ? { hooks: opts.hooks[p] } : {}) });
      const plan = full.chosen;
      if (dt) { dt.candidates = full.ranked.map(c => ({ id: c.id, summary: c.summary, score: Math.round(c.score * 1000) / 1000, effect: c.placement ? effectId(c.placement.effect) : null, cells: c.placement ? [...c.placement.cells] : [], moves: c.moves.length })); dt.chosen = plan.id; dt.considered = full.candidates; dt.sims = full.sims; }
      if (opts.traceTurns && turnNo <= opts.traceTurns) (rec.planTrace ??= []).push({ turn: turnNo, p, chosen: plan.summary, chosenScore: Math.round(plan.score * 1000) / 1000, alternatives: full.ranked.filter(c => c !== plan).slice(0, 4).map(c => ({ summary: c.summary, score: Math.round(c.score * 1000) / 1000 })) });
      if (plan.placement) {
        const pl: Placement = plan.placement;
        const c = validatePlacement(s, p, pl);
        if (!c.ok) rec.illegal.push(`turn ${turnNo} ${p} placement: ${c.reason}`);
        else { const pev = applyPlacement(s, p, pl); rec.placements.push({ turn: turnNo, p, effect: effectId(pl.effect), cells: pl.cells }); placedBy[p].push(effectId(pl.effect)); if (dt) dt.placement = { effect: effectId(pl.effect), cells: [...pl.cells], events: pev }; }
      }
      if (s.phase === 'place') s.phase = 'move';
      // V4 candidate: play the committed prefix (it ends at a random move), then ask again from the real, now public, position.
      let evDone = !ev;
      let moves = ev ? [] : planMoves(s, p, 0, Math.random, w, opts.hooks?.[p]).moves, mi = 0;
      // V4.2 K3: a chosen hold-back plan is a deliberate decision: play exactly its (deterministic) moves and stop.
      const holdBack = ev && (plan as { holdBack?: boolean }).holdBack === true;
      if (holdBack) { moves = [...plan.moves]; evDone = true; (rec.holdBackTurns ??= { human: 0, ai: 0 })[p]++; }
      else if (ev) { const nx = nextMv(); moves = nx.moves; evDone = !nx.endsAtChance; }
      if (a52 && dt) { dt.plannerRoll = (full as { roll: number | null }).roll; dt.nearCount = (full as { nearCount: number }).nearCount; }
      if (p53 && dt) dt.policyMeta = (full as { meta: Meta53 }).meta;
      if ((pol || abl || a52 || p53) && dt) dt.plannedMoves = plan.moves.map(m => ({ from: m.from, dir: m.dir, mode: m.mode }));
      while (mi < moves.length || (!evDone && !s.winner && s.current === p && s.actionsLeft > 0)) {
        if (mi >= moves.length) { const nx = nextMv(); moves = nx.moves; mi = 0; evDone = !nx.endsAtChance; rec.replans = (rec.replans ?? 0) + 1; if (!moves.length) break; }
        const m = moves[mi++];
        if (s.winner || s.current !== p) break;
        const c = validateMove(s, p, m);
        if (!c.ok) { rec.illegal.push(`turn ${turnNo} ${p} move ${m.from} ${m.dir}: ${c.reason}`); break; }
        const snap = snapshot();
        const before = opts.capture && !rec.captured && turnNo === opts.capture.turn ? board() : null;
        const rngBefore = s.rng;
        const evt = applyMove(s, p, m);
        if (dt) dt.moves.push({ from: m.from, dir: m.dir, mode: m.mode, rngBefore, events: evt });
        if (before && evt.some(e => e.t === 'trigger' && e.cell === opts.capture!.cell)) rec.captured = { turn: turnNo, cell: opts.capture!.cell, mover: p, move: `${m.from} ${m.dir}`, before, after: board(), events: evt };
        handle(evt, snap);
        // V3 only: a planner that cannot see the RNG committed to moves for a teleport outcome it did not know; after a
        // teleport it re-plans its remaining actions from the real position (as a player would), instead of issuing stale moves.
        if (ev && evt.some(e => e.t === 'forced' && e.how === 'teleport') && mi < moves.length) { if (holdBack) rec.errors.push(`turn ${turnNo} ${p}: a hold-back prefix produced a random outcome`); moves = moves.slice(0, mi); evDone = false; }
        if (opts.replanOnRandom && evt.some(e => e.t === 'forced' && e.how === 'teleport') && !s.winner && s.current === p && s.actionsLeft > 0) { moves = planMoves(s, p, 0, Math.random, w, opts.hooks?.[p]).moves; mi = 0; rec.replans = (rec.replans ?? 0) + 1; }
      }
    } catch (e) { rec.errors.push(`turn ${turnNo} ${p}: ${(e as Error).message}`); break; }
    if (s.winner) break;
    // resolve freeze / haste consequences at the end of the affected player's turn
    const unused = s.actionsLeft;
    rec.unusedActions[p] += unused;
    for (const pd of [...pending]) {
      if (pd.dueTurnsOf !== p) continue;
      if (pd.kind === 'haste-now' && pd.rec.turn === turnNo) { pd.rec.realized = unused === 0 ? -1 : 0; pd.rec.how = unused === 0 ? 'extra action used' : 'extra action wasted'; pending.splice(pending.indexOf(pd), 1); continue; }
      if (pd.rec.turn === turnNo) continue; // the trigger happened during this same turn: wait for the next one
      if (pd.kind === 'freeze') { pd.rec.realized = Math.min(pd.nPieces, unused); pd.rec.how = `${Math.min(pd.nPieces, unused)} action(s) lost in the next own turn`; }
      else { pd.rec.realized = unused === 0 ? -1 : 0; pd.rec.how = unused === 0 ? 'banked action used' : 'banked action wasted'; }
      pending.splice(pending.indexOf(pd), 1);
    }
    const endEv = endTurn(s);
    if (dt) { dt.endEvents = endEv; dt.unused = unused; }
    const lead = s.start ? compareStanding(s) : Math.sign((scoredN(s, 'human') - scoredN(s, 'ai')) * 100 + (distanceLeft(s, 'ai') - distanceLeft(s, 'human')));
    if (lead !== 0 && lastLead !== 0 && lead !== lastLead) rec.leadChanges++;
    if (lead !== 0) lastLead = lead;
    if (s.turn > 4 && lead !== 0) rec.trailed[lead > 0 ? 'ai' : 'human'] = true;
  }
  for (const pd of pending) { pd.rec.realized = null; pd.rec.how = 'game ended before it resolved'; }
  rec.winner = s.winner ?? 'draw'; rec.reason = s.winReason || 'aborted'; rec.turns = s.turn; rec.turnLimit = /Turn limit/.test(s.winReason);
  rec.softlock = rec.longestStuck.human >= 2 || rec.longestStuck.ai >= 2 || (!s.winner);
  for (const r of s.rules) {
    const id = effectId(r.effect), hits = r.hits.human + r.hits.ai;
    rec.placedCells[id] = (rec.placedCells[id] ?? 0) + r.placed;
    rec.unusedCells[id] = (rec.unusedCells[id] ?? 0) + Math.max(0, r.placed - hits);
  }
  for (const p of PLAYERS) rec.signature[p] = [...placedBy[p].slice(0, 3)].join('>') || '(none)';
  if (opts.variant) rec.variant = opts.variant.id;
  if (s.start) rec.start = structuredClone(s.start);
  if (detail) {
    rec.scored = { human: scoredN(s, 'human'), ai: scoredN(s, 'ai') };
    rec.detail = { schema: 'rule-sabotage/game-detail@1', seed, first, start: s.start ? structuredClone(s.start) : null, turns: detail, finalHash: stateHash(s) };
  }
  if (opts.hooks && Object.values(opts.hooks).some(Boolean)) rec.hooks = structuredClone(opts.hooks);
  if (opts.evVariant && Object.values(opts.evVariant).some(v => v && Object.keys(v).length)) rec.evVariants = structuredClone(opts.evVariant);
  if (opts.policy && Object.values(opts.policy).some(Boolean)) rec.policies = { ...opts.policy };
  if (opts.ablation && Object.values(opts.ablation).some(Boolean)) rec.ablation = structuredClone(opts.ablation);
  if (opts.v52 && Object.values(opts.v52).some(Boolean)) rec.v52 = structuredClone(opts.v52);
  if (opts.policy53 && Object.values(opts.policy53).some(Boolean)) rec.policies53 = { ...opts.policy53 };
  if (opts.planner && Object.values(opts.planner).some(Boolean)) rec.planners = Object.fromEntries(Object.entries(opts.planner).filter(([, v]) => v).map(([k]) => [k, EV_PLANNER_ID]));
  rec.ms = Date.now() - t0;
  return rec;
}

/** Content hash of the parts of a state that decide the game (pieces, live cells, rules' cells, turn, RNG, winner). */
export function stateHash(s: State): string {
  const core = { turn: s.turn, rng: s.rng, current: s.current, winner: s.winner, winReason: s.winReason, pieces: s.pieces, cells: s.cells, rules: s.rules.map(r => [r.id, r.owner, effectId(r.effect), r.cells, r.hits]), bonus: s.bonus };
  return createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

export type Job = { seed: number; first: Player; weights: Record<Player, Weights>; hooks?: Partial<Record<Player, PlannerHooks>>; variant?: RuleVariant; start?: StartingConfiguration; detail?: boolean; replanOnRandom?: boolean; planner?: Partial<Record<Player, 'ev-v4'>>; evVariant?: Partial<Record<Player, EVVariant>>; policy?: Partial<Record<Player, PolicyId>>; ablation?: Partial<Record<Player, AblFlags>>; v52?: Partial<Record<Player, Arm52>>; policy53?: Partial<Record<Player, Policy53>> };
export const jobOpts = (j: Job, maxMs?: number): PlayOpts => ({ maxMs, ...(j.hooks ? { hooks: j.hooks } : {}), ...(j.variant ? { variant: j.variant } : {}), ...(j.start ? { start: j.start } : {}), ...(j.detail ? { detail: true } : {}), ...(j.replanOnRandom ? { replanOnRandom: true } : {}), ...(j.planner ? { planner: j.planner } : {}), ...(j.evVariant ? { evVariant: j.evVariant } : {}), ...(j.policy ? { policy: j.policy } : {}), ...(j.ablation ? { ablation: j.ablation } : {}), ...(j.v52 ? { v52: j.v52 } : {}), ...(j.policy53 ? { policy53: j.policy53 } : {}) });
export function pairedJobs(seeds: number[], weights: Weights | Record<Player, Weights>): Job[] {
  const w = 'schema' in weights ? { human: weights as Weights, ai: weights as Weights } : weights as Record<Player, Weights>;
  return seeds.flatMap(seed => PLAYERS.map(first => ({ seed, first, weights: w })));
}

/** Runs jobs in worker threads (bounded pool). Results come back in job order, so batches are reproducible. */
export async function runJobs(jobs: Job[], opts: { workers?: number; onGame?: (done: number, total: number, r: GameRec) => void; maxMs?: number } = {}): Promise<GameRec[]> {
  const n = Math.max(1, Math.min(jobs.length, opts.workers ?? (Number(process.env.BALANCE_WORKERS) || Math.max(1, Math.floor(availableParallelism() / 2)))));
  if (n === 1 || process.env.BALANCE_NO_WORKERS === '1') {
    const out: GameRec[] = [];
    for (const j of jobs) { const r = playGame(j.seed, j.first, { human: freezeWeights(j.weights.human), ai: freezeWeights(j.weights.ai) }, jobOpts(j, opts.maxMs)); out.push(r); opts.onGame?.(out.length, jobs.length, r); }
    return out;
  }
  const out: GameRec[] = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, () => new Promise<void>((resolve, reject) => {
    const wk = new Worker(new URL('./worker.ts', import.meta.url));
    const feed = () => { if (next >= jobs.length) { wk.terminate(); resolve(); return; } const i = next++; wk.postMessage({ i, job: jobs[i], maxMs: opts.maxMs }); };
    wk.on('message', (m: { i: number; rec?: GameRec; error?: string }) => {
      if (m.error) { reject(new Error(m.error)); wk.terminate(); return; }
      out[m.i] = m.rec!; done++; opts.onGame?.(done, jobs.length, m.rec!); feed();
    });
    wk.on('error', reject);
    feed();
  })));
  return out;
}

// ---------------------------------------------------------------- aggregation
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const quant = (a: number[], q: number) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
const entropy = (counts: number[]) => { const t = counts.reduce((a, b) => a + b, 0); return t ? -counts.filter(Boolean).reduce((a, c) => a + (c / t) * Math.log2(c / t), 0) : 0; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type EffectStats = {
  placements: number; share: number; cells: number; unusedCells: number; unusedRate: number;
  triggers: number; selfTriggerRate: number; resolved: number; realizedMean: number; predictedMean: number; baseMean: number;
  /** realized / predicted (1 = the weight matches what actually happens). null if too few or the prediction is ~0. */
  realization: number | null; harmfulRate: number; winRateWhenUsed: number | null; gamesUsed: number;
};
export type Metrics = {
  games: number; seeds: number[]; weights: string[]; wins: { human: number; ai: number; draw: number };
  firstPlayerWinRate: number; humanSideWinRate: number; decisiveGames: number; drawRate: number; turnLimitRate: number;
  pairsSweptByFirst: number; pairs: number;
  turns: { mean: number; median: number; p10: number; p90: number };
  effects: Record<string, EffectStats>; noPlacementTurnsShare: number;
  diversity: { effectEntropy: number; effectEntropyNorm: number; distinctEffectsUsed: number; distinctOpenings: number; topOpening: string; topOpeningShare: number };
  topCombo: { combo: string; games: number; winRate: number } | null;
  /** Every effect pair used by one player in one game at least 3 times, with that player's win rate. */
  combos: Record<string, { games: number; winRate: number }>;
  safety: { illegal: number; errors: number; softlocks: number; examples: string[] };
  unusedActionsPerGame: number;
  counterplay: { leadChangesPerGame: number; comebackRate: number };
};

export function aggregate(recs: GameRec[]): Metrics {
  const games = recs.length;
  const wins = { human: 0, ai: 0, draw: 0 };
  recs.forEach(r => wins[r.winner]++);
  const decisive = recs.filter(r => r.winner !== 'draw');
  const pairs = new Map<number, GameRec[]>(); recs.forEach(r => pairs.set(r.seed, [...(pairs.get(r.seed) ?? []), r]));
  const effects: Record<string, EffectStats> = {};
  const allPl = recs.flatMap(r => r.placements);
  const ids = [...new Set([...allPl.map(p => p.effect), ...recs.flatMap(r => r.triggers.map(t => t.effect))])].sort();
  for (const id of ids) {
    const pl = allPl.filter(p => p.effect === id);
    const tr = recs.flatMap(r => r.triggers.filter(t => t.effect === id));
    const res = tr.filter(t => t.realized !== null);
    const cells = recs.reduce((a, r) => a + (r.placedCells[id] ?? 0), 0), unused = recs.reduce((a, r) => a + (r.unusedCells[id] ?? 0), 0);
    const realizedMean = mean(res.map(t => t.realized!)), predictedMean = mean(res.map(t => t.predicted));
    const used = recs.flatMap(r => PLAYERS.filter(p => r.placements.some(x => x.p === p && x.effect === id)).map(p => ({ r, p })));
    const usedDecisive = used.filter(u => u.r.winner !== 'draw');
    effects[id] = {
      placements: pl.length, share: allPl.length ? r3(pl.length / allPl.length) : 0, cells, unusedCells: unused, unusedRate: cells ? r3(unused / cells) : 0,
      triggers: tr.length, selfTriggerRate: tr.length ? r3(tr.filter(t => t.self).length / tr.length) : 0, resolved: res.length,
      realizedMean: r3(realizedMean), predictedMean: r3(predictedMean), baseMean: r3(mean(res.map(t => t.base))),
      realization: res.length >= 3 && Math.abs(predictedMean) > 0.05 ? r3(realizedMean / predictedMean) : null,
      harmfulRate: res.length ? r3(res.filter(t => t.realized! > 0).length / res.length) : 0,
      winRateWhenUsed: usedDecisive.length ? r3(usedDecisive.filter(u => u.r.winner === u.p).length / usedDecisive.length) : null, gamesUsed: used.length,
    };
  }
  const turnsPerPlayerGame = recs.reduce((a, r) => a + r.turns, 0);
  const openings = recs.flatMap(r => PLAYERS.map(p => r.signature[p]));
  const oc = new Map<string, number>(); openings.forEach(o => oc.set(o, (oc.get(o) ?? 0) + 1));
  const top = [...oc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ['(none)', 0];
  // most common pair of distinct effects used by the same player in one game, with that player's win rate
  const combos = new Map<string, { n: number; w: number }>();
  for (const r of recs) for (const p of PLAYERS) {
    const used = [...new Set(r.placements.filter(x => x.p === p).map(x => x.effect))].sort();
    for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
      const k = `${used[i]} + ${used[j]}`, c = combos.get(k) ?? { n: 0, w: 0 }; c.n++; if (r.winner === p) c.w++; combos.set(k, c);
    }
  }
  const tc = [...combos.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
  const counts = ids.map(id => effects[id].placements);
  const ent = entropy(counts);
  return {
    games, seeds: [...pairs.keys()].sort((a, b) => a - b), weights: [...new Set(recs.flatMap(r => [`${r.weights.human.version}#${r.weights.human.hash}`, `${r.weights.ai.version}#${r.weights.ai.hash}`]))],
    wins, firstPlayerWinRate: decisive.length ? r3(decisive.filter(r => r.winner === r.first).length / decisive.length) : 0.5,
    humanSideWinRate: decisive.length ? r3(wins.human / decisive.length) : 0.5, decisiveGames: decisive.length, drawRate: games ? r3(wins.draw / games) : 0,
    turnLimitRate: games ? r3(recs.filter(r => r.turnLimit).length / games) : 0,
    pairsSweptByFirst: [...pairs.values()].filter(g => g.length === 2 && g.every(r => r.winner === r.first)).length, pairs: [...pairs.values()].filter(g => g.length === 2).length,
    turns: { mean: r3(mean(recs.map(r => r.turns))), median: quant(recs.map(r => r.turns), 0.5), p10: quant(recs.map(r => r.turns), 0.1), p90: quant(recs.map(r => r.turns), 0.9) },
    effects, noPlacementTurnsShare: turnsPerPlayerGame ? r3(1 - allPl.length / turnsPerPlayerGame) : 0,
    diversity: { effectEntropy: r3(ent), effectEntropyNorm: ids.length > 1 ? r3(ent / Math.log2(ids.length)) : 0, distinctEffectsUsed: ids.filter(id => effects[id].placements > 0).length, distinctOpenings: oc.size, topOpening: top[0], topOpeningShare: openings.length ? r3(top[1] / openings.length) : 0 },
    topCombo: tc ? { combo: tc[0], games: tc[1].n, winRate: r3(tc[1].w / tc[1].n) } : null,
    combos: Object.fromEntries([...combos.entries()].filter(([, c]) => c.n >= 3).sort((a, b) => a[0].localeCompare(b[0])).map(([k, c]) => [k, { games: c.n, winRate: r3(c.w / c.n) }])),
    safety: { illegal: recs.reduce((a, r) => a + r.illegal.length, 0), errors: recs.reduce((a, r) => a + r.errors.length, 0), softlocks: recs.filter(r => r.softlock).length, examples: recs.flatMap(r => [...r.illegal, ...r.errors].map(x => `seed ${r.seed}/${r.first}: ${x}`)).slice(0, 10) },
    counterplay: { leadChangesPerGame: games ? r3(mean(recs.map(r => r.leadChanges))) : 0, comebackRate: decisive.length ? r3(decisive.filter(r => r.trailed[r.winner as Player]).length / decisive.length) : 0 },
    unusedActionsPerGame: games ? r3(recs.reduce((a, r) => a + r.unusedActions.human + r.unusedActions.ai, 0) / games) : 0,
  };
}
export { other, weightsHash };

/**
 * Balance Designer V4.1: offline diagnostics of the V4 pilot records. Plays NO new game: it reads the stored
 * records, replays positions through the engine, and asks the planners about recorded or mirrored positions.
 *
 *  D1 second-mover advantage in EV-vs-EV (arm B) against production (arm A): tempo, scoring timeline, who uses
 *     whose traps, captures.
 *  D2 Human-side / AI-side asymmetry: is the planner mirror-consistent? A position and its left-right mirror
 *     (columns reversed, sides and east/west swapped) are the same game for the other side; a symmetric planner
 *     must choose the mirrored plan with the same score.
 *  D3 opening diversity: what the planner sees on turn 1 (ranked candidates, margins, temperature window).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type State, type Move, init, applyPlacement, applyMove, endTurn, SIZE, type Dir } from '../../engine.ts';
import { type Player, type Effect, PLAYERS, makeEffect } from '../../rules.ts';
import { loadWeights, effectFromId, effectId } from '../../weights.ts';
import { planTurn, evaluate, bestCells } from '../../ai.ts';
import { type GameRec } from '../selfplay.ts';
import { planTurnEV, nextMovesEV } from './evplanner.ts';
import { r3, mean } from '../v3/stats.ts';

type Rec = { gameId: string; arm: string; evSide: Player | 'both' | null; rec: GameRec };
const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
export function loadRecs(dir: string): Rec[] { return readdirSync(join(dir, 'games')).sort().map(f => JSON.parse(readFileSync(join(dir, 'games', f), 'utf8'))); }

/** Every turn-start position of a recorded game (engine replay of the recorded actions). */
export function positions(r: GameRec): { turn: number; p: Player; s: State; t: NonNullable<GameRec['detail']>['turns'][number] }[] {
  const d = r.detail!, s = init(d.seed, { first: d.first }), out: ReturnType<typeof positions> = [];
  for (const t of d.turns) {
    out.push({ turn: t.turn, p: t.p, s: structuredClone(s), t });
    if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' });
    if (s.phase === 'place') s.phase = 'move';
    for (const m of t.moves) applyMove(s, t.p, { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] });
    if (s.winner) break;
    endTurn(s);
  }
  return out;
}

// ---------------------------------------------------------------- D1
export function tempo(recs: Rec[]) {
  const roles = (r: GameRec) => ({ first: r.first, second: other(r.first) });
  const agg = { games: recs.length, firstWins: 0, secondWins: 0, draws: 0, scoredByRound: { first: [0, 0, 0, 0, 0, 0], second: [0, 0, 0, 0, 0, 0] }, firstScoreTurnMean: { first: 0, second: 0 }, conveyor: { first: 0, second: 0 }, hitByOpponentTrap: { first: 0, second: 0 }, ownTrapsUsedByOpponent: { first: 0, second: 0 }, captures: { first: 0, second: 0 }, placements: { first: {} as Record<string, number>, second: {} as Record<string, number> }, turn1: { placement: {} as Record<string, number>, movesMade: 0, squaresGained: 0 } };
  const fst: Record<'first' | 'second', number[]> = { first: [], second: [] };
  for (const { rec: r } of recs) {
    const R = roles(r), role = (p: Player) => (p === R.first ? 'first' : 'second') as 'first' | 'second';
    if (r.winner === 'draw') agg.draws++; else if (r.winner === R.first) agg.firstWins++; else agg.secondWins++;
    const d = r.detail!; const scoredAt: Record<Player, number[]> = { human: [], ai: [] };
    for (const t of d.turns) for (const m of t.moves) for (const e of m.events) {
      if (e.t === 'score') for (const _ of e.pieces) scoredAt[e.p].push(t.turn);
      if (e.t === 'capture') agg.captures[role(e.by)]++;
      if (e.t === 'trigger') { if (e.self) { if (['shove', 'teleport'].includes(e.kind)) agg.conveyor[role(e.p)]++; } else { agg.hitByOpponentTrap[role(e.p)]++; agg.ownTrapsUsedByOpponent[role(e.owner)]++; } }
    }
    for (const p of PLAYERS) { const rr = role(p); for (let k = 0; k < 6; k++) agg.scoredByRound[rr][k] += scoredAt[p].filter(t => Math.ceil(t / 2) <= k + 1).length; fst[rr].push(scoredAt[p][0] ?? 61); }
    for (const pl of r.placements) agg.placements[role(pl.p)][pl.effect] = (agg.placements[role(pl.p)][pl.effect] ?? 0) + 1;
    const t1 = d.turns[0]; const k1 = t1.placement?.effect ?? 'none'; agg.turn1.placement[k1] = (agg.turn1.placement[k1] ?? 0) + 1; agg.turn1.movesMade += t1.moves.length;
  }
  const n = recs.length;
  for (const rr of ['first', 'second'] as const) { agg.scoredByRound[rr] = agg.scoredByRound[rr].map(x => r3(x / n)); agg.firstScoreTurnMean[rr] = r3(mean(fst[rr])); agg.conveyor[rr] = r3(agg.conveyor[rr] / n); agg.hitByOpponentTrap[rr] = r3(agg.hitByOpponentTrap[rr] / n); agg.ownTrapsUsedByOpponent[rr] = r3(agg.ownTrapsUsedByOpponent[rr] / n); agg.captures[rr] = r3(agg.captures[rr] / n); }
  agg.turn1.movesMade = r3(agg.turn1.movesMade / n);
  return agg;
}

// ---------------------------------------------------------------- D2 mirror
const MX = (x: number) => SIZE - 1 - x;
const mk = (k: string) => { const [x, y] = k.split(',').map(Number); return `${MX(x)},${y}`; };
const mEffect = (e: Effect): Effect => (e.kind === 'shove' && (e.dir === 'east' || e.dir === 'west') ? makeEffect('shove', e.dir === 'east' ? 'west' : 'east', e.amount) : structuredClone(e));
const mId = (id: string) => (id[0] === 'h' ? 'a' : 'h') + id.slice(1);
/** Left-right mirror with sides swapped: the same position for the other player. */
export function mirror(s: State): State {
  const t = structuredClone(s);
  t.pieces = s.pieces.map(q => ({ ...q, id: mId(q.id), owner: other(q.owner), x: MX(q.x), home: { x: MX(q.home.x), y: q.home.y } }));
  t.cells = Object.fromEntries(Object.entries(s.cells).map(([k, v]) => [mk(k), v]));
  t.rules = s.rules.map(r => ({ ...structuredClone(r), owner: other(r.owner), effect: mEffect(r.effect), cells: r.cells.map(mk).sort(), hits: { human: r.hits.ai, ai: r.hits.human } }));
  t.current = other(s.current); t.firstPlayer = other(s.firstPlayer); t.bonus = { human: s.bonus.ai, ai: s.bonus.human };
  return t;
}
const mMove = (m: Move): Move => ({ from: mk(m.from), dir: m.dir === 'left' ? 'right' : m.dir === 'right' ? 'left' : m.dir, mode: m.mode });
const planSig = (pl: { placement: { effect: Effect; cells: string[] } | null; moves: Move[] }) => JSON.stringify([pl.placement ? [effectId(pl.placement.effect), [...pl.placement.cells].sort()] : null, pl.moves]);

export function mirrorCheck(recs: Rec[], o: { sample: number; planner: 'production' | 'ev'; variant?: import('./evplanner.ts').EVVariant }) {
  const w = loadWeights();
  const ps = recs.flatMap(r => positions(r.rec).filter(x => !x.s.winner)).filter((_, i) => i % 7 === 0).slice(0, o.sample);
  let evalAsym = 0, cellsAsym = 0, moveAsym = 0, planAsym = 0, scoreAsym = 0, checked = 0;
  const examples: unknown[] = [];
  for (const { s, p } of ps) {
    const m = mirror(s), q = other(p);
    checked++;
    if (Math.abs(evaluate(s, p, w) - evaluate(m, q, w)) > 1e-9) evalAsym++;
    const cellsDiff = [makeEffect('shove', 'back', 2), makeEffect('freeze'), makeEffect('teleport'), makeEffect('shove', 'north', 2)].some(e => JSON.stringify(bestCells(s, p, e, w).map(mk).sort()) !== JSON.stringify(bestCells(m, q, e, w).sort()));
    if (cellsDiff) cellsAsym++;
    const a = o.planner === 'ev' ? planTurnEV(s, { me: p, weights: w, temperature: 0, variant: o.variant }) : planTurn(s, { me: p, weights: w, temperature: 0 });
    const b = o.planner === 'ev' ? planTurnEV(m, { me: q, weights: w, temperature: 0, variant: o.variant }) : planTurn(m, { me: q, weights: w, temperature: 0 });
    const am = { placement: a.chosen.placement ? { effect: mEffect(a.chosen.placement.effect), cells: a.chosen.placement.cells.map(mk) } : null, moves: a.chosen.moves.map(mMove) };
    if (planSig(am) !== planSig(b.chosen)) { planAsym++; if (examples.length < 6) examples.push({ turn: s.turn, side: p, plan: a.chosen.summary, scoreA: r3(a.chosen.score), mirroredPlan: b.chosen.summary, scoreB: r3(b.chosen.score), bScoreOfMirrorOfA: r3(b.ranked.find(c => c.placement ? (effectId(c.placement.effect) === (am.placement ? effectId(am.placement.effect) : '') && JSON.stringify([...c.placement.cells].sort()) === JSON.stringify([...(am.placement?.cells ?? [])].sort())) : !am.placement)?.score ?? NaN) }); }
    if (Math.abs(a.chosen.score - b.chosen.score) > 1e-6) scoreAsym++;
    const nxA = o.planner === 'ev' ? nextMovesEV(s.phase === 'place' ? { ...s, phase: 'move' } : s, p, w, o.variant).moves : [];
    const nxB = o.planner === 'ev' ? nextMovesEV(m.phase === 'place' ? { ...m, phase: 'move' } : m, q, w, o.variant).moves : [];
    if (o.planner === 'ev' && JSON.stringify(nxA.map(mMove)) !== JSON.stringify(nxB)) moveAsym++;
  }
  return { planner: o.planner, variant: o.variant ?? {}, positions: checked, evaluateAsymmetric: evalAsym, trapCellsAsymmetric: cellsAsym, chosenPlanAsymmetric: planAsym, chosenScoreAsymmetric: scoreAsym, moveOnlyAsymmetric: moveAsym, examples };
}

// ---------------------------------------------------------------- D3 openings
export function openings(recs: Rec[]) {
  const t1 = recs.map(r => r.rec.detail!.turns[0]);
  const top = (t: typeof t1[number]) => t.candidates[0];
  const margins = t1.filter(t => t.candidates.length > 1).map(t => t.candidates[0].score - t.candidates[1].score);
  const window = t1.map(t => t.candidates.filter(c => c.score >= t.candidates[0].score - 0.6).length);
  const chosenEff: Record<string, number> = {}, topEff: Record<string, number> = {}, tpRank: number[] = [], tpGap: number[] = [];
  for (const t of t1) {
    const ch = t.candidates.find(c => c.id === t.chosen)!; chosenEff[ch.effect ?? 'none'] = (chosenEff[ch.effect ?? 'none'] ?? 0) + 1;
    topEff[top(t).effect ?? 'none'] = (topEff[top(t).effect ?? 'none'] ?? 0) + 1;
    const i = t.candidates.findIndex(c => c.effect === 'teleport'); if (i >= 0) { tpRank.push(i + 1); tpGap.push(t.candidates[0].score - t.candidates[i].score); }
  }
  const distinctTurn1 = new Set(t1.map(t => { const c = t.candidates.find(x => x.id === t.chosen)!; return `${c.effect}:${c.cells.join(' ')}`; })).size;
  return { games: recs.length, distinctTurn1Placements: distinctTurn1, chosenTurn1Effect: chosenEff, topRankedTurn1Effect: topEff, meanMarginTop2: r3(mean(margins)), meanCandidatesWithin0_6: r3(mean(window)), teleportCandidate: { present: tpRank.length, meanRank: r3(mean(tpRank)), meanGapToTop: r3(mean(tpGap)) } };
}

// ---------------------------------------------------------------- D1 detail: turn-2 captures and opening alternatives
import { evaluate as evalProd } from '../../ai.ts';
import { GOAL_X } from '../../engine.ts';
import { type EVVariant } from './evplanner.ts';
/** Captures made on turn 2 by the second mover, and whether they came through the trap it had just placed. */
export function turn2Captures(recs: Rec[]) {
  let caps = 0, forced = 0, viaNewTrap = 0, games = 0;
  for (const r of recs) { const t2 = r.rec.detail!.turns[1]; const cells = new Set(t2.placement?.cells ?? []); let c = 0; for (const m of t2.moves) { const viaNew = m.events.some(e => e.t === 'trigger' && cells.has(e.cell)); for (const e of m.events) if (e.t === 'capture') { caps += e.pieces.length; c += e.pieces.length; if (e.forced) forced += e.pieces.length; if (viaNew) viaNewTrap += e.pieces.length; } } if (c) games++; }
  return { games: recs.length, gamesWithTurn2Capture: games, capturedPieces: caps, viaForcedMove: forced, throughSecondMoversNewTrap: viaNewTrap };
}
/** Early timeline by role: squares still to go and captures per turn. */
export function timeline(recs: Rec[], turns = 8) {
  const out: { afterTurn: number; games: number; firstLeft: number; secondLeft: number; capturesByFirst: number; capturesBySecond: number }[] = [];
  const pos = recs.map(r => ({ r, ps: positions(r.rec) }));
  for (let T = 1; T <= turns; T++) { let dF = 0, dS = 0, cF = 0, cS = 0, n = 0; for (const { r, ps } of pos) { const at = ps.find(x => x.turn === T + 1)?.s; if (!at) continue; n++; const f = r.rec.first; const left = (p: Player) => at.pieces.filter(q => q.owner === p).reduce((a, q) => a + (q.scored ? 0 : Math.abs(GOAL_X[q.owner] - q.x)), 0); dF += left(f); dS += left(other(f)); for (const m of r.rec.detail!.turns.find(x => x.turn === T)!.moves) for (const e of m.events) if (e.t === 'capture') { if (e.by === f) cF += e.pieces.length; else cS += e.pieces.length; } } out.push({ afterTurn: T, games: n, firstLeft: r3(dF / n), secondLeft: r3(dS / n), capturesByFirst: r3(cF / n), capturesBySecond: r3(cS / n) }); }
  return out;
}
/** Turn-1 position: play the first mover's opening (variant, or forced k greedy moves), the default EV second mover replies; measure turn-2 captures and the first mover's evaluation. */
export function openingProbe(recs: Rec[], o: { variant?: EVVariant; forcedMoves?: number; noPlacement?: boolean }) {
  const w = loadWeights(); let caps = 0, ev = 0, moves = 0; const openingsSeen = new Set<string>();
  for (const r of recs) {
    const s = positions(r.rec)[0].s, p = r.rec.first;
    const plan = planTurnEV(s, { me: p, weights: w, temperature: 0, variant: o.variant });
    const st = structuredClone(s); if (plan.chosen.placement && !o.noPlacement) applyPlacement(st, p, plan.chosen.placement); st.phase = 'move';
    const ms = o.forcedMoves !== undefined ? nextMovesEV(st, p, w).moves.slice(0, o.forcedMoves) : plan.chosen.moves;
    for (const m of ms) applyMove(st, p, m);
    moves += ms.length; openingsSeen.add(`${o.noPlacement ? 'none' : plan.chosen.placement ? effectId(plan.chosen.placement.effect) : 'none'} x${ms.length}`);
    endTurn(st);
    const reply = planTurnEV(st, { me: st.current, weights: w, temperature: 0 }); if (reply.chosen.placement) applyPlacement(st, st.current, reply.chosen.placement); st.phase = 'move';
    for (const m of nextMovesEV(st, st.current, w).moves) for (const e of applyMove(st, st.current, m)) if (e.t === 'capture') caps += e.pieces.length;
    ev += evalProd(st, p, w);
  }
  const n = recs.length;
  return { positions: n, ...o, turn1MovesMean: r3(moves / n), turn2CapturesMean: r3(caps / n), firstMoverEvalAfterTurn2: r3(ev / n), distinctOpenings: openingsSeen.size };
}

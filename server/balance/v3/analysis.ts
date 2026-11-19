/**
 * Balance Designer V3: descriptive analysis of the 100-game screen, overall and per starting condition.
 *
 * Everything here is DESCRIPTIVE. With 20 games per condition, intervals are wide; the report says so next to
 * every rate, and the auto-written findings never call a difference real unless an exact test says the
 * observation is unlikely under "no difference" (and even then it is an exploratory signal, not a conclusion:
 * the same 100 games are not an independent holdout, and five conditions were screened at once).
 */
import { type GameRec } from '../selfplay.ts';
import { aggregate } from '../selfplay.ts';
import { type Player, PLAYERS } from '../../rules.ts';
import { type SummaryRow } from './batch.ts';
import { r3, mean, quant, wilson, binomTwoSided, minSignificantK, meanCI, permutationHeterogeneity, signTest } from './stats.ts';

export type Game = { row: SummaryRow; rec: GameRec };
const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
const SQUARES = 6;

/** Per-game derived measures (also shown on every replay page). */
export function derive(g: Game) {
  const r = g.rec, d = r.detail!, first = r.first, second = other(first);
  const count = r.start?.count ?? { human: 3, ai: 3 };
  const trig = r.triggers;
  const disp = trig.filter(t => ['shove', 'teleport', 'home'].includes(t.kind) && t.realized !== null);
  const gain = (t: typeof disp[number]) => -(t.realized as number); // squares gained by the stepping side
  const conveyor = disp.filter(t => t.self && gain(t) > 0);
  const conveyorSq: Record<Player, number> = { human: 0, ai: 0 }; for (const t of conveyor) conveyorSq[t.mover] += gain(t);
  const forcedFwd: Record<Player, number> = { human: 0, ai: 0 }, forcedBack: Record<Player, number> = { human: 0, ai: 0 };
  for (const t of disp) { if (gain(t) > 0) forcedFwd[t.mover] += gain(t); else forcedBack[t.mover] += -gain(t); }
  const byKindFwd: Record<string, number> = {}; for (const t of disp) if (gain(t) > 0) byKindFwd[t.kind] = (byKindFwd[t.kind] ?? 0) + gain(t);
  const margins = d.turns.filter(t => t.candidates.length > 1).map(t => t.candidates[0].score - t.candidates[1].score);
  const notTop = d.turns.filter(t => t.candidates.length && t.chosen !== t.candidates[0].id).length;
  const nearTies = d.turns.filter(t => t.candidates.length > 1 && t.candidates[0].score - t.candidates[1].score < 0.6).length;
  const noPlacement = d.turns.filter(t => !t.placement).length;
  const actions = (p: Player) => d.turns.filter(t => t.p === p).map(t => t.actions);
  const used = (p: Player) => d.turns.filter(t => t.p === p).reduce((a, t) => a + t.moves.length, 0);
  const firstScoreTurn: Record<Player, number | null> = { human: null, ai: null };
  for (const t of d.turns) for (const m of t.moves) for (const e of m.events) if (e.t === 'score' && firstScoreTurn[e.p] === null) firstScoreTurn[e.p] = t.turn;
  const teleports = d.turns.flatMap(t => t.moves.flatMap(m => m.events.filter(e => e.t === 'forced' && e.how === 'teleport').map(e => ({ turn: t.turn, rngBefore: m.rngBefore, to: (e as { to: string }).to }))));
  const scored = r.scored ?? { human: 0, ai: 0 };
  return {
    gameId: g.row.gameId, condition: g.row.condition, seed: r.seed, first, second, count, winner: r.winner, winnerRole: g.row.winnerRole, turns: r.turns, turnLimit: r.turnLimit,
    completed: !r.turnLimit && r.winner !== 'draw', reason: r.reason, scored,
    fracAcross: { human: r3(scored.human / count.human), ai: r3(scored.ai / count.ai) },
    triggers: trig.length, selfTriggers: trig.filter(t => t.self).length, oppTriggers: trig.filter(t => !t.self).length,
    conveyorTriggers: conveyor.length, conveyorSquares: conveyorSq, forcedForward: forcedFwd, forcedBack, forcedForwardByKind: byKindFwd,
    /** Share of each side's whole journey (pieces x 6 squares) that was covered by forced forward movement. */
    accelShare: { human: r3(forcedFwd.human / (count.human * SQUARES)), ai: r3(forcedFwd.ai / (count.ai * SQUARES)) },
    placements: r.placements.length, placedCells: Object.values(r.placedCells).reduce((a, b) => a + b, 0), unusedCells: Object.values(r.unusedCells).reduce((a, b) => a + b, 0),
    noPlacementTurns: noPlacement, playerTurns: d.turns.length,
    decision: { meanMargin: margins.length ? r3(mean(margins)) : null, nearTieShare: d.turns.length ? r3(nearTies / d.turns.length) : 0, notTopShare: d.turns.length ? r3(notTop / d.turns.length) : 0, candidatesPerTurn: r3(mean(d.turns.map(t => t.candidates.length))) },
    actionsPerTurn: { first: r3(mean(actions(first))), second: r3(mean(actions(second))) }, actionsUsed: { first: used(first), second: used(second) },
    unusedActions: r.unusedActions, leadChanges: r.leadChanges, comeback: r.winner !== 'draw' && r.trailed[r.winner as Player],
    firstScoreTurn, signature: r.signature, teleports, safety: { illegal: r.illegal.length, errors: r.errors.length, softlock: r.softlock },
  };
}
export type Derived = ReturnType<typeof derive>;

function rate(k: number, n: number) { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? r3(k / n) : null, ci95: [lo, hi] as [number, number], pVsHalf: binomTwoSided(k, n), includesHalf: lo <= 0.5 && hi >= 0.5 }; }
export type Rate = ReturnType<typeof rate>;

export function conditionStats(id: string, games: Game[], ds: Derived[]) {
  const n = games.length, dec = ds.filter(d => d.winner !== 'draw');
  const firstWins = dec.filter(d => d.winnerRole === 'first').length;
  const humanWins = dec.filter(d => d.winner === 'human').length;
  const asym = ds.length && ds[0].count[ds[0].first] !== ds[0].count[ds[0].second];
  const moreWins = asym ? dec.filter(d => d.count[d.winner as Player] > d.count[other(d.winner as Player)]).length : null;
  const agg = aggregate(games.map(g => g.rec));
  const sum = (f: (d: Derived) => number) => r3(mean(ds.map(f)));
  // conveyor association: in games where one side gained more squares from its own traps, how often did that side win?
  const conv = dec.filter(d => d.conveyorSquares.human !== d.conveyorSquares.ai);
  const convWin = conv.filter(d => (d.conveyorSquares.human > d.conveyorSquares.ai ? 'human' : 'ai') === d.winner).length;
  const combos = Object.entries(agg.combos).sort((a, b) => b[1].games - a[1].games || a[0].localeCompare(b[0])).slice(0, 6).map(([combo, c]) => ({ combo, ...c }));
  const effects = Object.entries(agg.effects).sort((a, b) => b[1].placements - a[1].placements).map(([effect, e]) => ({ effect, placements: e.placements, share: e.share, triggers: e.triggers, selfTriggerRate: e.selfTriggerRate, unusedRate: e.unusedRate, winRateWhenUsed: e.winRateWhenUsed }));
  const openings = new Map<string, number>(); ds.forEach(d => PLAYERS.forEach(p => openings.set(d.signature[p], (openings.get(d.signature[p]) ?? 0) + 1)));
  return {
    id, games: n, decisive: dec.length, draws: n - dec.length,
    pieces: ds[0] ? { firstMover: ds[0].count[ds[0].first], secondMover: ds[0].count[ds[0].second] } : null,
    firstMover: rate(firstWins, dec.length), humanSide: rate(humanWins, dec.length),
    sideWithMorePieces: moreWins === null ? null : rate(moreWins, dec.length),
    completionRate: r3(ds.filter(d => d.completed).length / (n || 1)), turnLimitRate: r3(ds.filter(d => d.turnLimit).length / (n || 1)), drawRate: r3((n - dec.length) / (n || 1)),
    turns: { ...meanCI(ds.map(d => d.turns)), median: r3(quant(ds.map(d => d.turns), 0.5)), p10: r3(quant(ds.map(d => d.turns), 0.1)), p90: r3(quant(ds.map(d => d.turns), 0.9)), min: Math.min(...ds.map(d => d.turns)), max: Math.max(...ds.map(d => d.turns)) },
    triggersPerGame: sum(d => d.triggers), selfTriggersPerGame: sum(d => d.selfTriggers), oppTriggersPerGame: sum(d => d.oppTriggers),
    selfTriggerShare: r3(ds.reduce((a, d) => a + d.selfTriggers, 0) / Math.max(1, ds.reduce((a, d) => a + d.triggers, 0))),
    conveyor: { triggersPerGame: sum(d => d.conveyorTriggers), squaresPerGame: sum(d => d.conveyorSquares.human + d.conveyorSquares.ai), gamesWithAny: ds.filter(d => d.conveyorTriggers > 0).length, moreConveyorSideWins: rate(convWin, conv.length) },
    acceleration: { forcedForwardPerGame: sum(d => d.forcedForward.human + d.forcedForward.ai), forcedBackPerGame: sum(d => d.forcedBack.human + d.forcedBack.ai), journeyShareCoveredByForcedMoves: sum(d => (d.accelShare.human + d.accelShare.ai) / 2), byKind: Object.fromEntries(['shove', 'teleport', 'home'].map(k => [k, sum(d => d.forcedForwardByKind[k] ?? 0)])) },
    placements: { perGame: sum(d => d.placements), unusedCellRate: r3(ds.reduce((a, d) => a + d.unusedCells, 0) / Math.max(1, ds.reduce((a, d) => a + d.placedCells, 0))), noPlacementTurnShare: r3(ds.reduce((a, d) => a + d.noPlacementTurns, 0) / Math.max(1, ds.reduce((a, d) => a + d.playerTurns, 0))) },
    diversity: agg.diversity, topOpenings: [...openings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([o, c]) => ({ opening: o, sides: c })),
    combos, effects,
    counterplay: { leadChangesPerGame: agg.counterplay.leadChangesPerGame, comebackRate: agg.counterplay.comebackRate },
    decision: { meanMargin: r3(mean(ds.map(d => d.decision.meanMargin ?? 0))), nearTieShare: sum(d => d.decision.nearTieShare), notTopShare: sum(d => d.decision.notTopShare), candidatesPerTurn: sum(d => d.decision.candidatesPerTurn) },
    actions: { perTurnFirst: sum(d => d.actionsPerTurn.first), perTurnSecond: sum(d => d.actionsPerTurn.second), unusedPerGame: sum(d => d.unusedActions.human + d.unusedActions.ai) },
    firstScoreTurn: { firstMover: r3(mean(ds.map(d => d.firstScoreTurn[d.first]).filter((x): x is number => x !== null))), secondMover: r3(mean(ds.map(d => d.firstScoreTurn[d.second]).filter((x): x is number => x !== null))) },
    safety: agg.safety,
  };
}
export type ConditionStats = ReturnType<typeof conditionStats>;

/** Engine-RNG divergence of a game from the same seed/first mover in the reference condition: first turn whose start RNG differs. */
export function rngDivergence(a: GameRec, ref: GameRec): number | null {
  const ta = a.detail!.turns, tb = ref.detail!.turns;
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) if (ta[i].rngStart !== tb[i].rngStart) return ta[i].turn;
  return ta.length === tb.length ? null : Math.min(ta.length, tb.length) + 1;
}

export function analyze(games: Game[], conditionIds: string[], meta: Record<string, unknown> = {}) {
  const ds = games.map(derive);
  const by = (id: string) => games.map((g, i) => ({ g, d: ds[i] })).filter(x => x.g.row.condition === id);
  const conditions = conditionIds.map(id => conditionStats(id, by(id).map(x => x.g), by(id).map(x => x.d)));
  const ref = new Map(by(conditionIds[0]).map(x => [`${x.g.rec.seed}/${x.g.rec.first}`, x.g.rec]));
  const divergence = Object.fromEntries(conditionIds.slice(1).map(id => {
    const v = by(id).map(x => { const r = ref.get(`${x.g.rec.seed}/${x.g.rec.first}`); return r ? rngDivergence(x.g.rec, r) : null; });
    const sameRole = by(id).filter(x => { const r = ref.get(`${x.g.rec.seed}/${x.g.rec.first}`); return r && (r.winner === 'draw' ? 'draw' : r.winner === r.first ? 'first' : 'second') === x.g.row.winnerRole; }).length;
    return [id, { firstDivergentTurn: v, neverDiverged: v.filter(x => x === null).length, medianDivergentTurn: quant(v.filter((x): x is number => x !== null), 0.5), sameWinnerRoleAsReference: sameRole, of: v.length }];
  }));
  // paired seed comparison of first-mover wins vs the reference condition (same seed and same first mover)
  const paired = Object.fromEntries(conditionIds.slice(1).map(id => {
    let plus = 0, minus = 0;
    for (const x of by(id)) { const r = ref.get(`${x.g.rec.seed}/${x.g.rec.first}`); if (!r) continue; const a = x.g.row.winnerRole === 'first' ? 1 : 0, b = r.winner !== 'draw' && r.winner === r.first ? 1 : 0; if (a > b) plus++; if (a < b) minus++; }
    return [id, { ...signTest(plus, minus), note: `plus = games where the first mover won in ${id} but not in ${conditionIds[0]} (same seed and first mover); minus = the reverse` }];
  }));
  const dec = ds.filter(d => d.winner !== 'draw');
  const heterogeneity = permutationHeterogeneity(conditionIds.map(id => by(id).filter(x => x.d.winner !== 'draw').map(x => (x.d.winnerRole === 'first' ? 1 : 0))));
  const lengthHet = conditionIds.map(id => ({ id, mean: meanCI(by(id).map(x => x.d.turns)) }));
  const overall = {
    games: games.length, decisive: dec.length, firstMover: rate(dec.filter(d => d.winnerRole === 'first').length, dec.length), humanSide: rate(dec.filter(d => d.winner === 'human').length, dec.length),
    turns: meanCI(ds.map(d => d.turns)), turnLimitRate: r3(ds.filter(d => d.turnLimit).length / (ds.length || 1)), drawRate: r3((ds.length - dec.length) / (ds.length || 1)),
    safety: { illegal: ds.reduce((a, d) => a + d.safety.illegal, 0), errors: ds.reduce((a, d) => a + d.safety.errors, 0), softlocks: ds.filter(d => d.safety.softlock).length },
    pooledNote: 'Pooled over five different starting conditions: a mixture, not an estimate for any single rule set.',
  };
  const power = { perCondition: { n: 20, minFirstMoverWinsForP05: minSignificantK(20), note: 'With 20 decisive games a first-mover share must reach at least this many wins (75%) before an exact test rejects a 50/50 split at 5%, and a 95% interval is roughly +/- 20 points wide. Smaller real advantages are invisible at this sample size.' }, pooled: { n: dec.length, minWinsForP05: minSignificantK(dec.length) } };
  const findings = writeFindings(conditions, overall, heterogeneity, paired, divergence, conditionIds);
  return { schema: 'rule-sabotage/v3-analysis@1', ...meta, overall, conditions, heterogeneity: { firstMoverWinRateAcrossConditions: heterogeneity, note: 'Seeded permutation test (chi-square statistic) of first-mover wins across the five conditions, decisive games only. Exploratory: five conditions screened at once, no correction for multiple looks.' }, gameLength: lengthHet, paired, divergence, power, findings, games: ds };
}
export type Analysis = ReturnType<typeof analyze>;

const pc = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
export const fmtRate = (r: Rate) => `${r.k}/${r.n} (${pc(r.rate)}, 95% CI ${pc(r.ci95[0])}–${pc(r.ci95[1])}, exact p vs 50% = ${r.pVsHalf})`;
/** Auto-written, deliberately cautious statements. Each says whether it is DESCRIPTIVE or an exploratory SIGNAL. */
function writeFindings(cs: ConditionStats[], overall: { firstMover: Rate; turns: { mean: number } }, het: { p: number } | null, paired: Record<string, { plus: number; minus: number; p: number }>, div: Record<string, { neverDiverged: number; of: number }>, ids: string[]) {
  const F: { kind: 'DESCRIPTIVE' | 'SIGNAL' | 'NO_EVIDENCE' | 'LIMITATION'; text: string }[] = [];
  for (const c of cs) {
    const fm = c.firstMover;
    F.push({ kind: fm.includesHalf ? 'DESCRIPTIVE' : 'SIGNAL', text: `${c.id} (${c.pieces?.firstMover}/${c.pieces?.secondMover}): first mover won ${fmtRate(fm)}. ${fm.includesHalf ? 'The interval includes 50%: no reliable first-mover effect at n = ${c.games}.' : 'The interval excludes 50%: an exploratory first-mover signal, to be re-tested on fresh seeds.'} Mean length ${c.turns.mean} turns (95% CI ${c.turns.ci[0]}–${c.turns.ci[1]}), turn-limit rate ${pc(c.turnLimitRate)}.` });
    if (c.sideWithMorePieces) F.push({ kind: c.sideWithMorePieces.includesHalf ? 'DESCRIPTIVE' : 'SIGNAL', text: `${c.id}: the side that started with more pieces won ${fmtRate(c.sideWithMorePieces)}. More pieces also means more actions per turn and a larger victory requirement, so this is the effect of the whole package, not of piece count alone.` });
  }
  F.push({ kind: overall.firstMover.includesHalf ? 'DESCRIPTIVE' : 'SIGNAL', text: `All ${cs.reduce((a, c) => a + c.games, 0)} games pooled: first mover won ${fmtRate(overall.firstMover)}. Pooled across different rules, so it only says whether a first-mover tendency shows up broadly.` });
  if (het) F.push({ kind: het.p < 0.05 ? 'SIGNAL' : 'NO_EVIDENCE', text: `Do the five conditions differ in first-mover win rate? Permutation test p = ${het.p}. ${het.p < 0.05 ? 'Unlikely to be pure chance, but exploratory (one screen, five groups).' : 'No evidence that starting piece count changes first-mover advantage at this sample size. This is absence of evidence, not evidence of no effect.'}` });
  for (const id of ids.slice(1)) { const p = paired[id]; F.push({ kind: p.p < 0.05 ? 'SIGNAL' : 'DESCRIPTIVE', text: `${id} vs ${ids[0]} on the same seed and first mover: first-mover outcome flipped toward the first mover in ${p.plus} pairs and away in ${p.minus} (exact sign test p = ${p.p}). RNG trajectories: ${div[id].neverDiverged}/${div[id].of} games never diverged from the reference RNG sequence, so pairs share a seed but not a game.` }); }
  const lengths = cs.map(c => `${c.id} ${c.turns.mean}`).join(', ');
  F.push({ kind: 'DESCRIPTIVE', text: `Game length (mean turns): ${lengths}. Fewer pieces means fewer actions per turn but also fewer pieces to bring across.` });
  const conv = cs.map(c => `${c.id} ${c.conveyor.triggersPerGame}/game (more-conveyor side won ${c.conveyor.moreConveyorSideWins.k}/${c.conveyor.moreConveyorSideWins.n})`).join('; ');
  F.push({ kind: 'DESCRIPTIVE', text: `Conveyor-belt moves (a piece stepping on its own side's trap and being carried forward): ${conv}. An association with winning is not proof that conveyors cause wins: stronger positions also create more chances to use them.` });
  F.push({ kind: 'LIMITATION', text: 'Both sides use the same deterministic planner and weights, so "Human side" and "AI side" are board directions, not different players. Results describe this planner playing itself, not human play.' });
  F.push({ kind: 'LIMITATION', text: 'These 100 games are exploratory. They were looked at to form hypotheses and cannot also serve as the holdout that tests them.' });
  return F;
}

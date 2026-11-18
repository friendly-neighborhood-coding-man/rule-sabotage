/**
 * Deterministic anomaly detection over self-play metrics, with explicit thresholds from
 * balance/loop.config.json. An anomaly is a HYPOTHESIS, not proof: it says which concrete,
 * row-level statement Kane should check on an evidence page, and which weight it would touch.
 */
import { createHash } from 'node:crypto';
import { cellName } from '../engine.ts';
import { type Player, PLAYERS, shortLabel } from '../rules.ts';
import { effectFromId, featureOf, type FeatureKey } from '../weights.ts';
import type { GameRec, Metrics, TriggerRec } from './selfplay.ts';

export type Thresholds = {
  minTriggers: number; minGamesUsed: number; firstPlayerWinRate: number; sideWinRate: number; dominantShare: number; dominantWinRate: number;
  costHarmfulRateBelow: number; costMinPredicted: number; valueRealizationAbove: number; rarelySelectedShare: number;
  wastedUnusedRate: number; wastedMinCells: number; comboMinGames: number; comboWinRate: number; openingShare: number;
};
export type AnomalyType = 'first-player-advantage' | 'side-bias' | 'dominant-effect' | 'cost-not-realized' | 'value-underestimated' | 'never-selected' | 'wasted-placements' | 'overpowered-combo' | 'repeated-opening' | 'safety-violation';

/** One row-level statement Kane can check: "the share of evidence rows where <predicate> is <above|below> <fraction>". */
export type Check = {
  table: 'triggers' | 'games'; columns: string[]; rows: (string | number)[][]; predicateText: string;
  /** Our own evaluation of the predicate per row (used only to report agreement; never substitutes for Kane). */
  predicate: boolean[]; direction: 'above' | 'below'; fraction: number; fractionText: string;
  /** Rows of the trigger table that can be replayed on the real engine. */
  replay?: { seed: number; first: Player; turn: number; cell: string; mover: Player }[];
};
export type Anomaly = {
  id: string; fingerprint: string; type: AnomalyType; subject: string; title: string; hypothesis: string;
  metric: string; value: number; threshold: number; severity: number; samples: number;
  /** Which weight a candidate may change. null = not fixable by weights (a rule-level or engine finding). */
  knob: { kind: 'utility'; feature: FeatureKey; effect: string; direction: 'toward-zero' | 'away-from-zero' } | { kind: 'upkeep'; effect: string; direction: 'down' | 'up' } | { kind: 'upkeep-pair'; effects: [string, string]; direction: 'up' } | null;
  kaneCheckable: boolean; check: Check | null; note?: string;
};

const label = (id: string) => { const e = effectFromId(id); return e ? shortLabel(e) : id; };
const col = (k: string) => cellName(k).slice(0, 1);
const fp = (...p: (string | number)[]) => createHash('sha256').update(p.join('|')).digest('hex').slice(0, 12);

/** Deterministic, systematic sample with an ODD number of rows (so "more than half" vs "at most half" can never tie). */
export function sampleRows<T>(rows: T[], max: number): T[] {
  let n = Math.min(rows.length, max);
  if (n % 2 === 0) n -= 1;
  if (n <= 0) return [];
  if (rows.length === n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}

function triggerCheck(recs: GameRec[], effect: string, max: number, predicateText: string, pred: (t: TriggerRec, before: number, after: number) => boolean, direction: Check['direction'], fraction: number, fractionText: string): Check {
  const all: { r: GameRec; t: TriggerRec }[] = recs.flatMap(r => r.triggers.filter(t => t.effect === effect && t.realized !== null).map(t => ({ r, t })));
  const sample = sampleRows(all, max);
  const goal = (p: Player) => (p === 'human' ? 'G' : 'A');
  const rows: (string | number)[][] = [], predicate: boolean[] = [];
  for (const { r, t } of sample) {
    const isMove = t.kind === 'shove' || t.kind === 'home' || t.kind === 'teleport';
    const m = /moved ([0-6],[0-6])→([0-6,|]+)/.exec(t.how);
    const fromCol = m ? col(m[1]) : col(t.cell);
    const toCol = m ? m[2].split('|').map(col).join('/') : col(t.cell);
    const dist = (c: string, p: Player) => Math.abs('ABCDEFG'.indexOf(c) - 'ABCDEFG'.indexOf(goal(p)));
    const before = dist(fromCol, t.mover), after = m ? Math.max(...m[2].split('|').map(k => dist(col(k), t.mover))) : before;
    rows.push([`${r.seed}/${r.first === 'human' ? 'H' : 'A'} first`, t.turn, t.mover === 'human' ? 'Human' : 'AI', t.owner === 'human' ? 'Human' : 'AI', cellName(t.cell), label(t.effect), fromCol, toCol, goal(t.mover), before, after, isMove ? '-' : Math.max(0, t.realized ?? 0)]);
    predicate.push(pred(t, before, after));
  }
  return {
    table: 'triggers', columns: ['Game (seed)', 'Turn', 'Piece side', 'Effect owner', 'Cell', 'Effect', 'Column before', 'Column after', 'Goal column', 'Squares to goal before', 'Squares to goal after', 'Actions lost next own turn'],
    rows, predicateText, predicate, direction, fraction, fractionText,
    replay: sample.map(({ r, t }) => ({ seed: r.seed, first: r.first, turn: t.turn, cell: t.cell, mover: t.mover })),
  };
}

function gamesCheck(recs: GameRec[], max: number, used: (r: GameRec, p: Player) => boolean, usedLabel: string, direction: Check['direction'], fraction: number, fractionText: string, onlyUsed: boolean): Check {
  const all = recs.flatMap(r => PLAYERS.map(p => ({ r, p }))).filter(x => x.r.winner !== 'draw' && (!onlyUsed || used(x.r, x.p)));
  const sample = sampleRows(all, max);
  return {
    table: 'games', columns: ['Game (seed)', 'Side', 'First mover', usedLabel, 'Result for this side', 'Turns'],
    rows: sample.map(({ r, p }) => [`${r.seed}/${r.first === 'human' ? 'H' : 'A'} first`, p === 'human' ? 'Human' : 'AI', r.first === 'human' ? 'Human' : 'AI', used(r, p) ? 'yes' : 'no', r.winner === p ? 'won' : 'lost', r.turns]),
    predicateText: `the 'Result for this side' column says 'won'`, predicate: sample.map(({ r, p }) => r.winner === p), direction, fraction, fractionText,
  };
}

export function detect(m: Metrics, recs: GameRec[], t: Thresholds, maxRows = 13, plannerIds: string[] = []): Anomaly[] {
  const out: Anomaly[] = [];
  const add = (a: Omit<Anomaly, 'id' | 'fingerprint'>) => out.push({ ...a, id: '', fingerprint: fp(a.type, a.subject) });

  if (m.safety.illegal || m.safety.errors || m.safety.softlocks) add({
    type: 'safety-violation', subject: 'engine', title: 'Illegal actions, engine errors or softlocks in self-play', hypothesis: 'The engine or planner produced an illegal action, an error or a softlock.',
    metric: 'illegal+errors+softlocks', value: m.safety.illegal + m.safety.errors + m.safety.softlocks, threshold: 0, severity: 10, samples: m.games, knob: null, kaneCheckable: false, check: null,
    note: 'Not a balance problem: weights can never fix it. Blocks promotion of anything until fixed.',
  });
  if (m.decisiveGames >= 8 && Math.abs(m.firstPlayerWinRate - 0.5) > t.firstPlayerWinRate - 0.5) add({
    type: 'first-player-advantage', subject: 'first-player', title: `First mover wins ${(m.firstPlayerWinRate * 100).toFixed(0)}% of decisive games`,
    hypothesis: 'Moving first is worth more than the rules intend.', metric: 'firstPlayerWinRate', value: m.firstPlayerWinRate, threshold: t.firstPlayerWinRate,
    severity: (Math.abs(m.firstPlayerWinRate - 0.5) - (t.firstPlayerWinRate - 0.5)) / (t.firstPlayerWinRate - 0.5), samples: m.decisiveGames,
    knob: null, kaneCheckable: true, note: 'A rule-level finding (turn order, action counts). Weights do not change it directly; it is still a promotion guard-rail.',
    check: (() => { const c = gamesCheck(recs, maxRows, (r, p) => r.first === p, 'Moved first', 'above', 0.5, 'half', false); return { ...c, predicateText: `the 'Moved first' column and the 'Result for this side' column are either both 'yes'/'won' or both 'no'/'lost'`, predicate: c.rows.map(row => (row[3] === 'yes') === (row[4] === 'won')) }; })(),
  });
  if (m.decisiveGames >= 8 && Math.abs(m.humanSideWinRate - 0.5) > t.sideWinRate - 0.5) add({
    type: 'side-bias', subject: 'side', title: `Human side (column A start) wins ${(m.humanSideWinRate * 100).toFixed(0)}% of decisive games`,
    hypothesis: 'One side of the board is favoured.', metric: 'humanSideWinRate', value: m.humanSideWinRate, threshold: t.sideWinRate,
    severity: (Math.abs(m.humanSideWinRate - 0.5) - (t.sideWinRate - 0.5)) / (t.sideWinRate - 0.5), samples: m.decisiveGames, knob: null, kaneCheckable: false, check: null,
    note: 'Both sides run the same planner and weights, so a side bias points at the engine or the board, not at weights.',
  });
  for (const [id, e] of Object.entries(m.effects)) {
    const L = label(id);
    if (e.share >= t.dominantShare && e.winRateWhenUsed !== null && e.winRateWhenUsed >= t.dominantWinRate && e.gamesUsed >= t.minGamesUsed) add({
      type: 'dominant-effect', subject: id, title: `“${L}” is ${(e.share * 100).toFixed(0)}% of all placements and its users win ${(e.winRateWhenUsed * 100).toFixed(0)}%`,
      hypothesis: `“${L}” is over-valued by the planner and dominates play.`, metric: 'share×winRateWhenUsed', value: e.share, threshold: t.dominantShare,
      severity: (e.share - t.dominantShare) / t.dominantShare + (e.winRateWhenUsed - t.dominantWinRate) / t.dominantWinRate, samples: e.gamesUsed,
      knob: { kind: 'upkeep', effect: id, direction: 'up' }, kaneCheckable: true,
      check: gamesCheck(recs, maxRows, (r, p) => r.placements.some(x => x.p === p && x.effect === id), `Placed “${L}”`, 'above', 0.5, 'half', true),
    });
    const kind = effectFromId(id)?.kind;
    if (e.resolved >= t.minTriggers && e.predictedMean >= t.costMinPredicted && e.harmfulRate < t.costHarmfulRateBelow && kind && kind !== 'haste' && kind !== 'shield') {
      const isMove = kind === 'shove' || kind === 'home' || kind === 'teleport';
      add({
        type: 'cost-not-realized', subject: id, title: `“${L}” is priced as a penalty (${e.predictedMean.toFixed(2)} actions/trigger) but hurts in only ${(e.harmfulRate * 100).toFixed(0)}% of ${e.resolved} triggers`,
        hypothesis: `The penalty of “${L}” rarely materializes; the planner over-values it.`, metric: 'harmfulRate', value: e.harmfulRate, threshold: t.costHarmfulRateBelow,
        severity: (t.costHarmfulRateBelow - e.harmfulRate) / t.costHarmfulRateBelow + Math.min(1, e.resolved / 40), samples: e.resolved,
        knob: { kind: 'utility', feature: featureOf(effectFromId(id)!), effect: id, direction: 'toward-zero' }, kaneCheckable: true,
        check: isMove
          ? triggerCheck(recs, id, maxRows, `the 'Squares to goal after' number is greater than the 'Squares to goal before' number`, (_t, b, a) => a > b, 'below', 0.5, 'half')
          : triggerCheck(recs, id, maxRows, `the 'Actions lost next own turn' number is greater than 0`, tr => (tr.realized ?? 0) > 0, 'below', 0.5, 'half'),
      });
    }
    if (e.resolved >= t.minTriggers && e.realization !== null && e.predictedMean < -0.3 && e.realization > t.valueRealizationAbove) add({
      type: 'value-underestimated', subject: id, title: `“${L}” helps ${e.realization.toFixed(2)}× more than the planner expects`,
      hypothesis: `The benefit of “${L}” is under-valued.`, metric: 'realization', value: e.realization, threshold: t.valueRealizationAbove,
      severity: (e.realization - t.valueRealizationAbove) / t.valueRealizationAbove, samples: e.resolved, knob: { kind: 'utility', feature: featureOf(effectFromId(id)!), effect: id, direction: 'away-from-zero' }, kaneCheckable: false, check: null,
      note: 'Detected and recorded; no Kane template for magnitude claims yet, so it cannot drive a promotion in V1.',
    });
    if (e.cells >= t.wastedMinCells && e.unusedRate >= t.wastedUnusedRate) add({
      type: 'wasted-placements', subject: id, title: `${(e.unusedRate * 100).toFixed(0)}% of “${L}” cells are never entered`,
      hypothesis: `The planner pays to place “${L}” where nobody steps (an unused cost).`, metric: 'unusedRate', value: e.unusedRate, threshold: t.wastedUnusedRate,
      severity: (e.unusedRate - t.wastedUnusedRate) / (1 - t.wastedUnusedRate + 1e-9) * 0.5, samples: e.cells, knob: { kind: 'upkeep', effect: id, direction: 'up' }, kaneCheckable: false, check: null,
      note: 'Engine counters (placed − hits); recorded as supporting evidence.',
    });
  }
  for (const id of plannerIds) {
    const share = m.effects[id]?.share ?? 0, L = label(id);
    if (m.games >= 12 && share < t.rarelySelectedShare) add({
      type: 'never-selected', subject: id, title: `“${L}” is almost never worth selecting (${(share * 100).toFixed(1)}% of placements)`,
      hypothesis: `The planner under-values “${L}”, or it is genuinely weak.`, metric: 'share', value: share, threshold: t.rarelySelectedShare,
      severity: (t.rarelySelectedShare - share) / t.rarelySelectedShare * 0.6, samples: m.games, knob: { kind: 'upkeep', effect: id, direction: 'down' }, kaneCheckable: false, check: null,
      note: 'Absence of use cannot be shown as evidence rows; recorded only.',
    });
  }
  if (m.topCombo && m.topCombo.games >= t.comboMinGames && m.topCombo.winRate >= t.comboWinRate) {
    const [a, b] = m.topCombo.combo.split(' + ') as [string, string];
    add({
      type: 'overpowered-combo', subject: m.topCombo.combo, title: `Players who use both “${label(a)}” and “${label(b)}” win ${(m.topCombo.winRate * 100).toFixed(0)}% (${m.topCombo.games} games)`,
      hypothesis: 'This pair of effects is a repeated overpowered strategy.', metric: 'comboWinRate', value: m.topCombo.winRate, threshold: t.comboWinRate,
      severity: (m.topCombo.winRate - t.comboWinRate) / t.comboWinRate + Math.min(1, m.topCombo.games / 24), samples: m.topCombo.games,
      knob: { kind: 'upkeep-pair', effects: [a, b], direction: 'up' }, kaneCheckable: true,
      check: gamesCheck(recs, maxRows, (r, p) => { const u = new Set(r.placements.filter(x => x.p === p).map(x => x.effect)); return u.has(a) && u.has(b); }, `Placed both “${label(a)}” and “${label(b)}”`, 'above', 2 / 3, 'two thirds', true),
    });
  }
  if (m.diversity.topOpeningShare >= t.openingShare && m.diversity.topOpening !== '(none)') add({
    type: 'repeated-opening', subject: m.diversity.topOpening, title: `${(m.diversity.topOpeningShare * 100).toFixed(0)}% of player-games open with ${m.diversity.topOpening}`,
    hypothesis: 'Play is collapsing onto one opening.', metric: 'topOpeningShare', value: m.diversity.topOpeningShare, threshold: t.openingShare,
    severity: (m.diversity.topOpeningShare - t.openingShare) / t.openingShare, samples: m.games * 2, knob: null, kaneCheckable: false, check: null,
  });
  out.sort((x, y) => y.severity - x.severity || x.fingerprint.localeCompare(y.fingerprint));
  out.forEach((a, i) => { a.id = `A${i + 1}`; a.severity = Math.round(a.severity * 1000) / 1000; });
  return out;
}

/** Our own answer to the hypothesis statement on the sampled rows (reported next to Kane's, never instead of it). */
export function ownAnswer(c: Check): boolean {
  const k = c.predicate.filter(Boolean).length, n = c.predicate.length;
  return c.direction === 'above' ? k > c.fraction * n : k < c.fraction * n;
}

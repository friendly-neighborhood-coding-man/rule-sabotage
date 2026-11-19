/**
 * Balance Designer V3: preregistered evaluation of the 240-game validation (balance/v3/validate-protocol.json)
 * and the teleport RNG-foresight measurement.
 *
 * Rules are applied exactly as frozen: paired-by-seed bootstrap intervals for treated minus control, the
 * met / contradicted / unclear prediction rule, and SUPPORTED / REFUTED / INCONCLUSIVE / NOT_TESTED per
 * hypothesis. A hypothesis whose intervention no arm runs is NOT_TESTED, whatever else the data show.
 */
import { init, applyMove, applyPlacement, endTurn, GOAL_X, EXPERIMENTAL_START_CONFIG, type State, type Dir } from '../../engine.ts';
import { effectFromId } from '../../weights.ts';
import { type GameRec } from '../selfplay.ts';
import { type Player } from '../../rules.ts';
import { derive, type Game, type Derived } from './analysis.ts';
import { wilson, xorshift, r3, mean, quant, entropy } from './stats.ts';

const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
type G = { g: Game; d: Derived };

/** The frozen metric definitions (validate-protocol.json "metrics"). null = undefined for this set. */
export const METRIC_FNS: Record<string, (xs: G[]) => number | null> = {
  first_mover_win_rate: xs => { const dec = xs.filter(x => x.d.winner !== 'draw'); return dec.length ? dec.filter(x => x.d.winnerRole === 'first').length / dec.length : null; },
  abs_first_mover_edge: xs => { const v = METRIC_FNS.first_mover_win_rate(xs); return v === null ? null : Math.abs(v - 0.5); },
  more_pieces_side_win_rate: xs => { const u = xs.filter(x => x.d.winner !== 'draw' && x.d.count.human !== x.d.count.ai); return u.length ? u.filter(x => x.d.count[x.d.winner as Player] > x.d.count[other(x.d.winner as Player)]).length / u.length : null; },
  human_side_win_rate: xs => { const dec = xs.filter(x => x.d.winner !== 'draw'); return dec.length ? dec.filter(x => x.d.winner === 'human').length / dec.length : null; },
  mean_turns: xs => (xs.length ? mean(xs.map(x => x.d.turns)) : null),
  turn_limit_rate: xs => (xs.length ? xs.filter(x => x.d.turnLimit).length / xs.length : null),
  conveyor_per_game: xs => (xs.length ? mean(xs.map(x => x.d.conveyorTriggers)) : null),
  self_trigger_share: xs => { const t = xs.reduce((a, x) => a + x.d.triggers, 0); return t ? xs.reduce((a, x) => a + x.d.selfTriggers, 0) / t : null; },
  turn1_score_rate: xs => (xs.length ? xs.filter(x => x.d.firstScoreTurn[x.d.first] === 1).length / xs.length : null),
  lead_changes: xs => (xs.length ? mean(xs.map(x => x.d.leadChanges)) : null),
  comeback_rate: xs => { const dec = xs.filter(x => x.d.winner !== 'draw'); return dec.length ? dec.filter(x => x.d.comeback).length / dec.length : null; },
  effect_entropy: xs => { const c = new Map<string, number>(); for (const x of xs) for (const p of x.g.rec.placements) c.set(p.effect, (c.get(p.effect) ?? 0) + 1); return c.size > 1 ? entropy([...c.values()]) / Math.log2(c.size) : null; },
  unused_cell_rate: xs => { const pl = xs.reduce((a, x) => a + x.d.placedCells, 0); return pl ? xs.reduce((a, x) => a + x.d.unusedCells, 0) / pl : null; },
};

/** Treated minus control, paired by seed (a seed's two games move together), seeded bootstrap 95% interval. */
export function pairedDiff(metric: string, treated: G[], control: G[], iters = 5000, seed = 62100) {
  const f = METRIC_FNS[metric];
  const seeds = [...new Set(control.map(x => x.d.seed))].sort((a, b) => a - b);
  const byT = new Map(seeds.map(s => [s, treated.filter(x => x.d.seed === s)])), byC = new Map(seeds.map(s => [s, control.filter(x => x.d.seed === s)]));
  const t0 = f(treated), c0 = f(control);
  if (t0 === null || c0 === null) return { metric, treated: t0, control: c0, diff: null, ci95: null as [number, number] | null };
  const rnd = xorshift(seed), ds: number[] = [];
  for (let i = 0; i < iters; i++) {
    const pick = seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]);
    const t = f(pick.flatMap(s => byT.get(s) ?? [])), c = f(pick.flatMap(s => byC.get(s) ?? []));
    if (t !== null && c !== null) ds.push(t - c);
  }
  return { metric, treated: r3(t0), control: r3(c0), diff: r3(t0 - c0), ci95: [r3(quant(ds, 0.025)), r3(quant(ds, 0.975))] as [number, number] };
}
export type Pred = { metric: string; comparison: string; direction: 'increase' | 'decrease' | 'no-change'; minEffect: number; note?: string };
/** The frozen prediction rule. */
export function judge(p: Pred, diff: number | null, ci: [number, number] | null): { status: 'met' | 'contradicted' | 'unclear' | 'not-run'; reason: string } {
  if (diff === null || !ci) return { status: 'not-run', reason: 'metric undefined for these arms' };
  if (p.direction === 'no-change') {
    if (ci[0] >= -p.minEffect && ci[1] <= p.minEffect) return { status: 'met', reason: `interval [${ci}] lies within ±${p.minEffect}` };
    if ((ci[0] > 0 || ci[1] < 0) && Math.abs(diff) >= p.minEffect) return { status: 'contradicted', reason: `interval [${ci}] excludes 0 and |${diff}| ≥ ${p.minEffect}` };
    return { status: 'unclear', reason: `interval [${ci}] neither within ±${p.minEffect} nor a material change` };
  }
  const sgn = p.direction === 'increase' ? 1 : -1, d = sgn * diff, lo = sgn > 0 ? ci[0] : -ci[1], hi = sgn > 0 ? ci[1] : -ci[0];
  if (d >= p.minEffect && lo > 0) return { status: 'met', reason: `${p.direction} of ${Math.abs(diff)} ≥ ${p.minEffect}, interval [${ci}] excludes 0` };
  if (hi < p.minEffect) return { status: 'contradicted', reason: `an ${p.direction} of ${p.minEffect} is outside the interval [${ci}]` };
  return { status: 'unclear', reason: `${p.direction === 'increase' ? '+' : ''}${diff} with interval [${ci}]` };
}
const combine = (st: string[]) => (!st.length || st.every(s => s === 'not-run') ? 'NOT_TESTED' : st.some(s => s === 'contradicted') ? 'REFUTED' : st.every(s => s === 'met') ? 'SUPPORTED' : 'INCONCLUSIVE');

export type Protocol = { comparisons: { id: string; treated: string; control: string }[]; mapping: Record<string, unknown> };
export function evaluateProtocol(games: Game[], protocol: Protocol) {
  const all: G[] = games.map(g => ({ g, d: derive(g) }));
  const arm = (id: string) => all.filter(x => x.g.row.condition === id);
  const arms = Object.fromEntries([...new Set(all.map(x => x.g.row.condition))].map(id => [id, Object.fromEntries(Object.keys(METRIC_FNS).map(m => { const v = METRIC_FNS[m](arm(id)); return [m, v === null ? null : r3(v)]; }))]));
  const comparisons = Object.fromEntries(protocol.comparisons.map(c => [c.id, Object.fromEntries(Object.keys(METRIC_FNS).map(m => [m, pairedDiff(m, arm(c.treated), arm(c.control))]))]));
  const wil = (id: string, metric: 'first_mover_win_rate' | 'more_pieces_side_win_rate') => { const xs = arm(id).filter(x => x.d.winner !== 'draw' && (metric === 'first_mover_win_rate' || x.d.count.human !== x.d.count.ai)); const k = metric === 'first_mover_win_rate' ? xs.filter(x => x.d.winnerRole === 'first').length : xs.filter(x => x.d.count[x.d.winner as Player] > x.d.count[other(x.d.winner as Player)]).length; return { k, n: xs.length, rate: xs.length ? r3(k / xs.length) : null, ci95: wilson(k, xs.length) }; };
  const hyp: Record<string, { outcome: string; predictions: unknown[]; reason?: string }> = {};
  for (const [id, m] of Object.entries(protocol.mapping)) {
    if (id === 'kane') continue;
    const mm = m as { status?: string; reason?: string; predictions?: Pred[] };
    if (mm.status === 'NOT_TESTED') { hyp[id] = { outcome: 'NOT_TESTED', predictions: [], reason: mm.reason }; continue; }
    if (id === 'HC0') {
      const w = wil('C', 'first_mover_win_rate');
      const outcome = w.rate !== null && w.rate <= 0.7 && w.ci95[0] <= 0.6 && w.ci95[1] >= 0.6 ? 'SUPPORTED' : w.rate !== null && w.rate >= 0.75 && w.ci95[0] > 0.6 ? 'REFUTED' : 'INCONCLUSIVE';
      hyp[id] = { outcome, predictions: [{ metric: 'first_mover_win_rate', arm: 'C', ...w, rule: 'SUPPORTED if <= 0.70 with interval including 0.60; REFUTED if >= 0.75 with lower bound > 0.60' }] };
      continue;
    }
    const preds = (mm.predictions ?? []).map(p => {
      if (p.comparison.startsWith('absolute')) {
        const w = wil('C', 'more_pieces_side_win_rate');
        const status = w.rate !== null && w.rate <= 0.35 && w.ci95[1] < 0.5 ? 'met' : w.rate !== null && w.ci95[0] > 0.35 ? 'contradicted' : 'unclear';
        return { ...p, arm: 'C', ...w, status, reason: 'met if rate <= 0.35 with Wilson upper bound < 0.5; contradicted if the lower bound > 0.35' };
      }
      const c = comparisons[p.comparison]?.[p.metric];
      const j = c ? judge(p, c.diff, c.ci95) : { status: 'not-run' as const, reason: 'comparison not run' };
      return { ...p, treated: c?.treated ?? null, control: c?.control ?? null, diff: c?.diff ?? null, ci95: c?.ci95 ?? null, ...j };
    });
    hyp[id] = { outcome: combine(preds.map(p => p.status)), predictions: preds };
  }
  return { arms, comparisons, firstMover: Object.fromEntries(['A', 'B', 'C', 'D'].map(id => [id, wil(id, 'first_mover_win_rate')])), morePieces: Object.fromEntries(['C', 'D'].map(id => [id, wil(id, 'more_pieces_side_win_rate')])), hypotheses: hyp };
}

// ---------------------------------------------------------------- teleport RNG foresight
/** Squares the moving side's pieces gained on one move (a piece that scores counts its full remaining distance). */
function sideGain(before: State, after: State, p: Player) {
  let g = 0;
  for (const q of before.pieces) { if (q.owner !== p || q.scored) continue; const a = after.pieces.find(x => x.id === q.id)!; g += Math.abs(GOAL_X[p] - q.x) - (a.scored ? 0 : Math.abs(GOAL_X[p] - a.x)); }
  return g;
}
const scoredCount = (s: State, p: Player) => s.pieces.filter(q => q.owner === p && q.scored).length;
/**
 * For every recorded move that triggered a teleport: replay the game with the real engine up to that move, then
 * re-run the same move from the same pre-move state with `samples` seeded random engine-RNG states. That gives
 * what a player who could NOT see the RNG would expect from making that move. Realized minus expected gain is the
 * value of the information the planner read from the RNG.
 */
export function teleportForesight(recs: GameRec[], samples = 200, seed = 4242) {
  const rnd = xorshift(seed), rows: { gameId: string; turn: number; p: Player; first: boolean; realized: number; expected: number; pctile: number; scoredRealized: boolean; pScoreBlind: number }[] = [];
  for (const r of recs) {
    const d = r.detail!; const s = init(d.seed, { first: d.first, ...(d.start ? { start: { id: d.start.id, experimental: EXPERIMENTAL_START_CONFIG, pieces: { firstMover: d.start.count[d.first], secondMover: d.start.count[other(d.first)] }, layout: d.start.layout } } : {}) });
    for (const t of d.turns) {
      if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' });
      if (s.phase === 'place') s.phase = 'move';
      for (const m of t.moves) {
        const mv = { from: m.from, dir: m.dir as Dir, mode: m.mode as 'stack' | 'single' };
        const isTp = m.events.some(e => e.t === 'forced' && e.how === 'teleport');
        if (isTp) {
          const before = structuredClone(s), sc0 = scoredCount(s, t.p);
          const gains: number[] = []; let scores = 0;
          for (let i = 0; i < samples; i++) { const x = structuredClone(before); x.rng = (Math.floor(rnd() * 0xffffffff) >>> 0) || 1; applyMove(x, t.p, mv); gains.push(sideGain(before, x, t.p)); if (scoredCount(x, t.p) > sc0) scores++; }
          const real = structuredClone(before); applyMove(real, t.p, mv);
          const realized = sideGain(before, real, t.p);
          rows.push({ gameId: `${r.start?.id ?? 'prod'}-${r.seed}-${r.first}`, turn: t.turn, p: t.p, first: t.p === r.first, realized, expected: r3(mean(gains)), pctile: r3(gains.filter(g => g < realized).length / gains.length + gains.filter(g => g === realized).length / (2 * gains.length)), scoredRealized: scoredCount(real, t.p) > sc0, pScoreBlind: r3(scores / samples) });
        }
        applyMove(s, t.p, mv);
      }
      if (s.winner) break;
      endTurn(s);
    }
  }
  const sum = (xs: typeof rows) => {
    const adv = xs.map(x => x.realized - x.expected), b = xorshift(seed + 1), boots: number[] = [];
    for (let i = 0; i < 2000 && xs.length; i++) boots.push(mean(xs.map(() => adv[Math.floor(b() * xs.length)])));
    return { moves: xs.length, realizedMean: r3(mean(xs.map(x => x.realized))), blindExpectedMean: r3(mean(xs.map(x => x.expected))), advantageMean: r3(mean(adv)), advantageCi95: xs.length ? [r3(quant(boots, 0.025)), r3(quant(boots, 0.975))] : null, meanPercentile: r3(mean(xs.map(x => x.pctile))), scoredOnMove: xs.filter(x => x.scoredRealized).length, expectedScoresIfBlind: r3(xs.reduce((a, x) => a + x.pScoreBlind, 0)) };
  };
  return { samplesPerMove: samples, all: sum(rows), turn1: sum(rows.filter(x => x.turn === 1)), rows };
}
export { quant };

/** Kane's registered hypotheses mapped onto the frozen comparisons by fixed rules (validate-protocol.json "mapping.kane"). */
export const KANE_ARM_RULES: { intervention: string; when?: (v: unknown) => boolean; comparison: string; note: string }[] = [
  { intervention: 'P3_BLIND_RNG', comparison: 'B-A', note: 'arm B runs P3 on both sides at 3/3' },
  { intervention: 'P4_NORMALIZED_EVAL', comparison: 'D-C', note: 'arm D runs P4 on both sides at 2/3 (P4 is identical to production at 3/3)' },
  { intervention: 'S1_PIECES', when: v => !!v && (v as { firstMover: number }).firstMover === 2 && (v as { secondMover: number }).secondMover === 3, comparison: 'C-A', note: 'arm C is the 2/3 start, arm A the 3/3 control' },
];
export function mapKane(entries: { noteId: string; registered: boolean; proposal: { kind: string; title: string; intervention: { id: string; value: unknown } | null; predictions: { metric: string; direction: 'increase' | 'decrease' | 'no-change'; minEffect: number }[] } }[], comparisons: Record<string, Record<string, ReturnType<typeof pairedDiff>>>) {
  return entries.filter(e => e.registered && e.proposal.kind === 'hypothesis').map(e => {
    const iv = e.proposal.intervention;
    const rule = iv ? KANE_ARM_RULES.find(r => r.intervention === iv.id && (!r.when || r.when(iv.value))) : undefined;
    if (!rule) return { noteId: e.noteId, title: e.proposal.title, intervention: iv, outcome: 'NOT_TESTED', reason: iv ? `no frozen arm runs ${iv.id}${iv.value !== undefined ? ` = ${JSON.stringify(iv.value)}` : ''}` : 'no intervention named, and no frozen comparison is an observational test of a direction claim', predictions: [] };
    const preds = e.proposal.predictions.map(p => {
      if (!METRIC_FNS[p.metric]) return { ...p, comparison: rule.comparison, status: 'not-run' as const, reason: `metric ${p.metric} is not measured by the self-play arms` };
      const c = comparisons[rule.comparison][p.metric];
      return { ...p, comparison: rule.comparison, treated: c.treated, control: c.control, diff: c.diff, ci95: c.ci95, ...judge({ ...p, comparison: rule.comparison }, c.diff, c.ci95) };
    });
    return { noteId: e.noteId, title: e.proposal.title, intervention: iv, comparison: rule.comparison, note: rule.note, outcome: combine(preds.map(p => p.status)), predictions: preds };
  });
}

/** Static page of the preregistered evaluation (no scripts). */
export async function evaluationPage(e: { runId: string; datasetHash: string; arms: Record<string, Record<string, number | null>>; comparisons: Record<string, Record<string, ReturnType<typeof pairedDiff>>>; hypotheses: Record<string, { outcome: string; predictions: unknown[]; reason?: string }>; kane: ReturnType<typeof mapKane>; foresight: { validation: Record<string, { all: ReturnType<typeof teleportForesight>['all']; turn1: ReturnType<typeof teleportForesight>['turn1'] }>; screen: unknown } }) {
  const { page, table, esc } = await import('./pages.ts');
  const ms = Object.keys(METRIC_FNS), arms = Object.keys(e.arms);
  const t1 = table('Metrics per arm', ['Metric', ...arms], ms.map(m => [m, ...arms.map(a => e.arms[a][m])]));
  const t2 = Object.entries(e.comparisons).map(([id, c]) => table(`Comparison ${id} (treated minus control, paired by seed, 95% bootstrap interval)`, ['Metric', 'Treated', 'Control', 'Difference', '95% interval'], ms.map(m => [m, c[m].treated, c[m].control, c[m].diff, c[m].ci95 ? `${c[m].ci95![0]} to ${c[m].ci95![1]}` : '—']))).join('');
  const t3 = table('Preregistered hypotheses', ['Hypothesis', 'Outcome', 'Predictions'], Object.entries(e.hypotheses).map(([id, h]) => [id, h.outcome, h.reason ?? (h.predictions as { metric: string; comparison?: string; arm?: string; status?: string; diff?: number; rate?: number; ci95?: number[]; reason?: string }[]).map(p => `${p.metric} ${p.comparison ?? p.arm}: ${p.status ?? ''} ${p.diff ?? p.rate ?? ''} [${p.ci95 ?? ''}] ${p.reason ?? ''}`).join(' | ')]));
  const t4 = table('Kane hypotheses mapped onto the frozen arms', ['Entry', 'Title', 'Intervention', 'Outcome', 'Detail'], e.kane.map(k => [k.noteId, k.title, k.intervention ? `${k.intervention.id} ${JSON.stringify(k.intervention.value)}` : 'none', k.outcome, 'reason' in k && k.reason ? k.reason : (k.predictions as { metric: string; status: string; diff?: number | null; ci95?: number[] | null }[]).map(p => `${p.metric}: ${p.status} ${p.diff ?? ''} [${p.ci95 ?? ''}]`).join(' | ')]));
  const t5 = table('Teleport RNG foresight: squares the moving side gained on moves that triggered a teleport, realized vs what a player who could not see the RNG would expect (200 engine re-runs per move)', ['Arm', 'Teleport moves', 'Realized mean', 'Blind expected mean', 'Advantage (95% CI)', 'Mean percentile of realized among blind outcomes', 'Scored on that move (realized / expected if blind)', 'Turn-1 teleport moves', 'Turn-1 advantage'], Object.entries(e.foresight.validation).map(([a, f]) => [a, f.all.moves, f.all.realizedMean, f.all.blindExpectedMean, `${f.all.advantageMean} (${f.all.advantageCi95?.join(' to ') ?? '—'})`, f.all.meanPercentile, `${f.all.scoredOnMove} / ${f.all.expectedScoresIfBlind}`, f.turn1.moves, `${f.turn1.advantageMean} (${f.turn1.advantageCi95?.join(' to ') ?? '—'})`]));
  return page('V3 validation evaluation', `<h1>V3-VALIDATE: preregistered evaluation</h1><p>Run <code>${esc(e.runId)}</code>, dataset hash <code>${esc(e.datasetHash)}</code>. Rules frozen in <code>balance/v3/validate-protocol.json</code> before the Kane call and before any validation game. SUPPORTED means the predictions held on these seeds, not proof. NOT_TESTED means no arm ran the intervention.</p>${t3}${t4}${t5}${t1}${t2}`);
}

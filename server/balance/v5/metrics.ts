/**
 * V5 statistics (revised per operator review 2026-11-20 15:31 UTC). Pure functions over recorded games.
 *
 *  - Game-level uncertainty is SEED-BLOCKED: the resampling unit is a seed block that keeps its mirrored roles and
 *    first-mover assignments together (self-play: the 2 games of a seed; cross-play: the 4 games of a seed, each policy on
 *    each side x each first mover). Independent RNG seeds are not treated as dependent because openings repeat.
 *  - Opening clusters (games grouped by their side-relative first two turns) are a COVERAGE and SENSITIVITY diagnostic:
 *    with fewer than MIN_CLUSTERS clusters the cluster interval is reported as NOT_ESTIMABLE, never as evidence.
 *  - Three separate questions: policy dependence (do outcomes differ between policies), opening coverage (how many early
 *    strategies were observed), rule robustness (does a pattern persist across the eligible policies). Robustness needs
 *    at least two eligible policies and is never a proof about the rules.
 */
import { type Player, PLAYERS } from '../../rules.ts';
import { type GameRec } from '../selfplay.ts';
import { wilson, r3, mean, quant, xorshift, entropy } from '../v3/stats.ts';

export type Game = { gameId: string; arm: string; seed: number; rec: GameRec; policies: Record<Player, string> };
export const MIN_CLUSTERS = 5;
export const ITERS = 5000;
const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');
type CI = [number, number];

/** Side-relative first two turns (placements + moves): mirrored openings coincide. */
export function openingKey(g: GameRec, turns = 2): string {
  return g.detail!.turns.slice(0, turns).map(t => {
    const rel = (k: string) => { const [x, y] = k.split(',').map(Number); return `${t.p === 'ai' ? 6 - x : x},${y}`; };
    const eff = (e: string) => (t.p === 'ai' ? e.replace('east', 'W').replace('west', 'east').replace('W', 'west') : e);
    const dir = (d: string) => (t.p === 'ai' ? (d === 'left' ? 'right' : d === 'right' ? 'left' : d) : d);
    return `${t.turn === 1 ? 'F' : 'S'}:${t.placement ? `${eff(t.placement.effect)}@${t.placement.cells.map(rel).sort().join(' ')}` : 'none'}|${t.moves.map(m => rel(m.from) + dir(m.dir)).join(' ')}`;
  }).join(' / ');
}
const decisive = (xs: Game[]) => xs.filter(g => g.rec.winner !== 'draw');
export const RATE: Record<string, (xs: Game[]) => number | null> = {
  first_mover_win_rate: xs => { const d = decisive(xs); return d.length ? d.filter(g => g.rec.winner === g.rec.first).length / d.length : null; },
  human_side_win_rate: xs => { const d = decisive(xs); return d.length ? d.filter(g => g.rec.winner === 'human').length / d.length : null; },
  mean_turns: xs => (xs.length ? mean(xs.map(g => g.rec.turns)) : null),
  turn_limit_rate: xs => (xs.length ? xs.filter(g => g.rec.turnLimit).length / xs.length : null),
  lead_changes: xs => (xs.length ? mean(xs.map(g => g.rec.leadChanges)) : null),
  comeback_rate: xs => { const d = decisive(xs); return d.length ? d.filter(g => g.rec.trailed[g.rec.winner as Player]).length / d.length : null; },
  turn2_captures: xs => (xs.length ? mean(xs.map(g => g.rec.detail!.turns[1]?.moves.reduce((a, m) => a + m.events.filter(e => e.t === 'capture').reduce((b, e) => b + (e as { pieces: string[] }).pieces.length, 0), 0) ?? 0)) : null),
};

/** Seed-blocked bootstrap of f over one set of games. */
export function seedBlocked(xs: Game[], f: (xs: Game[]) => number | null, seed = 68000): { value: number | null; ci95: CI | null; blocks: number } {
  const blocks = [...xs.reduce((m, g) => m.set(g.seed, [...(m.get(g.seed) ?? []), g]), new Map<number, Game[]>()).values()];
  const v = f(xs), rnd = xorshift(seed), out: number[] = [];
  for (let i = 0; i < ITERS; i++) { const r = f(blocks.map(() => blocks[Math.floor(rnd() * blocks.length)]).flat()); if (r !== null) out.push(r); }
  return { value: v === null ? null : r3(v), ci95: out.length ? [r3(quant(out, 0.025)), r3(quant(out, 0.975))] : null, blocks: blocks.length };
}
/** Difference f(A) - f(B) of two arms played on the SAME seeds, resampling seeds jointly (paired). */
export function pairedSeedDiff(A: Game[], B: Game[], f: (xs: Game[]) => number | null, seed = 68001): { diff: number | null; ci95: CI | null } {
  const seeds = [...new Set(A.map(g => g.seed))].sort((a, b) => a - b), rnd = xorshift(seed), out: number[] = [];
  const by = (xs: Game[]) => new Map(seeds.map(s => [s, xs.filter(g => g.seed === s)]));
  const a = by(A), b = by(B), fa = f(A), fb = f(B);
  for (let i = 0; i < ITERS; i++) { const pick = seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]); const x = f(pick.flatMap(s => a.get(s)!)), y = f(pick.flatMap(s => b.get(s)!)); if (x !== null && y !== null) out.push(x - y); }
  return { diff: fa === null || fb === null ? null : r3(fa - fb), ci95: out.length ? [r3(quant(out, 0.025)), r3(quant(out, 0.975))] : null };
}
/** Opening-cluster bootstrap: a sensitivity diagnostic only. */
export function clusterDiagnostic(xs: Game[], f: (xs: Game[]) => number | null, seed = 68002): { clusters: number; status: 'ESTIMATED' | 'NOT_ESTIMABLE'; ci95: CI | null } {
  const groups = [...xs.reduce((m, g) => { const k = openingKey(g.rec); return m.set(k, [...(m.get(k) ?? []), g]); }, new Map<string, Game[]>()).values()];
  if (groups.length < MIN_CLUSTERS) return { clusters: groups.length, status: 'NOT_ESTIMABLE', ci95: null };
  const rnd = xorshift(seed), out: number[] = [];
  for (let i = 0; i < ITERS; i++) { const v = f(groups.map(() => groups[Math.floor(rnd() * groups.length)]).flat()); if (v !== null) out.push(v); }
  return { clusters: groups.length, status: 'ESTIMATED', ci95: [r3(quant(out, 0.025)), r3(quant(out, 0.975))] };
}

export function coverage(xs: Game[]) {
  const counts = [...xs.reduce((m, g) => m.set(openingKey(g.rec), (m.get(openingKey(g.rec)) ?? 0) + 1), new Map<string, number>()).values()];
  const t1 = new Set(xs.map(g => openingKey(g.rec, 1).split('|')[0])).size;
  const pl = new Map<string, number>(); for (const g of xs) for (const p of g.rec.placements) pl.set(p.effect, (pl.get(p.effect) ?? 0) + 1);
  return { games: xs.length, distinctTwoTurnOpenings: counts.length, distinctTurn1Placements: t1, openingEntropyBits: r3(entropy(counts)), effectiveOpenings: r3(2 ** entropy(counts)), largestOpeningShare: r3(Math.max(...counts) / xs.length), distinctPlacementSignatures: new Set(xs.flatMap(g => PLAYERS.map(p => g.rec.signature[p]))).size, effectEntropyNorm: pl.size > 1 ? r3(entropy([...pl.values()]) / Math.log2(pl.size)) : 0 };
}

export function describeArm(xs: Game[]) {
  const dec = decisive(xs), fm = dec.filter(g => g.rec.winner === g.rec.first).length, hu = dec.filter(g => g.rec.winner === 'human').length;
  return {
    games: xs.length, decisive: dec.length, draws: xs.length - dec.length,
    firstMover: { k: fm, n: dec.length, wilson95: wilson(fm, dec.length), seedBlocked: seedBlocked(xs, RATE.first_mover_win_rate), openingClusters: clusterDiagnostic(xs, RATE.first_mover_win_rate) },
    humanSide: { k: hu, n: dec.length, wilson95: wilson(hu, dec.length), seedBlocked: seedBlocked(xs, RATE.human_side_win_rate), openingClusters: clusterDiagnostic(xs, RATE.human_side_win_rate) },
    length: { mean: seedBlocked(xs, RATE.mean_turns), median: [...xs.map(g => g.rec.turns)].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)], turnLimit: seedBlocked(xs, RATE.turn_limit_rate) },
    counterplay: { leadChanges: seedBlocked(xs, RATE.lead_changes), comebacks: seedBlocked(xs, RATE.comeback_rate) },
    turn2Captures: seedBlocked(xs, RATE.turn2_captures), coverage: coverage(xs),
    integrity: { illegal: xs.reduce((a, g) => a + g.rec.illegal.length, 0), errors: xs.reduce((a, g) => a + g.rec.errors.length, 0), softlocks: xs.filter(g => g.rec.softlock).length },
  };
}

/** Cross-play strength: per pairing, policy A's decisive win rate with a seed-blocked interval (blocks of 4 games). */
export function crossPlay(xs: Game[], a: string, b: string) {
  const f = (gs: Game[]) => { const d = decisive(gs); return d.length ? d.filter(g => g.policies[g.rec.winner as Player] === a).length / d.length : null; };
  const d = decisive(xs), k = d.filter(g => g.policies[g.rec.winner as Player] === a).length;
  const asRole = Object.fromEntries(PLAYERS.map(p => { const gs = d.filter(g => g.policies[p] === a); const w = gs.filter(g => g.rec.winner === p).length; return [`${a}As_${p}`, { k: w, n: gs.length, wilson95: wilson(w, gs.length) }]; }));
  return { a, b, games: xs.length, decisive: d.length, aWins: k, aRate: d.length ? r3(k / d.length) : null, wilson95: wilson(k, d.length), seedBlocked: seedBlocked(xs, f), ...asRole, firstMoverRate: seedBlocked(xs, RATE.first_mover_win_rate) };
}

export type Verdict = 'ROBUST ACROSS THE ELIGIBLE POLICIES (not a proof about the rules)' | 'POLICY-DEPENDENT' | 'INCONCLUSIVE' | 'INSUFFICIENT POLICIES';
/**
 * Rule robustness of a pattern measured as an edge (rate - 0.5) per policy (seed-blocked intervals). Zero or one eligible
 * policy can never give a robustness verdict.
 */
export function patternSurvives(perPolicy: Record<string, { eligible: boolean; ci95: CI | null }>, threshold = 0.05): Verdict {
  const v = Object.values(perPolicy).filter(x => x.eligible && x.ci95);
  if (v.length < 2) return 'INSUFFICIENT POLICIES';
  const above = v.filter(x => x.ci95![0] > threshold), below = v.filter(x => x.ci95![1] < -threshold), within = v.filter(x => x.ci95![0] >= -threshold && x.ci95![1] <= threshold);
  if (above.length === v.length || below.length === v.length) return 'ROBUST ACROSS THE ELIGIBLE POLICIES (not a proof about the rules)';
  if ((above.length && (within.length || below.length)) || (below.length && within.length)) return 'POLICY-DEPENDENT';
  return 'INCONCLUSIVE';
}
export { other };

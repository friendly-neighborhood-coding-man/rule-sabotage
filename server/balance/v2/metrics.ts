/**
 * Balance Designer V2 metrics and uncertainty. Every metric is computed from engine-measured game records.
 * Metrics are kept apart on purpose: activation consequences, placement frequency, self- vs opponent-trigger
 * rate, conditional win rate (descriptive, selection-biased) and marginal treatment impact (head-to-head,
 * randomized by seed and side) are different numbers and are never substituted for each other.
 *
 * Contract preserved: an effect's meaning is relative to the owner of the piece that triggers it (the
 * activator), not the installer. "benefit" below is always squares gained by the activator.
 */
import { type GameRec } from '../selfplay.ts';
import { type Player, PLAYERS } from '../../rules.ts';

export type Unit = { recs: GameRec[]; treated?: Player[] };
type MetricFn = (u: Unit) => number | null;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const share = (k: number, n: number) => (n ? k / n : null);
const tp = (u: Unit) => u.recs.flatMap(r => r.triggers.filter(t => t.kind === 'teleport' && t.realized !== null));
const ew = (u: Unit) => u.recs.flatMap(r => r.placements.filter(p => p.effect.startsWith('shove:east:') || p.effect.startsWith('shove:west:')));
/** A shove east helps Human (goal = column G), a shove west helps AI (goal = column A). */
export const selfBoost = (effect: string, placer: Player) => (effect.startsWith('shove:east:') && placer === 'human') || (effect.startsWith('shove:west:') && placer === 'ai');
const allPl = (u: Unit) => u.recs.flatMap(r => r.placements);

const ewT = (u: Unit) => u.recs.flatMap(r => r.triggers.filter(t => t.effect.startsWith('shove:east:') || t.effect.startsWith('shove:west:')));
const tpSelf1 = (u: Unit) => tp(u).filter(x => x.self && x.chain === 1);
export const METRICS: Record<string, { label: string; unit: string; kind: 'behavior' | 'consequence' | 'outcome' | 'health' | 'safety'; fn: MetricFn; note?: string; n?: (u: Unit) => number }> = {
  tp_self_share: { label: 'Teleport triggers set off by the installer’s own pieces', unit: 'share', kind: 'behavior', fn: u => { const t = tp(u); return share(t.filter(x => x.self).length, t.length); }, n: u => tp(u).length },
  tp_per_game: { label: 'Teleport placements per game', unit: 'count', kind: 'behavior', fn: u => (u.recs.length ? allPl(u).filter(p => p.effect === 'teleport').length / u.recs.length : null), n: u => u.recs.length },
  tp_benefit: { label: 'Teleport: squares gained by the activator (all triggers)', unit: 'squares', kind: 'consequence', fn: u => mean(tp(u).map(t => -t.realized!)), n: u => tp(u).length },
  tp_self_benefit: { label: 'Teleport: squares gained, own-installed, stepped on by choice (chain 1)', unit: 'squares', kind: 'consequence', fn: u => mean(tp(u).filter(t => t.self && t.chain === 1).map(t => -t.realized!)), n: u => tpSelf1(u).length },
  tp_opp_benefit: { label: 'Teleport: squares gained by an activator who did NOT install it', unit: 'squares', kind: 'consequence', fn: u => mean(tp(u).filter(t => !t.self).map(t => -t.realized!)), n: u => tp(u).filter(t => !t.self).length },
  tp_self_harm_rate: { label: 'Teleport: own-installed chosen steps that moved the piece away from its goal', unit: 'share', kind: 'consequence', fn: u => { const t = tp(u).filter(x => x.self && x.chain === 1); return share(t.filter(x => x.realized! > 0).length, t.length); }, n: u => tpSelf1(u).length },
  tp_abs_dx: { label: 'Teleport: mean |change in squares to goal| (rule check)', unit: 'squares', kind: 'consequence', fn: u => mean(tp(u).map(t => Math.abs(t.realized!))), n: u => tp(u).length },
  ew_share: { label: 'Shove east/west placements, share of all placements', unit: 'share', kind: 'behavior', fn: u => share(ew(u).length, allPl(u).length) },
  ew_aligned_share: { label: 'Shove east/west placed in the placer’s OWN forward direction', unit: 'share', kind: 'behavior', fn: u => { const p = ew(u); return share(p.filter(x => selfBoost(x.effect, x.p)).length, p.length); }, n: u => ew(u).length, note: 'NOT discriminating: a west shove placed by AI both blocks Human and carries AI, so placement direction cannot separate a trap from a self-boost (found in a dry-run, see hypotheses.json note).' },
  ew_self_trigger_share: { label: 'Shove east/west triggers set off by the installer’s own pieces (riding own conveyor)', unit: 'share', kind: 'behavior', fn: u => { const t = ewT(u); return share(t.filter(x => x.self).length, t.length); }, n: u => ewT(u).length },
  ew_per_game: { label: 'Shove east/west placements per game', unit: 'count', kind: 'behavior', fn: u => (u.recs.length ? ew(u).length / u.recs.length : null), n: u => u.recs.length },
  self_trigger_share: { label: 'All triggers set off by the installer’s own pieces', unit: 'share', kind: 'behavior', fn: u => { const t = u.recs.flatMap(r => r.triggers); return share(t.filter(x => x.self).length, t.length); } },
  max_effect_share: { label: 'Largest single-effect share of placements', unit: 'share', kind: 'health', fn: u => { const p = allPl(u); if (!p.length) return null; const c = new Map<string, number>(); p.forEach(x => c.set(x.effect, (c.get(x.effect) ?? 0) + 1)); return Math.max(...c.values()) / p.length; } },
  effect_entropy: { label: 'Effect diversity (normalised entropy of placements)', unit: '0–1', kind: 'health', fn: u => { const p = allPl(u); const c = new Map<string, number>(); p.forEach(x => c.set(x.effect, (c.get(x.effect) ?? 0) + 1)); if (c.size < 2) return 0; const n = p.length; return -[...c.values()].reduce((a, k) => a + (k / n) * Math.log2(k / n), 0) / Math.log2(c.size); } },
  first_player_edge: { label: 'First mover win rate − 0.5 (decisive games)', unit: 'share', kind: 'health', fn: u => { const d = u.recs.filter(r => r.winner !== 'draw'); return d.length ? d.filter(r => r.winner === r.first).length / d.length - 0.5 : null; } },
  human_side_edge: { label: 'Human-side win rate − 0.5 (decisive games)', unit: 'share', kind: 'health', fn: u => { const d = u.recs.filter(r => r.winner !== 'draw'); return d.length ? d.filter(r => r.winner === 'human').length / d.length - 0.5 : null; } },
  turns_mean: { label: 'Game length (turns)', unit: 'turns', kind: 'health', fn: u => mean(u.recs.map(r => r.turns)) },
  comeback_rate: { label: 'Winner trailed after turn 4 (counterplay)', unit: 'share', kind: 'health', fn: u => { const d = u.recs.filter(r => r.winner !== 'draw'); return share(d.filter(r => r.trailed[r.winner as Player]).length, d.length); } },
  lead_changes: { label: 'Lead changes per game (counterplay)', unit: 'count', kind: 'health', fn: u => mean(u.recs.map(r => r.leadChanges)) },
  draw_or_limit_rate: { label: 'Draws or turn-limit endings', unit: 'share', kind: 'health', fn: u => share(u.recs.filter(r => r.winner === 'draw' || r.turnLimit).length, u.recs.length) },
  safety_events: { label: 'Illegal actions + engine errors + softlocks', unit: 'count', kind: 'safety', fn: u => u.recs.reduce((a, r) => a + r.illegal.length + r.errors.length + (r.softlock ? 1 : 0), 0) },
  conditional_win_tp: { label: 'Win rate of players who placed Teleport (DESCRIPTIVE: selection-biased, not a causal effect)', unit: 'share', kind: 'outcome', fn: u => { const x = u.recs.flatMap(r => PLAYERS.filter(p => r.winner !== 'draw' && r.placements.some(q => q.p === p && q.effect === 'teleport')).map(p => r.winner === p ? 1 : 0)); return mean(x); }, note: 'Players who choose an effect differ from those who do not; this is not the effect’s impact.' },
  treated_win_rate: { label: 'Head-to-head: win rate of the treated planner vs the control planner (marginal treatment impact)', unit: 'share', kind: 'outcome', fn: u => { if (!u.treated) return null; const x = u.recs.map((r, i) => (r.winner === 'draw' ? 0.5 : r.winner === u.treated![i] ? 1 : 0)); return mean(x); }, note: 'Randomized: each seed is played with the treated planner on both sides and both first-player orders.' },
};
export type MetricKey = keyof typeof METRICS;
export const metric = (k: string, u: Unit) => { const m = METRICS[k]; if (!m) throw new Error(`unknown metric ${k}`); return m.fn(u); };

// ---------------------------------------------------------------- uncertainty
/** Deterministic xorshift so a bootstrap is reproducible from its seed. */
export function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; }
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);

export type Effect = {
  metric: string; control: number | null; treatment: number | null; effect: number | null; ci: [number, number] | null; units: number;
  /** Underlying events (triggers, placements or games) behind each value; a metric over a handful of events is not judged. */
  events: { control: number | null; treatment: number | null };
  /** Effect recomputed on independent halves of the seed list, and on each first-player order. */
  batches: (number | null)[]; sides: { humanFirst: number | null; aiFirst: number | null };
  perSeed: { seed: number; control: number | null; treatment: number | null }[];
};
const bySeed = (recs: GameRec[], treated?: Player[]) => {
  const m = new Map<number, Unit>();
  recs.forEach((r, i) => { const u = m.get(r.seed) ?? { recs: [], ...(treated ? { treated: [] } : {}) }; u.recs.push(r); if (treated) u.treated!.push(treated[i]); m.set(r.seed, u); });
  return m;
};
const merge = (us: Unit[]): Unit => ({ recs: us.flatMap(u => u.recs), ...(us.some(u => u.treated) ? { treated: us.flatMap(u => u.treated ?? []) } : {}) });

/**
 * Paired comparison at the SEED level: control and treatment play the same seeds with the same first-player
 * controls; the games diverge once the intervention changes a decision, so exact move-level pairing is not
 * possible after that point (recorded as firstDivergence). The 95% interval is a cluster bootstrap over seeds.
 * For head-to-head units (no control games) the effect is metric − `reference` (0.5 for a win rate).
 */
export function pairedEffect(k: string, control: GameRec[] | null, treat: GameRec[], opts: { treated?: Player[]; reference?: number; boot?: number; seed?: number } = {}): Effect {
  const T = bySeed(treat, opts.treated), C = control ? bySeed(control) : null;
  const seeds = [...T.keys()].filter(s => !C || C.has(s)).sort((a, b) => a - b);
  const val = (u: Unit | undefined) => (u ? metric(k, u) : null);
  const diff = (ss: number[]) => {
    const t = val(merge(ss.map(s => T.get(s)!)));
    const c = C ? val(merge(ss.map(s => C.get(s)!))) : (opts.reference ?? 0);
    return t === null || c === null ? null : t - c;
  };
  const effect = seeds.length ? diff(seeds) : null;
  const R = rng(opts.seed ?? 0x5eed), B = opts.boot ?? 1000, boots: number[] = [];
  for (let b = 0; b < B && seeds.length > 1; b++) { const d = diff(seeds.map(() => seeds[Math.floor(R() * seeds.length)])); if (d !== null) boots.push(d); }
  boots.sort((a, b) => a - b);
  const ci: [number, number] | null = boots.length >= B * 0.8 ? [boots[Math.floor(0.025 * boots.length)], boots[Math.min(boots.length - 1, Math.floor(0.975 * boots.length))]] : null;
  const half = Math.ceil(seeds.length / 2);
  const sideDiff = (first: Player) => {
    const pick = (m: Map<number, Unit>, s: number): Unit => { const u = m.get(s)!; const idx = u.recs.map((r, i) => (r.first === first ? i : -1)).filter(i => i >= 0); return { recs: idx.map(i => u.recs[i]), ...(u.treated ? { treated: idx.map(i => u.treated![i]) } : {}) }; };
    const t = val(merge(seeds.map(s => pick(T, s)))), c = C ? val(merge(seeds.map(s => pick(C, s)))) : (opts.reference ?? 0);
    return t === null || c === null ? null : r4(t - c);
  };
  return {
    metric: k, control: C ? r4(val(merge(seeds.map(s => C.get(s)!)))) : (opts.reference ?? null), treatment: r4(val(merge(seeds.map(s => T.get(s)!)))),
    events: { control: C && METRICS[k].n ? METRICS[k].n!(merge(seeds.map(s => C.get(s)!))) : null, treatment: METRICS[k].n ? METRICS[k].n!(merge(seeds.map(s => T.get(s)!))) : null },
    effect: r4(effect), ci: ci ? [r4(ci[0])!, r4(ci[1])!] : null, units: seeds.length,
    batches: seeds.length >= 4 ? [r4(diff(seeds.slice(0, half))), r4(diff(seeds.slice(half)))] : [],
    sides: { humanFirst: sideDiff('human'), aiFirst: sideDiff('ai') },
    perSeed: seeds.map(s => ({ seed: s, control: C ? r4(val(C.get(s))) : (opts.reference ?? null), treatment: r4(val(T.get(s))) })),
  };
}

/** First turn at which a treatment game's decisions differ from its control game (same seed and first player). */
export function firstDivergence(c: GameRec, t: GameRec): number | null {
  const perTurn = (r: GameRec) => {
    const m = new Map<number, string[]>();
    for (const p of r.placements) m.set(p.turn, [...(m.get(p.turn) ?? []), `P:${p.p}:${p.effect}:${p.cells.join('/')}`]);
    for (const x of r.triggers) m.set(x.turn, [...(m.get(x.turn) ?? []), `T:${x.mover}:${x.effect}:${x.cell}`]);
    return m;
  };
  const a = perTurn(c), b = perTurn(t);
  for (let turn = 1; turn <= Math.max(c.turns, t.turns); turn++) if ((a.get(turn) ?? []).join('|') !== (b.get(turn) ?? []).join('|')) return turn;
  return c.turns !== t.turns || c.winner !== t.winner ? Math.min(c.turns, t.turns) : null;
}

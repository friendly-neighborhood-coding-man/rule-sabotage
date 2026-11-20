/**
 * Policy-diversity metrics (V5, prepared; no game has been evaluated with this yet). Pure functions over recorded games.
 *
 * Lesson from V4.2: with a deterministic policy, every game with the same first mover can share its whole opening, so
 * 60 seeds are NOT 60 independent openings. Every rate here is therefore reported twice: per game (seed-paired bootstrap)
 * and per OPENING CLUSTER (games grouped by their first two turns; the cluster is the resampling unit).
 */
import { type Player, PLAYERS } from '../../rules.ts';
import { type GameRec } from '../selfplay.ts';
import { wilson, r3, mean, quant, xorshift, entropy } from '../v3/stats.ts';

export type Game = { gameId: string; arm: string; rec: GameRec; policies: Record<Player, string> };
const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');

/** Opening signature: the first two turns (placements and moves), side-relative so mirrored openings coincide. */
export function openingKey(g: GameRec, turns = 2): string {
  return g.detail!.turns.slice(0, turns).map(t => { const rel = (k: string) => { const [x, y] = k.split(',').map(Number); return `${t.p === 'ai' ? 6 - x : x},${y}`; }; return `${t.turn === 1 ? 'F' : 'S'}:${t.placement ? `${t.p === 'ai' ? t.placement.effect.replace('east', 'W').replace('west', 'east').replace('W', 'west') : t.placement.effect}@${t.placement.cells.map(rel).sort().join(' ')}` : 'none'}|${t.moves.map(m => rel(m.from) + (t.p === 'ai' ? (m.dir === 'left' ? 'right' : m.dir === 'right' ? 'left' : m.dir) : m.dir)).join(' ')}`; }).join(' / ');
}

export function strategicDiversity(gs: Game[]) {
  const ok = gs.map(g => openingKey(g.rec)), counts = [...ok.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>()).values()];
  const placements = new Map<string, number>(); for (const g of gs) for (const p of g.rec.placements) placements.set(p.effect, (placements.get(p.effect) ?? 0) + 1);
  const pc = [...placements.values()];
  const sig = new Set(gs.flatMap(g => PLAYERS.map(p => g.rec.signature[p]))).size;
  return {
    games: gs.length, distinctOpenings2Turns: counts.length, openingEntropyBits: r3(entropy(counts)), effectiveOpenings: r3(2 ** entropy(counts)), largestOpeningShare: r3(Math.max(...counts) / gs.length),
    distinctPlacementSignatures: sig, effectEntropyNorm: pc.length > 1 ? r3(entropy(pc) / Math.log2(pc.length)) : 0,
  };
}

/** Resample by opening cluster: the honest unit when openings repeat. */
function clusterBoot(gs: Game[], f: (xs: Game[]) => number | null, iters = 5000, seed = 67000) {
  const groups = [...gs.reduce((m, g) => m.set(openingKey(g.rec), [...(m.get(openingKey(g.rec)) ?? []), g]), new Map<string, Game[]>()).values()];
  const rnd = xorshift(seed), out: number[] = [];
  for (let i = 0; i < iters; i++) { const v = f(groups.map(() => groups[Math.floor(rnd() * groups.length)]).flat()); if (v !== null) out.push(v); }
  return { clusters: groups.length, ci95: out.length ? [r3(quant(out, 0.025)), r3(quant(out, 0.975))] as [number, number] : null };
}
const rate = (xs: Game[], hit: (g: Game) => boolean) => { const d = xs.filter(g => g.rec.winner !== 'draw'); return d.length ? d.filter(hit).length / d.length : null; };

export function balance(gs: Game[]) {
  const dec = gs.filter(g => g.rec.winner !== 'draw');
  const fm = (g: Game) => g.rec.winner === g.rec.first, hu = (g: Game) => g.rec.winner === 'human';
  const k = dec.filter(fm).length, h = dec.filter(hu).length;
  return {
    games: gs.length, decisive: dec.length, draws: gs.length - dec.length,
    firstMover: { k, n: dec.length, rate: dec.length ? r3(k / dec.length) : null, wilson95: wilson(k, dec.length), byOpeningCluster: clusterBoot(gs, xs => rate(xs, fm)) },
    humanSide: { k: h, n: dec.length, rate: dec.length ? r3(h / dec.length) : null, wilson95: wilson(h, dec.length), byOpeningCluster: clusterBoot(gs, xs => rate(xs, hu)) },
  };
}

export function lengthAndCounterplay(gs: Game[]) {
  const t = gs.map(g => g.rec.turns).sort((a, b) => a - b), dec = gs.filter(g => g.rec.winner !== 'draw');
  return {
    meanTurns: r3(mean(t)), medianTurns: t[Math.floor((t.length - 1) / 2)], p90Turns: t[Math.floor(0.9 * (t.length - 1))], turnLimitRate: r3(gs.filter(g => g.rec.turnLimit).length / gs.length),
    leadChangesPerGame: r3(mean(gs.map(g => g.rec.leadChanges))), comebackRate: dec.length ? r3(dec.filter(g => g.rec.trailed[g.rec.winner as Player]).length / dec.length) : null,
    turn2CapturesPerGame: r3(mean(gs.map(g => g.rec.detail!.turns[1]?.moves.reduce((a, m) => a + m.events.filter(e => e.t === 'capture').reduce((b, e) => b + (e as { pieces: string[] }).pieces.length, 0), 0) ?? 0))),
  };
}

/**
 * Competitive strength from cross-play: Bradley-Terry ratings (ref fixed at 0) fitted by MM iterations on decisive
 * games, with a bootstrap over games (draws count half to each side). Every pairing is played with each policy on
 * each side and each first-mover order, so side and tempo are balanced by design.
 */
export function strength(cross: Game[], policies: string[], iters = 2000, seed = 67001) {
  const fit = (gs: Game[]) => {
    const w = new Map<string, number>(), n = new Map<string, number>(); const r = new Map(policies.map(p => [p, 1]));
    for (const g of gs) { const a = g.policies.human, b = g.policies.ai; if (a === b) continue; const key = [a, b].sort().join('|'); n.set(key, (n.get(key) ?? 0) + 1); const win = g.rec.winner === 'draw' ? null : g.policies[g.rec.winner as Player]; for (const p of [a, b]) w.set(p, (w.get(p) ?? 0) + (win === null ? 0.5 : win === p ? 1 : 0)); }
    for (let it = 0; it < 200; it++) for (const p of policies) { let den = 0; for (const q of policies) { if (p === q) continue; const k = [p, q].sort().join('|'); den += (n.get(k) ?? 0) / (r.get(p)! + r.get(q)!); } if (den > 0) r.set(p, Math.max(1e-6, (w.get(p) ?? 0) / den)); }
    const ref = r.get(policies[0])!; return Object.fromEntries(policies.map(p => [p, Math.log(r.get(p)! / ref)]));
  };
  const point = fit(cross), rnd = xorshift(seed), boots: Record<string, number[]> = Object.fromEntries(policies.map(p => [p, []]));
  for (let i = 0; i < iters; i++) { const s = cross.map(() => cross[Math.floor(rnd() * cross.length)]); const f = fit(s); for (const p of policies) boots[p].push(f[p]); }
  const pairs = policies.flatMap((a, i) => policies.slice(i + 1).map(b => { const gs = cross.filter(g => new Set([g.policies.human, g.policies.ai]).size === 2 && [g.policies.human, g.policies.ai].includes(a) && [g.policies.human, g.policies.ai].includes(b)); const dec = gs.filter(g => g.rec.winner !== 'draw'); const k = dec.filter(g => g.policies[g.rec.winner as Player] === a).length; return { a, b, games: gs.length, aWins: k, decisive: dec.length, aRate: dec.length ? r3(k / dec.length) : null, wilson95: wilson(k, dec.length) }; }));
  return { logStrengthVsRef: Object.fromEntries(policies.map(p => [p, { point: r3(point[p]), ci95: [r3(quant(boots[p], 0.025)), r3(quant(boots[p], 0.975))] }])), pairs };
}

/** Does a balance pattern survive the change of policy? (decision rule of the protocol) */
export function patternSurvives(perPolicy: Record<string, { lo: number; hi: number }>, threshold: number): 'SURVIVES (rule-level candidate)' | 'POLICY-SPECIFIC' | 'INCONCLUSIVE' {
  const v = Object.values(perPolicy);
  if (v.every(x => x.lo > threshold) || v.every(x => x.hi < -threshold)) return 'SURVIVES (rule-level candidate)';
  if (v.some(x => x.lo > threshold) && v.some(x => x.hi < threshold && x.lo > -threshold)) return 'POLICY-SPECIFIC';
  if (v.some(x => x.lo > threshold) && v.some(x => x.hi < -threshold)) return 'POLICY-SPECIFIC';
  return 'INCONCLUSIVE';
}
export { other };

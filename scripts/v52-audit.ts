/**
 * V5.2 Phase 1: zero-game randomization audit (no game played).
 *   npm run balance:v52:audit -> evidence/balance/v5_2/audit.json
 * Planner streams (legacy vs mixed), the 2x2 planner (equivalence, mirror, hidden-RNG invariance), and the engine RNG.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { legacyStream, mixedDraw, STREAM_ID } from '../server/balance/v5_2/stream.ts';
import { planTurn52, type Arm } from '../server/balance/v5_2/planner.ts';
import { planTurnAbl } from '../server/balance/v5_1/ablation.ts';
import { planTurn11, canonicalPlan } from '../server/balance/v5/evk11.ts';
import { recordedPositions, syntheticPositions } from '../server/balance/v4/manipulation.ts';
import { mirror } from '../server/balance/v4/diagnose.ts';
import { rand, teleportIndexProbabilities, init } from '../server/engine.ts';
import { loadWeights } from '../server/weights.ts';
import { r3 } from '../server/balance/v3/stats.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
const chi2 = (xs: number[], bins = 20) => { const c = Array(bins).fill(0); for (const x of xs) c[Math.min(bins - 1, Math.floor(x * bins))]++; const e = xs.length / bins; return r3(c.reduce((a, k) => a + (k - e) ** 2 / e, 0)); }; // df 19: 95% critical 30.14
const ks = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); let d = 0; s.forEach((x, i) => { d = Math.max(d, Math.abs((i + 1) / s.length - x), Math.abs(x - i / s.length)); }); return { d: r3(d * 1000) / 1000, crit95: r3(1.36 / Math.sqrt(s.length) * 1000) / 1000 }; };
const draw = (kind: 'legacy' | 'mixed', seed: number, turn: number, role: 'F' | 'S' = 'F', purpose = 'temperature', i = 0) => (kind === 'legacy' ? (() => { const r = legacyStream(seed, turn); let v = 0; for (let k = 0; k <= i; k++) v = r(); return v; })() : mixedDraw(seed, turn, role, purpose, i));
const consecutive = Array.from({ length: 20000 }, (_, i) => 100001 + i);
const dispersed = Array.from({ length: 20000 }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0) % 4000000000 + 100);
const out: Record<string, unknown> = { stream: STREAM_ID, newGamesPlayed: 0, criteria: { chi2_df19_crit95: 30.14, ksCrit: 'see per-test', corrAbsCrit95: r3(1.96 / Math.sqrt(19999)) } };
const streams: Record<string, unknown> = {};
for (const kind of ['legacy', 'mixed'] as const) {
  const r: Record<string, unknown> = {};
  for (const [name, seeds] of [['consecutive', consecutive], ['dispersed', dispersed]] as const) {
    const t21 = seeds.map(s => draw(kind, s, 21)), t22 = seeds.map(s => draw(kind, s, 22)), t1 = seeds.map(s => draw(kind, s, 1));
    const blocks: number[] = []; for (let b = 0; b + 30 <= seeds.length; b += 30) blocks.push(sd(t21.slice(b, b + 30)));
    r[name] = { uniformityTurn21: { chi2: chi2(t21), ks: ks(t21) }, uniformityTurn1: { chi2: chi2(t1) }, adjacentSeedCorrTurn21: r3(corr(t21.slice(0, -1), t21.slice(1))), crossTurnCorr21vs22: r3(corr(t21, t22)), meanSdWithin30SeedBlocks: r3(blocks.reduce((a, b) => a + b, 0) / blocks.length), uniformSd: 0.289 };
  }
  if (kind === 'mixed') { const a = consecutive.map(s => mixedDraw(s, 21, 'F', 'temperature', 0)), b = consecutive.map(s => mixedDraw(s, 21, 'S', 'temperature', 0)), c = consecutive.map(s => mixedDraw(s, 21, 'F', 'noise', 0)); r.roleSeparationCorr = r3(corr(a, b)); r.purposeSeparationCorr = r3(corr(a, c)); r.reproducible = consecutive.slice(0, 200).every(s => mixedDraw(s, 21, 'F', 'temperature', 3) === mixedDraw(s, 21, 'F', 'temperature', 3)); }
  streams[kind] = r; log(`${kind}: ${JSON.stringify(r)}`);
}
out.plannerStreams = streams;

// Engine RNG: the teleport destination index rand() % n at the 1st, 2nd and 5th engine draw after init (init itself advances 4 times)
const engine: Record<string, unknown> = {};
for (const n of [20, 27, 35]) for (const k of [1, 2, 5]) {
  const idx = consecutive.map(seed => { const s = init(seed, { first: 'human' }); let v = 0; for (let j = 0; j < k; j++) v = rand(s); return v % n; });
  const p = teleportIndexProbabilities(n), counts = Array(n).fill(0); idx.forEach(i => counts[i]++);
  const x2 = counts.reduce((a, c, i) => a + (c - idx.length * p[i]) ** 2 / (idx.length * p[i]), 0);
  engine[`n${n}_draw${k}`] = { chi2: r3(x2), df: n - 1, adjacentSeedCorrOfIndex: r3(corr(idx.slice(0, -1), idx.slice(1))), sdWithin30SeedBlocks: r3((() => { const b: number[] = []; for (let i = 0; i + 30 <= idx.length; i += 30) b.push(sd(idx.slice(i, i + 30).map(x => x / n))); return b.reduce((a, c) => a + c, 0) / b.length; })()) };
}
out.engineRng = { note: 'chi2 against the exact law, df = n-1 (95% critical: n20 30.1, n27 38.9, n35 48.6); index/n sd within 30-seed blocks for comparison with the uniform 0.289', ...engine };
log(`engine: ${JSON.stringify(engine)}`);

// The 2x2 planner on positions: equivalence, mirror symmetry, hidden-RNG invariance, roll used
const ps = [...recordedPositions(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5'), 3000, 2, 5).filter(x => x.id.startsWith('S-REF')).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 20)) === 0).slice(0, 20), ...syntheticPositions(20, 5252)];
const arms: Record<string, Arm> = { 'C4off-legacy': { c4: false, stream: 'legacy' }, 'C4on-legacy': { c4: true, stream: 'legacy' }, 'C4off-mixed': { c4: false, stream: 'mixed' }, 'C4on-mixed': { c4: true, stream: 'mixed' } };
const plannerChecks: Record<string, unknown> = {}; let eqAbl = 0, eqK11 = 0;
for (const [name, arm] of Object.entries(arms)) {
  let mm = 0, rng = 0, rolls = 0;
  for (const { s, p } of ps) {
    const q = p === 'human' ? 'ai' : 'human', a = planTurn52(s, arm, { me: p, weights: w }), b = planTurn52(mirror(s), arm, { me: q, weights: w });
    if (canonicalPlan(p, a.chosen) !== canonicalPlan(q, b.chosen) || Math.abs(a.chosen.score - b.chosen.score) > 1e-6 || a.roll !== b.roll) mm++;
    const s2 = structuredClone(s); s2.rng = 0xdeadbeef; if (canonicalPlan(p, planTurn52(s2, arm, { me: p, weights: w }).chosen) !== canonicalPlan(p, a.chosen)) rng++;
    if (a.roll !== null) rolls++;
    if (name === 'C4off-legacy' && canonicalPlan(p, planTurnAbl(s, { c1: true, c2: true, c3: true }, { me: p, weights: w }).chosen) === canonicalPlan(p, a.chosen)) eqAbl++;
    if (name === 'C4on-legacy' && canonicalPlan(p, planTurn11(s, { me: p, weights: w }).chosen) === canonicalPlan(p, a.chosen)) eqK11++;
  }
  plannerChecks[name] = { positions: ps.length, mirrorMismatch: mm, hiddenRngChanged: rng, positionsWithATemperatureRoll: rolls };
  log(`${name}: ${JSON.stringify(plannerChecks[name])}`);
}
out.planner = { ...plannerChecks, equivalence: { 'C4off-legacy == V5.1 ablation {c1,c2,c3}': `${eqAbl}/${ps.length}`, 'C4on-legacy == ev-k1.1': `${eqK11}/${ps.length}` } };
const st = out.plannerStreams as Record<string, Record<string, Record<string, unknown>>>;
const mix = st.mixed, ok = (x: Record<string, unknown>) => (x.uniformityTurn21 as { chi2: number }).chi2 < 30.14 && Math.abs(x.adjacentSeedCorrTurn21 as number) < 0.02 && Math.abs(x.crossTurnCorr21vs22 as number) < 0.02 && (x.meanSdWithin30SeedBlocks as number) > 0.25;
const pc = Object.values(plannerChecks) as { mirrorMismatch: number; hiddenRngChanged: number }[];
out.pass = ok(mix.consecutive) && ok(mix.dispersed) && Math.abs(mix.roleSeparationCorr as unknown as number) < 0.02 && (mix.reproducible as unknown as boolean) && pc.every(x => x.mirrorMismatch === 0 && x.hiddenRngChanged === 0) && eqAbl === ps.length && eqK11 === ps.length;
mkdirSync(join(ROOT, 'evidence/balance/v5_2'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/balance/v5_2/audit.json'), JSON.stringify(out, null, 2));
log(`audit ${out.pass ? 'PASS' : 'FAIL'}`);

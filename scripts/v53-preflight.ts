/**
 * V5.3 preflight (positions + 3 throwaway smoke games, seeds 99911-99913, not a dataset).
 *   npm run balance:v53:preflight -> evidence/balance/v5_3/preflight.json
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, replayDetail, filesHash, ENGINE_FILES } from '../server/balance/v3/batch.ts';
import { playGame } from '../server/balance/selfplay.ts';
import { loadWeights } from '../server/weights.ts';
import { init, applyPlacement, applyMove, endTurn, type Dir, type Move } from '../server/engine.ts';
import { effectFromId } from '../server/weights.ts';
import { syntheticPositions } from '../server/balance/v4/manipulation.ts';
import { mirror } from '../server/balance/v4/diagnose.ts';
import { canonicalPlan } from '../server/balance/v5/evk11.ts';
import { planOpponentAware } from '../server/balance/v5/policies.ts';
import { planTurn52 } from '../server/balance/v5_2/planner.ts';
import { planPolicy53, moves53, planRef12, planOA3, OA3, POLICIES53, policies53Hash } from '../server/balance/v5_3/policies.ts';
import { turns as views } from '../server/balance/v5_1/reanalysis.ts';
import { quant } from '../server/balance/v3/stats.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const out: Record<string, unknown> = { hashes: { engineFiles: filesHash(ENGINE_FILES), engineFrozen: 'f92354f4b139d30c', policies53: policies53Hash() }, oa3Params: OA3 };
const mk = (m: Move): Move => { const [x, y] = m.from.split(',').map(Number); return { from: `${6 - x},${y}`, dir: m.dir === 'left' ? 'right' : m.dir === 'right' ? 'left' : m.dir, mode: m.mode }; };
const asMove = (s: ReturnType<typeof init>) => (s.phase === 'place' ? { ...structuredClone(s), phase: 'move' as const } : s);
const other = (p: 'human' | 'ai') => (p === 'human' ? 'ai' : 'human') as 'human' | 'ai';

// ---- 1. ev-k1.2 on consecutive and dispersed seeds
const base = syntheticPositions(20, 535353);
const seedSets = { consecutive: base.map((x, i) => ({ ...x, s: Object.assign(structuredClone(x.s), { seed: 72001 + i }) })), dispersed: base.map((x, i) => ({ ...x, s: Object.assign(structuredClone(x.s), { seed: (Math.imul(i + 11, 2246822519) >>> 0) || 1 }) })) };
const ref: Record<string, unknown> = {};
for (const [name, ps] of Object.entries(seedSets)) {
  let repro = 0, rng = 0, mirr = 0, exec = 0, eqA4 = 0;
  for (const { s, p } of ps) {
    const a = planRef12(s, p, w), b = planRef12(s, p, w), q = other(p);
    if (canonicalPlan(p, a.chosen) === canonicalPlan(p, b.chosen) && a.meta.roll === b.meta.roll) repro++;
    const s2 = structuredClone(s); s2.rng = 0x7777; if (canonicalPlan(p, planRef12(s2, p, w).chosen) !== canonicalPlan(p, a.chosen)) rng++;
    const m = planRef12(mirror(s), q, w); if (canonicalPlan(p, a.chosen) !== canonicalPlan(q, m.chosen) || a.meta.roll !== m.meta.roll || Math.abs(a.chosen.score - m.chosen.score) > 1e-6) mirr++;
    if (JSON.stringify(moves53(asMove(s), p, w).moves.map(mk)) !== JSON.stringify(moves53(asMove(mirror(s)), q, w).moves)) exec++;
    if (canonicalPlan(p, planTurn52(s, { c4: true, stream: 'mixed' }, { me: p, weights: w }).chosen) === canonicalPlan(p, a.chosen)) eqA4++;
  }
  ref[name] = { positions: ps.length, reproducible: repro, hiddenRngChanged: rng, mirrorPlanMismatch: mirr, mirrorExecutedMismatch: exec, equalToV52ArmA4: eqA4 };
  log(`ev-k1.2 ${name}: ${JSON.stringify(ref[name])}`);
}
// near-tie branch sampling: the stored V5 S-REF state at turn 21 (top-two gap 0.48), replanned under 30 consecutive and 30 dispersed seeds
{
  const g = JSON.parse(readFileSync(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5/games/S-REF-68001-human.json'), 'utf8')).rec;
  const s = init(g.seed, { first: g.first });
  for (const t of g.detail.turns) { if (t.turn === 21) break; if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' }); if (s.phase === 'place') s.phase = 'move'; for (const m of t.moves) applyMove(s, t.p, { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] }); endTurn(s); }
  const pick = (seeds: number[], legacy: boolean) => { const c = new Map<string, number>(); for (const sd of seeds) { const x = Object.assign(structuredClone(s), { seed: sd }); const r = legacy ? planTurn52(x, { c4: true, stream: 'legacy' }, { me: x.current, weights: w }) : planRef12(x, x.current, w); c.set(r.chosen.id, (c.get(r.chosen.id) ?? 0) + 1); } return Object.fromEntries(c); };
  const cons = Array.from({ length: 30 }, (_, i) => 72101 + i), disp = Array.from({ length: 30 }, (_, i) => (Math.imul(i + 3, 2654435761) >>> 0) || 1);
  ref.turn21NearTie = { stateFrom: 'S-REF-68001-human before turn 21', legacyConsecutive: pick(cons, true), legacyDispersed: pick(disp, true), evk12Consecutive: pick(cons, false), evk12Dispersed: pick(disp, false) };
  log(`turn-21 branch: ${JSON.stringify(ref.turn21NearTie)}`);
}
out.evk12 = ref;

// ---- 2. oa-v3 vs frozen oa-v2 on stored positions (incl. the 4 slow games)
const SLOW = ['S-OA-68001-ai', 'S-OA-68009-ai', 'S-OA-68014-human', 'S-OA-68030-human'];
const others = ['S-OA-68002-human', 'S-OA-68005-ai', 'S-OA-68011-ai', 'S-OA-68020-human'];
const oaRows: Record<string, unknown>[] = [];
for (const id of [...SLOW, ...others]) {
  const g = JSON.parse(readFileSync(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5/games', `${id}.json`), 'utf8')).rec;
  const s = init(g.seed, { first: g.first });
  for (const t of g.detail.turns) {
    if (t.turn % 3 === 1) {
      const t2 = performance.now(), v2 = planOpponentAware(s, t.p, w), ms2 = performance.now() - t2;
      const v3 = planOA3(s, t.p, w);
      const v2best = v2.ranked[0].score, v2ofV3 = v2.ranked.find(c => canonicalPlan(t.p, c).split('|')[0] === canonicalPlan(t.p, v3.chosen).split('|')[0]);
      oaRows.push({ game: id, slow: SLOW.includes(id), turn: t.turn, samePlacement: canonicalPlan(t.p, v2.chosen).split('|')[0] === canonicalPlan(t.p, v3.chosen).split('|')[0], samePlan: canonicalPlan(t.p, v2.chosen) === canonicalPlan(t.p, v3.chosen), oaV2Ms: Math.round(ms2), oaV3Ms: v3.meta.ms, oaV3BudgetSims: v3.meta.budgetSims, budgetHit: v3.meta.budgetHit, fallback: v3.meta.fallback, regretInOaV2Scale: v2ofV3 ? +(v2best - v2ofV3.score).toFixed(3) : null, oaV3ChoiceOutsideOaV2Top6: !v2ofV3, scoreError: v2ofV3 ? +Math.abs(v3.chosen.score - v2ofV3.score).toFixed(3) : null, approximations: { secondLevelCollapsed: v3.meta.secondLevelCollapsed, opponentOptionsPruned: v3.meta.opponentOptionsPruned, memoHits: v3.meta.memoHits } });
      log(`oa ${id} t${t.turn}: ${JSON.stringify(oaRows[oaRows.length - 1])}`);
    }
    if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' }); if (s.phase === 'place') s.phase = 'move';
    for (const m of t.moves) applyMove(s, t.p, { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] });
    if (s.winner) break; endTurn(s);
  }
}
const ms3 = oaRows.map(r => r.oaV3Ms as number), ms2 = oaRows.map(r => r.oaV2Ms as number), reg = oaRows.map(r => r.regretInOaV2Scale).filter((x): x is number => x !== null);
out.oa3VsOa2 = { positions: oaRows.length, placementDisagreement: oaRows.filter(r => !r.samePlacement).length, planDisagreement: oaRows.filter(r => !r.samePlan).length, choiceOutsideOaV2Top6: oaRows.filter(r => r.oaV3ChoiceOutsideOaV2Top6).length, regret: { mean: +(reg.reduce((a, b) => a + b, 0) / Math.max(1, reg.length)).toFixed(3), p90: +quant(reg, 0.9).toFixed(3), max: Math.max(0, ...reg) }, oaV3Ms: { p50: Math.round(quant(ms3, 0.5)), p90: Math.round(quant(ms3, 0.9)), p99: Math.round(quant(ms3, 0.99)), max: Math.max(...ms3) }, oaV2Ms: { p50: Math.round(quant(ms2, 0.5)), p90: Math.round(quant(ms2, 0.9)), max: Math.max(...ms2) }, budget: { maxBudgetSims: Math.max(...oaRows.map(r => r.oaV3BudgetSims as number)), budgetHits: oaRows.filter(r => r.budgetHit).length, fallbacks: oaRows.filter(r => r.fallback).length }, rows: oaRows };
log(`oa summary: ${JSON.stringify({ ...out.oa3VsOa2 as object, rows: undefined })}`);
// oa-v3 mirror + hidden RNG
{ let mm = 0, rg = 0; for (const { s, p } of syntheticPositions(10, 3131)) { const q = other(p), a = planOA3(s, p, w), b = planOA3(mirror(s), q, w); if (canonicalPlan(p, a.chosen) !== canonicalPlan(q, b.chosen) || Math.abs(a.chosen.score - b.chosen.score) > 1e-6) mm++; const s2 = structuredClone(s); s2.rng = 0x9999; if (canonicalPlan(p, planOA3(s2, p, w).chosen) !== canonicalPlan(p, a.chosen)) rg++; } out.oa3Symmetry = { positions: 10, mirrorMismatch: mm, hiddenRngChanged: rg }; log(`oa-v3 symmetry: ${JSON.stringify(out.oa3Symmetry)}`); }

// ---- 3. smoke games (throwaway) + legacy replay routing
const smoke: unknown[] = [];
POLICIES53.forEach((id, i) => {
  const t0 = Date.now(), r = playGame(99911 + i, i % 2 ? 'ai' : 'human', { human: w, ai: w }, { detail: true, policy53: { human: id, ai: id }, maxMs: 1_800_000 });
  const v = views({ gameId: 'smoke', arm: id, policies: { human: id, ai: id }, rec: r } as never);
  let turns = 0, agree = 0; for (const t of v) { if (!t.planned) continue; turns++; const fr = t.moves.findIndex(x => x.random); if (JSON.stringify(t.moves.slice(0, fr >= 0 ? fr + 1 : t.moves.length).map(x => `${x.m.from}${x.m.dir}${x.m.mode}`)) === JSON.stringify(t.planned)) agree++; }
  const metas = r.detail!.turns.map(t => t.policyMeta!).filter(Boolean);
  smoke.push({ policy: id, seed: 99911 + i, winner: r.winner, turns: r.turns, ms: Date.now() - t0, replayOk: replayDetail(r).ok, agree: `${agree}/${turns}`, maxDecisionMs: Math.max(...metas.map(m => m.ms)), budgetHits: metas.filter(m => m.budgetHit).length, errors: r.errors });
  log(`smoke ${id}: ${JSON.stringify(smoke[smoke.length - 1])}`);
});
out.smoke = smoke;
const v5 = JSON.parse(readFileSync(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5/games/S-REF-68002-human.json'), 'utf8')).rec;
const v52 = JSON.parse(readFileSync(join(ROOT, (() => { const d = readFileSync(join(ROOT, 'balance/v5_2/journal.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).find(e => e.type === 'v52-complete').data.dir; return join(d, 'games/A4-70001-human.json'); })()), 'utf8')).rec;
out.routing = {
  'ev-k1.1 (V5 S-REF-68002-human)': playGame(v5.seed, v5.first, { human: w, ai: w }, { detail: true, policy: { human: 'ev-k1.1', ai: 'ev-k1.1' } }).detail!.finalHash === v5.detail.finalHash,
  'ev-k1.2 == V5.2 arm A4 (A4-70001-human)': playGame(v52.seed, v52.first, { human: w, ai: w }, { detail: true, policy53: { human: 'ev-k1.2', ai: 'ev-k1.2' } }).detail!.finalHash === v52.detail.finalHash,
};
log(`routing: ${JSON.stringify(out.routing)}`);
const r = out.evk12 as Record<string, { hiddenRngChanged: number; mirrorPlanMismatch: number; mirrorExecutedMismatch: number; reproducible: number; positions: number; equalToV52ArmA4: number }>;
const oa = out.oa3VsOa2 as { oaV3Ms: { p90: number; max: number } }, sym = out.oa3Symmetry as { mirrorMismatch: number; hiddenRngChanged: number };
out.gates = {
  engineUnchanged: (out.hashes as { engineFiles: string }).engineFiles === 'f92354f4b139d30c',
  evk12: ['consecutive', 'dispersed'].every(k => r[k].hiddenRngChanged === 0 && r[k].mirrorPlanMismatch === 0 && r[k].mirrorExecutedMismatch === 0 && r[k].reproducible === r[k].positions && r[k].equalToV52ArmA4 === r[k].positions),
  oa3Bounded: oa.oaV3Ms.p90 <= 10_000 && oa.oaV3Ms.max <= 30_000, oa3Symmetric: sym.mirrorMismatch === 0 && sym.hiddenRngChanged === 0,
  smoke: (smoke as { replayOk: boolean; agree: string; errors: string[] }[]).every(x => x.replayOk && !x.errors.length && x.agree.split('/')[0] === x.agree.split('/')[1]),
  routing: Object.values(out.routing as Record<string, boolean>).every(Boolean),
};
out.pass = Object.values(out.gates as Record<string, boolean>).every(Boolean);
mkdirSync(join(ROOT, 'evidence/balance/v5_3'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/balance/v5_3/preflight.json'), JSON.stringify(out, null, 2));
log(`gates ${JSON.stringify(out.gates)} -> ${out.pass ? 'PASS' : 'FAIL'}`);
void planPolicy53;

/**
 * V5.1 workstream D (no game played): turn-1 candidate analysis from the start position.
 *   npm run balance:v51:openings -> evidence/balance/v5_1/openings.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { init } from '../server/engine.ts';
import { loadWeights, effectId } from '../server/weights.ts';
import { planTurn11, canonicalPlan } from '../server/balance/v5/evk11.ts';
import { planPolicy, POLICIES } from '../server/balance/v5/policies.ts';
import { scorePlacement11, openingCandidatesV2, BAND } from '../server/balance/v5_1/openings.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const rows: unknown[] = []; let maxValidationError = 0;
for (const seed of [99651, 99652, 99653]) for (const first of ['human', 'ai'] as const) {
  const s = init(seed, { first });
  const ref = planTurn11(s, { me: first, weights: w, temperature: 0 });
  // validation: our scorer reproduces planTurn11's scores for its own candidates
  for (const c of ref.ranked) maxValidationError = Math.max(maxValidationError, Math.abs(scorePlacement11(s, first, c.placement, w).score - c.score));
  const v1 = ref.ranked.map(c => ({ cand: c.placement ? `${effectId(c.placement.effect)}@${c.placement.cells.join(' ')}` : 'none', score: +c.score.toFixed(3), ...(() => { const r = scorePlacement11(s, first, c.placement, w); return { immediate: +r.parts.immediate.toFixed(2), afterReply: +r.parts.afterReply.toFixed(2), overlay: +r.parts.overlay.toFixed(2), moves: r.moves }; })() }));
  const v2 = openingCandidatesV2(s, first, w).map(x => ({ cand: x.pl ? `${effectId(x.pl.effect)}@${x.pl.cells.join(' ')}` : 'none', origin: x.origin, score: +scorePlacement11(s, first, x.pl, w).score.toFixed(3) })).sort((a, b) => b.score - a.score);
  const best = Math.max(v1[0].score, v2[0].score);
  const policies = Object.fromEntries(POLICIES.map(id => [id, canonicalPlan(first, planPolicy(id, s, first, w).chosen).split('|')[0]]));
  rows.push({ seed, first, v1: { candidates: v1.length, ranked: v1, marginTop2: +(v1[0].score - v1[1].score).toFixed(3), withinBand: v1.filter(x => best - x.score <= BAND).length }, v2: { candidates: v2.length, top: v2.slice(0, 8), withinBand: v2.filter(x => best - x.score <= BAND).length, withinBandEffects: [...new Set(v2.filter(x => best - x.score <= BAND).map(x => x.cand.split('@')[0]))], newBestFromV2: v2[0].score > v1[0].score + 1e-9 ? v2[0] : null }, policyChoices: policies });
  log(`seed ${seed} ${first}: v1 ${v1.length} cands (margin ${(v1[0].score - v1[1].score).toFixed(2)}), v2 ${v2.length} cands, within band v1 ${v1.filter(x => best - x.score <= BAND).length} / v2 ${v2.filter(x => best - x.score <= BAND).length}`);
}
writeFileSync(join(ROOT, 'evidence/balance/v5_1/openings.json'), JSON.stringify({ newGamesPlayed: 0, band: BAND, maxValidationError, rows }, null, 2));
log(`written; scorer validation max |error| ${maxValidationError}`);

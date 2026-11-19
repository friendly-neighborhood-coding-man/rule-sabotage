/**
 * Balance Designer V2: corrections derived from hypothesis OUTCOMES (not from anomalies alone), and the
 * independent post-correction adequacy review.
 *
 * Corrections are typed and allowlisted (InterventionSpec). Nothing is applied to production here:
 *   weight      -> may become a promotion PROPOSAL (file under balance/v2/proposals), never written to balance.weights.json
 *   planner     -> REVIEW_REQUIRED: a source change must go through a separately reviewed implementation
 *   game-design -> EXPERIMENTAL_ONLY: stays an experiment-only rule variant until the operator approves a rule change
 *   metric      -> RECORD_ONLY: a revised measurement, with no gameplay claim
 *   none        -> nothing changes (an honest null result never forces a modification)
 */
import { type InterventionSpec, describeSpec } from './interventions.ts';
import { type Evaluation } from './contracts.ts';
import { type Effect } from './metrics.ts';
import { EXPERIMENTS } from './experiments.ts';

export type Category = 'weight' | 'planner' | 'game-design' | 'metric' | 'none';
export type Policy = 'PROPOSAL_ONLY' | 'REVIEW_REQUIRED' | 'EXPERIMENTAL_ONLY' | 'RECORD_ONLY' | 'NO_CHANGE';
export type Correction = {
  id: string; category: Category; policy: Policy; basis: string[]; origin: 'deterministic' | 'kane' | 'kane-test-double';
  spec: InterventionSpec | null; description: string; rationale: string; targets: { metric: string; direction: 'decrease' | 'increase'; minEffect: number }[];
};

/** Deterministic mapping from SUPPORTED hypotheses to candidate corrections. Unsupported hypotheses yield nothing. */
export function proposeCorrections(evals: Evaluation[], max: number): Correction[] {
  const sup = new Set(evals.filter(e => e.outcome === 'SUPPORTED').map(e => e.id));
  const out: Correction[] = [];
  const add = (c: Omit<Correction, 'id' | 'origin'>) => { if (out.length < max) out.push({ ...c, id: `K${out.length + 1}`, origin: 'deterministic' }); };
  const planner = (h: string, exp: string, targets: Correction['targets'], why: string) => add({ category: 'planner', policy: 'REVIEW_REQUIRED', basis: [h], spec: EXPERIMENTS[exp].spec, description: describeSpec(EXPERIMENTS[exp].spec), rationale: why, targets });
  if (sup.has('H5')) planner('H5', 'E5', [{ metric: 'tp_self_benefit', direction: 'decrease', minEffect: 1.0 }], 'The AI should not foresee random outcomes a human cannot; remove RNG foresight from look-ahead.');
  if (sup.has('H2')) planner('H2', 'E2', [{ metric: 'ew_self_trigger_share', direction: 'decrease', minEffect: 0.15 }, { metric: 'tp_self_share', direction: 'decrease', minEffect: 0.15 }], 'Self-boost conveyors come from the planner valuing its own traps; stop valuing that benefit.');
  if (sup.has('H3')) planner('H3', 'E3', [{ metric: 'ew_self_trigger_share', direction: 'decrease', minEffect: 0.15 }], 'Candidate cells are chosen for self-benefit; score candidates by opponent harm and self-harm only.');
  if (sup.has('H4')) add({ category: 'weight', policy: 'PROPOSAL_ONLY', basis: ['H4'], spec: EXPERIMENTS.E1a.spec, description: describeSpec(EXPERIMENTS.E1a.spec), rationale: 'The Teleport prior is miscalibrated against measured consequences.', targets: [{ metric: 'tp_self_share', direction: 'decrease', minEffect: 0.1 }] });
  if (sup.has('H1')) add({ category: 'game-design', policy: 'EXPERIMENTAL_ONLY', basis: ['H1'], spec: EXPERIMENTS.E4.spec, description: describeSpec(EXPERIMENTS.E4.spec), rationale: 'Teleport geometry itself favours activators; a rule change would be needed (operator approval required).', targets: [{ metric: 'tp_per_game', direction: 'decrease', minEffect: 0.3 }] });
  if (!out.length) {
    if (sup.has('H0')) out.push({ id: 'K0', category: 'metric', policy: 'RECORD_ONLY', basis: ['H0'], origin: 'deterministic', spec: null, description: 'Metric correction: judge an effect by its head-to-head marginal impact, not by placement share or the win rate of players who chose it.', rationale: 'The pattern is rational play; the V1 dominance metric mislabels it. No gameplay change is claimed.', targets: [] });
    else out.push({ id: 'K0', category: 'none', policy: 'NO_CHANGE', basis: evals.map(e => e.id), origin: 'deterministic', spec: null, description: 'No correction', rationale: 'No hypothesis was supported, so there is no tested mechanism to correct. Investigate further instead of forcing a change.', targets: [] });
  }
  return out;
}

// ---------------------------------------------------------------- adequacy review
export type ImplVerdict = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type Adequacy = 'SUFFICIENT' | 'PARTIAL' | 'INEFFECTIVE' | 'REGRESSION' | 'UNVERIFIED';
export type Check = { q: string; pass: boolean | null; detail: string };
export type AdequacyConfig = { minUnits: number; maxEntropyDrop: number; maxNewDominantShare: number; maxEffectShareJump: number; maxFirstPlayerEdgeIncrease: number; maxComebackDrop: number; maxTurnsChangeRel: number; maxDrawIncrease: number };
export type Review = {
  correction: string; implementationCorrectness: ImplVerdict; balanceAdequacy: Adequacy; provisionalAdequacy: Exclude<Adequacy, 'UNVERIFIED'> | 'NOT_EVALUATED';
  implementation: Check[]; adequacy: Check[]; unresolved: string[]; nextExperiment: string | null; why: string; kane: { status: string; detail: string };
};
export type ReviewInput = {
  correction: Correction; effects: Record<string, Effect>; control: Record<string, number | null>; treated: Record<string, number | null>;
  manipulation: { ok: boolean; detail: string; divergedGames: number }; invariantsPass: boolean; unrelatedChanged: string[];
  kane: { status: 'AGREES' | 'DISAGREES' | 'UNVERIFIED'; detail: string; real: boolean };
  topEffectShift: { effect: string; before: number; after: number } | null; h2h: Effect | null;
};

const f3 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(3));
/**
 * The reviewer answers two separate questions: A) did the implementation behave as declared? B) did it solve
 * enough of the original problem on fresh seeds? A technically correct fix can still be INEFFECTIVE or PARTIAL.
 * A Kane "implementation is correct" never promotes anything by itself.
 */
export function reviewCorrection(i: ReviewInput, cfg: AdequacyConfig): Review {
  const c = i.correction;
  if (!c.spec) return { correction: c.id, implementationCorrectness: 'UNVERIFIED', balanceAdequacy: 'UNVERIFIED', provisionalAdequacy: 'NOT_EVALUATED', implementation: [], adequacy: [], unresolved: [], nextExperiment: null, why: `${c.category} correction: nothing to execute (${c.policy}).`, kane: { status: 'NOT_ASKED', detail: '' } };
  const impl: Check[] = [
    { q: 'Did the corrected planner/rules actually make different decisions?', pass: i.manipulation.ok, detail: i.manipulation.detail },
    { q: 'Did only the declared component change (no unrelated one)?', pass: i.unrelatedChanged.length === 0, detail: i.unrelatedChanged.length ? `also changed: ${i.unrelatedChanged.join(', ')}` : 'declared component only (static isolation checks + diff)' },
    { q: 'Do the engine invariants still hold?', pass: i.invariantsPass, detail: i.invariantsPass ? 'invariant suite passed' : 'invariant suite FAILED' },
    { q: 'Does browser-observable behaviour match the declared specification (Kane)?', pass: i.kane.status === 'AGREES' && i.kane.real ? true : i.kane.status === 'DISAGREES' && i.kane.real ? false : null, detail: i.kane.real ? i.kane.detail : `not verified by real Kane (${i.kane.detail})` },
  ];
  const implementationCorrectness: ImplVerdict = impl.slice(0, 3).some(x => x.pass === false) || impl[3].pass === false ? 'FAIL' : impl[3].pass === null ? 'UNVERIFIED' : 'PASS';

  const ad: Check[] = [];
  const unresolved: string[] = [];
  let improvedMaterially = 0, improvedSomewhat = 0, robust = true;
  for (const t of c.targets) {
    const e = i.effects[t.metric];
    const sign = t.direction === 'decrease' ? -1 : 1;
    if (!e || e.effect === null || !e.ci) { ad.push({ q: `Did ${t.metric} ${t.direction}?`, pass: null, detail: 'no estimate' }); robust = false; unresolved.push(`${t.metric}: no usable estimate`); continue; }
    const conf = sign < 0 ? e.ci[1] < 0 : e.ci[0] > 0, size = sign * e.effect;
    const material = conf && size >= t.minEffect;
    ad.push({ q: `Did ${t.metric} ${t.direction} materially (≥ ${t.minEffect}) on fresh holdout seeds?`, pass: material, detail: `${f3(e.control)} → ${f3(e.treatment)}, effect ${f3(e.effect)} [${f3(e.ci[0])}, ${f3(e.ci[1])}], ${e.units} seeds` });
    const batchesAgree = e.batches.length === 2 && e.batches.every(b => b !== null && sign * b > 0);
    const sidesAgree = [e.sides.humanFirst, e.sides.aiFirst].every(b => b !== null && sign * b > 0);
    ad.push({ q: `Does the ${t.metric} effect persist in both independent seed batches?`, pass: batchesAgree, detail: `batches ${e.batches.map(f3).join(' / ')}` });
    ad.push({ q: `Does the ${t.metric} effect survive mirrored first-player controls?`, pass: sidesAgree, detail: `Human first ${f3(e.sides.humanFirst)} / AI first ${f3(e.sides.aiFirst)}` });
    if (e.units < cfg.minUnits) { robust = false; unresolved.push(`${t.metric}: only ${e.units} seeds (need ${cfg.minUnits})`); }
    if (material && batchesAgree && sidesAgree) improvedMaterially++;
    else if (conf || size > 0) { improvedSomewhat++; unresolved.push(`${t.metric}: ${material ? 'material but not robust across batches/sides' : `improved ${f3(size)} but below the material threshold ${t.minEffect} or not confident`}`); }
    else unresolved.push(`${t.metric}: no improvement`);
  }
  // health and safety guard-rails
  const d = (k: string) => (i.treated[k] ?? 0) - (i.control[k] ?? 0);
  const regress: string[] = [];
  if ((i.treated.safety_events ?? 0) > 0) regress.push(`safety events ${i.treated.safety_events}`);
  if (!i.invariantsPass) regress.push('engine invariants failed');
  if (-d('effect_entropy') > cfg.maxEntropyDrop) regress.push(`effect diversity fell ${f3(-d('effect_entropy'))}`);
  if ((i.treated.max_effect_share ?? 0) > cfg.maxNewDominantShare) regress.push(`a single effect is ${f3(i.treated.max_effect_share)} of placements`);
  if (i.topEffectShift && i.topEffectShift.after - i.topEffectShift.before > cfg.maxEffectShareJump) regress.push(`new dominant exploit: ${i.topEffectShift.effect} ${f3(i.topEffectShift.before)} → ${f3(i.topEffectShift.after)}`);
  if (Math.abs(i.treated.first_player_edge ?? 0) - Math.abs(i.control.first_player_edge ?? 0) > cfg.maxFirstPlayerEdgeIncrease) regress.push(`first-player edge grew to ${f3(i.treated.first_player_edge)}`);
  if (-d('comeback_rate') > cfg.maxComebackDrop) regress.push(`comebacks fell ${f3(-d('comeback_rate'))}`);
  if (Math.abs(d('turns_mean')) / Math.max(1, i.control.turns_mean ?? 1) > cfg.maxTurnsChangeRel) regress.push(`game length changed ${f3(d('turns_mean'))} turns`);
  if (d('draw_or_limit_rate') > cfg.maxDrawIncrease) regress.push(`draws/turn-limit endings up ${f3(d('draw_or_limit_rate'))}`);
  ad.push({ q: 'Safety preserved (no illegal actions, errors, softlocks; invariants hold)?', pass: (i.treated.safety_events ?? 0) === 0 && i.invariantsPass, detail: `safety events ${i.treated.safety_events ?? 0}` });
  ad.push({ q: 'Strategic diversity preserved and no new dominant exploit?', pass: !regress.some(r => /diversity|single effect|dominant/.test(r)), detail: `entropy ${f3(i.control.effect_entropy)} → ${f3(i.treated.effect_entropy)}; max share ${f3(i.control.max_effect_share)} → ${f3(i.treated.max_effect_share)}${i.topEffectShift ? `; biggest riser ${i.topEffectShift.effect}` : ''}` });
  ad.push({ q: 'Counterplay still possible (comebacks, lead changes)?', pass: !regress.some(r => /comeback/.test(r)), detail: `comeback rate ${f3(i.control.comeback_rate)} → ${f3(i.treated.comeback_rate)}; lead changes ${f3(i.control.lead_changes)} → ${f3(i.treated.lead_changes)}` });
  ad.push({ q: 'Side / first-player balance and game length within tolerance?', pass: !regress.some(r => /first-player|length|draws/.test(r)), detail: `first-player edge ${f3(i.control.first_player_edge)} → ${f3(i.treated.first_player_edge)}; turns ${f3(i.control.turns_mean)} → ${f3(i.treated.turns_mean)}` });
  ad.push({ q: 'More enjoyable, or only closer to a metric?', pass: null, detail: 'NOT MEASURED: no human play data. Proxies only (diversity, counterplay, length). A metric gain is not evidence of more fun.' });
  if (i.h2h) ad.push({ q: 'Strength cost: corrected planner vs control planner head-to-head', pass: null, detail: `treated win rate ${f3(i.h2h.treatment)} (CI ${i.h2h.ci ? `${f3(i.h2h.ci[0] + 0.5)}–${f3(i.h2h.ci[1] + 0.5)}` : '—'}): informational; a weaker AI is a trade-off for the operator, not an automatic failure` });

  let provisional: Review['provisionalAdequacy'];
  let why: string;
  if (regress.length) { provisional = 'REGRESSION'; why = `Unacceptable deterioration: ${regress.join('; ')}`; }
  else if (!i.manipulation.ok || implementationCorrectness === 'FAIL') { provisional = 'INEFFECTIVE'; why = 'The correction did not behave as declared, so any metric change cannot be credited to it.'; }
  else if (c.targets.length && improvedMaterially === c.targets.length && robust) { provisional = 'SUFFICIENT'; why = 'Every target improved materially and robustly on fresh seeds, both batches and both first-player orders, with no guard-rail regression.'; }
  else if (improvedMaterially + improvedSomewhat > 0) { provisional = 'PARTIAL'; why = `Some improvement, but not enough: ${unresolved.join('; ')}`; }
  else { provisional = 'INEFFECTIVE'; why = 'Implemented, but the target did not materially improve.'; }
  const real = i.kane.real && i.kane.status !== 'UNVERIFIED';
  const balanceAdequacy: Adequacy = provisional === 'REGRESSION' ? 'REGRESSION' : !real ? 'UNVERIFIED' : provisional;
  const nextExperiment = provisional === 'PARTIAL' ? nextFor(c, unresolved) : null;
  return { correction: c.id, implementationCorrectness, balanceAdequacy, provisionalAdequacy: provisional, implementation: impl, adequacy: ad, unresolved, nextExperiment, why: balanceAdequacy === 'UNVERIFIED' ? `${why} Final verdict UNVERIFIED: real Kane verification did not complete (${i.kane.detail}).` : why, kane: { status: i.kane.status, detail: i.kane.detail } };
}

function nextFor(c: Correction, unresolved: string[]): string {
  const ew = unresolved.some(u => u.startsWith('ew_'));
  const tp = unresolved.some(u => u.startsWith('tp_'));
  if (c.basis.includes('H2') && ew) return 'Discriminate valuation from search: run E2 and E3 together vs each alone (2×2) on fresh development seeds, instead of strengthening E2.';
  if (c.basis.includes('H5') && tp) return 'Separate foresight from geometry: run E5 under the E4 rule variant (2×2), and split teleport steps by distance-to-goal at activation.';
  if (c.basis.includes('H3')) return 'Measure whether unbiased candidates coincide with self-boost cells: log per-candidate own vs opponent exposure for one batch.';
  return 'Increase independent seeds for the unresolved metric and add the blocking check named in the unresolved list; do not widen the same adjustment.';
}

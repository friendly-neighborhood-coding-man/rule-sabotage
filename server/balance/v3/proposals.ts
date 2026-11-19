/**
 * Balance Designer V3: competing-hypothesis and correction-proposal contracts, the allowlisted experiment catalog
 * (now including starting-rule interventions), provenance, and the correction acceptance gates.
 *
 *  - A proposal is DATA. Its intervention is an id from CATALOG plus a value that must lie inside the catalog's
 *    bounds; toTreatment() turns it into a typed (start config | planner hooks | rule variant | weight edit) for the
 *    real engine and planner. Free text is stored and displayed, never executed or parsed into code.
 *  - Provenance is checked, not trusted (V2 checkProvenance): origin "kane" needs the stored raw kane-cli output,
 *    its sha256 and the note id inside it, from a real (non test-double) kane-cli. Claude, deterministic and
 *    operator proposals are labelled as such and can never claim Kane.
 *  - Combined interventions are refused until EVERY factor has its own registered single-factor result.
 *  - acceptCorrection() is the bar a correction must clear on fresh seeds. Moving a win rate toward 50% is never
 *    enough on its own.
 */
import { createHash } from 'node:crypto';
import { type StartingConfiguration, type RuleVariant, EXPERIMENTAL_START_CONFIG, EXPERIMENTAL_RULE_VARIANT } from '../../engine.ts';
import { type PlannerHooks } from '../../ai.ts';
import { checkProvenance, type Provenance } from '../v2/contracts.ts';
import { validateSpec } from '../v2/interventions.ts';

export type CatalogEntry = { component: 'starting-rules' | 'planner-search' | 'planner-valuation' | 'planner-information' | 'weights' | 'rules'; description: string; bounds: string; production: string; parse: (v: string) => { ok: true; value: unknown } | { ok: false; reason: string } };
const num = (lo: number, hi: number, int = false) => (v: string) => { const x = Number(String(v).trim()); return Number.isFinite(x) && x >= lo && x <= hi && (!int || Number.isInteger(x)) ? { ok: true as const, value: x } : { ok: false as const, reason: `must be ${int ? 'an integer' : 'a number'} in [${lo}, ${hi}]` }; };
export const CATALOG: Record<string, CatalogEntry> = {
  S1_PIECES: { component: 'starting-rules', description: 'Starting pieces for the first mover / second mover (also changes actions per turn and the victory requirement)', bounds: 'first/second, each 2, 3 or 4 (e.g. 3/2)', production: '3/3', parse: v => { const m = /^\s*([234])\s*\/\s*([234])\s*$/.exec(v); return m ? { ok: true, value: { firstMover: +m[1], secondMover: +m[2] } } : { ok: false, reason: 'must be first/second with each 2, 3 or 4' }; } },
  S2_LAYOUT: { component: 'starting-rules', description: 'Home rows of the starting pieces (mirror-symmetric)', bounds: 'spread | center | edge', production: 'spread (rows 2,4,6)', parse: v => (['spread', 'center', 'edge'].includes(v.trim()) ? { ok: true, value: v.trim() } : { ok: false, reason: 'must be spread, center or edge' }) },
  S3_FIRST_TURN_ACTIONS: { component: 'starting-rules', description: 'Cap on the first mover’s actions on turn 1 only', bounds: 'integer 1..3', production: 'no cap (= pieces on board)', parse: num(1, 3, true) },
  S4_SECOND_MOVER_BONUS: { component: 'starting-rules', description: 'Extra actions for the second mover on its first turn only', bounds: 'integer 1..2', production: '0', parse: num(1, 2, true) },
  P1_SEARCH_OWN_BENEFIT: { component: 'planner-search', description: 'PARTIAL reduction of own-benefit in trap-cell search (V2 H3 used 0 and regressed)', bounds: 'factor 0..1 (1 = production, 0 = V2 K1)', production: '1', parse: num(0, 1) },
  P2_SELF_BENEFIT_VALUE: { component: 'planner-valuation', description: 'How much the planner values a piece being helped by its own trap', bounds: 'factor 0..1', production: '1', parse: num(0, 1) },
  P3_BLIND_RNG: { component: 'planner-information', description: 'Planner look-ahead cannot foresee random outcomes (teleport)', bounds: 'true', production: 'false', parse: v => (v.trim() === 'true' ? { ok: true, value: true } : { ok: false, reason: 'only "true"' }) },
  R1_TELEPORT_SAME_COLUMN: { component: 'rules', description: 'Teleport stays in the same column (distance-neutral)', bounds: 'true', production: 'false', parse: v => (v.trim() === 'true' ? { ok: true, value: true } : { ok: false, reason: 'only "true"' }) },
  W1_WEIGHT: { component: 'weights', description: 'One allowlisted V0.3 weight (path=value, at most 30% relative change)', bounds: 'path=value', production: 'balance/balance.weights.json', parse: v => { const m = /^\s*([\w.:]+)\s*=\s*(-?[\d.]+)\s*$/.exec(v); if (!m) return { ok: false, reason: 'must be path=value' }; const bad = validateSpec({ kind: 'weight', path: m[1], value: +m[2] }); return bad.length ? { ok: false, reason: bad.join('; ') } : { ok: true, value: { path: m[1], value: +m[2] } }; } },
};
export const CAUSES: Record<string, string> = { planner: 'The AI planner (how it searches or values moves)', 'starting-rules': 'The starting conditions (piece count, placement, first-turn actions)', interaction: 'The interaction of planner and starting conditions', metric: 'The measurement itself is misleading', 'no-defect': 'Nothing is wrong: it is legitimate play', other: 'Something else' };
export const PROPOSAL_METRICS: Record<string, string> = {
  first_mover_win_rate: 'First-mover win rate (decisive games)', abs_first_mover_edge: 'Distance of first-mover win rate from 50%', human_side_win_rate: 'Human-side win rate',
  more_pieces_side_win_rate: 'Win rate of the side that started with more pieces', mean_turns: 'Mean game length (turns)', turn_limit_rate: 'Share of games reaching the turn limit',
  conveyor_per_game: 'Conveyor moves per game (own trap carries the piece forward)', self_trigger_share: 'Share of triggers on own traps', lead_changes: 'Lead changes per game',
  comeback_rate: 'Share of decisive games won by a side that trailed', effect_entropy: 'Effect diversity (normalized entropy)', unused_cell_rate: 'Share of trap cells never triggered',
  treated_win_rate: 'Head-to-head strength of a changed planner against production',
};

export type Origin = Provenance['origin'];
export type ProposalPrediction = { metric: string; direction: 'increase' | 'decrease' | 'no-change'; minEffect: number };
export type Proposal = {
  schema: 'rule-sabotage/proposal@1'; id: string; kind: 'hypothesis' | 'conclusion'; provenance: Provenance; title: string; cause: string; explanation: string;
  evidenceGames: string[]; predictions: ProposalPrediction[]; intervention: { id: string; value: unknown } | null; sideEffects: string; competing: string;
  counterexample: string | null; acceptance: string; disproof: string; verdict: 'change-justified' | 'no-change-justified' | 'more-evidence-needed' | null; datasetHash: string;
};
const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const sortKeys = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : Array.isArray(v) ? v.map(sortKeys) : v);
export const proposalHash = (p: Proposal) => createHash('sha256').update(JSON.stringify(sortKeys(p))).digest('hex').slice(0, 16);

/**
 * Turn one notebook form body (urlencoded) into a proposal. Returns the problems that make it untestable; a
 * proposal with problems is kept as raw evidence but cannot be registered.
 */
export function parseNotebookEntry(body: string, o: { id: string; provenance: Provenance; gameIds: Set<string>; datasetHash: string }): { proposal: Proposal; problems: string[] } {
  const f = new URLSearchParams(body), g = (k: string, n = 1500) => clip(f.get(k), n).trim();
  const problems: string[] = [];
  const kind = g('entry', 20) === 'conclusion' ? 'conclusion' : 'hypothesis';
  const ids = (s: string) => s.split(/[\s,;]+/).filter(Boolean).slice(0, 20);
  const evidence = ids(g('evidence', 600));
  const unknownGames = evidence.filter(x => !o.gameIds.has(x));
  if (unknownGames.length) problems.push(`unknown game id(s): ${unknownGames.join(', ')}`);
  const preds: ProposalPrediction[] = [];
  for (const i of [1, 2]) {
    const m = g(`p${i}metric`, 40); if (!m) continue;
    if (!PROPOSAL_METRICS[m]) { problems.push(`prediction ${i}: metric ${m} is not listed`); continue; }
    const dir = g(`p${i}dir`, 12) as ProposalPrediction['direction'];
    if (!['increase', 'decrease', 'no-change'].includes(dir)) { problems.push(`prediction ${i}: direction`); continue; }
    const size = Number(g(`p${i}size`, 20));
    if (!(Number.isFinite(size) && size > 0)) { problems.push(`prediction ${i}: needs a positive minimum effect size`); continue; }
    preds.push({ metric: m, direction: dir, minEffect: size });
  }
  let intervention: Proposal['intervention'] = null;
  const iv = g('intervention', 40);
  if (iv && iv !== 'none') {
    const c = CATALOG[iv];
    if (!c) problems.push(`intervention ${iv} is not in the catalog`);
    else { const v = c.parse(g('value', 80)); if (v.ok) intervention = { id: iv, value: v.value }; else problems.push(`intervention ${iv}: value ${v.reason}`); }
  }
  const cause = g('cause', 30);
  if (!CAUSES[cause]) problems.push('cause must be one of the listed options');
  const verdictRaw = g('verdict', 30);
  const verdict = (['change-justified', 'no-change-justified', 'more-evidence-needed'].includes(verdictRaw) ? verdictRaw : null) as Proposal['verdict'];
  const cx = g('counterexample', 60) || null;
  if (cx && !o.gameIds.has(cx)) problems.push(`counterexample ${cx} is not a game id`);
  const p: Proposal = { schema: 'rule-sabotage/proposal@1', id: o.id, kind, provenance: o.provenance, title: g('title', 160), cause, explanation: g('explanation'), evidenceGames: evidence, predictions: preds, intervention, sideEffects: g('sideEffects'), competing: g('competing'), counterexample: cx, acceptance: g('acceptance'), disproof: g('disproof'), verdict, datasetHash: o.datasetHash };
  problems.push(...checkProposal(p));
  return { proposal: p, problems: [...new Set(problems)] };
}

/** Structural checks: a hypothesis must be falsifiable (prediction with size), grounded (games) and challengeable. */
export function checkProposal(p: Proposal): string[] {
  const out: string[] = [];
  if (p.schema !== 'rule-sabotage/proposal@1') out.push('schema');
  if (!p.title) out.push('title missing');
  if (p.kind === 'hypothesis') {
    if (p.explanation.length < 20) out.push('explanation too short to be a hypothesis');
    if (!p.evidenceGames.length) out.push('no game ids cited as evidence');
    if (!p.predictions.length) out.push('no falsifiable prediction (metric + direction + size)');
    if (!p.competing) out.push('no competing explanation');
    if (p.cause !== 'no-defect' && p.cause !== 'metric' && !p.intervention) out.push('a defect hypothesis needs an intervention from the catalog to test it');
  } else if (!p.verdict) out.push('a conclusion needs a verdict');
  out.push(...checkProvenance(p.provenance));
  return out;
}

export type Treatment = { start?: StartingConfiguration; hooks?: PlannerHooks; variant?: RuleVariant; weight?: { path: string; value: number }; component: CatalogEntry['component']; factors: string[] };
/** Typed treatment for one or more catalog interventions. Combinations need a prior single-factor result for every factor. */
export function toTreatment(ivs: { id: string; value: unknown }[], singleFactorResults: Set<string> = new Set()): { ok: true; treatment: Treatment } | { ok: false; reason: string } {
  if (!ivs.length) return { ok: false, reason: 'no intervention' };
  if (ivs.length > 1) {
    const missing = ivs.filter(i => !singleFactorResults.has(i.id)).map(i => i.id);
    if (missing.length) return { ok: false, reason: `combined interventions need a registered single-factor result for each factor first (missing: ${missing.join(', ')})` };
    if (new Set(ivs.map(i => i.id)).size !== ivs.length) return { ok: false, reason: 'duplicate factor' };
  }
  const t: Treatment = { component: CATALOG[ivs[0].id]?.component ?? 'rules', factors: ivs.map(i => i.id) };
  let start: StartingConfiguration = { id: 'T', experimental: EXPERIMENTAL_START_CONFIG, pieces: { firstMover: 3, secondMover: 3 }, layout: 'spread' };
  let usesStart = false;
  for (const iv of ivs) {
    const c = CATALOG[iv.id];
    if (!c) return { ok: false, reason: `intervention ${iv.id} is not in the catalog` };
    const v = c.parse(typeof iv.value === 'object' && iv.value && 'firstMover' in iv.value ? `${(iv.value as { firstMover: number }).firstMover}/${(iv.value as { secondMover: number }).secondMover}` : typeof iv.value === 'object' && iv.value && 'path' in iv.value ? `${(iv.value as { path: string }).path}=${(iv.value as { value: number }).value}` : String(iv.value));
    if (!v.ok) return { ok: false, reason: `${iv.id}: ${v.reason}` };
    switch (iv.id) {
      case 'S1_PIECES': start = { ...start, pieces: v.value as StartingConfiguration['pieces'] }; usesStart = true; break;
      case 'S2_LAYOUT': start = { ...start, layout: v.value as StartingConfiguration['layout'] }; usesStart = true; break;
      case 'S3_FIRST_TURN_ACTIONS': start = { ...start, firstTurnActions: v.value as number }; usesStart = true; break;
      case 'S4_SECOND_MOVER_BONUS': start = { ...start, secondMoverFirstTurnBonus: v.value as number }; usesStart = true; break;
      case 'P1_SEARCH_OWN_BENEFIT': t.hooks = { ...t.hooks, searchOwnBenefitFactor: v.value as number }; break;
      case 'P2_SELF_BENEFIT_VALUE': t.hooks = { ...t.hooks, selfBenefitFactor: v.value as number }; break;
      case 'P3_BLIND_RNG': t.hooks = { ...t.hooks, blindRng: true }; break;
      case 'R1_TELEPORT_SAME_COLUMN': t.variant = { id: 'teleport-same-column', experimental: EXPERIMENTAL_RULE_VARIANT, teleport: 'same-column' }; break;
      case 'W1_WEIGHT': t.weight = v.value as { path: string; value: number }; break;
    }
  }
  if (usesStart) t.start = { ...start, id: ivs.map(i => i.id.split('_')[0]).join('-') };
  return { ok: true, treatment: t };
}

/**
 * Correction acceptance gates, judged on FRESH seeds (never the 100 screening games). Every gate must pass.
 * `control` and `treated` are per-condition summaries computed the same way (analysis.ts conditionStats).
 */
export type GateInput = {
  targetMetric: { control: number; treated: number; ci95OfDifference: [number, number]; direction: 'increase' | 'decrease'; minEffect: number };
  intendedBehaviourChanged: boolean;
  meanTurns: { control: number; treated: number }; turnLimitRate: { control: number; treated: number };
  firstMoverEdge: { control: number; treated: number };
  entropy: { control: number; treated: number }; comebackRate: { control: number; treated: number }; leadChanges: { control: number; treated: number };
  safety: { illegal: number; errors: number; softlocks: number }; independentSeeds: boolean;
};
export const GATES = { maxLengthGrowth: 1.25, maxTurnLimitIncrease: 0.1, maxEdgeWorsening: 0.05, maxEntropyDrop: 0.1, maxComebackDrop: 0.1, maxLeadChangeDrop: 0.25 };
export function acceptCorrection(g: GateInput) {
  const t = g.targetMetric, signed = t.direction === 'increase' ? t.treated - t.control : t.control - t.treated;
  const ciLow = t.direction === 'increase' ? t.ci95OfDifference[0] : -t.ci95OfDifference[1];
  const gates = [
    { id: 'behaviour', pass: g.intendedBehaviourChanged, text: 'the intended behaviour actually changed (manipulation check)' },
    { id: 'target', pass: signed >= t.minEffect && ciLow > 0, text: `target metric moved the predicted way by at least ${t.minEffect} and the 95% interval of the difference excludes 0` },
    { id: 'length', pass: g.meanTurns.treated <= g.meanTurns.control * GATES.maxLengthGrowth && g.turnLimitRate.treated <= g.turnLimitRate.control + GATES.maxTurnLimitIncrease, text: `game length stays acceptable (mean at most +${Math.round((GATES.maxLengthGrowth - 1) * 100)}%, turn-limit rate at most +${GATES.maxTurnLimitIncrease * 100} points)` },
    { id: 'fairness', pass: g.firstMoverEdge.treated <= g.firstMoverEdge.control + GATES.maxEdgeWorsening, text: 'fairness does not deteriorate (first-mover edge)' },
    { id: 'diversity', pass: g.entropy.treated >= g.entropy.control - GATES.maxEntropyDrop, text: 'strategy diversity stays acceptable' },
    { id: 'counterplay', pass: g.comebackRate.treated >= g.comebackRate.control - GATES.maxComebackDrop && g.leadChanges.treated >= g.leadChanges.control * (1 - GATES.maxLeadChangeDrop), text: 'counterplay stays acceptable (comebacks, lead changes)' },
    { id: 'safety', pass: g.safety.illegal === 0 && g.safety.errors === 0 && g.safety.softlocks === 0, text: 'safety invariants pass (no illegal move, engine error or softlock)' },
    { id: 'independent', pass: g.independentSeeds, text: 'judged on independent fresh seeds, not on the screening games' },
  ];
  return { accepted: gates.every(x => x.pass), gates, note: 'A correction is never accepted only because a win rate moved toward 50%.' };
}

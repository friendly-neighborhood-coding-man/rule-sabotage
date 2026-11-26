/**
 * GW2 Extension V1: a fresh MATCHED comparison, PREPARED and NOT EXECUTABLE (D134).
 *
 *   control   : no hypothesis feedback
 *   treatment : deterministic hypothesis–observation (H↔O) feedback, output C agent-facing (feedback.ts)
 *
 * Everything except that one factor is a single shared object, used by reference in both arms: the evidence (one new
 * generation, partition manifests bound by the pre-registration), the byte-identical objective texts of both phases,
 * the representation requirement, the revision opportunity (a second phase after freeze-1, with the same page shell),
 * the resource budgets, the CLI pin and the specification policy (hidden from the agent in both arms). Output B
 * (unmatched actions, specification-derived) and the other two operator outputs are computed for the operator in both
 * arms and are never served. The historical P7 sessions stay a baseline RECORD; they are not either arm.
 * executable is false and the paid gate is 'disabled'. Running it needs a written operator authorization, an external
 * pre-registration filled from this plan (docs/gw2/EXTENSION_V1_MATCHED_COMPARISON_DRAFT.md) and a scoped gate commit.
 */
import { createHash } from 'node:crypto';
import { P7_EXPECTED_CLI_VERSION } from '../p7-plan.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const OBJECTIVE_PHASE_1 = [
  'You are investigating a two-player board game whose rules are not shown. Open the page at the given URL.',
  'It shows observations of builds of the game: scripted playtests (each step shows the state before and after and every event the game reported) and games between two computer players.',
  'Infer which rules the game appears to follow, and where builds behave differently. Open case and match pages as needed.',
  'For each rule you infer, open hypothesis.html and submit one form: a plain statement, your confidence, the case or match ids you relied on, and the structured representation described on that page. A hypothesis without a structured representation cannot be checked against the observations. You may submit competing hypotheses, and you may abstain on questions you cannot settle.',
  'Report only what the observations support. Submit at most 8 forms.',
].join(' ');
export const OBJECTIVE_PHASE_2 = [
  'You are continuing the same investigation. Open the page at the given URL, then open revision.html.',
  'It lists the hypotheses you submitted, and it may list recorded observations that differ from what your structured hypotheses predict.',
  'For each of your hypotheses you may keep it, submit a revision (a new form that names the hypothesis it revises), or withdraw it by submitting an abstention. Your original submissions are kept in every case.',
  'Report only what the observations support. Submit at most 8 revision forms.',
].join(' ');

export const SHARED = Object.freeze({
  evidence: Object.freeze({ generation: 'one new frozen generation and partition, created before the first session', partitions: Object.freeze(['discovery', 'heldout', 'spec', 'eval']),
    agentVisible: Object.freeze(['discovery']), binding: 'every partition MANIFEST.json sha256 listed in the external pre-registration; identical bytes for both arms', finalHeldout: 'sealed before the first session, opened once after freeze-2 of the last session' }),
  objectives: Object.freeze({ phase1: OBJECTIVE_PHASE_1, phase1Sha256: sha(OBJECTIVE_PHASE_1), phase2: OBJECTIVE_PHASE_2, phase2Sha256: sha(OBJECTIVE_PHASE_2) }),
  representationRequirement: 'a structured representation is requested on every hypothesis, in both phases; the form keeps free text and abstention, and a hypothesis without one is reported as not machine-evaluable',
  revisionOpportunity: Object.freeze({ when: 'phase 2, a separate call after freeze-1 (hypotheses and representations frozen and externally anchored)', page: 'revision.html with the same shell in both arms: the session\'s own hypotheses and a feedback section', actions: Object.freeze(['keep', 'revise (new node, relation "revises")', 'withdraw (abstention node)']), originalsKept: true }),
  budgets: Object.freeze({ phase1: Object.freeze({ maxSteps: 80, timeoutS: 2700, forms: 8 }), phase2: Object.freeze({ maxSteps: 40, timeoutS: 1350, forms: 8 }), feedbackItemsListedPerHypothesis: 25 }),
  cli: Object.freeze({ name: 'kane-cli', version: P7_EXPECTED_CLI_VERSION }),
  specification: Object.freeze({ shownToAgent: false, servedPages: 'none: the spec partition is never in a served site; operator outputs carry the operator-only marker and blindSiteProblems must be empty before every session' }),
  operatorOutputs: Object.freeze(['A how the game actually works', 'B unmatched actions (specification–observation)', 'C hypothesis contradictions']),
  inputsForFeedback: 'the authenticated pre-evaluation graph prefix at freeze-1 only (anchored.ts); never a later node',
});

export const MANIPULATED = ['hypothesisFeedback'] as const;
export const ARMS = Object.freeze({
  control: Object.freeze({ arm: 'control', shared: SHARED, hypothesisFeedback: Object.freeze({ shown: false, section: 'revision.html feedback section reads: "No observation list is provided in this session."' }) }),
  treatment: Object.freeze({ arm: 'treatment', shared: SHARED, hypothesisFeedback: Object.freeze({ shown: true, section: 'revision.html feedback section lists the deterministic H↔O items (feedback.ts), discovery evidence only, capped per hypothesis' }) }),
});

/** Differences between two arm definitions outside the manipulated factor (empty = matched). */
export function unmatchedFactors(a: any, b: any, path = ''): string[] {
  if (path === '' ) { const strip = (x: any) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'arm' && !(MANIPULATED as readonly string[]).includes(k))); return unmatchedFactors(strip(a), strip(b), '.'); }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return Object.is(a, b) ? [] : [path];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.flatMap(k => unmatchedFactors(a[k], b[k], `${path === '.' ? '' : path}.${k}`));
}

export const HISTORICAL_BASELINE = { record: 'evidence/gw2/p7-pilot (P7 pilot, 3 sessions)', role: 'historical baseline record, kept unchanged; not a matched control (different evidence, no revision phase)' };
export const PLAN_V1 = Object.freeze({
  schema: 'gamewatch/gw2-ext-matched-comparison-plan@1', executable: false as const, gate: 'disabled', arms: ARMS, manipulated: MANIPULATED, historicalBaseline: HISTORICAL_BASELINE,
  assignment: 'sessions alternate control/treatment in a randomized order from a seed recorded in the pre-registration; calls per arm fixed in advance by the operator (Q8); no re-runs after results are seen',
  measures: ['proportion of hypotheses kept, revised, withdrawn (per arm)', 'discovery fit of revisions', 'final held-out accuracy and coverage, original vs revised, paired per hypothesis', 'C readings before and after', 'revisions that move away from the evidence', 'new errors introduced by revisions', 'counterexample classes: already exemplified in accessible discovery vs absent from discovery'],
  claims: 'no improvement claim unless the pre-registered control vs treatment comparison supports it; with few sessions per arm the result is a case comparison and is reported as one',
  requires: ['written operator authorization', 'external pre-registration (Q14) filled from this plan', 'separate scoped gate commit for the run ids', 'AGENT_FEEDBACK_ENABLED = true in a reviewed commit, for the treatment run ids only'],
});

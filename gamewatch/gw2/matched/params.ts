/**
 * GW2 matched comparison: pre-registered parameters (operator, GW2_EXTENSION_V1_APPROVED, 2026-11-26 07:38 UTC; D136-D145).
 * PREPARED, NOT EXECUTABLE: neither the paid gate nor AGENT_FEEDBACK_ENABLED is changed by anything here.
 */
import { OBJECTIVE_PHASE_1 } from '../ext/comparison-plan.ts';
import { FEEDBACK_CAP } from '../ext/feedback-core.ts';
import { P7_EXPECTED_CLI_VERSION } from '../p7-plan.ts';
import { createHash } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const ARMS = ['control', 'treatment'] as const;
export type Arm = typeof ARMS[number];
export type Phase = 1 | 2;

/**
 * Phase-2 objective of the matched comparison (final preflight, item 4). The V1 draft objective ("continuing the same
 * investigation", ext/comparison-plan.ts, kept unchanged as history) assumed the second call remembers the first. A
 * separate Kane call does not: this objective says so, and revision.html carries the complete frozen phase-1
 * submissions. Identical bytes in both arms.
 */
export const OBJECTIVE_PHASE_2_MATCHED = [
  'This is a new, separate call in an investigation of a two-player board game whose rules are not shown. You have no memory of the earlier call; do not assume any.',
  'Open the page at the given URL, then open revision.html. It lists, in full, every form submitted in the earlier call of this investigation: each statement, confidence, cited evidence, structured representation (or that none was given) and abstention. It may also list recorded observations that differ from what those structured hypotheses predict.',
  'The observation pages and hypothesis.html are the same as in the earlier call. For each listed hypothesis you may keep it (do nothing), submit a revision (a new form whose "Revises" field names its H-number), or withdraw it (an abstention whose "Revises" field names its H-number). Forms that name no H-number are new hypotheses. The earlier submissions are kept in every case.',
  'Report only what the observations support. Submit at most 8 forms.',
].join(' ');

export const MATCHED = Object.freeze({
  id: 'gw2-matched-1',
  sessionsPerArm: Object.freeze({ control: 5, treatment: 5 }),
  seed: 20261126,
  blockSize: 2, // balanced blocks: one control and one treatment session per block, order randomized per block
  phases: Object.freeze({
    1: Object.freeze({ maxSteps: 80, timeoutS: 2700, forms: 8, ceilingCredits: 300, objective: OBJECTIVE_PHASE_1, objectiveSha256: sha(OBJECTIVE_PHASE_1) }),
    2: Object.freeze({ maxSteps: 40, timeoutS: 1350, forms: 8, ceilingCredits: 150, objective: OBJECTIVE_PHASE_2_MATCHED, objectiveSha256: sha(OBJECTIVE_PHASE_2_MATCHED) }),
  }),
  callsTotal: 20,
  estimateCreditsPerStep: 3.1, // the existing preflight estimate (steps x 3.1), a local estimate and not a cap
  researchThresholdCredits: 4000,
  priorResearchCredits: 132.043, // P7 pilot, by balance delta: the threshold is cumulative over GW2 research calls
  accounting: 'balance delta',
  retries: 0, parallelPaidCalls: false, creditPurchases: false,
  ceilingsAreHardCaps: false,
  feedback: Object.freeze({ cap: FEEDBACK_CAP, evidence: Object.freeze(['discovery']), arm: 'treatment', phase: 2 }),
  specificationShownToAgent: false,
  cli: Object.freeze({ name: 'kane-cli', version: P7_EXPECTED_CLI_VERSION }),
  procedures: Object.freeze({ generation: 'evidence/gw2/procedures/generation-matched-2.json', partition: 'evidence/gw2/procedures/partition-matched-2.json' }),
  evidence: 'evidence/gw2/matched-evidence-2', // the experiment evidence: never read by tests or dry runs before the single opening
  devEvidence: 'evidence/gw2/matched-evidence',
  /** spec encoding for the C readings (three-way "accurate description of a defect"), read only after the single opening */
  encoding: 'gamewatch/gw2/spec-encodings/rule-sabotage-v6.1.json',
  /** a call is complete only with exit 0, no timeout and a VALID run_end (p7-exec.ts runFacts().runEnd.valid) */
  completeCall: 'exitCode 0, not timed out, run_end present and valid', // matched-generation-1: development and dry-run dataset (its held-out was read in a dry run)
});

export const estimate = (phase: Phase) => Math.round(MATCHED.phases[phase].maxSteps * MATCHED.estimateCreditsPerStep * 10) / 10;

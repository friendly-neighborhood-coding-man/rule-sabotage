/**
 * GW2 matched comparison: pre-registered parameters (operator, GW2_EXTENSION_V1_APPROVED, 2026-11-26 07:38 UTC; D136-D145).
 * PREPARED, NOT EXECUTABLE: neither the paid gate nor AGENT_FEEDBACK_ENABLED is changed by anything here.
 */
import { OBJECTIVE_PHASE_1, OBJECTIVE_PHASE_2 } from '../ext/comparison-plan.ts';
import { FEEDBACK_CAP } from '../ext/feedback-core.ts';
import { P7_EXPECTED_CLI_VERSION } from '../p7-plan.ts';
import { createHash } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const ARMS = ['control', 'treatment'] as const;
export type Arm = typeof ARMS[number];
export type Phase = 1 | 2;

export const MATCHED = Object.freeze({
  id: 'gw2-matched-1',
  sessionsPerArm: Object.freeze({ control: 5, treatment: 5 }),
  seed: 20261126,
  blockSize: 2, // balanced blocks: one control and one treatment session per block, order randomized per block
  phases: Object.freeze({
    1: Object.freeze({ maxSteps: 80, timeoutS: 2700, forms: 8, ceilingCredits: 300, objective: OBJECTIVE_PHASE_1, objectiveSha256: sha(OBJECTIVE_PHASE_1) }),
    2: Object.freeze({ maxSteps: 40, timeoutS: 1350, forms: 8, ceilingCredits: 150, objective: OBJECTIVE_PHASE_2, objectiveSha256: sha(OBJECTIVE_PHASE_2) }),
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
  devEvidence: 'evidence/gw2/matched-evidence', // matched-generation-1: development and dry-run dataset (its held-out was read in a dry run)
});

export const estimate = (phase: Phase) => Math.round(MATCHED.phases[phase].maxSteps * MATCHED.estimateCreditsPerStep * 10) / 10;

/**
 * Prepared, NOT executable: a fresh matched no-notification control for a later comparative experiment (D128).
 *
 * The historical P7 sessions are kept as a baseline record, but they are not this control: a comparison needs fresh
 * sessions on byte-identical new evidence. Both arms get the same objective, the same representation requirement, the
 * same revision opportunity (a revision window after a first freeze) and the same budgets; the ONLY manipulated factor
 * is whether hypothesis–observation feedback (output C, agent-facing) is shown in that window. Specification-derived
 * notifications (output B) are operator-only in every arm and never shown to the agent.
 * executable is false and the paid gate is 'disabled'; running this needs its own authorization and pre-registration.
 */
import { OBJECTIVE_P7, P7_MAX_STEPS, P7_TIMEOUT_S, P7_EXPECTED_CLI_VERSION } from '../p7-plan.ts';

export const REVISION_WINDOW = 'After freeze-1 the session may submit revisions (new nodes "revises", originals kept) or abstentions; nothing is edited.';
const common = {
  objective: OBJECTIVE_P7,
  representationRequirement: 'structured representation requested on every hypothesis (form unchanged: free text and abstention stay possible)',
  revisionOpportunity: REVISION_WINDOW,
  budgets: { maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S, formsPerSession: 8, revisionsPerSession: 8 },
  cli: { name: 'kane-cli', version: P7_EXPECTED_CLI_VERSION },
  evidence: 'one new frozen generation and partition, byte-identical for both arms; final held-out sealed before the first session and opened once',
  specificationShownToAgent: false,
  operatorUnmatchedActions: 'computed for the operator in every arm; never served to the agent',
};
export const MANIPULATED = ['agentHypothesisFeedback'] as const;
export const ARMS = {
  control: { ...common, agentHypothesisFeedback: 'none: the revision window opens with no feedback page' },
  feedback: { ...common, agentHypothesisFeedback: 'output C agent-facing page (discovery or feedback partition only), served after freeze-1 and logged' },
};
export const HISTORICAL_BASELINE = { record: 'evidence/gw2/p7-pilot (P7 pilot, 3 sessions)', role: 'historical baseline record, kept unchanged; not a matched control (different evidence, no revision window)' };
export const PLAN = { executable: false as const, gate: 'disabled', arms: ARMS, manipulated: MANIPULATED, historicalBaseline: HISTORICAL_BASELINE,
  assignment: 'interleaved in time, order randomized with a recorded seed; calls per arm fixed in advance by the operator (Q8)', requires: ['written operator authorization', 'external pre-registration (Q14)', 'separate scoped gate commit'] };

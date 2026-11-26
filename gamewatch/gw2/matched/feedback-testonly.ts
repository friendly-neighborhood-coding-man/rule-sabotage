/**
 * TEST ONLY (D138): session feedback for the test-double pipeline, without activation. Marked testOnly; the pipeline
 * accepts it only with a test-double runner, and the runtime path (matched/feedback.ts) never imports this module.
 */
import { constructSessionFeedback } from './feedback.ts';
export const sessionFeedbackForTest = (evidence: string, run: string, rec: string, session: string) => ({ ...constructSessionFeedback(evidence, run, rec, session), testOnly: true as const });

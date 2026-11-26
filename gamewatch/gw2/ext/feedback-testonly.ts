/**
 * TEST ONLY (D131): builds agent-facing feedback from authenticated inputs without any activation, for tests and offline
 * review. The result is marked `testOnly: true`; the runtime path (feedback.ts) refuses to serve it, and feedback.ts
 * never imports this module (checked in tests/gw2-ext-v1.test.ts).
 */
import { agentFeedbackCore, agentInputs, renderAgentFeedback, type AgentFeedback, type AgentPartition } from './feedback-core.ts';

export function buildFeedbackForTest(exp: string, o: { session: string; partitions?: AgentPartition[]; rec?: string }): AgentFeedback & { testOnly: true } {
  const x = agentInputs(exp, o);
  return { ...agentFeedbackCore(x.mine, x.sits, x.parts, o.session), partitionsRead: [...x.reads].sort(), graphPrefix: x.graphPrefix, testOnly: true };
}
export const previewForTest = (f: AgentFeedback) => renderAgentFeedback(f, '<p class="banner">TEST ONLY: not served to any session.</p>');

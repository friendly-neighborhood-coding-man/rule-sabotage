/**
 * Balanced-block randomization of arm order (D141). Seed 20261126, blocks of two: every block holds one control and one
 * treatment session; the order inside block b is treatment-first when the first byte of sha256("<seed>:block:<b>") is
 * odd. Sessions run strictly one after another (no parallel paid calls), each as phase 1 then phase 2.
 * Deterministic: the same seed always gives the same schedule; it is recorded in the pre-registration.
 */
import { createHash } from 'node:crypto';
import { MATCHED, type Arm, type Phase } from './params.ts';

export type Slot = { order: number; block: number; session: string; arm: Arm; runs: Record<Phase, string> };

export function schedule(seed = MATCHED.seed, perArm = MATCHED.sessionsPerArm): Slot[] {
  if (perArm.control !== perArm.treatment) throw new Error('balanced blocks of two need equal arm sizes');
  const out: Slot[] = [];
  for (let b = 1; b <= perArm.control; b++) {
    const first = createHash('sha256').update(`${seed}:block:${b}`).digest()[0];
    const arms: Arm[] = first % 2 ? ['treatment', 'control'] : ['control', 'treatment'];
    for (const arm of arms) {
      const order = out.length + 1, session = `M${String(order).padStart(2, '0')}`;
      out.push({ order, block: b, session, arm, runs: { 1: `GW2-${session}-P1`, 2: `GW2-${session}-P2` } });
    }
  }
  return out;
}

/** The runs that may receive feedback: exactly the phase-2 runs of treatment sessions (plan.agentFeedback.runs). */
export const feedbackRuns = (s = schedule()) => s.filter(x => x.arm === 'treatment').map(x => ({ runId: x.runs[2], session: x.session, arm: 'treatment' as const, phase: 2 }));

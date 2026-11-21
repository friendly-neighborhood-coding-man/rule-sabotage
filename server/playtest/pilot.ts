/**
 * Counterbalanced pilot schedule (docs/PLAYTEST_PILOT_PROTOCOL.md). Each participant plays all three opponents once.
 * Opponent order: the 6 permutations of the 3 opponents, each used by 2 participants (12 participants = 2 full rounds).
 * First mover: alternates within a participant (human, AI, human or AI, human, AI); the two participants who share an
 * order start with opposite first movers, so within every order each opponent is met once as first and once as second
 * mover. Seeds are fixed per slot (82000 + 10 x participant + slot), outside the holdout 65001–65060.
 */
import type { Player } from '../rules.ts';
import type { Policy53 } from '../balance/v5_3/policies.ts';
import { isHoldout } from './session.ts';

const OPP: Policy53[] = ['ev-k1.2', 'softmax-v2', 'oa-v3'];
const PERMS: Policy53[][] = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0], [1, 0, 2]].map(p => p.map(i => OPP[i]));
export const PILOT_SIZE = 12;
export type Slot = { slot: number; opponent: Policy53; first: Player; seed: number };
export type PilotPlan = { participant: string; order: number; slots: Slot[] };

export const participantCode = (i: number) => `P${String(i + 1).padStart(2, '0')}`;
export function pilotPlan(i: number): PilotPlan {
  const order = Math.floor(i / 2) % PERMS.length, start: Player = i % 2 === 0 ? 'human' : 'ai';
  const slots = PERMS[order].map((opponent, k) => {
    const seed = 82000 + 10 * (i + 1) + (k + 1);
    if (isHoldout(seed)) throw new Error('pilot seed in holdout');
    return { slot: k + 1, opponent, first: (k % 2 === 0 ? start : start === 'human' ? 'ai' : 'human') as Player, seed };
  });
  return { participant: participantCode(i), order: order + 1, slots };
}
export const pilotSchedule = (n = PILOT_SIZE) => Array.from({ length: n }, (_, i) => pilotPlan(i));
export function planFor(code: string): PilotPlan | null {
  const m = /^P(\d{2})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i >= 0 && i < 99 ? pilotPlan(i) : null;
}

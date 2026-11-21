/**
 * V6 experimental opponents (EXPERIMENTAL-V6-NOT-PRODUCTION). Separately versioned adapters of the three frozen V5.3
 * policies: the decision code is the generated fork in server/v6/forks/ (scripts/v6-fork.ts lists every difference),
 * running on the 13x9 V6 engine. They are NOT the V5.3 policies and no V5.3 result (win rates, first-mover rates,
 * latency, referee block rates) applies to them.
 *
 * Differences from the frozen references, all mechanical: (1) the V6 engine (13x9 board, rule A1); (2) three hard-coded
 * 7x7 geometry constants replaced by board-derived ones; (3) the path-cost memo key made unambiguous for 2-digit
 * columns. Rule A1 needs NO change in the policies: every candidate-cell generator they use draws from the engine's
 * eligibleCells, which already excludes the protected squares, so they never propose a forbidden effect. When no cell is
 * eligible for an effect, that effect is simply not a candidate; "no effect" is always a candidate.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { POLICIES53, OA3, type Policy53 } from './forks/policies53.ts';

export type OpponentV6 = { id: string; policy: Policy53; label: string; version: string; frozenReference: string; description: string; slow: boolean };
export const OPPONENTS_V6: Record<string, OpponentV6> = {
  'v6-ev-k1.2': { id: 'v6-ev-k1.2', policy: 'ev-k1.2', label: 'EV-K1.2 (V6)', version: 'v6-ev-k1.2@1', frozenReference: 'ev-k1.2 (V5.3)', slow: false, description: 'Expected-value planner, adapted to the 13x9 board. Cannot see the hidden random state.' },
  'v6-softmax-v2': { id: 'v6-softmax-v2', policy: 'softmax-v2', label: 'Softmax-v2 (V6)', version: 'v6-softmax-v2@1', frozenReference: 'softmax-v2 (V5)', slow: false, description: 'Samples among its four best turn plans, so it varies more between games.' },
  'v6-oa-v3': { id: 'v6-oa-v3', policy: 'oa-v3', label: 'OA-v3 (V6)', version: 'v6-oa-v3@1', frozenReference: 'oa-v3 (V5.3)', slow: true, description: `Pessimistic search (assumes one of your strongest replies), work budget ${OA3.budgetSims.toLocaleString('en')} simulations. Can take several seconds.` },
};
export const isOpponentV6 = (x: unknown): x is string => typeof x === 'string' && Object.hasOwn(OPPONENTS_V6, x);
export { POLICIES53 };
const FILES = ['./engine.ts', './forks/policies53.ts', './forks/evk11.ts', './forks/evplanner.ts', './forks/ai.ts', './forks/planner52.ts', './forks/policies5.ts', './forks/ablation.ts', './forks/stream.ts'];
/** Content hash of the V6 opponent code actually running (engine + forks), LF-normalised. */
export const v6CodeHash = () => { const h = createHash('sha256'); for (const f of FILES) h.update(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')); return h.digest('hex').slice(0, 16); };

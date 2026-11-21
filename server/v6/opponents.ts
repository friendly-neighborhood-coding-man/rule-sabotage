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

export type OpponentV6 = { id: string; policy: Policy53; label: string; version: string; frozenReference: string; description: string; slow: boolean; adapter?: 'referee-aware-select@1' | 'latency-bounded@1'; pilotDefault?: boolean; experimentalPrototype?: boolean };
export const OPPONENTS_V6: Record<string, OpponentV6> = {
  'v6-ev-k1.2': { id: 'v6-ev-k1.2', policy: 'ev-k1.2', label: 'EV-K1.2 (V6)', version: 'v6-ev-k1.2@1', frozenReference: 'ev-k1.2 (V5.3)', slow: false, description: 'Expected-value planner, adapted to the 13x9 board. Cannot see the hidden random state.' },
  'v6-softmax-v2': { id: 'v6-softmax-v2', policy: 'softmax-v2', label: 'Softmax-v2 (V6)', version: 'v6-softmax-v2@1', frozenReference: 'softmax-v2 (V5)', slow: false, description: 'Samples among its four best turn plans, so it varies more between games.' },
  'v6-oa-v3': { id: 'v6-oa-v3', policy: 'oa-v3', label: 'OA-v3 (V6)', version: 'v6-oa-v3@1', frozenReference: 'oa-v3 (V5.3)', slow: true, description: `Pessimistic search (assumes one of your strongest replies), work budget ${OA3.budgetSims.toLocaleString('en')} simulations. Can take several seconds.` },
};
/**
 * V6.2: the same three policies behind the referee-aware selection adapter (server/v6/referee-aware.ts). Separately
 * versioned (-ra@1); the policies' ranking is unchanged, only the choice among their ranked plans when the top plan's
 * effect would not be placed by the referee. The v6-*@1 opponents above are not changed.
 */
for (const o of Object.values({ ...OPPONENTS_V6 })) {
  const id = `${o.id}-ra`;
  OPPONENTS_V6[id] = { ...o, id, label: o.label.replace(' (V6)', ' (V6, referee-aware)'), version: o.version.replace('@1', '-ra@1'), adapter: 'referee-aware-select@1', description: `${o.description} Referee-aware: if its chosen effect would not be placed by the referee, it plays its next-ranked plan instead (at most 3 referee pre-checks per turn).` };
}
/**
 * V6.3: latency-bounded prototype (server/v6/budgeted.ts), separately versioned -ra-b@1. NOT promoted: offered as an
 * experimental prototype only. V6.3 pilot defaults (operator decision D3): the three -ra@1 opponents.
 */
for (const base of ['v6-ev-k1.2', 'v6-softmax-v2', 'v6-oa-v3']) {
  const o = OPPONENTS_V6[base], id = `${base}-ra-b`;
  OPPONENTS_V6[id] = { ...o, id, label: o.label.replace(' (V6)', ' (V6, referee-aware, 8 s deadline, PROTOTYPE)'), version: o.version.replace('@1', '-ra-b@1'), adapter: 'latency-bounded@1', slow: false, experimentalPrototype: true, description: `${o.description} Prototype: plans for up to 8 s; past that the planner is stopped and it plays no new effect, moving with the shared move executor. Recorded every time.` };
  OPPONENTS_V6[`${base}-ra`].pilotDefault = true;
}
export const PILOT_DEFAULT_OPPONENTS = Object.values(OPPONENTS_V6).filter(o => o.pilotDefault).map(o => o.id);
export const isOpponentV6 = (x: unknown): x is string => typeof x === 'string' && Object.hasOwn(OPPONENTS_V6, x);
export { POLICIES53 };
const FILES = ['./engine.ts', './forks/policies53.ts', './forks/evk11.ts', './forks/evplanner.ts', './forks/ai.ts', './forks/planner52.ts', './forks/policies5.ts', './forks/ablation.ts', './forks/stream.ts'];
/** Content hash of the V6 opponent code actually running (engine + forks), LF-normalised. */
export const v6CodeHash = () => { const h = createHash('sha256'); for (const f of FILES) h.update(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')); return h.digest('hex').slice(0, 16); };

/** Runs one V6 opponent decision off the main thread (EXPERIMENTAL-V6-NOT-PRODUCTION). Network disabled. */
import { parentPort } from 'node:worker_threads';
import { planPolicy53, type Policy53 } from './forks/policies53.ts';
import { loadWeights } from '../weights.ts';
import type { State } from './engine.ts';
import type { Player } from '../rules.ts';

const W = loadWeights();
globalThis.fetch = (() => Promise.reject(new Error('network disabled in the V6 planner'))) as typeof fetch;
parentPort!.on('message', (m: { id: number; policy: Policy53; state: State; me: Player }) => {
  try { parentPort!.postMessage({ id: m.id, ok: true, plan: planPolicy53(m.policy, m.state, m.me, W) }); }
  catch (e) { parentPort!.postMessage({ id: m.id, ok: false, error: (e as Error).message }); }
});

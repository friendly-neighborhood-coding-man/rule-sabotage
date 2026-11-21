/**
 * Runs one opponent decision off the main thread, so the playtest server can keep answering (and the page can show a live
 * "thinking" timer) while OA-v3 searches. The decision itself is the unchanged V5.3 planPolicy53 call; the hidden RNG is
 * masked inside every policy, so passing the full state reveals nothing to it.
 */
import { parentPort } from 'node:worker_threads';
import { planPolicy53, type Policy53 } from '../balance/v5_3/policies.ts';
import { loadWeights } from '../weights.ts';
import type { State } from '../engine.ts';
import type { Player } from '../rules.ts';

const W = loadWeights();
// Defence in depth: a planner never needs the network.
globalThis.fetch = (() => Promise.reject(new Error('network disabled in the playtest planner'))) as typeof fetch;

parentPort!.on('message', (m: { id: number; policy: Policy53; state: State; me: Player }) => {
  try {
    const t0 = performance.now();
    const plan = planPolicy53(m.policy, m.state, m.me, W);
    const wallMs = Math.round(performance.now() - t0);
    parentPort!.postMessage({ id: m.id, ok: true, plan: { chosen: plan.chosen, candidates: plan.candidates, sims: plan.sims, meta: plan.meta, ranked: plan.ranked.slice(0, 6).map(c => ({ id: c.id, summary: c.summary, score: c.score })) }, wallMs });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, ok: false, error: (e as Error).message });
  }
});

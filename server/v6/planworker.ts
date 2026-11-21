/** Runs one V6 opponent decision off the main thread (EXPERIMENTAL-V6-NOT-PRODUCTION). Network disabled. */
import { parentPort } from 'node:worker_threads';
import { planPolicy53, type Policy53 } from './forks/policies53.ts';
import { selectRefereeAware, type RAMemo } from './referee-aware.ts';
import { withFastClone } from './fastclone.ts';
import { loadWeights } from '../weights.ts';
import type { State } from './engine.ts';
import type { Player } from '../rules.ts';

const W = loadWeights();
globalThis.fetch = (() => Promise.reject(new Error('network disabled in the V6 planner'))) as typeof fetch;
const memos = new Map<string, RAMemo>(); // referee-aware adapter: one repeat-suppression memo per game
parentPort!.on('message', (m: { id: number; policy: Policy53; state: State; me: Player; adapter?: string; gameId?: string }) => {
  try {
    // the state arrives as the planning view (turn.ts); the fast State copy keeps every decision identical (tests/v6-2.test.ts)
    let plan = withFastClone(() => planPolicy53(m.policy, structuredClone(m.state), m.me, W));
    if (m.adapter === 'referee-aware-select@1') {
      const key = m.gameId ?? 'none'; if (!memos.has(key)) { memos.set(key, new Map()); if (memos.size > 50) memos.delete(memos.keys().next().value!); }
      plan = selectRefereeAware(m.state, m.me, plan, memos.get(key)!);
    }
    parentPort!.postMessage({ id: m.id, ok: true, plan });
  }
  catch (e) { parentPort!.postMessage({ id: m.id, ok: false, error: (e as Error).message }); }
});

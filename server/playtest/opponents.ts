/**
 * Human playtest opponents (PLAYTEST-ONLY, never used by the production game in server/game.ts).
 *
 * The three opponents are the frozen V5.3 self-play policies, unchanged. Each one is identified by its policy id,
 * a playtest version string, and the implementation hashes of the code that actually runs, checked at startup against
 * the hashes frozen in balance/v5_3/journal.ndjson before the V5.3 games. If the code differs, the opponent is
 * labelled MODIFIED in the interface and in every telemetry record; it is never silently substituted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { POLICIES53, OA3, policies53Hash, type Policy53 } from '../balance/v5_3/policies.ts';
import { implementationHashes } from '../balance/v5_3/run.ts';

export const PLAYTEST_MODE = 'PLAYTEST-ONLY-NOT-PRODUCTION' as const;
export const PLAYTEST_SCHEMA = 'rule-sabotage/playtest@1' as const;

export type Opponent = {
  id: Policy53; label: string; version: string; experimental: true; slow: boolean;
  description: string; latencyNote: string;
};

/** Measured in V5.3 (180 self-play games, docs/BALANCE_V5_3_POLICY_RELIABILITY.md) and re-derived by scripts/playtest-latency-audit.ts. */
export const OPPONENTS: Record<Policy53, Opponent> = {
  'ev-k1.2': {
    id: 'ev-k1.2', label: 'EV-K1.2', version: 'ev-k1.2 (V5.3 frozen reference)', experimental: true, slow: false,
    description: 'Expected-value planner: averages over every possible teleport landing, cannot see the hidden random state, small seeded randomness at near-ties.',
    latencyNote: 'Usually well under a second per turn.',
  },
  'softmax-v2': {
    id: 'softmax-v2', label: 'Softmax-v2', version: 'softmax-v2 (V5 policy, unchanged)', experimental: true, slow: false,
    description: 'Samples among its four best-scoring turn plans (softmax, temperature 1.3255), so it varies more between games.',
    latencyNote: 'Usually well under a second per turn.',
  },
  'oa-v3': {
    id: 'oa-v3', label: 'OA-v3', version: 'oa-v3 (V5.3 bounded opponent-aware search)', experimental: true, slow: true,
    description: 'Pessimistic search: assumes you will answer with one of your strongest replies. EXPERIMENTAL and can be SLOW.',
    latencyNote: `Can take several seconds per turn (self-play max 18.5 s). Its work budget of ${OA3.budgetSims.toLocaleString('en')} simulations is checked before each candidate, so one decision can run past it.`,
  },
};

type Frozen = { engine: string; plannerFiles: string; v53: string; all: string };
/** The hashes frozen before the V5.3 games (journal entry #1, 'v53-preregistered'). */
export function frozenV53(): Frozen {
  const line = readFileSync(fileURLToPath(new URL('../../balance/v5_3/journal.ndjson', import.meta.url)), 'utf8').split('\n')[0];
  return (JSON.parse(line) as { data: { implementation: Frozen } }).data.implementation;
}

export type Integrity = { frozen: Frozen; current: Frozen; policiesFile: string; matches: boolean; mismatched: string[] };
let cached: Integrity | null = null;
export function integrity(): Integrity {
  if (cached) return cached;
  const frozen = frozenV53(), current = implementationHashes() as Frozen;
  const mismatched = (Object.keys(frozen) as (keyof Frozen)[]).filter(k => frozen[k] !== current[k]);
  cached = { frozen, current, policiesFile: policies53Hash(), matches: mismatched.length === 0, mismatched };
  return cached;
}

export function opponentInfo(id: Policy53) {
  const o = OPPONENTS[id], i = integrity();
  return { ...o, implementation: { all: i.current.all, v53: i.current.v53, engine: i.current.engine, policiesFile: i.policiesFile, matchesFrozenV53: i.matches }, ...(id === 'oa-v3' ? { bounds: { ...OA3 } } : {}) };
}
export const isPolicy = (x: unknown): x is Policy53 => typeof x === 'string' && (POLICIES53 as string[]).includes(x);
export { POLICIES53 };

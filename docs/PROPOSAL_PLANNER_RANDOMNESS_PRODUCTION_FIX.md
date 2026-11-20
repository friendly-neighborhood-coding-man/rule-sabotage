# Proposal: production fix for the planner's seed mixing (not applied)

**Status: PROPOSAL ONLY.** No production code was changed, nothing is deployed. Needs an explicit operator decision.

## Problem

The live planner (`server/ai.ts` `planTurn`) draws its tie-breaking noise and its temperature roll from
`rng((s.seed ^ Math.imul(s.turn + 7, 0x9e3779b1)) >>> 0)`, a single xorshift32 step from a lightly mixed seed. The V5.2 audit
(`evidence/balance/v5_2/audit.json`) measured, over 20,000 seeds:

* consecutive seeds: correlation 1.0 between adjacent seeds' first draws; standard deviation 0.004 inside 30-seed blocks
  (uniform: 0.289);
* every seed set: correlation −0.87 between the first draw at turn t and at turn t+1;
* dispersed seeds: the first-draw distribution itself is fine (χ² 6.0).

Live games use `Date.now() & 0x7fffffff` as the seed, so games started close in time get near-identical planner randomness,
and within one game the AI's random choices on consecutive turns are strongly anti-correlated. Players will not see a
"bug", but the AI's variety is lower than intended. Analytics and replays of real games inherit the same pattern.

## Proposed change

1. Add `plannerStream(seed, turn, role, purpose)`: a counter-based SHA-256 stream as in `server/balance/v5_2/stream.ts`, with
   separate purposes for planning noise and the temperature roll, and the mover's role relative to the first player. It is
   public data only, never the engine RNG. Deterministic, so replay stays exact.
2. Keep the legacy stream available under a planner version flag. Every game record stores its planner version.
3. Bump `ENGINE_HASH` / the referee cache key (planner behaviour changes; the referee rollout uses the planner).

## Replay and version compatibility

* The engine and its RNG are unchanged, so every stored game still replays move by move through the engine (replays never
  call the planner).
* Re-planning a stored game (planner-identity checks) must use the planner version recorded with it. Games without a version
  field are legacy.
* Kane referee cache: entries keyed on the old `ENGINE_HASH` simply stop matching (cache miss, no wrong verdict).

## Staged rollout

1. Offline: the new stream behind the version flag; the existing tests plus a replay-identity test for legacy-version games;
   audit statistics as in V5.2.
2. Offline comparison of legacy vs new planner on fresh seeds (small, preregistered), so that game length and win rates are
   known before players see it.
3. Opt-in on the live server via an environment flag, recording the planner version in every game.
4. Default on after review; legacy kept for replay checks.

Rollback: switch the flag off; no data migration is needed.

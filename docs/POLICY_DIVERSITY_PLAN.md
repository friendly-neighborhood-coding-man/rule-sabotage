# Policy-diversity evaluation: preparation

**Status: READY_FOR_OPERATOR_POLICY_DIVERSITY_REVIEW.** Preparation only. **No new game was played** (the only games
re-executed are already-recorded V4.2 reference games, to prove the reference is unchanged). Holdout 65001–65060
untouched. 0 Kane calls, 0 external calls. Nothing promoted, merged or deployed.

Goal: find out whether the balance patterns seen so far survive a change of the policy that generates the observations.
Patterns that do not survive describe a policy, not the rules.

## 1. Frozen reference

`balance/v5/reference.json`: EV + K1 (`ev-teleport-v4.1`, `{ sideRelativeOrder: true }`), hashes identical to the V4.2
preregistration (engine `f92354f4…`, planner files `a87d4d49…`, EV planner `3af55720…`, commit `827fce2`). Its
300-game evidence (`5083708e86c91217`) and the HK1 / HK2 / HK3 verdicts are preserved unchanged. `selfplay.ts` gained a
per-side `policy` option; a test re-executes recorded V4.2 game K1-66002-human through it to the identical final hash.

**Finding, for your decision:** the frozen reference is not perfectly mirror-symmetric. While building the new policies I
found three remaining tie sources, and the reference still has all three:

| Tie source | Where | Effect |
|---|---|---|
| equal-value trap cells chosen in board-key order | `ai.ts` `bestCells` | the same position and its mirror can get different trap cells |
| equal-value end states ordered by a description without piece homes | `evplanner.ts` reply strata (K1 path) | non-equivalent states can tie |
| expected values that differ only by the engine's ~1e-9 law quirk for destination index 0 | `evplanner.ts` `greedyEV` | real ties broken by board order of destinations |

Measured: 0 of 40 positions in the broad check, 1 of 4 in a synthetic test set (same plan, different score). It is rare,
but "mirror symmetry is mandatory" is not strictly met by the frozen reference. Options: (a) keep the reference frozen and
report this residual next to every result; (b) freeze `ev-k1.1` = reference + the three fixes (needs its own equivalence
and manipulation checks). I have not changed the reference.

## 2. Two new policies (`server/balance/v5/policies.ts`, experiment-only)

| | `oa-v1` opponent-aware search | `softmax-v1` uncertainty-aware Top-k softmax |
|---|---|---|
| Decision rule | **maximin**: for each candidate placement, enumerate the end states of our own move phase (exact over teleports, up to 8 rank strata), let the opponent answer with **every** placement option (or none) plus its greedy moves, and assume the answer that is worst for us | softmax over the reference's top 4 candidates with temperature T = 1.33 = half the reference reply model's measured prediction error (2.651, V4.2 manipulation check); options below 2% are dropped |
| Different from the reference | pessimistic, adversarial opponent model including placements; no immediate/reply blend, no overlay, no temperature; its own candidate set | treats score gaps smaller than the planner's known error as genuine uncertainty and explores them |
| Randomness | none (deterministic) | sampled from a stream seeded only by the public game seed, turn and policy label |
| Moves | reference EV executor with K1 (re-plans after teleports) | same |
| Cost per decision (this PC, checks) | about 3 s | about 1–3 s |

Symmetry work needed to make `oa-v1` meet the requirement: a side-relative copy of the trap-cell search (`symBestCells`,
identical to production except for exact ties), piece homes in the state description, count-based strata instead of
floating-point probability-mass strata, and a greedy loop and sorts that treat values within 1e-7 as ties broken by the side-relative order (`greedySym`). The executor for moves in games stays the reference executor, so its residual (§1) is shared by all policies.

## 3. Mandatory requirements (no games): `npm run balance:v5:checks`

`evidence/balance/v5/policy-checks.json`: 20 recorded positions (V4.2 dataset, new sampling offset) + 20 synthetic
positions; each policy plans the position, its mirror, and the position with two other hidden RNG states.

| Policy | Mirror mismatches (40) | Hidden-RNG changes (40 x 2 RNG states) | Decisions different from the reference | Distinct turn-1 placements from the start position (30 seeds x 2 first movers, side-relative) | ms per decision |
|---|---|---|---|---|---|
| ev-k1 (reference) | 0 (but 1 of 4 in the separate synthetic test set, see §1) | 0 | — | **1** | ~330 |
| softmax-v1 | 0 | 0 | 11 of 40 | **4** | ~370 |
| oa-v1 | **0** (after four symmetry fixes; earlier runs showed 1) | 0 | 22 of 40 | 1 | ~2,500 |

Decision probes from the start position used seeds 67901–67930 (planner calls only, no game). The softmax policy is the only
one that varies its opening; the opponent-aware policy changes 22 of 40 mid-game decisions but still opens deterministically.

Full default `npm test`: **155/155** (`evidence/balance/v4/test-runs/v5-prep-parallel-1.log`). Tests (`tests/policies-v5.test.ts`): reference reproduces a recorded game; softmax and OA symmetric and hidden-RNG-invariant
on a separate synthetic set; the reference's residual recorded explicitly (1 of 4); softmax bounded and normalised;
`symBestCells` equals the production search except for ties.

## 4. Metrics (`server/balance/v5/metrics.ts`)

* **Mover balance and role symmetry**: first-mover and Human-side decisive win rates, Wilson 95% **and** an
  opening-cluster bootstrap (games grouped by their first two turns, side-relative). V4.2 showed that a deterministic
  policy repeats the same opening in every game, so seeds are not independent openings; the cluster interval is the honest
  one for balance claims.
* **Strategic diversity**: distinct two-turn openings, opening entropy, effective openings 2^H, largest opening share,
  placement signatures, normalised effect entropy.
* **Competitive strength**: Bradley–Terry log-strength relative to the reference from cross-play (bootstrap 95%) and
  pairwise win rates.
* **Length**: mean, median, 90th percentile, turn-limit rate, draws. **Counterplay**: lead changes, comebacks.
  **Opening patterns**: opening frequency tables, turn-2 captures. **Integrity**: illegal moves, errors, softlocks,
  replays, teleport foresight.

## 5. Proposed protocol (not authorised, not run): `balance/v5/policy-diversity-protocol.json`

300 games on fresh seeds: self-play for each policy (60 each, seeds 68001–68030 × both first movers) and a cross-play round
robin (40 per pair, seeds 68031–68040, each policy on each side and each first-mover order). About 30–45 minutes with 6
workers, 0 Kane, 0 external calls. Frozen before any game (protocol sha256, policy hash, reference hashes, check results).

Decision rules, written to keep policy conclusions apart from rule conclusions:

* **Policy level**: each policy's own mover/role edges, length and diversity; these describe that policy.
* **Validity for rule claims**: a policy counts only if its self-play shows at least 3 effective openings. The reference
  alone would likely fail this (1 turn-1 placement per side from the start position).
* **Survival**: a pattern is a **rule-level candidate** only if every valid policy's opening-cluster interval lies beyond
  ±0.05 in the same direction; **policy-specific** if one valid policy shows it and another excludes it; otherwise
  inconclusive (also when fewer than 2 policies are valid). Long games use the turn-limit rate in the same way.
* Strength is reported next to the balance numbers, not used as a gate.
* Even a surviving pattern is about engine-based self-play, not about human players.

## 6. What I need from you

1. Approve (or change) the 300-game protocol and seeds 68001–68040.
2. Decide the reference question: keep the frozen `ev-k1` with its documented residual, or freeze `ev-k1.1` with the three
   symmetry fixes.
3. Holdout 65001–65060 stays reserved until a later decision.

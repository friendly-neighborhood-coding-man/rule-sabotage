# Balance Designer V3: independent critical review (of the 100-game screen)

> Follow-up: the Kane call and the 240-game validation, with their own assessment, are in [BALANCE_V3_VALIDATION_RESULT.md](BALANCE_V3_VALIDATION_RESULT.md).

Written against the evidence, not the plan. Verdicts: PASS, PARTIAL, FAIL, NOT_TESTED. Completing 100 games is
not evidence of balanced gameplay, and this review does not treat it as such.

| # | Question | Verdict |
|---|---|---|
| 1 | Was the 100-game experiment executed correctly? | **PASS** |
| 2 | Is the dataset complete and reproducible? | **PASS** |
| 3 | Did the experiment expose meaningful starting-condition differences? | **PARTIAL** |
| 4 | Are the findings statistically reliable? | **FAIL** (still weak) |
| 5 | Can Kane actually investigate the accumulated evidence? | **NOT_TESTED** |
| 6 | Can the system distinguish strategy problems from starting-rule problems? | **PARTIAL** |
| 7 | Can it design experiments that might lead to an effective correction? | **PARTIAL** |
| 8 | Is the balancing process still limited to detecting problems and rejecting fixes? | **PARTIAL** (yes, still, in practice) |

## 1. Execution: PASS

Exactly 100 games from a hashed matrix, run once from a clean commit (`4e98d29`), 0 external calls counted in all
seven threads, 0 Kane credits, 0 illegal actions, errors or softlocks, 100/100 engine replays and 5/5 planner re-runs
identical. The run-once rule held (registry + journal).

What a sceptic should still know:
* Derived files (analysis, pages) were rebuilt twice after the run, both journalled: a findings-text bug, and an
  added turn-1 measure I chose after looking at replays. The games were not touched (dataset hash unchanged), but
  the turn-1 measure is a post-hoc metric and is labelled as such in HC4/HC5.
* After the run I added one planner hook (`normalizedEval`, catalog P4). It is inactive unless passed, identical to
  production at 3 v 3 (tested), and the screen's own planner hash refers to commit `4e98d29`.
* The guard proves no outbound call happened in Node. It cannot prove anything about other processes on the PC,
  which the batch never starts (child processes are blocked too).
* The planner re-run check covers 5 of 100 games; the other 95 are covered by the engine-only replay, which proves
  the record is internally consistent, not that the planner would choose the same moves again. Since the planner is
  deterministic (no `Math.random` path is reachable at noise 0) and 5/5 matched, the risk is low but not zero.

## 2. Dataset: PASS

Summaries plus full turn-by-turn records (board, RNG, ranked candidates with the chosen one, placements, moves,
engine events, end-of-turn events, final state hash) for every game, with a manifest, a dataset hash that excludes
derived pages, a hash-chained journal and an append-only registry. `balance:v3:verify` re-checks everything.
Limits: only tested on Windows / Node 24.22; the records are about 12 MB per 100 games, which will need a
compression or sharding decision once datasets accumulate.

## 3. Starting-condition differences: PARTIAL

Clear: piece count changes game length (C1 2/2 mean 9.45 turns, 95% CI 7.6–11.3; C2 4/4 mean 18.9, 12.0–25.8).
Suggestive: C4 (2/3) first mover 17/20 and the side with more pieces 3/20 in C4, against 10/20 in C3. The
mirror pair C3/C4 points the same way as "the side with fewer pieces to bring across does well", but C3 alone shows
nothing. Behavioural differences (trigger mix, conveyor squares, decision margins) are small next to their noise.
Because piece count changes pieces, actions and the victory requirement together, none of these can be attributed
to piece count as such.

## 4. Statistical reliability: FAIL

Only two results survive their own test: the pooled first-mover rate (64/100, p 0.007) and C4 (17/20, p 0.003;
still below 0.05 after a five-way Bonferroni correction, 0.015). Neither survives the more relevant checks: the
across-condition permutation test (p 0.243) and the seed-paired comparison with C0 (p 0.227). All other per-condition
rates have intervals of about ±20 points. Conditions share seeds, the two games of a seed are correlated, and the
hypotheses were written after looking at the same games. These are leads, not findings.

## 5. Kane: NOT_TESTED

The dossier (overview, conditions, trajectories, patterns, counterexamples, all 100 replays, limitations, a
separate V2 page, catalog, notebook) is built and browser-readable without scripts; the notebook accepts multiple
hypotheses, predictions with sizes, catalog interventions, counterexamples, acceptance tests and a "no change is
justified" conclusion; provenance is enforced. All of that is proven only with the **test double**
(`npm run test:balance-v3-e2e`), whose entries are fixed scripts. Whether Kane can navigate 100 replay pages within
a step budget, cite real games correctly and design a discriminating experiment is unknown. V2's one real run
produced one hypothesis in 25 steps; this dossier is larger.

## 6. Strategy versus starting rules: PARTIAL

The instruments now exist: starting-rule interventions (S1–S4) and planner interventions (P1–P4) in one catalog,
a hook that is neutral at 3 v 3 but changes evaluation under unequal counts (P4), and registered hypotheses whose
predictions differ under the same arm (HC1 vs HC2 under P4; HC4 vs HC5 under P3). Nothing has been run that
actually separates them, so the capability is designed, not demonstrated.

## 7. Experiment design towards an effective correction: PARTIAL

V3 replaces V2's single all-or-nothing correction with bounded alternatives (P1 at 0.5, S3 turn-1 cap, S4 bonus,
P3, P4, R1), refuses combinations until each factor has its own result, and judges corrections with explicit gates
(length +25% max, which V2's K1 would fail; fairness, diversity, counterplay, safety, independence; "closer to 50%"
alone never passes). The fresh-seed protocol (validation, correction comparison, sealed holdout) is written with
seed ranges and budgets. None of it has run, and the gates' thresholds are judgement calls that have not been
calibrated against human play.

## 8. Still only detecting and rejecting? PARTIAL

In practice, yes: V3 detected candidate problems (trap-riding dominates movement; turn-1 teleport scores; a
possible 2/3 first-mover edge) and tested no fix. What changed is that the next step can now produce a positive
result: corrections are graded rather than binary, starting rules are in scope, and the acceptance rule says what a
good change must look like rather than only what a bad one looks like.

## What remains insufficient

1. No hypothesis has been tested on fresh seeds; every V3 claim is exploratory.
2. 20 games per condition cannot detect first-mover effects under about 25 points.
3. Kane's investigative and experiment-design ability is still unproven; only the interface is.
4. Self-play of one planner against itself is the only player model. "Conveyor belts are a problem" is a
   gameplay-quality judgement the data cannot make; it needs a human view (is riding your own traps fun?).
5. The decision-margin metric is dominated by win/loss scores (±1000) and is not informative as reported.
6. Piece count, actions per turn and victory requirement are confounded in S1; separating them would need a
   new catalog entry (for example a fixed action allowance), which does not exist yet.

## Recommendation

Run `V3-VALIDATE` arms A–D (240 offline games, fresh seeds 62101–62130, 0 Kane) as described in
`docs/BALANCE_V3_RESULT.md`, after an optional approved Kane research run on the dossier so that Kane's own
hypotheses are registered first. Do not change production settings on the basis of this screen.

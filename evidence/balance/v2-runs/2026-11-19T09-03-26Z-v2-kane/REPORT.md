# Balance Designer V2 run 2026-11-19T09-03-26Z-v2-kane

**Mode:** run-kane · **Checkpoint:** CAPABILITY_LIMITATION: the exploration call did not run (credit balance check failed (kane-cli balance unavailable); no call without a verified balance). The Kane experiment stops here; no further Kane calls, no retry without operator approval. Evidence and recording are preserved. READY_FOR_OPERATOR_V2_RESULT_REVIEW

Commit 4a904894c25747385a440da8fbaf96e8815469af · engine 5b79cac132ecdfbd · weights 0.3.0#ddcf941c285bd537 · 0 games · Kane calls 0/4 · credits 0

## Observation (V1 evidence, read-only)

cycle-1/baseline-training-games.ndjson sha256 6d1f600e5ad61b43… matches the V1 manifest. Teleport self-trigger share 0.879, east/west shove self-trigger share 0.885, teleport benefit to the activator 3.414 squares, conditional win rate of Teleport users 0.520 (descriptive only).

## Kane exploration

NOT_RUN: credit balance check failed (kane-cli balance unavailable); no call without a verified balance

## Hypotheses (pre-registered) and outcomes

| Id | Origin | Title | Outcome | Kane | Why |
|---|---|---|---|---|---|

SUPPORTED means the pre-registered predictions held on these development seeds, not that the mechanism is proven.

## Experiments (real engine, real planner)

| Condition | Factor changed | Seeds | Games | Manipulation check | tp_self_share | ew_self_trigger_share | tp_self_benefit | safety |
|---|---|---|---|---|---|---|---|---|

## Corrections and adequacy review

## Decision

not reached


## Kane calls

- KX1 exploration: skipped (credit balance check failed (kane-cli balance unavailable); no call without a verified balance)

## Limitations

- Divergence between control and treatment games is detected from placements, triggers and outcome; move-only differences are not logged.
- Seed-level bootstrap intervals assume seeds are exchangeable; with 16 development seeds an effect needs to be large to be called.
- The planner's heuristic path cost (basePenalty) still assumes production teleport geometry under the E4 rule variant.
- Enjoyment is not measured. Health proxies only.

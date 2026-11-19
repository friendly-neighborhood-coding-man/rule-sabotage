# Balance Designer V2 run 2026-11-19T11-35-00Z-v2-kane

**Mode:** run-kane · **Checkpoint:** READY_FOR_OPERATOR_V2_RESULT_REVIEW

Commit ebcc04bba31f755822af5a36ec89ce0e28344f74 · engine 5b79cac132ecdfbd · weights 0.3.0#ddcf941c285bd537 · 386 games · Kane calls 3/4 · credits 54.336

## Observation (V1 evidence, read-only)

cycle-1/baseline-training-games.ndjson sha256 6d1f600e5ad61b43… matches the V1 manifest. Teleport self-trigger share 0.879, east/west shove self-trigger share 0.885, teleport benefit to the activator 3.414 squares, conditional win rate of Teleport users 0.520 (descriptive only).

## Kane exploration

OK: 1 valid notebook note(s) submitted by the browser agent during a complete kane-cli run

## Hypotheses (pre-registered) and outcomes

| Id | Origin | Title | Outcome | Kane | Why |
|---|---|---|---|---|---|
| H0 | operator | No actionable defect: self-boosting is rational play | **REFUTED** | AGREES | primary prediction contradicted: P0a (effect 0.063 [95% CI -0.063, 0.188], material = 0.08) |
| H1 | operator | Intrinsic rule geometry favours forward progress | **INCONCLUSIVE** | AGREES | P1b: unclear (too few underlying events (10 < 20); an interval over so few events is not judged) |
| H2 | operator | Planner exploitation through its own valuation | **REFUTED** | AGREES | primary prediction contradicted: P2a (effect 0.016 [95% CI -0.051, 0.087], material = 0.15); P2b (effect 0.029 [95% CI -0.065, 0.120], material = 0.15) |
| H3 | operator | Placement search bias towards self-beneficial cells | **SUPPORTED** | AGREES | every primary and discriminating prediction held on these seeds (support, not proof) |
| H4 | operator | Valuation or calibration error in the V0.3 weights | **INCONCLUSIVE** | NOT_ASKED | P4a: unclear (effect 0.010 [95% CI -0.087, 0.103], material = 0.1); P4b: contradicted (effect 0.013 [95% CI -0.027, 0.053], material = 0.1) |
| H5 | claude | The planner foresees 'random' teleport destinations | **REFUTED** | AGREES | primary prediction contradicted: P5b (effect 0.000 [95% CI 0.000, 0.000], material = 0.1) |
| HK1 | kane | Kane: The V0.3 prior/blend misvalues Teleport: it assigns -0.80 although triggered pie | **INCONCLUSIVE** | AGREES | HK1a: unclear (effect 0.010 [95% CI -0.087, 0.103], material = 0.1); HK1b: unclear (effect 0.010 [95% CI -0.087, 0.103], material = 0.1) |

SUPPORTED means the pre-registered predictions held on these development seeds, not that the mechanism is proven.

## Experiments (real engine, real planner)

| Condition | Factor changed | Seeds | Games | Manipulation check | tp_self_share | ew_self_trigger_share | tp_self_benefit | safety |
|---|---|---|---|---|---|---|---|---|
| C0/selfplay/development | control: V0.3 weights, production planner, production rules | development | 32 | OK: control | 0.882 | 0.889 | 4.268 | 0 |
| E1a/selfplay/development | weights only: featureUtilityToActivator.teleport = 3.4 | development | 32 | OK: 19/32 games diverged from their control game (median first divergence turn 5) | 0.893 | 0.843 | 4.000 | 0 |
| E1b/selfplay/development | weights only: weightMix = 0 | development | 32 | OK: 31/32 games diverged from their control game (median first divergence turn 4) | 0.834 | 0.902 | 3.843 | 0 |
| E2/head-to-head/development | planner valuation only: benefit from own-installed traps × 0 | development | 32 | OK: treated planner on both sides and both first-player orders; hooks recorded on every game: true | 0.879 | 0.880 | 4.141 | 0 |
| E2/selfplay/development | planner valuation only: benefit from own-installed traps × 0 | development | 32 | OK: 30/32 games diverged from their control game (median first divergence turn 3) | 0.912 | 0.905 | 4.142 | 0 |
| E3/selfplay/development | planner placement search only: own-piece benefit no longer makes a cell a candidate | development | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 1) | 0.814 | 0.714 | 3.800 | 0 |
| E4/selfplay/development | EXPERIMENTAL RULE VARIANT: teleport destination = random empty square in the same column | development | 32 | OK: 6 teleports, 0 changed the distance to goal; variant tag on every game: true | 0.500 | 0.897 | 0.000 | 0 |
| E5/head-to-head/development | planner information only: look-ahead uses a perturbed RNG copy (cannot foresee teleport destinations) | development | 32 | OK: treated planner on both sides and both first-player orders; hooks recorded on every game: true | 0.844 | 0.863 | 3.333 | 30 |
| E5/selfplay/development | planner information only: look-ahead uses a perturbed RNG copy (cannot foresee teleport destinations) | development | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 1) | 0.878 | 0.831 | 2.806 | 88 |
| C0/selfplay/holdout | control: V0.3 weights, production planner, production rules | holdout | 32 | OK: control | 0.943 | 0.873 | 4.119 | 0 |
| K1/selfplay/holdout | planner placement search only: own-piece benefit no longer makes a cell a candidate | holdout | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 1) | 0.835 | 0.612 | 3.980 | 0 |
| K1/head-to-head/holdout | planner placement search only: own-piece benefit no longer makes a cell a candidate | holdout | 32 | OK: treated planner on both sides and both first-player orders; hooks recorded on every game: true | 0.854 | 0.798 | 3.957 | 0 |

## Corrections and adequacy review

### K1: planner (REVIEW_REQUIRED) — planner placement search only: own-piece benefit no longer makes a cell a candidate

Basis: H3 (deterministic). Candidate cells are chosen for self-benefit; score candidates by opponent harm and self-harm only.

**Implementation correctness:** PASS · **Balance adequacy:** REGRESSION (provisional, before Kane: REGRESSION)

Unacceptable deterioration: first-player edge grew to 0.210; game length changed 12.594 turns; draws/turn-limit endings up 0.187

- ✔ Did the corrected planner/rules actually make different decisions? 32/32 games diverged from their control game (median first divergence turn 1)
- ✔ Did only the declared component change (no unrelated one)? declared component only (static isolation checks + diff)
- ✔ Do the engine invariants still hold? invariant suite passed
- ✔ Does browser-observable behaviour match the declared specification (Kane)? Kane re-derived 2 condition(s) on the holdout page and agrees
- ✔ Did ew_self_trigger_share decrease materially (≥ 0.15) on fresh holdout seeds? 0.873 → 0.612, effect -0.261 [-0.327, -0.191], 16 seeds
- ✔ Does the ew_self_trigger_share effect persist in both independent seed batches? batches -0.262 / -0.257
- ✔ Does the ew_self_trigger_share effect survive mirrored first-player controls? Human first -0.271 / AI first -0.255
- ✔ Safety preserved (no illegal actions, errors, softlocks; invariants hold)? safety events 0
- ✔ Strategic diversity preserved and no new dominant exploit? entropy 0.759 → 0.862; max share 0.316 → 0.278; biggest riser teleport
- ✔ Counterplay still possible (comebacks, lead changes)? comeback rate 0.625 → 0.710; lead changes 4.031 → 3.188
- ✘ Side / first-player balance and game length within tolerance? first-player edge -0.062 → 0.210; turns 14.500 → 27.094
- ○ More enjoyable, or only closer to a metric? NOT MEASURED: no human play data. Proxies only (diversity, counterplay, length). A metric gain is not evidence of more fun.
- ○ Strength cost: corrected planner vs control planner head-to-head treated win rate 0.188 (CI 0.063–0.313): informational; a weaker AI is a trade-off for the operator, not an automatic failure

## Decision

**NO CORRECTION PROMOTED (K1 REGRESSION)**

- K1 (planner): NOT PROMOTED (REGRESSION). Unacceptable deterioration: first-player edge grew to 0.210; game length changed 12.594 turns; draws/turn-limit endings up 0.187

## Kane calls

- KX1 exploration: done · kane-cli 0.10.4 complete OK
- KC1 challenge-analyzer: done · kane-cli 0.10.4 complete
- KA1 correction-analyzer: done · kane-cli 0.10.4 complete

## Limitations

- Divergence between control and treatment games is detected from placements, triggers and outcome; move-only differences are not logged.
- Seed-level bootstrap intervals assume seeds are exchangeable; with 16 development seeds an effect needs to be large to be called.
- The planner's heuristic path cost (basePenalty) still assumes production teleport geometry under the E4 rule variant.
- Enjoyment is not measured. Health proxies only.

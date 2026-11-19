# Balance Designer V2 run 2026-11-19T07-54-37Z-v2-dry

**Mode:** dry-run · **Checkpoint:** READY_FOR_OPERATOR_REAL_KANE_V2

Commit 17bd7179cdbe8469a0dc1dfde89675eb8f8238a6 · engine 5b79cac132ecdfbd · weights 0.3.0#ddcf941c285bd537 · 386 games · Kane calls 0/4 · credits 0

## Observation (V1 evidence, read-only)

cycle-1/baseline-training-games.ndjson sha256 6d1f600e5ad61b43… matches the V1 manifest. Teleport self-trigger share 0.879, east/west shove self-trigger share 0.885, teleport benefit to the activator 3.414 squares, conditional win rate of Teleport users 0.520 (descriptive only).

## Kane exploration

NOT_RUN: dry-run: kane-cli not invoked

## Hypotheses (pre-registered) and outcomes

| Id | Origin | Title | Outcome | Kane | Why |
|---|---|---|---|---|---|
| H0 | operator | No actionable defect: self-boosting is rational play | **INCONCLUSIVE** | UNVERIFIED | P0a: unclear (effect -0.031 [95% CI -0.125, 0.063], material = 0.08); P0b: contradicted (effect -0.188 [95% CI -0.313, -0.063], material = 0.08) |
| H1 | operator | Intrinsic rule geometry favours forward progress | **INCONCLUSIVE** | UNVERIFIED | P1b: unclear (too few underlying events (6 < 20); an interval over so few events is not judged) |
| H2 | operator | Planner exploitation through its own valuation | **REFUTED** | UNVERIFIED | primary prediction contradicted: P2a (effect 0.034 [95% CI -0.027, 0.088], material = 0.15) |
| H3 | operator | Placement search bias towards self-beneficial cells | **SUPPORTED** | UNVERIFIED | every primary and discriminating prediction held on these seeds (support, not proof) |
| H4 | operator | Valuation or calibration error in the V0.3 weights | **REFUTED** | NOT_ASKED | primary prediction contradicted: P4a (effect -0.016 [95% CI -0.090, 0.065], material = 0.1) |
| H5 | claude | The planner foresees 'random' teleport destinations | **REFUTED** | UNVERIFIED | primary prediction contradicted: P5b (effect 0.000 [95% CI 0.000, 0.000], material = 0.1) |

SUPPORTED means the pre-registered predictions held on these development seeds, not that the mechanism is proven.

## Experiments (real engine, real planner)

| Condition | Factor changed | Seeds | Games | Manipulation check | tp_self_share | ew_self_trigger_share | tp_self_benefit | safety |
|---|---|---|---|---|---|---|---|---|
| C0/selfplay/development | control: V0.3 weights, production planner, production rules | development | 32 | OK: control | 0.923 | 0.857 | 4.323 | 0 |
| E1a/selfplay/development | weights only: featureUtilityToActivator.teleport = 3.4 | development | 32 | OK: 15/32 games diverged from their control game (median first divergence turn 3) | 0.907 | 0.850 | 4.055 | 0 |
| E1b/selfplay/development | weights only: weightMix = 0 | development | 32 | OK: 30/32 games diverged from their control game (median first divergence turn 5) | 0.867 | 0.892 | 4.085 | 0 |
| E2/head-to-head/development | planner valuation only: benefit from own-installed traps × 0 | development | 32 | OK: treated planner on both sides and both first-player orders; hooks recorded on every game: true | 0.833 | 0.875 | 3.915 | 0 |
| E2/selfplay/development | planner valuation only: benefit from own-installed traps × 0 | development | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 3) | 0.794 | 0.891 | 3.844 | 0 |
| E3/selfplay/development | planner placement search only: own-piece benefit no longer makes a cell a candidate | development | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 1) | 0.804 | 0.668 | 3.669 | 0 |
| E4/selfplay/development | EXPERIMENTAL RULE VARIANT: teleport destination = random empty square in the same column | development | 32 | OK: 7 teleports, 0 changed the distance to goal; variant tag on every game: true | 0.857 | 0.884 | 0.000 | 0 |
| E5/head-to-head/development | planner information only: look-ahead uses a perturbed RNG copy (cannot foresee teleport destinations) | development | 32 | OK: treated planner on both sides and both first-player orders; hooks recorded on every game: true | 0.842 | 0.840 | 3.532 | 31 |
| E5/selfplay/development | planner information only: look-ahead uses a perturbed RNG copy (cannot foresee teleport destinations) | development | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 1) | 0.881 | 0.881 | 2.978 | 71 |
| C0/selfplay/holdout | control: V0.3 weights, production planner, production rules | holdout | 32 | OK: control | 0.854 | 0.884 | 4.107 | 0 |
| K1/selfplay/holdout | planner placement search only: own-piece benefit no longer makes a cell a candidate | holdout | 32 | OK: 32/32 games diverged from their control game (median first divergence turn 1) | 0.827 | 0.645 | 4.027 | 0 |
| K1/head-to-head/holdout | planner placement search only: own-piece benefit no longer makes a cell a candidate | holdout | 32 | OK: treated planner on both sides and both first-player orders; hooks recorded on every game: true | 0.810 | 0.721 | 4.020 | 0 |

## Corrections and adequacy review

### K1: planner (REVIEW_REQUIRED) — planner placement search only: own-piece benefit no longer makes a cell a candidate

Basis: H3 (deterministic). Candidate cells are chosen for self-benefit; score candidates by opponent harm and self-harm only.

**Implementation correctness:** UNVERIFIED · **Balance adequacy:** REGRESSION (provisional, before Kane: REGRESSION)

Unacceptable deterioration: game length changed 11.969 turns; draws/turn-limit endings up 0.156

- ✔ Did the corrected planner/rules actually make different decisions? 32/32 games diverged from their control game (median first divergence turn 1)
- ✔ Did only the declared component change (no unrelated one)? declared component only (static isolation checks + diff)
- ✔ Do the engine invariants still hold? invariant suite passed
- ○ Does browser-observable behaviour match the declared specification (Kane)? not verified by real Kane (dry-run: kane-cli not invoked)
- ✔ Did ew_self_trigger_share decrease materially (≥ 0.15) on fresh holdout seeds? 0.884 → 0.645, effect -0.239 [-0.293, -0.173], 16 seeds
- ✔ Does the ew_self_trigger_share effect persist in both independent seed batches? batches -0.178 / -0.290
- ✔ Does the ew_self_trigger_share effect survive mirrored first-player controls? Human first -0.300 / AI first -0.173
- ✔ Safety preserved (no illegal actions, errors, softlocks; invariants hold)? safety events 0
- ✔ Strategic diversity preserved and no new dominant exploit? entropy 0.815 → 0.770; max share 0.294 → 0.281; biggest riser teleport
- ✔ Counterplay still possible (comebacks, lead changes)? comeback rate 0.750 → 0.750; lead changes 4.313 → 3.813
- ✘ Side / first-player balance and game length within tolerance? first-player edge 0.063 → -0.031; turns 15.656 → 27.625
- ○ More enjoyable, or only closer to a metric? NOT MEASURED: no human play data. Proxies only (diversity, counterplay, length). A metric gain is not evidence of more fun.
- ○ Strength cost: corrected planner vs control planner head-to-head treated win rate 0.219 (CI 0.125–0.313): informational; a weaker AI is a trade-off for the operator, not an automatic failure

## Decision

**NO CORRECTION PROMOTED (K1 REGRESSION)**

- K1 (planner): NOT PROMOTED (REGRESSION). Unacceptable deterioration: game length changed 11.969 turns; draws/turn-limit endings up 0.156

## Kane calls

- KX1 exploration: skipped (dry-run: kane-cli not invoked)
- KC1 challenge-analyzer: skipped (dry-run: kane-cli not invoked)
- KA1 correction-analyzer: skipped (dry-run: kane-cli not invoked)

## Limitations

- Divergence between control and treatment games is detected from placements, triggers and outcome; move-only differences are not logged.
- Seed-level bootstrap intervals assume seeds are exchangeable; with 16 development seeds an effect needs to be large to be called.
- The planner's heuristic path cost (basePenalty) still assumes production teleport geometry under the E4 rule variant.
- Enjoyment is not measured. Health proxies only.

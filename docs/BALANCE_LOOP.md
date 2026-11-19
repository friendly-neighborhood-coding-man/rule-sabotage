# Living Balance Loop V1

> **V2:** the hypothesis-driven successor is documented in [BALANCE_DESIGNER_V2.md](BALANCE_DESIGNER_V2.md) (first dry-run result: [BALANCE_V2_RESULT.md](BALANCE_V2_RESULT.md), review: [BALANCE_V2_REVIEW.md](BALANCE_V2_REVIEW.md)). V1 evidence is unchanged.

One bounded, auditable closed loop that tunes the AI planner's **balance weights** from evidence:

```
AI self-play ─► anomaly detection ─► real Kane verification ─► candidate weights ─► held-out self-play ─► promote or roll back ─► journal
 (real engine,    (explicit config     (kane-cli on a served    (deterministic,     (fresh seeds,          (hard safety gates +     (append-only,
  real planner,    thresholds;          evidence page; per-      small, bounded,     same controls)         improvement criteria)    hash-chained)
  both players)    hypotheses only)     condition verdicts)      several)
```

It runs as its own process. The game server never waits on it: a new game simply reads the promoted
`balance/balance.weights.json` when it starts and freezes that version for the whole game.

## What the weights are (and are not)

`balance/balance.weights.json` follows Rule Space V0.3 §10–11 (the spec and the original bundle are kept in
`docs/spec/rule_sabotage_rule_space_v0_3.md` and `balance/v0.3-bundle/`):

| Field | Meaning |
|---|---|
| `featureUtilityToActivator` | V0.3 §10B signed utility to the **activator** (the owner of the piece that steps on the cell, whoever installed it), shared per family: `shovePerSquare` (east/west, signed by the stepping side's goal direction), `shoveBackPerSquare`, `shoveForwardPerSquare`, `shoveLateralPerSquare`, `freeze`, `home`, `teleport`, `shield`, `haste`. |
| `weightMix` | V0.3 §11: the planner's engine-simulated plan score gets `+ weightMix × placementValue`, where placementValue is −utility(opponent steps) × opponent exposure + utility(own piece steps) × own exposure. `0` is exactly the PR #2 planner (tested). |
| `placementUpkeep` | Turn-score the planner pays to place each effect (0.15 = PR #2). Its keys are exactly the effects the planner may place. |
| `unsupported` | V0.3 §10C future effects (`reset_all_opposing_unscored`, `skip_next_turn`, …) with their prior. Status `UNSUPPORTED`: recorded, never simulated, never placed. |
| `planner` | Fixed planner constants (self-harm factor, immediate vs. after-reply weighting, temperature, scored-piece bonus). |

Version `0.3.0` is the V0.3 **human-prior-v0** baseline, unchanged (weightMix 0.3). It is provisional, not measured
and not Kane-derived. The bundle's **heuristic-proposal-v1-NOT-KANE** candidate (`balance/v0.3-candidate.weights.json`:
freeze −1.7, home −3.1, haste +2.2, shoveBack −0.8) is evaluated on the held-out seeds in every cycle next to the
optimizer's candidates, labelled as such, and can never be promoted. The bundle's ledger
(`kane-balance-events.jsonl`) is carried into the journal verbatim as the first entry.

Weights only change **which plans the AI prefers**. Legality, effect execution, symmetry, the referee and Kane
conditions never import `server/weights.ts` (a unit test checks this). Out-of-range values, a future effect priced as
implemented, an implemented effect listed as unsupported, or a perspective other than `activator` make the file
invalid; it is refused, not clamped. The bundle's surrogate Python runs (`run_32*`, failed sanity gates) are kept for
the record and are not used anywhere.

## Commands

```bash
npm run balance:loop                         # one cycle, DRY-RUN (default): kane-cli is NOT called, nothing can be promoted
npm run balance:loop -- --run-kane           # one cycle with REAL kane-cli verification (uses Kane credits)
npm run balance:loop -- --run-kane --cycles 2   # bounded multi-cycle (hard cap: budget.maxCycles in the config)
npm run balance:loop -- --quick              # 4+4 seeds smoke test
npm run balance:record                       # the same loop, recorded (terminal + dashboard video); add --run-kane for real
npm run balance:replay -- --seed 1001 --first human --turn 7 --weights balance/history/weights-0.3.0.json
npm run balance:verify-journal               # checks the hash chain of balance/journal.ndjson
```

Flags: `--port N` (dashboard, default 4100) · `--keep-open` · `--no-unit-tests` · `--no-promote` · `--config FILE` · `--weights FILE` · `--journal FILE`.
On Windows, add the npm globals to PATH first if `kane-cli` is not found: `$env:PATH = "D:\Tools\npm-global;$env:PATH"`.

The dashboard (`http://127.0.0.1:4100/` while the loop runs) shows the live stage rail, baseline numbers, anomalies,
each Kane run (live kane-cli output, per-condition answers, the evidence page it inspects), the candidate changes,
the held-out comparison with every gate, the decision and the weight history. Its four panels answer
**what was wrong → what Kane verified → what changed → whether it improved**, and each panel is labelled with its
source: *statistical anomaly detection*, *real kane-cli browser verification* or *deterministic optimizer*.

## The stages

1. **Baseline self-play.** Training seeds from `balance/loop.config.json`, each played twice (Human side starts, then
   AI side starts), both players driven by the real `planTurn`/`planMoves` with the same frozen weights. Every trigger's
   consequence is **measured** from engine events: squares gained or lost for shoves/home/teleport, actions actually lost
   in the next own turn for freeze, whether a +1 action was used, whether a shield blocked anything. Also recorded:
   wins/losses/draws, first-player and side bias, turns, placements and triggers per effect, unused cells, strategy
   signatures and entropy, lead changes and comebacks, illegal actions, engine errors and softlocks.
2. **Anomaly detection.** Deterministic rules with explicit thresholds (`thresholds` in the config): first-player
   advantage, side bias, dominant effect, overpowered effect pair, penalty that rarely materializes, under-valued benefit,
   never-selected effect, wasted placements, repeated opening, safety violation. Each anomaly is a hypothesis. Each
   Kane-checkable one comes with a concrete statement about evidence rows.
3. **Kane verification.** For up to `kane.maxCallsPerCycle` anomalies (weight-tunable first), the loop writes an
   evidence page and serves it on loopback: a fixed systematic sample of raw rows (odd count) and, for trigger anomalies, a
   real-engine replay of the first row (the game is replayed and must reproduce exactly). The page does not state the
   hypothesis. The real kane-cli then runs: `kane-cli run --analyzer-only --agent --cdp-endpoint <chrome> --condition …`
   with four conditions: **K1** row-count integrity, **K2** the hypothesis statement, **K3** its negation (a control),
   **K4** replay consistency. The finding is **CONFIRMED** only if K1 and K4 hold, K2 is true and K3 is false;
   **REFUTED** if K2 is false and K3 true; anything else (timeout, missing results, both true, the test double) is
   **UNVERIFIED**. The verbatim NDJSON, stderr, version, timings and credits are stored. Identical evidence pages
   already verified by kane-cli are not re-sent (dedupe in `balance/investigations.json`), and the reuse is labelled.
4. **Candidates.** For every investigated, non-refuted, weight-tunable anomaly, small bounded changes (an activator
   utility moved 15% or 30% toward or away from 0, upkeep ±0.1/±0.2, capped by `optimizer.maxRelativeStep`), round-robin over anomalies, up to
   `optimizer.maxCandidates`, plus the V0.3 bundle candidate. Each change records old value, new value, reason, anomaly and finding. Only candidates
   whose finding is CONFIRMED by real kane-cli are **eligible**; the others are evaluated for the record only.
5. **Held-out comparison.** Baseline and every candidate on the held-out seeds (never used for detection).
6. **Decision.** Hard gates: no illegal actions/errors/softlocks; engine invariant suite (symmetry, fire-once, chain
   cap, softlock rollout, legality for every implemented effect) and the unit test suite pass; engine source hash
   unchanged; Kane-confirmed basis. Improvement gate: the anomaly's own metric improves by at least
   `promotion.targetImprovementMin`. Regression gates: first-player deviation, effect entropy, median game length, draw
   rate, turn-limit rate, lead changes. The best passing candidate is promoted (new patch version, file written to
   `balance/history/`), otherwise the cycle **rolls back** (weights unchanged) with every reason recorded.
7. **Journal and manifest.** `balance/journal.ndjson` (real-Kane runs; dry-runs write their own journal inside the run
   directory) gets run-start, investigation, promote/rollback, failure and run-end entries, each hash-chained to the
   previous one. The run directory gets `REPORT.md`, `status.json`, `loop.log`, all games, metrics, anomalies, findings,
   Kane output and `manifest.json` (sha256 of every file).

## Resource controls

| Control | Where | Default |
|---|---|---|
| Real Kane only with `--run-kane` | CLI | dry-run |
| Kane calls per cycle / per run | `kane.maxCallsPerCycle`, `kane.maxCallsTotal` | 2 / 4 |
| Credit cap (measured with `kane-cli balance` before and after each call) | `kane.maxCreditsTotal` | 60 |
| Concurrent kane-cli processes | `kane.maxConcurrent` | 1 |
| Kane timeout per call | `kane.timeoutS` | 300 s |
| Cycles | `--cycles`, capped by `budget.maxCycles` | 1 (max 3) |
| Games per cycle / wall clock | `budget.maxGamesPerCycle`, `budget.maxWallMinutes` | 200 / 60 min |
| One loop at a time | `evidence/balance/.loop.lock` | — |
| Duplicate investigations | `balance/investigations.json` | — |

When a budget runs out or kane-cli is unavailable, the loop stops at a labelled **CHECKPOINT** and never fabricates
the missing stage. Self-play workers use half the logical cores and the loop lowers its own process priority.

## Recording

`npm run balance:record [-- --run-kane]` runs the loop and captures:

- `terminal.cast` (asciicast v2) and `terminal.log`: the loop's real terminal output, with API-key patterns redacted;
- `raw.webm`: the dashboard in a real Chrome, via the DevTools screencast, unedited and in real time (4 fps);
- `concise.webm`: every 12th frame of the same capture, each stamped **ACCELERATED 12×** with its real timestamp,
  after a title card that says so (only produced when an ffmpeg binary is found: Playwright's bundled ffmpeg works);
- `recording-manifest.json` with sha256 of every file. The terminal capture and manifest are copied into the run
  directory; videos stay in `evidence/balance/recordings/` because of their size.

Every frame shows the UTC clock, commit SHA, balance version and hash, seeds and the run id.

## Known limitations

- Weights tune the **AI's valuation**, not the rules. Rule-level findings (for example a first-player advantage) are
  detected, can be Kane-verified, and act as promotion guard-rails, but no weight change claims to fix them.
- Kane templates exist for proportion statements over rows (penalty that rarely hurts, overpowered pair, dominant
  effect, first-player edge). Magnitude claims (under-valued benefit), absences (never selected) and engine counters
  (unused cells) are detected and recorded but cannot drive a promotion in V1.
- Consequence measurement covers the direct effect of a trigger. Captures caused by a shove, and freeze cost in the same
  turn it fires, are not attributed.
- The sample shown to Kane is a systematic subset of rows (at most 13), so a statement Kane confirms is about those rows.
  The loop also reports whether Kane's answer agrees with its own computation on the same rows.
- With 12 + 12 seeds the statistics are small-sample; the thresholds and seed lists are in the config and are meant to
  be raised for longer runs.
- The opponent model inside the planner assumes the opponent shares its weights.

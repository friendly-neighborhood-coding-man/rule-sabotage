# One closed loop, recorded: run 2026-11-18T14-21-47Z-kane

**Outcome: ROLLBACK.** Real kane-cli confirmed both anomalies that were sent to it. None of the five candidate weight sets improved on the held-out seeds, so the weights stay at V0.3 `0.3.0`.

| | |
|---|---|
| Command | `npm run balance:record -- --run-kane` (authorised by Eric on 2026-11-18) |
| Commit / engine | `d1fe2d784a552d9dd413876d244d5047b3c5c08d` / engine source `0c9d5055ebaba086` |
| Weights | `0.3.0#ddcf941c285bd537` = Rule Space V0.3 human-prior-v0, weightMix 0.3 |
| Seeds | training 1000–1011, held-out 5000–5011, each played twice (Human side starts, then AI side starts) |
| Kane | kane-cli 0.10.4, 2 calls, **11.841 credits** (10677.397 → 10665.556), 150.4 s and 52.9 s |
| Games | 168 (24 baseline + 24 held-out baseline + 5 × 24 candidates), 0 illegal moves, 0 engine errors, 0 softlocks |
| Wall time | 14:21:47 → 14:37:28 UTC (15 min 41 s) |

## What was wrong (statistical anomaly detection: hypotheses)
Baseline on the training seeds: Human 9 / AI 15 / 0 draws, first mover won 46%, median 11 turns. The same numbers came out in the earlier dry-run, so the run is reproducible. Nine anomalies crossed their thresholds. Two were weight-tunable and had a Kane template:
- **A1** Teleport is priced as a penalty (V0.3 utility −0.8), but it moved the stepping piece away from its goal in only **10% of 58 triggers**. On average it moved the piece 3.4 squares *closer* to its goal.
- **A4** "Shove west 2" made up **31% of all placements**, and the players who used it won 63% of their games.

## What Kane verified (real kane-cli browser verification)
Kane analysed each evidence page (raw rows plus a real-engine replay) in analyzer mode. Both findings came back **CONFIRMED**:
- A1: K1 row count = 13 ✔, K2 "fewer than half of the rows end farther from the goal" **TRUE**, K3 negated control **FALSE**, K4 replay board matches ✔.
- A4: K1 ✔, K2 "more than half of the rows are wins" **TRUE**, K3 negated control **FALSE**.

Our own computation on the same rows agreed with Kane both times. The verbatim kane-cli NDJSON is in `cycle-1/kane-A1/` and `cycle-1/kane-A4/`.

## What changed (deterministic optimizer)
| Candidate | Change | Basis |
|---|---|---|
| C1 | teleport utility −0.8 → −0.68 | A1, Kane-confirmed |
| C2 | upkeep shove:west:2 0.15 → 0.25 | A4, Kane-confirmed |
| C3 | teleport utility −0.8 → −0.56 | A1, Kane-confirmed |
| C4 | upkeep shove:west:2 0.15 → 0.35 | A4, Kane-confirmed |
| C5 | V0.3 bundle proposal: freeze −1.7, home −3.1, haste 2.2, shoveBack −0.8 | NOT Kane, never eligible |

## Did it improve? (held-out self-play)
Every candidate passed the hard safety gates: no illegal moves, errors or softlocks; the invariant suite (36 trials) and `npm test` (70/70) passed; the engine source was unchanged. Every candidate **failed the improvement gate**:
- C1 and C3: the teleport calibration error went 3.638 → 3.650 and → 3.669 (no improvement). The utility nudge doesn't change the planner's habit of using teleport on its own path.
- C2 and C4: the shove-west dominance metric got worse (0.029 → 0.033, → 0.045).
- C5: it has no anomaly target. Median game length dropped from 13 to 10 turns.

So the loop rolled back. This is the honest result: the confirmed patterns are real, but small changes to these weights don't fix them. That suggests both patterns come from the planner's own geometry (it uses effects as boosts on its own path) more than from the V0.3 priors.

## Evidence
- Run directory: `evidence/balance/runs/2026-11-18T14-21-47Z-kane/` (`REPORT.md`, `loop.log`, all games, metrics, anomalies, evidence pages, Kane output, `manifest.json` with sha256 of every file).
- Journal: `balance/journal.ndjson`, 6 hash-chained entries, verified with `npm run balance:verify-journal`.
- Recording (kept locally because of its size, hashes in `recording/recording-manifest.json`): `evidence/balance/recordings/2026-11-18T14-21-47Z/`. It holds `raw.webm` (17 min 46 s, unedited, sha256 `876b5c92…`), `concise.webm` (76 s, every frame stamped ACCELERATED 12×, sha256 `eba49c22…`), and `terminal.cast` / `terminal.log`.

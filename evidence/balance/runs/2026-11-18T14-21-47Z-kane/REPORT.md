# Living Balance Loop: run 2026-11-18T14-21-47Z-kane

Mode **RUN-KANE** · commit `d1fe2d784a552d9dd413876d244d5047b3c5c08d` · engine `0c9d5055ebaba086` · v24.22.1 on win32
Started 2026-11-18T14:21:47.665Z · finished 2026-11-18T14:36:40.183Z

Training seeds 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011 · held-out seeds 5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010, 5011 (each played twice, both sides starting).

Kane: kane-cli 0.10.4 · 2 call(s) · credits used 11.841 (before 10677.397, after 10665.5561) · games played 168

## Cycle 1 (baseline weights 0.3.0 #ddcf941c285bd537)

### 1. Baseline AI-vs-AI (training seeds)

24 games: Human side 9, AI side 15, draws 0. First player wins 46% of decisive games (4/12 seed pairs won by the first mover both times). Median 11 turns (p10 7, p90 16). Effect entropy 0.743, 19 distinct openings. Illegal 0, errors 0, softlocks 0.

| Effect | Placements (share) | Triggers | Self-trigger | Hurt the piece | Realized / predicted per trigger | Unused cells | Win rate when used |
|---|---|---|---|---|---|---|---|
| freeze | 2 (1%) | 0 | 0% | 0% | 0 / 0 | 100% | 100% |
| haste | 13 (5%) | 15 | 93% | 0% | -1 / -1.8 | 62% | 39% |
| home | 23 (8%) | 0 | 0% | 0% | 0 / 0 | 99% | 62% |
| shield | 10 (4%) | 13 | 92% | 0% | -1.538 / -1.4 | 53% | 30% |
| shove:back:2 | 6 (2%) | 3 | 0% | 100% | 2 / 1.8 | 83% | 33% |
| shove:back:3 | 9 (3%) | 7 | 14% | 43% | 0.429 / 2.7 | 74% | 50% |
| shove:east:2 | 92 (34%) | 184 | 90% | 10% | -1.587 / -1.428 | 33% | 35% |
| shove:forward:2 | 1 (0%) | 1 | 100% | 0% | -2 / -1.8 | 67% | 0% |
| shove:west:2 | 85 (31%) | 164 | 87% | 13% | -1.488 / -1.339 | 35% | 63% |
| teleport | 33 (12%) | 58 | 88% | 10% | -3.414 / 0.8 | 37% | 52% |

### 2. What looked wrong (statistical anomalies: hypotheses, not proof)

- **A1** `cost-not-realized` “Teleport” is priced as a penalty (0.80 actions/trigger) but hurts in only 10% of 58 triggers. Severity 1.794.
- **A2** `never-selected` “Shove north 2” is almost never worth selecting (0.0% of placements). Severity 0.6. Absence of use cannot be shown as evidence rows; recorded only.
- **A3** `never-selected` “Shove south 2” is almost never worth selecting (0.0% of placements). Severity 0.6. Absence of use cannot be shown as evidence rows; recorded only.
- **A4** `dominant-effect` “Shove west 2” is 31% of all placements and its users win 63%. Severity 0.558.
- **A5** `never-selected` “Shove forward 2” is almost never worth selecting (0.4% of placements). Severity 0.48. Absence of use cannot be shown as evidence rows; recorded only.
- **A6** `wasted-placements` 99% of “Send home” cells are never entered. Severity 0.477. Engine counters (placed − hits); recorded as supporting evidence.
- **A7** `never-selected` “Freeze” is almost never worth selecting (0.7% of placements). Severity 0.39. Absence of use cannot be shown as evidence rows; recorded only.
- **A8** `wasted-placements` 83% of “Shove back 2” cells are never entered. Severity 0.222. Engine counters (placed − hits); recorded as supporting evidence.
- **A9** `wasted-placements` 74% of “Shove back 3” cells are never entered. Severity 0.068. Engine counters (placed − hits); recorded as supporting evidence.

### 3. What Kane verified (real kane-cli browser checks on the evidence page)

- **A1** evidence page `cycle-1-A1-evidence.html` · done · kane-cli 0.10.4 · complete in 150.4 s · exit 0 → **CONFIRMED**: Kane: the hypothesis statement is true and its negated control is false.
  - K1 (integrity) Kane: **TRUE** — “Counting data rows in the Evidence rows table: value: '13' -> '13'; equals '13' -> PASS”. Statement: The table titled 'Evidence rows' has exactly 13 data rows below its header row.
  - K2 (hypothesis) Kane: **TRUE** — “Checking the proportion of Evidence rows with increased squares to goal: value: 'true' -> 'true'; equals 'true' -> PASS”. Statement: In the 'Evidence rows' table, fewer than half of the data rows are rows where the 'Squares to goal after' number is greater than the 'Squares to goal before' number.
  - K3 (negated control) Kane: **FALSE** — “Checking the proportion of Evidence rows with increased squares to goal: value: 'false' -> 'false'; equals 'true' -> FAIL”. Statement: In the 'Evidence rows' table, at least half of the data rows are rows where the 'Squares to goal after' number is greater than the 'Squares to goal before' number.
  - K4 (replay consistency) Kane: **TRUE** — “Checking the Human piece position on the Replay R1 After board: value: 'true' -> 'true'; equals 'true' -> PASS”. Statement: In the 'Replay R1' section, the 'After' board shows a Human piece on the square named in the 'Ended on' line of that section.
  - Our own computation on the same rows says the hypothesis statement is true; Kane agrees.
- **A4** evidence page `cycle-1-A4-evidence.html` · done · kane-cli 0.10.4 · complete in 52.9 s · exit 0 → **CONFIRMED**: Kane: the hypothesis statement is true and its negated control is false.
  - K1 (integrity) Kane: **TRUE** — “Counting data rows in the Evidence rows table: value: '13' -> '13'; equals '13' -> PASS”. Statement: The table titled 'Evidence rows' has exactly 13 data rows below its header row.
  - K2 (hypothesis) Kane: **TRUE** — “Checking the majority of won results in the Evidence rows table: value: 'true' -> 'true'; equals 'true' -> PASS”. Statement: In the 'Evidence rows' table, more than half of the data rows are rows where the 'Result for this side' column says 'won'.
  - K3 (negated control) Kane: **FALSE** — “Checking the maximum share of won results in the Evidence rows table: value: 'false' -> 'false'; equals 'true' -> FAIL”. Statement: In the 'Evidence rows' table, at most half of the data rows are rows where the 'Result for this side' column says 'won'.
  - Our own computation on the same rows says the hypothesis statement is true; Kane agrees.

### 4. What changed (deterministic candidates)

- **C1** `featureUtilityToActivator.teleport` -0.8 → -0.68. cost-not-realized: move the V0.3 activator utility teleport (prices teleport) 15% toward 0, because the measured consequence is smaller than the prior (harmfulRate 0.103 vs threshold 0.5) · based on A1, CONFIRMED by kane-cli
- **C2** `placementUpkeep.shove:west:2` 0.15 → 0.25. dominant-effect: raise the placement upkeep of shove:west:2 by 0.1 (share×winRateWhenUsed 0.31 vs threshold 0.2) · based on A4, CONFIRMED by kane-cli
- **C3** `featureUtilityToActivator.teleport` -0.8 → -0.56. cost-not-realized: move the V0.3 activator utility teleport (prices teleport) 30% toward 0, because the measured consequence is smaller than the prior (harmfulRate 0.103 vs threshold 0.5) · based on A1, CONFIRMED by kane-cli
- **C4** `placementUpkeep.shove:west:2` 0.15 → 0.35. dominant-effect: raise the placement upkeep of shove:west:2 by 0.2 (share×winRateWhenUsed 0.31 vs threshold 0.2) · based on A4, CONFIRMED by kane-cli
- **C5** `featureUtilityToActivator.shoveBackPerSquare` -0.9 → -0.8, `featureUtilityToActivator.freeze` -2.2 → -1.7, `featureUtilityToActivator.home` -3.8 → -3.1, `featureUtilityToActivator.haste` 1.8 → 2.2. V0.3 bundle heuristic-proposal-v1-NOT-KANE (human-authored, not derived from this run) · V0.3 bundle proposal (NOT Kane-derived): evaluated for the record, cannot be promoted

### 5. Did it improve? (held-out seeds)

| Metric | Baseline | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|---|
| First-player win rate | 44% | 39% | 46% | 48% | 42% | 46% |
| Human-side win rate | 39% | 44% | 38% | 44% | 33% | 46% |
| Median turns | 13 | 13 | 13 | 13 | 13 | 10 |
| Draw rate | 4% | 4% | 0% | 4% | 0% | 0% |
| Effect entropy (norm.) | 0.78 | 0.792 | 0.78 | 0.796 | 0.788 | 0.743 |
| Distinct openings | 17 | 17 | 17 | 17 | 17 | 18 |
| Lead changes / game | 5.125 | 5.083 | 5.042 | 5.083 | 5.125 | 4.917 |
| Illegal / errors / softlocks | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |

**C1** was rejected (score -0.041):
- ✅ safety: no illegal actions, engine errors or softlocks on held-out games: illegal 0, errors 0, softlocks 0
- ✅ safety: engine invariant suite passes (symmetry, fire-once, chain cap, softlock, legality) and engine source unchanged: invariants pass; unit tests ℹ tests 70, ℹ pass 70, ℹ fail 0; engine source 0c9d5055ebaba086
- ✅ evidence: based on a Kane-CONFIRMED finding (real kane-cli): based on A1, CONFIRMED by kane-cli
- ❌ target: the anomaly metric improves by at least 5% on held-out seeds: calibration error |predicted − realized| per trigger of teleport: 3.638 → 3.65 (-0.3%)
- ✅ fairness: first-player deviation from 50% grows by at most 0.08: first-player win rate 0.435 → 0.391
- ✅ diversity: normalised effect entropy drops by at most 0.1: 0.78 → 0.792; distinct openings 17 → 17
- ✅ game length: median turns changes by at most 30%: median 13 → 13
- ✅ draws: draw rate grows by at most 0.1: 0.042 → 0.042
- ✅ stalling: at most 15% of games hit the turn limit: 0.042
- ✅ counterplay: lead changes per game do not fall by more than 30%: lead changes/game 5.125 → 5.083; comeback rate 0.739 → 0.783

**C2** was rejected (score -0.111):
- ✅ safety: no illegal actions, engine errors or softlocks on held-out games: illegal 0, errors 0, softlocks 0
- ✅ safety: engine invariant suite passes (symmetry, fire-once, chain cap, softlock, legality) and engine source unchanged: invariants pass; unit tests ℹ tests 70, ℹ pass 70, ℹ fail 0; engine source 0c9d5055ebaba086
- ✅ evidence: based on a Kane-CONFIRMED finding (real kane-cli): based on A4, CONFIRMED by kane-cli
- ❌ target: the anomaly metric improves by at least 5% on held-out seeds: placement share of shove:west:2 × (win rate when used − 0.5): 0.029 → 0.033 (-13.4%)
- ✅ fairness: first-player deviation from 50% grows by at most 0.08: first-player win rate 0.435 → 0.458
- ✅ diversity: normalised effect entropy drops by at most 0.1: 0.78 → 0.78; distinct openings 17 → 17
- ✅ game length: median turns changes by at most 30%: median 13 → 13
- ✅ draws: draw rate grows by at most 0.1: 0.042 → 0
- ✅ stalling: at most 15% of games hit the turn limit: 0.083
- ✅ counterplay: lead changes per game do not fall by more than 30%: lead changes/game 5.125 → 5.042; comeback rate 0.739 → 0.75

**C3** was rejected (score 0.042):
- ✅ safety: no illegal actions, engine errors or softlocks on held-out games: illegal 0, errors 0, softlocks 0
- ✅ safety: engine invariant suite passes (symmetry, fire-once, chain cap, softlock, legality) and engine source unchanged: invariants pass; unit tests ℹ tests 70, ℹ pass 70, ℹ fail 0; engine source 0c9d5055ebaba086
- ✅ evidence: based on a Kane-CONFIRMED finding (real kane-cli): based on A1, CONFIRMED by kane-cli
- ❌ target: the anomaly metric improves by at least 5% on held-out seeds: calibration error |predicted − realized| per trigger of teleport: 3.638 → 3.669 (-0.9%)
- ✅ fairness: first-player deviation from 50% grows by at most 0.08: first-player win rate 0.435 → 0.478
- ✅ diversity: normalised effect entropy drops by at most 0.1: 0.78 → 0.796; distinct openings 17 → 17
- ✅ game length: median turns changes by at most 30%: median 13 → 13
- ✅ draws: draw rate grows by at most 0.1: 0.042 → 0.042
- ✅ stalling: at most 15% of games hit the turn limit: 0.042
- ✅ counterplay: lead changes per game do not fall by more than 30%: lead changes/game 5.125 → 5.083; comeback rate 0.739 → 0.826

**C4** was rejected (score -0.563):
- ✅ safety: no illegal actions, engine errors or softlocks on held-out games: illegal 0, errors 0, softlocks 0
- ✅ safety: engine invariant suite passes (symmetry, fire-once, chain cap, softlock, legality) and engine source unchanged: invariants pass; unit tests ℹ tests 70, ℹ pass 70, ℹ fail 0; engine source 0c9d5055ebaba086
- ✅ evidence: based on a Kane-CONFIRMED finding (real kane-cli): based on A4, CONFIRMED by kane-cli
- ❌ target: the anomaly metric improves by at least 5% on held-out seeds: placement share of shove:west:2 × (win rate when used − 0.5): 0.029 → 0.045 (-54.9%)
- ✅ fairness: first-player deviation from 50% grows by at most 0.08: first-player win rate 0.435 → 0.417
- ✅ diversity: normalised effect entropy drops by at most 0.1: 0.78 → 0.788; distinct openings 17 → 17
- ✅ game length: median turns changes by at most 30%: median 13 → 13
- ✅ draws: draw rate grows by at most 0.1: 0.042 → 0
- ✅ stalling: at most 15% of games hit the turn limit: 0.042
- ✅ counterplay: lead changes per game do not fall by more than 30%: lead changes/game 5.125 → 5.125; comeback rate 0.739 → 0.792

**C5** was rejected (score 0.005):
- ✅ safety: no illegal actions, engine errors or softlocks on held-out games: illegal 0, errors 0, softlocks 0
- ✅ safety: engine invariant suite passes (symmetry, fire-once, chain cap, softlock, legality) and engine source unchanged: invariants pass; unit tests ℹ tests 70, ℹ pass 70, ℹ fail 0; engine source 0c9d5055ebaba086
- ❌ evidence: based on a Kane-CONFIRMED finding (real kane-cli): V0.3 bundle proposal (NOT Kane-derived): evaluated for the record, cannot be promoted
- ❌ target: the anomaly metric improves by at least 5% on held-out seeds: no measurable target
- ✅ fairness: first-player deviation from 50% grows by at most 0.08: first-player win rate 0.435 → 0.458
- ✅ diversity: normalised effect entropy drops by at most 0.1: 0.78 → 0.743; distinct openings 17 → 18
- ✅ game length: median turns changes by at most 30%: median 13 → 10
- ✅ draws: draw rate grows by at most 0.1: 0.042 → 0
- ✅ stalling: at most 15% of games hit the turn limit: 0.083
- ✅ counterplay: lead changes per game do not fall by more than 30%: lead changes/game 5.125 → 4.917; comeback rate 0.739 → 0.75

### 6. Decision

**ROLLBACK** (weights stay 0.3.0)

- C1: target: the anomaly metric improves by at least 5% on held-out seeds: calibration error |predicted − realized| per trigger of teleport: 3.638 → 3.65 (-0.3%)
- C2: target: the anomaly metric improves by at least 5% on held-out seeds: placement share of shove:west:2 × (win rate when used − 0.5): 0.029 → 0.033 (-13.4%)
- C3: target: the anomaly metric improves by at least 5% on held-out seeds: calibration error |predicted − realized| per trigger of teleport: 3.638 → 3.669 (-0.9%)
- C4: target: the anomaly metric improves by at least 5% on held-out seeds: placement share of shove:west:2 × (win rate when used − 0.5): 0.029 → 0.045 (-54.9%)
- C5: evidence: based on a Kane-CONFIRMED finding (real kane-cli): V0.3 bundle proposal (NOT Kane-derived): evaluated for the record, cannot be promoted | target: the anomaly metric improves by at least 5% on held-out seeds: no measurable target

## Weight history (journal)

| When | Event | Version | Hash | Changes |
|---|---|---|---|---|
| 2026-11-18T14:21:47.959Z | baseline | 0.3.0 | ddcf941c285bd537 | initial weights (Rule Space V0.3 human-prior-v0) |
| 2026-11-18T14:36:40.079Z | rollback | 0.3.0 | ddcf941c285bd537 | none (kept baseline) |

Journal: `balance\journal.ndjson` (append-only, hash-chained; verify with `npm run balance:verify-journal`). Evidence: `evidence\balance\runs\2026-11-18T14-21-47Z-kane` (manifest.json has sha256 of every file).

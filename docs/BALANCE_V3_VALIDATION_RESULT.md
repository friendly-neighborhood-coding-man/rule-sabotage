# Balance Designer V3: Kane research call and 240-game validation

**Status: READY_FOR_OPERATOR_V3_VALIDATION_REVIEW.** No correction is promoted, production is unchanged (3 versus 3),
nothing is merged or deployed. No further experiment cycle is authorised.

Authorisation (Eric, 2026-11-19 15:01 UTC): one real Kane objective call on the 100-game dossier (80-credit operating
ceiling, no retries, no analyzer calls), then exactly 240 offline games on fresh seeds 62101–62130.

## Order of events (all in `balance/v3/journal.ndjson`, 20 entries, chain verified)

| # | Time (UTC) | What |
|---|---|---|
| 8 | 15:05 | V3-VALIDATE protocol and matrix **frozen** (arms, seeds, comparisons, decision rules), committed `df479d7`, before Kane |
| 9 | 15:09 | dossier notebook gained a one-textbox quick entry (step budget); stored games unchanged |
| 10 | 15:39 | harness fix found in a throwaway-seed smoke: a blind (P3) planner issued stale moves after an unforeseen teleport; it now re-plans. 0 validation games played |
| 11–12 | 15:41–15:54 | **the one Kane call KX3** (an earlier launch stopped at the CLI path check before reaching Kane: 0 credits, no journal entry; its log is kept as `evidence/balance/v3/kane-call-console-attempt1-probe-failed.log`) |
| 13–15 | 15:55–15:56 | Kane entries registered verbatim, mapped to arms A–D, no protocol revision; all before any validation game |
| 16–18 | 15:56–16:01 | 240 validation games, run once |
| 19–20 | 16:02–16:03 | preregistered evaluation |

## 1. The Kane call

| | |
|---|---|
| Call | KX3, kane-cli 0.10.4 objective mode, max 35 steps, timeout 900 s; run_end **passed**, 12.6 min |
| Credits | **107.934** by balance delta ([balance redacted] → [balance redacted]); run_end reported 103.232. **The 80-credit operating ceiling was exceeded by about 28 credits.** The pre-call estimate (56, from V2's 1.6 credits per step) was wrong by a factor of about 2. One call cannot be stopped part way, so the ceiling was not a cap |
| Raw evidence | `evidence/balance/v3/kane/2026-11-19T15-41-35Z-KX3/`: `kane-stdout.ndjson`, `kane-stderr.txt`, `kane-notes.ndjson` (every POST verbatim, sha256 `bd6f344f…`), `kane-v3-entries.json`, `kane-v3-call.json`, timestamped `terminal.log`. kane-cli reported `recording_state enabled` with `persist:false`; no video is kept by kane-cli, and I did not screen-record |
| Provenance | real CLI (not the test double), raw-file sha256 and note ids verified (`balance/v3/kane-proposals.json`) |
| Isolation | the loopback server served only the dataset directory; Claude's hypotheses (`balance/v3/proposals.json`) were never reachable, and the objective names none |

**What Kane submitted** (5 entries, valid nonce, inside the call window, quoted verbatim in `kane-proposals.json`):

| Entry | Kane's explanation | Intervention | Predictions (as written) |
|---|---|---|---|
| KX3-N1 | First-turn tempo rather than piece count; "opening tempo and the planner's response" | S3 turn-1 action cap = 1 | first-mover win rate −0.15; turn-1 crossing share −0.10 |
| KX3-N2 | Conveyor (own-trap) valuation may amplify opening tempo; "not proven to be the primary cause" | P2 own-benefit valuation = 0 | conveyor moves −5/game; first-mover edge −0.10 |
| KX3-N3 | **Conclusion: more evidence is needed.** First-mover edge reproducible (64%); piece count "not a reliable fairness lever"; conveyors "legitimate but warrant measurement". Proposes **S3 = 1 versus P2 = 0** on fresh paired seeds, judged by a 15-point first-mover drop without more turn-limit games | | |
| KX3-N4, N5 | shorter re-submissions of N1 and N2 using metric ids | S3 = 1; P2 = 0 | one id invented in each (`first_mover_turn1_cross_rate`, `conveyor_moves`) |

**Registered as Kane hypotheses: 0 of 5.** The parser frozen before the call rejects every entry: Kane wrote metric
display labels instead of ids, free-text causes, and a free-text verdict. `informational.exactLabelMetrics` shows the
ids those labels name, for the reader only.

**Overlap with the prewritten hypotheses.** KX3-N1/N4 are the same mechanism and the same intervention and value as
HC4 (S3 = 1). KX3-N2/N5 share HC3's mechanism (own-trap conveyors) but pick a different lever (P2 valuation at 0
instead of P1 search at 0.5; P2 is the factor V2 tested as E2). New relative to HC0–HC5/HD1: the explicit framing
of tempo and conveyor valuation as rivals, tested against each other. Kane did not raise RNG foresight (HC5),
the raw-sum evaluation (HC2) or the victory-requirement mechanism (HC1). Its cited games overlap Claude's
(e.g. counterexample C0-62001-human, as in HC4) because both took the first games listed on the dossier pages.

**Testability by arms A–D: none.** No arm runs S3 or P2, so every Kane proposal is **NOT_TESTED**, and so is Kane's
own S3 versus P2 design. I did not revise the protocol: fitting two new arms into 240 games would replace B–D or
cut every arm below 60 games and drop the preregistered controls (journal #15).

## 2. The 240 validation games

`evidence/balance/v3/datasets/2026-11-19T15-56-36Z-v3-screen/` (the directory name keeps the runner's generic suffix;
the matrix inside is `V3-VALIDATE-240`). 240/240 games, **0 external calls**, 0 further Kane calls, 0 illegal actions,
errors or softlocks, 240/240 engine replays identical, 4/4 planner re-runs identical, 4.1 min, dataset hash
`3e137fdfc8c031c6`, commit `cdb1e3d` (clean). Each arm: seeds 62101–62130 × both first movers = 60 games.

| | A 3/3 | B 3/3 + blind RNG | C 2/3 | D 2/3 + normalized eval |
|---|---|---|---|---|
| First mover won (Wilson 95%) | 33/59 = 56% (43–68%) | 36/60 = 60% (47–71%) | 37/60 = 62% (49–73%) | 37/60 = 62% (49–73%) |
| Side with more pieces won | | | 23/60 = 38% (27–51%) | 23/60 = 38% (27–51%) |
| Mean turns · turn-limit rate | 13.6 · 3% | 16.5 · 10% | 14.6 · 7% | 15.0 · 8% |
| First mover scored on turn 1 | 27% | 22% | 12% | 12% |
| Conveyor moves per game · own-trap share | 16.0 · 86% | 14.8 · 85% | 13.8 · 85% | 14.3 · 84% |
| Lead changes · comeback rate | 4.3 · 80% | 3.7 · 67% | 3.5 · 65% | 4.0 · 73% |

(C and D have identical totals by coincidence: 46 of 60 paired games had the same winner, 17 were move-for-move identical.)

### Preregistered outcomes (rules frozen before Kane, journal #8)

| Hypothesis | Outcome | Evidence (treated − control, paired-seed bootstrap 95%) |
|---|---|---|
| HC0 the C4 signal was a screening artifact | **SUPPORTED** | C first-mover rate 62% (49–73%): ≤ 70% with the interval including 60% |
| HC1 fewer pieces to bring across wins | **INCONCLUSIVE** | C − A first mover +5.7 pts (−6.7 to +18.3); more-pieces side 38% (upper bound 51%, needed < 50%); D − C 0 (−11.7 to +11.7, needed within ±10) |
| HC2 raw-sum evaluation mis-plays unequal counts | **REFUTED** | D − C more-pieces side 0 (−11.7 to +11.7): a 15-point rise is excluded |
| HC5 turn-1 scores come from RNG foresight | **REFUTED** | B − A turn-1 score rate −5 pts (−10 to 0): a 15-point drop is excluded; edge +4 pts (unclear) |
| HC3, HC4, HD1 | **NOT_TESTED** | their interventions (P1, S3, S4) are in no arm |
| KX3-N1 … N5 (Kane) | **NOT_TESTED** | not registered, and S3 / P2 are in no arm |

Side effects for context (not gates, nothing promoted): blind RNG (B − A) +2.9 turns (−1.7 to +7.6), turn-limit
+6.7 pts (0 to +15), comebacks −13 pts (−29 to +3), effect entropy +0.05 (+0.01 to +0.08). Normalized evaluation
(D − C) changed no win rate; lead changes +0.53 (+0.08 to +1.02), entropy −0.05 (−0.08 to −0.01).

## 3. Turn-1 teleport RNG foresight as an information-access defect

Independent of win rates: every teleport move in the screen and the validation was re-run 200 times by the real
engine from the same position with random RNG states. That is what a player who cannot see the RNG would expect.

| Set | Teleport moves | Squares gained, realized | Blind expectation | Advantage (95% CI) | Realized at percentile of blind outcomes |
|---|---|---|---|---|---|
| A (production planner) | 147 | 3.73 | 2.45 | **+1.27 (+1.10 to +1.45)** | 75th |
| B (blind planner) | 352 | 2.49 | 2.48 | +0.01 (−0.14 to +0.15) | 50th |
| C / D (production planner, 2/3) | 189 / 179 | 3.48 / 3.61 | 2.08 / 2.20 | +1.40 / +1.41 | 77th |
| Screen, all 100 games | 296 | 3.42 | 2.34 | +1.09 (+0.94 to +1.23) | 72nd |
| Turn-1 teleport moves, A · screen | 32 · 70 | | | +1.17 · +0.90 | |

**Finding: a real information-access defect, independent of significance.** The production planner's look-ahead
clones the engine RNG (`server/ai.ts` `planMoves` / `planTurn` copy the state, RNG included), and the live game AI
uses the same planner (`server/game.ts:262`). On a teleport it therefore gains about 1.3 squares more than its
expected value, about half again, and the measurement shows the mechanism exactly: the blind planner falls to its
expectation (50th percentile). A human player has no such access. In self-play both sides have it, so it is
symmetric there; against a human it is not.

**It does not explain first-turn scoring.** Without foresight the first mover still scores on turn 1 in 22% of
3/3 games (A 27%). Teleports send a piece to a middle column, never to the goal, so a turn-1 score is a teleport
plus walking; the tempo comes from moving first with full actions.

Caveat on arm B: P3 replaces true foresight with a belief about one random outcome, so the blind planner steps on
teleports far more often (118 turn-1 teleport moves against 32), which is not how an expected-value planner plays.

## 4. Test suite (reported separately, unresolved)

Final runs on the finished branch; logs in `evidence/balance/v3/test-runs/`.

| Run | Result |
|---|---|
| Default `npm test` (test files run in parallel) | **116/120 pass, 4 fail.** One was a V3 test whose expectation I had not updated after a mapping change (fixed since; the V3 file passes 25/25). The other three are timing waits in `tests/referee.test.ts` ("tiers ON: an uncertain rule…", "tiers OFF (default)…", "Kane timeout…"): the verdict was still `pending` when the test checked. In the two earlier parallel runs the failing referee test was a different one ("tiers ON: a tier-1 rule…", verdict under 1500 ms) |
| Same suite with `--test-concurrency=1` (one file at a time) | **120/120 pass** (an earlier serial run had only the V3 failure mentioned above) |
| The failing referee test run alone | pass, 3 of 3 times |

The referee failures depend on scheduling: they appear only when test files compete for the CPU, and which test fails
varies between runs. That demonstrates a scheduling issue; it is not a fix. The referee tests' fixed waits remain
fragile under load, and the default `npm test` does not pass on this PC. I did not change those tests.
`npm run test:balance-v3-e2e` (test double) passes.

## 5. Independent assessment

| Question | Answer |
|---|---|
| Kane's actual contribution to experiment design | **PARTIAL.** It read the dossier, cited real games, proposed two competing explanations with falsification criteria and a two-arm discriminating design. But 0 of 5 entries met the entry contract, its design was not testable in the frozen budget, its content largely overlaps HC3/HC4, and the call cost 108 credits against an 80 ceiling |
| Did its hypotheses survive fresh-seed validation? | **NOT_TESTED.** None was registered and no arm ran its interventions. Its claim that piece count is not a reliable fairness lever is consistent with the C result, but that was not a registered Kane prediction |
| Did the starting-piece imbalance replicate? | **No.** 2/3 first mover 85% in the screen, 62% (49–73%) on fresh seeds; C − A +5.7 pts, interval includes 0. HC0 SUPPORTED |
| Does RNG foresight explain first-turn scoring? | **No** (HC5 REFUTED). Foresight is real and measured (+1.27 squares per teleport move), but turn-1 scoring persists without it |
| Is any correction justified? | **None is promoted or justified by these results.** The foresight finding justifies designing a correction (an expectation-based teleport evaluation for the live AI), tested head-to-head and against the acceptance gates, in a new approved cycle. P3 as implemented is not that correction (overconfident beliefs, longer games) |
| What remains unverified | Kane's S3 / P2 hypotheses and design; HC3, HC4, HD1; head-to-head strength of the B and D planners; human play; whether production 3/3 has a first-mover edge (A 56%, screen C0 60%, combined 45/79 = 57%, p 0.26; all four arms pooled 143/239 = 60%, p 0.003, descriptive and across different arms, not a preregistered test); whether Kane can meet a structured-entry contract; Kane cost per step |

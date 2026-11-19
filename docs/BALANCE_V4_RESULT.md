# Balance Designer V4: teleport expected-value correction, Kane pipeline recovery, credit safety, referee tests

**Status: READY_FOR_OPERATOR_V4_CORRECTION_REVIEW.** Nothing merged or deployed. Production planner, production rules (3 v 3)
and the live game are unchanged. 0 Kane calls, 0 external calls, 180 pilot games run once.

Root cause: [BALANCE_V4_ROOT_CAUSE.md](BALANCE_V4_ROOT_CAUSE.md). Journal: `balance/v4/journal.ndjson` (preregistered →
start → complete, hash chain verified).

## 1. What was built

| Piece | Where | Production impact |
|---|---|---|
| Engine-owned chance helpers: `teleportDestinations` (the one definition, also used by the engine itself), `teleportIndexProbabilities` (exact law of `rand() % n`), optional `ChanceResolver` on `applyMove` | `server/engine.ts` | none: no production caller passes a resolver; **340/340 V3 games replay identically** (`evidence/balance/v4/v3-replay-after-engine-change-*.log`) |
| Candidate planner `ev-teleport-v4.1` (source hash `3ccd64207314c1f3`) | `server/balance/v4/evplanner.ts` | none: only V4 self-play and tests import it (import-graph test) |
| Self-play option `planner: { side: 'ev-v4' }` | `server/balance/selfplay.ts` | absent = old code path; V3 decisions re-planned identically (test) |
| `reviewSettled()` (observability only) | `server/game.ts` | no behaviour change |
| Kane normalizer + KX3 replay | `server/balance/v4/normalize.ts`, `kanereplay.ts`, `balance/v4/kane-normalized.json` | none |
| Paid-call gate | `server/balance/v4/kanebudget.ts`, `kaneExplore` / `kaneVerify` | research paths only; the game referee (`kaneJudge`) is untouched |
| Referee tests: state-based waits, CPU-time performance check | `tests/referee.test.ts` | tests only |

### The candidate planner

Same placement search, evaluation, greedy loop, reply model, temperature roll and score formula as production, with one
change: **a move with a random result is valued by Σ P(destination) × evaluate(state after it)**, over every legal destination,
each produced by the real engine with a resolver. The RNG in every planner state is overwritten with a constant first. The
committed move list **ends at the first random move**; the game resolves it, the destination is public, and the planner is
asked again (`replans` in the records; 0.3 per game in arm B). There is no precommitment to an unresolved destination.

Exact enumeration is used for every decision. One labelled approximation exists, only in ranking whole-turn placement candidates:
when a candidate has more than 16 possible end states, the opponent reply is simulated for 16 equal-probability strata
(ordered by public evaluation, no RNG). On test boards the largest score error versus exact replies was 0.23 with the same
leading plan (8 strata: 0.91; measured in `tests/balance-v4.test.ts`). Random events deeper than the first in a turn are
averaged without further continuation. `evaluateCached` is the production `evaluate` with a memo, tested equal.

Cost: 12.7 s CPU per self-play game against 4.2 s for production (about 3×), on this PC.

## 2. Tests

`tests/balance-v4.test.ts`, 16/16 (log: `evidence/balance/v4/test-runs/`):

* exact law of `rand() % n` (sum 1, within 1e-9 of 1/n; brute-force counting on a small modulus; 200k empirical draws within 5 SE);
* `teleportDestinations` is what the engine uses: every real teleport lands on `destinations[rng % n]`;
* `moveOutcomes`: every destination once, engine probabilities, each outcome equal to a real engine run with an RNG chosen to produce it, input untouched, independent of the RNG; R1 variant via the same helper;
* **hidden-RNG invariance**: same public state, five different RNG states → identical ranked candidates, scores (9 decimals), chosen plan and committed moves; **power check**: the production planner's moves DO change with the RNG on the same boards;
* committed move list ends at the first random move;
* production planner re-plans a recorded V3 game identically; candidate unreachable from `game.ts` / `server.ts` / `ai.ts` / `trial.ts`;
* EV self-play game deterministic and engine-replayable;
* Kane normalization (KX3 replay, rule cases) and credit safety (below).

Weak spot: the "value is the average, not the best" test asserts the identity only when the greedy step chooses that move; the
invariance and outcome-equality tests carry the real weight.

## 3. Pilot (preregistered, run once)

`balance/v4/pilot-protocol.json` (sha256 `4cfaf95e…`, journal #1, committed before any game). Seeds 64001–64030, fresh.
Run `2026-11-19T21-42-56Z-v4-pilot`, commit `f59c8ee` (clean), 180/180 games, 4.9 min with 6 workers, 0 external calls,
0 illegal moves / errors / softlocks, **180/180 engine replays identical**, dataset hash `a00a93d8aa03749c`,
`evidence/balance/v4/pilot/2026-11-19T21-42-56Z-v4-pilot/` (records, manifest, `evaluation.json`).

### Information fairness (teleport foresight, V3 method: 200 blind engine re-runs per teleport move)

| Set | Teleport moves | Realized | Blind expectation | Advantage (95% CI) | Percentile |
|---|---|---|---|---|---|
| A production vs itself | 160 | 3.60 | 2.32 | **+1.28 (+1.11 to +1.44)** | 76th |
| B EV vs itself | 45 | 1.36 | 1.35 | **+0.01 (−0.40 to +0.41)** | 50th |
| C, moves by the EV side | 22 | 0.77 | 0.81 | −0.04 (−0.70 to +0.61) | 49th |
| C, moves by the production side | 85 | 3.64 | 2.43 | +1.20 (+0.98 to +1.43) | 75th |

Gates: I1 PASS, I2 PASS, I3 PASS, I4 (leak present in control) HOLDS → **information fairness PASS**. A replicates V3's
+1.27 almost exactly, so the measurement works; the EV planner sits at the 50th percentile, i.e. it does no better than its own
expectation. The pilot interval for B (±0.4) cannot rule out a small residual effect, but it excludes the production level by a
wide margin, and the unit tests show the decision is invariant to the hidden RNG by construction.

### Behaviour and gameplay, B (EV) minus A (production), paired by seed, bootstrap 95%

| Measure | A | B | B − A (95% CI) |
|---|---|---|---|
| First-mover win rate (decisive) | 33/59 = 56% (43–68%) | **16/58 = 28% (18–40%)**, p 0.001 vs 50% | **−0.28 (−0.45 to −0.12)** |
| First-mover edge \|rate − 0.5\| | 0.06 | 0.22 | +0.17 (−0.02 to +0.29) |
| Human-side win rate | 42% | 36% | −0.06 (−0.23 to +0.12) |
| First mover scores on turn 1 | 35% | **0%** | −0.35 (−0.47 to −0.23) |
| Turn-1 openings placing a teleport | 22/60 | 0/60 | |
| Teleport placements / triggers per game | 1.52 / 2.67 | 0.58 / 0.77 | |
| Mean (median) turns | 16.6 (11) | 18.8 (13) | +2.2 (−2.8 to +7.2) |
| Turn-limit rate · draws | 11.7% · 1 | 11.7% · 2 | 0 (−0.10 to +0.10) |
| Own-trap conveyors per game · self-trigger share | 14.9 · 87% | 17.9 · 86% | +3.0 (+2.0 to +4.1) |
| Effect entropy · distinct openings (first 3 placements) | 0.76 · 24 | 0.73 · **5** | −0.03 (−0.08 to +0.02) |
| Lead changes · comeback rate | 4.2 · 70% | 5.6 · 78% | +1.4 (+0.6 to +2.2) · +0.08 (−0.07 to +0.23) |

Preregistered gates: G1 length INCONCLUSIVE, G2 turn limit PASS, G3 fairness INCONCLUSIVE, G4 diversity PASS, G5 counterplay
PASS, G6 safety PASS → **gameplay adequacy INCONCLUSIVE** (by the frozen rule; no gate failed).

### Strength, C (EV vs production, every seed with EV on each side and each first-mover order)

EV won **19/60 = 32% (21–44%)** of decisive games (p 0.006 vs 50%), S1 = "weaker". As the human side 5/30 = 17% (7–34%),
as the AI side 14/30 = 47% (30–64%); moving first 23%, second 40%. Mean 14.7 turns, 5% turn limit, 0 draws.

### What the data say (reviewer reading, beyond the gates)

1. **The production first-mover edge in self-play was built on foresight.** Production opens with a teleport in 22 of 60 games
   and scores on turn 1 in 35%; the EV planner never does either, because an honest expectation of stepping on a teleport is
   poor (1.35 squares) while a foreseen one is good (3.6). V3's HC5 ("turn-1 scores come from RNG foresight") was REFUTED by
   arm P3, whose wrong-belief planner kept stepping on teleports (118 turn-1 teleport moves). That V3 result stands as recorded;
   V4 is a different instrument and it shows the opposite pattern under an expectation-based planner.
2. **A new problem appears, not proven by the gates but clearly signalled:** with both sides honest, the second mover wins 72%
   (first-mover 28%, interval excludes 50%). The edge gate is INCONCLUSIVE only because its paired interval reaches −0.02.
3. **Opening diversity collapses:** 5 distinct three-placement openings against 24, all shove-conveyor lines. Overall effect
   entropy barely moves, so the preregistered diversity gate passes; the opening count was reported, not gated.
4. **Counterplay improves:** more lead changes (+1.4, interval excludes 0), comebacks not worse.
5. **Strength:** the EV planner loses about two of three games to the foresight planner. Part of that is the information
   advantage it no longer has (the production side gains +1.2 squares per teleport in C); this pilot cannot separate that from
   any genuine planning weakness. The large human-side / AI-side asymmetry (17% vs 47%) is unexplained.

## 4. Kane research pipeline (offline, stored KX3 entries only)

Historical result **unchanged**: 0 of 5 registered by the parser frozen before the V3 call; all Kane hypotheses NOT_TESTED in V3.
Raw files untouched (sha256 checked before and after; `bd6f344f…`).

| Entry | Status | Why |
|---|---|---|
| KX3-N1 (S3 = 1) | **VALIDATED_PROPOSAL** | both metrics written as exact display labels → `first_mover_win_rate` decrease 0.15, `turn1_score_rate` decrease 0.10; cause = label of `interaction`; verdict phrase → `more-evidence-needed` |
| KX3-N2 (P2 = 0) | REJECTED_AMBIGUOUS | metrics resolve exactly (`conveyor_per_game` −5, `abs_first_mover_edge` −0.10) but the cause "AI planner valuation of own-trap benefit" is free text; candidate `planner` listed, not chosen |
| KX3-N3 (conclusion: S3 vs P2) | **VALIDATED_PROPOSAL** | as N1; a conclusion keeps its free-text cause verbatim (contract V4) |
| KX3-N4 (S3, short) | REJECTED_AMBIGUOUS | invented id `first_mover_turn1_cross_rate`; candidates listed, none substituted |
| KX3-N5 (P2, short) | REJECTED_AMBIGUOUS | invented id `conveyor_moves` (candidate `conveyor_per_game`); its second prediction is empty and is not invented |

No entry has irrecoverable missing information beyond N5's empty second prediction (not required). Testable predictions:
N1/N3's two. Supported interventions: S3 and P2, both in the catalog. Operator decisions needed: N2's cause, N4's and N5's
metric. Every record keeps RAW_SUBMISSION (verbatim body + sha256), NORMALIZED_CANDIDATE (each rule application with the
original words) and its status, with provenance split into **Kane-authored** (checked), **system-normalized** (normalizer
version + hash) and **human-approved experiment** (null for all). The normalizer only maps exact ids, exact labels and known
phrases; it does not improve or complete Kane's reasoning.

Prospective protocol for Kane's design: `balance/v4/kane-s3-p2-protocol.json` (control, S3 alone, P2 alone, common matched
seeds, 240 games, K1−K0 / K2−K0 / K1−K2). **Prepared, not authorised, not run.**

## 5. Kane credit safety

kane-cli 0.10.4 has `--max-steps` and `--timeout` and no spending limit; the balance is only readable before and after a call.
**No enforceable hard cap exists**, so paid research execution is **disabled in code** (`PAID_RESEARCH_EXECUTION = 'disabled'`):
`kaneExplore` and `kaneVerify` refuse a real CLI unless the single-use token of `runPaidCall` is active, and `runPaidCall` refuses
while disabled. When re-enabled by a code change it still requires a per-run approval that acknowledges the ceiling is a local
estimate, a matching `KANE_PAID_RUN_AUTH`, a readable balance, estimate = steps × 3.1 measured credits/step ≤ ceiling, a
balance ≥ 1.5× ceiling, no earlier call for that run (no retries), and no unresolved CEILING_EXCEEDED / SPEND_UNKNOWN in the
ledger. Before/after balances and the real delta are recorded. Tests use doubles only (refusals, 107.934 exceedance, timeout
with unknown spend, no-retry, and a fake CLI posing as 0.10.4 that is refused before any `run`).

Checked on the PC: no running kane process, no scheduled task referring to Kane or this repo.

**Limitation kept in view:** the game server's referee (`kaneJudge`) is a separate production path. With kane-cli installed and
`KANE_REFEREE` not `off`, a human placing a tier-3 rule starts a paid Kane review. V4 did not change production; the operator
should decide whether the live referee should also default to off.

## 6. Referee test instability

Root cause: each waiting test polled for at most 20 s, while a background review legitimately takes up to 15 s browser
readiness + CLI time + cleanup under load (the production pipeline is bounded by `openChrome`'s 15 s wait and the CLI
hard-kill timer). Under parallel load the poll gave up while the review was still inside those bounds, and the test then
asserted on the still-`pending` verdict. The tier-1 test asserted wall-clock < 1500 ms, which measures the scheduler as much as
the code. Baseline before the fix: 118/120 (2 referee waits expired; `baseline-parallel-1.log`).

Fix: `reviewSettled()` exposes the review promise; tests wait for the genuine terminal state with a bound derived from the
kane.ts limits and fail with the verdict's timing if exceeded; `KANE_TIMEOUT_S=20` in the test environment; the tier-1
performance requirement is kept (1500 ms) but measured as CPU time, with correctness asserted separately (decided
synchronously, never Kane). No timeout was raised blindly; no production timing changed.

Record (all logs in `evidence/balance/v4/test-runs/`, Kane = test double, `KANE_CLI` pointed at the fixture):

| Run | Result | Wall time | Slowest review settle |
|---|---|---|---|
| Baseline, before the fix, default parallel (my smoke games were also running) | 118/120, 2 referee waits expired while still `pending` | 9.4 min | n/a |
| After the fix, default parallel, runs 1–3 (run 3 with 4 extra CPU-burning threads) | 134/136 each: all referee tests pass; 2 **V2 gate tests failed because of my new credit gate** (they simulate a "real" CLI). Fixed by exempting only the repo fixture's `-gate-test` versions | 2.0 / 3.6 / 3.6 min | 6.0 s |
| Final code, default parallel | **136/136** | 1.9 min | |
| Final code, default parallel with 4 extra CPU-burning threads | **136/136** | 4.6 min | **18.3 s** |
| Final code, serial (`--test-concurrency=1`) | **136/136** | 2.9 min | |

Under extra load one review needed 18.3 s to reach its terminal state, just under the old 20 s poll: the referee did not stall,
the old test's budget was simply below the pipeline's own bounds. Five parallel runs are evidence, not proof, that the
instability is gone; a failure now reports how long the review ran and where it stopped.

## 7. Independent review

| Dimension | Outcome |
|---|---|
| RNG root cause | **Confirmed** (source paths in the root-cause report; A replicates +1.28) |
| Information fairness | **PASS** (invariance by construction and test; B +0.01, EV side in C −0.04; small residual not excludable with 45 moves) |
| Correctness of expectation model | **PASS**, with stated limits: exact engine law and outcome set; one labelled reply approximation (≤0.23 score error on test boards); deeper chance nodes averaged without continuation |
| Planner behavioural change | **Measured**: teleports avoided (placements −62%, triggers −71%), turn-1 scoring 35% → 0%, first-mover 56% → 28%, conveyors +3/game, lead changes +1.4, openings 24 → 5, 3× CPU |
| Gameplay adequacy | **INCONCLUSIVE** by the preregistered gates; reviewer flags a likely new problem (second-mover advantage, opening collapse) and a weaker planner (32% vs production). Not SUFFICIENT |
| Kane proposal normalization | **Recovered 2** (N1, N3), **ambiguous 3** (N2, N4, N5), invalid 0; provenance PASS; V3 history unchanged |
| Experiment-design usability | **PARTIAL**: Kane's S3 / P2 / control design is written as a matched-seed protocol with catalog interventions; not run, N2 needs an operator decision, and it must state which planner it uses (see recommendation) |
| Kane credit safety | **Explicitly limited**: no hard cap is enforceable with kane-cli, so paid research calls are disabled; live referee path remains (operator decision) |
| Default parallel tests | **136/136** in 2 final parallel runs (one under extra CPU load) and serial; referee waits fixed by state-based synchronisation; 2 V2 gate tests I broke along the way were fixed (§6) |
| Replay and data integrity | **PASS**: 340/340 V3 + 180/180 V4 replays, manifests, hash-chained journal, run-once enforced |
| Production isolation | **PASS**: `ai.ts` untouched, engine change replay-neutral, `game.ts` observability only, candidate unreachable from the server |

Non-pilot games played (tooling smoke and tests, not evidence): about 28, all on throwaway seeds 99001–99399.

## 8. Answers to the four questions

1. **Did we remove the AI's ability to foresee hidden teleport outcomes?** In the candidate planner, yes: its decisions are
   invariant to the hidden RNG (tested with a power check against production) and its realized teleport results sit at its own
   expectation (+0.01, 50th percentile, against +1.28 for production). The **live** AI still has foresight: the candidate is not
   in production until you decide so. The referee trial page also discloses the RNG (separate, unchanged).
2. **Did that produce acceptable gameplay?** Not shown. The preregistered verdict is INCONCLUSIVE (length and fairness intervals
   too wide at 60 games). The data point to another problem: honest self-play gives the second mover 72% of decisive games,
   openings collapse to five conveyor lines, and the candidate loses 68% of games to the foresight planner. Removing the leak
   exposed that production's apparent first-mover balance in self-play leaned on foresight.
3. **Can genuine Kane submissions become valid, auditable proposals without losing meaning or provenance?** Partly. 2 of 5
   historical entries become valid proposals with every transformation logged against Kane's own words; 3 need an operator
   decision and the normalizer refuses to guess. It recovers what Kane wrote; it does not make Kane's contract compliance reliable.
4. **Are the pipeline, resource controls and default suite reliable enough for another cycle?** The evidence pipeline is
   (preregistration, run-once, replays, manifests, journal). Resource control is reliable only because paid research calls are
   disabled; a Kane cycle would need you to accept that its credit ceiling is an estimate. The default suite passed 136/136 in parallel twice (once under extra CPU load) and serially, after the referee fix; that is good evidence for another offline cycle, not proof the flakiness can never return.

## 9. Recommendation

Do not put the candidate into production on this pilot. Next, as a separate approved decision: (a) run the EV planner on the
untouched holdout seeds **65001–65060** with enough games to settle first-mover asymmetry (paired EV-vs-EV against production,
plus an opening-diversity measure registered as a gate), and investigate the human/AI-side asymmetry; (b) if the second-mover
advantage holds, test balance levers **under the honest planner** (Kane's S3/P2 protocol was designed against the foresight
planner; S3 targets turn-1 scoring that no longer happens under EV, so it should be re-scoped before it is run);
(c) decide whether the live Kane referee should default to off.

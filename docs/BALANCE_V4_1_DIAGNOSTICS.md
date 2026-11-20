# Balance Designer V4.1: referee safety, and why the honest planner plays the way it does

**Status: READY_FOR_OPERATOR_V4_1_DIAGNOSTIC_REVIEW.** Branch `claude/balance-designer-v4-1`, stacked on V4 (PR #6).
Nothing merged or deployed. **0 new games played** (every diagnostic reads the stored V4 pilot records or asks the planner
about recorded positions). Holdout seeds 65001–65060 untouched. 0 Kane calls; paid Kane research stays disabled. The EV
candidate is not promoted.

Operator decisions implemented (2026-11-20 review): referee opt-in with a fail-closed tier 3, and no hidden-RNG disclosure in
trial pages. Everything else here is diagnosis and a plan.

## 1. Referee safety (production code, approved by the operator)

| Change | Where | Before | After |
|---|---|---|---|
| Kane referee is opt-in | `server/kane.ts` | on unless `KANE_REFEREE=off` (any server start with kane-cli installed could spend credits) | on only with `KANE_REFEREE=on` exactly |
| Engine-only policy | `server/game.ts` `referee()` | every rule that passed the engine checks went **live** labelled "unverified" | tier selection always runs without Kane: **tier 1/2** = `engine-approved`, live, labelled as the engine; **tier 3** = `unverified`, **never placed** (also not with `ALLOW_UNVERIFIED_RULES`, which only applies to Kane-mode failures) |
| Trial pages | `server/trial.ts` | what-if scenarios cloned the game RNG, so a teleport scenario's "Ended on" square on the public `/trial/…` page was the next real destination | scenarios run on a fixed public `TRIAL_RNG`; the RNG is no longer in the signature; the page says teleport destinations are an example |
| Labels | `client/app.js`, `README.md` | "NOT Kane-verified" for rules that were live | "NOT verified and was not placed"; engine-only header says uncertain rules are not placed |

The engine and the game RNG are untouched: real teleports still draw from `State.rng`, and V1–V4 replays are unaffected
(the V4 test suite replays V3 decisions and a V4 pilot game exactly).

Tests (`tests/referee-v41.test.ts`): Kane off by default and only exactly `on` enables it; engine-only tier 1 goes live as
`engine-approved`; engine-only tier 3 is `unverified`, not placed, not placed later, no Kane process, also with
`ALLOW_UNVERIFIED_RULES=1`; trial pages and signatures identical for five hidden RNG states, while (power check) the real
next teleport differs between them. Two existing tests were updated to the new policy (engine-only AI rule labels; trial
signature no longer depends on the RNG).

## 2. Diagnostics

Reproduce with `npm run balance:v41:diagnose` → `evidence/balance/v4/diagnostics/v41-diagnostics.json`
(about 35 min on this PC, almost all of it planner calls on recorded positions).

### D1. Why EV-vs-EV favours the second mover (first mover 28% in arm B)

**Mechanism (measured):**

| | A production | B EV |
|---|---|---|
| Games with a capture on turn 2 (the second mover's first turn) | 42/60 | **60/60** |
| Pieces captured on turn 2 | 77 | **120** (2 per game) |
| …through the trap the second mover had just placed (forced move) | 70 | **120 (all)** |
| First mover's squares to go: after turn 1 → after turn 2 | 9.2 → 12.9 | 9 → **15** |
| First mover's own plan predicted (turn-1 score) / its real evaluation after turn 2 | 9.9 / −2.2 | 9.0 / **−5.0** |

The honest first mover always opens the same way: a forward shove ("conveyor") in front of its three pieces, then three
moves, ending in the middle columns. The second mover then places its own conveyor and rides it straight into those pieces,
capturing two and sending them home. With foresight, production's first mover often had a better opening, a teleport it
could see would land well (22/60 openings, turn-1 scores in 35% of games), so the same exposure cost it less.

**Why the planner walks into it:** the whole-turn look-ahead simulates the opponent's reply as moves only (`replyValue` →
greedy moves). The opponent never places in the model, but its placement is exactly what makes the capture possible. With
the placement-aware reply variant (K2), the predicted value of the chosen opening drops from +4.5 to −5.0 on every probed
position, matching what actually happens.

**What is not explained:** even with K2, and with hold-back candidates added (K3), the planner still picks the full rush. Yet
against the real EV reply, placing the conveyor and moving 0 pieces scores −3.3, 1 move −4.2, 2 moves −6.1, 3 moves −5.0
(12 positions). Every option is negative after turn 2, partly because the comparison point is right after the second mover
moved. **Whether the second-mover edge is intrinsic to the rules or an artefact of a myopic planner is not settled.** The
greedy move choice (immediate evaluation only) and the one-ply opponent model are the leading suspects.

### D2. Why the planner is stronger on the AI side

Evaluation is exactly mirror-symmetric (0/40 positions differ between a position and its left-right mirror with sides
swapped), and so is the trap-cell search (0/40). Decisions are not:

| Planner | Positions | Chosen plan differs from the mirrored one | Score differs | Move list differs |
|---|---|---|---|---|
| production | 40 | 12 | 17 | (not checked) |
| EV v4.1 | 40 | 7 | 12 | 16 |
| EV + side-relative order (K1) | 40 | **0** | **0** | **0** |

**Cause:** equal-value candidates are broken by board-coordinate order. `legalMoves` lists squares in key order ("x,y" from
column A), and the greedy loop keeps the first of equal moves. Low columns are the AI's goal side and the Human's home side,
so the same tie is broken towards the leading piece for one side and the trailing piece for the other. The reply simulation
inherits this. Ordering candidates relative to the moving side (distance to its own goal, row, forward/up/down/back) removes
every asymmetry on the same 40 positions. The pilot's side gap (EV as Human 17%, as AI 47%; production as AI 83% of the
games it played as AI against EV) is consistent with this, but its size is not yet attributed: that needs games (K1 below).

### D3. Why openings collapse from 24 to 5

| | A production | B EV |
|---|---|---|
| Distinct turn-1 placements chosen | 4 | 2 (one per side: conveyor towards own goal) |
| Margin between best and second turn-1 candidate | 3.35 | 4.83 |
| Candidates within the 0.6 temperature window on turn 1 | 1.07 | **1.00** |
| Teleport candidate on turn 1: present / mean rank / gap to top | 60 / 2.6 / 3.0 | 60 / 2.7 / 5.1 |

The temperature roll only chooses among candidates within 0.6 of the best. On turn 1 there is never more than one, so the
opening is deterministic per side. Production's extra variety came largely from the teleport line: it ranked first in 22/60
games, exactly when foresight said the teleport would land well. Its "diversity" was the planner reading the hidden RNG.
Under EV the teleport's expected value is poor (gap 5.1), and the remaining lines are near-deterministic shove conveyors.
The collapse is a real gameplay concern, but it is not a bug in the expectation model.

## 3. Proposed single-factor corrections (implemented as off-by-default variants, none promoted)

`server/balance/v4/evplanner.ts` `EVVariant`; with all variants off the planner is exactly `ev-teleport-v4.1` (test
re-plays V4 pilot game B-64003-human to the same final hash).

| Id | Factor | Fixes | Evidence so far | Status |
|---|---|---|---|---|
| K1 | side-relative tie-breaking (`sideRelativeOrder`) | Human/AI asymmetry | mirror mismatches 7/12/16 of 40 → 0 | implemented, tested, no games |
| K2 | placement-aware opponent reply (`placementAwareReply`) | mispredicted turn-2 punishment | prediction +4.5 → −5.0 (= reality); opening unchanged | implemented, tested, no games |
| K3 | hold-back candidates (`truncatedCandidates`) + executor plays the chosen prefix | rush-only openings, exposure | hold-back is better against the real reply (−3.3 vs −5.0); planner does not yet choose it; **executor part not implemented** | partial |
| — | opening temperature / candidate scale | opening collapse | deferred until K2/K3 results | not started |

Rules-level levers are deliberately not proposed yet: the planner flaws above would contaminate any rules experiment.

**Kane's S3 / P2, rescoped (originals preserved):** Kane's KX3 entries, their provenance and their normalized form are
unchanged (`balance/v4/kane-normalized.json`). Their predictions were written against the foresight planner. Under EV the
turn-1 cap (S3 = 1) limits the first mover to one move, and the probe shows one move is less exposed than three (−4.2 vs
−5.0). So S3 may raise the first-mover rate rather than lower it. A rescoped test must be a new, two-sided hypothesis with
operator/Claude provenance, registered separately; Kane's own prediction stays as written and would be judged as written.
`balance/v4/kane-s3-p2-protocol.json` remains PREPARED_NOT_AUTHORISED.

## 4. Experimental plan (prepared, not authorised, not run)

`balance/v4/v41-dev-plan.json`: fresh development seeds **66001–66030**, control E0 (= V4 candidate) plus K1, K2, K3 each
EV-vs-EV (60 games each, paired by seed) and a K1-vs-E0 mirrored head-to-head (60) = **300 games**, 0 Kane, 0 external calls.
Same gates as the V4 pilot plus "information fairness unchanged" and "mirror mismatch 0 for K1". It needs an approved budget,
then a journalled preregistration (sha256) before the first game. At most one factor at a time is frozen into a V4.2 candidate.
Only that frozen candidate, never these arms, is later evaluated on the holdout 65001–65060.

## 5. Tests

Default parallel `npm test` on the finished branch: **144/144** twice (14.9 min and 3.3 min wall time; the first run shared the PC with other load), logs `evidence/balance/v4/test-runs/v41-parallel-*.log`. New: `tests/referee-v41.test.ts` (4), `tests/balance-v41.test.ts` (4).

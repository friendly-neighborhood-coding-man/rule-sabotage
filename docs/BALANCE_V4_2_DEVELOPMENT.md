# Balance Designer V4.2: 300-game development experiment (planner-specific)

**Status: READY_FOR_OPERATOR_V4_2_DEVELOPMENT_REVIEW.** Nothing merged, deployed or promoted. Holdout 65001–65060 untouched.
0 Kane calls, 0 external calls. Scope: one self-play planner family (the EV candidate and three single-factor variants).
**None of this says anything about human players or other AI strategies.**

## 1. Preconditions (all passed before any game)

| Operator condition | Result |
|---|---|
| K3 executes the chosen truncated sequence | `selfplay.ts`: a chosen hold-back plan is played exactly and the turn ends there (`holdBackTurns` recorded); re-planning after a random outcome is unchanged; a hold-back prefix can never contain a random move (enforced). Test: on a real hold-back turn the recorded moves equal the chosen prefix and actions were left unused |
| K1, K2, K3 verified independently, with manipulation checks | `npm run balance:v42:manip` (no games), 40 recorded positions (new sample, arms A/B/C) + 30 synthetic positions (seeded random legal play) |
| K1 mirrored states beyond the original sample | first run: 0/40 recorded but **2/30 synthetic still asymmetric**. Cause: the reply-strata approximation ordered equal values in board-coordinate order, and the engine's exact draw law gives destination index 0 a probability ~1e-9 different, which flipped stratum boundaries in the mirror. Fixed inside K1 only (side-relative tie order, 1e-9 comparisons, side-relative effect order). Final: **E0 39/70 asymmetric, K1 0/70** |
| K2 reported honestly | prediction changed on 25/40 and 30/30 positions; mean absolute error against the real reply **2.65 → 0.61** (recorded) and 7.76 → 0.74 (synthetic); chosen plan changed on only 23% / 13%. Earlier probes: the chosen opening did not change. Better prediction was not assumed to change actions |
| K3 manipulation | hold-back offered on 28/40 and 30/30 positions, chosen on 1/40 and 5/30 |
| Frozen before the run | `balance/v4/v42-dev-protocol.json` (hypotheses HK1–HK3, seeds, metrics, decision rules) + implementation hashes (engine `f92354f4…`, planner files `a87d4d49…`, EV planner `3af55720…`) + manipulation results sha256, journal #4, commit `827fce2` (clean) |
| Tests | V4 + V4.1 + V4.2 tests 25/25 on the frozen code |

## 2. The run

`evidence/balance/v4/v42/2026-11-20T08-33-47Z-v42-dev/`: 300/300 games run once (journal #5 start, #6 complete),
64 min, **0 external calls**, 0 illegal moves / errors / softlocks, **300/300 engine replays identical**, dataset hash
`5083708e86c91217`. Running K2 is expensive: 280 s CPU per game, against 11 s for E0.

## 3. Results (Kx minus E0, paired by seed, bootstrap 95%; rates with Wilson 95%)

| | E0 control | K1 side-relative ties | K2 placement-aware reply | K3 hold-back |
|---|---|---|---|---|
| First mover wins (decisive) | **14/59 = 24% (15–36%)** | **26/56 = 46% (34–59%)** | 19/51 = 37% (25–51%) | 21/58 = 36% (25–49%) |
| Δ vs E0 | | **+0.23 (+0.00 to +0.46)** | +0.14 (−0.03 to +0.30) | +0.13 (−0.01 to +0.25) |
| Human side wins (decisive) | 21/59 = 36% (25–48%) | **29/56 = 52% (39–64%)** | 9/51 = 18% (10–30%) | 45/58 = **78%** (65–86%) |
| \|Human-side edge\| Δ vs E0 | 0.14 | **−0.13 (−0.23 to −0.03)** | +0.18 (+0.05 to +0.31) | +0.13 (−0.05 to +0.30) |
| Turn-2 captures per game | 2.0 | 2.0 | 2.0 | 2.0 |
| Mean (median) turns | 19.5 (13) | 25.3 (15), Δ +5.8 (−1.3 to +13.0) | **38.1 (30)**, Δ +18.6 (+11.5 to +25.2) | 16.2 (10), Δ −3.4 (−8.1 to +1.1) |
| Turn-limit rate · draws | 15% · 1 | 22% · 4 | **43%** · 9 | 8% · 2 |
| Lead changes · comeback rate | 5.7 · 81% | 6.2 · 100% | 6.0 · 98% | 8.0 · 98% |
| Effect entropy · distinct openings | 0.76 · 6 | 0.71 · 2 | 0.77 · 6 | 0.65 · 5 |
| Hold-back turns per game | 0 | 0 | 0 | 1.9 |
| Teleport foresight (info fairness) | +0.20 (−0.28 to +0.64) | +0.08 (−0.55 to +0.63) | +0.23 (−0.14 to +0.59) | −0.19 (−0.60 to +0.20) |

Head-to-head H1 (K1 vs E0, mirrored seats and first-mover order): K1 won 35/58 = 60% (48–72%); as Human 15/28 = 54%,
as AI 20/30 = 67%.

### Preregistered outcomes

| Hypothesis | Manipulation | Outcome | Why |
|---|---|---|---|
| HK1: the side gap comes from tie-breaking | PASS | **SUPPORTED** | \|Human-side edge\| −0.13 (−0.23 to −0.03) |
| HK2: the second-mover edge comes from the reply model ignoring placements | PASS | **REFUTED** | turn-2 captures unchanged (2.0 in every game); first-mover change unclear (+0.14, interval includes 0) |
| HK3: holding back fixes exposure and openings | PASS | **REFUTED** | turn-2 captures unchanged; first-mover change unclear (+0.13, interval includes 0) |

Guards: K1: length G1 and turn-limit G2 INCONCLUSIVE, diversity, comebacks, safety and information PASS. K2: **G1 length FAIL, G2
turn limit FAIL**. K3: diversity G4 INCONCLUSIVE (entropy −0.10), others PASS. Information fairness held in every arm.

## 4. The crucial question: rules or planner?

By the frozen decision rule: **first-mover imbalance PLANNER-DRIVEN (this planner family), via K1**; **Human/AI-side gap
PLANNER-DRIVEN (tie-breaking)**.

What that does and does not mean:

* For this EV planner, the large second-mover advantage (first mover 24%) and the side gap are mostly artefacts of
  **coordinate-order tie-breaking**. A purely technical change that makes the planner treat both sides identically brings
  first-mover wins to 46% and the Human side to 52%. No rules change was needed for this planner to play near 50:50.
* The first-mover result is **fragile**: its interval's lower bound is +0.002. A second, independent sample is needed before
  relying on it.
* **My V4.1 mechanism was wrong.** Turn-2 captures are exactly 2.0 in every game of every arm, including K1, where the
  first mover nonetheless wins about half the time. The turn-2 capture is real but is not what decides these games. HK2 and
  HK3 are refuted as stated.
* **Openings are deterministic.** In E0, K1 and K2, the first two turns are identical in every game with the same first mover
  (one sequence per side; K3: 2 and 7; H1: 2 and 1). The 60 games per arm differ only after turn 2 (planner noise,
  temperature, teleports). The paired intervals treat seeds as independent, so they are **optimistic about the openings**.
  Opening diversity did not improve in any arm (K1: 2 distinct openings).
* K2 makes the planner predict better but play longer and draw-prone games (43% turn limit) and widens the side gap. K3
  holds back about twice a game and adds counterplay, but flips the side gap (Human 78%) and lowers diversity.
* None of this says anything about whether the **rules** are balanced for humans or other AIs. It says that this planner's
  self-play numbers were dominated by its own implementation details, so they should not be used to tune the rules yet.

## 5. Recommendation (operator decisions)

1. Freeze **EV + K1** as the V4.2 candidate: the only factor with a supported effect and no failed guard. Before the holdout,
   watch its length (+5.8 turns, turn limit 22%, both inconclusive) and its 2 deterministic openings.
2. The holdout 65001–65060 should evaluate that frozen candidate once, with the opening determinism handled in the design
   (for example, report results per opening and count independence by opening, not by seed). That needs your approval.
3. Do not adopt K2 (length and turn-limit gates failed, 25× CPU) or K3 (side gap flips, diversity drops) in this form.
4. Opening collapse is still unsolved and is now the main gameplay concern under the honest planner.

## 6. Non-dataset games

Throwaway seeds only: 3 timing games (99401), 12 tooling-smoke games (99403), and test games (99401, 99402). None is
evidence.

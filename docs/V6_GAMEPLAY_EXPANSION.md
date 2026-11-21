# Rule Sabotage V6: gameplay expansion (EXPERIMENTAL, not production)

Status: **READY_FOR_OPERATOR_V6_GAMEPLAY_REVIEW**

> Follow-up: V6.1 (`rule-sabotage/v6.1-all-piece-proximity@1`) replaces rule A1 with A2 (no new effect next to ANY piece) as a separate, selectable ruleset. See `docs/V6_1_ALL_PIECE_PROXIMITY.md`. This V6 ruleset is unchanged and still the default.

V6 is a separately versioned experimental game built on top of the PR #14 playtest branch. It answers the two problems
from the first human playtest: the 7×7 board was too small, and players could surround opposing pieces with trap effects.
The 7×7 game, the V1–V5.3 policies, their evidence and their hashes are unchanged (checked by tests, see §6).

Play it: `npm run play:v6` and open http://127.0.0.1:3106. Tests: `npm run test:v6`.

## 1. What changed (ruleset `rule-sabotage/v6-13x9-no-adjacent-effects@1`)

| Rule | 7×7 game (unchanged) | V6 |
|---|---|---|
| G1 board | 7×7, columns A–G | **13 columns × 9 rows**, columns A–M, rows 1–9. The race still runs along the columns: Human A → M, AI M → A |
| G2 start | 3 pieces on rows 2, 4, 6 | 3 pieces per side on rows **3, 5, 7** (centred, top/bottom mirror, left/right mirror between sides) |
| G3 teleport | random empty square of columns B–F | random empty square of columns **B–L** (the same rule: every column except the two start/goal columns) |
| **A1 placement** | any cell with no piece and no enemy effect | additionally **no new effect within Chebyshev distance 1 of any opposing piece** (the 8 surrounding squares) |
| Turn limit | 60 turns (30 each) | **unchanged, 60**: see §3 for the evidence |

Everything else is the production rule set: actions per turn, stacking, capture, the six effects, burn-on-entry, the
chain cap of 4, at most 3 cells per placement, scoring, the win condition and the turn-limit tie-break.

### Rule A1 in detail

* Checked by `validatePlacement` in `server/v6/engine.ts`, the server-side authority. The HTTP endpoint, the referee and
  every AI candidate generator go through it; the UI only displays what the server reports.
* A cell is closed if it is horizontally, vertically or diagonally next to **any** opposing piece still on the board
  (stacks and pieces sent back to their start square included; scored pieces protect nothing).
* The piece's own cell stays excluded by the existing occupancy rule (reported as "has a piece on it").
* A multi-cell placement is rejected **as a whole** if any one cell is closed. The reason names the cell and the guarding
  piece, for example: *"L5 is next to the opponent piece on M5. New effects cannot be placed on the 8 squares around an
  opponent piece, so this 2-cell placement is rejected as a whole."*
* A rejected human request costs nothing: no cell is set and the placement step stays open, so the player can pick again.
* Squares next to the player's **own** pieces stay allowed (self-propulsion strategies work, tested).
* Effects already on the board are never removed or disabled when a piece moves next to them (tested: they still fire).
* Removing your own effects is always allowed, even next to an opponent piece. Re-using an own-effect cell for a **new**
  effect counts as a new placement and is subject to A1.
* Human and AI parity: one function judges both. A test compares every one of the 117 cells of a position with its mirror
  image for the other side, and both sides' placements go through the same `refereeV6`.

### Interface

While you pick cells, closed squares are hatched in red with a tooltip; clicking one explains why. If the server refuses a
placement, its reason is shown under the board. The help panel explains the rule. The AI panel shows how many squares the
rule closed for the opponent this turn and, if it made no move, why (see §4).

## 2. How the opponents were made compatible

The three opponents are **V6 adaptations**, labelled `v6-ev-k1.2@1`, `v6-softmax-v2@1`, `v6-oa-v3@1` everywhere. They are
not the V5.3 policies and **no V5.3 result applies to them** (win rates, first-mover rates, latency, referee block rates).

The frozen policy code imports the 7×7 engine and contains hard-coded 7×7 geometry, so it is not edited. Instead
`scripts/v6-fork.ts` (`npm run v6:fork`) generates copies in `server/v6/forks/`. A fork differs from its frozen source in
exactly these ways, and a test regenerates the forks and fails if anything else differs:

1. imports redirected: `server/engine.ts` → `server/v6/engine.ts`, forked files → their forks; `rules.ts` and `weights.ts`
   are shared unchanged;
2. three hard-coded 7×7 constants replaced by board-derived ones: the goal column `6` in side-relative move ordering
   (evplanner), and the mirror `6 - x` in canonical states / K1 tie-breaking (evplanner, evk11, ablation);
3. one latent bug fixed: the path-cost memo key concatenated `x` and `y` without separators. On 7×7 that is unambiguous;
   on 13 columns `x=11,y=0` and `x=1,y=1` collide and the planner would read another square's cost.

**Rule A1 needed no policy change.** Every candidate-cell generator the policies use draws from the engine's
`eligibleCells`, which now excludes closed squares, so they never propose a forbidden effect (tested on a crowded position
for all candidates and a chosen plan). When no cell is eligible, that effect is simply not a candidate; "no effect" always
is, and the AI then just moves (tested with a board where no cell is eligible).

Referee: unchanged Option A from PR #14, applied to both sides by the same function: rule check (including A1) → sandbox
trial with engine checks E1–E6 → tier 1/2 engine-approved and placed, tier 3 not placed. Kane is never called.

## 3. Turn-limit evidence (rule not changed)

Measured once with `npm run v6:turn-limit` → `evidence/v6/turn-limit.json`: 24 games, each V6 policy against itself,
seeds 96001–96004 × both first movers, real 60-turn rule, real referee on both sides.

| | V6 ev-k1.2 | V6 softmax-v2 | V6 oa-v3 | all 24 | 7×7 V5.3 self-play (for scale only) |
|---|---|---|---|---|---|
| median turns (min–max) | 13 (7–23) | 13 (9–60) | 16.5 (10–32) | **14.5 (7–60)** | 15 / 14 / 17 |
| games ending at the turn limit | 0/8 | 1/8 | 0/8 | **1/24** | 23% / 28% / 45% |
| turn of a side's first piece across (median, min) | 6, 2 | 5, 2 | 6, 2 | 6, 2 | |

(The 7×7 column is from `docs/BALANCE_V5_3_POLICY_RELIABILITY.md`, a different game with no referee in self-play; it is
there only to show scale, not as a comparison claim.)

**Conclusion: keep the 60-turn limit; the evidence gives no reason to change it.** Under the AI policies a 13×9 game uses a
median of 24% of the limit and only one game in 24 reached it. That one game (softmax-v2, seed 96004, AI first) was a
mutual stall, not a too-short limit: from turn 22 both sides had one piece left, 28 effects on the board, and each side
judged every legal move worse than standing still (diagnosed `unfavorable` on 40 turns); more turns would not have
resolved it. Caveat: human players may play slower than the policies; the playtest telemetry should be checked before
any change. The rule is not modified in V6.

## 4. Zero-move turns: no legal move vs unfavourable vs planner error

Every opponent turn with no move is classified by `diagnoseZeroMoves` (`server/v6/turn.ts`) and shown in the AI panel:

* **no-legal-move**: the engine offers no legal move (all pieces frozen, or none on the board);
* **unfavorable**: legal moves existed, but the policy's executor judged every one worse than standing still (its stop
  rule: best expected value below standing still − 0.25); the margin is reported;
* **planner-error**: the policy threw, or proposed a move the engine refused. The turn then passes with no move and the
  error is shown; no other policy is substituted.

In the 24-game measurement: **46 zero-move turns, all `unfavorable`; 0 no-legal-move; 0 planner errors.** 40 of them are
the one stalled softmax-v2 game above, 6 are oa-v3. None was caused by enclosure: no turn had zero legal moves.

## 5. Findings the operator should know about

1. **Self-propulsion dominates the wide board.** The policies often place a teleport (or a forward shove) on the squares next to
   their own pieces at the start and step onto it: a teleport from the start column lands on average about 6 columns
   forward (destinations are columns B–L). The first piece got across as early as turn 2 and at a median of turn 6, so the
   bigger board lengthens games less than its size suggests (median 14.5 turns). This is the rule A1 allows on purpose
   (own adjacency stays legal) combined with the unchanged teleport rule; changing either is a rule decision, not made
   here. Options if this is unwanted: teleport to the same column (an earlier experimental variant), or a smaller middle
   band. **No escape or new mechanic was added.**
2. **Rule A1 never had to reject an AI proposal** (0 of 414 AI placement attempts), as designed: the policies only see
   legal cells. It closed a median of 13 squares (max 24) per turn for the side to move.
3. **Tier-3 referee blocks remain the main source of wasted AI placements:** 77 of 414 attempts (19%) were not placed
   because the engine-only referee sends them to tier 3 (most often "a new cell could not be entered in the trial"), and a
   policy can propose the same blocked effect again on later turns (the softmax stall game did so every turn). This is the
   Option A gap from PR #14 (no AI fallback), not rule A1. A possible adapter change, filtering candidates through the
   referee before choosing, would change policy behaviour and needs an operator decision.
4. **Opponent latency is higher than on 7×7.** Teleport outcomes are enumerated exactly and there are ~99 destinations
   instead of ~35. Uncontended, V6 ev-k1.2 took a median of 2.0 s and up to 17 s per decision in a re-run of its longest
   game (up to 30 s when the machine was also running other work); oa-v3 up to 12 s; softmax-v2 up to 3.6 s. Playable,
   but slower than the PR #14 opponents. The decisions run in a worker thread, so the page stays responsive.
5. First-mover results (10 of 24) are not interpreted: 8 games per policy is far too few, and no V5.3 rate applies.

## 6. Reproducibility and isolation

* `server/engine.ts` (7×7), `server/game.ts`, `server/server.ts`, the PR #14 playtest and every V1–V5.3 file are unchanged;
  nothing outside `server/v6/` imports V6 (tested).
* The frozen V5.3 implementation hashes still match `balance/v5_3/journal.ndjson` (tested, `integrity().matches`).
* Fork headers record the SHA-256 of each frozen source; a fork that no longer matches its source fails the tests.
* No Kane, no language model, no network (the V6 server deletes provider keys, forces `KANE_REFEREE=off` and disables
  `fetch`), no deployment, no merge, no holdout seed (65001–65060 refused by the V6 server and self-play), no large self-play
  study (24 games, §3). Seeds used: 96001–96004 (turn-limit evidence), 99901–99902, 99961–99962 (smoke/tests).
* Nothing from a V6 game is written to disk.

## 7. Files

| File | Purpose |
|---|---|
| `server/v6/engine.ts` | V6 engine (fork of `server/engine.ts`: 13×9, rows 3/5/7, teleport B–L, rule A1) |
| `server/v6/forks/*.ts` | generated forks of ai, trial, tiers, flavor and the V4–V5.3 planner chain (do not edit) |
| `server/v6/turn.ts` | the one referee for both sides, the opponent turn executor, the zero-move diagnosis |
| `server/v6/opponents.ts`, `planworker.ts` | V6 opponent adapters and their worker thread |
| `server/v6/session.ts`, `server.ts` | playable in-memory game and loopback server on :3106 |
| `server/v6/selfplay.ts` | small V6 self-play used by the evidence script and tests |
| `client/v6/` | V6 page: fork of the production client with board size from the server and A1 display |
| `scripts/v6-fork.ts`, `scripts/v6-turn-limit.ts` | fork generator; turn-limit evidence (run once) |
| `evidence/v6/turn-limit.json` | the 24-game measurement |
| `tests/v6.test.ts` | 17 tests |

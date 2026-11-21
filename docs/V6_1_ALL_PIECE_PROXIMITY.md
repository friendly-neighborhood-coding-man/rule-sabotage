# Rule Sabotage V6.1: all-piece proximity (EXPERIMENTAL, not production)

Status: **READY_FOR_OPERATOR_V6_1_PROXIMITY_REVIEW**

Ruleset `rule-sabotage/v6.1-all-piece-proximity@1`. One change from V6 (`docs/V6_GAMEPLAY_EXPANSION.md`):

> **Rule A2:** no new effect may be placed on the 8 squares around **any** unscored piece, friendly or opposing
> (Chebyshev distance ≤ 1). It replaces V6's A1, which only counted opposing pieces.

Unchanged: the 13×9 board, three pieces per side on rows 3/5/7, teleport B–L, the 60-turn limit, the engine-only referee
(Option A), the opponents' code (the generated forks), and AI movement. No teleport variant, referee-aware policy change or
movement change was made, so any difference in play comes from A2 alone.

Play: `npm run play:v6`, open http://127.0.0.1:3106, choose **Ruleset → V6.1** (the default choice in the menu). V6 stays
selectable and stays the engine default (a game started without a ruleset is a V6 game, exactly as before).

## Rule details

* Enforced in the V6 engine's `validatePlacement` / `eligibleCells` (server side), through the same `refereeV6` for human
  and AI. The ruleset is fixed in the game state at `init()`, so a game can never change rules mid-way.
* The piece's own square stays forbidden by the occupancy rule ("has a piece on it").
* A multi-cell placement is rejected as a whole if any cell is closed; nothing is used up and the player can pick again.
  The reason names every piece involved, for example *"E5 is next to your piece on D5 and the opponent's piece on F5. New
  effects cannot be placed on the 8 squares around any piece, yours or your opponent's…"*.
* Existing effects are never removed when pieces move next to them, and they still fire (tested, including an own effect
  that propels the piece once it walks onto it).
* Removing your own effects stays legal anywhere. Putting a **new** effect on an own-effect square next to a piece is a new
  placement and is closed.
* Scored pieces close nothing. Stacks and pieces sent home count like any piece.
* Interface: closed squares are hatched with a tooltip saying "next to your own piece" or "next to an opponent piece";
  clicking one explains the rule; the server's rejection reason is shown under the board; the help text and the rule line
  at the top describe both ownerships. The AI panel reports how many squares were closed to the opponent this turn.

## AI compatibility

No policy change was needed. Every candidate generator in the forked policies takes its cells from `eligibleCells`, which
now also excludes the squares around the mover's own pieces. Tested on a crowded position for both sides (every candidate
and the chosen plan avoid closed squares) and on a board with zero eligible cells (the AI proposes no effect and still
plays its moves). In the smoke games below, **0 AI placements were rejected by A2**.

## Gameplay smoke (6 games, not a study)

`npm run v6.1:smoke` → `evidence/v6/v6-1-smoke.json`: each opponent against itself, seed 96001, both first movers. The same
seed and first mover were played under V6 in `evidence/v6/turn-limit.json`, so every game has a V6 counterpart.

| policy, first | V6 turns (first piece across) | V6.1 turns (first piece across) |
|---|---|---|
| ev-k1.2, human | 12 (4) | 33 (9) |
| ev-k1.2, ai | 14 (7) | 45 (4) |
| softmax-v2, human | 9 (4) | 37 (12) |
| softmax-v2, ai | 23 (5) | 35 (12) |
| oa-v3, human | 16 (6) | 29 (8) |
| oa-v3, ai | 14 (6) | 33 (4) |

What this suggests (6 paired games only):

* **Games last much longer**: every game was longer under A2, median about 34 turns instead of 14, and the first piece got
  across later in 4 of 6. Placing a teleport or shove right next to your own piece is no longer possible, so the turn-1
  self-propulsion rush seen in V6 is gone. Pre-positioned self-propulsion still happens (for example a teleport two squares
  ahead that the piece walks into), as A2 intends.
* **No game reached the 60-turn limit**, but games now use about half of it. If longer human games follow, the limit should
  be re-checked with playtest data; it is unchanged here.
* **Zero-move turns**: 5 in 6 games, all `unfavorable` (legal moves existed); no `no-legal-move`, no planner errors.
* **Squares closed by A2**: 22 at the start (11 around each side's pieces), median 16–27 per turn later.
* **Referee tier-3 blocks are more frequent**: 62 of 209 AI placement attempts were not placed (about 30%, V6: 19%), all by
  the engine-only referee, none by A2. Same Option A gap as before; no adapter change was made.
* **Opponent latency spikes**: typical decisions stay at 1–2 s (ev-k1.2 re-run alone: 13 of 14 turns under 2.2 s), but the
  longer games reach more teleport-heavy positions; the longest single decision in the smoke was 59 s (softmax-v2) and
  several were 20–40 s. This is a playability risk for the human pilot.
* The first mover won all 6 games. Six games say nothing about balance; this is not a claim.

## Tests

`tests/v6-1.test.ts` (11 tests): separate ruleset and V6 default kept; all 8 neighbours rejected for a friendly piece and for
an opposing piece, for both movers; corners and edges (clipped zones); mirror parity over all 117 cells; multi-cell
rejection as a whole with nothing applied; a cell next to both an own and an opposing piece; existing effects survive and
fire; own removal legal; pre-positioned traps and a two-effect chain reaction still work; AI candidates avoid closed
squares; zero eligible cells; HTTP endpoint (ruleset selection, 422 with a reason naming the own piece, unknown ruleset
refused). The 17 V6 tests still pass unchanged. Browser smoke: started a V6.1 game, saw own- and opponent-side hatching
(22 squares) with tooltips, clicked a closed square and got the explanation, placed an effect two squares ahead, ended the
turn and watched the opponent play under A2.

## Isolation

Only `server/v6/` and `client/v6/` changed (plus the new test, smoke script, evidence and docs). The 7×7 game, PR #14
playtest, V1–V5.3 code and evidence are untouched; the frozen V5.3 hashes still match (tested). The forks are unchanged.
No Kane, no language model, no network, no holdout seed (seed 96001 was already used for V6 evidence; it is reused here
on purpose for the pairing), no production change.

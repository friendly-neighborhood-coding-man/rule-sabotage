# Balance Designer V4: root cause of the AI's teleport foresight

Written from the source at commit `41e4431` (V3 tip), before the V4 planner code. Line numbers refer to that commit.

## The four kinds of information

| Kind | What it is in this game | Visible to a human? |
|---|---|---|
| Public state | pieces, frozen/shield status, every live effect with owner and cells, turn, actions left, banked bonus (`publicView`, `server/engine.ts`) | yes |
| Hidden RNG state | `State.rng`, a xorshift32 value (`rand()`, `server/engine.ts:130`). Never in `publicView` | no |
| Deterministic engine results | shoves, home, freeze, shield, haste, captures, chains, scoring: all functions of public state | yes (computable) |
| Random outcomes | the only call to `rand()` after the coin flip is the teleport destination `opts[rand(s) % opts.length]` (`server/engine.ts:357`). It becomes public when the `forced … teleport` event resolves | only after the move |

`grep` of every `rand(` / `.rng` use confirms teleport is the only random outcome during play (the other `rand()` calls are the
first-player coin flip in `init`).

## How the hidden RNG reaches the AI's decisions

The planner simulates with `structuredClone(state)`, which copies `rng`. Every simulated teleport therefore lands exactly where the real
one will. Paths:

1. **Own moves** — `planMoves()` (`server/ai.ts:130`): each candidate move is applied to a clone; a move into a teleport is valued at its
   true future destination. Greedy picks the move whose *realized* outcome is best: it steps on a teleport only when this particular
   roll is good.
2. **Whole-turn plan** — `planTurn()` (`server/ai.ts:179`): every placement candidate is followed by `planMoves` on a clone (same leak),
   and by a simulated **opponent reply** (`planMoves(rep, opp, …)`), so the AI also foresees where the *opponent's* teleports will send
   the opponent's pieces, including teleports the AI is placing now. Placement choice is therefore contaminated too.
3. **Execution without re-planning** — `aiTurn()` (`server/game.ts:316`) and self-play (`server/balance/selfplay.ts:150`) compute the whole
   move list once and play it. With foresight the list is consistent with the real destination; with any honest planner the list would
   be stale after a teleport (the V3 P3 bug).
4. **LLM opponent** — when a model is configured, `decideAI()` sends the planner's ranked options and scores to the model
   (`server/game.ts`), so the foresight flows into the model's choice as well.
5. **Not a planner leak, but found on the way:** the referee trial (`server/trial.ts`) runs its symmetry scenarios on a clone that
   includes the RNG and publishes the resulting "Ended on" square on `/trial/T####` and `/api/trial/T####`. For a teleport rule this is
   the square the next real teleport will use while the destination count is unchanged. That is a hidden-RNG disclosure to whoever reads
   the trial page (the human player included). V4 does not change it (production); it is listed for the operator.

The planner's tie-breaking randomness (`rng(seed ^ turn)` in `planTurn`) is derived from the game seed and the turn number only; it
never reads `State.rng`, so it carries no information about outcomes.

## Why P3 (V3 "blind RNG") was not a fix

P3 replaced the copied RNG with a perturbed one (`blind()`, `server/ai.ts:29`). The planner then believes in one *other* random
destination with certainty: it still maximizes over a single realization, just a wrong one. V3 measured the consequence: 118 turn-1
teleport moves instead of 32, longer games, fewer comebacks. A correct planner must average over the outcome distribution.

## Measured size (V3)

+1.27 squares per teleport move (95% CI +1.10 to +1.45) over a blind expectation, realized outcomes at the 75th percentile of the
blind distribution (A arm, `docs/BALANCE_V3_VALIDATION_RESULT.md` §3).

## Correction designed from this

* Engine exposes the outcome set it actually uses (`teleportDestinations`), the exact law of its draw
  (`teleportIndexProbabilities`), and an optional `ChanceResolver` so a caller can enumerate outcomes without touching the RNG.
  Production calls pass no resolver; 340/340 V3 games replay identically after the change.
* Candidate planner `server/balance/v4/evplanner.ts` masks the RNG, averages every random move over all destinations, ends its
  committed move list at the first random move and is asked again once the destination is public. Production is unchanged.

# Human playtest readiness and critical limitations

**Status: READY_FOR_OPERATOR_HUMAN_PILOT_EXECUTION.** Software checks done; the pilot is authorised by the operator for
consenting adult volunteers and needs a human facilitator. No participant session has been run and no feedback exists.
Nothing merged, deployed or promoted; the production game is unchanged. 0 Kane calls, 0 external model calls, no new
self-play batch, holdout 65001–65060 untouched. The V5.3 experiment, its policies, evidence and verdicts are frozen and
unchanged (P1 POLICY-DEPENDENT, P2 INCONCLUSIVE, rule-level fairness INCONCLUSIVE).

The goal of this step is not another self-play result. It is a way to find out whether people can understand the game, play it,
and want to come back.

## 0. Operator decision (2026-11-21): Option A

**Approved and implemented:** the production engine-only referee applies identically to the human and to the AI opponent.
Tier 1/2 effects are engine-approved and placed; tier 3 effects are unverified and not placed; effects failing an engine safety
check are rejected. No Kane, no external model. Option B (no referee) is **not** implemented.

**The playtest is not a replication of V5.3 self-play.** V5.3 placed every chosen effect without the referee; the playtest does
not. The V5.3 policies and results are unchanged. The retrospective blocking rates below (24–31%) were measured on V5.3 self-play
positions; human games will reach different positions, so they **do not predict the rates participants will see**. The
playtest records the actual rate per game.

**Equal enforcement is not equal recovery.**
- *Same for both:* one effect submission per turn. The engine's placement step ends once an effect is submitted (production rule,
  unchanged), so neither side can place a replacement in the same turn after the referee blocks it
  (`tests/playtest-referee.test.ts`, human and AI cases).
- *Human:* sees the interpretation before submitting (including an "approximate" warning; approximated effects always go to tier 3), can rephrase or pick other cells while a request is merely invalid, sees the referee's reason
  afterwards, and can choose differently on later turns.
- *Frozen AI policies:* choose exactly one effect per turn, never a replacement when it is rejected, and do not learn from the
  rejection: the same position leads to the same proposal. No fallback was added and the policies were not modified.
This distinction is recorded per turn (`placement.verdict`, `placement.tier`, `ai.placementBlocked`, the human's
`rejectedAttempts`) and summarised per game (`interactions.notPlaced`).

**Final preflight (deterministic, `tests/playtest-referee.test.ts`, 5/5).** Positions are rebuilt by engine replay from the
frozen V5.3 ev-k1.2 records (first AI-side placement of each referee class); the playtest opponent re-decides the turn and must
re-choose the recorded effect (asserted):
1. AI tier 1/2 effect → engine-approved and placed (place event emitted).
2. AI tier 3 effect → unverified, no placement, no rule created.
3. AI effect failing an engine check → rejected by the engine, no placement.
4. After a block the AI still makes legal moves and the turn passes to the human.
5. Telemetry (`placement.verdict`, `placed = []`, `ai.placementBlocked`, `notPlaced.ai = 1`) and the visible feedback
   (the referee verdict and its reason in the referee panel and `view.reviews`, "its effect was not placed" in the log).
Plus: exactly one AI proposal per turn (no fallback), and the human tier-3 case reusing the `referee-v41` fixture.
## 1. What was built

`npm run playtest` starts a **separate local server** on http://127.0.0.1:3100 (loopback only). It serves a playtest page that
loads the **unchanged production client** (`client/app.js`, `style.css`) inside a playtest shell (`client/playtest/`). The
production server, game, client and engine files are not modified.

| Need | How |
|---|---|
| Three opponents | EV-K1.2, Softmax-v2, OA-v3: the frozen V5.3 policies, unchanged (`server/playtest/opponents.ts`) |
| Identified and versioned | Name, version string and implementation hash in the top bar, the AI panel, the log, the review and every record. At startup the code hash is checked against the hashes frozen before the V5.3 games (`1502bc4a6b7f1b03`); a mismatch is shown as MODIFIED, never hidden |
| OA-v3 marked | EXPERIMENTAL and MAY BE SLOW labels; a live "OA-v3 is thinking… 4.2 s" timer; last and slowest answer per game |
| Same rules | Production engine (hash `f92354f4…`): same board, pieces, effects, scoring, 60-turn limit, starting position. Only the first mover is assigned explicitly (pilot schedule or coin flip) instead of derived from the seed |
| No silent substitution | If an opponent fails, the game stops with a message; no other policy takes over |
| Selector, restart, review | Opponent selector (free play) or fixed pilot schedule; "Restart game" (old game kept as unfinished); "Review match" turn-by-turn table |
| Consent | Start screen with the consent statement; "record my games" or "play without recording"; delete-everything button |
| Telemetry vs feedback | Two separate files per session, linked only by game id (`server/playtest/telemetry.ts`) |
| Isolation | Provider keys and the Kane switch removed from the process before import; `fetch` disabled; startup aborts if an LLM or Kane is still enabled; planner worker also has `fetch` disabled |

Opponent turns run exactly as in the V5.3 self-play loop: `planPolicy53` chooses the placement (in a worker thread, so the page
stays responsive), the shared executor `moves53` plays the moves and re-plans after every teleport.

### Recorded per game (with consent)
Opponent id, version, code hashes and OA-v3 bounds; seed; first mover; result, reason, length, turn-limit ending, abandoned;
every effect the human wrote (text, interpretation, cells, referee outcome and tier) and removals; every move with its time
from turn start; rejected attempts; the opponent's response time (wall, planner, executor), work, budget use and fallback;
effect triggers (mover, owner, own-effect hits, chains), captures; lead after each turn, lead changes, comebacks; first-turn
opening signatures of both sides. Subjective answers: five optional 1–5 ratings, four tick boxes, a comment.

## 2. Critical limitations

### L1. The live referee blocks a quarter to a third of the policies' chosen effects (new finding)
The playtest applies the production **engine-only referee** to both players: tier 1/2 effects are engine-approved, tier 3
effects are not placed (no Kane). V5.3 self-play never ran the referee. Replaying the 180 V5.3 games (zero new games,
`npm run playtest:latency-audit`, `evidence/playtest/latency-audit.json`):

| | effects chosen | tier 1 | tier 2 | tier 3 | engine check failed | **would not be placed** |
|---|---|---|---|---|---|---|
| EV-K1.2 | 1050 | 120 | 675 | 220 | 35 | **243 per 1000 (24%)** |
| Softmax-v2 | 1055 | 117 | 653 | 236 | 49 | **27%** |
| OA-v3 | 1034 | 30 | 680 | 276 | 48 | **31%** |

On V5.3 positions the opponents would have lost roughly one effect in four and then only moved. Rates in human games will differ, because the positions differ.
The opponents are therefore **not the same observers as in V5.3**, and self-play numbers do not predict playtest outcomes. The
policies themselves are unchanged; the rule check is the one the real game uses, applied identically to the human. Each block
is visible in the game ("not placed") and recorded.

**Operator decision (2026-11-21): A approved** (see section 0). The options were:
- **A (approved, implemented):** same engine-only referee for both sides, as in the real game. Faithful to the game people would play.
- **B (not implemented):** skip the referee for both sides, as self-play did. Faithful to V5.3, but human text the engine cannot verify, and
  placements that fail engine safety checks (35–49 per policy in V5.3), would go live.
- A separate follow-up could let a policy fall back to its best *referee-approved* placement. That changes the policies and
  needs its own validation; it is not done here.

### L2. OA-v3 latency, and the budget is not a hard bound
From the 2,021 OA-v3 decisions recorded in V5.3 (parallel worker pool, so indicative): median 0.1 s, 90th percentile 2.1 s,
99th 7.3 s, **max 18.5 s**; 56 decisions over 5 s and 12 over 10 s. The 20,000-simulation budget is checked before each
candidate, so one decision can run past it: **7 decisions exceeded it, the largest by 7,749 (27,749 simulations)**; 4 hit it
and used the recorded fallback. The playtest therefore promises no hard bound. It shows the real time of every answer, a live
timer while OA-v3 thinks, and records times per turn. In browser checks on this machine OA-v3 answered in 0.6–2.6 s
(a handful of turns, not a measurement). If waits of 10–20 s prove unacceptable to participants, that is a playtest
limitation; a separate fix (for example checking the budget inside the candidate loop) would need its own validation.
EV-K1.2 and Softmax-v2: max 4.9 s and 3.5 s.

### L3. Opponents are research instruments, not designed opponents
They were built to be reliable observers. They do not talk (no taunts; the production client's canned reactions still appear),
they never explain themselves in human terms, and EV-K1.2 and OA-v3 made a single first-turn choice in 60 self-play games, so
humans will likely see the same opening every time. A technically reliable observer is not an enjoyable opponent; this pilot
is how we find out how far apart those are.

### L4. Natural-language effects use the offline parser only
No language model is allowed, so the participant's text is read by the built-in offline parser (English and Korean patterns).
Phrasings it does not know are rejected or approximated; approximated effects go to tier 3 and are not placed. Some confusion
in the pilot will come from the parser, not the rules. The telemetry keeps every rejected attempt so this can be separated.

### L5. Small, unblinded, exploratory
6–12 participants, one game per opponent, labels visible (required), learning across three games. Results can only be
described. They cannot establish preference, fairness, or balance.

### L6. Smaller technical caveats
- The production client labels non-LLM decisions "Local planner"; the playtest shell relabels them with the opponent's name on
  screen (the client file is not edited).
- The production "R" rematch shortcut and game-over dialog are replaced by the playtest flow (questionnaire, then next game).
- Game sessions live in memory: restarting the server ends unfinished games without a record.
- Times are wall-clock on the facilitator's machine and depend on its speed.

## 3. Research evidence (finalised)
`docs/KANE_DOSSIER_V5_3_1.md` corrects overstatements in the V5.3 dossier without changing any verdict, and sorts the evidence
into: findings supported by the observed policies; claims restricted by low opening diversity; unresolved mechanisms; questions
that need human play. The original dossier and V5.3 report carry a pointer note and are otherwise unchanged. Kane was not invoked.

## 4. Pilot
`docs/PLAYTEST_PILOT_PROTOCOL.md` and `playtest/pilot-schedule.json`: each participant plays all three opponents, all 6
orders used, first mover balanced per opponent, fixed seeds outside the holdout, descriptive analysis
(`npm run playtest:summary`) with telemetry and feedback reported separately.

## 5. Checks
- `tests/playtest.test.ts` (3/3): schedule balance and holdout guard; frozen code hash, no LLM / Kane / network; a short scripted
  API turn (no consent writes nothing; consent writes telemetry and feedback to separate files; an abandoned game is kept;
  withdraw deletes everything). The scripted turn uses a temporary directory that is deleted, and submits only a *skipped*
  questionnaire: no human answers are invented.
- `tests/playtest-referee.test.ts` (5/5): the Option A preflight (section 0).
- Default parallel `npm test`: **173/173** (`evidence/playtest/test-run.log`).
- Browser check of the real page: consent screen, opponent selector, OA-v3 game with the live timer, a human turn (effect +
  moves), match review, restart, end-of-game questionnaire, pilot schedule (P02: correct opponents and first movers), end of
  session and deletion. All test data was written to a scratch directory and deleted.

## 6. How to run
```
npm run playtest            # http://127.0.0.1:3100
npm run playtest:summary    # after sessions: descriptive tables, telemetry and feedback apart
```

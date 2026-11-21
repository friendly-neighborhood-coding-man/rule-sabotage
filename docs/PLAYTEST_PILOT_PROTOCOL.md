# Human playtest pilot protocol (approved; not yet run)

**Status: approved by the operator on 2026-11-21 (Option A referee) for consenting adult volunteers, after the software preflight passed. Not yet run:** sessions need a human facilitator. No human session has been held and no feedback exists. This is a small, exploratory pilot.
It can show whether the game feels repetitive, unfair, confusing or satisfying, and against which opponent; it **cannot**
give statistical evidence of human preference or of rule balance.

## Question
Is Rule Sabotage understandable, playable and worth returning to, and how does that differ between the three experimental
opponents (EV-K1.2, Softmax-v2, OA-v3)?

## Priority questions (operator, 2026-11-21)
1. Can participants understand why an effect was rejected?
2. Does referee rejection make the AI seem weak, inconsistent, or frustrating?
3. Are the three opponents distinguishable in actual play?
4. Does the experience remain enjoyable despite repeated openings?
5. Would participants voluntarily play another match?

Evidence for each, all descriptive: (1) debrief question A, "confusing" ticks and comments, the participant's own blocked
effects and rejected attempts; (2) debrief question B, "unfair" ticks, the challenge and predictability ratings next to the
recorded number of opponent effects not placed; (3) debrief question C, and whether the predictability and challenge ratings
and the factual telemetry (length, openings, effects placed) differ between opponents; (4) the opponent-opening repetition
count next to enjoyment ratings and "repetitive" ticks; (5) the play-again rating and, as behaviour rather than opinion,
whether the participant accepts the optional extra free-play game offered at the end (step 6).

The playtest applies the same engine-only referee to both sides. It is **not** a replication of V5.3 self-play, which placed
effects without the referee. Neither side can place a second effect in a turn after a block; unlike the human, the frozen AI
never adapts its proposal (`docs/HUMAN_PLAYTEST_READINESS.md`, section 0).

## Design
- **Participants:** 6 minimum (P01–P06: a balanced Latin square, each opponent once in each position per pair of
  participants and first-mover balanced), 12 suggested (P01–P12: all 6 orders). Adults, volunteers. Codes only; no names in
  the tool. The full assignment is in `playtest/pilot-schedule.json`.
- **Within-participant:** each participant plays all three opponents, one game each (about 30–45 minutes in total).
- **Opponent order:** all 6 orders of the 3 opponents, each used by 2 consecutive participants (`server/playtest/pilot.ts`).
  Each opponent appears in each position 4 times out of 12 (2 out of 6 for P01–P06).
- **First mover:** alternates within a participant (H, AI, H or AI, H, AI). The two participants sharing an order start with
  opposite first movers, so per order every opponent is met once as first and once as second mover; across 12 participants
  every opponent is met 6 times with the human first and 6 times with the opponent first.
- **Seeds:** fixed per slot, 82000 + 10 × participant + slot (P01 game 1 = 82011). A restarted game uses seed + 500 per restart.
  All outside the reserved holdout 65001–65060 (enforced in code).
- **Not blinded.** The operator requires every experimental opponent to be identified, so participants see its name, version
  and the "may be slow" label for OA-v3. Ratings may reflect expectations set by those labels; report this.

## Procedure (facilitator)
1. Start `npm run playtest` on the facilitator's computer; open http://127.0.0.1:3100.
2. Read the on-screen consent text aloud. The participant chooses "record my games" or "play without recording". Playing is fine
   either way; only recorded sessions enter the analysis.
3. Enter the participant code (P01…), choose **Pilot schedule**.
4. Before game 1: show "How to play" (2–3 minutes). Answer rules questions; do not give strategy advice at any point.
5. Play the three scheduled games. After each finished game the participant answers the five ratings (optional) and may tick
   repetitive / unfair / confusing / satisfying and write a comment. The facilitator does not look at the answers while they
   are typed.
6. Offer one extra free-play game against any opponent ("only if you'd like to"); note whether it is accepted and which opponent.
   In the tool: "Start a new session", same participant code, same consent choice, **Free play**.
   Do not encourage it.
7. Short debrief (facilitator notes kept outside the tool, no names, no leading wording):
   A. "When one of your effects or the computer's was not placed, did you understand why?"
   B. "How did it feel when the computer's effect was not placed?"
   C. "Did the three opponents feel different? How?"
   D. "What was hardest to understand?"
8. At the end the participant may delete everything from the session ("Delete everything recorded in this session").

Stop a session at once if the participant wishes. A game abandoned with "Restart game" or "End session" is kept and marked
unfinished; restart only if the participant asks or the game is unplayable (note the reason).

## What is recorded (with consent) and kept apart
- **Factual telemetry** (`playtest-data/telemetry/`, written by the server): opponent id, version and code hash; seed; first
  mover; result, length, turn-limit ending; every effect the participant wrote, its interpretation, cells and referee outcome;
  every move with its time from turn start; the opponent's response time and work metadata per turn; effect triggers
  (whose effect hit whom, own-effect hits, chains); captures; lead changes and comebacks; first-turn opening signatures.
- **Subjective answers** (`playtest-data/feedback/`, typed by the participant): enjoyment, challenge, predictability, strategic
  choice, desire to play again (1–5, each optional), four tick boxes, free comment. Linked to a game only by its game id.
- Nothing leaves the computer. `playtest-data/` is gitignored and must not be committed.

## Analysis plan (descriptive, decided now)
`npm run playtest:summary` prints the two sections separately. Report per opponent:
- counts and medians, with every individual rating shown (no means of 12 ordinal answers presented as precise);
- tick-box counts and all comments verbatim (after checking they contain no names);
- factual: wins, length, turn-limit endings, opponent response time (median, max, number > 10 s), distinct opponent openings
  across games (repetition), own-effect hits, effects not placed by the referee, lead changes.
Read the two sections side by side. **Do not infer enjoyment from win rates**, and do not rank opponents by preference from this
sample. Position (first, second, third game) is reported, because learning effects are expected.

## Signals worth following up (not pass/fail criteria)
- **Repetitive:** the same opponent opening in most games, or "repetitive" ticked for an opponent by several participants.
- **Unfair:** "unfair" ticked, comments about effects, or many of the participant's effects not placed by the referee.
- **Confusing:** "confusing" ticked, many rejected interpretations or rejected attempts, frequent own-effect hits.
- **Satisfying:** high enjoyment and play-again ratings with comments naming a decision the participant was pleased with.
- **Too slow:** OA-v3 answers over 10 s, or comments about waiting.

## Not part of this pilot
No Kane, no language model, no production deployment, no new self-play batch, no use of the holdout seeds, and no claim of
statistical significance.

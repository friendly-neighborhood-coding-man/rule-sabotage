# Rule Sabotage V6.3: latency-bounded prototype, pilot defaults, final checks (EXPERIMENTAL)

Status: **READY_FOR_OPERATOR_KANE_SINGLE_CALL_PREFLIGHT** (D1, see `docs/KANE_SINGLE_CALL_PREFLIGHT.md`). The
latency-bounded variant is a prototype for operator review, not promoted. No gameplay rule changed. No Kane invocation,
no external model call, no new self-play batch, no holdout seed, no merge, no deployment.

## D2. Latency-bounded prototype `v6-*-ra-b@1`

`server/v6/budgeted.ts`. The original (`v6-*@1`) and referee-aware (`v6-*-ra@1`) policies are unchanged.

* The unchanged policy plans in an **isolated worker**. Target: its exact decision within **5 s**; it may continue to
  **8 s**; at 8 s the worker is **terminated** (`Worker.terminate()`), not asked to stop. A warm spare worker takes over
  immediately and a new spare starts in the background.
* **Fallback** (deterministic, legal, no hidden information): no new effect this turn, moves by the shared executor on
  the masked planning view. Planner errors fall back the same way. The original policy is never silently substituted;
  every fallback is recorded and shown in the AI panel.
* Referee pre-check as in `-ra@1` (static un-enterable check, repeat suppression, real referee on copies), bounded by
  count (3) and time (no new pre-check after 9 s from the start of the decision).
* Every decision records: exact / late-exact / terminated / worker-error, planner ms, pre-check ms and trials, respawn ms,
  fallback reason.

### End-to-end validation on the 31 recorded slow positions (`npm run v6.3:latency` → `evidence/v6/v6-3-latency.json`)

Each position is a V6.1 replay decision that once took ≥ 8 s. The whole opponent turn is timed: planner worker,
pre-check, referee on the real state, move executor with teleport re-planning.

| | result |
|---|---|
| whole-turn time | median **1.6 s**, p90 **6.6 s**, max **9.8 s** |
| over 8 s / over 10 s | 3 / 0 |
| exact (≤ 5 s) | 25 |
| late but exact (5–8 s) | 3 (ev-k1.2 t13, oa-v3 t13, oa-v3 t15) |
| terminated at 8 s → fallback | 3 (all oa-v3: t7, t10, t16) |
| worker swap after termination | 1–139 ms (warm spare) |

* **The 8 s planning deadline is not an 8 s turn guarantee**: the three terminated turns took 8.1, 8.1 and **9.8 s** end to
  end (timer granularity plus the executor, which in one position needed 1.3 s for teleport re-planning).
* Most of the remaining decisions are already fast because of the V6.2 decision-preserving speed-ups; the recorded
  8–189 s figures were measured on a busy machine and before those speed-ups.

### Decision changes (9 positions compared with the unbounded `-ra@1` decision)

* **6 of 9 identical** (same effect, same cells).
* **3 of 9 changed, all three oa-v3 terminations**: the unbounded referee-aware oa-v3 would have placed a shove effect;
  the prototype placed nothing and moved with the executor. That is the cost of the deadline: on those turns oa-v3 loses
  its effect, not its move.
* No position made the prototype place something the unbounded variant would not.

Trade-off: the prototype mostly matters for oa-v3 (slowest search). For ev-k1.2 and softmax-v2 it changed nothing in these
positions. Not promoted; offered in the page under "Experimental prototypes (not for the pilot)".

## D3. Human pilot defaults

* Default ruleset: **V6.1 (A2)**. Default opponents: **`v6-ev-k1.2-ra@1`, `v6-softmax-v2-ra@1`, `v6-oa-v3-ra@1`**, listed first
  under "Pilot opponents". The original V6 opponents stay selectable under "Baselines"; nobody has to play six games.
* Recorded separately (consenting participants only, `playtest-data/v6/`):
  facts per game: AI referee non-placement rate (attempts, not placed, rate), AI latency (median, p90, max, over 10 s),
  the AI's opening (first-turn effect and moves, to count repeated openings), zero-move turns by kind, game length,
  abandoned games, deadline outcomes for the prototype; answers: the five 1–5 ratings including enjoyment, tags, comment.
* `npm run v6:pilot-summary` reports facts and answers in separate sections per opponent and invents nothing (with no
  data it says so). No claim that `-ra` is better is made; there is no gameplay evidence yet.

## D4. Final software checks

* Browser (real page, `npm run play:v6`, temporary data directory): consent → V6.1 game against `v6-softmax-v2-ra@1`
  played to the end (14 turns) → questionnaire shown at game over, filled and submitted by clicking (test answers:
  enjoyment 3, tag "too-slow"; other items left empty and stored as null) → match review opened → "Delete my data" →
  4 files removed (telemetry, answers, consent record, shadow cases), 0 files left, recording indicator off. The test
  answers were mine, written to a scratch directory and deleted; they are not participant data.
* Full test suite, one fresh `npm test` run after the last code change: **215/215 passed, 0 failed, 0 skipped**. Before
  that, two full runs each had one failure that I fixed: a test that wrongly matched the word `kaneJudge` in a comment, and
  the worker-pool test, whose 60 s allowance for a fresh worker was too short while the whole suite runs in parallel (it
  passes in 1.7–8 s alone; now 180 s). Worth knowing for the pilot: on a heavily loaded machine a freshly started planner
  worker can be slow, which the warm spare is there to hide.

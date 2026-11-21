# Rule Sabotage V6.2: playability and Kane-readiness (EXPERIMENTAL, not production)

Status: **READY_FOR_OPERATOR_V6_2_PLAYABILITY_AND_KANE_SHADOW_REVIEW**

Base: V6.1 (PR #16), accepted by the operator as the preferred experimental ruleset. No gameplay rule changed: 13×9,
three pieces, rule A2, teleport B–L, 60-turn limit and the engine-only referee are as in V6.1. The V6 and V6.1 rulesets,
their opponents (`v6-*@1`) and all earlier evidence are unchanged. No Kane call, no external model call, no new
self-play experiment, no holdout seed, no merge, no deployment.

Data used: the six existing V6.1 smoke games (seed 96001), replayed exactly (`npm run v6.2:replay`; all six reproduce the
recorded lengths and winners: 37, 35, 33, 45, 29, 33 turns) to capture positions and full referee verdicts
(`evidence/v6/v6-2-replay.json`).

## 1. AI latency (Priority 1)

### Where the time goes

The replay captured 31 opponent decisions of 8 s or more. The 3 slowest per policy were profiled with the V8 sampling
profiler (`npm run v6.2:profile` → `evidence/v6/v6-2-profile.json`), inclusive time per part:

| decision | simulations | chance enumeration | state copying | evaluation | referee (separate) |
|---|---|---|---|---|---|
| softmax-v2 t14 | 31,363 | 65% | 46% | 29% | 2.6 s |
| softmax-v2 t33 | 9,566 | 45% | 41% | 42% | 0.5 s |
| softmax-v2 t36 | 13,252 | 73% | 62% | 16% | (no effect) |
| ev-k1.2 t13 | 68,919 | 61% | 42% | 26% | 1.5 s |
| ev-k1.2 t19 | 7,222 | 43% | 48% | 33% | 0.4 s |
| ev-k1.2 t10 | 13,978 | 65% | 39% | 23% | 0.2 s |
| oa-v3 t7 | 45,175 | 44% | 31% | 44% | 0.8 s |
| oa-v3 t16 | 26,225 | 43% | 33% | 46% | 0.5 s |
| oa-v3 t10 | 29,282 | 37% | 26% | 55% | 0.1 s |

(Inclusive shares overlap: state copying and evaluation happen inside chance enumeration.)

* **Chance-outcome enumeration dominates** (37–73%). The EV planners enumerate every teleport destination exactly
  (~99 on 13×9, ~35 on 7×7), and after a first teleport they plan their continuation for each outcome, which can hit a
  second teleport (up to ~99 × 99 end states before strata are applied). V6.1 makes this worse because effects are now
  laid out ahead of pieces, so routes often cross several pre-placed teleports.
* **Copying states is the largest single cost inside it** (`structuredClone`, 25–61% self time): one full copy per
  enumerated outcome and per simulated move.
* **Evaluation** (path-cost Dijkstra, `pieceCost`, plus `parseKey`/`ruleAt` string handling) is the next 16–55%.
* **The referee is not the problem**: 0.1–2.6 s per placement, once per turn. The move executor: under 0.6 s.
* Recorded wall times include CPU contention from other work on the same machine (for example 163 s recorded, 54 s under
  the profiler, about 14 s plain). Uncontended worst decisions are in the 15–40 s range; the profiler itself inflates
  times, so its milliseconds are for proportions, not absolute latency.

### Optimisations that keep every decision identical (in this PR)

Each one changes how fast a decision is computed, never which decision is made:

1. **Planning view** (`planningView`, `server/v6/turn.ts`): the planners get a copy without burnt rules, per-turn
   statistics or rule display text, which no planner reads. Halves the size of every state copy.
2. **Structure-aware state copy** (`server/v6/fastclone.ts`): during a planner call, `structuredClone` of a game State is
   answered by a field-by-field copy (everything else still goes to the native function). Deep-equal to
   `structuredClone`, no shared mutable objects (tested).
3. **Engine string handling** (`server/v6/engine.ts`): `parseKey` without array allocation, and the teleport destination
   list built from one set of occupied squares instead of a piece scan per square. Same outputs for every input
   (tested against the old implementations).

The generated planner forks are not modified. Checks: decisions on all 9 profiled positions are identical with and
without the optimisations (chosen plan, full ranking, simulation count); identity is also a regression test on a
mid-game position for all three policies; the full V6/V6.1 test suites (replay, determinism) pass unchanged.

Measured on the same 9 positions, uncontended, interleaved (plain, optimised, plain, optimised; faster run of each)
(`npm run v6.2:fastclone` → `evidence/v6/v6-2-optimised.json`):

| decision | plain | optimised | speed-up | identical decision |
|---|---|---|---|---|
| softmax-v2 t14 | 10.3 s | 5.2 s | 2.0× | yes |
| softmax-v2 t33 | 7.9 s | 4.1 s | 1.9× | yes |
| softmax-v2 t36 | 7.6 s | 2.1 s | 3.7× | yes |
| ev-k1.2 t13 | 32.3 s | 15.3 s | 2.1× | yes |
| ev-k1.2 t19 | 5.8 s | 2.5 s | 2.3× | yes |
| ev-k1.2 t10 | 10.9 s | 3.3 s | 3.3× | yes |
| oa-v3 t7 | 17.8 s | 10.0 s | 1.8× | yes |
| oa-v3 t16 | 17.2 s | 12.3 s | 1.4× | yes |
| oa-v3 t10 | 17.2 s | 9.7 s | 1.8× | yes |

The worst decision falls from about 32 s to about 15 s; the rest are now 2–12 s. ("Plain" already includes optimisation 3,
which is in the engine and cannot be switched off per call, so the true gain over V6.1 is slightly larger.) An earlier
single-run measurement of the fast copy alone (`evidence/v6/v6-2-fastclone.json`) also showed identical decisions but was
noisy. **This is still slow for the worst positions**: decisions of 10–15 s remain possible, which is why §1 leaves the
budget question to the operator.

### Not done: a hard computation budget

A real latency cap needs an approximation (for example capping teleport enumeration to K equal-probability strata or a
time limit with a recorded fallback), which changes decisions. Per the operator's instruction this is not applied to the
existing opponents. If wanted, it should be a separately versioned policy (for example `v6-ev-k1.2-b@1`) whose
approximation and fallback are recorded per decision; I recommend deciding after the human pilot shows whether the
remaining latency matters.

## 2. Repeated referee rejection (Priority 2)

### The 62 of 209 non-placed AI effects

| Outcome | Count | Share of 62 |
|---|---|---|
| tier 3: **a new cell could not be entered in the trial** (1 also with a rollout softlock flag) | **50** | 81% |
| engine check E2 failed (Human and AI piece would not get the identical outcome) | 6 | 10% |
| tier 3: a chain reaches the engine cap (4), incl. 3 with entry-relative shoves and many nearby effects | 5 | 8% |
| tier 3: entry-relative shove, Human and AI differ in the bounded simulation | 1 | 2% |

* No rejection came from rule A2 or occupancy: the policies only ever propose legal cells.
* "Could not be entered" is a limitation of the referee's trial, not of the effect: the trial enters each new cell
  from an orthogonal neighbour that holds no effect, and under A2 effects cluster in the open middle of the board, so a
  new cell is often surrounded by effects (including the same placement's other cells). The engine-only referee then
  cannot verify it and, correctly, does not place it.
* Repeats: in 27 of the 62 cases the same side had already had an effect of the **same kind** refused earlier in the same
  game; an **identical** effect on identical cells was re-proposed only once. The waste is "same idea, slightly different
  cells", not literal repetition.

### Referee-aware selection adapter (separate opponents)

`server/v6/referee-aware.ts`, offered as three **new** opponents `v6-ev-k1.2-ra@1`, `v6-softmax-v2-ra@1`,
`v6-oa-v3-ra@1`. The `v6-*@1` opponents are not changed. The adapter keeps the policy's own ranking and only changes
which ranked plan is played when the top plan's effect would not be placed:

1. walk the policy's ranked plans in order; a plan without an effect is always acceptable;
2. skip a proposal already refused in the same local situation this game (repeat suppression, no trial);
3. skip a plan with a cell the trial could not enter, by a **cheap static check** that mirrors the trial's own rule
   exactly (no trial needed; agrees with the real referee on 60 random crowded-board placements in the tests);
4. otherwise run the real referee on a **copy** of the state (trial page not kept); take the first plan it would place;
5. at most **3** referee trials per decision; then the best-ranked plan without an effect (recorded as a fallback).

The chosen plan then goes through the normal referee on the real state, so engine checks are never skipped and an
unverified rule is never activated: the adapter can only be more conservative than the referee. Each decision records the
rank played, trials used, skipped proposals and any fallback; the AI panel shows it. Not measured in self-play (no new
experiment); its effect should be observed in human play.

## 3. Kane shadow mode: prepared, NOT run (Priority 3)

`server/v6/kaneshadow.ts`:

* **Cases** are captured at decision time from the engine referee's verdict (human and AI placements alike, consenting
  sessions only): proposer, typed effect, cells, the engine's final decision (approved / rejected / unverified), stage,
  code, tier, message, whether it went live, referee latency, and the exact trial page Kane would see (stored with its
  SHA-256). Wrong or inconclusive engine decisions are kept as they were. Placements refused by a placement rule had no
  trial and are not cases. The effect is the engine's typed effect; nothing is re-interpreted.
* **Kane verdicts** (status, reason, per-condition results, latency, Kane version, evidence path) are appended to a
  separate file, linked by case id. Append-only: nothing is edited or deleted, and repeated attempts are all kept.
* **Disagreement types**: agree-approved, agree-not-approved, engine-approved-kane-rejected (the important one),
  engine-unverified-kane-approved, engine-rejected-kane-approved, kane-inconclusive. `report()` gives engine and Kane side
  by side with both latencies; `plan()` lists what a run would send without sending anything.
* **No authority**: the module never receives a game state, has no import of the engine's mutating functions or of the
  Kane client (`server/kane.ts`), and its results are never read back into refereeing. A test runs a test-double "Kane"
  that approves an unverified rule and checks the game state is byte-for-byte unchanged and the rule stays unplaced.
* **Execution disabled in code**: `SHADOW_EXECUTION = 'disabled'`; `runShadow()` refuses anything but an explicit test
  double. A live run needs a reviewed code change plus the existing paid-call gate. **Requesting separate operator
  authorization before any live evaluation.**

## 4. Human pilot readiness (Priority 4)

The V6 page (`npm run play:v6`) now has the PR #14 consent flow, reusing its storage module unchanged
(`server/playtest/telemetry.ts`), writing to its own directory `playtest-data/v6/` (gitignored):

* consent screen (record / play without recording; optional participant code, names refused), the consent text also
  explains the shadow cases;
* **gameplay facts** (`telemetry/`, schema `rule-sabotage/v6-telemetry@1`): ruleset, opponent version, seed, first mover,
  result, turns, effects placed / refused by a placement rule / not placed by the referee, triggers, chains, captures, AI
  latency, zero-move turns, per-turn events; built by the server only, no subjective field;
* **subjective answers** (`feedback/`, `rule-sabotage/v6-feedback@1`): five 1–5 ratings, tags, comment, exactly as
  entered; unanswered or invalid items stay null; skipping is recorded as skipped;
* match review, abandoned games recorded as abandoned, and "Delete my data" removing every file of the session including
  shadow cases. Nothing is written without consent; no feedback was invented (no human has played V6.1 here).

Gameplay rules are untouched; the pilot shell is a separate script (`client/v6/pilot-v6.js`).

## 5. Tests and checks

`tests/v6-2.test.ts`: shadow classification, case capture, append-only log, disabled execution, no game effect from a
Kane approval; adapter selection, repeat suppression, trial budget and fallback, static check against the real referee;
pilot consent / separation / deletion / no-consent-no-write / cross-session isolation; fast copy equality and decision
identity; parseKey and teleport list equivalence. V6 and V6.1 suites unchanged. `npm test`: 210/210 (209 in the full run plus one assertion fixed and re-run in isolation: 9/9). Browser smoke: consent screen, recording indicator, a V6.1 game against `v6-softmax-v2-ra@1` (placement, opponent turn with the adapter line "played its rank-1 plan after 1 referee pre-check"), match review. The deletion button and questionnaire were exercised through the HTTP tests, not clicked in the browser.

## 6. Operator decisions requested

1. **Authorize (or not) a live Kane shadow evaluation**: which cases, how many calls, budget. Nothing runs until then.
2. Whether to try a separately versioned budgeted policy for latency, after seeing pilot latency with the optimisations.
3. Whether the human pilot should use the original `v6-*@1` opponents, the referee-aware `-ra@1` ones, or both.
4. Optionally: the referee trial's "could not be entered" limitation (81% of non-placements) could be addressed in the
   referee itself (enter from a neighbour that holds an effect, after burning it in the sandbox). That is a referee
   change, so it is not made here.

# Living Balance Designer V3: batch research and starting-rule balance

V3 adds what V2 lacked: a durable record of **many** games, a balance space that includes the **rules of the
start** (not only planner weights), and an interface through which Kane can later read that record and propose
typed, testable changes. This phase runs no Kane call and makes no external model call.

```
100 offline games (5 starting conditions)  →  versioned dataset (summaries + replayable records + hashes)
  →  per-condition analysis with uncertainty  →  dashboard + replay pages
  →  Kane research dossier + notebook (PREPARED, not run)  →  typed proposals (hypotheses, interventions)
  →  fresh-seed protocol (validation, correction comparison, sealed holdout; each needs its own approval)
```

## What changed in the engine (experiment-only)

`server/engine.ts` gained an explicit, typed `StartingConfiguration` that only `init(seed, { start })` accepts, and
only with the token `EXPERIMENTAL_START_CONFIG`. Production (`server/game.ts`) calls `init(seed)` with no options,
so it is always the original 3 versus 3; a test fails if any production file mentions the experimental types.

| Property | Rule |
|---|---|
| Piece counts | 2, 3 or 4 **per role**: first mover and second mover, resolved once the first player is known |
| Placement | deterministic, mirror-symmetric home rows; `spread` keeps the production spacing (2: rows 3,5 · 3: 2,4,6 · 4: 1,3,5,7) |
| Piece ids / homes | `h1..hN`, `a1..aN`, home = start square (captures still send pieces home) |
| Actions per turn | **unchanged policy**: own pieces still on the board + banked bonus. Piece count therefore also changes action capacity and the victory requirement |
| Victory | all **own** pieces across (2, 3 or 4) |
| Turn limit (60) | higher **fraction** of own pieces across, then lower fraction of the total journey left (squares left / pieces × 6), then draw. Exact integer comparison. For equal counts this orders every game like the production rule, which is why 3:3 experimental games reproduce production games bit for bit (tested) |
| Optional knobs | `firstTurnActions` (cap on the first mover's turn 1) and `secondMoverFirstTurnBonus` (extra actions on turn 2). Implemented and tested, **not** used in the screen |
| Lead tracking | experimental games use the same normalized standing (`compareStanding`) for lead changes |

Planner: one new experiment-only hook, `searchOwnBenefitFactor` (partial version of V2's `searchOwnBenefit:false`;
factor 0 equals the V2 hook, factor 1 equals production, both tested). The planner itself is unchanged; with unequal
piece counts it still scores raw pieces across, which is part of what the screen measures (planner × start interaction).

## The 100-game screen

`balance/v3/matrix.json` (hash recorded in the run): five conditions × seeds 62001–62010 × both first movers = 100.

| Condition | First / second mover pieces | Games |
|---|---|---|
| C0 | 3 / 3 (production baseline) | 20 |
| C1 | 2 / 2 | 20 |
| C2 | 4 / 4 | 20 |
| C3 | 3 / 2 | 20 |
| C4 | 2 / 3 | 20 |

Both sides use the production planner and weights. The same seeds are used in every condition; the record shows for
each game the first turn at which its engine RNG diverged from the C0 game with the same seed and first mover.

### Zero external calls

* The batch worker's import graph (`offlineImportCheck`) contains only engine, rules, weights, planner, self-play and
  the guard. `game.ts`, `kane.ts`, `openrouter.ts`, `tiers.ts`, `trial.ts`, `server.ts` and V2 `kane2.ts` are
  unreachable; the check runs before every screen and in the tests.
* `server/balance/v3/offline.ts` is installed first in the main thread and in every worker: it deletes model/API/Kane
  keys from the environment, sets the referee off, and replaces `fetch`, `http(s).request/get`, `net`, `tls`,
  `dns`, `dgram` and `child_process` with stubs that count and throw. The run is accepted only if the total count
  over all threads is 0.
* Concurrency is bounded (6 worker threads on the 12-thread PC).

### Run exactly once

`npm run balance:v3:screen` refuses to start if the registry (`balance/v3/datasets.json`) already holds a
non-quarantined run of the matrix. A run that fails or is later found invalid is **quarantined** with a reason
(`npm run balance:v3:quarantine -- <runId> --reason "…"`), never deleted, and a fresh full run needs
`--approved-rerun "<operator approval>"`.

### Dataset layout (`evidence/balance/v3/datasets/<runId>/`)

| File | Content |
|---|---|
| `games.ndjson` | one compact summary per game (schema `GameRec` + game id, condition, winner role, detail hash) |
| `games/<gameId>.json` | the replayable record: per turn the board, engine RNG, every ranked candidate plan (chosen + rejected), placement, every move with its RNG and engine events, end-of-turn events, unused actions; final state hash |
| `run.json` | matrix and its hash, engine / planner / weights hashes, commit, guard counters, timing, CPU, peak memory, replay results |
| `replay-check.json` | all games re-executed move by move through the engine alone (no planner); plus one full planner re-run per condition compared field by field |
| `analysis.json` | overall and per-condition analysis, paired comparisons, RNG divergence, findings, selections |
| `replays/*.html`, `dashboard/`, `dossier/` | static pages (no scripts) |
| `manifest.json` | sha256 of every file |

The **dataset hash** covers `games.ndjson` and every `games/*.json`, so derived pages can be rebuilt
(`npm run balance:v3:build`) without changing the evidence. The journal `balance/v3/journal.ndjson` is hash-chained.
Future screens append new datasets; nothing old is rewritten.

## Analysis

`server/balance/v3/analysis.ts` + `stats.ts`, all exact or seeded: Wilson 95% intervals, exact binomial tests
against 50%, the minimum share needed for significance at n = 20 (15/20), a seeded permutation test of first-mover
win rate across conditions, exact sign tests on seed-paired outcomes versus C0, t intervals for game length.
Measures per condition: first-mover and Human-side win rates, side-with-more-pieces win rate (C3, C4), game length,
completion / turn-limit / draw rates, triggers on own versus opponent traps, conveyor moves (own trap carries the
piece forward) and whether the side with more conveyor squares won, forced forward / backward movement by effect,
placements and never-triggered cells, effect diversity, openings, top combinations, lead changes, comebacks,
planner decision margins and near-ties, actions per turn by role, first-score turn.

Findings are written by fixed rules and labelled DESCRIPTIVE, SIGNAL (exploratory, interval excludes 50%),
NO_EVIDENCE or LIMITATION. They never call a difference real from these 100 games.

## Kane: prepared, not run

* **Dossier** (`dossier/`): overview with the seven research questions, condition comparison, trajectories and
  counterexamples chosen by fixed rules, patterns, all 100 replays, limitations, a separate V2 background page,
  the experiment catalog, and the notebook. It shows no hypothesis and none of the auto-written findings.
* **Notebook** (`server/balance/v3/kane3.ts`, `proposals.ts`): one entry per competing hypothesis plus a final
  conclusion. Fields: title, cause (planner / starting rules / interaction / metric / no defect / other),
  explanation, cited game ids (validated), up to two predictions (metric, direction, minimum size), a catalog
  intervention with a bounded value, side effects, competing explanation, counterexample game, acceptance test,
  disproof. "No change is justified" is a valid conclusion.
* **Catalog** (allowlisted): S1 piece counts, S2 layout, S3 first-turn action cap, S4 second-mover bonus,
  P1 partial own-benefit search factor, P2 own-benefit valuation, P3 blind RNG, R1 teleport same column, W1 one
  weight. `toTreatment()` maps an entry to a typed start / hook / variant / weight; free text is never executed.
  Combinations are refused until each factor has its own registered single-factor result.
* **Provenance**: a proposal can be labelled Kane only with the stored raw kane-cli notes file, its sha256 and the
  note id, from a non test-double CLI (V2 `checkProvenance`). Origins: `kane`, `kane-test-double`, `claude`,
  `deterministic`, `operator`.
* **Gate**: `assertKaneApproved()` refuses any real call without an approval record and `KANE_V3_APPROVED=<runId>`.
  `npm run balance:v3:kane-plan` prints the objective and the planned calls (1 objective call, about 55 credits
  estimated; optional analyzer challenge about 10; ceiling 80) and calls nothing.
* `npm run test:balance-v3-e2e` runs the whole interface against the **test double** only.

## Correction acceptance (for later phases)

`acceptCorrection()` in `proposals.ts`, judged only on fresh seeds: the intended behaviour changed; the target
moved by the pre-registered size with a 95% interval excluding 0; mean length at most +25% and turn-limit rate
at most +10 points (V2's K1 at 14.5 → 27.1 turns fails this); first-mover edge not worse by more than 5 points;
effect entropy not down by more than 0.1; comebacks not down by more than 10 points and lead changes not down by
more than 25%; zero safety violations. Closer to 50% alone is never enough. The fresh-seed protocol is in
`balance/v3/protocol.json` (validation 62101–62130, correction comparison 62201–62240, sealed holdout committed by
hash at sealing time); every phase needs its own operator-approved budget.

## Commands

```
npm test                                   unit tests (V1, V2, V3)
npm run test:balance-v3-e2e                Kane interface with the test double
npm run balance:v3:screen                  the 100-game screen (once)
npm run balance:v3:screen -- --smoke DIR   20-game pipeline smoke on throwaway seeds 90001-90002 (not a dataset)
npm run balance:v3:verify -- <datasetDir>  manifest, dataset hash, journal, engine replay of every game
npm run balance:v3:build -- <datasetDir>   rebuild analysis and pages from the stored games
npm run balance:v3:kane-plan -- <dir>      show the prepared Kane run (never calls Kane)
```

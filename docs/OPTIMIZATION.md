# Referee optimization, phase 1 (2026-11-17)

**Goal:** cut referee latency and skip Kane calls that aren't needed, without breaking the working end-to-end flow.

**Baseline:** commit 05bc2b3. Every number in this file was measured in the cloud container with the **Kane test double**, unless it is marked *real Kane*. The test double proves our plumbing works. It says nothing about how fast real Kane is, or what it decides.

## 0. Baseline (before any change)

| Check | Result |
|---|---|
| `npm test` | 38/38 pass (18 s) |
| `npm run test:browser` (engine only) | 10/10 |
| `KANE_DOUBLE=1 FAKE_KANE_DELAY_MS=4000 npm run test:browser` | 11/11 |
| Real Kane, from the operator's PC at 1917d6c | 8/8 expected verdicts. A review that missed the cache took 82–115 s. The V4 run took 109–175 s. A cache hit took 0 s. |

## 1. AI effect consistency (bug fix)

**The bug.** In `aiTurn`, the model's sentence was re-interpreted, and *that* interpretation was installed. The check against the planned effect, `sameEffect`, was computed and then thrown away (`void placedOk`). A mismatched sentence could therefore install a different effect from the one the planner chose. One example the benchmark recorded: the plan was "Shove", but the model wrote "moved to column A".

**The fix.**
- The planner's typed effect is now *always* the effect that gets installed.
- `resolveAIRuleText()` runs the model's (or planner's) sentence through the deterministic parser. The sentence becomes the rule text only if the parser reads exactly the planned effect, with status `ok`.
- Otherwise the rule text is `canonicalRuleText(effect)`, and the decision records why. That covers a mismatch, a rejected sentence (policy, injection), an approximation, or no sentence at all.
- The placement then goes through the same `validatePlacement` and `referee()` as a human placement.

**Side effect.** The AI's sentence is no longer sent back to the LLM for interpretation, so there is one LLM call fewer per AI placement. The benchmark's p50 for one interpretation call was 0.94 s on Nemotron and 5.2 s on OpenRouter free.

## 2. Kane latency instrumentation

Every Kane result now carries a `timings` object. It is written into each `result.json` and the `kane:trial` report, and the UI shows submit→verdict time.

| Stage | Field |
|---|---|
| Cache | `cache`: hit / miss / joined-in-flight |
| Availability and auth probe | `probeMs` (the probe is cached for 5 min) |
| Evidence write | `evidenceWriteMs` |
| Browser startup | `browserSpawnMs` |
| CDP readiness | `cdpReadyMs`, plus `cdpReady` (false means the 15 s wait ran out) |
| Kane CLI execution | `cliMs`, `cliFirstOutputMs`, `cliRunEndMs` |
| Output parsing | `parseMs` |
| Cleanup | `cleanupMs` |
| Submission to verdict | `verdict.timing.submitToVerdictMs`, `trialBuildMs`, `tierMs` |

Measured with the test double (it sleeps 500 ms, then answers):

| Stage | ms |
|---|---|
| Probe (warm) | 0 |
| Browser spawn | 3–5 |
| CDP ready | 271–292 |
| CLI | 607–624 |
| Parse | 0–1 |
| Cleanup | 316–317 |
| Evidence write | 2–7 |
| Total | 1.2 s |

**Real Kane stage timings have not been measured yet.** Baseline real reviews take 82–115 s. Browser startup plus CDP readiness plus cleanup add up to about 0.6 s on this machine. If the same holds on the PC, kane-cli execution is the bottleneck, not the browser. That is a hypothesis until one controlled real run confirms it.

## 3. Referee tiers (`REFEREE_TIERS=on`; default off)

Code: `server/tiers.ts`. Selection is a pure function of the placement and the board. Human and AI proposals go through the same function, and it only escalates when unsure.

| Tier | When | Decided by | Label |
|---|---|---|---|
| 1 | The effect is supported and absolute (or has no movement), and nothing is within 4 squares | Engine checks E1–E6 | **engine-approved (tier 1), not reviewed by Kane** |
| 2 | Teleport (RNG), back/forward shoves, chains, or effects nearby | E1–E6, plus every side of every new cell entered by a lone Human piece and a lone AI piece, which must give identical outcomes, no re-fire and stay under the chain cap | **engine-approved (tier 2)** |
| 3 | Any of: an approximated request; an effect kind not reviewed for tiers; a cell the trial couldn't enter; a chain at the cap; a rollout with a stuck turn; any tier-2 simulation that doesn't come out clean | Real Kane, in the background, fail-closed as before | Kane approved / rejected / unverified |

**Why tiers 1 and 2 may skip Kane.**
- Kane's first five conditions are the same facts as engine checks E1–E5.
- The sixth condition says nothing permanently traps a player, targets one side, or decides the game. That holds by construction for the closed effect set in `rules.ts`.
- E2, E5 and E6 check it on the actual board, and tier 2 rechecks it from every side.

**Labelling.** An engine approval is stored as `final: 'engine-approved'` with `decidedBy: 'engine'` and `kane: null`. It cannot be displayed as "Kane approved". The referee chip reads "+ engine tiers" when tiers are on.

**Original route kept.** With the flag off, nothing about routing changes. A regression test checks this.

### How many reviews would still need Kane (`npm run tiers:routing -- 30`, engine-only bots)

| Matchup | Placements | Tier 1 | Tier 2 | Tier 3 (Kane) |
|---|---|---|---|---|
| planner vs planner | 291 | 10% | 78% | **12%** |
| casual vs planner | 218 | 12% | 80% | **8%** |
| casual vs casual (10% approximated requests) | 446 | 7% | 75% | **19%** |

- **Speed.** Trial build averaged 25–46 ms and tier selection 1.3–1.7 ms. With the test double, the browser showed a tier-1 verdict 281–322 ms after the click. A Kane-tier rule took 5.6–6.5 s with the double's 4 s delay; with real Kane the baseline is 82–115 s.
- **Most common reasons for tier 3.**
  - Approximated requests.
  - A cell whose four neighbours all hold effects, so the trial couldn't enter it.
  - A rollout with a stuck turn.
  - Human and AI outcomes that differ near a goal column.
- **Caveat.** This is bot play. Real players may write more approximated or unusual rules.

## 4. Cache correctness

- **Key.** The key is computed from:
  - the trial signature, which now covers the rule text, every piece, every live effect *with its owner and cells*, the RNG state, the turn, the turn limit and banked actions;
  - the trial page, with its run-specific ID normalized out;
  - the six conditions and the referee policy version;
  - the Kane CLI path, version and mode;
  - `ENGINE_HASH`, a hash of `engine.ts`, `rules.ts`, `trial.ts` and `ai.ts`.

  Before this change the signature left out effect owners, the RNG (which sets teleport destinations), the turn and the rule text, and the key ignored conditions and versions.
- **Only complete verdicts are cached.** Approved and rejected verdicts are stored. An unverified result, whether a timeout, garbage output or a missing CLI, is never stored.
- **Concurrent identical reviews share one kane-cli run.** The second one is marked `joined-in-flight`.
- **The cache is bounded** at 500 entries and lives in memory per server process.
- **Delayed approvals.** The engine checks are re-run on the board as it is when the approval arrives, and the effect goes only on cells that are still eligible. A test moves a piece onto one cell and puts an opponent effect on another while Kane is reviewing. Only the free cell goes live, and the opponent's effect is untouched.

## 5. Verification (this container)

| Run | Result |
|---|---|
| `npm test` | **52/52** (38 existing + 14 new in `tests/referee.test.ts`) |
| `npm run test:browser` | 10/10 |
| `KANE_DOUBLE=1 FAKE_KANE_DELAY_MS=4000 npm run test:browser` | 11/11 |
| the same with `REFEREE_TIERS=on` | 12/12 |
| `REFEREE_TIERS=on npm run test:browser` | 11/11 |
| `kane:trial` smoke test with the test double and tiers on | the script runs and writes the stage-timing table. The double approves even the canary, as expected: that row is **not evidence** |

The 14 new tests cover:
- canonical-text round-trips for all 23 effects;
- mismatched, invalid, injected and approximate AI sentences, plus a successful canonical placement;
- the AI installing the planned effect under a lying model;
- tier boundaries and escalations;
- Human/AI tier symmetry;
- routing with tiers on and off;
- a Kane timeout that fails closed;
- cache-key invalidation and signature separation;
- concurrent deduplication;
- unverified results not being cached;
- stage timings being recorded;
- delayed approval on a changed board.

## 6. Real Kane evidence (operator's PC)

**Run setup.**
- One approved run: `REFEREE_TIERS=on npm run kane:trial` at commit b36204e on 2026-11-17.
- kane-cli 0.10.4 in analyzer mode, on Windows.
- LLM keys were removed from the process, so the AI used the local planner.

**Results.**

| Run | Expected | Result | Kane time | Cache |
|---|---|---|---|---|
| A human rule | approved | approved | 106.0 s | miss |
| B same rule from the AI | approved | **unverified (timeout)** | 374.1 s | miss |
| C canary: corrupted page | rejected | rejected (C1 false) | 155.3 s | miss |
| D repeat of A | approved | approved | 0 s | hit |
| E seed 11/12, human rules | approved | engine-approved, tier 1 | 205–238 ms | no Kane |
| E seed 11/12, AI rules | approved | engine-approved, tier 2 | 161–162 ms | no Kane |

**Time per stage, in ms.**

| Run | Probe | Browser spawn | CDP ready | CLI total | CLI first output | CLI run_end | Parse | Cleanup | Evidence write | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 0 | 45 | 764 | 104452 | 1655 | 101746 | 9 | 672 | 191 | 106137 |
| B | 0 | 635 | 2219 | 369946 | 1488 | none | 0 | 1012 | 1104 | 374920 |
| C | 19815 | 276 | 4835 | 129715 | 14791 | 128406 | 0 | 616 | 10 | 155317 |

**What the timings show.**
- **The bottleneck is kane-cli's own analysis, not the browser.**
  - In run A, starting the browser and waiting for it to be ready took 0.8 s, and cleanup 0.7 s.
  - The CLI produced its first output at 1.7 s and its verdict at 101.7 s.
  - That leaves about 100 s, or 95%, inside Kane. That stretch can only be made shorter by sending fewer Kane calls.
- **Run C** shows two more costs:
  - a cold probe of 19.8 s, because the 5-minute probe cache had expired by then;
  - a slow CLI start of 14.8 s.
- **Run B stalled inside kane-cli.**
  - Its stdout holds only 4 start-up events from the first 1.3 s: `stream_start`, `recording_state`, `update_available` (0.10.4 → 0.10.5) and `skill_update_available`. No `run_end` ever came.
  - The process was killed at the hard limit, and the result was recorded as **unverified** with exit code 1.
  - It was not cached and would not have gone live. The fail-closed path behaved as designed.
  - The same trial content was approved in about 98–109 s on earlier runs.
- **Tiers removed every Kane call in the in-game scenario.**
  - The four in-game rules were decided in 161–238 ms, against 82–115 s for an uncached Kane review in the baseline.
  - A placement request returned in 413–467 ms. A full AI turn took 913–1067 ms.
- **Credits:** about 24.4 for this run (10701.78 → 10677.40).
- **Evidence:** `evidence/kane/live-2026-11-17T19-31-37-787Z.md` and `.json`, plus `T9102-4a8d78461ae504dc` and `T9103-canary-9e6a1fb6c37c0d62`, all on the PC.

**Note.** kane-cli 0.10.5 is available and has not been installed. Whether it fixes the stall in run B is untested.

## Risks

- **Tiers trust the engine for simple rules.** If the engine had a bug, Kane would no longer catch it for tier 1 and 2 rules. That is why the flag is off by default and every engine approval is labelled as such.
- **New effect kinds** go to Kane until someone adds them to `TIER_REVIEWED_KINDS`.
- **Pre-existing gap, not changed here.** A cell whose four neighbours all hold effects gets no symmetry row, so E2 passes vacuously for that cell. Tiers send such rules to Kane, and the default route always did.
- **Less AI flavour text.** The AI's own sentences now appear only when they match exactly, so more AI rules show the canonical sentence.
- **Probe before cache lookup.** The probe now runs before the cache is checked, so the version can be part of the key. A cache hit after the 5-minute probe cache expires pays one probe, roughly 1–3 s on the PC.

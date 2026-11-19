# Balance Designer V3: the 100-game starting-condition screen

**Status: READY_FOR_OPERATOR_V3_KANE_RESEARCH_REVIEW.** Exploratory evidence only: nothing was promoted, production
is unchanged (3 versus 3), Kane was not called.

| | |
|---|---|
| Run | `evidence/balance/v3/datasets/2026-11-19T13-38-38Z-v3-screen/` (open `index.html`) |
| Games | **100/100** complete (5 conditions × seeds 62001–62010 × both first movers), run **once** |
| External model / API calls during play | **0** (offline guard in the main thread and all 6 workers; 6 model/API environment variables present on the PC, including the Groq, OpenRouter and NVIDIA keys, were stripped before play) |
| Kane | **0 calls, 0 credits** |
| Illegal actions · engine errors · softlocks | 0 · 0 · 0 |
| Engine replay | 100/100 games re-executed move by move through the engine alone, identical events, RNG and final state hash |
| Planner determinism | 5/5 full planner re-runs (first game of each condition) identical field by field |
| Dataset hash | `cf5e4a82cfa3d4ee` (covers `games.ndjson` + all 100 `games/*.json`) |
| Hashes | commit `4e98d29` (clean) · engine `a7c0e281753a0114` · planner files `079c81a71b9dc09b` · weights `0.3.0#ddcf941c285bd537` · matrix `3361aba086e473f0` |
| Journal | `balance/v3/journal.ndjson`, 7 entries, hash chain verified |
| Time and resources | 8.5 min wall (13:38–13:47 UTC), 6 worker threads, per game 1.1 s to 200 s, 50 game-minutes in total, peak memory 646 MB, i5-1335U 12 threads |
| Terminal log | `evidence/balance/v3/screen-terminal.log` |

Reproduce or check: `npm run balance:v3:verify -- evidence/balance/v3/datasets/2026-11-19T13-38-38Z-v3-screen`
(manifest, dataset hash, journal, 100 engine replays; all PASS). After the run, derived files were rebuilt twice
from the unchanged games (a findings-text placeholder bug, then the added turn-1 measure); both rebuilds are in the
journal with the new manifest hash.

## Outcomes by starting condition

Decisive games only (there were no draws). Intervals are 95% Wilson; p is the exact two-sided binomial test against 50%.

| | C0 3/3 | C1 2/2 | C2 4/4 | C3 3/2 | C4 2/3 |
|---|---|---|---|---|---|
| First mover won | 12/20 (39–78%) | 13/20 (43–82%) | 12/20 (39–78%) | 10/20 (30–70%) | **17/20 (64–95%), p 0.003** |
| Side with more pieces won | | | | 10/20 | **3/20** |
| Human side won | 6/20 | 11/20 | 8/20 | 8/20 | 11/20 |
| Mean turns (95% CI) | 16.8 (8.0–25.6) | **9.45 (7.6–11.3)** | **18.9 (12.0–25.8)** | 15.7 (8.4–23.0) | 15.85 (8.5–23.2) |
| Median turns | 10 | 9.5 | 13.5 | 11 | 12 |
| Reached the turn limit | 3/20 | 0/20 | 2/20 | 2/20 | 2/20 |
| First mover scored on turn 1 | 7/20 | 6/20 | 9/20 | 8/20 | 6/20 |
| Lead changes per game · comeback rate | 4.35 · 85% | 4.15 · 65% | 4.65 · 95% | 1.7 · 80% | 3.4 · 85% |

Pooled (a mixture of five rule sets): first mover 64/100 (54–73%, p 0.007); Human side 44/100 (n.s.).
Across conditions, the first-mover rate does not differ detectably (seeded permutation test p 0.243). Seed-paired
against C0, no condition flips first-mover results significantly (C4: 8 toward, 3 away, sign test p 0.227).
The same seed gives the same game only until the RNG diverges, typically by turn 3.

## Behaviour

* **Movement is dominated by traps the mover's own side placed.** 79–88% of all triggers are on the stepping
  side's own traps; forced forward movement equals 89–115% of each side's whole journey; winners gain on
  average 0.91–1.30 of their journey from their own traps. The most common openings are three identical shoves
  toward the placer's own goal (Human east, AI west).
* **Turn-1 scores.** In 36/100 games the first mover brought a piece across on its first turn, before the
  opponent had placed anything, and **every one of those 36 used a teleport on turn 1** (the planner's look-ahead
  copies the engine RNG, so it sees where the teleport will land; own teleports gained 4.01 squares on average over
  255 triggers). The first mover won 27/36 of those games versus 37/64 of the rest.
* Conveyor use is universal (every game) and barely separates winners from losers: the side with more conveyor
  squares won 51/93 games where they differed.
* Fewer pieces means shorter games (C1 vs C2 intervals barely touch). About half of all trap cells are never
  triggered in every condition.

## What the screen does and does not show

* It **suggests** two things worth testing on fresh seeds: the 2/3 start favours the first mover (or the side
  with fewer pieces), and the first-turn teleport foresight gives the first mover tempo.
* It does **not** show that any starting rule is fairer. C3's 50% is not "balanced"; it is one 20-game sample
  with a 30–70% interval.
* The planner plays both sides, so these are properties of this planner playing itself under these rules.

## Hypotheses registered for the next phase (`balance/v3/proposals.json`)

Registered after the screen and before any validation game (journal entries 5 and 7). None is from Kane.

| Id | Origin | Cause | Claim | Test |
|---|---|---|---|---|
| HC0 | Claude | no defect | C4's signal is a five-look screening artifact | fresh 2/3 games, observational |
| HC1 | Claude | starting rules | fewer pieces to bring across beats more actions because traps do the moving | S1 2/3 vs 3/3, and survives P4 |
| HC2 | Claude | interaction | the planner's raw-sum evaluation mis-plays unequal counts | P4 normalized evaluation |
| HC3 | Claude | planner | own-trap conveyors dominate; a partial search correction (factor 0.5) may cut them without V2's length regression | P1 0.5 |
| HC4 | Claude | starting rules | first-turn tempo | S3 turn-1 cap 1 |
| HC5 | Claude | planner | turn-1 scores come from teleport RNG foresight | P3 blind RNG |
| HD1 | deterministic | starting rules | mechanical tempo correction for the only condition whose interval excludes 50% | S4 second-mover bonus 1 |

HC1 and HC2 make opposite predictions under P4, which is what makes that arm discriminating. HC4 and HC5 make
different predictions under P3 (HC5: turn-1 scores collapse; HC4: tempo remains).

## Next controlled experiment (needs approval; not run)

`V3-VALIDATE` from `balance/v3/protocol.json`, offline, 0 Kane, fresh seeds 62101–62130 (60 games per arm):

| Arm | Start | Planner | Tests |
|---|---|---|---|
| A | 3/3 | production | control |
| B | 3/3 | P3 blind RNG | HC5 vs HC4 (turn-1 scores, first-mover edge) |
| C | 2/3 | production | HC0 vs HC1 (does the C4 signal reproduce?) |
| D | 2/3 | P4 normalized evaluation | HC1 vs HC2 |

240 games, about 20 minutes on this PC. Optionally first, an approved Kane research run on the dossier (1 objective
call, about 55 credits estimated, ceiling 80) so that Kane's own hypotheses are registered before these arms run.

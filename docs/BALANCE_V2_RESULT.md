# Balance Designer V2: first full cycle (DRY-RUN, no Kane)

**This is a dry-run.** kane-cli was not invoked. Every hypothesis below comes from the operator (H0–H4) or Claude
(H5). Nothing here is a Kane finding. The Kane stages are SKIPPED and every final adequacy verdict needs real Kane
to move past UNVERIFIED; the one verdict here is REGRESSION, which does not depend on Kane.

| | |
|---|---|
| Command | `npm run balance:v2:record` (dry-run) |
| Run | `evidence/balance/v2-runs/2026-11-19T07-54-37Z-v2-dry/` (REPORT.md, status.json, journal.ndjson, every game, pages, manifest) |
| Commit / engine / weights | `17bd717` / `5b79cac132ecdfbd` / `0.3.0#ddcf941c285bd537` (V0.3, unchanged) |
| Seeds | exploration = V1 games 1000–1011 (hash-verified, read only) · development 3100–3115 · holdout 7000–7015 (sealed until corrections were frozen, commitment verified on unsealing) |
| Games | 384 new games (288 development, 96 holdout) + 2 traced replays of V1 games, 0 illegal actions, 0 engine errors, 0 softlocks |
| Wall time | 07:54:38 → 08:05:42 UTC (11 min) |
| Recording (kept locally, size) | `evidence/balance/v2-recordings/2026-11-19T07-54-37Z/`: `raw.webm` 12 min unedited (sha256 `93dcfbef…`), `concise.webm` 52 s, every frame labelled ACCELERATED 12× (`8c67abdc…`), `terminal.cast` |

## Observation (V1 evidence, re-measured)
Teleport: 88% of triggers by the installer's own pieces, +3.4 squares for the activator on average. East/west shoves:
**100% are placed in the placer's own forward direction**, and in control self-play 86% of their triggers are the
installer's own pieces riding them.

The first metric turned out to be useless as a test. In a smoke run it was 1.0 under every condition, because a west
shove placed by the AI both blocks Human and carries the AI. The hypotheses were switched to the trigger metric
before this run, and the development seeds were moved to fresh ones (see the note in `balance/v2/hypotheses.json`).

## Hypotheses: pre-registered outcomes (development seeds, 16 seeds × 2 orders)

| Id | Origin | Outcome | What the experiments showed |
|---|---|---|---|
| H0 no defect | operator | **INCONCLUSIVE** | A planner without self-benefit valuation is not clearly weaker head-to-head (46.9%, CI 37.5–56.3%). But an RNG-blind planner wins only 31.3% (CI 18.8–43.8%), so its discriminating prediction against H5 was contradicted. |
| H1 rule geometry | operator | **INCONCLUSIVE** | The distance-neutral teleport variant cut Teleport placements from 1.41 to 0.16 per game (met). The non-installer comparison had only 6 events, so it was not judged. Its own side prediction "blinding the RNG doesn't change own-teleport gain" was contradicted. |
| H2 planner valuation | operator | **REFUTED** | Ignoring benefit from own traps did not lower the shove self-trigger share (0.857 → 0.891). Teleport self-share fell 13 points, below the 15-point bar (not judged met). |
| H3 placement search | operator | **SUPPORTED** | Removing own-piece benefit from candidate scoring lowered the shove self-trigger share 0.857 → 0.668 (−0.19, CI −0.25 to −0.13), and teleport self-share by 12 points. Removing the V0.3 overlay changed nothing (discriminates against H4). |
| H4 weights | operator | **REFUTED** | Teleport utility at its measured +3.4: self-share −0.016 (CI −0.09 to +0.07). Overlay removed: shove self-share +0.035. The weights do not drive the pattern, which is consistent with V1's rollback. |
| H5 RNG foresight | Claude | **REFUTED** (by its own pre-registered rule) | The RNG-blind look-ahead gained 1.35 squares less per own teleport step (4.32 → 2.98, met) and lost head-to-head (met). Its third primary prediction, "more own steps end farther from goal", was 0 in both conditions (contradicted). That prediction was badly chosen: even a blind planner only steps on its own teleport from where every destination is forward. The rule is applied as registered; a revised H5 v2 needs fresh seeds. |

"SUPPORTED" means the registered predictions held on these 16 seeds. It does not mean the mechanism is proven.

## Correction and adequacy (fresh holdout seeds)
H3 was the only SUPPORTED hypothesis, so one correction was proposed: **K1, planner (REVIEW_REQUIRED)**. It scores candidate cells without counting own-piece benefit.

- **A. Implementation correctness: UNVERIFIED.** All 32 games diverged from control (from turn 1). Only the declared component changed. The invariants hold. The browser-observable check needs real Kane.
- **B. Balance adequacy: REGRESSION.**
  - The target did improve robustly: shove self-trigger share went 0.884 → 0.645 (−0.24, CI −0.29 to −0.17). The drop held in both seed batches and both first-player orders.
  - But games got much longer: 15.7 → 27.6 turns.
  - Draw or turn-limit endings rose by 15.6 points.
  - The corrected AI won only 21.9% head-to-head against the production planner.
  - Diversity, dominance, counterplay and safety stayed within tolerance.
- **Decision: NO CORRECTION PROMOTED.** Production weights and the planner are unchanged.

## What this cycle established, without Kane
1. The pattern does not come from the V0.3 weights (H4 refuted, again).
2. The shove "conveyor belts" come mainly from candidate-cell search (H3 supported). Removing that reduces conveyor riding, but it also makes games drag, so it is not an acceptable fix as it stands.
3. The planner's look-ahead knows where a teleport will land. Taking that away measurably reduces both teleport gains and the planner's strength. This is a fairness issue: a human cannot do this. Under the pre-registered rules it is still **not** a supported hypothesis, so a corrected H5 v2 has to be run on fresh seeds.

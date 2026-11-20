# Balance Designer V5.1: causal ablation and strategy-versus-RNG diversity

**Status: READY_FOR_OPERATOR_V5_1_CAUSAL_DIAGNOSTIC_REVIEW.** Nothing merged, deployed or promoted. Holdout 65001–65060
untouched. 0 Kane calls, 0 external calls. The only new games are the preregistered 96-game ablation, run once.
All V1–V5 datasets, registrations and verdicts are unchanged (V5's evaluation.json is untouched; new measures are separate).

## Headline

**The ev-k1.1 "stall" is not a planning-quality effect of C1–C4. It is a seed-correlated random branch.** The planner's
temperature roll is drawn from `rng(seed ^ (turn + 7)·0x9e3779b1)`, a single xorshift step, inherited from the production
planner's pattern. For consecutive seeds that first draw is almost constant: at turn 21 it is 0.621–0.623 for every seed
68001–68030 (V5) and 0.559–0.560 for every seed 69001–69008 (V5.1). The standard deviation over 30 consecutive seeds is 0.0006,
against 0.289 for a uniform draw. ev-k1.1 games are identical across seeds until turn ~21, where the top two candidates are
0.48 apart, inside the 0.6 temperature window. So one nearly fixed draw decides whether the game ends at turn 22 or stalls
to the turn limit. With C4 (no planning noise) this roll is the planner's **first** draw of the turn, so the weak mixing shows.
ev-k1 consumes many noise draws first, which hides it.

Consequence: in V5, the 60 ev-k1.1 self-play games are, for the planner's own randomness, close to **one** replicate. Their
85% turn-limit rate and 26% first-mover rate are not independent observations of ev-k1.1. They describe one branch. The V5
preregistered verdicts stand as recorded, but the reference's numbers should not be read as policy-level estimates.
softmax-v2 samples from a sha256-seeded stream and does not have this problem. oa-v2 has no temperature.

## A. C1–C4 ablation

**A1 – implementation.** `server/balance/v5_1/ablation.ts` (`abl-1`): one module, four switches. Switches off reproduces the
frozen ev-k1, and all four on reproduces ev-k1.1, decision by decision on 80 stored states and 5 synthetic ones (chosen plan,
every candidate score bit-identical, executor moves). Historical implementations are untouched.

**A2 – zero-game decision traces** (`evidence/balance/v5_1/trace.json`): the same 40 V4.2-K1 states and 40 V5-ev-k1.1 states
given to every arm at temperature 0.

| Arm | same decision as K1 | same decision as ev-k1.1 | same placement as K1 |
|---|---|---|---|
| K1 + C1 / + C2 / + C3 | 80/80 each | 72/80 | 80/80 |
| K1 + C4 | 72/80 | **80/80** | 80/80 |

C1, C2 and C3 never changed a decision. Every ev-k1 vs ev-k1.1 difference (8/80) is C4, and always in the committed moves,
never the placement.

**A3 – 96 games** (`balance/v5_1/ablation-protocol.json`, journal #1 before any game, seeds 69001–69008 × both first movers,
16 games per arm). Run `evidence/balance/v5_1/2026-11-20T*-v51-ablation`: 96/96, 6.1 min, **96/96 replays identical**, 0 external
calls, 0 illegal moves / errors.

| Arm | Turn limit | Mean (median) turns | Moves per turn | Zero-move turns | Unused actions / game | First mover |
|---|---|---|---|---|---|---|
| K1 (frozen) | 5/16 (14–56%) | 30.3 (17) | 1.32 | 23% | 13.4 | 80% |
| K1 + C1 | identical to K1 in all 16 games | | | | | |
| K1 + C2 | identical to K1 in all 16 games | | | | | |
| K1 + C3 | identical to K1 in all 16 games | | | | | |
| K1 + C4 | 0/16 (0–19%) | 22.0 (22) | 1.50 | 4.5% | 1.0 | 0% |
| full ev-k1.1 | identical to K1 + C4 in all 16 games | | | | | |

Preregistered rule: a correction is a candidate cause if its turn-limit or length interval versus K1 lies above 0. **None
qualifies, and ev-k1.1 did not reproduce the stall on these seeds → INCONCLUSIVE** (as written). What the design does
identify: C1–C3 have no effect at game level here, and C4 alone accounts for every behavioural difference between ev-k1 and
ev-k1.1. Interactions: not identified (no pairwise arms), and none is needed to explain these 96 games, since C4 ≡ full.
Note that all 16 ev-k1.1 games are the same 22-turn game up to RNG state (no teleport occurred). That is the seed-correlation
problem again.

Information invariance: no teleport moves in the C4 / K11 games; K1-family foresight +0.31 (−0.65 to +1.26) on 11 moves (wide,
contains 0).

## B. Strategy versus RNG diversity (`evidence/balance/v5_1/reanalysis.json`, 300 stored V5 games, no game played)

| Arm | first-turn choices | strategic prefixes (decisions until the first random outcome) | V5 "two-turn openings" (realized trajectories) | repeated identical states: with >1 decision | post-chance responses per destination |
|---|---|---|---|---|---|
| S-REF ev-k1.1 | 1 | 1 | 1 | 0 of 476 | 1.00 |
| S-OA oa-v2 | 1 | **1** | **60** | 0 of 10 | 1.05 |
| S-SM softmax-v2 | 2 (97% one) | 2 | 3 | 15 of 153 (sampling) | 1.03 |
| X-REF-OA | 2 | 2 | 20 | 0 of 128 | 1.11 |
| X-REF-SM | 1 | 1 | 1 | 11 of 222 | 1.00 |
| X-OA-SM | 2 | 2 | 20 | 2 of 30 | 1.09 |

* oa-v2's "60 distinct openings" are **one** strategic choice (a Teleport placement and the move into it) followed by 60
  different random destinations. Strategic opening diversity: 1. V5's original metric stays as published; this is the
  corrected reading.
* Every deterministic policy is a function of the public state (0 repeated states with different decisions). Only softmax-v2
  varies, and only in 15 of 153 repeated states.
* After a random outcome, the response is essentially determined by the visible destination (1.00–1.11 responses per
  destination). Post-chance diversity is RNG diversity plus a deterministic reaction.
* Matched public states (60 states from all arms given to every policy): placements differ ev-k1.1 vs oa-v2 on 22, ev-k1.1 vs
  softmax-v2 on 11, oa-v2 vs softmax-v2 on 23. The policies do decide differently on the same positions.

## C. oa-v2 diagnostics

* **Agreement, corrected** (a move counts as random only with more than one legal outcome): **2169/2169**. The frozen
  2166/2169 stays the preregistered measurement; the 3 differences were teleports with a single legal destination.
* **The 4 games over 30 minutes** (`evidence/balance/v5_1/oa-profile.json`, real computation on their recorded positions,
  single-threaded): 11–53 s per decision on average (max 100 s), against 0.8–3 s in normal OA games. They are not long games
  (15–26 turns). The cost is per decision:

| | slow games | normal games |
|---|---|---|
| share of time in the worst-case search | 65–87% | 78–81% |
| own end states per decision (avg / max) | 347–1,122 / 3,352 | 56–319 / 1,208 |
| opponent options evaluated per decision | 237–312 | 35–130 |
| greedy simulations in the worst-case search | 9,500–14,500 (max 31,000) | 900–3,200 |

  Causes, verified: (1) **branching** — a second teleport inside our own move phase multiplies end states (n × n); (2) **the
  opponent model** — 6 candidates × up to 8 strata × 5–13 opponent placement options, each with a full greedy move phase;
  (3) **repeated work** — own end states are enumerated for all ~12 candidates before only 6 are searched (13–35% of time).
  Board crowding (up to 35 live effects) raises all three.
* **Effect on the 80% first-mover statistic:** the 4 aborted games are recorded as draws and excluded from the decisive count
  (40/50 = 80%). Had they all been first-mover wins: 44/54 = 81%; had they all been losses: 40/54 = 74%. The direction (a
  strong first-mover edge under oa-v2) holds either way. The preregistered eligibility failure stands.
* **Bounded-work design (proposal, not implemented, original oa-v2 unchanged):** `oa-v3` with an explicit, recorded work budget
  per decision. It would cap own end states per candidate by strata before the second teleport level, pre-rank opponent
  options by a cheap one-step value and search the top 4, and memoise the worst-case value by canonical state within a
  decision. If a budget is hit, the decision records `budgetHit` and which caps applied; there is no silent truncation, and
  games are never cut short.

## D. Why turn 1 is fixed (`evidence/balance/v5_1/openings.json`, no game played)

* The start position is the **same for every seed**, so a deterministic policy's turn 1 is a constant. Only planner randomness
  could vary it, and that roll is seed-correlated (above).
* The restriction comes from the **shared candidate generator**: one cell set per effect (top 3 cells by a per-cell
  heuristic), 12 candidates in all. The best (Shove east 2 on B2 B4 B6, score 8.10) beats the second by 3.95, far beyond the
  temperature window. It is not the rules, not search pruning (all 12 are fully evaluated), and not the shared executor (the
  executor only plays moves after the choice). The evaluation weights matter in that the overlay adds 2.85 to the winner.
* **Wider, legal, purposeful candidates** (scored exactly as ev-k1.1 scores its own; validated: 0 difference on its own 12):
  per effect, every 1- and 2-cell subset of the top 4 cells and the top-3 cells inside each own piece's lane, 151 candidates.
  Four are within the reference's error band (1.33) of the best, and they **outscore the current choice**: Shove forward 2 on a
  lane (10.65 / 10.60 / 10.60) and +1 action on a lane (10.50). The current generator never offers them.
* Proposal: generator v2 (`openingCandidatesV2`) as a versioned candidate set for a future policy. Coverage is counted only
  among candidates within the error band, never by adding poor moves. Caution: the best new lines are three-cell forward-shove
  chains in one lane, a conveyor rush. They may be strong but degenerate, and that needs its own check before any adoption.

## E. Would the next Kane dossier misrepresent the observations?

Yes, if it were built from the V5 tables as published. Specifically:
1. ev-k1.1's 85% turn limit and 26% first-mover rate look like 60-game estimates but are close to a single branch (seed-correlated
   roll). A dossier must say so, or drop those numbers.
2. oa-v2's "60 distinct openings" must be shown as 1 strategic choice plus RNG.
3. "Policy-dependent first-mover balance" is still supported by oa-v2 vs softmax-v2 (neither uses the weak roll), but its
   ev-k1.1 leg is weak evidence.
4. The ablation's INCONCLUSIVE verdict must not be described as "C4 causes the stall". What is established is that C4 is the
   only correction that changes behaviour, and that the stall itself is seed-branch-dependent.

A dossier that states these four points would not misrepresent the data. Kane was not run; that needs your decision.

## Recommendation

1. Replace the planner's temperature stream with a well-mixed public stream (sha256 of seed, turn and label, as softmax-v2 does)
   in a new versioned reference (`ev-k1.2`). Re-check that seeds then give independent rolls before any further games.
2. Treat all earlier EV-planner seed-range results as possibly seed-correlated in the planner's own randomness. The first draw of the stream varies by at most 0.0015 (standard deviation per turn) within every seed range used so far: V4 64001–64030, V4.2 66001–66030, V5 68001–68030 and V5.1 69001–69008 (evidence/balance/v5_1/temperature-roll-correlation.json). For ev-k1 the first draws feed the 0.02 planning noise, so its seeds are partly correlated too. Only teleport outcomes and later draws differ.
   The production planner uses the same seeding pattern; that is an operator question, not changed here.
3. Then, if approved, rerun the stall question on the well-mixed reference with a small preregistered design. Keep the holdout.

Tests: full default `npm test` 160/160 (`evidence/balance/v4/test-runs/v51-parallel-1.log`).

## Non-dataset computation

Decision probes and profiles on stored positions only. Smoke games: 6 throwaway games (seeds 99801–99806) for the ablation
preflight. The preflight criterion was corrected before preregistration: plan = execution is required only for the arms that
claim it (C4, ev-k1.1). Without C4 the planner plans with noise and executes without it by design: 10/14, 56/60 and 8/13 turns
agreed for C1, C2, C3.

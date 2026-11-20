# Balance Designer V5: policy-diversity experiment

**Status: READY_FOR_OPERATOR_V5_POLICY_DIVERSITY_REVIEW.** Nothing merged, deployed or promoted. Holdout 65001–65060
untouched. **0 Kane calls, 0 external calls.** No result here is a proof about the rules, and none is about human players.

## 1. What was run

* **`ev-k1.1`** (new reference, `server/balance/v5/evk11.ts`) = the frozen `ev-k1` plus C1 side-relative trap-cell ties,
  C2 complete side-relative ordering of equal reply states, C3 value ties below 1e-7, C4 planning with the executor's own
  move model (no planning noise). The engine's real teleport law is unchanged. `ev-k1` and every V4.2 result stay frozen
  (hash `3af55720…` unchanged, its recorded game still re-executes exactly). **V4.2 numbers are not measurements of ev-k1.1.**
* **`oa-v2`** (opponent-aware maximin) and **`softmax-v2`** (bounded Top-k softmax), both on the **shared ev-k1.1
  executor**, so plans and executed moves come from the same move model.
* Preflight (`evidence/balance/v5/preflight.json`): 70 new positions (V4 pilot, V4.2, synthetic), all three policies
  **0** mirror mismatches in plans and in executed moves, **0** hidden-RNG changes in plans and executed moves, **0**
  nondeterminism; oa-v2 had 13/70 positions with top-two scores within 1e-6 (ties broken canonically, still symmetric);
  ev-k1 vs ev-k1.1 chose the same plan on 50/70 and the same placement on 68/70; oa-v2 and softmax-v2 chose a different
  placement from the reference on 22/70 and 19/70; 6 throwaway smoke games: 82/82 turns plan = execution, all replayed.
  A finite position set passing is not a proof of complete symmetry.
* Frozen in `balance/v5/journal.ndjson` (#1) before any game: protocol `c7b8ab26…`, implementation hashes, preflight
  sha256 and all 300 seed / role / first-mover assignments. Commit `15c225d` (clean).
* Run `evidence/balance/v5/2026-11-20T16-11-56Z-v5/`: 300/300 games once, 157 min, **300/300 engine replays identical**,
  0 external calls, dataset `127043314c0ee099`. Tests before the run: 157/157.

## 2. Results (seed-blocked 95% intervals; cross-play blocks = the 4 games of a seed)

| Self-play (60 games each) | ev-k1.1 | oa-v2 | softmax-v2 |
|---|---|---|---|
| First mover wins (decisive) | **14/54 = 26% (15–37%)** | **40/50 = 80% (71–90%)** | 29/59 = 49% (33–65%) |
| Human side wins (decisive) | 33/54 = 61% (49–73%) | 21/50 = 42% (29–55%) | 31/59 = 53% (45–61%) |
| Mean (median) turns · turn-limit rate · draws | **56.5 (60) · 85% · 6** | 36.2 (22) · 47% · 10 | 21.0 (14) · 15% · 1 |
| Lead changes · comebacks | 7.9 · 100% | 3.2 · 68% | 5.9 · 98% |
| Turn-2 captures per game | 2.0 | 0.8 | 1.95 |
| Distinct two-turn openings · turn-1 placements · effective openings | 1 · 1 · 1.0 | **60 · 1 · 60** | 3 · 2 · 1.2 |
| Plan = execution (turns) | 3391/3391 | 2166/2169 (see §3) | 1262/1262 |
| Teleport foresight (must be ~0) | +0.07 (−0.10 to +0.24) | −0.02 (−0.16 to +0.12) | −0.00 (−0.37 to +0.36) |
| Integrity | clean | **4 games stopped at the 30-min per-game limit** | clean |

Opening-cluster intervals: ev-k1.1 1 cluster and softmax-v2 3 clusters → **NOT_ESTIMABLE**; oa-v2 60 clusters, first mover
68–91% (same conclusion as the seed-blocked interval).

**Policy dependence** (self-play arms paired by seed): first-mover rate differs between **every** pair (oa − ref +0.54
[+0.42, +0.66]; softmax − ref +0.23 [+0.05, +0.41]; oa − softmax +0.31 [+0.13, +0.49]). Length, turn-limit rate and lead
changes differ between every pair. Human-side rate differs only oa − ref (−0.19 [−0.37, −0.02]). Turn-2 captures: oa
differs from both, softmax and ref do not (−0.05 [−0.15, 0]).

**Cross-play strength** (decisive win rate of the first-named policy): ev-k1.1 vs oa-v2 **30% (18–43%)**; ev-k1.1 vs
softmax-v2 58% (35–81%); oa-v2 vs softmax-v2 **77% (61–90%)**. First-mover rate in cross-play: 55%, 33%, 54%.

**Rule robustness (preregistered):** eligibility ev-k1.1 yes, **oa-v2 no**, softmax-v2 yes. First-mover edge:
**INCONCLUSIVE** (ev-k1.1 −0.35…−0.14, softmax-v2 −0.17…+0.15). Human-side edge: **INCONCLUSIVE**.

## 3. oa-v2 eligibility, examined (post hoc, verdict unchanged)

* 3 of 2,169 turns were flagged as plan ≠ execution. In all three, a piece entered a teleport whose **only** legal destination
  was its own square, so the move was deterministic; the planner rightly continued and the full executed sequence **equals**
  the plan. The frozen agreement metric cuts at every teleport event and miscounts these. Real agreement: 2,169/2,169.
* 4 games (68001-ai, 68009-ai, 68014-human, 68030-human) were stopped at the frozen 30-minute per-game limit (recorded as
  errors; the "softlock" flag is set because they had no winner, not because a player was stuck). That alone keeps oa-v2
  ineligible under the frozen rule.
* Had oa-v2 been eligible, the first-mover verdict would have been **POLICY-DEPENDENT** (ev-k1.1's interval below −0.05,
  oa-v2's above +0.05).

## 4. Answers to the six research questions

1. **How much do first-mover and role advantages vary between policies?** A lot. First-mover wins range from 26% (ev-k1.1)
   through 49% (softmax-v2) to 80% (oa-v2), and every pairwise difference is outside its interval. The direction flips
   between policies. Human-side rates range 42–61%; only oa vs ref differs reliably.
2. **Do different search and selection mechanisms increase observed strategy diversity?** Search does, selection barely.
   oa-v2 played 60 different two-turn openings in 60 games. softmax-v2 played 3 (one in 97% of games), ev-k1.1 one. No policy
   varies the **first** turn (1–2 distinct turn-1 placements), because all three build turn 1 from the same symmetric
   candidate generator.
3. **Are the policies genuinely different in executed decisions?** Yes. Executed placements differ from the reference on 22/70
   (oa) and 19/70 (softmax) preflight positions; in games they lead to different lengths, captures and outcomes; and oa-v2
   beats the reference 70% of the time in seat- and tempo-balanced cross-play. The shared executor means move execution is
   identical given the same placement, so the differences come from what each policy chooses to place.
4. **Which earlier findings look like artefacts of the greedy policy family?** The second-mover advantage (V4 EV 28%, V4.2
   E0 24%, ev-k1.1 26%) does not survive: softmax-v2 is at 49%, oa-v2 has the opposite edge. The two turn-2 captures per game
   are specific to the greedy reference and its softmax variant (oa-v2: 0.8). Long, turn-limit-bound games are policy
   specific (85% / 47% / 15%). New: ev-k1.1 itself plays far longer games than ev-k1 did in V4.2 (85% vs 22% turn limit);
   which of C1–C4 causes this is not attributed (C4, planning without noise, is the most likely suspect, untested).
5. **Is the evidence diverse enough for a new Kane dossier?** For a dossier about **policy dependence**, yes: three
   genuinely different policies, 300 replayable games, a strong and clean contrast, and an open mechanism question (why
   opponent-aware play gives the first mover 80%, and why ev-k1.1 stalls). For proposing **rule** changes, no: no pattern
   is robust, and turn-1 coverage is still one placement per policy. Kane was not run; that needs your decision.
6. **What remains unsupported?** Any claim that the rules favour the first or the second mover; any claim about
   role symmetry; anything about turn-1 strategy (deterministic in all three); cluster-level uncertainty for ev-k1.1 and
   softmax-v2 (not estimable); oa-v2 robustness (ineligible); the cause of ev-k1.1's long games; and everything about human
   players or other AI strategies.

## 5. Recommendation

Do not tune rules on self-play from any single policy: the main balance pattern changes sign with the policy. Before more
rule work: (a) find why ev-k1.1 stalls (an ablation of C1–C4, small and preregistered); (b) give turn 1 genuinely different
candidates (the one pattern every policy shares, and probably an artefact of the shared candidate generator); (c) fix the
agreement metric for single-destination teleports and decide a per-game time budget for oa-v2. The holdout stays reserved.

# Balance Designer V5.3: reliable policy comparison

**Status: READY_FOR_OPERATOR_V5_3_POLICY_RELIABILITY_REVIEW.** Nothing merged, deployed or promoted; no production change.
Holdout 65001–65060 untouched. 0 Kane calls, 0 external calls. New games: the preregistered 180, run once after the preflight
passed. All V1–V5.2 evidence and verdicts unchanged.

**A technically reliable observer is not an enjoyable opponent.** Everything here is about whether these self-play policies are
trustworthy instruments: reproducible, unbiased by hidden information, symmetric, bounded. None of it says whether any of them is
fun or fair to play against. Self-play cannot measure that.

## 1. ev-k1.2 reference (frozen, experimental)

`ev-k1.2` = ev-k1.1 (C1–C4) + the V5.2 SHA-256 planner stream `stream-1` (`server/balance/v5_3/policies.ts`, identical to V5.2 arm
A4). Validation (`evidence/balance/v5_3/preflight.json`), on 20 positions with consecutive seeds and 20 with dispersed seeds:
reproducible 20/20 each; hidden-RNG changes 0; mirror mismatches 0 in plans, scores and temperature roll (the stream's role domain is
mover-relative); executed moves mirror-symmetric; equal to V5.2 arm A4 on every position. Plan = execution in its games (1535/1535).
A recorded V5.2 A4 game re-executes to the identical final state through the ev-k1.2 path. Historical routing is intact: a V5 ev-k1.1
game re-executes exactly through its own path. Engine files hash unchanged (`f92354f4…`), so teleport randomness is untouched.

At the turn-21 near-tie that the legacy stream always resolved the same way on consecutive seeds (30/30), ev-k1.2 now picks the
second candidate 4/30 times on consecutive seeds and 4/30 on dispersed seeds. The temperature weights predict about 12%. The
statistical tests passed; that does not make the stream mathematically independent. It is a deterministic hash function whose
outputs showed no detectable structure in these tests.

## 2. oa-v3: bounded opponent-aware search

New policy. oa-v2 and its results are unchanged. Bounds, targeting the V5.1 profile:
- B1 collapses a second teleport inside our own continuation to ≤ 8 strata.
- B2 builds own end states once per candidate.
- B3 searches opponent options as "none" plus the top 4 by the placement heuristic.
- B4 memoises the worst case by side-relative state.
- B5 imposes a deterministic budget of 20,000 greedy simulations per decision, with a recorded fallback.

Every decision stores work, approximations and fallback.

Against frozen oa-v2 on 85 stored positions (including the four games that used to exceed 30 minutes):

| | result |
|---|---|
| Different placement from oa-v2 | 12 of 85 (14%) |
| oa-v3's choice outside oa-v2's top 6 | 0 |
| Regret in oa-v2's own scale | mean 0.16, 90th percentile 0.45, max 3.9 |
| Decision time oa-v3 / oa-v2 (single thread) | median 0.44 s / 0.89 s; 90th percentile 2.5 s / 5.0 s; max **8.8 s / 27.8 s** |
| Budget use / hits | max 15,368 of 20,000 simulations; 0 hits |
| Mirror / hidden-RNG (10 synthetic positions) | 0 / 0 |

oa-v3 is a bounded approximation, not a strategic equivalent of oa-v2: it decides differently on 14% of these positions.

## 3. The 180 games (`balance/v5_3/protocol.json`, journal #1 before any game)

The same 30 fresh seeds for every policy (15 consecutive 73001–73015 and 15 SHA-256-dispersed), each with both first movers, 60
self-play games per policy. Same candidate generator and executor for all three. Run `evidence/balance/v5_3/*-v53`: 180/180,
7.2 min, **180/180 engine replays identical**, 0 external calls, **0 aborted games** (so the censoring bounds equal the estimates),
0 illegal moves or errors, plan = execution in every turn of every policy.

| (seed-blocked 95%) | ev-k1.2 | softmax-v2 | oa-v3 |
|---|---|---|---|
| First mover wins (decisive) | **54/59 = 92% (81–100%)** | 31/58 = 53% (37–69%) | 39/58 = 67% (56–78%) |
| consecutive / dispersed block | 87% / 97% | 66% / 41% | 70% / 64% |
| Human side wins | 51% (50–53%) | 53% (47–60%) | 53% (40–67%) |
| Mean (median) turns · turn limit | 25.6 (15) · 23% | 27.2 (14) · 28% | 33.7 (17) · 45% |
| Lead changes · comebacks | 4.9 · 100% | 5.9 · 97% | 2.8 · 66% |
| Turn-2 captures per game | 2.0 | 1.97 | 0.77 |
| First-turn choices · strategic prefixes · realized two-turn trajectories | 1 · 1 · 1 | 2 · 2 · 3 | 1 · 1 · **59** |
| Repeated identical states with different decisions | 17 of 340 | 18 of 415 | 0 of 10 |
| Decision time median / 99th / max | 0.08 / 2.4 / 4.9 s | 0.10 / 1.8 / 3.5 s | 0.11 / 7.3 / 18.5 s |
| oa-v3 approximations | — | — | 8,240 second-level collapses, 78,483 opponent options pruned, **4 budget hits with recorded fallback** |
| Teleport foresight (realized − blind) | +0.38 (12 moves) | −0.15 (38) | +0.09 (382) |

**Policy dependence (P1): POLICY-DEPENDENT.** First mover, softmax − ev-k1.2: −0.38 (−0.58 to −0.18); oa-v3 − ev-k1.2: −0.24
(−0.40 to −0.06); oa-v3 − softmax: +0.14 (−0.05 to +0.34). Length and turn limit: oa-v3 longer than ev-k1.2 (+8.1 turns, +0.22
turn limit). Lead changes differ between every pair. Human-side rates do not differ.

**Rule robustness (P2): INCONCLUSIVE.** All three policies are eligible. The first-mover edge lies above +0.05 for ev-k1.2 (+0.31 to
+0.50) and oa-v3 (+0.06 to +0.28), but softmax-v2's interval (−0.13 to +0.19) neither excludes the threshold nor lies within ±0.05.

## 4. Answers, kept apart

1. **Policy-dependent outcomes.** Yes. With the randomization defect corrected, the first-mover rate still varies from 53% to 92%
   across three genuinely different policies, and two of the three differences from the reference exclude 0.
2. **Strategic coverage.** Still narrow. ev-k1.2 and oa-v3 make one first-turn choice. softmax-v2 makes two. oa-v3's 59 different
   two-turn trajectories come from random teleport destinations after one strategic choice; they are not 59 strategies.
3. **Evidence about the rules.** No pattern is robust across the eligible policies. What has changed is the direction. Under
   correct randomization, no policy shows the second-mover advantage reported in V4–V5 (24–28%): every point estimate is ≥ 53% for
   the first mover. That earlier finding should be treated as an artefact of the greedy family plus the broken stream. A first-mover
   edge appears under two of three policies; it is a candidate for investigation, not a finding about the rules.
4. **Gameplay quality for humans.** Not measured and not measurable here. A policy that wins 92% of the time as first mover in
   self-play may still be a dull or unfair opponent.

## 5. Kane

Dossier prepared, Kane not invoked: `docs/KANE_DOSSIER_V5_3.md`.

Tests: default parallel `npm test` **163/163** (`evidence/balance/v4/test-runs/v53-parallel-1.log`), plus `tests/policies-v53.test.ts` (2/2).

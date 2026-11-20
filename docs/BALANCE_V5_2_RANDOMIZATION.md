# Balance Designer V5.2: repairing experimental randomization

**Status: READY_FOR_OPERATOR_V5_2_RANDOMIZATION_REVIEW.** Nothing merged, deployed or promoted; no production change.
Holdout 65001–65060 untouched. 0 Kane calls, 0 external calls. New games: the preregistered 120, run once after the audit
passed. All V1–V5.1 evidence and verdicts are unchanged.

## Correction to the V5.1 wording

V5.1 said the 60 ev-k1.1 self-play games in V5 were "close to one replicate". Precisely: the **planner-selection branch** lacked
effective sampling diversity. Every seed 68001–68030 drew nearly the same temperature roll on each turn (standard deviation 0.0006),
so wherever the reference's choice depended on that roll, all games took essentially the same branch. Other randomness did vary:
the engine's teleport destinations (127 teleport moves in those games) and the first-player assignment. All 60 games are distinct
(60 different final states). The games are not one observation. Their planner-branch path is largely shared, so they are a poor
sample of what the reference does across its own random choices. The same correction is noted at the top of the V5.1 report.

## Phase 1: zero-game randomization audit (`evidence/balance/v5_2/audit.json`), PASS

**New planner stream** `stream-1` (`server/balance/v5_2/stream.ts`): a counter-based SHA-256 draw over
`seed | turn | mover role (F/S, relative to the first player) | purpose ('noise' | 'temperature') | index`. Public inputs only,
never the engine RNG. A position and its mirror share every input, so mirror symmetry holds.

20,000 consecutive and 20,000 dispersed seeds:

| | legacy, consecutive | legacy, dispersed | mixed, consecutive | mixed, dispersed |
|---|---|---|---|---|
| Uniformity, turn-21 first draw (χ², 19 df, 95% critical 30.1) | **1695** | 6.0 | 17.3 | 20.5 |
| Kolmogorov–Smirnov D (critical 0.0096) | **0.090** | 0.004 | 0.004 | 0.007 |
| Adjacent-seed correlation | **1.00** | 0.006 | −0.005 | 0.013 |
| Correlation between turn 21 and turn 22 | **−0.87** | **−0.87** | 0.004 | 0.006 |
| sd inside 30-seed blocks (uniform 0.289) | **0.004** | 0.277 | 0.283 | 0.283 |

The legacy stream has two defects: consecutive seeds collapse, and consecutive turns are strongly anti-correlated for any seed.
The mixed stream shows neither. Role and purpose domains are separate (correlations 0.018, −0.008), and the stream is
reproducible.

**Engine RNG audit** (xorshift32 from the seed, 4 advances in `init`), measured on the destination index `rand() % n` at the 1st,
2nd and 5th draw after init, over 20,000 consecutive seeds: adjacent-seed correlation of the index ≤ 0.018, within-block spread
0.281–0.284. χ² against the exact law was within its critical value in 8 of 9 cases. The exception is n = 35 at the very first draw
(χ² 56.7 vs 48.6, one of nine tests: marginal). **The planner's first-draw defect does not carry over to engine teleports.** The
four init advances decorrelate them.

**Planner checks** (40 positions, every arm): (C4 off, legacy) equals the V5.1 ablation {C1, C2, C3} on 40/40, and (C4 on, legacy)
equals ev-k1.1 on 40/40. 0 mirror mismatches and 0 hidden-RNG changes in all four arms.

## Phase 2: 2×2 experiment, 120 games (`balance/v5_2/protocol.json`, journal #1 before any game)

Planner `k1x-1`: ev-k1 + C1–C3 in every arm. Factor A: C4 off or on. Factor B: legacy stream or the new stream. The executor is
the same in every arm. Seeds: 7 consecutive (70001–70007) and 8 dispersed (SHA-256-derived), each with both first movers, 30 games
per arm. Run `evidence/balance/v5_2/*-v52`: 120/120, 4.8 min, **120/120 replays identical**, 0 external calls, 0 illegal moves or
errors.

| Arm | Turn limit | Mean (median) turns | First mover | consecutive / dispersed turn-limit rate | Plan = execution |
|---|---|---|---|---|---|
| A1 C4 off, legacy | 9/30 = 30% (17–48%) | 31.8 (18) | 45% | 21% / 38% | 87% (by design, noise) |
| A2 C4 on, legacy (= ev-k1.1) | **18/30 = 60% (42–75%)** | **43.1 (60)** | 73% | **100%** / 25% | 100% |
| A3 C4 off, mixed | 5/30 = 17% (7–34%) | 24.2 (15) | 80% | 36% / 0% | 84% (by design) |
| A4 C4 on, mixed | 7/30 = 23% (12–41%) | 26.0 (15) | 77% | 36% / 13% | 100% |

Contrasts (paired by seed, seed-blocked 95%):

| Contrast | Turn-limit rate | Mean turns | First mover |
|---|---|---|---|
| H2 seed mixing, C4 on (A4 − A2) | **−0.37 (−0.67 to −0.07) SUPPORTED** | **−17.0 (−29.6 to −4.1) SUPPORTED** | +0.03 (−0.17 to +0.23) |
| seed mixing, C4 off (A3 − A1) | −0.13 (−0.47 to +0.20) | −7.6 (−19.9 to +5.3) | +0.35 (+0.13 to +0.59) |
| H3 C4, mixed stream (A4 − A3) | +0.07 (0 to +0.20) INCONCLUSIVE | +1.8 (−0.4 to +5.8) INCONCLUSIVE | −0.03 (−0.10 to 0) |
| C4, legacy stream (A2 − A1) | +0.30 (−0.07 to +0.63) | +11.2 (−4.1 to +25.6) | +0.29 (0 to +0.56) |
| H4 interaction | −0.23 (−0.63 to +0.23) INCONCLUSIVE | −9.4 (−25.9 to +7.9) INCONCLUSIVE | −0.32 (−0.59 to −0.09), not a preregistered hypothesis |

H1 (coverage in games): **not as predicted by its crude rule.** Under the mixed stream the rolls actually used spread with a mean
per-turn sd of 0.22. Under legacy, A1 (whose roll comes after the noise draws) was 0.26, while A2 (roll is the first draw) was 0.13,
and it collapses inside the consecutive block. With only 15–16 turns having five or more rolls per arm, this in-game measure is weak.
The audit, with 20,000 draws, is the real evidence for the stream.

Turn-21 near-tie: legacy C4-off games took the 4th-ranked option in 2 of 7 near-tie turn-21 decisions. The mixed arms always took
the 1st there (13 of 13), as the temperature weights favour. Near-tie turns overall: 214–256 per arm, 25–36% resolved to a
non-top candidate.

Strategy vs RNG: in every arm the strategic opening prefix is a single one (1 distinct), and so is the realized two-turn trajectory.
No arm varies its opening. Teleport foresight stays around 0 (A1 +0.14 over 35 moves, others below ±0.11).

## Phase 3 (no games)

* **oa-v2**: unchanged. Its V5.1 corrected agreement (2169/2169) stays separate from the frozen 2166/2169. Bounded-work
  **oa-v3 plan**: `docs/PLAN_OA_V3_BOUNDED_WORK.md`.
* **Wider opening generator** (`evidence/balance/v5_2/openings-check.json`, two-turn simulation from the start position):

| Opening | Score (immediate / after reply / overlay) | Turn 1 | Turn-2 reply | First mover's evaluation after turn 2 |
|---|---|---|---|---|
| original: Shove east 2 @ B2 B4 B6 | 8.10 (9.0 / 3.0 / 2.85) | 3 moves, 9 squares, 0 scored, 3 own-trap rides | captures 2 | −5.0 |
| Shove forward 2, lane 4 | 10.65 (12.1 / 9.1 / 0.50) | 3 moves, **1 piece across**, chain of 2 own traps | 0 captures | −3.9 |
| Shove forward 2, lane 2 / lane 6 | 10.60 | as above | 0 | −2.9 / +5.1 |
| +1 action, lane 2 | 10.50 (12.0 / 9.0 / 0.45) | **6 moves**, 1 piece across | 0 | +5.0 |

  They score higher because they bring a piece across on turn 1 (+immediate, scoredBonus) and leave nothing for the reply to
  capture (+after-reply). The original scores well mainly through the placement overlay (2.85 vs 0.45–0.5). **Flag: these are
  conveyor rushes**: a chain of own traps (or extra actions) carrying one piece across on turn 1, exactly the turn-1 scoring
  that earlier versions tied to tempo advantages. A higher heuristic score does not show they are strategically better or more
  enjoyable. Their effect on balance needs its own check before any generator change.
* **Production fix proposal**: `docs/PROPOSAL_PLANNER_RANDOMNESS_PRODUCTION_FIX.md` (versioned stream, replay compatibility, staged
  rollout). Not applied.

## Answers

1. **Does the new randomization cover the selection distribution adequately?** At the stream level, yes: uniform, no
   adjacent-seed or cross-turn correlation, domain-separated, reproducible, mirror-symmetric, independent of the engine RNG
   (audit on 20,000 seeds). In the 120 games the rolls actually used are spread (mean sd 0.22). The preregistered in-game H1 rule
   was not met at every turn, partly because few turns have enough rolls. "Adequate" is established for the stream, not
   demonstrated turn by turn in this small game set.
2. **Does correcting randomization change the stall and first-mover patterns?** The stall: yes, strongly. With C4 on, the
   turn-limit rate falls from 60% to 23% and games shorten by 17 turns (both intervals exclude 0). Under the legacy stream the
   stall is seed-block-specific: 100% in the consecutive block, 25% in the dispersed one. First mover: no change from mixing with
   C4 on (+0.03). With C4 off, mixing raised it (+0.35). Across both mixed arms the first mover wins 77–80%.
3. **Attribution.** Turn limit: mostly seed mixing (−0.37 with C4 on). C4 itself is small under good mixing (+0.07, interval
   0 to 0.20) and possibly larger under legacy mixing (+0.30, interval includes 0). The interaction is not resolved (−0.23,
   −0.63 to +0.23). C4 does change decisions (V5.1: 8/80 states, in committed moves). What the stall showed was mainly which
   branch the broken stream happened to sample. For the first mover, an interaction was seen (−0.32, excludes 0), but it was not
   preregistered and rests on 30 games per arm.
4. **Are previous V4–V5 estimates suitable for generalization?** No, for anything that depends on EV-family planner randomness
   on consecutive seed ranges: the ev-k1 / ev-k1.1 first-mover rates (24%, 26%, 0% in earlier runs; 73% for A2 here) and the 85%
   stall are seed-block artefacts to an unknown degree. softmax-v2 (well-mixed stream) and oa-v2 (no planner randomness) are not
   affected by this defect, but they are small samples with their own limits. None of them supports a general rule-level claim.
5. **Is the evidence reliable enough for a Kane dossier about policy dependence?** Not yet. The reference leg of the V5 policy
   comparison used the broken stream. A dossier now would mostly report artefacts. Recommendation: freeze an `ev-k1.2` reference
   (ev-k1.1 with the mixed stream), then, if approved, rerun the V5 three-policy comparison on dispersed fresh seeds. Then a
   dossier, built with the V5.1 caveats (strategic vs RNG diversity, turn-1 determinism), would be fair.

Tests: default parallel `npm test` **163/163** (`evidence/balance/v4/test-runs/v52-parallel-1.log`).

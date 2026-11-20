# Kane research dossier V5.3 (prepared; Kane NOT invoked)

**Purpose:** let Kane investigate why self-play balance depends on the policy that plays, without being misled by known
artefacts. **This dossier must not be used to ask Kane for rule changes:** every balance pattern below is still policy-dependent.

## A. Observations influenced by the old seed-mixing defect (do not use as findings)

| Earlier observation | Why it is unreliable |
|---|---|
| ev-k1 / ev-k1.1 first-mover rates of 24–28% (V4 pilot, V4.2 E0, V5 S-REF), 0% (V5.1 K11) and 73% (V5.2 A2) | The planner's temperature roll barely varied across consecutive seeds (sd ≤ 0.0015), so whole seed blocks sampled the same branch at near-ties |
| ev-k1.1's 85% turn-limit "stall" (V5) | 100% in one consecutive block, 25% in a dispersed block (V5.2); seed mixing explains most of it (−0.37 with C4 on) |
| "Second-mover advantage" as a game property | Not seen under any policy with corrected randomness (V5.3: 53–92% for the first mover) |
| V5's "60 distinct openings" for oa-v2 | One strategic choice plus 60 teleport outcomes (V5.1 reanalysis) |

## B. What persists with corrected randomness (V5.3, 180 games, all replay-verified)

* The first-mover rate depends on the policy: ev-k1.2 92% (81–100%), oa-v3 67% (56–78%), softmax-v2 53% (37–69%). Two of three
  pairwise differences exclude 0.
* No policy shows a Human-side or AI-side asymmetry (51–53%).
* Turn-2 double captures (~2 per game) occur under ev-k1.2 and softmax-v2, not under oa-v3 (0.77).
* Opening coverage remains minimal: 1–2 first-turn choices per policy.
* No hidden-information advantage: decisions are invariant to the hidden RNG in every policy, and realized teleport gains stay near
  the blind expectation.

## C. Differences attributable to policies (same seeds, same rules, same executor, same candidates)

* Placement choice is the only difference between the policies. They share the executor, so after the placement they move the same.
* ev-k1.2 (expected value + temperature) and oa-v3 (pessimistic maximin) both favour the first mover. softmax-v2 (wider sampling of
  near-best candidates) does not show it clearly.
* oa-v3 plays longer games with fewer lead changes and comebacks.
* On matched public states the policies' placements differ 11–23 times in 60 (V5.1).

## D. Mechanisms that remain unverified

* **Why** ev-k1.2's first mover wins 92%: tempo from the deterministic opening line? The turn-2 capture pattern? Both? Untested.
* Whether oa-v3's first-mover edge comes from its teleport opening (its only first-turn choice) or from its pessimism.
* Whether softmax-v2's ~50% reflects balance or just noise from sampling weaker options. Its interval is wide.
* Whether a wider opening generator changes any of this (V5.2: the new high scorers are turn-1 conveyor rushes, unevaluated).
* Anything about human players.

## E. Competing explanations (keep all)

1. The rules give the first mover a tempo advantage, which some policies fail to exploit.
2. The shared opening candidate generator funnels policies into lines that favour the first mover; the rules are not the cause.
3. The advantage is specific to how each policy's evaluation values the opening, so it is a property of the observers.
4. The sample is too small: softmax-v2's interval still allows a first-mover rate anywhere from 37% to 69%.

## F. Negative results to keep in view

C1–C3 had no behavioural effect (V5.1). The K2 and K3 planner fixes were refuted (V4.2). oa-v2 was ineligible (V5). The stall is not
a C4 effect (V5.2). Seed-mixing did not affect engine teleports (V5.2 audit).

## G. What Kane could legitimately infer

* That measured self-play balance is policy-dependent, and which design choices (shared generator, shared executor, opening
  determinism) could explain it.
* Which next experiments would discriminate between explanations E1–E4. Examples: a wider candidate generator under each
  policy, or a tempo-only intervention tested across all three policies.
* **Not:** that the rules are balanced or imbalanced, or that a specific rule change would help.

## Data Kane would get

`evidence/balance/v5_3/*-v53` (180 games, replays, evaluation.json), `evidence/balance/v5_2/` (audit, 2×2), `evidence/balance/v5_1/`
(reanalysis, ablation), with this dossier as the reading guide. No Kane call is made until the operator approves one.

# Kane research dossier V5.3.1 (corrected wording; Kane NOT invoked)

Supersedes the wording of `docs/KANE_DOSSIER_V5_3.md`, which is kept unchanged as issued. **No experimental verdict changes.**
The V5.3 verdicts stand exactly as preregistered and reported in `docs/BALANCE_V5_3_POLICY_RELIABILITY.md`:
policy dependence (P1) **POLICY-DEPENDENT**; rule robustness (P2) **INCONCLUSIVE**; rule-level fairness **INCONCLUSIVE**.
This revision only narrows claims that the earlier dossier stated more broadly than the evidence allows.

**Kane must not be invoked with this dossier, and it must not be used to ask for rule changes.**

## Corrections to the V5.3 dossier

| V5.3 dossier said | Corrected statement | Why |
|---|---|---|
| "Second-mover advantage" as a game property: "Not seen under any policy with corrected randomness" | No policy's **point estimate** shows it (53–92% for the first mover). softmax-v2's interval (37–69%) still includes a second-mover edge, so it is **not excluded** for that policy | Interval, not point estimate |
| (Report §4.3) the earlier second-mover finding "should be treated as an artefact of the greedy family plus the broken stream" | The earlier finding **was not reproduced** once the planner stream was corrected. The stream defect is the leading explanation; that it fully explains the earlier result is **not demonstrated** (only the stall was tested causally, in V5.2, and only with C4 on) | Causal attribution was untested |
| "No policy shows a Human-side or AI-side asymmetry (51–53%)" | **No detectable** side asymmetry. oa-v3's interval is 40–67%, so moderate asymmetries are not ruled out | Absence of evidence |
| "Turn-2 double captures (~2 per game)" | About 2 captures on turn 2 per game under ev-k1.2 and softmax-v2 (0.77 under oa-v3). "Double" is not a measured category | Wording |
| "Placement choice is the only difference between the policies. … after the placement they move the same" | The policies differ only in how they choose the placement. They share one executor, so **from an identical position** they move identically; once placements differ, positions differ and so do the moves | Overstatement |
| "On matched public states the policies' placements differ 11–23 times in 60 (V5.1)" | That measurement is of the **V5 policies** (ev-k1.1, oa-v2, softmax-v2 on the legacy stream). It was not repeated for ev-k1.2 or oa-v3 | Wrong population |
| "No hidden-information advantage: decisions are invariant to the hidden RNG in every policy" | Invariance **held on every tested position** (20 + 20 for ev-k1.2, 10 synthetic + 85 stored for oa-v3) and realized teleport gains stayed near the blind expectation. It is a test result, not a proof | Finite test |
| "ev-k1.2 … and oa-v3 … both favour the first mover" | Under both, the first mover won more often in self-play, **with one first-turn choice each**. The observation is conditional on that single opening line | Opening diversity |
| "Seed mixing explains most of it (−0.37 with C4 on)" | Seed mixing explains most of the stall **in the C4-on arms of the 120-game V5.2 2×2**; the C4 × mixing interaction was unresolved | Scope |

## The evidence, sorted into four kinds

### 1. Supported by the observed policies (180 replay-verified V5.3 games)
- Self-play balance depends substantially on the policy that generates it: first-mover win rate 92% (ev-k1.2), 67% (oa-v3), 53% (softmax-v2); two of three pairwise differences exclude 0.
- oa-v3 games are longer (+8.1 turns vs ev-k1.2), end at the turn limit more often, and have fewer lead changes.
- The three policies were technically reliable as observers in these runs: reproducible, plan = execution, 0 illegal moves, 0 aborted games, hidden-RNG invariant and mirror-symmetric on every tested position.

### 2. Restricted by low strategic opening diversity
- ev-k1.2 and oa-v3 each made **one** first-turn choice in 60 games, softmax-v2 two. Every first-mover number above is therefore a statement about one or two opening lines, not about the opening space.
- oa-v3's 59 different two-turn trajectories are teleport outcomes after one strategic choice.
- The shared candidate generator offers every policy the same opening options; the wider generator's new high scorers (turn-1 conveyor rushes, V5.2) were never evaluated.

### 3. Unresolved causal mechanisms
- Why ev-k1.2's first mover wins 92%: opening tempo, the turn-2 capture pattern, both, or neither.
- Whether oa-v3's first-mover edge comes from its single teleport opening or from its pessimism.
- Whether softmax-v2's ~50% reflects balance or sampling of weaker options.
- Whether the rules, the shared generator, or each policy's evaluation is the source (competing explanations E1–E4 of the V5.3 dossier, all still open).

### 4. Questions only human gameplay can answer
- Is the game understandable: can a new player write effects that do what they intend, and read what happened?
- Does it feel fair, repetitive, confusing or satisfying, and against which opponent?
- Is any of these opponents worth playing against, and is OA-v3's response time acceptable to a person?
- Do humans find openings the policies never chose?
These are what the human playtest (`docs/HUMAN_PLAYTEST_READINESS.md`, `docs/PLAYTEST_PILOT_PROTOCOL.md`) is built to explore. A small pilot can describe them; it cannot settle them statistically.

## New fact found while preparing the playtest (zero games, `evidence/playtest/latency-audit.json`)
Self-play applied each policy's chosen effect directly; it never ran the referee. Replaying the 180 V5.3 games and applying the
production engine-only referee to every chosen effect on its real position: **24% (ev-k1.2), 27% (softmax-v2) and 31% (oa-v3)**
of the chosen effects would not have been placed (tier 3 without Kane, or an engine check failure: 35–49 per policy). The V5.3
self-play therefore measured a game in which effects the live referee would block were allowed. This does not change any V5.3
verdict (they are about self-play under the protocol as run), but it is one more reason the self-play balance numbers are
**not** statements about the game people play.

## What Kane could legitimately be asked (only after a separate operator decision)
To propose experiments that discriminate between the open mechanisms (section 3), using sections 1–2 as the evidence and the
corrections above as constraints. **Not** whether the rules are balanced, and **not** which rule to change.

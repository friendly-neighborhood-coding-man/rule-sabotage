# GameWatch: hackathon submission description

**Kane discovers. GameWatch verifies. Together, they close the trust gap.**

**One line:** Kane explores a game on its own and reports what it believes the rules are. GameWatch, a verification layer around Kane, checks every one of those findings against the recorded evidence, keeps a tamper-evident record of each step, and tells real improvements apart from misleading ones.

## The problem

An autonomous agent can explore far more of a game than a person can, but its reports are only as useful as the trust you can place in them. A finding can be right, wrong, or right for the wrong reason. A "revised" theory can look more accurate simply because it now claims less. Without independent checking, those cases all look the same.

## How the two parts fit together

| Kane (autonomous discovery) | GameWatch (independent verification) |
|---|---|
| Explores the evidence site on its own: scripted playtests and AI-vs-AI games | Builds that site from the game's own engine and referee, under a documented input contract (`gamewatch/evidence@1`) |
| Observes behaviour and spots anomalies | Checks every submission's nonce and server session, then seals raw output, access journals and freezes in a hash-chained ledger |
| Writes hypotheses about the hidden rules | Scores machine-checkable hypotheses against held-out observations that stay sealed until everything is frozen |
| Revises or withdraws hypotheses when it sees contradictions | Separates genuine corrections from coverage narrowing, newly introduced errors and missing submissions |

Kane is the essential component: it produces all of the findings and all of the hypotheses. GameWatch never replaces Kane's judgement. It makes that judgement accountable.

## What we built

* **GameWatch**, a portable QA and verification harness:
  * evidence collection from the playtests a game already has;
  * adapters with a documented input contract, so another game needs only an adapter;
  * a Kane harness with a blind evidence site, nonce-checked forms, gated paid calls approved one at a time, coverage audits and a blind repair loop;
  * a pre-registered evaluation with a single held-out opening.
* **SkillFlow** (https://github.com/friendly-neighborhood-coding-man/skillflow, MIT): a one-file, standard-library runner for SkillBooks. GameWatch vendors an unmodified, checksummed copy.
* **Rule Sabotage V6.1** is the demonstration game. Its playable version is unchanged.

## Result 1: Kane finds real bugs, and a coding agent repairs them (GW1)

* **Setup:** three defects were planted in one build, with the ground truth frozen before Kane ran.
* **Kane:** one call (72.398 credits) produced two true detections, the life-cycle bug and the extra first-mover action. It also filed one inconsistent "clean" report, and it missed the asymmetric shield.
* **Repair:** one blind coding-agent attempt reproduced Kane's two findings and found the shield defect itself. It fixed all three, which independent probes confirmed after the output was frozen. The 42 existing tests pass, and the 7 new regression tests fail on the old build.

## Result 2: GameWatch catches a misleading improvement (GW2 matched comparison)

* **Design:** 10 pre-registered sessions (5 control, 5 treatment in balanced blocks) and 20 real Kane calls, each approved one at a time by the operator. Cost: 786.378 credits.
* **Two calls per session:** in phase 1 Kane studies the game and writes hypotheses. In phase 2, a separate call, it may revise them. Only the treatment arm is also shown the recorded observations that contradict each hypothesis.
* **The headline case, M08 (treatment):**

| | Phase 1 | After revision |
|---|---|---|
| Reported held-out accuracy | 31.78% | **81.25%** |
| Held-out coverage | 12.32% | **1.00%** |
| Genuine corrections (contradicted → correct) | | **0** |

Accuracy alone would call this a large improvement. GameWatch shows that Kane *withdrew* a contradicted hypothesis: 113 predictions were dropped, and none was corrected. It labels the change "narrowing only", never self-correction.

* **Observed behavioural adaptation.** Both treatment sessions that received contradiction feedback revised or withdrew a hypothesis. No control session changed anything. This is a change in behaviour, **not** evidence of improved reasoning or better overall accuracy: there were zero genuine corrections in either arm.
* **Disclosed in full:**
  * **Representation failures.** In 6 of 10 sessions, Kane's structured hypotheses failed the published schema, so they could not be scored. That also meant only 2 of 5 treatment sessions received any feedback.
  * **Missing submissions.** 8 of 10 revision calls submitted nothing, although Kane's own summaries described updates. GameWatch's server records show none.
  * **Sample size.** 5 sessions per arm, with an accuracy comparison possible in only one block. There is no significance claim, and no claim that the system improves agent performance.
* **Verification:**
  * The ledger, raw seals, server sessions, journals and freezes all verify with 0 integrity problems.
  * The single evaluation was re-run independently and reproduced byte for byte.
  * Both execution gates were restored to disabled afterwards.

## What this shows

The value is in the *combined workflow*, not in a claim that the agent reasons better. Kane supplies discovery at a scale and autonomy no script can. GameWatch supplies independent evidence validation, contradiction detection, traceable accountability and protection against misleading improvements, such as an accuracy jump that is really a withdrawal.

## Honesty and safety measures

* Paid calls run behind a code gate that is disabled in every reviewed commit. Each call needs its own approval; there are no retries, and balances are redacted before publishing.
* Ground truth and held-out evidence are frozen and hashed before any call and kept out of every blind input.
* Every negative and null finding is reported.

## Links

* Verified experiment report: [`docs/gw2/MATCHED_RESULTS_REPORT.md`](gw2/MATCHED_RESULTS_REPORT.md), with a one-page summary in [`docs/gw2/MATCHED_HACKATHON_SUMMARY.md`](gw2/MATCHED_HACKATHON_SUMMARY.md).
* Public, redacted evidence: [`evidence/gw2/matched-run/`](../evidence/gw2/matched-run/), with original and published hashes in `REDACTION_RECORD.json`.
* GW1 report: [`docs/GW1_FINAL_REPORT.md`](GW1_FINAL_REPORT.md). Free reproduction without paid calls: [`docs/DEMO.md`](DEMO.md). Quick start: [`gamewatch/README.md`](../gamewatch/README.md).
* Demo video: it shows the GW1 workflow (discovery → repair → independent verification). The GW2 results are described here and in the report.

Built by the Rule Sabotage author with Claude Code during the hackathon. The game, GameWatch and SkillFlow are team-written. Kane is the autonomous discovery agent, and the repair agent was a separate Claude Code instance.

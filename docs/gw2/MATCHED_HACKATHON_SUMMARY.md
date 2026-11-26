# Can an AI agent correct its own theory of a hidden rule set? A pre-registered test

**Rule Sabotage / GameWatch GW2.** An AI browser agent (Kane, kane-cli 0.10.4) studies recorded play of a board game whose rules are hidden, then writes testable hypotheses. In a second, separate call it may revise them. In the treatment arm only, the revision page also lists the recorded observations that contradict each hypothesis. Accuracy is scored once, on held-out observations that were sealed until every call was frozen.

## What we ran
* 10 sessions (5 control, 5 treatment) in 5 balanced blocks, with 20 real agent calls, each approved by the operator one at a time.
* The design was pre-registered before any call: hypotheses, schedule, evidence manifests, code dependency set and both commits.
* Each call is one hash-chained sealing transaction. The held-out evidence was opened exactly once.
* Cost: 786 credits (918 including the earlier pilot), well under the 4,000-credit threshold. All 20 calls finished within their ceilings.

## What we found
| | Control | Treatment |
|---|---|---|
| Sessions with a machine-checkable hypothesis | 2 of 5 | 2 of 5 |
| Sessions that actually received contradiction feedback | n/a | 2 of 5 (the other 3 had nothing checkable) |
| Sessions that revised or withdrew anything | 0 | 2 (one revision, one withdrawal) |
| Contradicted predictions turned correct | 0 | 0 |
| New errors introduced | 0 | 0 |
| Held-out accuracy change | 0, 0 | +0.106, +0.495, **both from dropping predictions** (coverage −0.042 and −0.113) |

1. **There was no genuine self-correction in either arm.** Accuracy rose only where the agent dropped predictions: M06 dropped 28 correct and 14 incorrect, and M08 dropped 28 correct and 85 incorrect. Our metric flags this as "narrowing only", and we do not report it as correction.
2. **Feedback changed behaviour, not knowledge.** Both treatment sessions that saw contradictions acted: one withdrew a hypothesis and one rewrote it. No control session changed anything, including a control session whose theory was wrong on 63% of its held-out predictions.
3. **The bottleneck is formalization.** In 6 of 10 sessions the agent produced JSON that looked structured but failed the published schema, so none of its claims could be checked. That also kept the treatment from reaching 3 of 5 treatment sessions.
4. **Agent self-reports are not evidence.** In phase 2, 8 of 10 calls submitted nothing, yet the agent's summaries described "submitted updates". The server logs show no submissions.

## Why it matters
Contradiction feedback alone did not make this agent a better theorist. It made it a more cautious one. Accuracy measured without coverage would have reported a +0.495 "improvement" that is entirely narrowing. That is the trap this measurement design is built to catch.

## Integrity
* The evaluation was independently re-run and reproduced byte for byte. The ledger, raw seals, server sessions, access journals, freezes and revision pages all verify.
* After the run, both execution gates were restored to disabled.
* The published evidence is redacted (local paths, Kane session ids and account balances), with original and published hashes for every file.
* There is no significance claim: with 5 sessions per arm this is a case comparison. The pre-registered block comparison does not support a claim that the feedback improves agent performance.

Details: `docs/gw2/MATCHED_RESULTS_REPORT.md`. Evidence: `evidence/gw2/matched-run/`.

# GW2 matched comparison: pre-registration (COMPLETED DRAFT, for execution review; NOT authorized, NOT executed)

**Status: draft for operator review.** Parameters are those the operator set on 2026-11-26 07:38 UTC (GW2_EXTENSION_V1_APPROVED). Nothing in this document has run. Both gates are closed:
* the paid-call gate is `PAID_RESEARCH_EXECUTION = 'disabled'`, and its scope names only the P7 pilot ids;
* agent feedback is `AGENT_FEEDBACK_ENABLED = false`.

The machine-readable plan is generated from the code (`node --experimental-strip-types --no-warnings gamewatch/gw2/matched/cli.ts plan`). A copy for review is in `evidence/gw2/matched-plan/PLAN.draft.json`. At execution, `cli.ts preregister` writes it, together with the sha256 of this file and of the code, into the operator's external record as the first ledger entry. Decisions D136–D145.

## 1. Question
When a Kane session is shown, deterministically, which recorded discovery observations contradict its own structured hypotheses, does it revise them toward the builds' actual behaviour? The comparison is with matched sessions that get the same revision opportunity without that list.

## 2. Arms and the single manipulated factor
| | Control | Treatment |
|---|---|---|
| Phase-2 `revision.html` feedback section | "No observation list is provided in this session." | Deterministic hypothesis–observation items for the session's own Freeze-1 hypotheses. Discovery evidence only. At most 25 per hypothesis |

Everything else is identical and shared:
* the evidence;
* the objectives (phase 1 and phase 2, byte-identical, sha256 in the plan);
* the representation requirement, a structured representation on every hypothesis;
* the revision opportunity, with the same page shell and the same `revises` form field;
* budgets, the CLI pin and the specification policy (hidden in both arms).

`unmatchedFactors(control, treatment)` must be empty, and this is tested.

## 3. Sessions and assignment
* **Size.** 10 sessions: 5 control and 5 treatment. Each session is two separate Kane calls, so 20 calls in total.
* **Assignment.** Balanced blocks of two, seed **20261126**. Block b is treatment-first when the first byte of sha256("20261126:block:b") is odd.
* **Order.** Sessions run strictly in this order, one at a time. Each `cli.ts run` invocation runs exactly one call, the next unstarted call in the external ledger, so the per-run approval and `KANE_PAID_RUN_AUTH` name that one call. There are no parallel calls and no retries: a started call is never started again, and a started call without a `call-end` blocks every further call. The operator procedure is [`MATCHED_EXECUTION_PROCEDURE.md`](MATCHED_EXECUTION_PROCEDURE.md).

| Order | Block | Session | Arm | Phase-1 run | Phase-2 run |
|---|---|---|---|---|---|
| 1 | 1 | M01 | control | GW2-M01-P1 | GW2-M01-P2 |
| 2 | 1 | M02 | treatment | GW2-M02-P1 | GW2-M02-P2 |
| 3 | 2 | M03 | treatment | GW2-M03-P1 | GW2-M03-P2 |
| 4 | 2 | M04 | control | GW2-M04-P1 | GW2-M04-P2 |
| 5 | 3 | M05 | control | GW2-M05-P1 | GW2-M05-P2 |
| 6 | 3 | M06 | treatment | GW2-M06-P1 | GW2-M06-P2 |
| 7 | 4 | M07 | control | GW2-M07-P1 | GW2-M07-P2 |
| 8 | 4 | M08 | treatment | GW2-M08-P1 | GW2-M08-P2 |
| 9 | 5 | M09 | control | GW2-M09-P1 | GW2-M09-P2 |
| 10 | 5 | M10 | treatment | GW2-M10-P1 | GW2-M10-P2 |

Feedback runs listed in the pre-registration (`plan.agentFeedback.runs`): GW2-M02-P2, GW2-M03-P2, GW2-M06-P2, GW2-M08-P2 and GW2-M10-P2. Each entry names its run id, session, arm `treatment` and phase 2.

## 4. Evidence
* **Generation.** Fresh, under procedures frozen in their own commit before generation:
  * `evidence/gw2/procedures/generation-matched-2.json`: seeds 98501–98512, builds QX-41 and QX-73, the P7 scripts unchanged;
  * `evidence/gw2/procedures/partition-matched-2.json`.
* **Location.** `evidence/gw2/matched-evidence-2/`. The pre-registration binds the sha256 of every partition `MANIFEST.json`.
* **What the agent sees.** Only the discovery site. The final held-out partition and `eval/` are opened once, after every declared session's Freeze-2 (§7).
* **Dry-run dataset.** `evidence/gw2/matched-evidence/` (matched-generation-1, seeds 98401–98412) is the development and dry-run dataset. During development a scratch dry run of the evaluation read its held-out partition, so it is not used for the experiment.
* **Contamination (T25).** B1–B3 and the P7 results are public, and this applies to both arms equally.

## 5. Per-session protocol
1. **Phase 1.** A call with objective phase 1, 80 steps and 2700 s, on the discovery site, with at most 8 forms. The server session is sealed, the raw output sealed and anchored, and every stored form imported verbatim into the session's own graph.
2. **Freeze-1.** `sessions/<M>/FREEZE-1.json` is written, and its sha256 and graph head are anchored in the external ledger. Freezes are independent per session, one graph per session.
3. **Phase-2 site.** It is built from the session's own authenticated Freeze-1 only, together with the pre-registered discovery manifest. Treatment feedback goes through the runtime path, which needs `AGENT_FEEDBACK_ENABLED = true` in a reviewed commit and an authorization naming {runId, session, arm, phase, pre-registration sha256}.
4. **Phase 2.** A call with objective phase 2, 40 steps and 1350 s, with at most 8 forms. Revisions and withdrawals name an earlier H-number. They become new nodes that link to the original with `refines`. Originals are never edited.
5. **Freeze-2.** It is anchored, and it names Freeze-1's sha256.

## 6. Budget (operational thresholds, not provider-enforced caps)
* **Ceilings.** Phase 1: 300 credits per call. Phase 2: 150 credits per call. The existing preflight estimate (steps × 3.1) is 248 and 124, both within the ceilings.
* **Accounting.** By balance delta. The cumulative research total includes P7 (132.043). The stopping threshold is **4,000** credits.
* **When a call does not start.** If its estimate exceeds its ceiling, if the cumulative spend is unknown, or if cumulative + its ceiling would exceed 4,000.
* **What stops the experiment.** CEILING_EXCEEDED, SPEND_UNKNOWN, or reaching 4,000. The call that triggers the stop is imported and frozen first, then nothing further starts. A stopped call is never repeated.
* **Never.** No retries, no parallel paid calls, no credit purchases. Every call also passes the unchanged per-run paid-call gate: an approval file, `KANE_PAID_RUN_AUTH`, the pinned real CLI, a balance of at least 1.5 × the ceiling, and an operator clear after any exceedance.

## 7. Early termination, missing representations, withdrawals, conflicts
* **Early termination.** A timeout, a non-zero exit or no valid run_end marks the call inconclusive. Its forms are imported and frozen, and the session continues to phase 2, the same in both arms. The session is marked incomplete, and its block leaves the block comparison.
* **Missing representations.** These hypotheses are kept and reported as not machine-evaluable. Their accuracy is "not available", never zero.
* **Withdrawals.** A phase-2 abstention that names an original removes that original from the final set. The original stays in the graph.
* **Conflicting revisions.** Two or more phase-2 forms for one original: the original stays in the final set unchanged. The conflicting forms are listed and are not scored as corrections or harms.
* **Phase-2 forms naming no frozen original.** These are additions to the final set.

## 8. The single held-out opening
`cli.ts evaluate` runs only if:
* the pre-registration still holds;
* there has been no earlier opening;
* every declared session has Freeze-1 and Freeze-2, or the experiment stopped and every started call is frozen.

The opening is recorded once in the external ledger, and a second opening is refused.

## 9. Measures (session level, reported separately, never combined)
The unit is the session. Outcome checks within a session are correlated, and they are not experimental replications.
* Held-out accuracy (matching / (matching + contradicting) over represented clauses) and coverage (held-out situations predicted / all held-out situations), Freeze-1 vs final, with the paired change per session.
* Corrections (a revision more accurate than its original), harmful revisions (less accurate, or a representation lost), unchanged, and not comparable.
* Actions on originals: kept, revised, withdrawn, conflicting, and additions.
* Abstentions in phase 1 and withdrawals in phase 2.
* Representation availability in phase 1 and phase 2.
* Arm comparison: the per-arm lists of session values, and treatment − control within each complete block. With 5 sessions per arm this is a case comparison: no significance test and no improvement claim unless the block comparison supports it.

## 10. Historical record
P7 (`evidence/gw2/p7-pilot`) stays historical evidence. It is not a control and it is not pooled.

## 11. Open before freezing
* The operator's written authorization text.
* The external record location.
* The scoped gate commit (mode `per-run-approval`, scope `^GW2-M(0[1-9]|10)-P[12]$`).
* The reviewed commit enabling agent feedback for the five listed runs.

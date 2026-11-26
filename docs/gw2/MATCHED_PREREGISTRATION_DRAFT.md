# GW2 matched comparison: pre-registration (COMPLETED DRAFT, final preflight; NOT authorized, NOT executed)

**Status: draft for final review.** Parameters are those the operator set on 2026-11-26 07:38 UTC (GW2_EXTENSION_V1_APPROVED). The design was conditionally approved at 08:31 UTC (GW2_MATCHED_EXPERIMENT_CONDITIONALLY_APPROVED); this revision applies that review's execution blockers (D146–D153). Nothing in this document has run. Both gates are closed:
* the paid-call gate is `PAID_RESEARCH_EXECUTION = 'disabled'`, and its scope names only the P7 pilot ids;
* agent feedback is `AGENT_FEEDBACK_ENABLED = false`.

The machine-readable plan is generated from the code (`node --experimental-strip-types --no-warnings gamewatch/gw2/matched/cli.ts plan`). A copy for review is in `evidence/gw2/matched-plan/PLAN.draft.json`. At execution, `cli.ts preregister` writes it, together with the sha256 of this file and of the code, into the operator's external record as the first ledger entry. It binds the sha256 of this file, the procedure, the spec encoding, `package.json` and the **complete execution dependency set** (every module reachable by static import from `matched/cli.ts`, computed, 61 files), plus the **exact commit** run (git HEAD) and the reviewed disabled-gate commit it derives from. Every call and the evaluation re-check all of it, including that HEAD is unchanged. Decisions D136–D153.

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

**Revision page (both arms, identical shell).** A separate Kane call is not assumed to remember the first. `revision.html` lists every frozen phase-1 form in full: H-number, kind, verbatim statement, confidence, cited evidence, the full submitted structured representation (verbatim) and its availability (checkable / not parseable / not representable / none), and each abstention with its scope, with a count of hypotheses, checkable representations and abstentions. The phase-2 objective (`OBJECTIVE_PHASE_2_MATCHED`) says that this is a new, separate call with no memory of the earlier one. The V1 draft objective ("continuing the same investigation") is kept unchanged as history and is not used. The only difference between arms remains the feedback section.

**Provenance and validity.** A real Kane call's forms are attributed to `kane-cli` (version from the gate's CLI probe) only when the sealed raw stdout, the sealed args (CLI, version, argv, run nonce) and the stored note establish the execution provenance. A Kane call that does not establish it, for example one that ended without run_end, is imported under a neutral agent author with the reasons, never Kane-labelled and never a test double. Each freeze records two separate questions: **submission verification** (form nonce and server session matched) and **call validity** (exit, timeout, run_end validity, spend).

**Sealing transaction and integrity.** Each call is one transaction in the external ledger: call-start → call-end → raw-seal → server-closed → freeze → (phase 1) revision-page. Before every call and before the evaluation, the actual files are re-verified against their anchors: raw seal, server-session closure seal, access journal (its hash, hash chain and the site it recorded serving), freeze files, graph heads and the phase-2 site against its construction record. The discovery site is verified file by file against the pre-registered discovery manifest before every phase-1 call. An incomplete transaction or any integrity problem refuses every further call. A failing step is recorded (`call-failed`, then `experiment-stopped`) and never retried.

## 6. Budget (operational thresholds, not provider-enforced caps)
* **Ceilings.** Phase 1: 300 credits per call. Phase 2: 150 credits per call. The existing preflight estimate (steps × 3.1) is 248 and 124, both within the ceilings.
* **Accounting.** By balance delta. The cumulative research total includes P7 (132.043). The stopping threshold is **4,000** credits.
* **When a call does not start.** If its estimate exceeds its ceiling, if the cumulative spend is unknown, or if cumulative + its ceiling would exceed 4,000.
* **What stops the experiment.** CEILING_EXCEEDED, SPEND_UNKNOWN, or reaching 4,000. The call that triggers the stop is imported and frozen first, then nothing further starts. A stopped call is never repeated.
* **Never.** No retries, no parallel paid calls, no credit purchases. Every call also passes the unchanged per-run paid-call gate: an approval file, `KANE_PAID_RUN_AUTH`, the pinned real CLI, a balance of at least 1.5 × the ceiling, and an operator clear after any exceedance.

## 7. Early termination, missing representations, withdrawals, conflicts
* **Early termination.** A timeout, a non-zero exit or a run_end that is missing **or not valid** (status other than passed/failed) marks the call inconclusive. A session is complete only if both calls exited 0, did not time out and have a valid run_end. Its forms are imported and frozen, and the session continues to phase 2, the same in both arms. The session is marked incomplete, and its block leaves the block comparison.
* **Missing representations.** These hypotheses are kept and reported as not machine-evaluable. Their accuracy is "not available", never zero.
* **Withdrawals.** A phase-2 abstention that names an original removes that original from the final set. The original stays in the graph.
* **Conflicting revisions.** Two or more phase-2 forms for one original: the original stays in the final set unchanged. The conflicting forms are listed and are not scored as corrections or harms.
* **Phase-2 forms naming no frozen original.** These are additions to the final set.

## 8. The single held-out opening
`cli.ts evaluate` runs only if:
* the pre-registration still holds;
* there has been no earlier opening;
* every declared session has Freeze-1 and Freeze-2, or the experiment stopped and every started call is either frozen or has its failure recorded (`call-failed`). A failed call is listed in the evaluation (`failedCalls`). Any session with a recorded `call-failed` is incomplete, whatever its freeze status. Without a Freeze-1 a session has no outcomes. Without a Freeze-2 only its Freeze-1 readings are reported: every revision measure and every paired change is unavailable (null, `revision.available` false), never zero. Nothing is imputed.
* every transaction, completed or failed, passes the integrity checks of §5 (a failed one must be a clean, stopped prefix, and every step it recorded is verified) (raw seals, session closures, access journals, freezes, graph anchors, phase-2 sites).

The opening is recorded once in the external ledger, and a second opening is refused.

## 9. Measures (session level, reported separately, never combined)
The unit is the session. Outcome checks within a session are correlated, and they are not experimental replications.
* Held-out accuracy (matching / (matching + contradicting) over represented clauses) and coverage (held-out situations predicted / all held-out situations), Freeze-1 vs final, with the paired change per session.
* Revision effects on **prediction targets** (situation, outcome field with a recorded held-out outcome), per original: correction (corrected common targets, nothing newly incorrect), mixed, harmful (newly incorrect only, or the structured representation lost), narrowing only (predictions dropped, none corrected), unchanged, not comparable. The accuracy-only reading (a revision more or less accurate than its original) is kept and reported separately.
* Target-level changes, initial vs final and per pair: corrections on **common** targets; common targets that became incorrect; **newly introduced** predictions (matching / incorrect); **dropped** predictions; coverage **contraction and expansion** in situations.
* An attribution of every accuracy change. **An accuracy increase that comes only from narrower coverage, with no correction on a common target, is labelled "narrowing only" and is never reported as self-correction.**
* Discovery fit (the same score on the discovery partition), initial vs final.
* C readings (three-way: hypothesis–observation, hypothesis–spec, observation–spec; `verify.ts threeWay` with the pre-registered encoding `rule-sabotage-v6.1.json`), per partition, initial vs final, including "accurate description of a defect".
* Counterexample classes of held-out contradictions: novelty of the situation's inputs against the applicable discovery situations of the same build (novel individual value / novel combination / observed combination), and whether discovery already held a counterexample of that clause.
* Withdrawals, phase-1 abstentions and losses of machine-evaluable representations, listed per original.
* Actions on originals: kept, revised, withdrawn, conflicting, and additions.
* Abstentions in phase 1 and withdrawals in phase 2.
* Representation availability in phase 1 and phase 2.
* Arm comparison: the per-arm lists of session values, and treatment − control within each complete block. With 5 sessions per arm this is a case comparison: no significance test and no improvement claim unless the block comparison supports it.

## 10. Historical record
P7 (`evidence/gw2/p7-pilot`) stays historical evidence. It is not a control and it is not pooled.

## 11. Open before freezing
* The operator's written authorization text.
* The external record and run locations (proposed: `D:\Rule_Sabotage\gw2-matched-record`, `D:\Rule_Sabotage\gw2-matched-run`).
* The reviewed commit (both gates closed; the full regression suite passes there).
* The candidate commit: the reviewed commit plus exactly three line changes, checked by `cli.ts candidate-check`: `PAID_RESEARCH_EXECUTION = 'per-run-approval'`, `PAID_RESEARCH_SCOPE = /^GW2-M(0[1-9]|10)-P[12]$/` and `AGENT_FEEDBACK_ENABLED = true`.

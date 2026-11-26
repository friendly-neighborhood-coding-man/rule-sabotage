# GW2 matched comparison: readiness report (GW2_MATCHED_EXPERIMENT_READY_FOR_REVIEW)

This report covers the operator brief of 2026-11-26 07:38 UTC, "GW2_EXTENSION_V1_APPROVED — OFFLINE". The matched comparison is prepared, not executed. No Kane call, no paid call and no runtime inference took place. `PAID_RESEARCH_EXECUTION = 'disabled'` and `AGENT_FEEDBACK_ENABLED = false` are unchanged. Decisions D136–D145.

* Pre-registration (completed draft): [`MATCHED_PREREGISTRATION_DRAFT.md`](MATCHED_PREREGISTRATION_DRAFT.md). The machine-readable plan is `evidence/gw2/matched-plan/PLAN.draft.json`.
* Execution procedure: [`MATCHED_EXECUTION_PROCEDURE.md`](MATCHED_EXECUTION_PROCEDURE.md).

## Required corrections

| # | Correction | Where | Tested by |
|---|---|---|---|
| 1 | Feedback cap of 25 per hypothesis, enforced in construction and in rendering. Selection is deterministic and round-robin across contradiction patterns, and displayed vs total counts are reported | `ext/feedback-core.ts` | `gw2-matched` "feedback cap"; ext V0/V1 tests updated to the capped totals |
| 2 | Authorization bound to runId, session, arm, phase and the pre-registration sha256, and listed exactly in the anchored plan | `ext/feedback.ts`, `matched/feedback.ts` | ext V1 binding tests; `gw2-matched` "gates" |
| 3 | Freeze-1 and Freeze-2 per session, each anchored independently | `matched/sessions.ts` | "pipeline on test doubles" |
| 4 | Originals and representations preserved. Phase 2 receives only its own Freeze-1 and discovery evidence | `matched/sessions.ts`, `revision-page.ts` | "originals preserved…", "feedback reads only the authenticated Freeze-1 prefix", "phase 2: same shell" |
| 5 | The within-build comparison is labelled "within-build invariance". V2 dashboard; V0 and V1 bytes unchanged | `ext/dashboard-v2.ts`, `evidence/gw2/ext-v2/` | "dashboard V2" |
| 6 | Complete pipeline on test doubles: early termination, missing representations, withdrawals, conflicting revisions, budget failures, single evaluation, one call per invocation | `matched/pipeline.ts`, `doubles.ts`, `evaluate.ts` | 13 tests in `tests/gw2-matched.test.ts` |

## Evidence
* The procedures were frozen before generation (commit 9c06b18).
* The experiment evidence is `evidence/gw2/matched-evidence-2`: seeds 98501–98512, 44 scripted cases and 48 matches, with a passing leak check over 63 served files (commit aa92d78). Its held-out and `eval/` partitions have not been read.
* **Disclosure.** During development, a scratch dry run of the evaluation read the held-out partition of the first fresh dataset, `matched-evidence` (seeds 98401–98412). That dataset was therefore re-designated as the development and dry-run dataset, which is the one the tests use, and it is not used for the experiment.

## Checks
* `npm run test:gw2`: 166 tests, 166 pass, 0 fail.
* `npm run gw2:verify`: 135 frozen files OK, and the frozen path inventory is OK.
* `python3 gamewatch/vendor/verify.py`: the vendored SkillFlow is OK.

## Not done (needs the operator)
These are listed in procedure §B:
* the written authorization;
* the external record location;
* the scoped gate commit;
* the agent-feedback commit;
* the decision to execute.

No claim is made that GW2 improves agent performance.

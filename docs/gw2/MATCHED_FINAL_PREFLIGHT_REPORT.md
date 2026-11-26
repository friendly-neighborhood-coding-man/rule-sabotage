# GW2 matched comparison: final execution preflight (GW2_MATCHED_FINAL_PREFLIGHT_READY)

This report answers the operator review of 2026-11-26 08:31 UTC, GW2_MATCHED_EXPERIMENT_CONDITIONALLY_APPROVED. All work is offline corrections. No Kane call, paid call or inference took place. `PAID_RESEARCH_EXECUTION = 'disabled'` and `AGENT_FEEDBACK_ENABLED = false` are unchanged. Decisions D146–D153. The earlier [`MATCHED_READINESS_REPORT.md`](MATCHED_READINESS_REPORT.md) is kept as history.

* Pre-registration (revised draft): [`MATCHED_PREREGISTRATION_DRAFT.md`](MATCHED_PREREGISTRATION_DRAFT.md). The plan is in `evidence/gw2/matched-plan/PLAN.draft.json`.
* Procedure: [`MATCHED_EXECUTION_PROCEDURE.md`](MATCHED_EXECUTION_PROCEDURE.md).
* Operator script: `gw2-matched-run.ps1`, outside the repository, in the project files.

## Blockers and corrections

| # | Blocker | Correction | Regression test (`tests/gw2-matched.test.ts`) |
|---|---|---|---|
| 1 | Kane provenance not passed to `importPhase` | The sealed stdout, args (CLI, version, argv, nonce) and CLI version are passed for Kane calls. Kane attribution applies only where `kaneExecution` establishes the execution; otherwise a neutral agent author is used with the reasons. A Kane-served session can never be imported as a double, and vice versa. Submission verification and call validity are recorded separately in every freeze | "real-runner boundary (mocked transport)"; "a Kane call that ends without run_end" |
| 2 | run_end presence used for completion; no integrity re-check | Completion requires a valid run_end. `matched/integrity.ts` checks each sealing transaction and re-verifies raw seals, closures, journals, freezes, graph heads and phase-2 sites before every call and before evaluation. Failures are recorded (`call-failed`) and never retried | "completion needs a VALID run_end"; "integrity: tampered …" (6 cases); the treatment-arm refusal in the boundary test |
| 3 | Served sites and dependency binding | The discovery site is checked against the pre-registered manifest before serving, and the phase-2 site against its anchored record. The pre-registration binds the computed dependency set (61 files), the docs, the encoding, HEAD and the reviewed commit, and HEAD is re-checked per call. Generation 2 held-out content is never read (manifest hashes only) | "the discovery site is verified …"; "pre-registration binds the complete execution dependency set …" |
| 4 | Revision page and context | Both arms get the complete frozen phase-1 forms: statement, confidence, evidence, verbatim representation and availability, and abstention scope. The phase-2 objective states there is no memory of the earlier call | "fair revision opportunity …"; "phase 2: same shell in both arms …" |
| 5 | Measures | Added, with accuracy and coverage kept:<br>• discovery fit;<br>• common-target corrections;<br>• newly incorrect predictions;<br>• contraction and expansion;<br>• an attribution, where narrowing only is never called self-correction;<br>• target-based effects, with accuracy-only effects kept;<br>• C readings;<br>• counterexample classes;<br>• withdrawals, abstentions and representation losses | "single evaluation …" (the narrowing case M09); "representation loss …" |
| 6 | Windows procedure; disabled vs enabled | `gw2-matched-run.ps1` with `-DryRun`. The candidate is checked by an exact three-line diff (`cli.ts candidate-check`), and the historical tests run unchanged on the reviewed commit | "enabled-candidate check …"; "non-paid dry run …" |

## Dry run (generation 1 only, non-paid)

`gamewatch/gw2/matched/dry-run.ts` ran 20 test-double calls through the real review server:
* integrity problems: 0;
* experiment stopped: no;
* block 3 incomplete, because M06 ends early by design;
* M09 ("narrower") is reported as "narrowing only: accuracy rose because predictions were dropped (not self-correction)". Its held-out accuracy change was +0.417 and its coverage change −0.331.

The doubles do not respond to feedback. This checks the pipeline, not the scientific question.

## Checks
* `npm run test:gw2`: 176 tests, 176 pass, 0 fail. `tests/gw2-matched.test.ts` has 23 tests.
* `npm run gw2:verify`: 135 frozen files OK.
* `python3 gamewatch/vendor/verify.py`: OK.

## Remaining limitations
* **Script not executed.** The PowerShell script was not run or parsed here: there is no PowerShell in this environment. Its first real use should be `-DryRun` on Windows.
* **Mocked transport only.** The real-runner test drives the actual Kane runner, gate and import path, but through a mocked process transport. No real kane-cli process ran. Version and balance parsing are exercised with the strict parsers on mocked output.
* **Candidate commit not made.** The candidate commit does not exist yet: it would enable both gates. `candidate-check` is tested against synthetic candidate text and against this commit, which it correctly rejects as not a candidate.
* **Failed calls.** Superseded by D155–D158: a failed transaction is verified step by step, the evaluation can run once after a terminal stop (`-EvaluateOnly`), a session with a failed call is incomplete, and a session without Freeze-2 has its revision measures reported as unavailable.
* **C readings are not authoritative.** They use the spec encoding `rule-sabotage-v6.1.json`, whose review status is reported in the evaluation (`encoding.authoritative`). They are not a judgment of the agent.
* **Identical doubles in both arms.** The test doubles behave the same in both arms, so the dry run's arm and block differences are not informative.
* **No significance claims.** With 5 sessions per arm, the design supports a case comparison only, with no significance claim. No claim is made that GW2 improves agent performance.

## Windows validation follow-up (operator review 2026-11-26 13:43 UTC, D155 approved)
Offline only, both gates closed, generation 1 only. Decisions D156–D158.
1. **A failed call makes its session incomplete**, whatever its freeze status (`sessionComplete` in `evaluate.ts`). Test: "a session with a recorded call-failed is incomplete whatever its freeze status".
2. **No Freeze-2: unavailable, not zero.** Such a session reports its Freeze-1 readings only. Every revision measure and paired change is null, with `revision.available: false`, and the per-arm lists carry null for it. Test: the failed-transaction case in "real-runner boundary (mocked transport)".
3. **Evaluation-only mode.** `gw2-matched-run.ps1 -EvaluateOnly` is for a terminally stopped experiment. It runs the candidate and integrity checks, then makes one opening after `EVALUATE`. It never starts a call or uses kane-cli, and it checks that the `call-start` count is unchanged (procedure §H). The same path is tested in Node on generation 1: the evaluation starts no call, a second opening is refused, and `next` stays refused. The PowerShell itself was not run here, because there is no PowerShell in this environment.

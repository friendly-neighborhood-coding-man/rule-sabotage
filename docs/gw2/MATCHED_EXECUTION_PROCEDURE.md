# GW2 matched comparison: execution procedure (DRAFT for execution review; NOT authorized, NOT executed)

This is the operator procedure for the matched comparison in [`MATCHED_PREREGISTRATION_DRAFT.md`](MATCHED_PREREGISTRATION_DRAFT.md) (D136–D145). Nothing here has run against Kane. While both gates stay closed, every paid step is refused before any server or process starts:
* `PAID_RESEARCH_EXECUTION = 'disabled'`, with a scope that names only the P7 pilot ids;
* `AGENT_FEEDBACK_ENABLED = false`.

The whole pipeline has been exercised with test doubles (`tests/gw2-matched.test.ts`).

All commands are run from the repository root with Node ≥ 22.10. `M` stands for `node --experimental-strip-types --no-warnings gamewatch/gw2/matched/cli.ts`.

## A. Limits

| Item | Value |
|---|---|
| Sessions | 10 (M01–M10): 5 control and 5 treatment, balanced blocks of two, seed 20261126 |
| Calls | 20 in total, exactly 2 per session (`GW2-Mnn-P1`, `GW2-Mnn-P2`). **One call per invocation**, strictly in schedule order. No retries, nothing in parallel |
| Phase 1 | `--max-steps 80 --timeout 2700`, ceiling 300 credits (estimate 248) |
| Phase 2 | `--max-steps 40 --timeout 1350`, ceiling 150 credits (estimate 124) |
| Research threshold | 4,000 credits cumulative, P7's 132.043 included. A call does not start if cumulative + its ceiling would exceed 4,000 |
| Hard cap | **None.** The ceilings and the threshold are operational decision points; kane-cli cannot be stopped at a credit amount |
| Accounting | Balance delta per call (`before − after`), recorded in the external ledger |
| Credit purchases | None |

## B. Permissions and reviewed commits (operator; none exist yet)

1. **Written authorization** of the matched comparison: its text and the operator's name.
2. **The paid-call gate commit**, on its own:
   * `PAID_RESEARCH_EXECUTION = 'per-run-approval'`;
   * `PAID_RESEARCH_SCOPE = /^GW2-M(0[1-9]|10)-P[12]$/`.
   `'disabled'` is restored in a separate commit afterwards.
3. **The agent-feedback commit**, on its own: `AGENT_FEEDBACK_ENABLED = true`. It is restored to `false` afterwards. Feedback is still served only to runs that the anchored pre-registration lists (`GW2-M02-P2`, `GW2-M03-P2`, `GW2-M06-P2`, `GW2-M08-P2`, `GW2-M10-P2`), and only with an authorization that matches exactly.
4. **An external record directory and a run directory**, both outside the repository.
   * `cli.ts` refuses paths inside the repository (`recordDir`).
   * The record holds the hash-chained ledger and the anchors.
   * The run directory holds the per-session graphs, freezes, raw output and sites.

## C. Before the first call

1. Check the tree:
   * HEAD is the reviewed commit and the tree is clean;
   * `npm run gw2:verify`, `python3 gamewatch/vendor/verify.py` and `npm run test:gw2` pass;
   * `kane-cli --version` is the pinned version.
2. Run `M plan` and compare it with `evidence/gw2/matched-plan/PLAN.draft.json`. The two may differ only in the code-hash fields changed by the two gate commits.
3. Run `M preregister --record <rec>`. This step:
   * writes the pre-registration into the record as the first ledger entry;
   * binds the sha256 of every `matched-evidence-2` partition manifest, of the pre-registration draft, of the matched and feedback code, and of the schedule;
   * refuses if the record already holds a pre-registration.
4. Write the five feedback authorizations, `<run>/authorizations/GW2-Mnn-P2.json`, for the treatment sessions only. Each one is:
   ```json
   { "runId": "GW2-M02-P2", "session": "M02", "arm": "treatment", "phase": 2,
     "preregSha256": "<sha256 printed by preregister>", "operatorAuthorization": "<the written authorization text>" }
   ```
   A missing, mismatched or control-arm authorization stops the pipeline before the phase-2 site is built.

## D. Each call, strictly one after another (20 times)

1. Run `M next --record <rec>`. It prints the next run id, its session, arm and phase, and it starts nothing. It refuses in two cases:
   * after a stop;
   * when a started call has no `call-end`. Report that case and do not continue.
2. Check the live state:
   * `kane-cli balance` is at least 1.5 × the phase ceiling (450 for phase 1, 225 for phase 2);
   * the cumulative spend in the ledger is below the threshold rule.
3. Write the approval `<run>/approvals/<runId>.json` immediately before the call:
   ```json
   { "runId": "<runId>", "approvedBy": "<operator>", "approvedAt": "<now, ISO>", "maxCalls": 1,
     "maxSteps": 80, "ceilingCredits": 300, "acknowledgesNoHardCap": true }
   ```
   For phase 2, use `maxSteps` 40 and `ceilingCredits` 150. At most one unrun approval exists at any moment.
4. Run `KANE_PAID_RUN_AUTH=<runId> M run --record <rec> --run <run>`, then unset the variable. The invocation runs exactly one call:
   * It checks the pre-registration again, then the budget preflight, then the unchanged paid-call gate.
   * It refuses a served site that holds operator content.
   * The call itself: `call-start`, the GW2 review server, one kane-cli call, then the server closes.
   * The raw output is sealed: args, stdout, stderr and meta, with `raw-seal` anchored.
   * Every stored form is imported verbatim into the session's own graph, and the freeze is anchored (`freeze-1` or `freeze-2`).
   * After phase 1, the phase-2 site is built from that session's authenticated Freeze-1 only, and `revision-page` is anchored. Control gets the fixed "No observation list" sentence. Treatment gets the capped discovery feedback through the runtime path.
5. Look only at the operational output: status, reasons, credits used and the submission count. Do not open Kane's summary, its submissions, the revision pages or raw stdout until every call is frozen.

## E. Stop rules (nothing is ever re-run)

* The gate, the budget preflight or the authorization refuses. The ledger records `call-refused` and `experiment-stopped`.
* A call ends with `CEILING_EXCEEDED` or `SPEND_UNKNOWN`, or the cumulative spend reaches 4,000. The call is imported and frozen first, then `experiment-stopped` is recorded and no further call starts.
* Any verification failure: the pre-registration, a manifest, a blind-site check, a raw seal, a freeze or an anchor.
* A call that times out, exits non-zero or has no valid `run_end` does **not** stop the experiment. It is marked inconclusive and frozen with whatever was submitted, and the session continues to phase 2, the same in both arms. The session is reported as incomplete, and its block leaves the block comparison.

## F. After the last call (or after a stop)

1. Run `M evaluate --record <rec> --run <run>` once. It refuses to open the held-out evidence in three cases:
   * a declared call is unfrozen, unless the experiment stopped and every started call is frozen;
   * the pre-registration changed;
   * there was an earlier opening.
   The opening is recorded once (`gate-opened`). `EVALUATION.json` is written with `wx`, and its sha256 is anchored (`evaluated`).
2. Restore `'disabled'` and `AGENT_FEEDBACK_ENABLED = false` in separate commits.
3. Redact user paths, Kane session ids and links in the copy that goes to the repository, with a redaction record. The raw files stay on the operator's machine.

## G. What to report

Report per session, never pooled and never combined into one score:
* held-out accuracy and coverage, Freeze-1 vs final, and the paired change;
* corrections, harmful revisions, unchanged and not comparable;
* actions (kept, revised, withdrawn, conflicting, additions);
* abstentions and withdrawals;
* representation availability per phase;
* credits, steps and time per call.

Also report the per-arm lists and treatment − control within complete blocks. Five sessions per arm is a case comparison: no significance claim, and no claim that GW2 improves agent performance unless the pre-registered block comparison supports it. P7 is historical, not a control. Add the T25 contamination caveat, which applies to both arms.

# GW2 P7 operator execution checklist (AUTHORIZED 2026-11-25; executed by the operator)

The operator authorized the pilot on 2026-11-25 at 17:13 UTC (D102–D109). The operator runs it on their own machine with
`gw2-p7-run.ps1`. That script is kept **outside the repository**, so editing it cannot change the tree that it checks.
Each paid call happens only after the operator types `RUN <n>` for that session. If any check fails, stop. Do not re-run
after results have been seen.

The pre-registration is [`P7_PREREGISTRATION.md`](P7_PREREGISTRATION.md). The `preregister` step freezes it before the first call.

## A. Limits and cost basis

| Item | Value |
|---|---|
| Maximum authorized runs | **3** objective-mode calls (`GW2-P7-pilot-1..3`, one per session), **0** retries, **0** follow-ups, nothing in parallel |
| CLI | `kane-cli` **0.10.4** (the gate refuses any other version) |
| Per call | `--max-steps 80 --timeout 2700`; process tree killed at 2730 s |
| Observed cost basis | GW1: 80 max steps, **72.4 credits** by balance delta. KX1: 25 max steps, 40.1. Expect roughly 40–75 per call, about **120–225 for 3 calls**. This is not a bound: V3 used 107.9 against an estimate of 80 |
| Gate | Ceiling field 300 per call. It is a local estimate and a post-call decision threshold, **not a cap**. The balance must be **≥ 450 before each call**. The gate serves only the three pilot run ids (D109) |
| Research threshold | 4,000 credits cumulative. This is a stopping threshold, not a cap. It is checked before and after every call |
| Hard cap | **None.** kane-cli has no credit limit, and a running call cannot be stopped at a credit amount |
| Accounting | Kept separately per session: credits (balance delta), Kane's own reported credits, steps (`run_end`/step events), elapsed ms, timeout flag |

## B. Permissions (operator)

1. Written authorization of P7. **Given** on 2026-11-25 at 17:13 UTC.
2. The gate change to `'per-run-approval'`, scoped to the three pilot run ids, in its own commit. **Authorized.** `'disabled'` is restored in a separate commit afterwards.
3. One approval record per run, `evidence/gw2/p7-pilot/exp/approvals/GW2-P7-pilot-<n>.json`. The script writes it with the operator's name and the actual time, **immediately before** that run. At most one unrun approval exists at any moment; the boundary refuses otherwise.
4. One SkillFlow authorization per session (`<state>/authorizations/kane-paid-<n>`), also created immediately before that run.
5. `KANE_PAID_RUN_AUTH=GW2-P7-pilot-<n>` is set only in the script's process, only for that resume. It is cleared afterwards.
6. No credit purchases.

## C. What the script does (from the repository root; Node ≥ 22.10, Python ≥ 3.9, PowerShell 7)

```powershell
pwsh -File <path>\gw2-p7-run.ps1 -Operator "<your name>"
```

1. **Pre-checks, no change yet.**
   * `node`, `python`, `git` and `kane-cli` are on the PATH.
   * HEAD is the expected commit, and the guarded tracked files are clean.
   * The gate line reads `'per-run-approval'` and the scope line is present.
   * No run token or SkillFlow authorization is set in the environment.
   * `npm run gw2:verify`, `python gamewatch/vendor/verify.py` and `npm run test:gw2` all pass.
2. **Book start.** This step runs only if there is no state yet; no Kane process is started.
   * `procedures`, `partition`, leak check, `session-plan` (3 sessions).
   * `preregister`, into the external record directory outside the repository. It checks that the evidence is unopened and that the partition equals the committed one.
   * The book then stops with exit 2 at `investigate-1`.
   * Command:
     ```sh
     python gamewatch/vendor/skillflow/runner.py run gamewatch/gw2/book-p7.json --state evidence/gw2/p7-pilot/skillflow --workdir . \
       --var out=evidence/gw2/p7-pilot/verdicts --var exp=evidence/gw2/p7-pilot/exp \
       --var generation=evidence/gw2/procedures/generation-p7-1.json --var partition=evidence/gw2/procedures/partition-p7-1.json \
       --var bundle=evidence/gw2/p7-evidence/generated/bundle.json --var sessions=3 --var profiles=kane \
       --var run1=GW2-P7-pilot-1 --var run2=GW2-P7-pilot-2 --var run3=GW2-P7-pilot-3 \
       --var record=<external record dir> --var at=now
     ```
3. **For n = 1, 2, 3, strictly one after another.**
   * The runner is waiting at `investigate-<n>`.
   * `kane-cli --version` prints 0.10.4.
   * `kane-cli balance` is at least 450.
   * The cumulative spend is below 4,000, and every earlier session is `completed`.
   * The operator types `RUN <n>`.
   * The script writes the approval and the authorization, then runs one resume with the run token. The boundary seals the raw output, appends the external anchor and records operational fields only.
   * **Only operational status is shown** (`p7-exec.ts ops-status`).
   * After sessions 1 and 2 the runner stops with exit 2 at the next `investigate`.
   * After session 3 it continues through closure, import, freeze, representation seal, three-way, held-out, discrimination, report and integrity to `@done` (exit 0).
4. **Afterwards.**
   * `p7-exec.ts verify-record <record>` and `npm run gw2:verify` are run.
   * The pilot directory, the external record and the console logs are packed into one zip in the record directory, for the operator to upload to the project thread. Raw files stay on the operator's machine.
   * The repository copy is redacted before it is committed (user paths, Kane session ids and links), with a redaction record.

## D. Stop conditions (no re-run in any case; report `PHASE_7_STOPPED`)

* The gate or the preflight refuses (exit 2 at `investigate-<n>` after authorization). The reason is in `kane-ledger.ndjson`.
* `CEILING_EXCEEDED` or `SPEND_UNKNOWN`, or the cumulative threshold is reached. The pipeline stops, and nothing clears the gate.
* A session times out, exits non-zero, or ends without a valid `run_end`. It is kept as inconclusive and not repeated, and no further session starts.
* Any verification failure: leak check, partition, pre-registration, closure, raw seal, freeze, seal, ledger or external anchors.
* Any semantic result has been read. Between sessions, look only at `ops-status`. Kane's summary, its findings, `notes.ndjson`, `hypotheses.ndjson` and raw stdout stay unopened until all three sessions are sealed.

If the pilot ends early, everything is kept and reported as incomplete. The planned session count is not revised, and the
experiment-level freeze is not bypassed. Evaluation then does not run, because the freeze requires all declared sessions.

## E. What to report

Report all three sessions, including failures, with:
* the separated dimensions of the pre-registration §3;
* credits, steps and time in separate columns;
* the contamination caveat (T25);
* the statement that this is exploratory and not an architecture comparison.

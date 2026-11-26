# GW2 matched comparison: execution procedure (FINAL PREFLIGHT DRAFT; NOT authorized, NOT executed)

This is the operator procedure for the matched comparison in [`MATCHED_PREREGISTRATION_DRAFT.md`](MATCHED_PREREGISTRATION_DRAFT.md) (D136–D153). Nothing here has run against Kane. While both gates stay closed, every paid step is refused before any server or process starts:
* `PAID_RESEARCH_EXECUTION = 'disabled'`, with a scope that names only the P7 pilot ids;
* `AGENT_FEEDBACK_ENABLED = false`.

The operator runs the experiment on Windows with **`gw2-matched-run.ps1`**, which follows the same pattern as the P7 script. It is kept **outside the repository**, so editing it cannot change the tree it checks. The script is delivered in the project files (`gw2/matched/gw2-matched-run.ps1`). `N` below stands for `node --experimental-strip-types --no-warnings gamewatch/gw2/matched/cli.ts`.

## A. Limits

| Item | Value |
|---|---|
| Sessions | 10 (M01–M10): 5 control and 5 treatment, balanced blocks of two, seed 20261126 |
| Calls | 20 in total, exactly 2 per session (`GW2-Mnn-P1`, `GW2-Mnn-P2`). **One call per approval and per invocation**, strictly in schedule order. No retries, nothing in parallel |
| Phase 1 | `--max-steps 80 --timeout 2700`, ceiling 300 credits (estimate 248) |
| Phase 2 | `--max-steps 40 --timeout 1350`, ceiling 150 credits (estimate 124) |
| Research threshold | 4,000 credits cumulative, P7's 132.043 included. A call does not start if cumulative + its ceiling would exceed 4,000 |
| Hard cap | **None.** The ceilings and the threshold are operational decision points; kane-cli cannot be stopped at a credit amount |
| Accounting | Balance delta per call (`before − after`), recorded in the external ledger |
| Credit purchases | None |

## B. Two commits and three directories

| | What it is | Checked by |
|---|---|---|
| **Reviewed commit** | Both gates closed. The commit approved at final review | The full regression suite runs here unchanged: `npm run test:gw2`, `npm run gw2:verify`, `python gamewatch/vendor/verify.py`. This includes every historical "the gate is disabled" assertion |
| **Candidate commit** | The reviewed commit plus exactly three line changes: `PAID_RESEARCH_EXECUTION = 'per-run-approval'`, `PAID_RESEARCH_SCOPE = /^GW2-M(0[1-9]\|10)-P[12]$/` and `AGENT_FEEDBACK_ENABLED = true` | `N candidate-check --reviewed <sha>`. It refuses any other changed file or line. The historical tests are not edited to pass on the candidate. The paid calls run only here |

| Directory | Proposed | Notes |
|---|---|---|
| Candidate worktree | `D:\Rule_Sabotage\gw2-matched-live` | A fresh detached worktree at the candidate commit |
| Reviewed worktree | `D:\Rule_Sabotage\gw2-matched-reviewed` | A fresh detached worktree at the reviewed commit |
| External record | `D:\Rule_Sabotage\gw2-matched-record` | The hash-chained ledger, the pre-registration and the console logs. Outside both worktrees |
| Run artifacts | `D:\Rule_Sabotage\gw2-matched-run` | Per-session graphs, freezes, raw output, server sessions, phase-2 sites, approvals and authorizations. Outside both worktrees |

The script never deletes or overwrites an existing directory or file. A run directory that is not empty while the record has no ledger stops the script.

## C. The non-paid dry run (first)

Run `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -DryRun`. It needs only the reviewed worktree, makes no Kane call and touches no gate. It:
1. runs the disabled-gate regression suite at the reviewed commit;
2. runs `gamewatch/gw2/matched/dry-run.ts` into a new `D:\Rule_Sabotage\gw2-matched-dryrun-<time>` directory. That covers the complete pipeline on **generation 1 only** (the development dataset), with 20 test-double calls through the real review server, test-only treatment feedback, every integrity check, and the single evaluation of that dry-run record;
3. writes `dry-run.json` there to upload.

## D. The experiment (after final approval and the candidate commit)

Run `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -AuthorizationText "<the written authorization>"`.

1. **Checks, no change yet.**
   * The tools are present: `git`, `node` ≥ 22.10, `npm`, `python` and `kane-cli`, and `kane-cli --version` is exactly 0.10.4.
   * `KANE_PAID_RUN_AUTH` and `KANE_CLI` are not set.
   * Both worktrees are at their fixed heads, clean, and without CRLF conversions.
   * The record and run directories are outside both worktrees.
2. **Regression and candidate checks.** The regression suite runs at the reviewed commit once per reviewed head (a marker in the record). `N candidate-check` runs at the candidate, then `gw2:verify` and the vendored-runner check.
3. **Pre-registration, once.** `N preregister --record <rec> --reviewed <sha> --commit <candidate>` binds:
   * the experiment evidence manifests;
   * the complete execution dependency set;
   * both commits;
   * the schedule.

   `N verify` must pass, and it must name the same two commits as the script.
4. **Feedback authorizations.** The script writes the five treatment authorizations, `<run>/authorizations/GW2-Mnn-P2.json`. Each holds {runId, session, arm treatment, phase 2, preregSha256, the written authorization}. They are written once and never overwritten.
5. **Each call, one after another.**
   * `N next` names the next call. It refuses after a stop, after an incomplete sealing transaction and on any integrity problem.
   * The script shows the operational status only.
   * It checks the cumulative spend against the threshold, and the balance against 1.5 × the phase ceiling.
   * The operator types `RUN <runId>`.
   * The script writes that call's approval and sets `KANE_PAID_RUN_AUTH` for this process only. It runs `N run` once, which is exactly one call, then unsets the variable.
   * Then it checks the operational status again and runs `N verify`.
6. **After the last call.** `N verify` runs again. The held-out evidence opens only when the operator types `EVALUATE`; that runs `N evaluate` once. The run and record are then packed into one zip to upload. Raw files stay on the machine, and the repository copy is redacted before commit.

## E. What one `N run` does (one sealing transaction)

1. It re-checks the pre-registration (files, manifests, schedule, dependency set and HEAD), and calls `nextCall`, which runs the integrity checks.
2. It runs the budget preflight and the unchanged paid-call gate preflight. A refusal records `call-refused` and `experiment-stopped`.
3. It checks the site it is about to serve:
   * phase 1: every discovery site file against the pre-registered discovery manifest;
   * phase 2: the site against its anchored construction record, already checked by the integrity step;
   * both phases: the blind-site guard.
4. It records `call-start`, serves the site, makes one kane-cli call and closes the server. It then writes the raw args (CLI, version, argv, start time, run nonce), stdout and stderr.
5. It records `call-end` with run_end presence **and validity**. Then `raw-seal`, then `server-closed`, which holds the closure seal, the journal hash, the journal status and the served site.
6. It imports the forms. They are attributed to `kane-cli` only when the execution provenance holds; otherwise they get a neutral agent author with the reasons. Then it records `freeze-<phase>`, with submission verification and call validity recorded separately.
7. After phase 1 it builds the phase-2 site from the session's own Freeze-1 and records `revision-page` with every site file's sha256.
8. If any step after `call-start` fails, it records `call-failed` with the stage and `experiment-stopped`. Nothing is retried.

## F. Stop rules (nothing is ever re-run)

* The gate, the budget preflight, the site check or an authorization refuses.
* A call ends with `CEILING_EXCEEDED` or `SPEND_UNKNOWN`, or the cumulative spend reaches 4,000. The call is imported and frozen first.
* Any integrity problem: the pre-registration, a manifest, a raw seal, a session closure, an access journal, a freeze, a graph anchor, a phase-2 site, or an incomplete transaction.
* Any recorded `call-failed`. The failed transaction is still verified step by step (raw seal, closure, journal, freeze, whatever it recorded) and must end in `experiment-stopped`. The evaluation can then run once, through `-EvaluateOnly` (§H): it lists the failed calls and marks every session with a failed call incomplete, whatever its freeze status. A session without Freeze-2 has its revision measures and paired changes reported as unavailable, never as zero.
* A call that times out, exits non-zero or has no valid run_end does **not** stop the experiment. It is marked inconclusive and frozen with whatever was submitted, and the session continues to phase 2, the same in both arms. The session is reported as incomplete, and its block leaves the block comparison.

## G. What to report

Report per session, never pooled and never combined into one score (pre-registration §9):
* held-out accuracy and coverage, with their paired changes;
* revision effects on prediction targets, and the accuracy-only effects;
* corrections on common targets, newly incorrect predictions, and coverage contraction and expansion;
* the attribution of each accuracy change, where narrowing only is never called self-correction;
* discovery fit;
* C readings;
* counterexample classes;
* actions, abstentions and withdrawals, and representation availability and loss;
* credits, steps and time per call.

Also give the per-arm lists and treatment − control within complete blocks. There is no significance claim, and no claim that GW2 improves agent performance unless the pre-registered block comparison supports it. P7 is historical, not a control. Include the T25 contamination caveat, which applies to both arms.

## H. Evaluation only, after a terminal stop

Run `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -EvaluateOnly`. It is refused unless the external ledger records `experiment-stopped`, and it takes no `-AuthorizationText`. It never runs `N next` or `N run`, never calls kane-cli, writes no approval or authorization and never sets `KANE_PAID_RUN_AUTH`. It:
1. checks the candidate worktree (fixed head, clean, no CRLF), that the record and run directories are outside both worktrees, and that no `EVALUATION.json` exists;
2. runs `N candidate-check`, `N ops-status` (the ledger must verify and record the stop) and `N verify` (the pre-registration and the integrity of every recorded transaction, failed ones included), which must name the same two commits as the script;
3. shows the stop, the failed calls and the operational status only;
4. opens the held-out evidence once, only when the operator types `EVALUATE`; anything else leaves it closed and changes nothing;
5. confirms that the number of `call-start` events is the same before and after, then packs the results as in §D.6.

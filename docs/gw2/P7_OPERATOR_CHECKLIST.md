# GW2 P7 operator execution checklist (PREPARED, NOT EXECUTED)

**Nothing in this file has been run against real Kane.** Each step that spends credits or changes the paid-call gate
needs the operator's explicit approval. If any check fails, stop. Re-running after results are seen is not allowed.

The pre-registration is in [`P7_PREREGISTRATION_DRAFT.md`](P7_PREREGISTRATION_DRAFT.md).

## A. Limits and cost basis

| Item | Value |
|---|---|
| Maximum authorized runs | **3** objective-mode calls (one per session), **0** retries, **0** follow-ups |
| CLI | `kane-cli` **0.10.4** (the gate refuses any other version) |
| Per call | `--max-steps 80 --timeout 2700`; process tree killed at 2730 s |
| Observed cost basis | GW1 blind review: 80 max steps, **72.4 credits** by balance delta (`evidence/gamewatch/review/ledger.ndjson`). KX1: 25 max steps, **40.1 credits**. Expect roughly 40–75 credits per call, so about **120–225 for 3 calls**. This is not a bound: V3 used 107.9 against an estimate of 80 |
| Gate formula | 80 × 3.1 = **248 credits per call**. This is the gate's worst-case local estimate, not a cap. Approval ceiling field 300 (as in GW1), so the gate needs a balance of at least **450 before each call** |
| Hard cap | **None.** kane-cli has no credit limit; a running call cannot be stopped at a credit amount |
| Accounting | Kept separately per session: credits (balance delta), steps (run_end), elapsed ms, timeout flag |

## B. Required permissions (operator)

1. Written authorization of P7.
2. An explicit, separately approved change of `PAID_RESEARCH_EXECUTION` in `server/balance/v4/kanebudget.ts` from `'disabled'` to `'per-run-approval'`, in its own commit. This is the only gate change, and **P6 did not make it**.
3. Three per-run approval records, `evidence/gw2/p7-pilot/exp/approvals/GW2-P7-pilot-<n>.json` (n = 1, 2, 3):
   ```json
   { "runId": "GW2-P7-pilot-1", "approvedBy": "<operator>", "approvedAt": "<ISO>", "maxCalls": 1, "maxSteps": 80, "ceilingCredits": 300, "acknowledgesNoHardCap": true }
   ```
4. Three SkillFlow authorization records, one before each session: `<state>/authorizations/kane-paid-<n>`.
5. `KANE_PAID_RUN_AUTH=GW2-P7-pilot-<n>` exported for the resume that runs session n. A different value refuses.

## C. Commands (from the repository root, Node ≥ 22.10, Python ≥ 3.9)

```sh
# 0. Integrity before anything (must all pass)
npm run gw2:verify
python3 gamewatch/vendor/verify.py
npm run test:gw2

# 1. Start the P7 book. It verifies procedures, partitions, leak-checks and declares 3 sessions,
#    then stops with exit 2 at investigate-1 (needs authorization). No Kane process has started.
S=evidence/gw2/p7-pilot/skillflow
python3 gamewatch/vendor/skillflow/runner.py run gamewatch/gw2/book-p7.json --state $S --workdir . \
  --var out=evidence/gw2/p7-pilot/verdicts --var exp=evidence/gw2/p7-pilot/exp \
  --var generation=evidence/gw2/procedures/generation-p7-1.json --var partition=evidence/gw2/procedures/partition-p7-1.json \
  --var bundle=evidence/gw2/p7-evidence/generated/bundle.json --var sessions=3 --var profiles=kane \
  --var run1=GW2-P7-pilot-1 --var run2=GW2-P7-pilot-2 --var run3=GW2-P7-pilot-3 --var at=<ISO, after session 3>

# 1b. Check the run's partitions are the committed, unopened P7 partitions (manifest hashes must be identical)
diff <(jq .manifests evidence/gw2/p7-evidence/partitions/PARTITION.json) <(jq .manifests evidence/gw2/p7-pilot/exp/partitions/PARTITION.json)

# 2. For n = 1, 2, 3 (one paid call each; check the balance before each and stop on any refusal)
kane-cli --version            # must print 0.10.4
kane-cli balance              # must be >= 450
#    write evidence/gw2/p7-pilot/exp/approvals/GW2-P7-pilot-n.json   (B.3)
touch $S/authorizations/kane-paid-n
KANE_PAID_RUN_AUTH=GW2-P7-pilot-n python3 gamewatch/vendor/skillflow/runner.py resume --state $S
#    after session 1 and 2 the runner stops again with exit 2 at the next investigate step.
#    After session 3 it continues: closure, import, freeze, representations seal, three-way, held-out,
#    discrimination, report, integrity, then @done (exit 0).

# 3. Afterwards
npm run gw2:verify
cat evidence/gw2/p7-pilot/exp/P6_REPORT.md         # per-session dimensions (the P6 report format)
cat evidence/gw2/p7-pilot/exp/kane-ledger.ndjson   # credits by balance delta per call
```

Note: the `--var at=` time is used for the freeze, seal and evaluation records. Set it to a time after session 3 ends. If you are unsure, resume with a corrected value only before the `freeze` step has run.

## D. Stop conditions (no re-run in any case)

* The gate refuses (exit 2 at an `investigate-n` step after authorization). Stop and record the refusal reason from `kane-ledger.ndjson`.
* `CEILING_EXCEEDED` or `SPEND_UNKNOWN` in the ledger. The gate then refuses further calls until an `operator-clear` entry exists. Decide before clearing.
* A session times out or has no `run_end` (exit 3). The book stops. The session is kept as inconclusive and is not repeated.
* Any verification failure: leak check, manifests, closure, freeze, seal or ledger.
* Any result has been read. No further session may be started after that.

## E. What to report

Report all three sessions, including failures, with the separated dimensions of the pre-registration §3, the contamination caveat (T25), and the statement that this is exploratory and not an architecture comparison.

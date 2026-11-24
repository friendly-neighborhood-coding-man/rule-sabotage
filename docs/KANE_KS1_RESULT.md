# Kane KS1 single shadow call: result

Status: **READY_FOR_OPERATOR_KANE_KS1_RESULT_REVIEW**

| | |
|---|---|
| Run | `KS1-v6.1-oa-v3-96001-t8`, one analyzer-only call, run manually by the account owner on 2026-11-24 16:24–16:26 UTC (attempt 2) |
| Case | V6.1, oa-v3 self-play, seed 96001, turn 8: "Send home" on A1, A2, B1 (no participant data) |
| Engine decision (unchanged) | **unverified**, tier 3, "a new cell could not be entered in the trial"; not placed |
| Kane result | **all six conditions true** (`run_end` status passed, 6/6 boolean results, exit code 0, no timeout) |
| Classification | **`engine-unverified-kane-approved`** (a disagreement) |
| Credits | **9.097** (balance before minus balance after; absolute balances redacted, see `evidence/v6/kane-preflight/CORRECTION_RECORD.json`); Kane's own `run_end` reports 9.0968. WITHIN the 30-credit operating ceiling, which is not a hard limit |
| Time | 81.6 s for the call (run_end after 80.3 s); Chrome showed the page in 0.9 s |
| Process | exited normally with code 0; the 210 s process-tree kill was not needed |
| Gate | restored to `disabled` immediately after; token cleared; gate file identical to the commit (script's final checks all True) |

## What the result means, and what it does not

Kane read the trial page and judged each of the six fixed conditions true (its reasons, verbatim in `meta.json`:
"Checking paired Symmetry-table outcomes … PASS", "second-visit results … PASS", "chain-reaction report … PASS",
"softlock rollout … PASS", "placement cells with the per-turn limit … PASS", "non-permanent, non-one-sided, non-decisive
… PASS").

This is **not** a safety pass. The trial entered only 2 of the 3 proposed cells; **A1 was never entered**, and the six
fixed conditions do not ask whether every cell has a scenario. Kane judged the page as it is, and the page is incomplete.
So the disagreement says the fixed conditions cannot see incomplete trial coverage, not that the effect is safe or
executable. Nothing was placed, no live referee or gameplay changed, and the result must not be used to activate effects.

## Attempt history

1. **Attempt 1, 2026-11-22 18:35 UTC: refused by the gate before any Kane run** (version check; 0 credits). The runner did
   not then record why; its exit code was wrongly 0. Evidence kept unchanged in `attempt-1-refused-2026-11-22/`. The runner
   was fixed (checks logged, 60 s per check, exit 2 on refusal) and attempt 2 was approved by the owner on 2026-11-24
   16:23:57 UTC. In attempt 2 the version check took 7.7 s, so a 20 s limit under heavy load is a plausible cause of the
   attempt-1 refusal, but it is not proven.
2. **Attempt 2: the one Kane call**, above.

## Observations for review

* Kane's stream reported `recording_state: enabled: true, persist: false` with a session id: the CLI recorded the
  session but did not persist it (analyzer mode, "nothing saved").
* The CLI announced an update (0.10.4 → 0.10.9); it was not installed.
* Metering was consistent: balance delta 9.097 vs `credits_consumed` 9.0968.

## Evidence (`evidence/v6/kane-preflight/`)

`ledger.ndjson` (call-start, call-end with before/after/used), `preflight-checks.ndjson` (version and both balance reads,
verbatim), `run/KS1-v6.1-oa-v3-96001-t8/` (`args.json`, raw `stdout.ndjson` and `stderr.txt`, `meta.json` with condition
reasons, coverage and interpretation), `shadow/` (case and the structured Kane verdict), `approval.json` (attempt 2),
`ks1-console.log`, `attempt-1-refused-2026-11-22/`. The case files are unchanged (manifest hashes verified by the run).

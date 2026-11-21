# Kane single-call shadow experiment: preflight package

Status: **READY_FOR_OPERATOR_KANE_SINGLE_CALL_PREFLIGHT** · Kane has NOT been invoked. No kane-cli command of any kind
(not even `--version` or `balance`) was run while preparing this; only the binary's presence on PATH was checked.

Operator decision D1 (2026-11-21): prepare ONE call on ONE historical AI self-play tier-3 case; live execution not yet
authorized.

## 1. The case

| | |
|---|---|
| Source | V6.1 AI self-play, the existing smoke game **oa-v3 vs oa-v3, seed 96001, AI first** (replayed deterministically) |
| Turn / side | turn 8, the policy playing the "human" side (no human participant data anywhere) |
| Proposal | "Send home" on **A1, A2, B1** (typed effect `home`, cells `0,0` `0,1` `1,0`) |
| Engine decision (preserved) | **unverified, tier 3**: "a new cell could not be entered in the trial", not placed |
| Why this case | its reason class covers 81% (50 of 62) of V6.1 non-placements. A1 is a corner whose only two neighbours (A2, B1) are cells of the same placement, so the trial shows symmetry rows for 2 of the 3 cells |
| Question for Kane | the 6 fixed conditions do not require a row for every cell; Kane may well approve. That would be recorded as `engine-unverified-kane-approved` (a missed opportunity, never a placement) |

Files, all built by `npm run kane:preflight-case` (which fails unless the replayed verdict equals the recorded one) and
hashed in `manifest.json`: `evidence/v6/kane-preflight/` → `state-before.json`, `engine-verdict.json`, `trial-page.html`
(exactly what Kane would see), `case.json` (shadow case, engine decision unchanged), `conditions.json` (the 6 fixed
conditions, `kane-conditions-v4.1`), `plan.json`.

## 2. Exact invocation (analyzer mode)

The saved trial page is served from a local loopback HTTP server and opened in a local headless Chrome; then exactly one:

```
kane-cli run --analyzer-only --agent --cdp-endpoint http://127.0.0.1:<port> --timeout 180 \
  --condition "<condition 1>" … --condition "<condition 6>"
```

Not used: the production referee path (`server/kane.ts` `kaneJudge`, its cache, the game servers). The runner is
`scripts/kane-single-call.ts`; it goes through the existing paid-call gate `server/balance/v4/kanebudget.ts`.

## 3. Budget assumptions (NOT a hard limit)

* **Operating ceiling: 30 credits. This is a local estimate, not a spending limit.** kane-cli offers no provider-side or
  CLI credit cap; a call can consume more than estimated before it returns (V3: **107.934 credits against an 80-credit
  ceiling**).
* Gate estimate: 9 steps × 3.1 credits/step = 27.9 ≤ 30. The 3.1/step figure was measured in OBJECTIVE mode; this call is
  ANALYZER mode, which takes no `--max-steps` in our usage, so the step figure is only the gate's formula, not a bound.
* Historical analyzer calls (kane-cli 0.10.4): **5.125 credits** (2 conditions), **9.119 credits** (9 conditions), two V1
  calls 11.841 together. Expected for 6 conditions: roughly 6–10 credits. Unknown whether the current CLI version or
  pricing differ.
* The gate refuses unless the balance read before the call is ≥ 1.5 × ceiling (45 credits).
* `--timeout 180` and a hard process kill at 210 s bound wall time only. **A timeout is not a credit limit.**

## 4. Stop conditions

1. Exactly one kane-cli `run` process: no retries on any failure, timeout or unparsable output; no second call, no
   follow-up, nothing in parallel. The ledger locks the run id when the call starts.
2. Refused before any process starts if: execution disabled in code; no approval, or approval not for exactly one call,
   or not acknowledging that the ceiling is not a hard cap; `KANE_PAID_RUN_AUTH` ≠ run id; run id already used; an earlier
   CEILING_EXCEEDED / SPEND_UNKNOWN not cleared by the operator; the CLI is not the real CLI; balance unreadable; balance
   below 45; estimate above 30.
3. After the call the balance is read again: used > 30 → **CEILING_EXCEEDED**; unreadable → **SPEND_UNKNOWN**. Either blocks
   every further paid call until the operator clears it.
4. The only output is one appended line in `evidence/v6/kane-preflight/kane-verdict.ndjson` plus the ledger. The engine
   decision, the game and every referee are untouched; Kane gets no authority.

## 5. Final preflight checklist (to do WITH the operator, immediately before an authorized call)

| Check | How | Status |
|---|---|---|
| kane-cli present | `where kane-cli` | done: `D:\Tools\npm-global\kane-cli(.cmd)` |
| CLI version | `kane-cli --version` (last known 0.10.4) | **pending: not run (no Kane invocation authorized)** |
| Logged in | `kane-cli whoami` | pending |
| Account balance | `kane-cli balance` (must be ≥ 45) | pending |
| Analyzer flags | `kane-cli run --help`: confirm `--analyzer-only`, `--timeout`, whether any step or credit limit applies to analyzer mode | pending |
| Metering | confirm the balance changes per call and whether `run_end` reports credits, to record both | pending |
| Chrome | `KANE_CHROME` set to a local Chrome/Chromium | pending |
| Code change | set `PAID_RESEARCH_EXECUTION = 'per-run-approval'` for this run only, in a reviewed commit | pending |
| Approval file | `evidence/v6/kane-preflight/approval.json`: runId `KS1-v6.1-oa-v3-96001-t8`, maxCalls 1, ceilingCredits 30, acknowledgesNoHardCap true | pending |
| Dry run | `npm run kane:single-call` shows the plan and verifies the case hashes | done (no Kane) |

If the balance cannot be read before and after, or the CLI version changed in a way that alters metering, the experiment
stays **BLOCKED**.

## 6. Consent note

This case contains no participant data. Any later case derived from a human participant needs explicit consent covering
transmission to an external reviewer first (the V6 consent text currently promises the reviewer is not run).

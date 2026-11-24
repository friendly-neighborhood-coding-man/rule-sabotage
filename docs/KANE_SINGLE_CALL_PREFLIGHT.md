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
| kane-cli present | `where kane-cli` | done: `<npm-global>/kane-cli(.cmd)` |
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

---

# Update: metadata inspection and runner repairs (operator verdict on PR #18)

Status: **READY_FOR_OPERATOR_KANE_FINAL_EXECUTION_DECISION** · Verdict on the single paid call: **READY, pending the
operator's explicit execution authorization** (details below). No paid call, no `kane-cli run` of any kind, gate still
disabled, no approval file, no run token.

## A. Kane environment (read-only commands only, `evidence/v6/kane-preflight/environment.json`)

Only the four authorized commands were run: `kane-cli --version`, `kane-cli whoami`, `kane-cli balance`, `kane-cli run --help`.

| | |
|---|---|
| CLI | **0.10.4** (`<npm-global>/kane-cli.cmd`). 0.10.7 is available and was **not** installed; the runner now accepts exactly 0.10.4 and refuses any other version, because the version/balance/run_end formats were verified on 0.10.4 only |
| Login | authenticated, environment prod, OAuth, token valid (identity not recorded) |
| Balance | readable and far above the 45-credit minimum (absolute value redacted; line format `Available credits: <number>`) |
| Analyzer mode | `--analyzer-only`: judges each `--condition` against the current page, verdicts on `run_end`, no objective, no actions, nothing saved, agent mode only; `--condition` repeatable, order preserved |
| Time limit | `--timeout <seconds>` |
| Step limit | `--max-steps <n>` (default 50) bounds agent steps of objective runs; an analyzer-only run takes no actions and the runner passes no `--max-steps` |
| Credit / spending limit | **none exists** in kane-cli 0.10.4. Spend is measurable only as the balance before minus after |
| Context files | global `~/.testmuai/kaneai/global-memory.md` absent; repo `.testmuai/context.md` absent (nothing extra is injected) |

## B. Runner repairs (`scripts/kane-single-call.ts`)

1. **Process-tree termination**: kane-cli runs through `runCapture` from `server/kane.ts` (the proven path: `.cmd` shim via the
   shell, `taskkill /pid … /T /F` on Windows at the hard timeout). Chrome is also terminated as a tree. Only these generic
   helpers are imported; no `kaneJudge`, no referee cache, no game server.
2. **Strict, version-aware balance**: exactly one `Available credits: <number>` line (ANSI codes and update notices ignored),
   only for CLI 0.10.4; zero or several matches, another version, or a negative/non-finite number → unreadable → the gate
   refuses before the call (or records SPEND_UNKNOWN after it, which blocks further calls).
3. **CDP readiness**: no fixed sleep. Chrome is started on a free port and the runner polls `/json/list` until the trial
   page itself is listed (max 15 s). This happens before the gate: if Chrome is not ready, nothing is called and nothing is
   written to the ledger.
4. **Structured result**: `parseKaneOutput` from `server/kane.ts` reads `run_end` and requires exactly one boolean per
   condition (6). Complete → approved / rejected; missing run_end, wrong count or non-boolean → `unverified` (inconclusive);
   timeout or crash without run_end → `error` (inconclusive). The verdict is appended to the shadow log
   (`evidence/v6/kane-preflight/shadow/`) with its disagreement type; stdout and stderr are kept verbatim in
   `run/<runId>/`, with `args.json` and `meta.json` (timings, spend, coverage, interpretation).
5. **Arguments**: `run --analyzer-only --agent --cdp-endpoint http://127.0.0.1:<port> --timeout 180 --condition … (6)`. The
   9-step estimate (27.9 credits) is the gate's formula only and **is not enforced** by this invocation; **30 credits is not
   a hard cap**.
6. **Verified with a test double** (`tests/kane-single-call.test.ts`, `tests/fixtures/fake-kane-ks1.mjs`, real local Chrome,
   no real Kane): one call with strict balances and a complete run_end → `approved`, disagreement
   `engine-unverified-kane-approved`, raw output and meta kept, engine verdict unchanged; the same run id again → refused,
   nothing started; incomplete results → inconclusive; garbage output → error/inconclusive; unclear balance, CLI 0.10.7,
   balance below 45 → refused before any run; a 41-credit spend → CEILING_EXCEEDED and the next run id refused; a hanging
   "Kane" behind a `.cmd` shim → whole process tree gone after the hard timeout; the CLI entry point with `--execute`
   refuses before launching anything (not even the double).

7. **Cleanup can no longer hide a result** (found by the full test run under load): Chrome's temporary profile could still
   be locked when the runner removed it, and the exception, raised in the cleanup after the paid call, would have hidden
   the recorded spend and verdict. Cleanup now waits for Chrome's process tree to exit and removes the profile
   best-effort, never throwing.

8. **A failed process is never authoritative** (operator correction before the manual run): a timeout or a non-zero
   kane-cli exit code always yields status `error` (inconclusive), even if a complete all-boolean `run_end` was printed;
   the raw condition results are kept in the verdict and in `stdout.ndjson` as evidence only. Regression test:
   complete run_end followed by exit 1, and complete run_end followed by a hang until the hard timeout.

## C. Scientific interpretation (fixed in the plan and in every result record)

The case is suitable for studying incomplete referee evidence. If Kane approves the six fixed conditions, the result is a
**disagreement** with the engine's unverified verdict, **not** evidence that the effect is safe or executable: the trial
entered only 2 of the 3 cells (A1 was never entered). The six-condition protocol is unchanged; the coverage limitation
(`cellsProposed 3, cellsWithEntryScenario 2`) is recorded separately with the result.

## D. Remaining financial exposure

* One analyzer-only call. Historical analyzer calls cost 5.1–9.1 credits; expected here roughly 6–10.
* **No enforced credit bound.** The only bounds are time (180 s CLI timeout, 210 s process-tree kill) and the single-call
  rule. The local estimate is 27.9 against a 30-credit operating ceiling; an overrun is possible and would be recorded as
  CEILING_EXCEEDED, as the earlier objective-mode call showed (107.934 against 80).
* The balance is far above the requirement (absolute value redacted), so the call cannot fail for lack of credit; the gate's ≥ 45 rule is met.

## E. What the final execution needs (operator actions)

1. Authorize the one call explicitly.
2. A reviewed one-line commit setting `PAID_RESEARCH_EXECUTION = 'per-run-approval'` for this run.
3. `evidence/v6/kane-preflight/approval.json`: runId `KS1-v6.1-oa-v3-96001-t8`, maxCalls 1, maxSteps 9, ceilingCredits 30,
   acknowledgesNoHardCap true, approvedBy / approvedAt.
4. `KANE_PAID_RUN_AUTH=KS1-v6.1-oa-v3-96001-t8`, then `npm run kane:single-call -- --execute` once.
5. Afterwards: the gate is set back to `'disabled'` in a follow-up commit.

**Verdict: READY** (all technical blockers from the PR #18 review are repaired and verified with a test double). It
becomes BLOCKED again if the CLI version changes, the balance line format changes, or Chrome cannot show the page.

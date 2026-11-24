# Post-KS1: evidence audit, trial coverage, Kane isolation, pilot

Status: **READY_FOR_OPERATOR_POST_KS1_REVIEW** · No Kane call, no live-referee change, no gameplay change, no history
rewrite, no merge. Operator verdict (2026-11-24): KS1 accepted as an operational end-to-end result, not as safety evidence.

## 1. Public evidence audit (the repository is PUBLIC)

Audited: every file published under `evidence/v6/kane-preflight/` at commit `240b2bb`, plus the KS1/preflight docs.

| Finding | Where | Risk | Proposal |
|---|---|---|---|
| Credentials, API keys, OAuth tokens | none found | – | – |
| Participant details | none (KS1 is AI self-play) | – | – |
| Kane recording **session id** | `run/…/stdout.ndjson` (`recording_state`) | account-side identifier | redact |
| Local process id | `run/…/stdout.ndjson` (`stream_start.pid`) | none, no value | redact |
| Absolute local paths (checkout, temp profile, npm tools, Chrome) | `ks1-console.log`, `meta.json`, `shadow/kane.ndjson`, `environment.json`, attempt-1 console log | reveals local layout | replace by `<repo>/`, `<local-temp>/`, `<npm-global>/`, `<chrome>` |
| Internal project message id | both `approval.json` files | internal identifier | replace by "operator authorization in the private project thread" (time kept) |
| Account login metadata (environment, auth method, token status) | `environment.json` | unneeded account metadata | keep only `authenticated: true` |
| Absolute credit balances | ledger, preflight checks, console logs, docs, PR #19 text | account metadata | **optional, operator choice**: publish only the delta (9.097) |
| Not changed | loopback port (127.0.0.1, ephemeral), Kane `run_id` "run-0", operator first name as approver (already the public PR attribution), timestamps | none | keep |
| Docs | `docs/KANE_SINGLE_CALL_PREFLIGHT.md` (tool path, balance), `docs/KANE_KS1_RESULT.md` (balances), PR #19 description (balance) | as above | same replacements |

**Applied (operator verdict 2026-11-24, PR #20 accepted)** with `npm run evidence:redact-ks1 -- --apply --private <dir>`:
* **Originals preserved privately**: all 22 files copied byte-for-byte to a private directory on the operator's machine,
  outside the repository (path deliberately not published), with `ORIGINALS_SHA256.json`. Before redacting, every
  published file was checked against that manifest.
* **Published files replaced in a normal, visible commit**: 10 files redacted in place, now including the absolute
  balances (JSON fields and captured CLI text). The credit consumption is kept: ledger `used` 9.097 and Kane's
  `credits_consumed` 9.0968; their consistency (difference 0.0002) was checked on the originals and is recorded.
* **Correction record**: `evidence/v6/kane-preflight/CORRECTION_RECORD.json`: per file the original and published SHA-256,
  every rule with its reason and count, what was kept, the metering check and the provenance commit. The earlier proposal
  folder was removed, being superseded by the applied record.
* **Docs**: the same replacements in `docs/KANE_SINGLE_CALL_PREFLIGHT.md`, `docs/KANE_KS1_RESULT.md` and the PR #19
  description.
* **Git history not rewritten, no force-push**: the unredacted originals stay reachable at commit `240b2bb` and earlier.
* **Not changed**: older research reports that already published account balances before this workstream
  (`docs/BALANCE_LOOP_RESULT.md`, `docs/BALANCE_V2_KANE_RESULT.md`, `docs/BALANCE_V3_VALIDATION_RESULT.md`,
  `docs/EVIDENCE.md`); they are historical V1–V3 records and are left for a separate operator decision.

## 2. Trial coverage completeness

`server/v6/coverage.ts`, a separate experimental step (no referee decision changes):

* **Rule**: every proposed cell needs at least one entry scenario; entry-relative effects (shove back/forward) need one per
  in-board entry side. Missing scenarios → **INCOMPLETE_EVIDENCE**, regardless of any condition results. Missing coverage
  is recorded as missing evidence, never as proof that the effect is unsafe.
* **KS1 regression fixture**: the trial rebuilt from the saved position reproduces the recorded decision (unverified,
  tier 3); its symmetry table covers A2 and B1 only → **INCOMPLETE_EVIDENCE, missing A1**.
* **Why A1 was not entered**: the trial enters a cell from the first neighbour (left, right, up, down) that is inside the
  board and holds **no effect after the placement**. A1 is a corner; its only in-board neighbours, B1 and A2, are cells
  of the same placement, so no neighbour qualified and the trial skipped A1 silently.
* **Proposed deterministic fix (validated, not adopted)**: if no effect-free neighbour exists, enter from the first in-board
  neighbour in the same order after removing ("pre-burning") that neighbour's effect in the sandbox copy only, then run the
  frozen trial's own `enter()` and `sameOutcome()`. For KS1: A1 entered from B1 (B1 pre-burned), moving left: Human and AI
  outcomes identical ("own start square"), fires once, no second firing. Semantics check: where the trial could enter
  (A2, B1) the generator reproduces the original rows exactly (same neighbour, direction and outcomes), and the input
  state is never modified.
* **Additional finding**: the current trial enters every cell from one side only, so an entry-relative shove can never
  have complete coverage under this rule (a test documents it). Generating the other sides is the natural next step.

The fix is not wired into any referee: adopting it would change which placements reach tier 1/2, i.e. gameplay, and needs
its own decision. Historical decisions are unchanged (tested).

## 3. Kane kept isolated; four things recorded separately

`evidence/v6/ks1-evaluation/ks1-evaluation-record.json` (new file; KS1 originals untouched), from `npm run ks1:coverage`:

| Record | KS1 |
|---|---|
| Condition satisfaction (`kane-conditions-v4.1`, unchanged) | 6 / 6 true |
| Trial coverage | INCOMPLETE_EVIDENCE (A1 missing) |
| Referee decision (engine-only, unchanged) | unverified, tier 3, not placed |
| Independent safety / correctness evidence | NONE |
| Supplementary scenario (proposal only) | A1 via pre-burned B1: symmetric, fires once |
| **Overall** | **INCOMPLETE_EVIDENCE** |

No Kane call was made; Kane is not a live referee; the six-condition protocol was not changed.

## 4. Human pilot (V6.1, referee-aware opponents)

* Defaults unchanged: V6.1 (rule A2), opponents `v6-ev-k1.2-ra@1`, `v6-softmax-v2-ra@1`, `v6-oa-v3-ra@1`.
* **Kane evaluation data is now separate from pilot telemetry**: shadow cases go to `playtest-data/v6-kane-shadow/<session>/`
  (gitignored; `V6_KANE_SHADOW_DIR` overrides), no longer inside the pilot data directory `playtest-data/v6/`. The pilot
  summary reads only pilot telemetry and answers; withdrawal still deletes the session's shadow cases too.
* Running a pilot session: `npm run play:v6` → http://127.0.0.1:3106, consent screen, play, questionnaire after each game.
  Afterwards `npm run v6:pilot-summary` reports, per opponent, game length, AI effect non-placement rate, AI latency,
  distinct openings, zero-move turns (facts), and the questionnaire answers incl. enjoyment (separately). No human data
  exists yet and none is invented; no gameplay change is proposed before that data exists.

## 5. Tests

`tests/post-ks1.test.ts` (6): KS1 coverage and evaluation record, the A1 neighbour cause, the supplementary scenario,
reproduction of the original rows, coverage rules incl. entry-relative sides, and the redaction proposal (narrow rules,
published files match the applied correction record, no sensitive values left, consumption kept). `tests/v6-2.test.ts` updated for the separate shadow directory.

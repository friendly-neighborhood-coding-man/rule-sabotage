# GW2 Phase 1 report: hybrid investigation policy and server-side access evidence

**Final status: `PHASE_1_READY_FOR_REVIEW`**

Prepared 2026-11-25 by Claude Code in a cloud clone. Zero paid Kane calls, zero runtime inference calls, no gate
change, no frozen GW1 file changed, no change to `server/v6/**` or the vendored SkillFlow runner. Nothing from P2
onward is implemented. Nothing here claims that mandatory coverage improves defect detection or comprehension.

## 1. Q1 and Q2

* **Q1 (YES):** `45959318` and `46ee7e6` were cherry-picked, in order, unchanged, onto `claude/gw2-p1` as `3c89568`
  and `063db00` (`git cherry-pick -x`). Blob ids equal the historical ones: `visit-coverage.mjs` `f7ccc0a5…`,
  `docs/GW1_VISIT_COVERAGE.md` `cdd30fd0…` (DECISIONS D15). GW2 runs the tool as a subprocess and parses its output.
* **Q2 (YES):** access logging is on by default in the GW2 review server and can be turned off explicitly; the GW1
  server is unchanged (D16, D17).

## 2. Repository, branch and commit state

| Ref | Commit | Note |
|---|---|---|
| `claude/project-thread-1a20hc` (GW1 submission, PR #21) | `d22d33ee…` | not touched |
| `followup/gw1-visit-coverage` | `46ee7e6b…` | not touched; its 2 commits imported |
| `claude/gw2-phase-0` (PR #22, draft, unmerged) | `af8b345c…` | reviewed P0 head; not touched |
| `claude/gw2-p1` (**new**) | from `af8b345c` | `3c89568`, `063db00` (imports), `06250b4` (P1), then this report fix-up; draft PR #23 targets `claude/gw2-phase-0` |

## 3. Architecture changes

All new files; the only edited existing file is `package.json` (new `test:gw2`, `gw2:*` scripts).

| File | Role |
|---|---|
| `gamewatch/gw2/journal.ts` | `gamewatch/gw2-access@1` writer and reader/validator |
| `gamewatch/gw2/serve.ts` | GW2 review server: GW1 page/form behaviour (imports `resolvePage`) + journal, on by default |
| `gamewatch/gw2/session.ts` | joins session.json, notes and journal; served-evidence index |
| `gamewatch/gw2/inventory.ts` | evidence/rule inventory from a bundle; exact identifier citations |
| `gamewatch/gw2/policy.ts` | `gamewatch/gw2-policy@1` validator and completeness evaluator (CLI) |
| `gamewatch/gw2/coverage.ts` | verdict-time coverage for GW2 sessions and the GW1 replay (CLI) |
| `gamewatch/gw2/paths.ts` | output guard: only `evidence/gw2/` or an explicit outside-repo workspace; frozen patterns read from the manifest |
| `gamewatch/gw2/demo-session.ts` | example test-double session with mixed mandatory/optional evidence |
| `scripts/gw2-frozen-inventory.mjs` | read-only disk walk of frozen paths, including git-ignored files |
| `tests/gw2-access.test.ts`, `tests/gw2-policy.test.ts`, `tests/gw2-compat.test.ts`, `tests/gw2-fixtures.ts` | deterministic tests (25) |
| `evidence/gw2/gw1-replay/` | historical GW1 replay output (`coverage.json`, `COVERAGE.md`) |
| `evidence/gw2/p1-demo/` | demo session output (policy, session files, completeness, coverage) |

Unchanged on purpose: `gamewatch/kane/serve.ts`, `steps/audit.ts`, `dashboard.ts`, `kane/plan.ts`, the imported
`visit-coverage.mjs`, `scripts/gw2-baseline.mjs` and `BASELINE_MANIFEST.json`.

## 4. Access journal: semantics and limits

**Location.** `<out>/sessions/<session>/access.ndjson`, with `session.json` (logging on/off, journal schema, nonce
SHA-256, label) and `notes.ndjson`. `<out>` defaults to `evidence/gw2/<exp>/`.

**Record.** Each line: `schema` (`gamewatch/gw2-access@1`), `exp`, `session` (16 hex, server-generated, never sent to
the client, not the nonce), `seq` (0, 1, 2 … per session), `at` (UTC, informational), `prev` (SHA-256 of the previous
line), `type`:

| type | fields |
|---|---|
| `session-start` | `site.files` (SHA-256 of every page at start), `notes`, `server` |
| `request` | `method`, `path` (canonical page name; `null` for a rejected path), `kind` (`evidence`, `index`, `report-form`, `other`, `rejected`, `post`), `evidenceId`, `status`, `outcome` (`completed`/`aborted`), `bytes` (body bytes written; 0 for HEAD; `null` if aborted), `sha256` (served body; only for a completed 200 GET), `client` (12-hex hash of the User-Agent) |
| `finding` | `noteIndex`, `noteSha256`, `nonceValid` (form body, nonce and text never copied) |
| `journal-gap` | `lost`, `error` (code only): events that could not be written before this line |
| `session-end` | `events`, `failures` |

**Served evidence** (the only thing that counts as access): GET, 200, `completed`, non-empty, content hash equal to
the start-of-session page hash. Failed, aborted, HEAD, unrelated, rejected and wrong-method requests are journalled
and never count. Duplicates are journalled and counted once.

**Ordering.** "Before a finding" means `seq(request) < seq(finding)`, both assigned by the server. Timestamps are
never used for that decision.

**Journal states** (`readJournal`): `valid`; `incomplete` (intact chain but a `journal-gap` or no `session-end`:
records present are usable, absence proves nothing); `invalid` (unparsable line, wrong schema/exp/session, seq or
chain break, line after `session-end`, partial last line: nothing in it is used); `unavailable` (logging disabled, or
file missing). Attribution: `single-client`, `uncertain` (more than one client hash), `none`.

**Integrity, exactly.** Detects edits, deletions, insertions, reordering, foreign-session lines and truncation. Does
**not** prevent anything: anyone with write access to the file can rewrite a consistent chain. No signature, no
external timestamp, no OS isolation. The agent cannot write journal lines through the form: only allow-listed form
fields reach the notes file, and the journal records only a hash of the stored note.

**What a record means.** The server finished writing the response to the socket. It does not show that the client
received it, rendered it, or that the agent read or understood it.

**Limits.** Browser caching (mitigated by `cache-control: no-store`, not eliminated), prefetching and automated
requests are recorded like any other request; a second program on the same machine can make requests (seen only as a
second client hash, if its User-Agent differs); a write failure loses the event (surfaced as `journal-gap`, a stderr
line and `failures` in `session-end`). A POST body over 64 kB is dropped without a journal line (GW1 behaviour).

## 5. Policy evaluation semantics

`gamewatch/gw2-policy@1`: `{ schema, id, requirements: [{ id, kind, targets, reason }] }`. Unknown fields, bad ids,
duplicate ids or targets, empty targets, missing reasons, unknown kinds and unknown or wrongly typed targets are all
rejected with every problem listed (`PolicyError`).

| kind | targets | satisfied | unsatisfied | not-evaluable |
|---|---|---|---|---|
| `must-access` | evidence ids | every target served to this session | journal valid, single client, a target never served | journal unavailable / invalid / attribution uncertain; or incomplete and a target unrecorded |
| `must-cite` | evidence or rule ids | every target cited (exact id) by a counted finding | some target not cited | – |
| `must-evaluate` | rule ids | never in P1 | never in P1 | always: the verifier is P4 |

Overall: `not-declared` (empty), `complete`, `incomplete`, `undetermined`. The output keeps five separate parts:
`findings` (verbatim), `investigationCompleteness`, `accessCoverage`, `citationCoverage`, `evaluationAvailability`.
A counted finding has a valid nonce, this session's id, and (with a usable journal) a matching journal event; an
edited note is reported verbatim but not counted. Agent summaries are never read. No implicit "visit everything"
requirement exists.

## 6. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC-P1.1 exactly the requested pages and the form, in order, with the session | **PASS** | `tests/gw2-access.test.ts` "AC-P1.1 + default logging" |
| AC-P1.2 logging changes no response body (all 56 GW1 pages, scratch copy) | **PASS** | `tests/gw2-compat.test.ts` "AC-P1.2"; GW1 server vs GW2 on vs GW2 off; only `report.html`'s per-session nonce normalised |
| AC-P1.3 empty policy → `not-declared` | **PASS** | `tests/gw2-policy.test.ts` "AC-P1.3" |
| AC-P1.4 must-access unsatisfied with one, satisfied with both; finding unchanged | **PASS** | `tests/gw2-policy.test.ts` "AC-P1.4" |
| AC-P1.5 cited-without-access flagged; GW1 fixture reproduces the follow-up; states there is no GW1 server log | **PASS** | `tests/gw2-compat.test.ts` "AC-P1.5"; `tests/gw2-policy.test.ts` "verdict-time coverage" |
| AC-P1.6 completeness never reads `run_end.summary` or agent summaries | **PASS** | `tests/gw2-policy.test.ts` "AC-P1.6" (behavioural + source scan) |
| AC-P1.7 `npm test` passes except baseline failures; baseline verify 0 | **PASS** | §7 |

## 7. Tests and baseline comparison

All runs in this cloud clone (Node 22.23.5, Linux). Deterministic HTTP test doubles only.

| Suite | Phase 0 baseline (`d22d33e`) | Phase 1 (`claude/gw2-p1`) |
|---|---|---|
| `npm test` (`tests/*.test.ts`) | 232 tests: 226 pass, 0 fail, **5 cancelled**, 1 skipped | 257 tests: **251 pass, 0 fail, 5 cancelled, 1 skipped** |
| new GW2 tests (`tests/gw2-*.test.ts`) | – | 25 / 25 pass (included in the 257) |
| `npm run test:gw2` (GW2 tests + `gamewatch/kane/serve.test.ts`) | serve.test 2/2 | 27 / 27 pass |
| `python gamewatch/vendor/verify.py` | OK | OK |

The 5 cancellations are the same 5 tests of `tests/playtest-referee.test.ts` as in Phase 0 (`Promise resolution is
still pending but the event loop has already resolved`). They are **not** counted as passes, and the suite exits 1
because of them, exactly as at the baseline. The skip is the same Windows-only `.cmd` shim test. **No new failure,
cancellation or skip.** The difference in totals (+25) is exactly the new GW2 tests. Not repaired (outside P1).

Cases covered (test name → file): default logging, AC-P1.1 (access); request classes incl. 404/HEAD/unrelated/
rejected/405 (access); aborted response (access, deterministic: the client is destroyed before the server answers);
duplicates counted once (access); session separation incl. foreign nonce and foreign journal lines (access); form
cannot write the journal, no nonce/claim/User-Agent in the journal (access); explicit disablement → unavailable
(access, policy); write failures → journal-gap / no session-end → incomplete (access); edited, deleted, reordered,
bad-schema and partial-line journals → invalid (access); empty, satisfied, unsatisfied, partially unevaluable and
malformed policies, unknown evidence and rule ids (policy); exact identifier matching (policy); attribution uncertain
(policy); citations preceding access, no retroactive credit (policy); anomaly finding unchanged under incomplete
coverage (policy, AC-P1.4); agent summaries never used (policy, AC-P1.6); edited note not counted (policy); 56-page
compatibility (compat, AC-P1.2); frozen directory protection incl. CLIs (compat); disk inventory sees ignored files
(compat); historical GW1 replay (compat, AC-P1.5); baseline and inventory verify (compat, AC-P1.7).

## 8. Historical GW1 reconstruction

`evidence/gw2/gw1-replay/COVERAGE.md` (`coverage.json`), produced by
`node --experimental-strip-types --no-warnings gamewatch/gw2/coverage.ts gw1 evidence/gamewatch/evidence.json evidence/gamewatch/site/index.html evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson evidence/gamewatch/review/notes.ndjson evidence/gw2/gw1-replay`:

| Column | Category | Reconstructed visits (cases / matches) | Cited without recorded visit |
|---|---|---|---|
| Finding 1, 18:53:13.663Z | clean / no problem found | **2/22 / 0/32** | **C-9fc650** (first recorded visit 18:53:42.573Z, step 13) |
| Finding 2, 18:54:12.815Z | confirmed observable anomaly | 3/22 / 0/32 | – |
| Finding 3, 18:54:34.743Z | confirmed observable anomaly | 3/22 / 0/32 | – |
| Run end, 18:55:15.237Z | – | **3/22 / 0/32** | – |

Server access is `unavailable` for every item, with the statement: *No server-side access journal exists for GW1 …
No server access record has been, or can be, reconstructed for GW1.* GW1 ordering uses wall-clock times (note time
and Kane's step log), because no sequence numbers exist; the report says so. Findings are quoted verbatim.

## 9. Frozen artifact verification

* `node scripts/gw2-baseline.mjs verify`: 135 frozen files match `d22d33e`; reference-tier differences are exactly the
  9 added files (`gamewatch/gw2/*.ts` ×8 and the imported `visit-coverage.mjs`). No GW1 reference file changed.
* `node scripts/gw2-frozen-inventory.mjs`: 135 files on disk under frozen paths, all in the baseline, including
  git-ignored files.
* The manifest was not regenerated. No historical generator (`dashboard.ts`, `plan.ts`, `run-evidence.ts`) was run in
  this phase; the 56-page compatibility check served a scratch copy.

## 10. Limitations and open questions

* Integrity is tamper-evident, not tamper-proof (§4). Attribution rests on a User-Agent hash; a second client with the
  same User-Agent is indistinguishable.
* "Served" ≠ received, rendered, read or understood. P1 measures nothing about comprehension or detection.
* The GW1 replay depends on Kane's model-written step remarks (secondary signal, inherited from the follow-up).
* Reconstruction for GW2 sessions (`--kane-stdout`) maps the follow-up's columns to findings by time order; it is
  implemented but only exercised on GW1 data.
* Open for the operator: **Q12** should `attribution: uncertain` also cover a single client whose requests include
  prefetches (needs real Kane data, P7)? **Q13** should the GW2 server refuse to start when the journal cannot be
  created, rather than run and report failures (current behaviour)? Pre-existing defects from P0 (playtest-referee
  cancellations, GW1 tools writing into frozen paths) are unchanged and not repaired here.

## 11. Draft PR

https://github.com/friendly-neighborhood-coding-man/rule-sabotage/pull/23 (draft, base `claude/gw2-phase-0`). PR #22 stays unmerged.

## 12. Recommended P2 scope

Judgment graph as in PHASE_ROADMAP P2: `gamewatch/gw2/judgments.ts` (append, read, verify; content-hash ids; closed
relations; author identity/version; evidence refs), reusing this phase's hash-chain reader conventions; GW2 finding
events and completeness/coverage outputs become `evaluates` nodes by reference; GW1 import of the 3 findings and their
labels by path + hash. No Kane or model calls.

## Reproduce (no Kane, no model provider)

```
git checkout claude/gw2-p1
npm run test:gw2                     # 25 GW2 tests + the GW1 review-server tests
npm run gw2:verify                   # frozen files and frozen-path inventory
npm run gw2:demo -- /tmp/gw2-demo    # a fresh test-double session (any new directory outside the repo or under evidence/gw2/)
node --experimental-strip-types --no-warnings gamewatch/gw2/coverage.ts gw1 evidence/gamewatch/evidence.json \
  evidence/gamewatch/site/index.html evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson \
  evidence/gamewatch/review/notes.ndjson /tmp/gw1-replay
npm test                             # full suite (see §7 for the expected baseline cancellations)
```

## 13. P1 corrections after review (appended 2026-11-25; sections 1–12 are kept as originally submitted)

Operator review, 2026-11-25 13:13 UTC: **PHASE_1_CONDITIONALLY_APPROVED**, with a semantic clarification and decisions
on Q12 and Q13. The corrections are a separate commit on `claude/gw2-p1`, before any Phase 2 work. Decisions D25–D27
in `DECISIONS.md`.

**What changed.**

* **Verification labels (D27).** Every finding now carries `verification`: `journal-verified`,
  `unverified-session-note` (no usable journal; the note is kept and still usable, e.g. for must-cite) or
  `journal-mismatch` (a usable journal disagrees; reported verbatim, not counted). Each requirement result now states
  its `basis`.
* **Experimental validity (D27, D26).** `experimentalValidity` in `gamewatch/gw2/session.ts` is a separate status:
  `verified` (logging on, journal valid, one client, every served page matches its session-start hash, every own
  finding journal-verified), `unsuitable-for-primary-analysis` (anything else, with reasons) or
  `logging-disabled-condition` (an explicitly authorized logging-off session). Only `verified` sets
  `primaryAnalysis: true`. `investigationCompleteness.verifiedComplete` is true only for `complete` + `verified`; an
  incomplete or invalid journal can never produce a verified complete investigation. The P1 observation rules of §5
  are unchanged: they are now labelled instead of silently treated as verified.
* **Q13 conditional fail-closed (D26).** `startGw2Server` writes `session-start` first and throws `JournalInitError` if
  it cannot: no `session.json`, no port, no session. Failures during the run keep the server and all observations and
  findings, and make the session `unsuitable-for-primary-analysis` (retained and reported, never deleted).
  Logging off now requires a stated reason (`--no-access-log --reason <why>`, `loggingDisabledReason`), written to
  `session.json`.
* **Q12 deferred (D25).** No code change: the served-evidence definition (D21) and attribution rule (D20) stay for
  P1–P6; criteria are frozen after a separately authorized P7 pilot, before confirmatory experiments.

**Evidence.** The committed demo output `evidence/gw2/p1-demo/completeness.json` is left as originally produced. The
same committed session re-evaluated with the corrected code is `evidence/gw2/p1-demo/completeness-p1-corrected.json`
(`validity: verified; completeness: incomplete`, so `verifiedComplete: false`; the finding is unchanged).

**Tests.** Five tests added to `tests/gw2-policy.test.ts`: a fully verified session; a mid-session write failure
(must-access still satisfied from intact records, validity `unsuitable-for-primary-analysis`, `verifiedComplete`
false, finding verbatim); an authorized logging-off condition and refusal to disable logging without a reason;
`JournalInitError` on an unwritable journal with no session created; an edited note and a second client making the
session unsuitable. Existing logging-off tests now pass a reason. New GW2 test count: 30 (access 9, policy 16,
compat 5). Full-suite numbers for the corrected head are in `PHASE_2_REPORT.md`.

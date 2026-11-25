# GW2 Phase 0 report: research and engineering foundation

**Final status: `PHASE_0_READY_FOR_REVIEW`**

Prepared 2026-11-25 in a cloud clone by Claude Code. No paid Kane call, no runtime inference call, no change to any
frozen GW1 artifact, the playable engine or the vendored SkillFlow runner. Nothing from P1 onward is implemented.

## 1. Repository and branch state (inspected 2026-11-25 ~12:05 UTC)

| Ref | Commit | State |
|---|---|---|
| `claude/project-thread-1a20hc` (GW1 submission, draft PR #21, open, base `claude/post-ks1`) | `d22d33eeed06370559fe016a2647965875fce42b` | Unchanged; equals the briefed "last known submission commit". |
| `followup/gw1-visit-coverage` | `46ee7e6b3717eeff682f14a4fae10612f7a5f902` | Fast-forward of `d22d33e` by 2 commits (`45959318` adds `gamewatch/skillbook/steps/visit-coverage.mjs`; `46ee7e6` adds `docs/GW1_VISIT_COVERAGE.md`). No PR. Touches no frozen file. |
| `claude/gw2-phase-0` (**new**, this work) | based on `d22d33e` | Phase 0 docs + one read-only script. Draft PR targets the submission branch for diff display only; **not to be merged there** (DECISIONS D4). |
| `claude/project-thread-097wh3` (this session's designated branch) | `0134a36` on origin | Not used: not an ancestor of `d22d33e`; reuse would need a merge or force-push (D5). |
| `main` | `10f92b25` | Not used; the submission stack (PRs #14–#21) is unmerged. |
| SkillFlow `main` | `da9785a030dd62cc0dc7bc2ca522655c2aefdb19` | Same as the vendored commit; upstream has not moved. |

## 2. Exact baseline references

Full record: [`BASELINE_MANIFEST.json`](BASELINE_MANIFEST.json). Highlights:

* Baseline commit `d22d33eeed06370559fe016a2647965875fce42b`; GW1 workspace export commit `fa8c77c`; vendored
  SkillFlow `da9785a030dd62cc0dc7bc2ca522655c2aefdb19` (`runner.py` sha256 `315bf553…`, `LICENSE` `b7e08ddf…`).
* **171 protected files** hashed (git blob id, raw SHA-256, LF-normalised SHA-256): **135 frozen**, 36 reference.
* Existing GW1 freeze records and their own hashes: `gamewatch/private/FREEZE.json` (69 files, `98dd5985…`),
  `evidence/gamewatch/repair/FREEZE.json` (9 files, `35acb16a…`), `VENDOR.json` (`3a0926d1…`).
* Key artifacts: `evidence.json` `3243b1fc…`, `notes.ndjson` `b3cf7e47…`, Kane `stdout.ndjson` `dc8484ae…`,
  `ledger.ndjson` `03a8680f…`, `mutations.json` `389863b0…`, `labels.json` `6bdf805a…`, `server/v6/engine.ts`
  `3a98317a…`.
* **Not in the repository, not hashed here** (operator's machine): `gw1-originals/<time>/`, pass-1 redaction
  originals, the operator's `EVALUATION.json`, and the operator scripts (the executed `gw1-manual-run.ps1` hash is in
  `evidence/corrections/gw1-manual-run-crlf.json`). Noted, not blocking.

## 3. Existing architecture findings

Full map: [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md). In short:

* The evidence contract (`gamewatch/evidence@1`), the evidence collector, the freeze pattern, the gates and SkillFlow
  are sound foundations and are reused unchanged.
* **The review server records form submissions but not page requests** (`gamewatch/kane/serve.ts`). Everything GW1
  knows about what Kane looked at comes from Kane's own step remarks, reconstructed by the follow-up. This is the main
  P1 gap.
* `audit.ts` measures **citation**, not access; GW1 finding 1 cited C-9fc650 before it was opened.
* GW1 was **specification-guided** by design: the index page lists R1–R15, the objective names them, and script titles
  are descriptive. Blind Rule Discovery needs a separate view, not an edit of GW1 pages.
* Several reusable precedents already exist in the repo: hash-chained append-only journal, pre-registration before
  results, sealed holdout, provenance labels that a test double cannot fake, closed-set strict validation.

## 4. GW2 design decisions

[`COMMON_SPEC.md`](COMMON_SPEC.md) states every requirement as AGREED / PROVISIONAL / OPEN;
[`DECISIONS.md`](DECISIONS.md) lists D1–D14 and open questions Q1–Q11. The main provisional choices:

* Two protection tiers (frozen / reference) with a re-runnable check (D6, D14).
* Declared requirements as a tiny JSON policy; "accessed" means served by the review server (D12).
* Hypotheses as a small JSON form over existing evidence fields with a closed operator set; anything else is kept as
  text and marked `not-representable` (D10).
* Three relations (H↔O, H↔S, O↔S), each with `insufficient-evidence` and `not-evaluable` values, never one score.
* One append-only NDJSON judgment graph per experiment, content-hash ids, hash chain (D11).
* Four evidence partitions (discovery, spec, held-out, eval) with their own manifests; logical separation only, stated
  as such.

## 5. Phase-specific acceptance criteria

[`PHASE_ROADMAP.md`](PHASE_ROADMAP.md): contracts and 44 numbered acceptance criteria (AC-P1.1 … AC-P8.4), each
checkable by a test or a recorded artifact. P1–P6 require no paid call or inference call (test doubles only).

## 6. Test results (free; run in this session)

All runs were in scratch checkouts of `d22d33e` (not in the GW2 branch's frozen paths). `git status` was clean after
each run, so no GW1 file was rewritten with different content.

| Check | Result |
|---|---|
| `npm test` (`tests/*.test.ts`, Node 22.23.5, Linux) | **232 tests: 226 pass, 0 fail, 5 cancelled, 1 skipped** (exit 1). The 5 cancelled are all of `tests/playtest-referee.test.ts`; re-run alone: 5/5 cancelled, deterministic. The skip is the Windows-only `.cmd` shim test. See §7. |
| `npm run gamewatch:groundtruth` | 8/8 pass |
| `gamewatch/kane/serve.test.ts` (not in `npm test`) | 2/2 pass |
| SkillFlow self-tests (`python -m unittest discover -s tests`, upstream `da9785a`) | 9/9 pass |
| `python gamewatch/vendor/verify.py` and `--upstream <skillflow@da9785a>` | OK / OK |
| `repair-freeze.ts verify` | 9 files, ok, no mismatch |
| `gamewatch/kane/plan.ts` frozen inputs | ok, 69 files |
| `gamewatch/kane/run.ts --execute` | "GW1-blind-review already ran … no new call", no Kane process |
| SkillBook to the paid gate (`runner.py run … book.json`, scratch state dir) | exit 2, `needs-authorization` at `analyze-kane-review` after 7 tasks; 56 pages rebuilt byte-identical (clean `git status`) |
| `node scripts/gw2-baseline.mjs verify` on the GW2 branch | OK: 135 frozen files match `d22d33e`, 0 reference-tier differences |
| Negative test of the verifier (scratch copy) | edited `notes.ndjson` + added a file under `gamewatch/vendor/` → exit 1 listing both; edited `serve.ts` → listed as a reference-tier difference only; copy restored |

**Paid gates:** `PAID_RESEARCH_EXECUTION = 'disabled'` (`server/balance/v4/kanebudget.ts:23`, unchanged); no
SkillFlow authorization files exist (`.gw-run/` is git-ignored and absent; the scratch run's state has no
`authorizations/` directory); no approval was created.

**Runtime model calls:** none. `kane-cli` is not installed in this container; no command that invokes Kane, an LLM
provider or a coding-agent CLI was run (the SkillBook stopped before `analyze-fix`, and `fix.ts` would refuse anyway
because `attempt.json` exists). The documents themselves were written by Claude Code, which is the authoring
session, not a runtime component.

## 7. Unresolved questions and risks

* **Open questions Q1–Q11** in [`DECISIONS.md`](DECISIONS.md). The ones that need the operator before P1: **Q1**
  (bring the visitation follow-up onto the GW2 branch) and **Q2** (access logging on by default).
* **Threats** in [`THREATS_TO_VALIDITY.md`](THREATS_TO_VALIDITY.md); the largest are T1 (answers are public), T3
  (logical, not OS, isolation), T4 (shared authorship) and T13 (small samples in P7).
* **Existing defects, reported separately and not repaired** (CURRENT_ARCHITECTURE §5):
  1. `tests/playtest-referee.test.ts` cancels 5/5 here (`Promise resolution is still pending but the event loop has
     already resolved`); possibly environment-specific; not a GameWatch file.
  2. `gamewatch/kane/plan.ts` rewrites frozen `evidence/gamewatch/review/PLAN.json` on every run (identical today).
  3. `gamewatch/dashboard.ts` deletes and rebuilds frozen `evidence/gamewatch/site/` (identical today).
  4. `audit.ts` counts citations by substring, not access.
  5. `serve.test.ts` is outside `npm test`.
* **PR base risk:** the draft PR targets the submission branch for a readable diff. Merging it there would add GW2
  files to the submission branch (no frozen file changes, but against the brief). It must stay unmerged or be
  re-targeted (D4).

## 8. Files and commits created

New files (all on `claude/gw2-phase-0`):

* `docs/gw2/COMMON_SPEC.md`, `CURRENT_ARCHITECTURE.md`, `PHASE_ROADMAP.md`, `EXPERIMENT_DESIGN.md`,
  `THREATS_TO_VALIDITY.md`, `BASELINE_MANIFEST.json`, `DECISIONS.md`, `PHASE_0_REPORT.md`
* `scripts/gw2-baseline.mjs` (read-only baseline writer/verifier; no dependencies)

No existing file was modified. Commit ids are listed in the pull request.

## 9. GW1 artifacts preserved

Confirmed: `node scripts/gw2-baseline.mjs verify` reports all 135 frozen files identical to `d22d33e` and no
reference-tier difference; the GW1 freeze checks (`plan.ts` frozen inputs, `repair-freeze.ts verify`, `verify.py`)
pass; `git diff d22d33e --stat` on this branch lists only the 9 new files above. The submission branch and the
follow-up branch were not written to.

## 10. Recommended P1 scope

1. With the operator's OK on Q1, bring `followup/gw1-visit-coverage` onto the GW2 branch unchanged.
2. Server-side access log in `gamewatch/kane/serve.ts` (append-only `access.ndjson`, session nonce, path, status,
   bytes, content hash), on by default unless Q2 says otherwise, with tests AC-P1.1/AC-P1.2.
3. `gamewatch/gw2/policy.ts`: `gw2-policy@1` validator and completeness evaluator (AC-P1.3/AC-P1.4/AC-P1.6).
4. `gamewatch/gw2/coverage.ts`: per-finding table of served / reconstructed / cited / cited-without-access, with the
   GW1 fixture (AC-P1.5).
5. Guard pre-existing defects 2 and 3 for GW2 use: GW2 runs point `dashboard.ts` and plan outputs at `evidence/gw2/`
   paths (no change to GW1 paths).
6. Add `serve.test.ts` and the new tests to an `npm` script; record the full `npm test` result.

Out of P1: blind mode, hypotheses, judgment graph, verifier, any Kane or model call.

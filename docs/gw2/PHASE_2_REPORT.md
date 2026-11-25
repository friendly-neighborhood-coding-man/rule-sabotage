# GW2 Phase 2 report: append-only judgment and hypothesis graph

**Status: `PHASE_2_READY_FOR_REVIEW`.** P3 has not been started.

Branch `claude/gw2-p2`, stacked on `claude/gw2-p1` (PR #23), which is stacked on `claude/gw2-phase-0` (PR #22). Nothing
was merged, deployed or force-pushed. No Kane call, no runtime model call, no authorization-gate change
(`PAID_RESEARCH_EXECUTION = 'disabled'`, `server/balance/v4/kanebudget.ts:23`), no generated code executed, no frozen GW1
artifact, playable engine file or vendored-runner file changed, no historical evidence regenerated.

## 1. P1 corrections (recorded separately)

The P1 corrections requested in the Phase 1 review are a separate commit on `claude/gw2-p1` (`113f454`, PR #23), made
before any P2 work: verification labels per finding, a separate `experimentalValidity` status, `verifiedComplete`,
per-requirement `basis`, Q13 conditional fail-closed (`JournalInitError`, logging off only with a stated reason), Q12
deferred. Details: `PHASE_1_REPORT.md` §13 and `DECISIONS.md` D25–D27. They are not repeated here.

## 2. What P2 adds

| File | Role |
|---|---|
| `gamewatch/gw2/judgments.ts` | `append`, `verify`, `head`, `view` for `gamewatch/gw2-judgment@1`; validation rules; CLI `verify | head | append` |
| `gamewatch/gw2/import-gw1.ts` | deterministic import of the 3 GW1 findings and 3 labels by reference |
| `evidence/gw2/gw1-import/judgments.ndjson`, `IMPORT.md` | the import output and its external anchor |
| `tests/gw2-judgments.test.ts` | 9 tests: AC-P2.1–AC-P2.7, integrity limits, output guard |
| `package.json` | `gw2:judgments`, `gw2:import-gw1` |
| `docs/gw2/DECISIONS.md` | D28–D34, Q14–Q16 appended |

**Record.** Each line is canonical JSON `{schema, seq, prev, node}`. `prev` is the SHA-256 of the previous line; the
node id is the SHA-256 of the canonical node without its id. A node has `kind` (finding, hypothesis, evaluation, label,
challenge, correction), `parents: [{id, relation}]` (supersedes, challenges, refines, alternative-to, evaluates),
`author {kind: agent | verifier | operator | test-double, id, version}`, `origin` (historical-import | live), `at`,
`evidenceRefs [{path, sha256, line + lineSha256 | pointer}]`, `criteria`, `reason`, `body`, and, for Kane only,
`provenance {kaneStdout, kaneArgs, note}`.

**Rules enforced on append (and re-checked by `verify`).**
* Append-only: `append` verifies the whole file, refuses to extend a file that fails, and writes exactly one line at
  the end. There is no update or delete API.
* Parents must already exist (no forward references, so no cycles); ids unique; closed sets; unknown fields refused.
* `evaluates` needs evaluator id, version, evidence refs, criteria and reason; any other link needs a reason.
* Evidence refs are checked against the files (LF-normalised SHA-256, line hash, JSON pointer).
* Kane attribution (any author id naming Kane): author kind `agent`; stored stdout with stream_start whose
  `cli_version` equals the author version and a run_end; args.json `kane-cli` with the same version; note line with
  `source: "kane"` and `nonceValid: true`; `body.verbatim` equal to that line. A test double can never name Kane; a
  non-Kane node cannot carry a Kane reference.

**Distinguishing sources.** Historical import vs live is `origin`; test double, deterministic verifier, operator and
agent are `author.kind`; authentic Kane output is an agent node that passes the provenance check. Verifier judgments are
ordinary nodes: they can be evaluated, challenged and superseded like any other (AC-P2.4 test).

**No truth selection.** `view()` lists, for every node, who evaluates, challenges, supersedes, refines or offers an
alternative to it. Superseded and challenged nodes stay listed. Nothing is ranked, resolved or declared final, and the
test checks that no exported API or view field does so.

## 3. Integrity: what is and is not guaranteed

| Change to the file | Detected by `verify` alone | Detected with an external anchor |
|---|---|---|
| edit a line (content, author, reason, ...) | yes, first bad line named | yes |
| edit a node and recompute its id | yes (the next line's `prev`, or children's parent ids, break) | yes |
| delete, insert or reorder a line | yes, first bad line named | yes |
| partial last line | yes | yes |
| remove lines from the end (tail truncation) | **no** (a shorter valid chain) | yes |
| deliberate rewrite recomputing every id, `prev` and `seq` | **no** | yes (anchored prefix changed) |
| rewrite of both the file and the stored anchor | no | no |

The hash chain is tamper-evident against accidental and naive changes, not tamper-proof against a writer with access.
`head()` returns `{count, lastLineSha256}`; the anchor for the GW1 import is in `evidence/gw2/gw1-import/IMPORT.md` and
in the PR. There are no signatures; where the P7 anchors are kept is open (Q14).

## 4. GW1 import

`evidence/gw2/gw1-import/judgments.ndjson`, 6 lines, anchor `6:bfffa8b6f65e2ba7a4836444fab911762cb812e6b97176e834062cfbb4cfcb50`.

| seq | kind | author | links | content |
|---|---|---|---|---|
| 1 | finding | kane-cli 0.10.4 | – | clean / no problem found (verbatim note line 1) |
| 2 | finding | kane-cli 0.10.4 | – | confirmed observable anomaly, R8 (line 2) |
| 3 | finding | kane-cli 0.10.4 | – | confirmed observable anomaly, R3 (line 3) |
| 4 | label | GW1 preparing session (Claude Code) | evaluates 1 | false negative (inconsistent clean report) |
| 5 | label | same | evaluates 2 | true detection (B2) |
| 6 | label | same | evaluates 3 | true detection, partial characterisation (B3) |

The findings are byte-for-byte the lines of `evidence/gamewatch/review/notes.ndjson`; the labels reference
`gamewatch/private/evaluation/labels.json` by JSON pointer and file hash and `gamewatch/private/mutations.json` by hash,
and quote the label's `why` as the reason. The labeller's version is not recorded in the source; the author version
says so rather than guessing. The clean finding and the two anomaly findings coexist; the import adds no relation
between them. Every timestamp is from the sources, so a fresh import is byte-identical (tested).

## 5. Acceptance criteria

| AC | Result | Evidence (`tests/gw2-judgments.test.ts`) |
|---|---|---|
| AC-P2.1 appending never rewrites earlier bytes | **PASS** | "AC-P2.1": prefix equality after each append, exactly one new line, refused appends leave the file byte-identical, no update/delete API |
| AC-P2.2 edit, delete, reorder → verify fails and names the first bad line | **PASS** | "AC-P2.2": 6 tamper variants (edit, delete, reorder, insert, edit line 1, partial line) + edited-and-rehashed node; appends refused after each |
| AC-P2.3 missing parent refused; no cycles | **PASS** | "AC-P2.3": missing, self and forward parents refused; forged forward reference fails verify |
| AC-P2.4 verifier rejection → evaluates node; operator challenge accepted; both readable; no delete/overwrite | **PASS** | "AC-P2.4": rejection, challenge, superseding re-evaluation, evaluation of the verifier's judgment; all 5 nodes in `view`; original rejection unchanged; no "final" API or field |
| AC-P2.5 evaluates node without id, version, refs, criteria, reason refused | **PASS** | "AC-P2.5": each of the 5 omissions refused by name; stale evidence hash refused |
| AC-P2.6 Kane label needs a stored Kane output by hash; test double never Kane | **PASS** | "AC-P2.6": 8 refusals (test-double Kane, no provenance, test-double note, hash mismatch, not a kane-cli output, version mismatch, non-verbatim body, Kane reference on a non-Kane node); forged label in a stored file caught by verify |
| AC-P2.7 GW1 import 3 + 3, evaluates-linked, findings coexist, baseline verify 0 | **PASS** | "AC-P2.7": byte-identical fresh import, `verify --check-refs`, verbatim findings, label links, GW1 sources unchanged, `gw2-baseline.mjs verify` exit 0 |

Also: "integrity limits" (tail truncation and a full recomputed rewrite pass the file-only check and are caught with an
anchor) and "output guard" (no judgment file under frozen paths or outside `evidence/gw2/` in the repository).
Two quick mutation checks were run by hand: disabling the test-double/Kane rule fails AC-P2.6, disabling the evaluates
completeness rule fails AC-P2.5.

## 6. Tests and baseline comparison

Node 22, Linux, this cloud clone. Deterministic fixtures only.

| Suite | Phase 0 baseline (`d22d33e`) | P1 (`06250b4`) | P2 (`claude/gw2-p2`) |
|---|---|---|---|
| `npm test` | 232: 226 pass, 0 fail, **5 cancelled**, 1 skipped | 257: 251 pass, 0 fail, 5 cancelled, 1 skipped | **271: 265 pass, 0 fail, 5 cancelled, 1 skipped** (exit 1, as at baseline) |
| `npm run test:gw2` | – | 27/27 | **41/41** (judgments 9, policy 16, access 9, compat 5, GW1 serve 2) |
| `npm run gw2:verify` | OK | OK | OK: 135 frozen files match `d22d33e`; 11 reference-tier differences, all added files |
| `python gamewatch/vendor/verify.py` | OK | OK | OK (commit `da9785a030dd`) |

The +14 since P1 are the 5 P1-correction tests and the 9 P2 tests. The 5 cancellations are the same
`tests/playtest-referee.test.ts` tests as at the baseline ("Promise resolution is still pending but the event loop has
already resolved"); they are **not** counted as passes. The skip is the same Windows-only `.cmd` shim test. No new
failure, cancellation or skip. The full suite was run once before a one-word test fixture change (operator author id
`eric` → `operator`, Q16); `test:gw2` was re-run after it (41/41).

## 7. Limitations

* Integrity is detection only (§3). Anchors in the same repository protect against accidents, not a determined writer.
* Kane provenance proves consistency with stored files, not that kane-cli produced them: a forged stdout/args pair with
  matching hashes would pass. It does stop a test double or a non-Kane note from being labelled Kane.
* The labeller's model version for GW1 is unknown; the label nodes say so.
* Content-hash ids include evidence paths; a graph written with absolute (temporary) paths is not portable.
* `view()` lists direct relations only; no transitive or "current" view exists, by design.
* P1 session findings are not yet imported into the graph automatically (Q15); `append` supports it.
* Pre-existing defects unchanged: playtest-referee cancellations; GW1 `plan.ts`/`dashboard.ts` write into frozen paths.

## 8. Unresolved decisions

Q14 (where P7 anchors are kept), Q15 (automatic vs explicit import of GW2 session findings), Q16 (operator identity as
a role), plus the open earlier questions Q3–Q11 in `DECISIONS.md`.

## Reproduce (no Kane, no model provider)

```
git checkout claude/gw2-p2
node --experimental-strip-types --no-warnings=ExperimentalWarning --test tests/gw2-judgments.test.ts
npm run test:gw2
npm run gw2:verify
npm run -s gw2:judgments -- verify evidence/gw2/gw1-import/judgments.ndjson --check-refs --anchor 6:bfffa8b6f65e2ba7a4836444fab911762cb812e6b97176e834062cfbb4cfcb50
npm run -s gw2:import-gw1 -- /tmp/gw1-import-check.ndjson && cmp /tmp/gw1-import-check.ndjson evidence/gw2/gw1-import/judgments.ndjson
npm test   # expect 271: 265 pass, 0 fail, 5 cancelled (baseline), 1 skipped
```

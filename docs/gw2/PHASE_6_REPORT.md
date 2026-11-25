# GW2 Phase 6 report: SkillFlow integration, Kane boundary, end-to-end test-double validation, P7 preparation

**Status: `PHASE_6_READY_FOR_REVIEW`.** P7 has not been started. There were zero Kane calls, zero runtime model inference
calls and no paid execution. Branch `claude/gw2-p6`, stacked on `claude/gw2-p5` (PR #27).

**Constraints held:**
* The authorization gate is unchanged (`PAID_RESEARCH_EXECUTION = 'disabled'`).
* No agent-generated code was executed. The investigator doubles are repository scripts.
* No frozen GW1 artifact, playable-engine file or vendored-runner file was changed. `gw2:verify`, `vendor/verify.py` and `git diff d22d33e -- gamewatch/vendor` confirm this.
* No historical evidence was regenerated. The P5 demonstration reports (evaluator v1) are kept as they are.
* No test was weakened or deleted.
* No external service was used. The doubles talk only to the loopback review server.

## 1. Commits

| Commit | Content |
|---|---|
| `445d8db` | **P5 corrections** with regression tests (D86–D92), U1–U4 (D93–D96). Also pushed to the P5 branch (PR #27) |
| `ef548d8` | **P7 evidence freeze**, before any P7 observation: `generation-p7-1`, `partition-p7-1`, `scenarios-p7.ts`, `generate-p7.ts`, and opt-in partition constraints (D97) |
| `5413e2a` | P5 correction follow-up: the three-way verifier also aligns held-out builds (D88, verify.ts 2.1) |
| `67b3f49` | P7 generated observations: 44 cases and 48 matches |
| `af6831c` | P7 partition (unopened) and leak check |
| `418db15` | P6: the GW2 book, Kane boundary, shim, step CLI, P7 book, tests, the committed P6 run, the P7 pre-registration draft, the operator checklist and this report |

## 2. P5 corrections (operator review)

These are in a separate commit, with `tests/gw2-p5-corrections.test.ts`. Details are in PHASE_5_REPORT §12.
1. **Build alignment** (D88). Hypotheses use discovery build ids. Held-out situations are relabelled through `eval/` in held-out scoring and in the three-way verifier, so a build condition stays applicable. The defect-describer double exercises this end to end: its build-specific R3 description is evaluated on held-out and read as an accurate description of a defect.
2. **Fully vs partially evaluated** situations and units are reported apart (D89).
3. **Self-contradictory predictions** are flagged and never compared (D92).
4. **Primary set** (D91). Unverified, uncounted and unsuitable-session entries are preserved and listed as excluded with reasons.
5. **Descriptive vs replication** (D90). Rates are labelled descriptive, and replication is counted in seed groups and script families.

## 3. Operator decisions U1–U4 (D93–D96)

* **U1. Fresh P7 evidence.** `evidence/gw2/p7-evidence/`. The procedures were frozen in `ef548d8` before generation. There are 12 new seeds (98201–98212) on QX-41 and QX-73, giving 44 scripted cases and 48 matches. The partition satisfies its hard constraints: 4 held-out seeds (98202–98205, 16 matches), 8 discovery seeds (32 matches), every rule covered in both partitions, and a per-match seed map in `eval/`. The leak check passed on 63 served files. The partition is unopened: no session, freeze or ledger exists. A constraint that cannot be met fails the partition with its reason, and nothing is relaxed (tested). The P5 bundle stays the development and dry-run dataset, and P6 uses it.
* **U2. Scoped encoding review.** The review observations are recorded in D94. The encoding's `review.status` stays unreviewed, and it is not marked accepted.
* **U3. No external translation** in the first P7 pilot. The book's representations step seals submitter representations only and checks that there are 0 external translations.
* **U4. Shielded matrix coverage.** `matrix-shield-v1` (send home, row 3) is in discovery and `matrix-shield-v2` (freeze, row 5) is in held-out. Both were dry-run once on QX-41 for executability before the freeze. No observation is in both partitions.

## 4. The GW2 SkillBook (D98)

`gamewatch/gw2/book.json` has 13 tasks and runs under the **unchanged** runner:

| # | Task | Pipeline stage |
|---|---|---|
| 1 | procedures | procedure and generation verification: code and build hashes, bundle provenance, generated after freeze |
| 2 | partition | partition with the frozen procedure, and leak check of the served site |
| 3 | session-plan | declared session plan |
| 4 | investigate (gated `kane-paid`) | review server with access journal, agent submission through the Kane boundary, closure and seal by the server |
| 5 | closure | every session closed and sealed |
| 6 | import | explicit import |
| 7 | freeze | experiment-level hypothesis freeze |
| 8 | representations | submitter representations extracted verbatim and sealed before evaluation |
| 9 | three-way | three-way verification through the gate |
| 10 | heldout | held-out evaluation |
| 11 | discriminate | competing-hypothesis discrimination |
| 12 | report | separated per-investigator report, with the abstention check |
| 13 | integrity | manifests, closures, graph, freeze, seal, ledger and declared sessions |

## 5. Kane CLI boundary (D99)

`gamewatch/gw2/kane-boundary.ts` has two routes:
* **Real route.** The unchanged gate refuses first (disabled), so no server and no process is started (tested). The code after the gate is prepared for P7, is unexercised, and is reachable only after an explicitly approved gate change.
* **Test-double route.** The shim `gamewatch/gw2/doubles/kane-shim.mjs` is started through the real spawn path (`server/kane.ts runCapture`, `KANE_CLI`) with the exact P7 objective-mode argv (`run <OBJECTIVE_P7> --url … --agent --headless --max-steps 80 --timeout 2700`). Any path other than the repository shim is refused before a spawn. The shim investigates over HTTP, reads the nonce from the served form, submits through the forms and prints Kane-shaped NDJSON. Its `run_end` is parsed with the GW1 parser.

## 6. Results of the committed run (`evidence/gw2/p6-run/`)

These are the P5 development dataset and five test-double sessions, labelled TEST DOUBLE. They measure the machinery, not an agent.

| Profile | Hypotheses / abstentions | Coverage (held-out situations) | Held-out accuracy | Incorrect assertions | Defects described accurately | Cited without access |
|---|---|---|---|---|---|---|
| accurate | 3 / 0 | 109/396 | 109/109 = 1 | 0 | 0/3 | 0 of 9 |
| careless | 3 / 0 | 109/396 | 109/109 = 1 | 0 | 0/3 | 20 of 20 |
| over-abstaining | 0 / 3 | 0/396 | no assertion (no rate) | 0 | 0/3 | 0 of 0 |
| confident-wrong | 3 / 0 | 218/396 | 95/218 = 0.436 | 123 | 0/3 | 0 of 6 |
| defect-describer | 2 / 0 | 212/396 | 212/212 = 1 | 0 | 1/3 (R3 on the first-mover build) | 0 of 6 |

The **over-abstaining** profile ranks above **accurate** on **nothing**. It ties on incorrect assertions (0) and on cited without access (0). Its accuracy has no denominator, its coverage is 0, and its detection counts abstention as not detected. In general, the only edge an abstainer can gain is on "incorrect assertions", because it asserts nothing. The report states this (AC-P6.3).

A second run in a fresh directory gives identical metrics; the test suite re-runs the book.

## 7. Acceptance criteria

| AC | Result |
|---|---|
| AC-P6.1 | **Met.** The book runs to `@done` with test doubles under the unchanged runner, with no network beyond loopback, no model and no Kane. It takes about 20 s, against a limit of 10 minutes (`tests/gw2-p6.test.ts`). |
| AC-P6.2 | **Met.** Without authorization: exit 2 at `investigate`, the task never started, the shim marker is absent, and there is no session or `kane-runs`. With runner authorization on the real route, the gate refuses before any process; the book stops with exit 3 and the refusal is recorded in `kane-ledger.ndjson`. The P7 book behaves the same way at `investigate-1`. |
| AC-P6.3 | **Met.** The expected separated metrics are in §6, and the ranking rule is tested on synthetic metrics. |
| AC-P6.4 | **Met.** `python gamewatch/vendor/verify.py` reports OK, and `git diff d22d33e -- gamewatch/vendor` is empty (tested). |
| AC-P6.5 | **Met.** See §8. |

## 8. Tests

| Suite | Result |
|---|---|
| `npm test` | 340 tests: 334 pass, 0 fail, **5 cancelled**, **1 skipped**. The cancellations are the existing `tests/playtest-referee.test.ts` ones ("Promise resolution is still pending"), and the skip is the Windows-only `.cmd` shim test. Neither is counted as a pass |
| `npm run test:gw2` | 110/110: 82 P4 + 12 P5 + 7 P5-correction + 9 P6 |
| `npm run gw2:verify` | OK: the 135 frozen GW1 files are unchanged. Reference-tier differences are new GW2 files under `gamewatch/`, which is expected |

## 9. Limitations

* Every session is a scripted test double, so no agent was measured. The doubles' hypotheses are fixed in advance, apart from the defect-describer's choice of build, which it computes from the served pages.
* "Detection" counts held-out spec deviations under the **provisional** encoding-2 (U2). Of the three deviations present, the defect-describer describes one (R3). The others are not targeted by any double.
* "Cited without access" is judged from the server journal (the page served before the submission). It cannot show whether a served page was read.
* The real route after the gate is untested by design, because testing it would need a real or gate-test Kane CLI. Its first use is P7, under the operator checklist.
* The P7 partition is reproduced by the P7 book in its own directory. The checklist compares its manifests with the committed `p7-evidence` partition before any session.
* Contamination (T25). B1–B3 are public, and new seeds do not remove prior knowledge.

## 10. P7 readiness

* Pre-registration draft: [`P7_PREREGISTRATION_DRAFT.md`](P7_PREREGISTRATION_DRAFT.md). It covers 3 blind sessions, 1 run each, the journal on, no translation, no verifier feedback during discovery, identical evidence, CLI, objective and budgets, sealing before evaluation, stopping rules, and separate credit, step and time accounting. The matched architecture-off/on study is described separately and not authorized.
* Exact commands, permissions, limits, cost basis and stop conditions: [`P7_OPERATOR_CHECKLIST.md`](P7_OPERATOR_CHECKLIST.md).
  * Maximum 3 calls.
  * `kane-cli` 0.10.4.
  * About 40–75 credits per call on the repository's records (GW1 used 72.4 for 80 steps). The gate's worst case is 248 per call, and there is no hard cap.
* Still needed from the operator: P7 authorization, approval of the gate change, three approval records, and confirmation that encoding-2 stays exploratory.

---
Stop here: `PHASE_6_READY_FOR_REVIEW`. P7 has not been started.

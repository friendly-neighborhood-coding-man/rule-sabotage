# GW2 Phase 7 report: exploratory pilot with three real Kane sessions

**Status: PHASE_7_READY_FOR_REVIEW.** P8, further paid sessions and any architecture comparison are not started. Each needs a separate approval.

This is an exploratory capability and feasibility pilot (P7_PREREGISTRATION §1). It has no control arm. It is **not** an
architecture comparison, and nothing in it supports a claim that GW2 improves agent performance or reliability. Three
sessions are three case studies, not rates. The evidence is public and the planted defects are documented in this
repository, so contamination (T25) limits what any detection figure means.

## 1. Commits (branch `claude/gw2-p7`, PR #29)

| Commit | What |
|---|---|
| `692ebab` | Preflight corrections D102–D108 and the scoped gate rule D109. Gate still disabled |
| `c46ff7e` | Gate change: `PAID_RESEARCH_EXECUTION = 'per-run-approval'`, scoped to `GW2-P7-pilot-1..3` (D109) |
| `c066db2` | Native Windows compatibility (D110). **The pilot ran at this commit** |
| `d74cc91` | Published, redacted copy of the pilot evidence, with REDACTION_RECORD and `tests/gw2-p7-published.test.ts` |
| `1de300e` | Gate restored to `'disabled'` in its own commit (D111) |
| this commit | This report, D112 and D113 |

## 2. Execution (operational completion)

The operator ran the pilot on native Windows with `gw2-p7-run.ps1` at `c066db2`. Each paid call followed its own typed `RUN <n>` and an approval written immediately before it.

| Session (GW2 id) | Run id | Approved (UTC) | Exit | Timeout | `run_end` | Steps (of 80) | Elapsed, ms | Kane duration, s | Credits by balance delta | Kane-reported credits | Ceiling outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `e95f5bc28e46532c` | GW2-P7-pilot-1 | 19:36:59 | 0 | no | passed, `success.complete` | 21 | 142,463 | 79.8 | 31.844 | 29.681 | WITHIN_CEILING |
| `f6003f7e3d5f8469` | GW2-P7-pilot-2 | 19:47:36 | 0 | no | passed, `success.complete` | 17 | 147,677 | 110.8 | 48.480 | 37.423 | WITHIN_CEILING |
| `1e26529c62afc36e` | GW2-P7-pilot-3 | 20:01:42 | 0 | no | passed, `success.complete` | 45 | 196,430 | 164.0 | 51.719 | 51.128 | WITHIN_CEILING |
| **Total** | 3 of 3 completed | | | | | 83 | 486,570 | 354.6 | **132.043** | 118.232 | |

* Credits, steps and time are separate measures and are not combined. Total spend was 132.043 credits, inside the expected 120–225, under the 300 ceiling field for every call, and far from the 4,000 research threshold. No retries, follow-ups, parallel calls or credit purchases happened.
* **The balance delta exceeds Kane's own figure** by 2.16, 11.06 and 0.59 credits (13.81 in total, of which 11.06 is session 2). GW1 agreed within 0.01. The cause is not known. Possibilities include account activity between the two balance reads, or metering that Kane does not report in `run_end`. The balance delta is the accounting figure (§A of the checklist).
* "Completed" is operational only: the process ended normally with a valid `run_end`. It says nothing about whether any hypothesis is correct (§6, distinction 1).

## 3. Independent reproduction of integrity

All checks were reproduced on Linux from the operator's unchanged results pack (`gw2-p7-results.zip`, PACK.json head `c066db2`) at `c066db2`. A scratch copy of the external record was used each time, because the integrity step appends a checkpoint.

* **Integrity step `p6-steps.ts integrity`: 20 of 20 checks pass.** They cover the partition manifests; the three sessions, closed and sealed; the judgment graph (51 nodes); the hypothesis freeze; the representation seal; the evaluation ledger (4 entries); all declared sessions present; three raw seals; the external execution ledger; the pre-registration unchanged; external anchors of the three raw seals, the freeze and the seal; and the graph extending its anchored prefix.
* **`p7-exec.ts verify-record`: OK.** The chain has 7 entries: `preregistered`, 3× `session-end`, `hypothesis-freeze`, `representation-seal` and `integrity`.
* **`judgments.ts verify --check-refs`: OK.** Every Kane node carries the stated `test_url` limitation (D104b).
* **Evaluations re-derived deterministically.** The graph was cut back to the 11 nodes that existed when evaluation opened, and three-way, held-out, discrimination and report were re-run with the original evaluation time. All three evaluation files and the report profiles are identical, except the run-time fields `at`, `exp`, `graphNodes` and `sources`.
* **Ordering.**
  * The approvals are one at a time.
  * Each session-end anchor precedes the next approval.
  * The freeze and the seal precede the first evaluation.
  * Nothing semantic was opened between sessions. Only `ops-status` was shown.
* **Access.** All three sessions cited nothing that the journal had not served first: 0 of 3, 0 of 4 and 0 of 5 citations.
  * Sessions 1 and 2 opened `C-0662fc` and `C-0c6c31`.
  * Session 3 opened those two and `M-22e2f2`.

## 4. Submissions, preserved verbatim

There are 8 hypotheses and 0 abstentions. All 8 are in the primary analysis set, and none was excluded or repaired. The committed graph and `P7_PILOT_REPORT.json` keep every entry byte for byte, including the incorrect hypotheses and the ones that cannot be evaluated.

| Session | Ref | Confidence | Statement (verbatim) | Representation |
|---|---|---|---|---|
| e95f | H-1 | high | "The number of actions granted at the start of every turn differs by build: build-06b9 grants 3 actions, while build-3caf grants 4." | none |
| e95f | H-2 | high | "On build-06b9, a piece that enters a square with an opponent's Freeze effect becomes frozen for two turns; an attempted move while frozen is refused." | none |
| f600 | H-1 | high | "Landing on a Freeze effect square freezes the entering piece for the turn, so a later move with that piece is refused." | none |
| f600 | H-2 | high | "The two observed builds differ in the initial Human turn for script S-2992: build-06b9 grants 3 actions, while build-3caf grants 4." | none |
| 1e26 | H-1 | high | "In build-06b9, each observed turn start grants exactly 3 actions." | turn-start, `build == build-06b9` ⇒ `actionsGranted = 3` |
| 1e26 | H-2 | medium | "In build-06b9, entering a Freeze effect square fires the effect and freezes the entering piece; the frozen piece's attempted move on its next turn is refused." | effect-entry, `effect == Freeze` ⇒ `fired = true` |
| 1e26 | H-3 | medium | "In the observed build-06b9 computer match, entering a Teleport square fired Teleport, forced the piece to B9, and the subsequent move to A9 scored that piece." | effect-entry, `effect == Teleport` ⇒ `fired = true` |
| 1e26 | H-4 | medium | "The observed match ended when AI got all 3 of its pieces across; getting all 3 pieces across appears to be the win condition." | none |

## 5. Results on the separated dimensions (pre-registration §3)

Each column is reported on its own with its denominator. There is no ranking and no composite score.

| Session | Hypotheses / abstentions / excluded | Sealed representations / free text only | Coverage (held-out situations predicted) | Held-out checks matching / contradicting | Held-out accuracy (descriptive) | Detection of held-out deviations | Citations without access |
|---|---|---|---|---|---|---|---|
| e95f | 2 / 0 / 0 | 0 / 2 | 0 / 914 | 0 / 0 | not defined (no assertions) | 0 / 4 | 0 / 3 |
| f600 | 2 / 0 / 0 | 0 / 2 | 0 / 914 | 0 / 0 | not defined (no assertions) | 0 / 4 | 0 / 4 |
| 1e26 | 4 / 0 / 0 | 3 / 1 | 384 / 914 (0.42; Wilson 95% 0.39–0.45) | 194 / 190 | 194 / 384 = 0.505 (0.455–0.555) | 0 / 4 | 0 / 5 |

Results per representation (session 1e26). Discovery builds are `build-06b9` (QX-41, clean) and `build-3caf` (QX-73). Held-out builds align to them: `build-c1dc` to 06b9 and `build-78ff` to 3caf.

| Rep | Build | Discovery fit | Held-out matching / contradicting | Units without a contradiction (cases + matches) |
|---|---|---|---|---|
| H-1 | QX-41 | **contradicted**: 390 counterexamples in 628 turn starts | 114 / 187 | 8 / 16 |
| H-1 | QX-73 | does not apply (its condition names build-06b9) | 0 / 0 | – |
| H-2 | QX-41 | fits 7 of 7 | 3 / 2 | 3 / 4 |
| H-2 | QX-73 | fits 6 of 6 | 2 / 1 | 1 / 2 |
| H-3 | QX-41 | fits 74 of 74 | 34 / 0 | 8 / 8 |
| H-3 | QX-73 | fits 64 of 64 | 41 / 0 | 8 / 8 |

* Every held-out situation with a check is fully evaluated. None is partially evaluated (D89).
* **Discrimination.** No session declared a competitor, so there are 0 pairs of declared competitors. The 21 pairs that were evaluated set a representation against a spec rule. Most make no common predictions: 37 of 42 discovery readings and 37 of 42 held-out readings, counted per build. Six readings are indistinguishable on the available evidence. The evidence **separates** two pairs:
  * H-1 from spec R3. On 06b9 the two disagree on 390 discovery and 187 held-out turn starts, and the outcome follows R3 every time.
  * H-2 from spec R14 (the shield rule), on held-out shielded Freeze entries. There are 2 such entries per build.
    * On QX-41 the outcome follows R14 in both.
    * On QX-73 it follows R14 in one (C-b48898 s15). In the other (C-b48898 s18), a shielded piece was frozen. That agrees with H-2 and is consistent with the R14 deviation present in that build.
  * No representation contradicts itself.
* **Three-way readings.**
  * H-1 on 06b9: the hypothesis is contradicted by the observations, while the observations conform to spec R3 on all 628 turn starts.
  * H-2 and H-3: they fit discovery, and their held-out readings are as in the table above.
* Encoding-2 is the spec reference. It is provisional and exploratory only (D94).

## 6. The seven distinctions

1. **Operational completion vs epistemic correctness.**
   * Operationally, all three sessions completed (§2). Every artifact was sealed, anchored and verified (§3).
   * Epistemically, the one high-confidence structured hypothesis is contradicted by most of the evidence it cites (§7).
   * No machine-evaluable hypothesis describes a defect, and detection is 0 of 4 in every session.
   * A clean pipeline run is evidence that the **process** worked. It is not evidence that the **content** is correct.
2. **Natural-language hypotheses vs structured representations.**
   * 8 hypotheses were submitted, and only 3 carry a structured representation (all from session 3).
   * The verifier evaluates only the structure. It never interprets free text (U3: no external translation).
   * As a result, sessions 1 and 2 have **no** machine-evaluated content, however plausible their statements read.
3. **Missing representations vs incorrect predictions.**
   * Five hypotheses are *not evaluable* (`no-sealed-representation`). This is not the same as *wrong*.
   * They make 0 assertions, so they add 0 contradicted checks and 0 coverage, and their accuracy is undefined (not 0).
   * The 190 contradicted checks all come from H-1 (187) and H-2 (3) of session 3, which were represented.
   * A session that represents nothing cannot be wrong on held-out data. It also predicts nothing. Missing representations are shown as a coverage of 0, never as accuracy.
4. **Declared confidence vs observed predictive accuracy.**
   * Session 3 rated H-1 **high**. Its held-out accuracy is 114/301 = 0.38, and it is contradicted in discovery.
   * Session 3 rated H-3 **medium**. Its checks match 75/75 held out.
   * Sessions 1 and 2 rated all four of their hypotheses **high**, and none of them can be evaluated.
   * Declared confidence did not track accuracy in this pilot. With 3 represented hypotheses this is an observation, not a calibration estimate.
5. **Discovery fit vs held-out generalization.**
   * H-1 fails both. Its discovery fit is contradicted, yet it was submitted on the basis of discovery pages.
   * H-2 fits all 13 discovery entries but is contradicted by 3 of 8 held-out entries. All 3 involve a **shielded** piece: `pieceShieldedBefore = true`, and the effect does not fire.
     * No discovery Freeze entry had a shielded piece (`false` or unknown in all 13).
     * So discovery fit could not reveal the missing shield condition. Held-out evidence did.
   * H-3 fits both. Teleport always fired: 138 discovery entries and 75 held-out ones.
   * Fit on the data a hypothesis came from is not generalization.
6. **Representation fidelity vs correctness of the represented predictions.**
   * Fidelity (does the structure say what the statement says?) is declared by the author as "faithful" and is **not checked** by the verifier. Correctness is about the structure's predictions.
   * The two diverge in two of the three representations:
     * **H-2's representation is narrower than its statement.** It claims only `fired = true`. It omits "freezes the piece" and "the next move is refused", and it drops the build condition, so it also predicts build-3caf.
     * **H-3's representation is broader than its statement.** The statement is about one entry in one match. The representation is a law for every Teleport entry in every build.
   * H-3's 75 of 75 matching checks therefore verify a claim the author's text did not make.
   * H-1 is faithful to its statement's wording but drops the qualifier "observed" (see §7).
   * Correctness can only be judged for what was represented, so a correct representation of the wrong claim is possible.
7. **Descriptive outcome-check counts vs independent experimental replications.**
   * 194 matching and 190 contradicting are counts of **outcome checks**. They are not independent trials.
   * Checks within one situation, and situations within one match, are correlated (turns of one game). Matches that share a seed are paired, and cases that share a script form a family.
   * The replication-level figures are the units: for H-1 on QX-41, 8 of 16 cases and matches are free of contradiction. Held-out has 4 seed groups per build.
   * The Wilson intervals are descriptive. None of these counts is a p-value or a replication count.

## 7. The high-confidence turn-start hypothesis (session 3, H-1)

**Claim.** "In build-06b9, each observed turn start grants exactly 3 actions." It is rated high confidence. The representation is `turn-start, build == build-06b9 ⇒ actionsGranted = 3`. The cited evidence is "C-0c6c31 steps 0, 4, 8, 11, 14, 17, 20; M-22e2f2 turns 1-7."

**What the clean build actually does.**
* In build-06b9, `actionsGranted` equals the number of the mover's pieces on the board, with no pending bonus, on **every one** of its 628 discovery turn starts and 301 held-out turn starts. This is spec R3, which the observations conform to.
* The value is 3 only while the mover still has 3 pieces on the board:

| Pieces on board | Discovery turn starts → granted | Held-out turn starts → granted |
|---|---|---|
| 3 | 238 → 3 | 114 → 3 |
| 2 | 235 → 2 | 78 → 2 |
| 1 | 155 → 1 | 109 → 1 |

**Counterexamples.**
* All 390 discovery and 187 held-out counterexamples are turn starts where the mover has fewer than 3 pieces on the board, because pieces have scored or been removed. There is no other kind.
* They occur in 16 of 30 discovery units (cases and matches) and 8 of 16 held-out units. Every one of them is a match, since the scripted cases on 06b9 keep all three pieces at each turn start.

**The cited evidence contradicts the claim.**
* All 7 turn starts that the session cited from `C-0c6c31` are 3, because that scripted case never removes a piece.
* `M-22e2f2` was opened, as the access journal records, and cited for "turns 1-7". Of its 53 turn starts, 26 give something other than 3.
* The first counterexample is **turn 3**, inside the cited range: the AI mover has 2 pieces and is granted 2. Turns 5 and 7 are the same.
* The session therefore cited a range that contains the counterexamples, or did not inspect that range at the resolution it claimed.

**Why it was submitted.**
* The data can only show which inputs were seen. They cannot show what Kane attended to.
* The pattern is a generalization from the starting configuration (3 pieces each), which dominates the early turns of every page served.
* The statement's own scope, "each **observed** turn start", is narrower than the representation, which covers every turn start in the build. Even so, the observed turn starts in `M-22e2f2` do not satisfy it.

**Reading.**
* The hypothesis is a plausible but over-generalized law, submitted with high confidence, and refuted both by its own discovery evidence and by held-out evidence.
* The verifier recorded it as contradicted rather than not evaluable, because it had a representation. That is the pipeline working as designed: it recorded a confident error that free-text review could have accepted.

## 8. What the other sessions saw, and why it does not count as detection

* Session 1 (H-1) and session 2 (H-2) both noticed, in free text, that the Human's first turn in script S-2992 grants 3 actions in build-06b9 and 4 in build-3caf.
* In build-3caf's discovery turn starts, the first mover gets one action more than its pieces on the board (3 → 4, 2 → 3, 1 → 2), and the other side gets exactly its pieces. This matches the R3 deviation present in that build.
* Session 2 scoped its claim to the one case it saw. Session 1 over-generalized it to "every turn" (in 3caf the non-first mover gets its piece count).
* Neither has a representation, so neither is machine-evaluable, and detection stays at 0 of 4 for both.
* Whether either statement is an "accurate description of a defect" would need human judgment of free text. The pre-registration excludes that (no external translation, U3).
* The held-out deviations present (encoding-2, provisional) are R3, R7, R8 and R14 on build-3caf. No represented hypothesis describes any of them.

## 9. Published evidence, redaction and reproducibility (D112)

* `evidence/gw2/p7-pilot/` is the operator's results pack, published with the GW1 redaction rules (`scripts/gw2-p7-redact.ts`, deterministic). Those rules cover the user profile path, Kane recording and local session ids, account links, `test_url`, the pid, absolute balances and the operator's folder path.
* 19 of 191 files change. The rest are byte for byte, including every hypothesis, note, session, evaluation, the judgment graph, the raw seals, the pre-registration and the external execution ledger.
* `REDACTION_RECORD.json` gives each file's original and published sha256 and the rules applied, plus the metering on the originals.
* **Original hashes are kept.**
  * Each `RAW_SEAL.json` and each graph node's provenance hold the sha256 of the original raw Kane output.
  * The record maps every redacted file to that same original hash (`rawSeals[].matchesOriginal` is true for all 12 sealed files).
  * The originals stay with the operator and are not in the repository.
* **What verifies on the published copy** (`tests/gw2-p7-published.test.ts`):
  * every published file matches its recorded hash;
  * no identifier remains;
  * only raw Kane output, balance fields and path-bearing logs are redacted;
  * the external record verifies as an unchanged hash chain (7 entries).
  * Integrity of the published copy fails exactly the 6 checks that hash the redacted raw files: 3 raw seals, the graph, the freeze and the seal. It also fails "pre-registration unchanged", on the gate file only, after D111.
* **To re-run the evaluations or the 20/20 integrity check, use the originals at `c066db2`**: unpack the operator's pack into `evidence/gw2/p7-pilot/` of a `c066db2` checkout, then run `p6-steps.ts integrity` against a scratch copy of the external record.

## 10. Gate (D111)

`PAID_RESEARCH_EXECUTION` is `'disabled'` again, restored in its own commit (`1de300e`). The tests are back to their strict original assertions.

## 11. Limitations

* **Exploratory only.** There is no control and no matched comparison. GW1 is not a control. Three sessions are case studies. No claim of improvement is made.
* **Contamination (T25).** The defects are public, so detection figures are not unbiased rates. Here detection was 0 anyway.
* **Encoding-2 is provisional.** Readings against the spec are exploratory, not authoritative.
* **Fidelity is author-declared.** The verifier does not check whether a representation says what its statement says (§6.6).
* **Correlated outcome checks.** Held-out has 4 seed groups per build. Intervals are descriptive (§6.7).
* **Logical, not OS-level, isolation.** Kane was given only the URL, and the access journal shows only discovery pages.
* **Metering.** The balance delta and Kane's figure differ by 13.81 credits, with no known cause (§2).
* **Unequal session depth.** The three sessions used 21, 17 and 45 of 80 steps. Sessions 1 and 2 opened two pages and wrote no representations, so most of the content can only be read as free text.

## 12. Not done (needs separate approval)

* P8.
* Any further paid session.
* The matched architecture-off/on experiment.
* Any human or external judgment of the free-text hypotheses.

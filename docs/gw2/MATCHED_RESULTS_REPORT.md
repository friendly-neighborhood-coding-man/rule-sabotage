# GW2 matched comparison: results (GW2_MATCHED_EXECUTION_COMPLETED)

Ten sessions (M01–M10) were run: 5 control and 5 treatment, in 5 balanced blocks, with 20 Kane calls (kane-cli 0.10.4). They were executed by the operator on 2026-11-26 between 15:17 and 17:24 UTC.
* Candidate commit: `f578767e8200`.
* Reviewed commit: `8f810711d886`.
* The held-out evidence was opened once.

After the run, both execution gates were restored to disabled (D160). The published, redacted evidence is in `evidence/gw2/matched-run/`; see `REDACTION_RECORD.json` there.

The unit is the session. Everything below is descriptive. There is no significance claim, and no claim that GW2 improves agent performance.

## 1. Key findings

1. **The pre-registered block comparison does not support an improvement claim.**
   * Corrections on common held-out targets: 0 in every session of both arms.
   * Newly incorrect predictions: 0 in every session.
   * Only one block (4) has a numeric held-out accuracy difference.
2. **Every held-out accuracy gain is coverage narrowing, not self-correction.**
   * Treatment M06 rose by +0.106 while coverage fell by −0.042; it dropped 42 of 58 predictions.
   * Treatment M08 rose by +0.495 while coverage fell by −0.113; it dropped 113 of 129 predictions.
   * In both, the 16 predictions that remained were the same before and after: 13 correct and 3 incorrect.
   * The evaluation labels both "narrowing only".
3. **Missing machine-checkable representations dominate the result.** In 6 of 10 sessions no phase-1 hypothesis had a valid `gw2-hypothesis@1` representation: M01, M05 and M09 (control) and M02, M03 and M10 (treatment).
   * Kane wrote JSON that looked structured but broke the schema: bare literals instead of `{op:"const"}`, `left/right` instead of `args`, or a missing `op`.
   * Under the pre-registered rule (§7), their accuracy is "not available", never zero.
   * Blocks 1, 2, 3 and 5 therefore have no accuracy comparison.
4. **The treatment reached only 2 of 5 treatment sessions in practice.**
   * Feedback lists the observations that differ from a hypothesis's representation. Without a valid representation there is nothing to compare, so M02, M03 and M10 received 0 differing observations.
   * M06 received 25 of 50 and M08 received 25 of 158.
5. **Both sessions that received feedback acted on it; no control session revised anything.**
   * M06 revised its contradicted turn-start hypothesis in prose without a representation. That counts as harmful (structured representation lost).
   * M08 withdrew its contradicted hypothesis.
   * Control M04 kept a hypothesis set contradicted on 382 of 606 held-out targets (accuracy 0.370), without feedback and without changes.
   * This is a behavioural difference in 2 treatment sessions against 0 control sessions. It is not an accuracy improvement: nothing contradicted was turned into a correct prediction.
6. **Phase 2 rarely produced submissions.**
   * 8 of 10 phase-2 calls submitted nothing, although every one opened `revision.html` (access journals) and every one ended `passed`.
   * Kane's own run summaries say updates were submitted (M05: "submitted the resulting updates"). The server recorded none, so the summaries are not evidence of submission.
7. **Execution and integrity were clean.**
   * All 20 calls exited 0 with a valid run_end, no timeouts and all `WITHIN_CEILING`.
   * There were 0 integrity problems and no failed calls.
   * The evaluation was reproduced byte for byte (sha256 `f371c901…a354f2`).
   * Spend was 786.378 credits for the matched calls, or 918.421 including P7, against the 4,000 threshold.

## 2. Verification performed (independent of the operator run)

| Check | Result |
|---|---|
| Archive | `gw2-matched-results.zip` sha256 `3e7eee1d…f191ba9d`, 892 files. PACK names candidate `f578767e8200` and reviewed `8f810711d886` |
| External ledger | 113 entries, hash chain intact: 20 each of call-start, call-end, raw-seal and server-closed; 10 each of freeze-1, revision-page and freeze-2; 1 each of preregistered, gate-opened and evaluated. No call-refused, call-failed or experiment-stopped |
| `cli.ts verify` at the candidate commit | prereg sha256 `0a56b820…e1a420` binds both commits, the manifests, the dependency set and the schedule; `integrityProblems: []` |
| Per transaction | Each raw seal matches its files; each server session is closed and unviolated with the anchored seal; each access journal is at its anchored hash and status and served the intended site; each freeze matches its anchored graph prefix; each phase-2 site matches its construction record; each graph head holds |
| Evaluation | Replayed with the same code on a copy of the record truncated before `gate-opened`, with the original `openedAt`. The output is byte-identical to `EVALUATION.json`, and its sha256 equals the ledger's `evaluated` anchor |
| Spend | Σ balance delta 786.378 + P7 132.043 = 918.421, as reported. Kane's self-reported credits total 698.547 (the balance delta is 87.8 higher, as in P7) |
| Authorship | All 53 graph nodes are attributed `agent:kane-cli 0.10.4` under verified execution provenance. All submissions are nonce-valid |
| Arms | Revision pages: control feedback `null`; treatment feedback present for M02, M03, M06, M08 and M10 (capped at 25) |
| Gates | The candidate branch is restored to the reviewed tree (`4235f81`). The reviewed and results branches never had them enabled |

## 3. Per session (held-out, pre-registered measures)

| Block | Session | Arm | P1 forms (valid repr.) | P2 action | Held-out accuracy initial → final | Coverage change | Common-target corrections | Newly incorrect | Dropped (contraction) | Attribution |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | M01 | control | 3 (0) | none | n/a | 0 | 0 | 0 | 0 | no change |
| 1 | M02 | treatment | 3 (0) | none (feedback: 0 differing) | n/a | 0 | 0 | 0 | 0 | no change |
| 2 | M04 | control | 3 (2) | none | 0.370 → 0.370 | 0 | 0 | 0 | 0 | no change |
| 2 | M03 | treatment | 3 (0) | none (feedback: 0 differing) | n/a | 0 | 0 | 0 | 0 | no change |
| 3 | M05 | control | 3 (0) | none | n/a | 0 | 0 | 0 | 0 | no change |
| 3 | M06 | treatment | 2 (2) | revised H-2 (prose, representation lost) | 0.707 → 0.813 | −0.042 | 0 | 0 | 42 (28 correct, 14 incorrect) | narrowing only |
| 4 | M07 | control | 1 (1) | none | 1.000 → 1.000 | 0 | 0 | 0 | 0 | no change |
| 4 | M08 | treatment | 2 (2) | withdrew H-1 | 0.318 → 0.813 | −0.113 | 0 | 0 | 113 (28 correct, 85 incorrect) | narrowing only |
| 5 | M09 | control | 3 (0) | none | n/a | 0 | 0 | 0 | 0 | no change |
| 5 | M10 | treatment | 3 (0) | none (feedback: 0 differing) | n/a | 0 | 0 | 0 | 0 | no change |

* All 10 sessions are complete under the pre-registered definition: both calls exited 0 with a valid run_end, there were no timeouts and Freeze-2 exists.
* There were no phase-1 abstentions and no conflicting revisions or additions. The withdrawals are M08 H-1 only, and the representation loss is M06 H-2 only.
* **Discovery fit** (the partition the agent saw) rose in M06 (0.653 → 1.000) and M08 (0.373 → 1.000) by the same narrowing. M04 and M07 were unchanged (0.432, 1.000).
* **C readings** use spec encoding `rule-sabotage-v6.1.json`, which is *not authoritative*. Accurate descriptions of a defect: 0 in every session and both partitions.
* **Counterexample classes** (held-out contradictions):
  * M04: 382, of which 378 are an observed combination and 4 a novel combination. All 382 come from clauses already contradicted in discovery.
  * M06: 17 initially, 3 final.
  * M08: 88 initially, 3 final.
  * M06 and M08 each have 3 held-out contradictions with a novel individual value. These come from clauses not contradicted in discovery.
* **Revision effects** are based on prediction targets. Corrections are 0 in both arms. Harmful revisions: 1 (M06, structured representation lost). Mixed, narrowing-only pair effects and unchanged pairs are 0. The accuracy-only reading agrees: 0 corrections, 1 harmful.

## 4. Treatment − control within complete blocks (pre-registered comparison)

| Block | Pair | Held-out accuracy change | Coverage change | Corrections | Harmful | Contraction | Discovery-fit change |
|---|---|---|---|---|---|---|---|
| 1 | M02 − M01 | n/a | 0 | 0 | 0 | 0 | n/a |
| 2 | M03 − M04 | n/a | 0 | 0 | 0 | 0 | n/a |
| 3 | M06 − M05 | n/a | −0.042 | 0 | +1 | +42 | n/a |
| 4 | M08 − M07 | +0.495 | −0.113 | 0 | 0 | +113 | +0.627 |
| 5 | M10 − M09 | n/a | 0 | 0 | 0 | 0 | n/a |

Block 4 shows a held-out accuracy difference of +0.495. It is narrowing only: no correction on common targets, and 113 predictions dropped. Per pre-registration §9, it is not reported as self-correction or as evidence that feedback improves accuracy.

Per-arm lists:
* Accuracy change: control [n/a, 0, n/a, 0, n/a]; treatment [n/a, n/a, +0.106, +0.495, n/a].
* Coverage change: control [0, 0, 0, 0, 0]; treatment [0, 0, −0.042, −0.113, 0].

## 5. Distinguishing the four kinds of change (item 3)

| Kind | Where | Evidence |
|---|---|---|
| Genuine correction (a contradicted target made correct) | **None**, in either arm | `targets.heldout.common.corrected` = 0 in all 10 sessions |
| Coverage narrowing | M06 and M08 (treatment) | 42 and 113 dropped targets, no added ones; the accuracy rise comes only from removed predictions |
| Newly introduced errors | **None** | `becameIncorrect` + `added.incorrect` = 0 in all 10 |
| Missing submissions or representations | 6 sessions without any valid representation (3 per arm); 8 of 10 phase-2 calls with no submission; M06's revision without a representation | FREEZE-1 representation checks; FREEZE-2 submission counts; access journals (each phase-2 call opened `revision.html`) |

## 6. Costs, steps and time per call

| | Calls | Credits (balance delta) | Range | Steps | Kane time |
|---|---|---|---|---|---|
| Phase 1 | 10 | 518.619 | 31.994–78.051 (ceiling 300, estimate 248) | 314 | 23.5 min |
| Phase 2 | 10 | 267.759 | 18.692–37.799 (ceiling 150, estimate 124) | 96 | 11.7 min |
| Control / treatment | 10 / 10 | 388.081 / 398.297 | | | |

Per-call values are in `REDACTION_RECORD.json` (`metering`) and in the evaluation (`sessions[].calls`).

## 7. Limitations and caveats

* **Sample size.** Five sessions per arm, and an accuracy comparison in only one block. This is a case comparison.
* **The representation failure is a confound for the treatment.** The feedback could only reach sessions that wrote a valid representation, and that ability was not under experimental control. No post-hoc repair of the representations was made, because the pre-registration rules it out.
* **Shared hypotheses across sessions.** M06 and M08 wrote the same Freeze hypothesis (identical representation), so their final sets score identically (13 correct, 3 incorrect).
* **Kane's self-reports are unreliable as records.** Its summaries describe submissions that the server never received.
* **C readings are not authoritative**, because the spec encoding is not reviewed.
* **T25 contamination caveat.** This applies to both arms. P7 is historical, not a control.
* **Published balances.** The ledger records absolute balances, so the published ledger is redacted. Its hash chain is over the original lines; `REDACTION_RECORD.json` lists every original line's sha256 and records that the chain verified on the originals. EVALUATION.json and PREREGISTRATION.json are published byte for byte at their anchored hashes.

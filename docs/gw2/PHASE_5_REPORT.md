# GW2 Phase 5 report: new deterministic evidence, held-out prediction, discrimination, real-engine mutation validation

**Status: `PHASE_5_READY_FOR_REVIEW`.** P6 has not been started. No paid call was made.

Branch `claude/gw2-p5`, stacked on `claude/gw2-p4` (PR #26, which carries the separate P4-corrections commit `55f1a04`).
Nothing was merged, deployed or force-pushed.

**Constraints held:**
* Zero Kane calls and zero runtime model inference calls.
* No authorization-gate change (`PAID_RESEARCH_EXECUTION = 'disabled'`).
* No agent-generated code executed.
* No frozen GW1 artifact, playable-engine file or vendored-runner file changed. `npm run gw2:verify` checks this.
* No historical evidence regenerated. GW1 and the P3/P4 fixtures are unchanged. The P4 fixture's v2 evaluation was appended, not rewritten.
* No test weakened or deleted.

The new engine observations were generated with **unchanged** builds, as authorized by Q6 (D73). Builds are git-ignored materialized copies, as in GW1, and were removed after each run.

Commits on this branch:

| Commit | Content |
|---|---|
| `e81bf81` | **Freeze, before any P5 observation:** generator, P5 scripts, generation and partition procedures with build hashes, limited R5/R12 situations, encoding-2 |
| `1ef08df` | Generated observations (experiment and validation runs) and the real-engine mutation validation |
| last | Seal, held-out scoring, discrimination, the Q20 field, the experimental partition, the demonstration, tests and this report |

## 1. Summary

| Priority | Result |
|---|---|
| P4 fixes | Done in a separate commit on PR #26: outcome-level support, cross-variant invariance, field-level correspondence, and denominators (D74–D77) |
| New deterministic evidence | 42 scripted cases and 24 matches on QX-41/QX-73 (experiment run), plus 84 cases on clean/B1/B2/B3 (validation run). Both come from one procedure frozen in its own commit, with complete provenance |
| Real-engine mutation validation | Probes and verifier both behave as expected on all four single-defect builds; no unexpected deviation (§4) |
| Held-out scoring | `heldout.ts`: discovery fit and held-out prediction are reported separately. Rates are given at outcome-check, situation and case/match-unit level, each with k, n and a Wilson 95% interval |
| Discrimination | `discriminate.ts`: per pair of candidates, predictions are classified as identical, contradictory with outcome (separating), contradictory without outcome, or non-overlapping. Verdicts never say "equivalent" |
| Reproducibility | Hash-frozen generation, a deterministic partition, a verified seal and freeze, and recomputation tests |

**AC-P4.6** is now `MET_WITH_SYNTHETIC_FIXTURES — ENGINE_VALIDATION_DEFERRED` (D69). The deferred engine validation is complete (§4).

## 2. Generation provenance (Q6, D73, D78–D79)

### Procedure

`evidence/gw2/procedures/generation-p5-1.json` (`gw2-generation-procedure@1`, frozen `2026-11-25T15:25:32Z` in commit `e81bf81`) fixes the following by SHA-256:
* the generator code: `generate.ts`, `scenarios-p5.ts`, `scenarios.ts`, the adapter, `builds.ts`, `rules-doc.ts`, `evidence.ts` and `weights.ts`;
* `mutations.json`;
* the whole materialized source tree of each build. The QX-41 tree equals the `gt-clean` tree, which is the unchanged engine.

It also fixes the following, without hashing:
* scripts: the 11 GW1 scripts and 10 P5 scripts;
* seeds 98001–98006, disjoint from GW1's 97001–97008;
* first movers: both;
* policy: `softmax-v2`;
* the selection rule: every script on every build, and every seed × first mover × build. All outputs are kept, nothing is filtered, and there is no regeneration.

### What `generate.ts run` refuses

* any hash mismatch;
* a start before the freeze time;
* an existing output directory.

### P5 scripts (`scenarios-p5.ts`, D79)

| Script | Purpose |
|---|---|
| `send-home-human/-ai` | Q17: R12 |
| `placement-human/-ai` | Q17: R5. Covers both a placement next to a piece and a placement on an enemy effect |
| `multicell-human/-ai` | Q21: R8 clause 3 |
| `matrix-haste`, `matrix-freeze`, `matrix-home` | Q21: R7. Each side enters an own and an enemy cell within one case |
| `matrix-shield` | Q21: R7/R14. Both sides enter while shielded |

Before the freeze, the P5 scripts were dry-run once on QX-41 only, to check that they execute. Those outputs were discarded; the procedure notes disclose this.

### Runs and provenance

| Run | Output | Builds | Observations |
|---|---|---|---|
| experiment | `evidence/gw2/p5-experiment/generated/` | QX-41, QX-73 (QA evidence builds) | 42 cases, 24 matches |
| validation | `evidence/gw2/p5-validation/generated/` | gt-clean, gt-B1, gt-B2, gt-B3 | 84 cases |

`PROVENANCE.json` records the following for each run:
* procedure hash and freeze time;
* start and generation times;
* node version;
* commit;
* code hashes;
* per-build mutation ids, source-tree hash and every file hash;
* per-script hashes;
* counts;
* the bundle hash.

A test checks bundle hash = provenance, generation after the freeze, build trees = frozen, and counts = scripts × builds (+ seeds × first movers × builds).

## 3. Partition manifests (`evidence/gw2/p5-experiment/partitions/`)

The partition used the frozen procedure `partition-p5-1.json` (frozen with the generation procedure) and is an experimental partition, not a fixture: the bundle was generated after the freeze.

| | Discovery | Held-out |
|---|---|---|
| Scripts | adjacent-placement, freeze-ai, matrix-haste, matrix-home, matrix-shield, multicell-ai, placement-ai, send-home-ai, shield-ai, shove-ai, shove-chain-ai, teleport-human, walk-twice | freeze-human, matrix-freeze, multicell-human, placement-human, send-home-human, shield-human, shove-chain-human, shove-human |
| Seeds | 98001, 98002, 98004, 98005, 98006 | 98003 |
| Cases / matches | 26 / 20 | 16 / 4 |
| Rules covered | R1–R15 | all except R4 |

* Discovery share: 0.697 (target 0.7). 1,015,808 candidate splits were considered.
* Manifest hashes are in `PARTITION.json`.
* Leak check on the served directory: **no leak** in 49 files (`LEAK_CHECK.json`). Residual observable clues: 11 effect names and 4 engine messages.
* The hypothesis form includes the optional structured field (`--structured-field`, D81). The P3/P4 partitions are byte-identical to before (test).
* **This directory has no session, freeze or evaluation opening.** It is ready for P7 (D85).

**Held-out is small.** Coverage-first selection put one seed (2 matches per build) and 8 scripts in held-out, so there are about 10 independent units per build. This is reported, not changed: changing it would be selection (T22).

## 4. Real-engine single-defect validation (D69, AC-P4.6 completed)

`gamewatch/gw2/validate-mutations.ts` produces `evidence/gw2/p5-validation/MUTATION_VALIDATION.json`. The expected deviations were declared in code from `mutations.json` "intendedViolation" before the analysis.

**(a) Private probes.** These are probeShield, probeChain, probeActions, controlWalk and controlFreeze, run directly on each engine for both sides. All match the documented expectations:
* B1: a shielded Human is hit and sent home, while a shielded AI is protected.
* B2: a cell reached by forced arrival stays live and fires again.
* B3: the first mover gets 4 actions and the second mover 3.
* Everything else matches clean.

**(b) Verifier (O↔S, encoding-2) on the recorded validation cases:**

| Build | R3 | R5 | R7 | R8 | R12 | R14 | Expected deviations | Observed |
|---|---|---|---|---|---|---|---|---|
| clean | conforms | conforms | conforms | conforms | conforms | conforms | none | none |
| B1 | conforms | conforms | **deviates** (4 situations) | conforms | conforms | **deviates** (2) | R7, R14 | R7, R14 |
| B2 | conforms | conforms | conforms | **deviates** (2) | conforms | conforms | R8 | R8 |
| B3 | **deviates** (51 of 94 turn starts) | conforms | conforms | conforms | conforms | conforms | R3 | R3 |

* Every deviation's witnesses match the intended violation:
  * B1/R14: shielded Human entries.
  * B1/R7: shielded entries.
  * B2/R8: forced arrivals.
  * B3/R3: first-mover turns.
* **No unexpected deviation and no expected deviation missing.**
* R8 now **conforms** on clean, because the multi-cell cases evaluate clause 3 (Q21). In P4 it was insufficient-evidence.
* Unexpected behaviour: none observed. Under B2, R7 evaluates 35 situations rather than 33 on the other builds, because a live forced-arrival cell fires again. The extra entries are consistent across sides.

## 5. Held-out results (test-double demonstration, `evidence/gw2/p5-demo/`)

**Setup.**
* The same frozen bundle was partitioned into its own directory (byte-identical partitions apart from the experiment path).
* One scripted test-double session submitted 11 items: 7 with a typed structured representation (one of them not valid JSON), 2 free text only that an operator test double translated, 1 abstention, and 1 free-text-only item.
* Then: freeze, submitter representations, translations, seal (9 representations, ledger empty), and the three-way, held-out and discrimination evaluations through the gate.
* **Every submission is a scripted test double. Nothing here measures an agent.**

The table shows **unit-level** held-out rates (independent cases and matches, Wilson 95%). The outcome-check rates (descriptive) are in the JSON. "Coverage" means the representation made a held-out prediction in that many of the situations of its kind.

| Hypothesis (abridged; origin) | Build | Discovery fit | Held-out outcome checks | Held-out units | Coverage |
|---|---|---|---|---|---|
| H-1 first mover +1 (submitter) | QX-73 | fits (300) | 68/68 [0.95, 1.00] | 10/10 [0.72, 1.00] | 68/68 |
| H-1 | QX-41 | contradicted | 72/144 [0.42, 0.58] | 0/10 [0.00, 0.28] | 144/144 |
| H-2 pieces + extras (submitter; competes with H-1) | QX-41 | fits (421) | 144/144 [0.97, 1.00] | 10/10 [0.72, 1.00] | 144/144 |
| H-2 | QX-73 | contradicted | 33/68 [0.37, 0.60] | 0/10 [0.00, 0.28] | 68/68 |
| H-3 three actions (submitter) | QX-41 | contradicted | 60/144 [0.34, 0.50] | **8/10** [0.49, 0.94] | 144/144 |
| H-4 asymmetric shield (submitter) | QX-73 | fits (3) | 2/2 [0.34, 1.00] | 1/1 [0.21, 1.00] | 1/48 |
| H-5 shield protects any piece (submitter; competes with H-4) | QX-41 | fits (3) | 2/2 | 1/1 | 1/106 |
| H-6 pushed-onto cell stays (external translation) | QX-73 | fits (1) | 1/1 | 1/1 | 10/48 |
| H-7 send home (submitter) | both | fits (5) | 1/1 | 1/1 | 1 |
| H-8 no placement next to a piece (external translation) | both | fits (2) | 1/1 | 1/1 | 1/15 |
| H-9 freeze only on the other side (submitter, not valid JSON) | – | not-representable (parse error recorded, nothing repaired) | | | |
| H-10 abstention | – | own column, not scored | | | |
| H-11 free text only | – | no sealed representation | | | |

**Reading the table.**
* H-3 shows why unit and check rates are kept apart. On QX-41 its outcome-check accuracy is 0.42, but 8 of 10 units have no error: all of its errors fall in the two matches, where pieces leave the board.
* The effect-entry claims (H-4 to H-8) have 1–2 held-out units per build. Their intervals are uninformative, and the report says so rather than implying support.

**Columns:**
* 10 hypotheses and 1 abstention.
* Submitter: 7 representations (6 represented, 1 not representable).
* External translation: 2 representations (both represented).
* 1 hypothesis without a representation.

The two origins are never pooled.

**Spec reference (encoding-2, provisional) on held-out.**
* QX-41 conforms to every encoded record.
* QX-73 deviates on R3, R8 and R14.
* QX-73 **conforms on R7 in held-out**, because held-out has no matched shielded entries: `matrix-shield` went to discovery. In discovery, QX-73 deviates on R7. Partition scoping still changes what can be detected (P4 finding). B1 is detected in held-out through R14.

## 6. Discrimination results (`discrimination-3.json`)

There are 76 pairs. Declared competitors are listed first.

| Pair | Build | Discovery | Held-out | Held-out separating pairs: outcome matches |
|---|---|---|---|---|
| H-1 vs H-2 (declared) | QX-73 | separated | separated | H-1 35, H-2 0 |
| H-1 vs H-2 | QX-41 | separated | separated | H-1 0, H-2 72 |
| H-2 vs H-3 (declared) | QX-41 | separated | separated | H-2 84, H-3 0 |
| H-2 vs H-3 | QX-73 | separated | separated | H-2 3, H-3 4, neither 5 |
| H-4 vs H-5 (declared) | QX-73 / QX-41 | separated | separated | H-4 2 / H-5 2 |
| H-1 vs spec R3 | QX-73 | separated | separated | H-1 35, R3 0 |

* Each separating entry lists the situation, field, both predictions and the recorded outcome.
* Pairs that predict different fields are `no-common-predictions`.
* In these data every declared competitor pair was **already separated on discovery**. The scripted competitors differ wherever pieces leave the board or a shield is entered.
* The "agree on discovery, separated on held-out" case (AC-P5.2) and the "indistinguishable on the available evidence" case (AC-P5.3) are therefore demonstrated with fixtures in the tests, and were not observed in the demonstration.

## 7. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC-P5.1 held-out not read before freeze | met | File-access assertion: `fs.readFileSync` is spied (including named imports). On an unfrozen experiment, and on a frozen but unsealed one, held-out scoring and discrimination refuse and read nothing under `heldout/` or `eval/`, not even as bytes. No ledger opening is recorded. A mutation that opens the gate before checking the seal is caught |
| AC-P5.2 separated with separating situations | met | Fixture: identical on all 3 discovery turns, separated on held-out at `M-3/t5`, with both predictions and the outcome. Demonstration: declared competitors separated with exact predictions |
| AC-P5.3 indistinguishable, not "equivalent" | met | Fixture verdict `indistinguishable-on-available-evidence` with the reason. The words "equivalent", "proved" and "always" are absent from both reports |
| AC-P5.4 abstentions in their own column | met | Adding an abstention leaves every scored figure byte-identical. An abstention is never a discrimination candidate |
| AC-P5.5 denominators and intervals | met | A recursive test checks that every `rate` in the report has an integer k and n, a unit, and a Wilson 95% interval, or null when n = 0. Unit-level (case/match) rates are separate from the descriptive situation-level ones |

Also tested:
* the seal: written before any opening; a late representation is ignored and listed; sealing after an opening is refused; an edited seal is refused; an external translation that does not declare no-access cannot be sealed;
* Q20: a submitter representation is verbatim JSON.parse output with the submitter as author; unreadable JSON is recorded, not repaired; the schema text contains no rule;
* the generation procedure: hash, regeneration and pre-freeze refusals;
* provenance consistency;
* the committed demonstration and experiment directories verify, and the experiment is unopened.

## 8. Reproducible tests

| Suite | Result |
|---|---|
| `npm test` | 324 tests: 318 pass, 0 fail, 5 cancelled (baseline), 1 skipped (baseline) |
| `npm run test:gw2` | 94 tests, 0 fail (82 after the P4 corrections + 12 P5 tests in `tests/gw2-p5.test.ts`) |
| `npm run gw2:verify` | OK: 135 frozen files unchanged |

**Cancellations and skips.**
* The 5 cancellations are the baseline `tests/playtest-referee.test.ts` cancellations ("Promise resolution is still pending…"). They are not counted as passes.
* The 1 skip is the baseline Windows-only `.cmd` shim test.

**Adapted, not weakened.** `tests/gw2-blind.test.ts` (P3 fixture byte-identity) required the structured field to be opt-in. It is opt-in, and that test passes unchanged.

To reproduce:

```
npm run -s gw2:generate -- run evidence/gw2/procedures/generation-p5-1.json experiment /tmp/x   # writes only into a NEW directory; refuses an existing one
npm run -s gw2:validate-mutations -- evidence/gw2/procedures/generation-p5-1.json evidence/gw2/p5-validation/generated /tmp/mv.json
npm run -s gw2:p5-demo -- evidence/gw2/p5-experiment/generated/bundle.json /tmp/p5 --at 2026-11-25T20:00:00.000Z
node --experimental-strip-types --no-warnings=ExperimentalWarning --test tests/gw2-p5.test.ts
npm run test:gw2 && npm run gw2:verify && npm test
```

A re-generation into a new directory reproduces the scripted cases exactly. Matches are expected to be reproducible from their seeds, as in GW1. Only the `ms` timing field and the generation times differ.

## 9. Limitations

* Every hypothesis is a scripted test double, so no agent was measured.
* The representations in the demonstration were written by the script that wrote the free text. Real submitter-authored representations may be absent, malformed or unfaithful. That is reported, never repaired.
* Encoding-2 is provisional and unreviewed (Q3), and 9 of 15 rules are unencoded (D72). R5 is encoded in the refusal direction only; R12 only for the "fires and moves home" event, not the destination square.
* Held-out is small (≈10 units per build; the effect-entry claims have 1–2 units). Intervals are wide by construction (T22).
* The operator has seen held-out outcomes of this bundle through the demonstration (T21). Generation and partition were frozen beforehand, so nothing can be selected in response.
* The schema text lists the observable field names. This is a semantic clue (T23).
* `nearAnyPiece` does not tell own pieces from enemy pieces. A hypothesis about "next to own pieces only" cannot be represented and would be reported as such.
* Discrimination compares law predictions only. Invariance clauses are compared through their held-out comparison counts, not pairwise.

## 10. Unresolved decisions (for the operator)

* **U1. Held-out size for P7.** Accept the p5-partition-1 split (1 held-out seed), or freeze a P7 procedure with more seeds or matches before generating P7's own observations? Recommendation: freeze a P7 generation with at least 12 seeds, so held-out has at least 4 seeds, and keep P5's bundle as the dry-run set.
* **U2. Encoding review.** Encoding-2 (R3, R5, R7, R8, R12, R14) needs an operator review before any confirmatory use (`--confirmatory` is refused until then).
* **U3. Translation in P7.** Q20 allows operator translation. Decide whether P7 uses it for free-text-only submissions, and who translates without spec or held-out access.
* **U4. Matrix scripts across partitions.** Should a P7 partition procedure require at least one shielded matrix case in each partition? This would make R7/B1 detectable in held-out. It is a rule change to the selection order and must be frozen before generation.

## 11. P6/P7 readiness checklist

| Item | Status |
|---|---|
| Frozen GW1 baseline intact (`gw2:verify`) | ready |
| Paid execution gate `PAID_RESEARCH_EXECUTION = 'disabled'` | unchanged; P6/P7 must not change it without explicit operator authorization |
| Blind discovery site with leak check, structured field opt-in, session server with journal, explicit closure | ready (P3, D81) |
| Import → freeze@2 → submitter representations → seal → gate | ready (P3, P5) |
| Verifier v2, held-out scoring, discrimination, all through the gate | ready (P4 corrections, P5) |
| Experimental observations and unopened partition (`evidence/gw2/p5-experiment/`) | ready; held-out is small (U1) |
| Real-engine mutation validation | done (§4) |
| Spec encoding review (Q3) | **open** (U2) |
| SkillFlow integration and an end-to-end test-double run through the real Kane CLI wiring without a paid call | **P6 work, not started** |
| Operator decisions U1–U4 | **open** |

**Minimum feasible real-Kane experiment (P7), for authorization later:**

| Element | Configuration |
|---|---|
| Builds | QX-41 and QX-73, unchanged, labels neutralized per partition (as now) |
| Evidence | A freshly frozen P7 generation (or `evidence/gw2/p5-experiment/` if U1 is accepted), partitioned before any session |
| Sessions | 3 independent discovery sessions (declared in `SESSIONS.json`), blind mode, one Kane run each, journal on, server-close seal |
| Submissions | Free text with the optional structured field; no translation step unless U3 says so |
| Pipeline | Freeze after all sessions close → submitter representations → seal → three-way, held-out and discrimination, once, through the gate |
| Metrics | Per hypothesis: representation availability and status (by origin), discovery fit, held-out unit-level accuracy with Wilson 95%, separating situations for competitors, abstentions apart. Per session: which planted defects (B1–B3) have an accurate defect description on held-out. No composite score |
| Budget and calls | Kane calls only, about 3 runs. Zero other model calls. Paid execution only after explicit operator authorization in P7 |
| Stop rules | Any leak-check failure, freeze or seal failure, or gate refusal stops the run. No re-run after results are seen |

---
Reproduce, review, and stop: this is `PHASE_5_READY_FOR_REVIEW`.

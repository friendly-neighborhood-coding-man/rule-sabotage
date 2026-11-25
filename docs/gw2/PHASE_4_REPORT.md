# GW2 Phase 4 report: deterministic TypeScript verification and three-way comparison

**Status: `PHASE_4_READY_FOR_REVIEW`.** P5 has not been started.

Branch `claude/gw2-p4`, stacked on `claude/gw2-p3` (PR #25) → `claude/gw2-p2` (#24) → `claude/gw2-p1` (#23) →
`claude/gw2-phase-0` (#22). Nothing was merged, deployed or force-pushed. Zero Kane calls, zero runtime model inference
calls, no authorization-gate change (`PAID_RESEARCH_EXECUTION = 'disabled'`, `server/balance/v4/kanebudget.ts:23`), no
generated code executed, no frozen GW1 artifact, playable-engine file or vendored-runner file changed, no historical
evidence regenerated, **no new engine observation generated**, no test weakened or deleted.

## 1. P3 corrections (separate commit `7070706` on `claude/gw2-p3`, PR #25)

Explicit session closure with per-session seals (`session-close.ts`, Q19), `gw2-freeze@2` after all declared sessions
are closed and imported, evaluation readers bound to the manifest hashes accepted at freeze time, the evaluation ledger
verified before it is extended or relied on, fail-closed freeze and ledger records, and the distinction between
raw-byte integrity reads and semantic reads. Details: PHASE_3_REPORT §11; DECISIONS D51–D58; 7 regression tests in
`tests/gw2-p3-corrections.test.ts`. The GW1-derived P3 fixture is unchanged and remains non-experimental; its
`gw2-freeze@1` still verifies but can no longer open evaluation (it predates explicit closure).

## 2. What P4 adds

| Path | Role |
|---|---|
| `gamewatch/gw2/hypothesis.ts` | `gamewatch/gw2-hypothesis@1`: hand-written validator and interpreter; closed operator set; three-valued logic |
| `gamewatch/gw2/situations.ts` | deterministic extraction of `turn-start` and `effect-entry` situations from recorded observations |
| `gamewatch/gw2/verify.ts` | H↔O, H↔S, O↔S per partition and build; combined readings; identifiability; gate → evaluation nodes |
| `gamewatch/gw2/spec-encodings/rule-sabotage-v6.1.json` | provisional, unreviewed encoding of R3, R7, R8, R14; 11 rules explicitly unencoded |
| `gamewatch/gw2/judgments.ts` | node kind `representation` + relation `represents` (one hypothesis parent; nothing else may use it) |
| `gamewatch/gw2/p4-demo.ts` | test-double pipeline: partition → session → close → import → freeze → representations → verify |
| `evidence/gw2/p4-fixture/` | the committed run of that pipeline on the GW1 bundle (a labelled NON-experimental fixture) |
| `tests/gw2-verify.test.ts`, `tests/gw2-p4-fixtures.ts` | 14 tests; synthetic single-defect probe fixtures |
| `docs/gw2/DECISIONS.md` | D59–D68 (Q3, Q4 resolved), Q20–Q22 |

## 3. Representation and interpreter (`gw2-hypothesis@1`)

A representation is a list of clauses about one situation kind each:

* **law**: `{form: "law", situation, when?, expect: [{field, equals}]}`. In every situation of that kind where `when`
  holds, outcome `field` equals the expression `equals`. `when` and `equals` may use only **input** fields; `field` must
  be an **outcome** field, so a law predicts outcomes from inputs.
* **invariance**: `{form: "invariance", situation, when?, groupBy, vary, outcomes}`. Situations that agree on
  `groupBy` and differ only in `vary` have the same `outcomes`.

Operators (closed): `const field eq ne lt le gt ge and or not in add sub`. Expressions are JSON trees walked by a
`switch`; no string is ever evaluated (AC-P4.2). An unknown field value propagates (three-valued logic) and excludes the
situation as missing evidence. Validation is per clause: `represented`, `partially-represented` (the failing clauses are
reported with reasons and not evaluated) or `not-representable`. Nothing is repaired, strengthened or weakened.

**Originals and representations.** Hypotheses are imported verbatim (P3). A structured representation is a separate
`representation` node that `represents` one hypothesis, with its own author, the hash of the statement it translates
and a declared fidelity (`faithful`, `narrower`, `broader`, `different`, `unknown`). The verifier uses only
representations appended before the first evaluation opening, and every verdict says it applies to the structured
representation only. Free text is never interpreted by the verifier.

## 4. Situations

| Kind | Inputs | Outcomes | From |
|---|---|---|---|
| `turn-start` | build, side, turn, isFirstMover, piecesOnBoard, pendingBonus | actionsGranted | case `turn-start` events; match turn rows |
| `effect-entry` | build, effect, effectKind, pieceSide, effectOwner, ownerRelation, arrival, chainDepth, capped, pieceShieldedBefore, multiCell | fired, absorbed, cellUsedUp, shieldAfter, otherCellsRemain | `effect-fired`, `shield-absorbed`, `chain-limit` events (+ before/after states in cases) |

Match rows carry events but no board states, so pieceShieldedBefore, cellUsedUp, shieldAfter, otherCellsRemain and
multiCell are **unknown** there, and a `shield-absorbed` event names no effect. Every derivation is listed in the module
header so it can be challenged. GW1 bundle: 1,962 situations (1,012 turn starts, 950 effect entries).

## 5. Specification encoding inventory (Q3: provisional, unreviewed)

| Rule | Status | Scope / reason |
|---|---|---|
| R3 | encoded (1 law) | turn starts: actionsGranted = piecesOnBoard + pendingBonus. Frozen pieces counted (encoder's reading); current-turn "+1 action" not part of actionsGranted; what an action moves not encoded |
| R7 | encoded (1 invariance) | effect entries in cases: same fired/absorbed/cellUsedUp/shieldAfter across piece side and effect owner within (effectKind, arrival, shielded, capped); destinations, directions, freeze duration not compared; matches do not contribute |
| R8 | encoded (3 laws) | not past the chain cap: cell used up; unshielded entry fires; other cells of a multi-cell effect stay. Chain cap taken from the recorded chain-limit event |
| R14 | encoded (1 law) | shielded entry not past the cap: absorbed, not fired, shield used up, cell used up. "Does not apply" read as absorbed and not fired |
| R1, R2, R4, R5, R6, R9, R10, R11, R12, R13, R15 | **unencoded** | need movement, placement, game-level or random-outcome situations that P4 does not extract; each has a stated reason in the file |

Each record is bound to its rule text by SHA-256; a changed text makes the record `source-mismatch` and unused. The file
records source, version (ruleset `rule-sabotage/v6.1-all-piece-proximity@1`), encoding author, scope and limitations.
`--confirmatory` is refused while the review status is not `accepted` (tested). Every report says the H↔S and O↔S
results are relative to a provisional draft.

## 6. Relations and readings

| Relation | Values | Evaluated on |
|---|---|---|
| H↔O | fits · contradicted · insufficient-evidence · not-evaluable | the representation against recorded outcomes |
| H↔S | agrees · disagrees · insufficient-evidence · not-evaluable | predictions of H and of a spec law on the same situations and outcome field (inputs only) |
| O↔S | conforms · deviates · insufficient-evidence · not-evaluable | the spec record against recorded outcomes |

Each result gives partition, build, situation kind, situations of that kind, applicable, evaluated, excluded with
reasons (`not applicable`, `missing input (…)`, `missing outcome (…)`, `hypothesis silent`, `spec silent`, `no comparison
partner`), witness and counter-example counts (lists capped at 12) and a sentence "… on N evaluated situation(s) from
partition P, build B". A multi-clause record fits/conforms only when every clause does. Hypothesis-level summaries:
`supported-on-evaluated-situations`, `unsupported` (contradicted), `insufficient-evidence`, `not-representable`,
`not-evaluable` (no representation), `explicit-abstention`. The three relations are never combined into a score.

**Accurate description of a defect** (D65) requires, for one rule, partition and build: H↔O fits, H↔S disagrees,
O↔S deviates, and in every disagreement situation with a recorded outcome, H fits and the build deviates (at least one
such situation). Disagreements without a recorded outcome are counted, not used. A test builds the case where the three
values hold on *different* situations: it is `unresolved-ambiguity`, not a defect description.

## 7. Example three-way verdicts (committed fixture `evidence/gw2/p4-fixture/`)

Scripted test double, one session `83d26eee33db3d37`, 7 hypotheses + 1 abstention frozen (`gw2-freeze@2`, anchor
`8:5353b688…`), 6 representation nodes, evaluation through the gate (ledger: one opening). Neutral build ids are mapped
to GW1 labels only in the report's operator view (read from `eval/` through the gate).

| Hypothesis (free text, abridged) | Partition / build | H↔O | H↔S | O↔S | Reading |
|---|---|---|---|---|---|
| H-1 first mover gets one more action each turn | discovery / QX-73 | fits (168 of 323 turn starts applicable, 168 evaluated) | disagrees R3 | deviates | **accurate description of a defect** (168 corresponding) |
| H-1 | discovery / QX-41 | contradicted (204) | disagrees R3 | conforms | hypothesis contradicted |
| H-1 | heldout / QX-73 | fits (58) | disagrees R3 | deviates | **accurate description of a defect** (58) |
| H-2 one action per piece + earned extras (competing with H-1) | heldout / QX-41 | fits (178) | agrees R3 | conforms | consistent with spec and observations |
| H-2 | heldout / QX-73 | contradicted (114) | agrees R3 | deviates | hypothesis contradicted (agrees with the spec, but not this build) |
| H-3 shield protects AI pieces, not Human ones | discovery / both | insufficient (Human clause: no shielded Human entry in discovery) | | | unresolved ambiguity |
| H-3 | heldout / QX-41 | contradicted (1) | disagrees R14 | conforms | hypothesis contradicted |
| H-4 pushed-onto cells stay (declared *narrower* than its text) | discovery / QX-73 | fits (1 evaluated of 81 applicable; 80 in matches have no recorded outcome) | disagrees R8 | deviates | **accurate description of a defect** (1 corresponding, 80 without outcome) |
| H-5 effects get stronger later | – | not-representable (`gameStage`, `strength`, `mul`) | | | |
| H-6 unshielded piece sets effects off + shove distance (partially representable) | both partitions / QX-73 | fits (clause 1; clause 2 not representable, reported) | agrees R8 | deviates | relations do not correspond (the build deviates in outcomes H does not predict) |
| H-6 | both partitions / QX-41 | fits | agrees R8 | insufficient-evidence | unresolved ambiguity |
| H-7 abstention | – | explicit abstention | | | |
| H-8 AI places effects near the middle | – | not evaluable (no structured representation) | | | |

O↔S (implementation correctness, same fixture): R3 conforms on QX-41 (397 + 178) and deviates on QX-73 (168 of 323 and
58 of 114 turn starts, all first-mover turns); R8 deviates on QX-73 (forced arrivals) and is insufficient-evidence on
QX-41 (clause 3: no multi-cell entry recorded, Q21); R14 deviates on held-out QX-73 (shielded Human entry) and conforms
elsewhere; R7 conforms in every partition, because no partition holds shielded entries of both sides on QX-73 (shield
scripts were split by side between partitions). Partition scoping changes what can be detected.

## 8. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC-P4.1 determinism | met | same JSON across runs; the full pipeline on a CRLF copy of every partition file gives identical results |
| AC-P4.2 no codegen | met | static scan over all `gamewatch/gw2/*.ts` (no eval, Function, vm, require, computed import; child_process only in coverage.ts); verifier starts no process; string payloads are data |
| AC-P4.3 known answers | met | GW1 bundle: R3 conforms on QX-41 and deviates on QX-73 with turn rows (cases and matches) as witnesses, all on first-mover turns; first-mover +1 fits QX-73, disagrees with R3, reading accurate description of a defect, summary not "unsupported" |
| AC-P4.4 | met | unsupported operator → not-representable; fields never recorded (cellUsedUp in matches) and zero applicable situations → insufficient-evidence; none reported as contradicted |
| AC-P4.5 | met | every verdict carries partition, build and N; "equivalent", "proved", "always" absent from verifier output and verifier nodes |
| AC-P4.6 | met, adapted (D67) | synthetic single-defect probe fixtures: B1 → R7, R14 only; B2 → R8 only; B3 → R3 only; clean conforms to all four. Recorded QX-73: each deviation's witnesses are the corresponding situations |

Also tested: contradictory and self-contradictory hypotheses; partially representable; free-text vs structured fidelity;
non-identifiability ("3 actions" and R3 both fit and are not told apart); freeze and manifest violations refuse
evaluation; a representation appended after the first opening is excluded; source-text binding of the encoding;
confirmatory refusal; evaluation nodes immutable (re-evaluation appends); the committed fixture's report equals a fresh
evaluation of the same inputs read through the gate.

## 9. Tests and baseline comparison

| Suite | Baseline `d22d33e` | P3 (`5579abd`) | P4 (`claude/gw2-p4`) |
|---|---|---|---|
| `npm test` | 232: 226 pass, 5 cancelled, 1 skipped | 287: 281 / 5 / 1 | **308: 302 pass, 0 fail, 5 cancelled, 1 skipped** (exit 1, as at baseline) |
| `npm run test:gw2` | – | 57 | **78/78** (+7 P3-correction tests, +14 P4 tests) |
| `npm run gw2:verify` | OK | OK | OK: 135 frozen files match `d22d33e`; 23 reference-tier differences, all added files |
| `python gamewatch/vendor/verify.py` | OK | OK | OK (`da9785a030dd`) |

The 5 cancellations are the same `tests/playtest-referee.test.ts` tests as at the baseline ("Promise resolution is still
pending but the event loop has already resolved"), **not** counted as passes; the skip is the same Windows-only `.cmd`
shim test. Two existing tests were adapted for the P3 corrections, not weakened (PHASE_3_REPORT §11.3, and the
logging-off directory listing now includes `CLOSED.json`).

## 10. Limitations

* The fixture is GW1 data partitioned after the fact; the representations are scripted by a test double, not
  translations of real submissions (Q20). Nothing here measures an agent.
* The encoding is a provisional draft by Claude (Q3). Its readings (frozen pieces count for R3; "does not apply" =
  absorbed and not fired for R14) are choices that a reviewer may reject; H↔S and O↔S are relative to it.
* 11 of 15 rules are unencoded (Q22); R8 clause 3 has no recorded situation (Q21).
* Two situation kinds only. Matches contribute turn starts and partial effect entries; most effect-entry outcomes
  need board states and come from scripted cases (small numbers: e.g. R14 is decided by 1–2 entries per build).
* Situation derivations (arrival from chainDepth, pieceSide from the event in matches, shield tracking within a step)
  are readings of the record; an engine that reported events differently would change them.
* `fits` and `agrees` are finite: they hold on the evaluated situations only. The identifiability report lists only
  candidates that were actually submitted or encoded.
* AC-P4.6 uses hand-written synthetic fixtures for single-defect builds (D67); recorded single-defect observations
  would need engine runs (P5 at the earliest).
* Isolation remains logical (P3 §5); the gate is a code convention, and integrity is detection, not prevention.

## 11. Unresolved questions

Q20 (who translates free text into gw2-hypothesis@1), Q21 (a multi-cell scripted case for R8), Q22 (situation kinds for
the unencoded rules), and the earlier open Q6–Q9, Q11 in `DECISIONS.md`. Q3 and Q4 are resolved (D59, D60). Q17's
R5/R12 variants and new observation generation are P5 work and were not started.

## Reproduce (no Kane, no model provider)

```
git checkout claude/gw2-p4
node --experimental-strip-types --no-warnings=ExperimentalWarning --test tests/gw2-verify.test.ts tests/gw2-p3-corrections.test.ts
npm run test:gw2
npm run gw2:verify
npm run -s gw2:freeze -- verify evidence/gw2/p4-fixture
npm run -s gw2:p4-demo -- /tmp/p4-check --at 2026-11-25T16:00:00.000Z   # a fresh run (new random session id)
npm test   # expect 308: 302 pass, 0 fail, 5 cancelled (baseline), 1 skipped
```

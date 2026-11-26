# GW2 Extension V1: isolation boundaries, grouped dashboard, matched comparison (prepared)

**Status: GW2_EXTENSION_V1_READY_FOR_REVIEW.** Everything is offline and tested on the published P7 evidence, on temporary copies of it, and on test doubles.
* Executed: no Kane calls, no runtime inference, no paid calls, no gate opening.
* Unchanged: the paid gate (`'disabled'`), the game engine, the vendored runner, the GW1 dashboard, the GW2 review server, the blind site, the V0 dashboard (`evidence/gw2/ext-v0/p7-operator`) and every P7 file.
* Preserved: all historical evidence, metrics, submissions, the pre-registration, and the three independent operator outputs (A, B, C).

This answers the operator's conditional approval of V0 (2026-11-26 05:42 UTC). Decisions D129–D135.

## 1. Experimental isolation

| Requirement | Implementation | Regression test (`tests/gw2-ext-v1.test.ts`) |
|---|---|---|
| Agent-facing feedback consumes only the authenticated, frozen pre-evaluation graph prefix | `ext/anchored.ts` `authenticatedPrefix`, used by `inputs.ts loadSubmissions` for every output (D129) | P7: 11 lines and 32,628 bytes read of a longer file. Garbage after line 11 is never parsed (same nodes). Refused: a truncated graph, an edited prefix line, an edited FREEZE.json, an edited or missing ledger, a seal head that differs from its anchor, and a consistently forged record whose seal includes the first evaluation node |
| Feedback partition bound to the anchored pre-registration and its manifest hash | `anchored.ts feedbackBinding`, enforced in `partitionReader` (D130) | Refused: no binding (P7 itself), a missing role, foreign build ids, a manifest swapped after pre-registration, an edited pre-registration. Accepted when bound: 390 feedback items |
| Test-only construction separate from authorized runtime activation | `feedback-core.ts` (construction), `feedback-testonly.ts` (marks `testOnly`), `feedback.ts` (runtime) (D131) | Runtime refuses while disabled, even with a full authorization. The activation rule is tested on doubles (arm, pre-registration hash, run id, written authorization). Test-only output is never servable. `feedback.ts` does not import the test-only module |
| Operator-facing spec discrepancies inaccessible through the blinded agent's routes | Operator-only meta marker on every V1 page; `ext/serving-guard.ts blindSiteProblems` (D133) | The real `startGw2Server` serves the discovery site with the V1 dashboard as a sibling folder. All 63 site pages (and `/`) return 200 and contain no spec rule text or operator marker. 11 operator and traversal routes (`/unmatched-actions.html`, `/../ops/…`, `%2e%2e`, `%2f`, backslash, `/../spec.json`) never return 200 |

How the prefix is read: `readLinePrefix` reads one byte at a time and stops at the N-th newline, so no byte of a later node is read. The prefix is then verified as its own graph (structure, hash chain, the seal anchor at line N, the freeze anchor at line 8).

## 2. Operator dashboard V1 (output B regrouped)

`npm run gw2:ext-dashboard-v1 -- evidence/gw2/p7-pilot/exp --out <new dir>`. The committed P7 copy is in `evidence/gw2/ext-v1/p7-operator/`; a test checks it byte for byte against the renderer.

* **Grouping.** Build → rule → outcome field, as expandable `<details>` groups. A build with no unmatched actions (build-06b9) is still listed.
* **Kept separate.** Discrepancy types (distinct expected → observed patterns, value or cross-build invariance) and observation counts (observations, by partition, situations, units) are separate columns and are never combined.
* **Partition filter.** Discovery and held-out checkboxes hide rows and groups. The counts in each summary stay fixed.
* **Evidence.** Every observation stays in its group, with its notification id, partition, situation and kind, unit, JSON pointer, compared situation, expected and observed value. A test checks that the groups hold exactly the 338 notifications and that every field matches.
* **Unchanged wording.** The provisional-encoding warning is still at the top. Every row reads "unmatched (not classified)", and nothing is called a bug or defect.

P7 build-3caf (QX-73):

| Rule | Field(s) | Discrepancy types | Observations (discovery / held-out) |
|---|---|---|---|
| R3 | actionsGranted | 3 (3→4: 131, 1→2: 114, 2→3: 75) | 320 (222 / 98) |
| R7 | absorbed, fired | 4 (cross-build invariance) | 10 (6 / 4) |
| R8 | cellUsedUp | 1 | 2 (1 / 1) |
| R14 | absorbed, fired | 2 | 6 (2 / 4) |

## 3. Matched comparison (prepared, not executable)

`ext/comparison-plan.ts` and the draft pre-registration [`EXTENSION_V1_MATCHED_COMPARISON_DRAFT.md`](EXTENSION_V1_MATCHED_COMPARISON_DRAFT.md) (D134).
* **Arms.** Control gets no hypothesis feedback. Treatment gets deterministic H↔O feedback (discovery evidence only, from the prefix at freeze-1).
* **Shared object.** Both arms reference one frozen object. It holds the evidence binding, both objectives (byte-identical, with sha256), the representation requirement, the revision phase with the same `revision.html` shell, the budgets (phase 1: 80 steps, 2700 s, 8 forms; phase 2: 40 steps, 1350 s, 8 forms), the CLI pin and the specification policy.
* **Specification.** Hidden from Kane in both arms.
* **Check.** `unmatchedFactors(control, treatment)` is empty. Tests show that it detects a one-step budget change and a one-character change to an objective.
* **Not executable.** `executable: false` and the gate stays `'disabled'`. Running it needs a written authorization, the external pre-registration, a scoped gate commit, and `AGENT_FEEDBACK_ENABLED = true` in a reviewed commit.
* **V0 plan and P7.** The V0 `control-plan.ts` is kept. P7 stays a historical baseline record, not an arm.

## 4. Changes to existing code and tests

* `inputs.ts`: `loadSubmissions` now uses the authenticated prefix. The V0 version verified the whole file and then sliced it. `partitionReader` now enforces the feedback binding.
* `feedback.ts`: the V0 `buildAgentFeedback(…, {enable: true})` is removed. Tests use `feedback-testonly.ts`.
* `tests/gw2-ext-v0.test.ts`: the same assertions now call the test-only builder, and "not enabled" is now asserted on the runtime path. The feedback-partition test moved to the V1 file, with all its V0 assertions kept and new ones added. No assertion was removed or loosened.
* `package.json`: adds `gw2:ext-dashboard-v1`.

## 5. Tests

* `test:gw2`: 153 of 153 pass, including 8 new V1 tests.
* `gw2:verify`: OK.
* `gamewatch/vendor/verify.py`: OK.
* The V0 dashboard determinism test still passes byte for byte.

## 6. Limitations

* **The serving guard is a check, not a barrier.** It and the route test cover the GW2 review server as it is. A future server that serves other directories would need the same test.
* **What the prefix authentication can prove.** It is as strong as the operator's control of the external record (Q14). There are no signatures.
* **The partition filter needs JavaScript.** With scripting off, all rows show.
* **The comparison is still a proposal.** Arm sizes (Q8), the seed and the feedback cap are open pre-registration decisions.

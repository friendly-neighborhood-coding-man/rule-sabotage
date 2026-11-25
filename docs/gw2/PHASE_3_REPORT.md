# GW2 Phase 3 report: Blind Rule Discovery evidence and submission protocol

**Status: `PHASE_3_CONDITIONALLY_APPROVED` (operator, 2026-11-25 14:22 UTC); corrections in §11.** The rest of this report
is as submitted for review.

Branch `claude/gw2-p3`, stacked on `claude/gw2-p2` (PR #24) → `claude/gw2-p1` (#23) → `claude/gw2-phase-0` (#22).
Nothing was merged, deployed or force-pushed. No Kane call, no runtime model call, no authorization-gate change
(`PAID_RESEARCH_EXECUTION = 'disabled'`, `server/balance/v4/kanebudget.ts:23`), no generated code executed, no frozen GW1
artifact, playable engine file or vendored-runner file changed, no historical evidence regenerated, no test weakened
or deleted. Hypotheses are not scored.

## 1. P2 corrections (recorded separately)

The P2 corrections from the Phase 2 review are a separate commit on `claude/gw2-p2` (`35fb4b3`, PR #24), made before
any P3 work: Kane execution provenance with listed historical limitations, four verification levels, the terminal-node
regression test, strict anchors, the single-writer contract, role-based ids (Q16). Details: `PHASE_2_REPORT.md` §9 and
`DECISIONS.md` D35–D41 (Q14–Q16 resolved).

## 2. What P3 adds

| File | Role |
|---|---|
| `evidence/gw2/procedures/partition-p3-1.json` | the frozen partition procedure (Q5): seeds, scripts, variant rule, salt, 0.7 target, coverage map and ground-truth refs by hash, selection order |
| `gamewatch/gw2/partition.ts` | discovery / spec / heldout / eval partitions with independent manifests, INPUT_BOUNDARY.json, PARTITION.json |
| `gamewatch/gw2/blind-site.ts` | blind discovery site (neutral ids, hypothesis form) and spec-guided mode (unchanged GW1 dashboard into a new dir) |
| `gamewatch/gw2/leak-check.ts` | leak check over the actual served directory; residual semantic clues |
| `gamewatch/gw2/serve.ts` (changed) | `/hypothesis` endpoint, nonce on `hypothesis.html`, `hypothesis` journal events; counter fix (D50) |
| `gamewatch/gw2/session.ts`, `journal.ts` (changed) | hypotheses joined to the journal like findings; validity covers them |
| `gamewatch/gw2/judgments.ts` (changed) | node kind `abstention` |
| `gamewatch/gw2/import-session.ts` | explicit, idempotent, resumable session import (Q15) |
| `gamewatch/gw2/freeze.ts` | hypothesis freeze, freeze verification, evaluation gate and ledger |
| `gamewatch/gw2/p3-demo.ts` | test-double demonstration: session → import → freeze |
| `evidence/gw2/p3-fixture/` | the GW1 bundle partitioned as a labelled fixture, one test-double session, graph, FREEZE.json, LEAK_CHECK.json |
| `tests/gw2-blind.test.ts` | 10 tests: AC-P3.1–AC-P3.6, Q5, import, freeze |

## 3. Partitions (Q5)

**Procedure** (`partition-p3-1.json`, frozen 2026-11-25T14:30Z, D42/D44): units are match seeds (all their matches, both
builds, both first movers) and case scripts (their cases on both builds). Each `-human`/`-ai` script pair is split
across the partitions; single-variant scripts go wholly to one side; any non-empty proper subset of seeds may go to
discovery. Candidates (here 32,512) are scored lexicographically: rules covered in both partitions, then the smaller
coverage count, then closeness of the discovery share to 0.7, then a salt-fixed order. Coverage uses the adapter's
coverage map with `gaps.ts` semantics (every pattern of a rule on every build). Agent output is never an input.

**Fixture result** (`evidence/gw2/p3-fixture/partitions/PARTITION.json`; the GW1 bundle predates the freeze, so every
manifest says **FIXTURE … NOT an experimental partition**, D45):

| | discovery | held-out |
|---|---|---|
| scripts | adjacent-placement, freeze-ai, shield-ai, shove-ai, shove-chain-ai, teleport-human, walk-twice | freeze-human, shield-human, shove-chain-human, shove-human |
| seeds | 97002, 97003, 97004, 97005, 97007, 97008 | 97001, 97006 |
| observations | 14 cases + 24 matches = 38 (70.4 %) | 8 cases + 8 matches = 16 |
| rules covered | 14 of 15 (not **R12**) | 14 of 15 (not **R5**) |

**Rules not adequately evaluable in one partition:** R12 (send home) is not exercised on every build in discovery;
R5 (placement refusal) is not exercised in held-out (only `adjacent-placement` refuses a placement and it has no
variant). Every rule is covered in the whole bundle. Q17 proposes adding variant scripts before the P7 procedure.

**Partitions and manifests.** `discovery/` (blind observations + the site), `spec/` (rules, sources, builds),
`heldout/` (blind, own ids), `eval/` (neutral→original id maps, assignment, coverage, ground truth by hash only). Each
has its own `MANIFEST.json` (LF-normalised SHA-256 of every file); PARTITION.json records the four manifest hashes.
Re-running the procedure reproduces all partition files byte for byte (tested).

## 4. Blind view and leak check (Q10, AC-P3.1)

Kept (observable in normal gameplay): states, events, engine and referee messages, effect names, the opponent policy
name, sides, results. Removed or neutralised: rule list, game name and version string (the version string itself
states R5), script titles (replaced by per-partition labels `S-xxxx` so same-script cases stay comparable), build labels
and notes (`build-xxxx` per partition), seeds, timings, generator metadata; ids re-hashed per partition. The findings
form has no "rule" field.

`gamewatch/gw2/leak-check.ts` over the actual served directory (41 files): **all 23 checks PASS**
(`evidence/gw2/p3-fixture/LEAK_CHECK.json`): rule ids R1–R15; 8-word runs from rule texts; original script titles and
ids; build labels and notes; mutation ids, classes and description runs; ids of another partition and original ids;
seeds; generator metadata and source text; game name and version; script tags, embedded JSON, data attributes,
comments; meta tags; navigation inside the directory; form actions; anonymous file names; served directory = boundary
listing = discovery manifest; no spec/heldout/eval file in it. The test injects 15 kinds of leak plus a revealing file
name and checks that each is caught.

**Residual semantic clues (recorded, not removed):** all 11 effect names ("+1 action", "Freeze", "Send home",
"Shield", "Shove …", "Teleport") name the effect a rule describes; the referee's refusal message shares 6 words with R5
("the 8 squares around any piece", Q18); the end-of-game messages share "all 3 pieces across" with R2. **Blind
Discovery does not exclude prior model knowledge of Rule Sabotage**, nor these semantic hints: an agent may recognise
the game from its mechanics and recall what it knows.

Mutation ids (B1–B3) are also board-square names, so they are only flagged in a mutation context; that check is weaker
than the others.

## 5. Isolation actually implemented (AC-P3.2, AC-P3.5)

**Logical separation on one machine; no OS sandbox, container or separate account.** The review server is started
with `--site <exp>/partitions/discovery/site` and serves only files under it (GW1 path containment; `..`, encoded `..`
and held-out ids answer 404, tested). `INPUT_BOUNDARY.json` lists exactly the served files. spec/, heldout/ and eval/
sit on the same disk: an agent with shell or file access could read them. Semantic reading of held-out and eval files is only
*sanctioned* through `freeze.ts openEvaluation`, which is a convention enforced in code paths we control, not by the
operating system. Raw-byte integrity reads are a separate category (§11.2).

## 6. Submission, import, freeze

* **Submission (D47).** `hypothesis.html`: free text, optional trigger/condition/effect, confidence, competing-with
  (`H-n`), evidence, explicit abstain. Stored verbatim, journalled, never overwritten; the server never writes the graph.
* **Import (Q15, D48).** `import-session.ts` turns every note and hypothesis line into a node with its P1 verification,
  counted flag and session validity; invalid-nonce submissions are `unverified-submitter`; logging-off sessions stay
  `unverified-session-note`; Kane sessions need stored Kane output; declared competition becomes `alternative-to`;
  completeness and coverage become separate `evaluation` nodes. Idempotent, resumable after a partial import, refuses
  conflicting content. The freeze refuses while any session is not fully imported, so the step cannot be omitted.
* **Freeze (D49).** `FREEZE.json` (written once): graph anchor, every hypothesis/abstention id, sessions, partition
  record hash. `openEvaluation` refuses before the freeze, after a violation (edited or re-hashed frozen node, edited
  session line, rewritten tail, changed partitions, malformed record), and logs every opening and refusal. Later
  hypotheses are kept and listed as not covered. Nothing is scored.

Fixture demonstration (`evidence/gw2/p3-fixture/`): one test-double session `35b91b1993e9d1a6` with two competing
hypotheses (H-2 `alternative-to` H-1), one abstention and one finding; completeness (must-access policy, `incomplete`)
and coverage as two evaluation nodes; graph anchor `6:16cc7031638763b4f62d1e657a3807f483a19a9c56c088c036b237930e64bbd2`;
freeze verified (3 frozen, 0 not covered).

## 7. Acceptance criteria

| AC | Result | Evidence (`tests/gw2-blind.test.ts`) |
|---|---|---|
| AC-P3.1 blind leak check | **PASS** | "AC-P3.1": fixture passes all 23 checks; committed LEAK_CHECK.json = fresh run; 16 injected leaks each caught |
| AC-P3.2 served directory contains only discovery files | **PASS** | "AC-P3.2": boundary listing = served files; traversal, other partitions and held-out ids → 404; leak check's boundary/manifest checks |
| AC-P3.3 two competing hypotheses + one abstention → three nodes, none overwrites another | **PASS** | "AC-P3.3": 3 stored lines, 3 nodes, `alternative-to` link, verbatim; partial import resumed; idempotent; conflict refused; plus "import never promotes" |
| AC-P3.4 evaluation before the freeze refused; edited hypothesis fails verify | **PASS** | "AC-P3.4" and "a freeze after an evaluation was opened is refused" |
| AC-P3.5 report states isolation level and prior knowledge | **PASS** | §4, §5; "AC-P3.5" checks this report |
| AC-P3.6 spec-guided mode = GW1 site byte for byte in a new directory | **PASS** | "AC-P3.6": all 56 files identical; frozen path refused |

Also: "Q5 partition" (determinism, disjointness, coverage report, fixture label, refusals, no agent input, manifest
change detection) and "committed P3 fixture" (partitions, graph, freeze and leak report verify). Two hand mutation
checks: disabling the freeze check fails AC-P3.4; disabling the import conflict check fails AC-P3.3.

## 8. Tests and baseline comparison

| Suite | Baseline `d22d33e` | P1 | P2 (`b85a298`) | P3 (`claude/gw2-p3`) |
|---|---|---|---|---|
| `npm test` | 232: 226 pass, 5 cancelled, 1 skipped | 257: 251 / 5 / 1 | 271: 265 / 5 / 1 | **287: 281 pass, 0 fail, 5 cancelled, 1 skipped** (exit 1, as at baseline) |
| `npm run test:gw2` | – | 27 | 41 | **57/57** (blind 10, judgments 15, policy 16, access 9, compat 5, GW1 serve 2) |
| `npm run gw2:verify` | OK | OK | OK | OK: 135 frozen files match `d22d33e`; 17 reference-tier differences, all added files |
| `python gamewatch/vendor/verify.py` | OK | OK | OK | OK (`da9785a030dd`) |

+16 since P2: 6 P2-correction tests and 10 P3 tests. The 5 cancellations are the same `tests/playtest-referee.test.ts`
tests as at the baseline ("Promise resolution is still pending but the event loop has already resolved"), **not**
counted as passes; the skip is the same Windows-only `.cmd` shim test. No new failure, cancellation or skip.

## 9. Limitations

* The fixture is GW1 data partitioned after the fact; it demonstrates the mechanism, not an experimental partition.
* Isolation is logical only (§5); the gate is a code convention.
* Effect names and some engine messages are strong semantic hints (§4); prior knowledge of the game is not excluded.
* The procedure supports variant pairs only (families of more than two variants are refused); single-variant scripts
  cannot appear in both partitions, which is why R5 has no held-out coverage.
* The mutation-id check is weak for ids that are also board squares.
* Structured hypothesis fields are stored as text; their mapping to `gw2-hypothesis@1` and any evaluation are P4.
* The freeze is per experiment; FREEZE.json and the ledger are in the experiment directory; per Q14 the P7 anchors
  belong in an operator-controlled record outside the repository.

## 10. Unresolved questions

Q17 (add variant scripts so R5/R12 are covered in both partitions), Q18 (the referee message that nearly states R5),
Q19 (per-experiment vs per-session freeze), and the earlier open Q3, Q4, Q6–Q9, Q11 in `DECISIONS.md`.

## 11. Corrections after the Phase 3 review (separate commit)

Operator decision PHASE_3_CONDITIONALLY_APPROVED (2026-11-25 14:22 UTC). Corrections D54–D58, decisions Q17–Q19
(D51–D53). The GW1-derived fixture `evidence/gw2/p3-fixture/` is unchanged and remains non-experimental.

### 11.1 What changed

| Correction | Before | After | Regression test (`tests/gw2-p3-corrections.test.ts`) |
|---|---|---|---|
| Explicit session closure | a logging-off session counted as "ended"; a logging-on one by its journal session-end | `CLOSED.json` (`gw2-session-close@1`) written by server close (logging on and off) or declared by an operator role with a reason; seals the 4 raw output files; import and freeze need `closed` | closure ×3 (server close seals both conditions; unclosed refused; declaration keeps validity; forged server-close invalid; changed/added/removed outputs) |
| Freeze after all declared sessions (Q19) | every session found had to be imported | `SESSIONS.json` declares the count; exactly that many closed and imported sessions; seals and plan recorded; `gw2-freeze@2` | Q19 freeze test |
| Readers bound to the frozen manifests | the reader re-verified the *current* manifest, so a consistent replacement manifest + files passed | the reader compares the current MANIFEST.json hash to the hash accepted at freeze time, then the file to that manifest's entry | gate: consistent replacement refused; file changed under the accepted manifest refused |
| Ledger verified before use | appended without checking the existing chain | `verifyLedger` (JSON, canonical, seq, prev, event, time, termination); nothing appended to an invalid ledger; freeze and gate refuse | gate ledger test (8 corruptions, nothing appended in each) |
| Fail-closed freeze and ledger records | partial field checks | full shape validation before any field is used; `@1` freezes cannot open evaluation | gate malformed-freeze test (12 malformations, @1 refusal, open session refusal) |

### 11.2 Raw-byte integrity reads vs semantic reads of held-out and eval files

| Reader | What it does with `heldout/` and `eval/` files | Category |
|---|---|---|
| `partition.ts partition` | writes them (once) | creation |
| `partition.ts verifyManifest`, `verifyPartitions` | reads each file's bytes to compute the LF-normalised SHA-256; parses only `MANIFEST.json` and `PARTITION.json` (hash lists) | raw-byte integrity |
| `freeze.ts freezeHypotheses`, `verifyFreeze` | the same integrity reads, through `verifyPartitions` | raw-byte integrity |
| `leak-check.ts` | parses `spec/spec.json` and `eval/eval.json` (rule texts, id maps) to build the forbidden-term list; compares served files to the hashes in the spec/heldout/eval manifests; never parses `heldout/observations.json` | semantic (spec, eval) by an operator-side tool before any session; raw-byte (heldout) |
| `freeze.ts openEvaluation` → `read()` | returns file content for analysis, after the freeze and the ledger checks, bound to the frozen manifests | **semantic, sanctioned** |
| tests (`gw2-blind`, `gw2-p3-corrections`) | on scratch copies of the fixture: parse `eval.json` id maps to inject leaks and probe the server; read held-out via the gate; overwrite bytes to test detection | test fixtures only |

Hashing reads every byte, so "raw-byte" means the content is reduced to a hash and not interpreted, not that it is
unread. None of this is enforced by the operating system (§5): a developer, operator or agent with file access can read
any partition, and the GW1-derived fixture content is public GW1 evidence in any case.

### 11.3 Tests after the corrections

`npm run test:gw2`: 64/64 (57 + 7 correction tests). Existing tests were adapted, not weakened: scratch experiments
declare a session plan; the import-conflict test now first asserts that the seal catches the edit, then re-seals by
operator declaration and still asserts the graph conflict check. Full-suite numbers are in PHASE_4_REPORT.md.

## Reproduce (no Kane, no model provider)

```
git checkout claude/gw2-p3
node --experimental-strip-types --no-warnings=ExperimentalWarning --test tests/gw2-blind.test.ts
npm run test:gw2
npm run gw2:verify
npm run -s gw2:leak-check -- evidence/gw2/p3-fixture
npm run -s gw2:freeze -- verify evidence/gw2/p3-fixture
npm run -s gw2:partition -- evidence/gw2/procedures/partition-p3-1.json evidence/gamewatch/evidence.json /tmp/p3-check --fixture
npm test   # expect 287: 281 pass, 0 fail, 5 cancelled (baseline), 1 skipped
```

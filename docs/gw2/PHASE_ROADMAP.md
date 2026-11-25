# GW2 phase roadmap (P1–P8)

Status: **Phase 0 proposal for review.** Phase boundaries are **[AGREED]**; each phase's contract and acceptance
criteria below are **[PROVISIONAL]** until the operator accepts this document. Tags as in
[`COMMON_SPEC.md`](COMMON_SPEC.md).

## Rules for every phase

* **R-1 [AGREED]** P0–P6 make **no paid Kane call and no runtime inference call**. Agents are replaced by
  deterministic test doubles (scripted HTTP clients or fixture files). P7 is the first phase that may call Kane or a
  model, and only with the operator's explicit authorization for that experiment.
* **R-2 [AGREED]** No change to frozen GW1 artifacts, the playable engine (`server/v6/**`) or the vendored runner.
  Each phase ends with `node scripts/gw2-baseline.mjs verify` exiting 0, and every reference-tier difference it lists
  is named in the phase report.
* **R-3 [AGREED]** No execution of generated code. **[PROVISIONAL]** Checked mechanically from P3 on: no GW2 module
  calls `eval`, `new Function`, `vm.*`, dynamic `import()` of a path taken from agent input, or `child_process` with
  agent-supplied arguments (a static scan test, `tests/gw2-no-codegen.test.ts`).
* **R-4 [PROVISIONAL]** One branch per phase, stacked (`claude/gw2-p1` on `claude/gw2-phase-0`, …), one draft PR
  each, the operator reviews and stops each phase. No phase starts automatically after the previous one.
* **R-5 [PROVISIONAL]** Every phase report states, separately: what was implemented, what was tested, what was not
  tested, what was not claimed.
* **R-6 [PROVISIONAL]** New code under `gamewatch/gw2/`, new tests under `tests/gw2-*.test.ts`, new evidence under
  `evidence/gw2/`. Reference-tier GW1 files are extended only where the roadmap says so.

---

## P1 — Hybrid policy and reliable page-access recording

**Goal.** Know, from server-side records, which evidence a review session was served, and evaluate declared developer
requirements against those records, separately from findings.

**Contract.**
* `gamewatch/kane/serve.ts` (reference tier, extended): every request (GET and POST) appends one line to
  `access.ndjson` beside the notes file: `{ at, nonce, method, path, status, bytes, sha256 }`. Off by default for
  backward compatibility? **[OPEN] Q2** (recommendation: on by default, because it only adds a file).
* `gamewatch/gw2/policy.ts`: validate `gamewatch/gw2-policy@1` (COMMON_SPEC §2.A) and evaluate it against
  `access.ndjson` + `notes.ndjson` + the bundle. Output `completeness.json`: per requirement `satisfied |
  unsatisfied | not-evaluable` with the access/citation records it used.
* `gamewatch/gw2/coverage.ts`: one table per finding and for the session end: **accessed (server)**,
  **visited (reconstructed from agent log, if available)**, **cited**, and **cited without recorded access**.
  Reuses `audit.ts`'s citation logic and the follow-up's `visit-coverage.mjs` unchanged.

**Acceptance criteria.**
* **AC-P1.1** A scripted HTTP client (test double) requesting pages X, Y and submitting one form produces exactly
  those access lines, in order, with the session nonce; no line for pages not requested.
* **AC-P1.2** Access logging changes no response body: every page served with logging on is byte-identical to the
  page served with it off (test over all 56 GW1 pages, from a scratch copy).
* **AC-P1.3** An empty policy yields `completeness: not-declared` and never a pass/fail for the session.
* **AC-P1.4** A policy `must-access [C-a, C-b]` is `unsatisfied` when the double accessed only C-a and `satisfied`
  when it accessed both; a finding by the same double is reported unchanged in both cases (detection ≠ completeness).
* **AC-P1.5** A finding that cites an id with no recorded access is flagged `cited-without-access`; the GW1 fixture
  reproduces the follow-up's result for finding 1 (C-9fc650) from `stdout.ndjson` and states that no server access log
  exists for GW1.
* **AC-P1.6** Completeness evaluation never reads `run_end.summary` or any agent-written summary.
* **AC-P1.7** `npm test` passes except failures already present at the baseline (PHASE_0_REPORT §6); baseline
  verify exits 0.

**Not in P1.** Blind mode, hypotheses, judgment graph, Kane.

---

## P2 — Immutable judgment and hypothesis graph

**Goal.** Every judgment (finding, hypothesis, evaluation, challenge, correction) is an append-only node linked to its
predecessors, with author identity and version, evidence references, criteria and reasons.

**Contract.**
* `gamewatch/gw2/judgments.ts`: append, read, verify for `judgments.ndjson` (COMMON_SPEC §2.E): content-hash ids,
  per-line hash chain, closed relation set (`supersedes`, `challenges`, `refines`, `alternative-to`, `evaluates`),
  closed author kinds (`agent`, `verifier`, `operator`, `test-double`).
* Importer for GW1: the three findings in `evidence/gamewatch/review/notes.ndjson` and the post-freeze labels in
  `gamewatch/private/evaluation/labels.json` become nodes **by reference** (path + sha256), in a new file under
  `evidence/gw2/gw1-import/`. Neither source file is touched.

**Acceptance criteria.**
* **AC-P2.1** Appending never rewrites earlier bytes (file prefix before append == file after append, byte for byte).
* **AC-P2.2** Editing, deleting or reordering any line makes `verify` fail and name the first bad line.
* **AC-P2.3** A node whose parent id does not exist is refused; a cycle is impossible by construction (parents must
  already exist).
* **AC-P2.4** A verifier rejection of a hypothesis is a new `evaluates` node; a later operator `challenges` node
  against that evaluation is accepted, and both remain readable. No API deletes or overwrites a node.
* **AC-P2.5** An `evaluates` node without evaluator id, evaluator version, evidence refs, criteria and reason is
  refused.
* **AC-P2.6** Provenance: a node labelled `agent: kane` must reference a stored Kane output file by hash; a
  test-double node can never carry the Kane label (same rule as `tests/balance-v3.test.ts`).
* **AC-P2.7** GW1 import: 3 finding nodes + 3 label nodes, each `evaluates`-linked; the GW1 clean finding and the two
  anomaly findings coexist; baseline verify exits 0.

**Not in P2.** Deciding which node is "true". Views over the graph are read-only reports.

---

## P3 — Blind Rule Discovery evidence and submission protocol

**Goal.** Produce discovery material without the specification, collect hypotheses (including competing ones and
abstentions), and freeze them before any evaluation.

**Contract.**
* `gamewatch/gw2/partition.ts`: from a bundle produced by the unchanged `run-evidence.ts`, write four partitions
  (`discovery/`, `spec/`, `heldout/`, `eval/`), each with its own LF-normalised SHA-256 manifest. Discovery and
  held-out observations come from disjoint seeds/scripts (exact split **[OPEN] Q5**).
* Blind view: `game.rules` removed, script titles replaced by neutral labels, build notes removed, ids re-hashed per
  partition so the same case has different ids in different partitions.
* Dashboard blind mode writing to `evidence/gw2/<exp>/site/` (never `evidence/gamewatch/site/`), plus a hypothesis
  form: free text (always kept), optional structured fields (`gw2-hypothesis@1`, P4), confidence, competing-with,
  and an explicit **abstain** option.
* Freeze: `hypotheses/FREEZE.json` written before any `eval/` file is read; evaluation refuses hypotheses submitted
  after the freeze time or not covered by the freeze.

**Acceptance criteria.**
* **AC-P3.1** Blind leak check: no page in the blind site contains any rule id (`R1`–`R15`), any 8-word run from the
  rule texts, any original script title, any build note, or any id from another partition; page names stay anonymous.
* **AC-P3.2** Partition isolation: the served directory contains only `discovery/` files (listing of the declared
  input boundary, checked against the manifests).
* **AC-P3.3** A test double submitting two competing hypotheses and one abstention produces three graph nodes; none
  overwrites another.
* **AC-P3.4** Evaluation started before the freeze is refused; a hypothesis edited after the freeze fails verify.
* **AC-P3.5** The phase report states the isolation level actually implemented (logical separation on one machine;
  no OS sandbox) and that Blind Discovery does not exclude prior model knowledge of Rule Sabotage.
* **AC-P3.6** Spec-guided mode still produces the GW1-equivalent site in a new directory, byte-identical to
  `evidence/gamewatch/site/` when given the frozen GW1 bundle.

**Not in P3.** Scoring hypotheses.

---

## P4 — Deterministic TypeScript verification and three-way comparison

**Goal.** Evaluate structured hypotheses against observations and the specification, deterministically, and report
the three relations separately.

**Contract.**
* `gamewatch/gw2/hypothesis.ts`: hand-written validator for `gamewatch/gw2-hypothesis@1` (closed operator set,
  named fields of `GWState`/`GWEvent`/`GWTurnRow` only). Anything else → `not-representable`, original text kept.
* `gamewatch/gw2/verify.ts`: interpreter over recorded observations; produces H↔O, H↔S, O↔S per COMMON_SPEC §2.C
  with witnesses and counter-examples, and writes `evaluates` nodes (evaluator id + version + criteria).
* The specification is encoded once, by hand, as `gw2-hypothesis@1` records in `spec/` (R3, R7, R8, R14 first; the
  rest marked `not-representable` until encoded). **[OPEN] Q3**: who writes and reviews the spec encoding.

**Acceptance criteria.**
* **AC-P4.1** Determinism: same inputs give byte-identical output across two runs and on Linux/Windows line endings.
* **AC-P4.2** No codegen: the static scan (R-3) passes; the verifier has no code path that evaluates strings.
* **AC-P4.3** Known-answer fixtures on GW1 evidence: the R3 spec record is `conforms` on QX-41 and `deviates` on QX-73
  (B3), with the turn rows as witnesses; a hypothesis "first mover gets +1 action on its turns" is `fits` on QX-73,
  `disagrees` with R3, and is reported as **accurate description of a defect**, not as failed understanding.
* **AC-P4.4** A hypothesis using an operator outside the set is `not-representable`; one whose fields never occur in
  the evaluated evidence is `insufficient-evidence`; neither is reported as `contradicted`.
* **AC-P4.5** Every verdict states its scope ("on N evaluated situations from partition P"); the words "equivalent",
  "proved" and "always" do not appear in verifier output (text test).
* **AC-P4.6** Mutation sanity: the verifier detects each of B1–B3 against the spec records on the GW1 single-defect
  builds (reusing `gamewatch/private/probes.ts` situations as fixtures, read-only).

**Not in P4.** New situations generated by running the engine (that is P5, if Q6 is answered yes).

---

## P5 — Held-out evaluation and competing-hypothesis discrimination

**Goal.** Measure predictive accuracy on observations the agent never saw, and tell competing hypotheses apart.

**Contract.**
* `gamewatch/gw2/heldout.ts`: evaluate frozen hypotheses on `heldout/` only, after the freeze; report per hypothesis
  predicted / correct / contradicted / not-applicable.
* `gamewatch/gw2/discriminate.ts`: for a set of competing hypotheses that all fit discovery, find held-out situations
  where their predictions differ; report which situations separate them and which pairs remain indistinguishable.
* If Q6 = yes: deterministic situation generation by running the materialized build engines (engine code unchanged;
  new seeds and scripts), recorded as new observations with provenance.

**Acceptance criteria.**
* **AC-P5.1** Held-out files are never read before the hypothesis freeze (file-access assertion in tests).
* **AC-P5.2** Two fixture hypotheses that agree on all discovery observations but differ on held-out ones are
  separated, with the separating situations listed.
* **AC-P5.3** Two fixture hypotheses that agree on all available observations are reported **indistinguishable on
  the available evidence**, not "equivalent".
* **AC-P5.4** Abstentions are counted in their own column and never improve or worsen an accuracy figure.
* **AC-P5.5** Every reported rate carries its denominator and an interval (Wilson or exact binomial, already used in
  the repo's balance statistics).

---

## P6 — SkillFlow integration and end-to-end test-double validation

**Goal.** Run the whole GW2 pipeline as a SkillBook with test doubles in place of every agent, end to end.

**Contract.**
* New book `gamewatch/gw2/book.json` (the GW1 book is not edited), run by the **unchanged** vendored runner.
  Steps write small JSON verdict files so the runner's existing acceptance operators suffice.
* Paid and agent steps carry `authorization` gates exactly as GW1 does; in P6 they are routed to test doubles.
* A test-double suite covering: an accurate investigator, a careless one (cites without access), an
  over-abstaining one, an always-confident wrong one, and one that describes a defect accurately.

**Acceptance criteria.**
* **AC-P6.1** The book runs to `@done` with test doubles in a fresh clone with Node ≥ 22.10 and Python ≥ 3.9, no
  network, no model, no Kane, in under 10 minutes.
* **AC-P6.2** Without authorization files it stops with exit 2 at the first gated step, and no process for Kane or an
  agent CLI is started (process-spawn assertion).
* **AC-P6.3** The five doubles produce the expected separated metrics (EXPERIMENT_DESIGN §3): in particular the
  over-abstaining double does **not** rank above the accurate one on any reported dimension except "incorrect
  assertions", and the report says why.
* **AC-P6.4** `python gamewatch/vendor/verify.py` passes; `git diff d22d33e -- gamewatch/vendor` is empty.
* **AC-P6.5** Full `npm test` result and baseline verify are recorded in the phase report.

---

## P7 — Authorized real-agent experiments under controlled conditions

**Goal.** Run the pre-registered experiments of [`EXPERIMENT_DESIGN.md`](EXPERIMENT_DESIGN.md) with real agents.

**Contract.**
* Pre-registration file (hypotheses, conditions, budgets, seeds, metrics, stopping rules) frozen and hashed **before**
  the first call; the operator signs off the exact number of calls, credits/time budget and models.
* Each call uses the existing GW1 gate path (`kanebudget.ts`, single-use approval, run id) with a new run id; nothing
  enables the gate in a commit.
* Matched conditions: same evidence partitions, same step/time budget, same objective text apart from the
  manipulated factor.

**Acceptance criteria.**
* **AC-P7.1** The pre-registration hash precedes every run's start time in the ledger.
* **AC-P7.2** Number of calls and spend do not exceed the authorization; any deviation is recorded, not corrected.
* **AC-P7.3** Raw outputs are frozen before labelling; labels are written after the freeze, by a declared labeller.
* **AC-P7.4** All pre-registered metrics are reported, including unfavourable ones and null results.

---

## P8 — Independent reproduction and public reporting

**Goal.** Someone other than the authoring sessions reproduces the free parts and checks the paid parts' records.

**Acceptance criteria.**
* **AC-P8.1** A fresh clone reproduces every P1–P6 result and every P7 derived number from frozen raw outputs
  without any paid call.
* **AC-P8.2** An independent reviewer (named by the operator) confirms or disputes each headline claim; disputes are
  recorded as `challenges` nodes and published alongside.
* **AC-P8.3** The public report keeps GW1 and GW2 results separate, lists limitations first-class, and makes no
  claim beyond the pre-registered analyses.
* **AC-P8.4** Redaction follows the GW1 practice (recorded rules, original and published hashes).

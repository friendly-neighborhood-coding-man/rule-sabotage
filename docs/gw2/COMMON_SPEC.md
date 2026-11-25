# GW2 common specification

Status: **Phase 0 draft for review** (2026-11-25). Branch `claude/gw2-phase-0`, based on the GW1 submission commit
`d22d33eeed06370559fe016a2647965875fce42b`.

GW2 asks one question: **can an external, deterministic verification architecture make AI-driven game investigation
more trustworthy, without modifying the underlying AI model?** Nothing in this directory assumes the answer is yes.
Any improvement has to be shown by the experiments in [`EXPERIMENT_DESIGN.md`](EXPERIMENT_DESIGN.md).

Every statement below carries one of three tags:

* **[AGREED]**: stated by the operator in the GW2 Phase 0 brief (2026-11-25). Changing it needs the operator.
* **[PROVISIONAL]**: a design choice made in Phase 0 to make the agreed requirements concrete. A later phase may
  revise it with a recorded decision ([`DECISIONS.md`](DECISIONS.md)).
* **[OPEN]**: a consequential question Phase 0 does not resolve. Each one is listed in `DECISIONS.md` §Open questions.

Related documents: [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md) (what exists),
[`PHASE_ROADMAP.md`](PHASE_ROADMAP.md) (P1–P8 contracts), [`EXPERIMENT_DESIGN.md`](EXPERIMENT_DESIGN.md),
[`THREATS_TO_VALIDITY.md`](THREATS_TO_VALIDITY.md), [`BASELINE_MANIFEST.json`](BASELINE_MANIFEST.json),
[`PHASE_0_REPORT.md`](PHASE_0_REPORT.md).

## 1. GW1 preservation

* **[AGREED]** The GW1 submission, its findings, browser logs, experimental evidence, repair outputs and evaluation
  results are preserved. Frozen GW1 artifacts are never modified or regenerated in place.
* **[AGREED]** GW2 work never merges into the submission branch `claude/project-thread-1a20hc`.
* **[PROVISIONAL]** Two protection tiers, enforced by `node scripts/gw2-baseline.mjs verify`:

  | Tier | Paths | Rule |
  |---|---|---|
  | **frozen** (135 files) | `evidence/gamewatch/**`, `evidence/corrections/**`, `evidence/v6/gameplay-freeze.json`, `gamewatch/private/**`, `gamewatch/vendor/**`, `server/v6/**`, `docs/GW1_FINAL_REPORT.md`, `docs/SUBMISSION.md` | No change, removal or addition, ever. `verify` exits 1. |
  | **reference** (36 files) | the rest of `gamewatch/**`, `docs/GAMEWATCH.md`, `docs/DEMO.md`, `README.md` | GW1 implementation as submitted. Later phases may extend it; `verify` lists every difference so it is deliberate and visible in review. |

  `server/v6/**` is frozen because the brief forbids changes to the playable game engine. `gamewatch/vendor/**` is
  frozen because the brief forbids changes to the vendored SkillFlow runner (runner changes go upstream, then
  re-vendor, per `gamewatch/vendor/skillflow/VENDOR.json`, and that is outside P0–P6 unless the operator decides
  otherwise).
* **[PROVISIONAL]** New GW2 evidence is written under new paths (`evidence/gw2/<experiment-id>/`), never under
  `evidence/gamewatch/`. GW1 tools that write into `evidence/gamewatch/` (for example `gamewatch/kane/plan.ts`, which
  rewrites `evidence/gamewatch/review/PLAN.json`, and `gamewatch/dashboard.ts`, which deletes and rebuilds
  `evidence/gamewatch/site/`) are only run in a scratch checkout.

## 2. Architecture requirements

### A. Hybrid investigation policy

* **[AGREED]** Only explicitly declared developer requirements are enforced. A requirement names mandatory evidence,
  rules or verification conditions. Its investigation-completeness condition cannot pass until they are satisfied.
* **[AGREED]** All other investigation stays autonomous and observational. Exhaustive page visitation is **not**
  required by default.
* **[AGREED]** Investigation completeness is separate from anomaly detection. A verified anomaly may coexist with an
  incomplete investigation, and both are reported.
* **[PROVISIONAL]** A declared requirement is a small JSON record (`gamewatch/gw2-policy@1`):
  `{ id, kind: "must-access" | "must-cite" | "must-evaluate", targets: [evidence ids or rule ids], reason }`.
  Completeness is evaluated per requirement as `satisfied | unsatisfied | not-evaluable`, from recorded server-side
  facts, never from the agent's own summary. An empty policy is valid and means "fully autonomous".
* **[PROVISIONAL]** "Accessed" means the review server served the page to the session (server-side access record,
  P1). It does not mean the page was read or understood. GW1's reconstruction from Kane's step remarks
  (`followup/gw1-visit-coverage`) remains a separate, weaker signal and is labelled as such.

### B. Observation-driven rule discovery

* **[AGREED]** Two investigation modes:
  1. **Specification-guided QA**: the intended rules are available to the agent (GW1 was this mode).
  2. **Blind Rule Discovery**: the agent receives observations without the intended rule specification and infers
     candidate rules from them.
* **[AGREED]** Blind sequence: Observation → Hypothesis generation → Hypothesis freeze → Independent evaluation →
  Specification reveal → Reconciliation.
* **[AGREED]** Multiple competing hypotheses, stated uncertainty and explicit abstention are allowed. Finite
  observations are never assumed to identify a rule uniquely.
* **[PROVISIONAL]** "Specification reveal" happens to the **record**, not necessarily to the same agent session.
  Reconciliation is a deterministic comparison first. Whether an agent is shown the specification afterwards and asked
  to reconcile is **[OPEN]** (Q4), because that is a new inference call and is only possible in P7.

### C. Three-way verification

* **[AGREED]** Three sources are kept distinct: **Specification** (developer's intended rules), **Observation**
  (the game's actual behaviour), **Hypothesis** (the agent's inferred rules). Their pairwise relationships are evaluated
  independently.
* **[AGREED]** A hypothesis that accurately explains defective behaviour but disagrees with the specification is not
  automatically "failed understanding". Four outcomes are distinguished: observational fit, specification agreement,
  implementation correctness, unresolved ambiguity.
* **[PROVISIONAL]** The three relations and their value sets:

  | Relation | Question | Values |
  |---|---|---|
  | H↔O **observational fit** | Does the hypothesis predict the recorded observations it is evaluated on? | `fits` · `contradicted` (with counter-examples) · `insufficient-evidence` · `not-evaluable` |
  | H↔S **specification agreement** | Does the hypothesis agree with the intended rule on the evaluated situations? | `agrees` · `disagrees` (with witness situations) · `insufficient-evidence` · `not-evaluable` |
  | O↔S **implementation correctness** | Does the build behave as specified on the evaluated situations? | `conforms` · `deviates` (with witnesses) · `insufficient-evidence` · `not-evaluable` |

  Combined reading (never a single score): `fits ∧ disagrees ∧ deviates` = **accurate description of a defect**;
  `fits ∧ agrees ∧ conforms` = correct rule; `contradicted` = hypothesis wrong about this build; any
  `insufficient-evidence` = **unresolved ambiguity**. Every relation is scoped to the evaluated situations only.

### D. TypeScript-first deterministic verification

* **[AGREED]** Use the existing TypeScript environment (Node ≥ 22.10, `--experimental-strip-types`, no build step).
  No additional LLM as a required judge.
* **[AGREED]** Verification operates on a small, validated, declarative representation of rule hypotheses. No
  AI-generated JavaScript or TypeScript is executed.
* **[AGREED]** No comprehensive rule language, theorem prover, database service or orchestration framework unless
  later evidence shows a need.
* **[AGREED]** Finite behavioural agreement is never presented as universal semantic equivalence.
* **[AGREED]** "Unsupported" (the verifier evaluated it and the evidence does not support it) is distinct from
  "not representable / not evaluable" (the verifier cannot express or check it).
* **[PROVISIONAL]** Representation `gamewatch/gw2-hypothesis@1`: a JSON object, schema-validated by hand-written
  TypeScript (no new dependency), describing one rule as **trigger → condition → expected observable effect** over the
  fields that already exist in `gamewatch/evidence@1` (`GWState`, `GWEvent`, `GWTurnRow`). For example: "on
  `turn-start` for side *s*, `actionsGranted` = `piecesOnBoard(s)` + `bonus`". Operators are a closed, enumerated set
  (equality, comparison, small arithmetic on named fields, membership, count). Anything outside that set is accepted as
  free text and marked `not-representable`; it is never silently dropped.
* **[PROVISIONAL]** The verifier is an interpreter over recorded evidence (the evidence bundle), not over the live
  engine. Whether P5 may also generate new situations by running the engine (still deterministic, still no model
  call) is **[OPEN]** (Q6).

### E. Immutable branching judgments

* **[AGREED]** Original judgments are never overwritten. Challenges, disagreements, corrections and alternative
  hypotheses are new records linked to their predecessors.
* **[AGREED]** The verifier may be wrong; a verifier rejection is not irreversible ground truth.
* **[AGREED]** Every evaluation records evaluator identity and version, evidence references, criteria and reasons.
* **[AGREED]** One append-only logical judgment graph, not a Git branch per judgment.
* **[PROVISIONAL]** Storage: one NDJSON file per experiment (`judgments.ndjson`), each line a node
  `{ id: sha256(canonical content), kind, parents: [ids], relation: "supersedes"|"challenges"|"refines"|"alternative-to"|"evaluates", author: {kind: "agent"|"verifier"|"operator", id, version}, at, evidenceRefs, criteria, body }`.
  The id is the content hash, so editing a node changes its id and breaks every child reference: tampering is
  detectable, not prevented. A per-file hash chain (each line also records the previous line's hash) makes deletion
  and reordering detectable. This is the same "freeze and hash" pattern GW1 already uses, not a new storage system.
* **[PROVISIONAL]** GW1's three Kane findings and their post-freeze labels are imported as the first graph nodes
  in P2 (as new records that reference the frozen files by path and hash), without editing either file.

### F. Scientific separation

* **[AGREED]** Discovery observations, intended specifications, held-out evidence and independent-evaluation inputs
  are explicitly separated. Hypotheses are frozen before independent evaluation.
* **[AGREED]** Answer leakage is prevented through evidence titles, page metadata, labels, URLs, generated
  descriptions and accessible files within the declared agent input boundary.
* **[AGREED]** Logical scientific separation is distinguished from operating-system isolation, and no stronger
  isolation is claimed than is implemented.
* **[AGREED]** Blind Discovery withholds the specification from the experimental input. It does not prove the absence
  of prior model knowledge (Rule Sabotage, its rules and GameWatch's ground truth are public on GitHub).
* **[PROVISIONAL]** Four partitions, each a separate directory with its own hash manifest:
  `discovery/` (what the agent may see), `spec/` (intended rules; never served in blind mode), `heldout/` (observations
  never shown during discovery), `eval/` (verifier inputs and outputs). The **declared agent input boundary** is the
  set of URLs the review server serves plus any files explicitly handed over, and nothing else is claimed.
* **[PROVISIONAL]** Leak checks extend `gamewatch/skillbook/steps/leakcheck.ts` (generic term list + optional private
  term list + anonymous page-name check) with mode-specific checks: in blind mode, no rule ids, no rule text, no
  descriptive script titles, no build notes, and no identifiers derived from scenario names.

## 3. Hard limits for P0–P6 [AGREED]

* No paid Kane calls. No additional runtime inference calls. P7 is the first phase that may make either, and only
  with the operator's explicit, per-experiment authorization.
* No modification of frozen GW1 evidence. No changes to the playable game engine (`server/v6/**`). No changes to the
  vendored SkillFlow runner.
* No execution of arbitrary generated code.
* No deployment. No force-push. No merge without the operator.
* No claim of improved reliability that the experiments have not shown.

## 4. Terms

| Term | Meaning in GW2 |
|---|---|
| Observation | A record produced by actually running a build: a case step, a match turn row, or an engine event (`gamewatch/evidence@1`). |
| Specification | The developer's intended rules (today: `game.rules` R1–R15 in the bundle, produced by `gamewatch/rules-doc.ts`). |
| Hypothesis | An agent's stated candidate rule, free text plus an optional `gw2-hypothesis@1` form. |
| Judgment | Any recorded claim: a finding, a hypothesis, a verdict, an evaluation, a challenge. A node in the judgment graph. |
| Declared requirement | A developer-declared condition that must be met before an investigation-completeness check passes (§2.A). |
| Access record | A server-side record that a page was served to a review session. |
| Abstention | An explicit "I cannot decide" judgment, counted separately from both correct and incorrect assertions. |
| Test double | A deterministic, scripted stand-in for an agent (as `--label test-double` in `gamewatch/kane/serve.ts` already allows). No model call. |

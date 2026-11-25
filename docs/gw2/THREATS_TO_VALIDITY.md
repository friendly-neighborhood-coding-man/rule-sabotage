# Threats to validity

Status: Phase 0 inventory. Each threat names the mitigation planned and what remains. Tags as in
[`COMMON_SPEC.md`](COMMON_SPEC.md).

## Internal validity

| # | Threat | Mitigation (phase) | Residual |
|---|---|---|---|
| T1 | **Public answers.** The repository is public. `gamewatch/private/` (plants B1–B3, probes, labels), `docs/GW1_FINAL_REPORT.md` and the rules are on GitHub. An agent with network or repository access, or with training data that includes them, can know the answers. | New planted defects for P7 (EXPERIMENT_DESIGN §5); P7 ground truth kept outside the public repo until P8 (Q9); agents run without repository access. | Prior model knowledge of Rule Sabotage cannot be excluded. Blind Discovery withholds the specification from the input; it does not prove absence of prior knowledge **[AGREED]**. |
| T2 | **Leakage through the evidence itself**: script titles ("Human picks up a Shield, then walks into an AI "Send home" cell"), build notes, rule ids, URLs, page titles, id derivation, aggregate statistics that point at a defect. | Blind view and blind leak checks (P3, AC-P3.1); per-partition re-hashed ids. | Observations that reveal a defect are the point of the evidence; the line between "observation" and "hint" for effect names ("Shield", "+1 action") is a judgment call **[OPEN] Q10**. |
| T3 | **Logical vs OS isolation.** Partitions are directories on one machine; the review server serves only `discovery/`, but an agent process with file-system access on the same machine could read other partitions. | Declared input boundary = served URLs + handed-over files; report states the isolation level actually used (AC-P3.5). | No OS sandbox is planned in P0–P6. GW1's repair agent had the same limitation (GW1 report §7). |
| T4 | **Evaluator shares authorship with the evidence and the plants.** Same team writes scenarios, plants, spec encoding, verifier and labels (GW1 report §7). | Spec encoding reviewed by the operator (Q3); verifier known-answer tests; P8 independent reviewer. | Remains until P8. |
| T5 | **Verifier errors.** The deterministic verifier can be wrong (bad spec encoding, interpreter bug), and its verdict looks authoritative. | Judgment graph keeps verifier verdicts as challengeable nodes (P2, AC-P2.4); evaluator id and version on every verdict; mutation sanity tests (AC-P4.6). | A consistent encoding error would bias every arm the same way; detected only by review. |
| T6 | **Representation bias.** Hypotheses that do not fit `gw2-hypothesis@1` become `not-representable`, which could penalise good but unusual hypotheses or reward simple ones. | `not-representable` counted separately, never as wrong (AC-P4.4); free text always kept. | The representation still shapes what is measurable. |
| T7 | **Finite evidence.** Agreement on N situations is not semantic equivalence; several rules fit the same observations. | Scope stated on every verdict (AC-P4.5); "indistinguishable on available evidence" (AC-P5.3). | Inherent. |
| T8 | **Access ≠ attention.** A served page is not a read page; a recorded click is not understanding. | Wording fixed in COMMON_SPEC §2.A; three separate signals (served, reconstructed visit, cited). | Inherent. |
| T9 | **Agent-log reconstruction depends on model-written text.** The follow-up's visit reconstruction parses Kane's step remarks, whose wording can change between Kane versions or runs. | Server-side access log is primary from P1; reconstruction labelled as secondary. | GW1 has only the reconstruction. |
| T10 | **Abstention gaming.** Fewer assertions can lower error rates without better investigation. | Coverage next to accuracy; abstention counted as not detected (EXPERIMENT_DESIGN §3). | Readers may still read one column; the report must not rank by one. |
| T11 | **Steering vs measuring.** Showing declared requirements or verifier feedback to the agent changes its behaviour; that is the intervention, but it also means "architecture on" and "agent told what to look at" are confounded. | Separate factors for declared requirements and verifier feedback (EXPERIMENT_DESIGN §4, Q7). | Budget may not allow the full factorial. |
| T12 | **Label timing and labeller bias.** Labels written by someone who knows the plants. | Labels only after freeze, by a declared labeller, disagreements as graph nodes (AC-P7.3). | Same as GW1. |

## Statistical conclusion validity

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T13 | **Tiny samples.** GW1 was one call. P7 budgets may allow only a few calls per arm. | Report counts with denominators and intervals; call results "case studies" when n is small. | Likely the dominant limitation of P7. |
| T14 | **Run-to-run variance of the agent.** Kane's path through the site differs between runs (GW1 opened 3 of 22 cases). | Several runs per arm if the budget allows; interleaved order. | Unknown variance until measured. |
| T15 | **Two credit figures disagree** (GW1: 72.398 by balance vs 68.028 by `credits_consumed`). | Report both, as GW1 did. | Unexplained. |

## Construct validity

| # | Threat | Mitigation |
|---|---|---|
| T16 | "Trustworthy" is not one construct. | 13 separate dimensions, no composite score **[AGREED]**. |
| T17 | Planted defects may not resemble real defects. | Defect classes chosen per relation type; P8 discusses transfer. |
| T18 | Specification-guided GW1 objective named the rules (R1–R15) and asked for comparison between builds; build labels were visible. Comparing builds is easier than reviewing one build. | P7 fixes whether builds are compared or reviewed alone, per arm, and states it. |

## External validity

| # | Threat | Note |
|---|---|---|
| T19 | One game (Rule Sabotage V6.1), one agent family (Kane), one evidence format. | Claims are limited to this setting unless P8 adds another game via the adapter contract. |
| T20 | Scripted scenarios were written to exercise every rule on both sides; a game without such symmetric scripts gives less to go on (GW1 report §7). | Stated as a condition of any result. |

## Added in Phase 5 (2026-11-25; earlier entries unchanged)

| # | Threat | Mitigation / status |
|---|---|---|
| T21 | The operator has seen held-out outcomes of the P5 bundle (test-double demonstration in `evidence/gw2/p5-demo/`, and the mutation validation). | Generation, partition and selection were frozen before generation and cannot be changed in response (D78, D85). The experimental partition `evidence/gw2/p5-experiment/` has no session, freeze or opening. Disclosed in every P5 report. |
| T22 | The frozen P5 partition puts one of six match seeds (2 matches per build) and 8 scripts in held-out: held-out unit counts are small (≈10 units per build) and intervals are wide. | Reported with unit-level Wilson intervals; the procedure was not changed after seeing the split (that would be selection). P7 may freeze a procedure with more seeds before generating its own observations. |
| T23 | The structured-representation page lists the observable field names (e.g. `isFirstMover`, `pieceShieldedBefore`, `nearAnyPiece`). Names of the closed field set are a semantic clue about what the verifier can check. | No rule and no rule-specific example is given (test). Reported as observable-semantic assistance (Q18 / D52); submitter-authored and translated representations are reported separately. |
| T24 | Turns of one match and entries of one case are correlated; situation-level rates overstate precision. | Unit-level rates (cases and matches) with Wilson intervals are reported beside the descriptive situation rates (D83). |
| T25 | **Contamination from publicly documented mutations.** B1–B3 and the planted defects are described in this public repository (GW1 report, mutation file, P4/P5 reports). An agent with web or training access may know them. New seeds and new evidence do not remove prior knowledge of the defects. | P7 is labelled an exploratory capability and feasibility study, not a detection-rate estimate. Any future confirmatory ground truth and held-out evidence must be kept outside the public repository and outside the agent's declared input boundary (P7 pre-registration §contamination). |
| T26 | **Matches of one seed are paired; cases of one script form a family.** Even with 4 held-out seeds, independent replication is at most 4 seed groups per build plus the held-out script families. | Rates are labelled descriptive and a replication block counts groups (D90); P7 seeds are recorded per match (`recordMatchSeeds`). |

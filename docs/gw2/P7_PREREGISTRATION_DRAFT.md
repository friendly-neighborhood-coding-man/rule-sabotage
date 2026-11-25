# GW2 P7 pre-registration (DRAFT, for operator review)

> Superseded by the authorized [`P7_PREREGISTRATION.md`](P7_PREREGISTRATION.md) (2026-11-25). This draft is kept unchanged below.

**Status: DRAFT. Not authorized. Nothing here has been executed.** P7 starts only after the operator explicitly authorizes it,
including a separately approved change of the paid-call gate. P6 made zero Kane calls and zero model calls.

## 1. What this is, and what it is not

**This is** a minimal exploratory capability and feasibility study. It asks whether a real Kane agent, in a blind
discovery session with GW2's verification architecture, produces hypotheses that are frozen, sealed and evaluated
end to end. It also records what those hypotheses look like on the separated dimensions (EXPERIMENT_DESIGN §3).

**It is not** an architecture-effectiveness comparison. It has no control arm. It supports **no claim** that GW2 improves
detection or reliability. GW1 is **not** a matched control (EXPERIMENT_DESIGN §2): it differs in evidence, form,
objective and access logging. With three sessions, the results are case studies, not rates.

## 2. Design

| Element | Pre-registered value |
|---|---|
| Sessions | 3 independent blind discovery sessions, declared in `SESSIONS.json` before the first session (`session-plan` step) |
| Kane runs | Exactly one objective-mode `kane-cli` call per session; zero retries; no follow-up calls; nothing in parallel |
| Agent and version | `kane-cli` **0.10.4**, the same pinned CLI as GW1 (`P7_EXPECTED_CLI_VERSION`). The gate refuses any other version. The model behind kane-cli is whatever that version uses; it is recorded as reported and never chosen by us |
| Objective | `OBJECTIVE_P7` in `gamewatch/gw2/p7-plan.ts`: identical for all three sessions |
| Budget per session | `--max-steps 80`, `--timeout 2700` s; the process tree is killed at 2730 s. The step and time budgets are the same for every session |
| Evidence | `evidence/gw2/p7-evidence/`: frozen generation `p7-generation-1` (12 new seeds, the two QA builds) and frozen partition `p7-partition-1` (4 held-out seeds; a distinct shielded matrix variant in each partition). Every session gets byte-identical inputs |
| Served to the agent | `partitions/discovery/site` only, through the GW2 review server with the access journal on (Q13: no session without logging) |
| Submissions | Free text plus the optional structured representation (Q20). **No external translation** (U3). Malformed representations are kept verbatim and never repaired |
| Feedback | **No verifier feedback during discovery.** Nothing is evaluated until all three sessions are closed, imported, frozen and sealed |
| Sealing | Each session is sealed by the server at close (`CLOSED.json`). Raw Kane stdout and args are stored per session and imported with Kane provenance. Hypotheses are frozen at experiment level after the last session. Representations are sealed before the gate opens any evaluation |
| Evaluation | Once, through the gate, after the seal: three-way relations, held-out prediction, discrimination, per-session report, integrity check (the `book-p7.json` steps after `investigate-3`) |
| Spec reference | Encoding-2, **provisional and scoped** (U2, D94). It is a reference for exploratory reading only, not an authoritative confirmatory reference |

## 3. Measures (reported side by side, never combined)

These are per session, with the denominators always shown.
* Submissions: hypotheses, abstentions, entries excluded from the primary set, with reasons (D91).
* Representation availability: sealed submitter representations, and hypotheses with free text only.
* Coverage: held-out situations with a prediction ÷ held-out situations.
* Held-out accuracy: matching ÷ recorded outcome checks. It is descriptive. Replication is counted in seed groups and script families (D90).
* Fully evaluated vs partially evaluated units (D89).
* Incorrect assertions: contradicted held-out checks, as a count.
* Detection: held-out (rule, build) spec deviations with an "accurate description of a defect" reading ÷ deviations present. Abstention counts as not detected.
* Discrimination: separating situations for declared competitors, and self-contradictions (D92).
* Citations: cited evidence, and cited before the journal records that page as served.
* **Cost and time, separately:** credits by balance delta (gate ledger), Kane's own credit figure if it reports one, steps (run_end), and elapsed time (ms). Each is a separate column, never combined.

There are no rankings and no composite score. Null results and failures are reported.

## 4. Stopping rules

The run stops, and nothing is repeated, if any of the following happens:
* the gate refuses (missing approval, wrong CLI version, balance below 1.5× the ceiling field, a previous call exceeded its ceiling or has an unknown spend and was not cleared by the operator);
* a leak check, partition verification, session closure, freeze, seal or gate opening fails;
* a session times out or ends without `run_end`. That session is recorded as inconclusive and **not** re-run;
* any result has been seen. There is no re-run, re-selection or regeneration in response to results.

## 5. Contamination and threats

* **T25 (contamination).** B1–B3 and the planted defects are documented in this public repository, and an agent may know them. New seeds do not remove prior knowledge of the defects. Results are read as capability and feasibility, not as unbiased detection rates.
* Any future **confirmatory** study needs private ground truth and private held-out evidence. Both must be kept outside the public repository and outside the agent's declared input boundary. The P7 pilot uses the public P7 evidence and is exploratory only.
* T22/T26: held-out has 4 seed groups per build. Intervals are descriptive.
* Isolation is logical, not OS-level (INPUT_BOUNDARY.json). An agent with shell or file access could read other partitions. Kane is given only the URL.

## 6. Optional matched architecture-off vs architecture-on experiment (SEPARATE; not prepared for execution, not authorized)

This would be the first study able to test the GW2 question. It needs its own authorization and pre-registration:
* Arms: architecture **off** (GW1-style free-text form, no structured field, no access-journal-derived feedback) vs **on** (GW2), with the same evidence partitions (byte-identical), the same CLI and version, the same objective text except for the manipulated factor, the same step and time budgets, arms interleaved in time, and run order randomized with a recorded seed.
* GW1 is not a control arm.
* With one call per arm, it is a case comparison and must say so. Rates need more calls per arm, and the operator decides that number (Q8).
* No claim of improvement unless the pre-registered comparison supports it.
* Contamination (T25) applies to both arms equally, but still limits what detection figures mean.

## 7. Operator decisions still needed

The exact commands and checks are in [`P7_OPERATOR_CHECKLIST.md`](P7_OPERATOR_CHECKLIST.md). These decisions remain open:
1. Authorize P7 at all.
2. Approve the gate change (`PAID_RESEARCH_EXECUTION`), which is a code change. P6 did not make it.
3. Approve three per-run approval records and the credit budget.
4. Confirm that encoding-2 stays exploratory-only for this pilot.

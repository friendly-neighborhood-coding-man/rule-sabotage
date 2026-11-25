# GW2 provisional experimental design

Status: **[PROVISIONAL]**, to be pre-registered and frozen in P7 before any real-agent call. Nothing here has been run.
Tags as in [`COMMON_SPEC.md`](COMMON_SPEC.md).

## 1. The question, stated so it can fail

**Primary question [AGREED].** Does adding the GW2 external verification architecture (declared requirements,
server-side access records, frozen hypotheses, deterministic three-way verification, immutable judgments) make
AI-driven game investigation **more trustworthy**, with the same underlying AI model and the same evidence?

"More trustworthy" is not one number **[AGREED]**. It is the profile of dimensions in §3. GW2 is considered to have
helped on a dimension only if that dimension improves under matched conditions with the pre-registered analysis, and
the report must show every dimension, including those that get worse.

**Possible honest outcomes**, all reportable:
* Detection unchanged, but completeness and unsupported verdicts are reported correctly (the architecture improves
  *reporting*, not *finding*).
* Detection improves because declared requirements steer the agent to evidence it skipped (GW1: B1 was in evidence
  Kane never opened).
* No measurable difference.
* Worse: e.g. more abstention without more correct findings, or more cost for the same result.

## 2. Why GW1 is not the control [AGREED]

GW1 is historical evidence: one call, one build pair, three planted defects, specification-guided, build labels
visible, no server-side access log, no pre-registered metrics, different budget from anything GW2 will run. It
supplies **fixtures** (P1–P5 tests) and **motivating observations** (inconsistent clean report, 3/22 cases opened,
B1 never in front of the reviewer), not a baseline rate. Every comparison in P7 uses arms run **in the same
experiment** under matched conditions.

## 3. Dimensions measured (never combined into one score) [AGREED list; PROVISIONAL definitions]

| # | Dimension | Operational definition (provisional) | Source |
|---|---|---|---|
| D1 | Autonomous investigation performance | Planted/known defects detected ÷ defects present, outside any declared requirement. | findings + post-freeze labels |
| D2 | Mandatory coverage compliance | Declared requirements `satisfied` ÷ declared. | `completeness.json` (P1) |
| D3 | Accuracy of cited observations | Cited (id, step/turn, claimed value) triples that match the evidence ÷ cited triples; plus cited-without-access count. | findings vs bundle + access log |
| D4 | Rule discovery accuracy | Per intended rule: a frozen hypothesis `agrees` with it (H↔S) on evaluated situations; reported per rule, not averaged across rules of different difficulty. | verifier (P4) |
| D5 | Agreement with observed implementation behaviour | H↔O `fits` ÷ hypotheses evaluated. | verifier |
| D6 | Agreement with intended specification | H↔S `agrees` ÷ hypotheses evaluated; with D5 this separates "described the defect" from "misunderstood the rule". | verifier |
| D7 | Held-out predictive accuracy | Correct predictions on held-out situations ÷ predictions made; abstentions counted separately. | P5 |
| D8 | Ability to distinguish competing hypotheses | Among pairs of competing hypotheses the agent proposed, pairs it ranked consistently with held-out separation ÷ separable pairs. | P5 |
| D9 | Unsupported verdict frequency | Verdicts whose cited evidence does not support them (verifier `contradicted` or `insufficient-evidence`, or cited-without-access) ÷ verdicts. | verifier + access log |
| D10 | False positives and missed defects | Counts, each with denominators, never netted against each other. | labels |
| D11 | Investigation completeness | Report of what was and was not accessed, per finding and at session end, plus the agent's own completeness statement vs the record. | access log |
| D12 | Judgment consistency and revision quality | Contradictory verdicts in one session (e.g. GW1 clean + anomaly on the same case); revisions that cite new evidence vs revisions that do not. | judgment graph |
| D13 | Cost and elapsed time | Credits by balance delta and by the agent's own figure (both, as in GW1), wall time, steps, pages served. | ledger, meta |

**Abstention handling [AGREED].** An agent that abstains on everything must not look better because it is wrong less
often. Therefore:
* Every rate above reports **coverage** (assertions made ÷ opportunities) next to **accuracy** (correct ÷ assertions).
* Detection (D1, D4, D7) is computed with abstention counted as **not detected**.
* Error rates (D9, D10 false positives) are computed over assertions made.
* The report shows both, side by side, for every arm. A ranking by any single column is not reported.
* Improvements in the **ability to abstain or to report incomplete investigation** (D9, D11) are reported in a
  separate section from improvements in **detection** (D1, D4, D7, D10 misses).

## 4. Arms (provisional)

Factors, crossed only where the budget allows (decision for P7):

| Factor | Levels |
|---|---|
| Mode | Specification-guided QA · Blind Rule Discovery |
| Verification architecture | **Off**: GW1-style site and form, findings as free text · **On**: GW2 (access log, declared requirements shown to the agent, hypothesis form, verifier feedback **[OPEN] Q7**) |
| Declared requirements | None · a small declared set (for example "must access every case of rule family X") |

Minimum informative design (provisional): Mode × Architecture (2 × 2), declared requirements fixed per mode.

**Matched conditions [AGREED].** Same evidence partitions (byte-identical, hashed), same agent and version, same
step and time budget, same objective text except for the manipulated factor, same machine class, arms interleaved
in time, run order randomized with a recorded seed.

**Budget [AGREED principle; numbers OPEN].** Every arm has a declared budget (steps, timeout, credits ceiling as a
measured outcome, not a cap kane-cli can enforce). The number of calls is the operator's decision (Q8). With one call
per arm, results are case studies, not rates, and the report must say so.

## 5. Materials (provisional)

* Builds: new planted-defect builds, not B1–B3 (those are public in this repository, see
  [`THREATS_TO_VALIDITY.md`](THREATS_TO_VALIDITY.md) T1). Defect classes chosen to exercise all three relations,
  including at least one defect whose accurate description disagrees with the specification.
* Ground truth written, hashed and frozen before any evidence page is generated, as in GW1
  (`gamewatch/private/FREEZE.json` pattern), but stored outside the public repository until P8 **[OPEN] Q9**.
* Discovery and held-out partitions from disjoint seeds and scripts.

## 6. Analysis plan (provisional)

* Pre-registered: dimensions, definitions, denominators, intervals (Wilson / exact binomial), the comparisons to be
  reported, and what counts as "no difference".
* Labelling of agent findings after the freeze, by a declared labeller, against the frozen ground truth; disagreements
  recorded as `challenges` nodes.
* All arms, all dimensions reported, including null and adverse results.
* No claim of improved reliability unless the pre-registered comparison supports it.

## 7. What the free phases (P1–P6) can and cannot show

They can show that the machinery **measures** what it claims to (test doubles with known behaviour produce the
expected separated metrics). They cannot show that GW2 improves any real agent. That is P7's question.

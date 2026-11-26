# DRAFT pre-registration: matched comparison of hypothesis–observation feedback (NOT authorized, NOT executable)

**Status: draft for operator review (D134).** Nothing here runs. The machine-readable plan is `gamewatch/gw2/ext/comparison-plan.ts` (`PLAN_V1`, `executable: false`). Before anything runs, all of the following are needed:
* a written operator authorization;
* this document, completed and frozen in an external record, with its sha256 as the first ledger entry (Q14);
* a scoped gate commit for the listed run ids;
* a reviewed commit that sets `AGENT_FEEDBACK_ENABLED = true` for the treatment run ids only.

## Question
When an agent is shown, deterministically, where its own structured hypotheses disagree with observations it may see, does it revise them toward the builds' actual behaviour? This is compared with an identical session that gets no such feedback.

## Arms (the only manipulated factor: `hypothesisFeedback`)
| | Control | Treatment |
|---|---|---|
| Phase-2 `revision.html` feedback section | "No observation list is provided in this session." | Deterministic H↔O items (`feedback.ts`). Discovery evidence only, capped at 25 per hypothesis |

## Identical in both arms (one shared object, `SHARED`)
* **Evidence.** One new frozen generation and partition, created before the first session. Every `MANIFEST.json` sha256 is listed here. The agent sees discovery only. The final held-out partition is sealed before the first session and opened once, after freeze-2 of the last session.
* **Objectives.** Byte-identical, phase 1 and phase 2. The sha256 values are in `PLAN_V1`. Neither mentions a specification.
* **Representation requirement.** A structured representation is requested on every hypothesis. Free text and abstention stay possible, and are reported as not machine-evaluable.
* **Revision opportunity.** Phase 2 is a separate call after freeze-1. Each hypothesis can be kept, revised (a new node with a `revises` relation) or withdrawn (an abstention). Originals are always kept.
* **Budgets.** Phase 1: 80 steps, 2700 s, 8 forms. Phase 2: 40 steps, 1350 s, 8 forms. The CLI is `kane-cli` 0.10.4.
* **Specification.** Never shown, in either arm. `blindSiteProblems(site)` must be empty before every session.
* **Operator outputs.** A, B and C are computed for the operator in both arms. B is never served.
* **Feedback inputs (treatment).** Only the authenticated pre-evaluation graph prefix at freeze-1 (`anchored.ts`).

## To be fixed before freezing (open)
1. The number of sessions per arm (Q8). With few sessions the result is a case comparison and is reported as one.
2. The randomization seed and the alternating order.
3. The feedback item cap per hypothesis (proposed: 25).
4. Whether phase 2 is a separate call (proposed) or extra steps within one call. This decision has a cost consequence: P7 cost about 44 credits per call by balance delta.
5. The new evidence generation and its manifest hashes.
6. The run ids, and which of them are treatment runs (`plan.agentFeedback.runs`).

## Measures (separate, never combined)
These are listed in `PLAN_V1.measures`:
* hypotheses kept, revised and withdrawn;
* discovery fit of revisions;
* final held-out accuracy and coverage, original vs revised, paired per hypothesis;
* C readings before and after;
* revisions that move away from the evidence;
* new errors introduced by revisions;
* counterexample class (already exemplified in accessible discovery vs absent from discovery).

## Claims
No improvement claim is made unless the pre-registered control vs treatment comparison supports it. P7 is a historical record, not a control. Contamination (T25) applies to both arms.

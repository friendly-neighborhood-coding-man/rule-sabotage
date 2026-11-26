# GW2 Extension V0: three independent offline outputs

**Status: GW2_EXTENSION_V0_READY_FOR_REVIEW.** Everything is implemented offline and tested with the published P7 evidence and with synthetic test doubles.
* Executed: no Kane calls, no runtime inference, no paid calls.
* Unchanged: the gate (still `'disabled'`), the game engine, the vendored runner, the GW1 dashboard and the blind site.
* Preserved: all historical evidence, metrics, submissions and the pre-registration.

The P8 corrections are on PR #30 (`P8_CORRECTIONS.md`, D117–D120). This extension is a new stacked PR.

## 1. Outputs

| Output | Module | Channel | Reads | Audience |
|---|---|---|---|---|
| **A. How the Game Actually Works** | `gamewatch/gw2/ext/behaviour.ts` | Agent behavioural discovery | discovery, held-out, eval (labels). **Never the spec** | Operator |
| **B. Unmatched Action Notifications** | `gamewatch/gw2/ext/notifications.ts` | Specification–observation (system level) | spec, discovery, held-out, eval. **No submission** | Operator only |
| **C. Hypothesis Contradictions** | `gamewatch/gw2/ext/contradictions.ts` | Hypothesis–observation | discovery, held-out, eval. **Never the spec** | Operator |
| **C′. Agent feedback (optional, disabled)** | `gamewatch/gw2/ext/feedback.ts` | Hypothesis–observation | discovery, and an optional `feedback` partition **only** | Agent, in a future authorized run |

All four go through `gamewatch/gw2/ext/inputs.ts`:
* Each output gets a **partition reader with its own allow-list**. Reading any other partition is refused before a byte is read.
* A file is returned only if it matches its manifest, and the manifest matches the one bound by the freeze. A `feedback` partition must declare `role: "feedback"` and use only build ids the agent saw.
* Every read is recorded (`partitionsRead`).
* Submissions come from the judgment-graph prefix up to the representation seal. The evaluation nodes appended later, which carry held-out results, are never loaded.

**A** lists every frozen submission:
* the verbatim statement, the declared confidence and the cited evidence;
* the structured representation, if any, with fidelity "declared, not checked";
* coverage, per build and clause: discovery evaluated, supported and counterexamples (the first ones listed); held-out matching, contradicting and unknown;
* a verification status: free text only (not machine-evaluable), contradicted by discovery, consistent with discovery, no applicable situation, or abstention.

**B** lists, for every encoded spec rule and every recorded situation whose observed outcome differs from what the encoding expects:
* the rule id and text, the clause, the encoding id and its review status;
* the expected and observed outcome, the field;
* the evidence (situation, case or match, pointer), and the build (id and operator label).

Every row is labelled *unmatched (not classified)*, and nothing calls it a bug. B also lists:
* the rules for which no notification is possible (not encoded);
* missing information: excluded situations and unrecorded outcomes.

The page shows the encoding's status in a banner: PROVISIONAL, unreviewed. B depends on no agent: Kane does not have to discover these.

**C** lists every hypothesis–observation contradiction (predicted vs observed, discovery and held-out separately). It has two further tables:
* **conflicts between hypotheses**: different predicted values for the same outcome of the same situation, shown and not resolved;
* hypotheses that are **not machine-evaluable**.

**C′** is the agent-facing version of C.
* Contents: only the session's own hypotheses, and only discovery or feedback evidence. Hypotheses that cannot be checked are listed as such.
* Wording: facts only (your prediction, the recorded value). There is no spec, no held-out unit, no operator build label, and no "defect" or "bug".
* Status: `AGENT_FEEDBACK_ENABLED = false`, and building it requires `enable: true`. Nothing serves it, and `serve.ts` is unchanged.

## 2. Operator dashboard

```sh
npm run gw2:ext-dashboard -- evidence/gw2/p7-pilot/exp --out <new dir> --label "..."
```

* **Pages.** `gamewatch/gw2/ext/dashboard.ts` writes `index.html`, A, B, C and a measures page, plus the JSON of each.
* **Warning.** Every page carries the operator-only banner.
* **Where it can write.** The directory must be new. It is refused inside any `partitions/` or `site/` directory, and inside the repository anywhere but `evidence/gw2/ext-v0/`.
* **Why it cannot reach the agent.** The GW2 review server serves only its `--site` directory, through the GW1 path-containment check, so these pages cannot reach a discovery session.
* **GW1 dashboard.** `gamewatch/dashboard.ts` rebuilds a frozen GW1 site, so it is not modified. This is the GameWatch operator view for GW2.
* **Committed copy.** The P7 dashboard is committed at `evidence/gw2/ext-v0/p7-operator/`, and the build is deterministic.

## 3. P7, read through the extension

| Measure block (never combined) | P7 result |
|---|---|
| **System-level discrepancy detection** (B) | 338 unmatched actions on 4 rules, all on build-3caf: R3 222 + 98, R7 6 + 4, R8 1 + 1, R14 2 + 4 (discovery + held-out). 9 rules not encoded. The encoding is provisional. These equal the committed O↔S counts per rule, build and partition |
| **Agent behavioural discovery** (A) | 8 hypotheses, 0 abstentions, 3 with representations, 5 free text only. 1 contradicted by discovery evidence (H-1). Held-out checks 194 matching / 190 contradicting. 580 hypothesis contradictions, 0 conflicts between hypotheses |
| **Machine-verifiable descriptions** (three-way readings) | 0 held-out `accurate-description-of-a-defect` readings |

The three blocks have different units and answer different questions:
* **B** is the system finding spec–observation mismatches. The agent is not involved.
* **A** is what the agent claims about actual behaviour.
* **The third block** is whether a structured claim of the agent describes a mismatch accurately.

The 338 unmatched actions in B are not an agent result. The 0 in the third block is not a measure of B.

## 4. A fresh matched no-notification control (prepared, not executable)

* **`gamewatch/gw2/ext/control-plan.ts`** defines two arms that are identical in objective, representation requirement, revision opportunity (both get the same revision window after freeze-1), budgets, CLI and evidence.
* **The one manipulated factor** is `agentHypothesisFeedback`: none, or C′.
* **In every arm:**
  * the spec is not shown to the agent;
  * B is computed for the operator only.
* **The historical P7 sessions** are kept as a baseline record, not as this control.
* **Status.** `executable: false`. It needs written authorization, an external pre-registration and a scoped gate commit.

## 5. Tests (`tests/gw2-ext-v0.test.ts`, 11)

| Requirement | Test |
|---|---|
| Channel separation | A and C read no `spec/` file and contain no rule text, rule key or encoding id. B contains no hypothesis id or statement and has `agentInvolved: false`. The measures are three separate blocks, never combined |
| Access boundaries | Each reader refuses partitions outside its list, files not in a manifest, tampered bytes and unbound manifests. The agent feedback is off by default and refuses held-out, spec and eval. Its output contains no held-out unit id, no operator label or held-out build id, no rule text and no "defect", "bug" or "specification". A feedback partition must declare its role and use only known builds. The dashboard directory guard holds, and the review server's path containment keeps the dashboard unreachable |
| Notification correctness | Test doubles give exactly one notification with the expected and observed values, the evidence, the build and label, the spec text, the provisional status and the unclassified label. An unrecorded outcome goes to missing information, not to a notification. Unencoded rules are listed. On P7, the counts per rule, build and partition equal the committed O↔S contradicting outcome checks |
| Missing information | A free-text hypothesis is "not machine-evaluable". An abstention is not a claim. An unknown outcome is neither support nor a counterexample |
| Conflicting hypotheses | Two representations that disagree on one situation give one conflict row naming both. Each hypothesis's own contradictions stay separate |
| Preservation of original submissions | All 8 P7 submissions appear with their verbatim text, the 5 free-text ones included. Building the outputs changes no published P7 file |
| Determinism | The committed dashboard equals a fresh render byte for byte |
| Control | The arms are equal except for the manipulated factor. The plan is not executable, and the gate is `'disabled'` |

## 6. Decisions

D121–D128 are in `DECISIONS.md`.

## 7. Limits

* **Not yet run in a session.** The agent-facing feedback is prepared but has never been served. Its effect on revision is unknown until a separately authorized experiment.
* **Bound to the provisional encoding.** B is only as good as the encoding. While encoding-2 is unreviewed, an unmatched action can be an encoding error.
* **Only partly ruled out by tests.** The leakage tests check the known identifiers (held-out unit ids, held-out build ids, labels, rule texts). They cannot rule out every indirect channel.

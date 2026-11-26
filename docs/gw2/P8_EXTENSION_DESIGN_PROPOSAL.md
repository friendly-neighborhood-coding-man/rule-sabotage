# GW2 extension: design proposal (NOT implemented, NOT authorized for execution)

**Status: PROPOSAL for a future, separately authorized extension (D116).** Nothing in this document is implemented. No
paid call is prepared, the paid gate stays `'disabled'`, and no evidence is generated. Before anything here runs, the
extension needs three things:
* the operator's written authorization;
* its own pre-registration, frozen externally as in P7 (Q14);
* a separate, scoped gate commit for its run ids.

This proposal builds on what P7 showed (PHASE_7_REPORT, PHASE_8_REPORT §2–§4):
* agents discover behaviour, but often only in free text;
* some of their errors are already refuted by evidence they opened (H-1), and others could not be seen in discovery (H-2);
* GW2's "detection" is a machine-verifiable description of behaviour (C), not a claim of discrepancy (A) and not root cause (D).

## 0. Fixed principles

1. **Two notification channels that never merge.**
   * **H↔O** (hypothesis vs observation) tells the agent that *its own* structured claim disagrees with a recorded outcome.
   * **S↔O** (specification vs observation) tells the agent that a *recorded outcome* disagrees with the specification.
   * They have different sources, schemas, pages, ledgers and metrics. A notification is never labelled a defect, bug or error of the game.
2. **Untouched final held-out evidence.** Notifications come only from evidence the agent may see: the discovery partition, plus an optional dedicated *feedback* partition. The final held-out partition is generated, partitioned and sealed before the first session. It is opened once, after all revisions are frozen, exactly as in P7.
3. **The original no-notification baseline is kept.** One arm repeats the P7 protocol unchanged: same objective, same pages, no notifications. P7's own sessions are **not** that arm, because they used different evidence. They stay as historical case studies.
4. **Every submission is preserved.** A revision is a new graph node linked to the hypothesis it revises. The original is never edited or removed, and both are evaluated.
5. **No interpretation of free text.** As in U3, the verifier reads only structured representations. A free-text hypothesis gets no H↔O notification, and the report says so.

## 1. Track 1: "How the Game Actually Works" (independent behavioural discovery)

**Question.** From observations alone, how complete and how accurate a behavioural model of each build does an agent produce?

* **Inputs.** The discovery site only (cases and matches), with **no specification**, as in P7.
* **Agent's task.**
  * Submit behavioural laws per build in structured form.
  * Submit build-difference claims as invariance clauses across builds ("same situation, different outcome in build X").
  * Abstain where unsure.
  * The objective asks for a structured representation on every hypothesis, which addresses the P7 finding that 5 of 8 had none. The form keeps free text and abstention.
* **Verifier output.** A per-build behaviour map: for each situation kind and outcome field, which submitted laws cover it, with their discovery fit and final held-out accuracy.
* **Measures** (separate, never combined):
  * coverage per situation kind;
  * held-out accuracy (descriptive, by units and seed groups);
  * build-difference claims that are confirmed or contradicted;
  * representation availability;
  * abstentions.
* **No spec is involved.** This track measures concept B and, through the verifier's own comparison, concept C. It never measures A or D.

## 2. Track 2: Unmatched Action Notifications (deterministic notifications of discrepancies)

**Question.** If an agent is told, deterministically, where its own structured claims disagree with evidence it may see, does it revise them toward the actual behaviour?

### 2.1 H↔O notifications (hypothesis–observation)

* **Trigger.** After the agent submits a structured representation, the verifier evaluates it against the **discovery** partition (and the feedback partition, if there is one). It lists each situation whose recorded outcome contradicts the representation.
* **Content.** A notification contains facts only:
  * hypothesis id, clause, situation id (case or match, step or turn);
  * predicted value and recorded value;
  * whether the agent had already opened that page, from the access journal.
* A notification never includes the spec, the correct rule, any held-out evidence or any judgment ("defect", "wrong rule").
* **Delivery.** A served page `notifications.html?h=<id>`, logged in the access journal like any other page. The notifications are deterministic: the same submission against the same evidence always produces the same notification bytes, with a stable order and a capped list length.
* **Ledger.** `notifications-ho.ndjson` is hash-chained, and each entry carries the representation hash, the partition manifest hashes and the notification sha256.
* **Expected reach.** Notifications can only point at counterexamples that are *already exemplified in accessible evidence*, the class of P7's H-1 (PHASE_8_REPORT §4). They cannot reveal exceptions *absent from discovery*, the class of P7's H-2. The pre-registration says this in advance: effects are expected only on the first class.

### 2.2 S↔O notifications (specification–observation): separate, and only where the spec is given

* These exist only in an arm that **gives the agent the specification**. Concept A is not measurable otherwise.
* **Content.** Rule id, situation id, the spec-predicted value and the recorded value. A notification states that the observation does not match the specification. It does not say that the game is defective, and it does not say that the spec is wrong.
* They have their own page (`spec-notifications.html`), ledger (`notifications-so.ndjson`) and schema. They are never mixed with H↔O notifications in any page, file or metric.
* **Encoding.** Encoding-2 is provisional. Any S↔O arm needs an operator-reviewed, *accepted* encoding first (Q3), because otherwise the notifications would rest on an unreviewed reference.

## 3. Track 3: Hypothesis revision after notifications

**Protocol (per session).**
1. Discovery, then the initial submissions.
2. **Freeze-1**: the initial hypotheses and representations are frozen and externally anchored.
3. Deterministic notifications are issued (H↔O, and S↔O in that arm only), then anchored.
4. A revision window. The agent may revise, withdraw (by abstaining, as a new node) or keep each hypothesis. Each revision is a new node with `revises → <original>`, which needs one new graph relation type, a reviewed schema change. It is never an edit.
5. **Freeze-2**: the revisions are frozen and the representation seal is applied.
6. A single gate opening: originals and revisions are both evaluated on the **untouched final held-out** evidence.

**Measures** (separate, never combined):
* proportion of notified hypotheses that were revised, kept or withdrawn;
* discovery fit of the revisions;
* final held-out accuracy and coverage, original vs revised, paired per hypothesis;
* incorrect assertions before and after;
* C readings before and after;
* revisions that move away from the evidence;
* new errors that revisions introduce.

Counterexample classes are reported separately: already exemplified in accessible discovery, vs absent from discovery.

## 4. Matched design (for the future pre-registration)

| Arm | Notifications | Spec given | Purpose |
|---|---|---|---|
| 0 Baseline | none (the P7 protocol unchanged) | no | Kept no-notification baseline |
| 1 H↔O | H↔O only | no | Effect of hypothesis–observation feedback on behavioural discovery (B, C) |
| 2 H↔O + S↔O (optional; needs an accepted encoding) | H↔O and S↔O, on separate pages | yes | Discrepancy detection (A) as a separate question; never pooled with arms 0 and 1 |

* **Identical across arms.** Evidence partitions are byte-identical. The CLI version, step and time budgets, and the objective text are the same, except for the manipulated factor.
* **Order.** Arms are interleaved in time, and run order is randomized with a recorded seed.
* **Fixed in advance.** The number of calls per arm is fixed beforehand by the operator (Q8). With one call per arm the result is a case comparison, and it is reported as one.
* **Cost basis from P7.** 132.043 credits for 3 calls, roughly 44 per call by balance delta (range 32–52, no cap exists). For example, 3 arms × 5 calls would be about 660 credits, before any revision-window steps. The revision window adds steps inside the same call, or one follow-up call per session. Which of the two is a pre-registration decision with a cost consequence.
* **Stopping rules** are as in P7. There are no re-runs after results have been seen.
* **No improvement claim** is made unless the pre-registered arm 0 vs arm 1 comparison supports it. Contamination (T25) applies equally to all arms but still limits detection figures. A confirmatory version needs private ground truth and a private held-out partition.

## 5. Implementation outline (for review only; nothing built)

| Piece | Sketch | Constraint |
|---|---|---|
| `notify.ts` | Deterministic H↔O notifications from `lawCounts`-style per-situation checks, over the discovery and feedback partitions only. A separate S↔O module | Never reads the final held-out partition or the `eval/` id maps beyond the discovery build ids. Its output is hashed and anchored |
| Serving | `notifications.html` and `spec-notifications.html` from the GW2 review server, logged in the access journal | Pages are generated only after Freeze-1. The S↔O page exists only in arm 2 |
| Graph | New relation `revises`, and a node kind for notification receipts | Schema change reviewed with its own decision. The P7 graph is not migrated |
| Freeze and seal | Freeze-1, notification anchor, Freeze-2, representation seal, single gate opening | Same external-record pattern as P7 (Q14) |
| SkillBook | A new book. The P7 book and the vendored runner are not edited | Each paid step is gated per run id, as in P7 |
| Tests | Determinism of the notifications (byte equality); no held-out bytes read (instrumented reads); channel separation (no H↔O and S↔O content in one file); revision preserves the original | Test doubles only until authorization |

## 6. Threats specific to the extension

* **Leakage through notifications.** An H↔O notification reveals a recorded outcome that the agent could already have read, but it reveals *where* to look. The arms differ in exactly this, by design. It must never carry held-out or spec content.
* **Overfitting to notified situations.** Revisions may fit discovery exactly and still fail to generalize. This is why the final held-out partition stays untouched and is evaluated once.
* **Gaming.** Many narrow hypotheses could harvest notifications. Forms per session and notifications per hypothesis are capped, and both caps are pre-registered.
* **S↔O as a hint.** Spec notifications tell the agent the spec. Arm 2 answers a different question and is never pooled with arms 0 and 1.
* **Classification creep.** Neither channel may call a discrepancy a defect. D (root cause and classification) stays out of scope unless a later study provides code or intent.

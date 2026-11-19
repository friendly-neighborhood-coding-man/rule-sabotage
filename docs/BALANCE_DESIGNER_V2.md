# Living Balance Designer V2

V1 asked *"is this anomaly real?"* and nudged a weight. V2 asks *"why does it happen, and did the fix actually fix it?"*

```
Observe ─► Kane explores ─► competing hypotheses ─► controlled experiments ─► pre-registered evaluation ─► Kane challenge
 (V1 evidence,   (objective mode,   (contracts registered   (real engine + planner,   (predictions with       (analyzer: independent
  hash-checked)   own notes)         before any result)      ONE factor each)          uncertainty)            raw-row conditions)
        ─► corrections from surviving hypotheses ─► re-observation on sealed holdout ─► adequacy review ─► decision (never applied)
```

A Kane verdict is no longer treated as enough to justify a correction. A V1-style "13 rows + negation" check
establishes a fact about rows; it can never make a hypothesis SUPPORTED (`v1ConfirmationOnly()` = NOT_TESTED, tested).

The TypeScript engine stays authoritative. Nothing in V2 writes `balance/balance.weights.json`, changes the game
server, merges, or deploys.

## Commands

```bash
npm run balance:v2 -- --quick          # smoke test: 4 development + 4 holdout seeds, DRY-RUN (no kane-cli)
npm run balance:v2                     # full cycle, DRY-RUN. Ends at READY_FOR_OPERATOR_REAL_KANE_V2
npm run balance:v2 -- --run-kane       # REAL kane-cli: spends credits. Only with the operator's explicit approval.
npm run balance:v2:record [-- --run-kane]   # the same, recorded (terminal cast + raw dashboard video + labelled accelerated cut)
npm run balance:v2:verify -- <journal.ndjson>
npm run test:balance-v2-e2e            # whole cycle with the kane-cli TEST DOUBLE (labelled, never evidence)
npm run balance:v2:preflight           # zero-credit real-browser check of the notebook form (submit, nonce, window, video)
```

Flags: `--port N` (dashboard, default 4200) · `--keep-open` · `--config FILE` · `--hypotheses FILE` · `--weights FILE` · `--journal FILE` · `--workers N`.
Dashboard: `http://127.0.0.1:4200/` (add `?follow=1` to follow the active stage). Kane pages: `/v2/explore`, `/v2/challenge`, `/v2/correction`.
Dry-run evidence goes to `evidence/balance/v2-runs/<run>/` with its own journal; a real run appends to `balance/v2/journal.ndjson`.

## The two Kane roles (kept apart in the journal)

| Role | kane-cli mode | What it can contribute | Journal entry |
|---|---|---|---|
| **A. Exploration** | `kane-cli run "<objective>" --url /v2/explore --agent --headless --max-steps N --timeout S` | Its own explanations, alternatives and counterexamples, written into the page's **Investigation notebook** form | `kane-exploration` |
| **B. Verification** | `kane-cli run --analyzer-only --agent --cdp-endpoint … --condition …` | Independent re-derivation of falsifiable statements from raw rows | `kane-challenge`, `adequacy-review` |

**Why a notebook form.** kane-cli 0.10.4 (`kane-cli run --help`, inspected) documents `--analyzer-only` as "judge each
`--condition`… no objective, no actions": it cannot propose anything. Objective mode returns `run_end.status`/`summary`
but no structured output. So the exploration page carries an HTML form; whatever the browser agent submits is captured
by our loopback server with the call's nonce, arrival time and the kane-cli process window, appended verbatim to
`kane-explore/kane-notes.ndjson`, and hashed. A note becomes a hypothesis contract only if its provenance checks out
(raw file exists, sha256 matches, note id present, real non-test-double CLI). Field values are allowlisted
(component, metric, direction); the free text is stored and shown, never executed.

**Success needs both** a COMPLETE kane-cli execution (run_end received, no timeout, run_end status passed) and at least one valid note; the two are tracked separately (`execution` vs notes). Notes from an incomplete or failed run are kept as raw evidence and never registered as Kane hypotheses. In a real run, anything short of that stops the whole cycle at `CAPABILITY_LIMITATION` right after the exploration call: no further Kane calls, no retry without operator approval.

**If it does not work** (no valid note: timeout, malformed output, wrong nonce, the agent never submits), the call is
recorded as `CAPABILITY_LIMITATION` and the cycle continues with the labelled operator/Claude hypotheses only. Nothing
is attributed to Kane. This has **not** been tried with real Kane yet (no credits were spent building V2).

## Hypotheses

`balance/v2/hypotheses.json`, schema `balance/v2/schemas/hypothesis.schema.json`. H0–H4 are the operator's (Eric's
V2 spec), formalised by Claude; H5 is Claude's. None is Kane's.

| Id | Claim | Single-factor experiment | Discriminating against |
|---|---|---|---|
| H0 | No actionable defect: self-boosting is rational | E2/E5 head-to-head | H5 (blind planner not weaker) |
| H1 | Teleport geometry (middle-square destinations) favours any activator | E4 rule variant | H2 (non-installer activators also gain) |
| H2 | Planner exploitation through its own valuation | E2 (self-benefit valuation off) | H1, H4 (overlay removal does nothing) |
| H3 | Placement search picks self-beneficial cells | E3 (own benefit out of candidate scoring) | H4 |
| H4 | V0.3 weights/blend miscalibrated | E1a (Teleport utility = measured +3.4), E1b (weightMix 0) | H2, H3 |
| H5 | The planner foresees "random" teleport destinations (its look-ahead copies the engine RNG) | E5 (RNG-blind look-ahead) | H0, H1 |

Every contract has: id/version, provenance, observation + evidence refs, mechanism, competing explanation, required data,
interventions, variables held constant, primary/secondary/safety metrics, typed predictions (experiment, design,
metric, direction, material size, role), rejection criteria, expected failure modes, Kane run ids.

**Pre-registration.** Contracts are hashed, deep-frozen and journalled (`hypothesis-registered`) before the first
`experiment-result`; the first result closes registration (`preregistration-closed`). Evaluation refuses a result
whose journal sequence predates the registration, and refuses a contract whose hash changed.

**Outcomes.** Per prediction: *met* (95% interval excludes zero in the predicted direction and the estimate reaches
the material size, and both independent seed batches agree), *contradicted* (the interval rules out a material effect,
or shows the opposite), *unclear* (anything else, too few seeds, a failed manipulation check, or a "discriminating"
prediction that a rival makes identically). Hypothesis: REFUTED if a primary prediction is contradicted; SUPPORTED only
if all primary **and** discriminating predictions are met; NOT_TESTED if nothing primary ran; otherwise INCONCLUSIVE.
Kane's challenge can turn SUPPORTED into INCONCLUSIVE (a real disagreement or counterexample); it can never raise an outcome.

## Experiments

`server/balance/v2/experiments.ts`. Real engine, real planner, V1 self-play workers.

| Id | Factor (only this changes) | How |
|---|---|---|
| C0 | — | V0.3 weights, production planner and rules |
| E1a / E1b | weights | one allowlisted weight path (diff checked = exactly one path) |
| E2 | planner valuation | `PlannerHooks.selfBenefitFactor = 0` |
| E3 | candidate-cell search | `PlannerHooks.searchOwnBenefit = false` |
| E4 | rule geometry (EXPERIMENTAL) | `RuleVariant { teleport: 'same-column' }`, needs the `EXPERIMENTAL_RULE_VARIANT` token |
| E5 | planner information | `PlannerHooks.blindRng = true` |

Hooks and variants are inert unless passed: the game server, referee, trial and tiers never pass them (unit test), and
recorded V1 games replay byte for byte with the hooked code (unit test + the observation stage replays V1 games).
`engine.ts` changed only by the optional `variant` field; its source hash therefore changed (V1 evidence keeps the hash
of the commit it ran on).

Designs: **self-play** (both players treated; same seeds, both first-player orders) measures behaviour change;
**head-to-head** (treated planner vs control planner, both sides, both first-player orders) measures the randomized
marginal impact on winning; **observational** reads the control. Uncertainty: cluster bootstrap over seeds (seeded,
reproducible), plus the effect on each half of the seed list and on each first-player order. Games diverge after the
first changed decision, so pairing is at the (seed, first player) level; the first divergence turn is recorded.
"Win rate of players who used X" is kept as a descriptive metric and labelled selection-biased.

## Seeds

`balance/v2/config.json`: **exploration** = V1 training seeds 1000–1011 (observation and Kane exploration only) ·
**development** = 3200–3215 (experiments, evaluation; 3000–3003 and 3100–3115 are already spent) · **holdout** = 7100–7115 (7000–7015 was spent by the first dry-run), sealed in a `SeedVault`: requesting
them throws until hypotheses and corrections are frozen; the run journals a salted sha256 commitment at sealing and
the salt + seeds at unsealing. The exploration and challenge pages are checked for holdout seed numbers.

## Corrections and the adequacy review

Corrections come only from SUPPORTED hypotheses (`server/balance/v2/corrections.ts`), typed and allowlisted
(`balance/v2/schemas/intervention.schema.json`):

| Category | Policy | Effect |
|---|---|---|
| weight | PROPOSAL_ONLY | a weights file in the run directory if SUFFICIENT; never written to production |
| planner | REVIEW_REQUIRED | a recommendation; the source change needs a separate reviewed implementation |
| game-design | EXPERIMENTAL_ONLY | stays an experiment-only rule variant until the operator approves a rule change |
| metric | RECORD_ONLY | a revised measurement, no gameplay claim |
| none | NO_CHANGE | an honest null result forces nothing |

The reviewer runs on the unsealed holdout and answers two separate questions:

- **A. Implementation correctness** (PASS / FAIL / UNVERIFIED): did decisions actually change, did only the declared
  component change, do engine invariants hold, does browser-observable behaviour match the declared spec (real Kane).
- **B. Balance adequacy** (SUFFICIENT / PARTIAL / INEFFECTIVE / REGRESSION / UNVERIFIED): material, confident target
  change on fresh seeds; both seed batches; both first-player orders; enough seeds; safety; diversity; no new dominant
  exploit; counterplay; side/first-player balance and length within tolerance; head-to-head strength cost (informational).
  "More enjoyable" is reported as NOT MEASURED.

A technically correct correction can be INEFFECTIVE or PARTIAL. SUFFICIENT additionally needs real Kane verification;
without it the final verdict is UNVERIFIED and the deterministic result is shown as *provisional*. PARTIAL records what
is unresolved and proposes the next discriminating experiment instead of widening the same adjustment.

## Resource and safety controls

| Control | Default |
|---|---|
| kane-cli only with `--run-kane` | dry-run |
| Kane calls per run | 4 (1 exploration, 1 challenge analyzer, 1 correction analyzer, +1 optional challenge objective) |
| Credit ceiling | 80, an **operating ceiling, not a hard limit**: a successful `kane-cli balance` check is required before every call (no verified balance → no call); a call is refused if the remaining budget is below its conservative estimate (objective 40, analyzer 15); no call starts once measured spending reaches 80; if the balance cannot be read after a call, no further calls. A running kane-cli call cannot be stopped at a credit limit, so one call can overshoot; that is reported in the credit ledger. |
| Exploration step / time limit | 25 steps / 420 s |
| Concurrent kane-cli processes | 1 |
| Games per run / wall clock | 700 / 90 min |
| One V2 run at a time | `evidence/balance/v2-runs/.v2.lock` |

A test double (`version 0.0.0-test-double`) is labelled everywhere, its notes become `kane-test-double` hypotheses,
it corroborates nothing and can never produce SUFFICIENT. Budgets and failures stop at a labelled CHECKPOINT; nothing
missing is fabricated. Recordings and logs go through the same secret redaction as V1.

## Files

`server/balance/v2/`: `interventions.ts` (allowlist) · `metrics.ts` (metrics, bootstrap) · `contracts.ts` (contracts,
provenance, registry, evaluation) · `experiments.ts` (catalogue, executor, seed vault, manipulation checks) ·
`kane2.ts` (exploration + notebook) · `pages.ts` (Kane pages, conditions) · `corrections.ts` (corrections, adequacy) ·
`cycle.ts` (orchestrator, dashboard server, journal, report). Dashboard: `balance/dashboard-v2/`.
Tests: `tests/balance-v2.test.ts`, `tests/balance-v2.e2e.ts`.

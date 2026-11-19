# Balance Designer V2: independent review against the mission

**Overall: PARTIAL.** The pipeline can tell these apart, and did so in a real (Kane-free) cycle:

- a verified observation (V1 evidence, hash-checked);
- a credible causal hypothesis (H3 SUPPORTED, H2/H4 REFUTED);
- a successful implementation (K1 changed behaviour, only in the declared component);
- a correction that remains inadequate (K1 REGRESSION).

It has **not** shown a genuinely effective correction, and real Kane has contributed nothing yet: no credits were
spent, by instruction. Functional E2E success (15/15) is not scientific success and is not counted as such below.

Evidence: run `evidence/balance/v2-runs/2026-11-19T07-54-37Z-v2-dry/` (summary in `docs/BALANCE_V2_RESULT.md`),
test-double E2E run, unit tests.

| Dimension | Verdict | Evidence | Exact shortcomings | Needed for PASS |
|---|---|---|---|---|
| Kane autonomy | **NOT_TESTED** | Exploration channel built: objective mode + notebook form + provenance checks (`server/balance/v2/kane2.ts`). It is exercised only by the scripted test double (E2E: its note became `HK1`, labelled `kane-test-double`). | Real Kane has neither proposed nor challenged anything. It is unknown whether kane-cli 0.10.4's objective agent will fill in and submit an HTML form. If it does not, the result is CAPABILITY_LIMITATION and Kane is again only a verifier. | One bounded real run (`--run-kane`). Kane must submit ≥1 valid note that becomes a registered `kane` contract and is tested, or CAPABILITY_LIMITATION must be recorded honestly. |
| Hypothesis quality | **PARTIAL** | 6 contracts, each with discriminating predictions, registered and hashed before any result (journal #5–#10 precede `preregistration-closed`). H2 and H4 were cleanly refuted. | (1) The first shove metric was non-discriminating (constant 1.0). This was found in a smoke run and fixed before the real cycle, on fresh seeds (disclosed). (2) H5's primary P5b was mis-specified: a quantity that is 0 under every condition. It refuted H5, although P5a (−1.35 squares) and P5c (blind planner wins 31%) both held. (3) H1's discriminating prediction had only 6 events, so it was never judged. | A pre-registration power/variance check of each predicted metric on exploration seeds, then H5 v2 and a better-powered H1 contract on new development seeds. |
| Experimental rigor | **PARTIAL** | Single-factor interventions are allowlisted. Isolation is unit-tested (E2/E3/E5 touch only their component). All 24 recorded V1 games replay byte-exact with the hooked code (`npm run balance:v2:verify-v1-replay`). Seed sets are disjoint, the holdout is sealed with a salted commitment, a seed-cluster bootstrap is used, effects are reported per batch and per first-player order, and a manipulation check is run per condition. | 16 development seeds. Development seeds 3000–3003 were looked at in a smoke run and then replaced. Divergence is detected from placements, triggers and outcome only. Under E4 the planner's heuristic path cost still assumes production teleport geometry (a known confound for H1). E2 also changes how the planner values the opponent's conveyors. | More seeds or independent batches. Log moves for divergence. Add an E4 run with a matching planner estimate. |
| Correction effectiveness | **PARTIAL** | K1 (from H3) changed behaviour in 32/32 holdout games. Shove self-trigger share went 0.884 → 0.645 (−0.24, CI −0.29 to −0.17), consistent across both batches and both first-player orders. | It changed the target but also lengthened games (15.7 → 27.6 turns), raised turn-limit/draw endings by 15.6 points, and the corrected AI wins 21.9% head-to-head. Kane did not verify the browser-observable behaviour. | A correction that moves the target without the length/strength cost, e.g. the reviewer's next experiment: a 2×2 of E2 and E3, or a partial own-benefit weight in search. |
| Adequacy | **FAIL** (issue unresolved) | The reviewer issued REGRESSION, with implementation correctness UNVERIFIED (no Kane) and kept separate. Nothing was promoted, and production is unchanged. | The original issue (self-boost conveyors, teleport exploitation) is still present in production. | A correction rated SUFFICIENT on fresh seeds with real Kane verification. |
| Safety | **PASS** | 0 illegal actions, 0 engine errors and 0 softlocks in 384 V2 games. Engine invariant suite passes. The game server, referee, trial and tiers never pass hooks or variants (test). Rule variants need an explicit experimental token. Production weights are untouched (E2E). V1 manifests and the V1 journal still verify (test). `npm test` 91/91, `test:balance-e2e` 9/9. | `engine.ts` gained an optional, inert `variant` field, so the engine source hash changed. | — |
| Reproducibility | **PASS** | Games are deterministic per seed and config. Every run has an append-only hash-chained journal (verified), a manifest with sha256 of every file, raw games per condition, the exact pages and conditions, the config, and contract hashes. `REPORT.md` is generated from status. A V1 replay verifier exists. | Per-game wall times (`ms`) differ between machines (excluded from comparisons). | — |
| Demonstration quality | **PARTIAL** | Recorded dashboard (12 min raw, 52 s accelerated with every frame labelled). It shows observation → hypotheses → experiments → correction → holdout → adequacy, including an explicit REGRESSION. | The recording is a dry-run, so it shows no Kane activity, and a judge cannot see any substantive Kane contribution. | The same recording made with `--run-kane`, after operator approval. |

## Known capability gaps and open questions
- Can kane-cli objective mode submit an HTML form reliably? Untested. The fallback is CAPABILITY_LIMITATION.
- The credit cost of an objective-mode call is unknown. V1 analyzer calls cost about 6–8 credits. Objective mode with 25 steps may cost more. The run measures `kane-cli balance` before and after each call and stops at 80 credits.
- `npm run test:browser` was **skipped**: the `playwright` package is not installed in this checkout (`Cannot find module 'playwright'`). Installing it was not done without asking.
- Enjoyment is not measured. Health proxies only.

## Status
`READY_FOR_OPERATOR_REAL_KANE_V2`. A bounded real run, at most 4 kane-cli calls with a credit cap of 80, needs the operator's explicit approval.

**Seeds for the next run.** The first dry-run unsealed holdout 7000–7015 and used development seeds 3100–3115, so
`balance/v2/config.json` now points to fresh sets: development 3200–3215, holdout 7100–7115. The next run (real
Kane or not) never reuses seeds it has already looked at.

# Balance Designer V2: the one authorised real Kane run

**Status: READY_FOR_OPERATOR_V2_RESULT_REVIEW.**

Kane proposed one hypothesis of its own. It was registered with checked provenance and tested against the six
operator/Claude hypotheses, and the result was **INCONCLUSIVE**. Kane also re-derived every raw-row condition it was
given (11/11 agree). The one surviving correction was **REGRESSION**. Nothing was promoted.

| | |
|---|---|
| Authorisation | Eric, 2026-11-19 08:46 UTC: one bounded run, ≤ 4 calls (3 planned), 80-credit operating ceiling, fresh seeds. Relaunch approved 11:34 UTC after launch 1 never reached Kane. |
| Command | `KANE_CLI=…\kane-cli.cmd npm run balance:v2:record -- --run-kane` |
| Run | `evidence/balance/v2-runs/2026-11-19T11-35-00Z-v2-kane/` (REPORT.md, status.json, every game, every page Kane saw, raw kane-cli NDJSON/stderr, notes, manifest) |
| Commit / engine / weights | `ebcc04b` (clean) / `5b79cac132ecdfbd` / `0.3.0#ddcf941c285bd537` |
| Seeds | exploration = V1 games 1000–1011 · development 3200–3215 · holdout 7100–7115 (unsealed once, after corrections were frozen; commitment verified) |
| Games | 384 new + 2 traced V1 replays (reproduced exactly); 0 illegal actions, 0 errors, 0 softlocks |
| Journal | `balance/v2/journal.ndjson`: 44 entries, hash chain verified (entries 1–7 are the aborted launch 1) |
| Wall time | 11:35:15 → 11:52:17 UTC |
| Recording (kept locally, size) | `evidence/balance/v2-recordings/2026-11-19T11-35-00Z/`: `raw.webm` 19 min unedited (sha256 `5e2a8e737e7e…`), `concise.webm` 87 s with every frame labelled ACCELERATED 12× (`5f8325fb3760…`), `terminal.cast` |

## Credit accounting (`kane-cli balance` before and after every call)

| Call | Role | Before | After | Used | Pre-call estimate |
|---|---|---|---|---|---|
| KX1 | exploration (objective mode, 25 steps max) | [balance redacted] | [balance redacted] | **40.092** | 40 |
| KC1 | challenge (analyzer, 9 conditions) | [balance redacted] | [balance redacted] | **9.119** | 15 |
| KA1 | correction check (analyzer, 2 conditions) | [balance redacted] | [balance redacted] | **5.125** | 15 |
| | **total** | | | **54.336 / 80** | |

The 4th call (objective-mode challenge) was not made; it is off by default. KX1's own `run_end` reported 38.011
credits. The 2.08-credit difference from the balance delta is probably the balance/probe calls; it is unexplained,
so it is reported rather than assumed. Launch 1 spent 0 credits.

## A. What Kane noticed (exploration, objective mode)

kane-cli executed the whole objective (`run_end.status: passed`). During the call the browser agent submitted
**one valid notebook note**, `KX1-N1`, at 11:38:45, with a valid nonce, inside the call window. The note is quoted
verbatim from `kane-explore/kane-notes.ndjson`:

> **Defect?** yes · **Part:** weights · **Prediction:** `tp_self_share` should increase
>
> "The V0.3 prior/blend misvalues Teleport: it assigns -0.80 although triggered pieces gain 3.41 squares on average,
> so the planner's use of Teleport is better than that prior says. East and west shoves are not a directional defect:
> each player places the shove toward its own goal (Human east, AI west), and the measured gains are positive. The
> planner choices therefore reflect board geometry plus an outdated Teleport weight."
>
> **Alternative it considered:** "Teleport is simply harmful random play, and … the shove pattern reflects a geometry
> bug rather than correct directional play." **Counterexample row:** T3.

The note became contract **HK1** (origin `kane`, provenance checked: raw-file sha256, note id, real CLI 0.10.4).
It was registered at journal #17 (hash `6cf2be4cf60b5e92`), **before** the first experiment result (#20), and was mechanically mapped to experiment E1a
(Teleport utility set to its measured +3.4).

Kane's explanation is its own. It is not one of H0–H5, though it overlaps H4 (weights) and H0/H1 (rational,
geometric play). The page showed no hypotheses.

## B. Outcomes (pre-registered, development seeds 3200–3215)

| Id | Origin | Outcome | Key evidence |
|---|---|---|---|
| H0 no defect | operator | **REFUTED** | Removing self-benefit valuation did not weaken the planner head-to-head (+6 pts, CI −6 to +19). |
| H1 geometry | operator | **INCONCLUSIVE** | Distance-neutral teleport cut teleport placements by 1.1/game (met). Non-installer comparison: only 10 events, not judged. Own-teleport gain fell 1.46 squares under RNG blinding, against H1's prediction. |
| H2 valuation | operator | **REFUTED** | Shove self-trigger +0.016, teleport self-share +0.029 with self-benefit valuation off. |
| H3 placement search | operator | **SUPPORTED** | Shove self-trigger 0.889 → 0.714 (−0.175, CI −0.24 to −0.10). The overlay does not matter. This replicates the dry-run (−0.19) on new seeds. |
| H4 weights | operator | **INCONCLUSIVE** | Calibrated Teleport utility: teleport self-share +0.010 (CI −0.087 to +0.103). Not material, but the interval still reaches 0.103, just past the 0.1 bar, so it cannot be ruled out (the dry-run refuted it). |
| H5 RNG foresight | Claude | **REFUTED** (its mis-specified P5b again 0 vs 0) | Blinding cut own-teleport gain by 1.46 squares (met again). Head-to-head −8 pts, not significant this time. |
| **HK1 Kane** | **kane** | **INCONCLUSIVE** | Same E1a measurement as H4: +0.010 (CI −0.087 to +0.103) against a predicted increase ≥ 0.10. The direction is not supported, but the interval is too wide to refute it. Teleport self-share is already 0.88, so there is little room to rise. |

## C. Kane's challenge (analyzer, independent raw-row conditions)

Kane answered all 9 conditions, re-deriving from raw per-seed values and raw trigger samples, and **agreed with our
computation on all 9**. On the post-correction page it answered both conditions, again agreeing. Kane therefore
corroborated (AGREES) every tested section, including the ones that say its own HK1 prediction did not hold
(`HK1-seeds`: false, as ours).

This confirms the data reading. It is not an independent causal argument, and no outcome was changed by it.

## D. Correction and adequacy (holdout 7100–7115, never seen before)

K1 is a **planner correction** (from H3, REVIEW_REQUIRED): score candidate cells without own-piece benefit.

- **A. Implementation correctness: PASS.**
  - 32/32 games diverged.
  - Only the declared component changed.
  - The invariants hold.
  - Kane confirmed the browser-observable behaviour matches the declared spec.
- **B. Balance adequacy: REGRESSION.**
  - The target improved robustly: 0.873 → 0.612 (−0.261, CI −0.33 to −0.19), with both batches and both first-player orders agreeing.
  - Games almost doubled in length: 14.5 → 27.1 turns.
  - Draw or turn-limit endings rose by 18.7 points.
  - The first-player edge grew from −0.06 to +0.21.
  - The corrected AI wins 18.8% head-to-head.
- **Decision: NO CORRECTION PROMOTED.**

## E. Was Kane's contribution substantive?

**Partly.**

It was substantive in three ways:
1. Kane really did observe the game data and form its own explanation, including an alternative and a counterexample.
2. That explanation went through the same pre-registered, falsifiable test as everyone else's.
3. Kane independently re-derived every factual condition, and confirmed the corrected behaviour in the browser.

It is still limited in four ways:
1. Kane's hypothesis is close to H4, which was already on the list. Its one testable prediction (teleport self-share rises when the prior is fixed) is near a ceiling, and came out INCONCLUSIVE.
2. Kane's other claim, that the shove pattern is not a defect, was mapped to nothing testable by the form. Its single metric/direction pair cannot express two claims, so that part went unevaluated.
3. As a challenger, Kane agreed with everything. It found no counterexample and changed no outcome. The objective-mode challenge call that could have argued with the evidence was not run.
4. The note-to-experiment mapping (weights → E1a) is mechanical. Kane did not choose the experiment.

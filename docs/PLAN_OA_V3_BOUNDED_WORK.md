# Plan: oa-v3, bounded-work opponent-aware policy (prepared, not implemented, not run)

oa-v2 and every frozen oa-v2 result stay unchanged. This is an implementation plan only.

## Measured cost drivers (V5.1 profile, `evidence/balance/v5_1/oa-profile.json`)

Slow decisions are 11–53 s on average (max 100 s) against 0.8–3 s normally. 65–87% of the time goes to the worst-case search.
The drivers are: own end states up to 3,352 per decision (a second teleport inside our own move phase multiplies outcomes),
237–312 opponent options per decision (6 candidates × up to 8 strata × 5–13 opponent placements, each with a full greedy move
phase), and own end states enumerated for all ~12 candidates before only 6 are searched.

## Design

| Change | What it bounds | Exactness |
|---|---|---|
| B1 Two-stage own enumeration: exact first-teleport outcomes; a second-level teleport inside a continuation is collapsed into strata before it is expanded | own end states (n × n becomes n × 8) | labelled approximation, error measured against exact on stored positions |
| B2 Pre-rank candidates on the first stage only, then expand the top 6 | repeated work (13–35% of time) | exact for the top-6 selection when stage-1 order equals the full order; measured |
| B3 Opponent options: rank all opponent placements by a cheap one-step value, search the top 4 plus "none" | opponent options (≤ 5 per stratum) | labelled approximation; how often the true worst case is outside the top 4 is measured on stored positions |
| B4 Memoise the worst-case value by canonical state within one decision | repeated identical sub-searches | exact |
| B5 Explicit per-decision work budget (greedy simulations); if hit, finish the current candidate, rank what was searched, and record `budgetHit`, the caps that applied and the budget used | worst-case wall time | recorded fallback, never silent; games are never truncated |

## Validation before any game

* On the stored oa-v2 positions (including the 4 slow games): decision agreement with oa-v2, score error, time per decision,
  and how often B3 or B5 changed the decision.
* Mirror symmetry and hidden-RNG invariance of plans and executed moves (the V5 preflight suite).
* Plan/execution agreement with the shared executor.
* Then, and only with an approved budget, a small preregistered comparison against oa-v2.

# GW2 P6 test-double report

**All sessions are scripted TEST DOUBLES started through the Kane invocation boundary. They measure the machinery, not any agent.**

Dataset: P5 development and dry-run dataset (U1, D93).

| Profile | Hypotheses / abstentions | Coverage (held-out situations) | Held-out accuracy | Incorrect assertions | Defects described accurately | Cited without access |
|---|---|---|---|---|---|---|
| accurate | 3 / 0 | 109/396 | 109/109 = 1 | 0 | 0/3 | 0 of 9 |
| careless | 3 / 0 | 109/396 | 109/109 = 1 | 0 | 0/3 | 20 of 20 |
| over-abstaining | 0 / 3 | 0/396 | no assertion (no rate) | 0 | 0/3 | 0 of 0 |
| confident-wrong | 3 / 0 | 218/396 | 95/218 = 0.436 | 123 | 0/3 | 0 of 6 |
| defect-describer | 2 / 0 | 212/396 | 212/212 = 1 | 0 | 1/3 | 0 of 6 |

Dimensions are reported side by side and never combined; no ranking by a single column is reported. Detection counts abstention as not detected; error counts are over assertions made.

**Over-abstaining vs accurate.** Ranks above on: nothing. The over-abstaining profile makes no assertion, so it has no contradicted prediction: it is "better" on incorrect assertions only because it asserts nothing. Its accuracy has no denominator (no rate), its coverage is 0 and its detection counts every abstention as not detected, so it never ranks above the accurate profile on those (EXPERIMENT_DESIGN §3 abstention handling).

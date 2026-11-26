# GW2 P7 pilot report

**Real Kane sessions (exploratory capability and feasibility study; not an architecture comparison, no claim of improvement).**

Dataset: P7 evidence (p7-generation-1, p7-partition-1).

## Execution (operational, per session; credits, steps and time are separate columns)

| Session | Run | Status | Exit | Timed out | run_end | Steps | Elapsed ms | Credits (balance delta) | Ceiling outcome | Kane-reported credits | Raw seal |
|---|---|---|---|---|---|---|---|---|---|---|---|
| e95f5bc28e46532c | GW2-P7-pilot-1 | completed | 0 | false | passed | 21 | 142463 | 31.844 | WITHIN_CEILING | 29.680727500000003 | 60419742ff39 |
| f6003f7e3d5f8469 | GW2-P7-pilot-2 | completed | 0 | false | passed | 17 | 147677 | 48.48 | WITHIN_CEILING | 37.42277 | 923c8acb7261 |
| 1e26529c62afc36e | GW2-P7-pilot-3 | completed | 0 | false | passed | 45 | 196430 | 51.719 | WITHIN_CEILING | 51.1283675 | 01199671a046 |

## Separated dimensions

| Session label | Profile | Hypotheses / abstentions | Coverage (held-out situations) | Held-out accuracy | Incorrect assertions | Defects described accurately | Cited without access |
|---|---|---|---|---|---|---|---|
| REAL KANE SESSION (kane-cli) | kane | 2 / 0 | 0/914 | no assertion (no rate) | 0 | 0/4 | 0 of 3 |
| REAL KANE SESSION (kane-cli) | kane | 2 / 0 | 0/914 | no assertion (no rate) | 0 | 0/4 | 0 of 4 |
| REAL KANE SESSION (kane-cli) | kane | 4 / 0 | 384/914 | 194/384 = 0.505 | 190 | 0/4 | 0 of 5 |

Dimensions are reported side by side and never combined; no ranking by a single column is reported. Detection counts abstention as not detected; error counts are over assertions made.



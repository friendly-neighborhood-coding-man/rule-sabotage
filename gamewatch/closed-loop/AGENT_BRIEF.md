# Brief for the coding agent (GameWatch closed loop)

You are fixing a build of the board game Rule Sabotage V6.1 (`server/v6/`). An external QA reviewer (Kane) looked at
playtest evidence of this build and reported findings in `KANE_FINDINGS.ndjson` (one JSON object per line, verbatim).
The documented rules are in `gamewatch/rules-doc.ts` (R1–R15).

For each finding:
1. Reproduce it. Write a scripted playtest in `gamewatch/scenarios.ts` (or reuse one) and run
   `GW_BUILDS=under-test node --experimental-strip-types gamewatch/run-evidence.ts all`, then inspect
   `evidence/gamewatch/evidence.json` / the site (`gamewatch/dashboard.ts`). Record: reproduced or not.
2. If reproduced, find the cause in the game code and fix it with the smallest change that restores the documented rule.
   Do not change the documented rules, the opponents, the referee or the evidence tools.
3. Re-run the same scripted playtests and matched games and compare with the run before your fix.
4. Write `CLOSED_LOOP_REPORT.md`: per finding, reproduced? cause, fix (diff), before/after evidence; findings you
   could not reproduce; any problem you found that Kane did not report; suggestions you did not implement and why.

Rules: do not fabricate evidence; do not access the network or any other copy of this repository; run the existing
tests (`npm run test:v6`) before you finish and report the result.

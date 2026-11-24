# Brief for the coding agent (GameWatch closed loop)

You are fixing a build of the board game Rule Sabotage V6.1 (`server/v6/`). An external QA reviewer (Kane) looked at
playtest evidence of this build and reported findings in `KANE_FINDINGS.ndjson` (one JSON object per line, verbatim).
The documented rules are in `gamewatch/rules-doc.ts` (R1–R15). A finding can be right, partly right, wrong, or may
report that nothing is wrong: check each one against the rules and the code; do not assume it is correct.

This is a single attempt. Work in this directory only.

## Steps

1. **Collect the "before" evidence** of the build as you received it, before changing anything:
   `node --experimental-strip-types gamewatch/run-evidence.ts all` (scripted playtests from `gamewatch/scenarios.ts` and
   matched AI-vs-AI games; about 2–4 minutes) and keep a copy of `evidence/gamewatch/evidence.json` (for example as
   `evidence/gamewatch/evidence-before.json`).
2. **Reproduce each finding before you modify the game code.** Add a scripted playtest to `gamewatch/scenarios.ts` or a
   test in `tests/` that shows the behaviour, run it, and record: reproduced, not reproduced, or not applicable (for a
   finding that reports no problem, say whether you agree and why).
3. **Fix** each reproduced finding with the smallest change in the game code that restores the documented rule. Do not
   change the documented rules, the opponents, the referee or the evidence tools.
4. **Add regression tests** (`tests/closed-loop.test.ts`, run with `node --experimental-strip-types --test <file>`)
   that fail on the build as you received it and pass after your fix. Say in the report that you saw them fail first.
5. **Re-run the same playtests and matched games** after the fix. `run-evidence.ts` reuses the raw game files in
   `evidence/gamewatch/raw/`, so move that folder aside first (for example to `evidence/gamewatch/raw-before/`), then run
   the same command and compare with the "before" evidence.
6. Run the existing tests (`npm run test:v6`) and your new tests, and report the results.
7. Write `CLOSED_LOOP_REPORT.md`: per finding, reproduced or not and how; cause; fix (diff); before/after evidence;
   findings you could not reproduce; any other problem you found that Kane did not report; suggestions you did not
   implement and why; test results.

## Rules

Do not fabricate evidence or results. Do not access the network, any other directory, or any other copy of this
repository. If something cannot be done, say so in the report.

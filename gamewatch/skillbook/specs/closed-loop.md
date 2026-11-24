# Spec: closed loop

- Input to the agent: Kane's valid findings, verbatim (all of them, including a "clean" one), and a blind workspace (no
  history, no private files, no experiment documents, no freeze hashes of the clean engine, build under test as
  `server/v6/engine.ts`). The agent must run without network or repository access; the operator's agent command
  enforces what its CLI allows.
- ONE repair attempt per experiment (`evidence/gamewatch/repair/attempt.json`). A loop back from the regression review
  refuses and goes to the report: the reference comparison and the ground truth never guide another attempt.
- The agent reproduces each finding before changing the game code, makes minimal fixes, adds regression tests, re-runs
  the scripted playtests and matched games and writes `CLOSED_LOOP_REPORT.md` (`gamewatch/closed-loop/AGENT_BRIEF.md`).
- When the agent exits (or is stopped at `GW_AGENT_TIMEOUT_S`, default 3300 s), its output is frozen:
  `evidence/gamewatch/repair/output/` + `FREEZE.json` (LF-normalised sha256). Verify with
  `node --experimental-strip-types gamewatch/skillbook/steps/repair-freeze.ts verify`.
- Afterwards: the same scripted playtests and matched games are re-run, freshly, on the corrected build and compared
  with the reference build. Only then, and only on the frozen output, the operator scores against a private ground
  truth where one exists (`gamewatch/private/evaluate-repair.ts`).

# Spec: closed loop

- Input to the agent: Kane's valid findings, verbatim, and a blind workspace (no history, no private files, build under
  test as `server/v6/engine.ts`). The agent must run without network or repository access.
- Output: `CLOSED_LOOP_REPORT.md` and the corrected engine in the workspace.
- Afterwards: the same scripted playtests and matched games are re-run on the corrected build and compared with the
  reference build. Where a private ground truth exists, the operator scores with `gamewatch/private/score.ts`.

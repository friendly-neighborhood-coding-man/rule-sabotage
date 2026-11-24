# GameWatch: demo video script (about 3 minutes)

Every number on screen comes from the published evidence (`docs/GW1_FINAL_REPORT.md`). Two things are never said or
shown: that Kane found all three defects, and that Kane analysed balance statistically.

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:15 | Rule Sabotage board, a turn being played | "Game rules break in ways unit tests don't see. GameWatch is a QA harness that uses the playtests a game already has, scripted runs and AI self-play, and lets Kane review them like a QA tester." |
| 2 | 0:15–0:35 | `gamewatch/skillbook/book.json` beside the SkillFlow runner output | "GameWatch is a SkillBook: fourteen tasks in three groups, Collector, Porter and Analyzer. SkillFlow, our separate MIT-licensed runner, executes it one task at a time, with checks, branches, checkpoints and authorization gates." |
| 3 | 0:35–0:55 | Terminal: the free run stopping with `needs-authorization` at `analyze-kane-review` | "Everything up to the paid step is free and reproducible. It covers all 15 rules on both builds, regenerates 56 evidence pages byte for byte and leak-checks them. Then it stops: the paid Kane call needs the operator's approval and a code gate." |
| 4 | 0:55–1:15 | The evidence site: index, one case page with before/after state and engine events | "For the experiment we planted three defects in one build: an asymmetric shield, a life-cycle bug, and a first-mover bias. The ground truth was frozen before Kane ran. Kane sees only these anonymous pages: two builds, labelled QX-41 and QX-73, with no hint of what is wrong." |
| 5 | 1:15–1:45 | `notes.ndjson`: the three submitted forms; highlight R8 and R3 | "One Kane call, 72 credits, under five minutes. Kane confirmed two anomalies with exact case and step references: a +1 action cell that fires twice, and four actions granted for three pieces. It missed the shield defect, because it never opened the case that shows it. It also filed a clean report before it had looked at the faulty build. GameWatch keeps every form, so that contradiction is visible." |
| 6 | 1:45–2:20 | Blind workspace tree; `CLOSED_LOOP_REPORT.md` scrolling | "Next, one coding-agent repair attempt. The agent sees only a stripped workspace, the rules and Kane's findings: no ground truth, no history, no clean engine. It reproduced both of Kane's findings before touching the code. It traced the action bug to the first mover, not just the human player. And in the same playtest evidence it found the shield defect Kane had missed." |
| 7 | 2:20–2:40 | The 3-line diff; `FREEZE.json`; `repair-freeze.ts verify` printing ok | "Three one-line fixes and seven regression tests, which fail on the old build and pass on the new one. The output is frozen the moment the agent exits. Only then do we compare it with the private ground truth." |
| 8 | 2:40–2:55 | Evaluation output: B1, B2 and B3 fixed, controls unchanged, 42/42 and 7/7 tests | "The independent probes find all three defects fixed and no control behaviour changed. The fresh re-run matches the clean reference on all 11 scripted playtests." |
| 9 | 2:55–3:05 | Final slide: "Kane 2 of 3 · agent 3 of 3 · 1 call · 1 attempt" plus the limitations line | "One run with three planted defects is a demonstration, not a benchmark. The full report covers the limitations, the logs and how to recompute every number without a paid call." |

## Recording notes

* Use the published files only. Redact nothing on screen: the published evidence is already redacted.
* For steps 3, 7 and 8, use the commands in `docs/DEMO.md` (§1, §4, §5).
* Do not open `gamewatch/private/` on screen before step 8, so the order of the story stays honest.

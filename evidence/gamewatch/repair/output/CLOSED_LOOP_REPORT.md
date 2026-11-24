# Closed-loop report: Kane findings on Rule Sabotage V6.1 (`server/v6/`)

Date: 2026-11-25. Single attempt, in this directory only, no network.

## Summary

| # | Kane finding | Rule | Verdict | Fixed |
|---|---|---|---|---|
| 1 | "Clean / no problem found" (case C-9fc650) | – | **Disagree.** The build shows three rule violations (findings 2 and 3 below, plus one Kane did not report). Kane's findings 2 and 3 cite the same case C-9fc650, so finding 1 also contradicts Kane's own report. | n/a |
| 2 | A "+1 action" cell reached by a shove is not used up and fires again on re-entry | R8 | **Reproduced** | yes |
| 3 | Human gets 4 actions at turn start with 3 pieces on the board | R3 | **Reproduced, and the cause is wider than Kane said**: it is not Human-specific. Whoever moves on an odd-numbered turn (always the first mover) gets +1 action every turn. | yes |
| – | (not reported by Kane) A shield on a **Human** piece does nothing: the Human piece is still hit by the effect | R14, R7 | **Found and reproduced** | yes |

About the case and build IDs: Kane's IDs (C-9fc650, C-757669, builds QX-73 and QX-41) are not in this workspace. `run-evidence.ts` here runs one build, labelled `under-test`, and case IDs are hashes of the build label, so my case IDs differ (e.g. C-2ba90f). I reproduced the *behaviour* by running the same scripted playtests (`shove-chain-ai` is the "forced-entry +1" script Kane describes) on the build as received. I cannot confirm that my build is byte-identical to Kane's QX-73. Its behaviour matches every detail Kane gives for QX-73, and after the fix it matches what Kane gives for QX-41.

## Finding 2 (R8): a cell reached by an effect is not used up

**Reproduction (before any code change).** Scripted case `shove-chain-ai` (Kane's "forced-entry +1" script: AI places Shove west 2 on K5 and later +1 action on I5; it moves M5→L5→K5 (shoved to I5), then I5→H5→I5):
- before evidence: `fired[K5:Shove west 2, I5:+1 action, I5:+1 action]`, no move refused. I5 fired twice and gave two extra actions.
- the mirror case `shove-chain-human` had the same defect: `E5:+1 action` fired twice.
- direct engine test: after a shove onto I5, `s.cells['8,4']` was still `51` (the effect id), so the cell was still live.

**Cause.** In `land()` the cell was only used up when the arrival was **not** forced:
```ts
if (!forced) unsetCell(s, k);
```
R8 says a cell is used up "however the piece arrived: by its own move, or by being moved there by another effect".

**Fix** (`server/v6/engine.ts`, `land`):
```diff
-      if (!forced) unsetCell(s, k);
+      unsetCell(s, k);
```
Cells past the chain cap are unaffected. They are handled in the `depth > MAX_CHAIN` branch above, which never reaches this line, so they still stay on the board as R9 requires.

**After.** `shove-chain-ai`: `fired[K5:Shove west 2, I5:+1 action]`, and the last `AI move I5 left` is **refused** ("No actions left"), as Kane describes for QX-41. `shove-chain-human`: E5 fires once and the last `Human move E5 right` is refused.

## Finding 3 (R3): an extra action on odd turns

**Reproduction (before any code change).** In the before evidence, every scripted case grants Human 4 actions and AI 3 (`grants[H4 A3 H4 …]`). Human moves first in all scripts, so Human plays the odd turns. The AI-vs-AI games show the full pattern: in **200 of 390** turns the actions granted were more than the pieces on the board, for both seats (0 of 528 after the fix). A direct test (`init(97100)`, both first movers) got `actual: 4, expected: 3` on turn 1.

**Cause.** `startTurn()` added a parity term:
```ts
s.actionsLeft = onBoard(s, p).length + s.bonus[p] + (s.turn % 2);
```
Turn 1, 3, 5… always belongs to the first mover, so the first mover got one extra action every turn. R3 says the only way to get more than one action per piece is a "+1 action" effect. Kane described it as a Human problem only because Human moves first in every script.

**Fix** (`server/v6/engine.ts`, `startTurn`):
```diff
-  s.actionsLeft = onBoard(s, p).length + s.bonus[p] + (s.turn % 2);
+  s.actionsLeft = onBoard(s, p).length + s.bonus[p];
```

**After.** Every scripted case grants `H3 A3 …`. In the matched games, **0 of 528** turns granted more actions than pieces on the board. Any extra action now comes from a fired +1 action cell, and it is carried in `bonus` to the turn-start count only when the cell was entered on the opponent's turn.

## Not reported by Kane (R14, R7): a shield only worked for AI pieces

**Reproduction (before any code change).** Scripted case `shield-human` (Human picks up a Shield on C3, then walks into an AI "Send home" cell on E3). Before evidence: `fired[C3:Shield, E3:Send home] shield[]`, so the shielded Human piece was sent home. The mirror case `shield-ai` absorbed correctly (`shield[I3]`). In the before matches, shields absorbed an effect 4 times for AI pieces and 0 times for Human pieces. A direct test on both sides failed for Human only (`human: shield absorbed: actual false`).

**Cause.** In `land()`:
```ts
const shielded = group.filter(q => q.shield && q.owner === 'ai'), ...
```
The shield was still cleared (`q.shield = false`) for the Human piece, so a Human shield was used up and gave no protection. This breaks R14 and R7 (an effect does exactly the same thing to whichever piece enters it).

**Fix** (`server/v6/engine.ts`, `land`):
```diff
-      const shielded = group.filter(q => q.shield && q.owner === 'ai'), hit = group.filter(q => !shielded.includes(q));
+      const shielded = group.filter(q => q.shield), hit = group.filter(q => !shielded.includes(q));
```

**After.** `shield-human`: `fired[C3:Shield] shield[E3]`, so the piece is not sent home and E3 is used up. Matched games: shields absorbed 3 times for Human pieces and 3 for AI pieces.

The referee's symmetry check (E2) did not catch this: its trial pieces do not carry shields when they enter the cell under test.

## Finding 1: "no problem found"

I disagree. The case Kane calls clean (C-9fc650) is the same case Kane's findings 2 and 3 use as evidence of R8 and R3 violations, and I reproduced both. Nothing in this finding needed a fix of its own.

## Before / after evidence

- Before: `evidence/gamewatch/evidence-before.json` (raw games in `evidence/gamewatch/raw-before/`, log `before-run.log`).
- After: `evidence/gamewatch/evidence.json` (raw games in `evidence/gamewatch/raw/`, log `after-run.log`).
- Summary script (read-only): `node --experimental-strip-types gamewatch/closed-loop/compare.ts`.

Both runs used the same command (`node --experimental-strip-types gamewatch/run-evidence.ts all`): 11 scripted cases and 16 matched softmax-v2 games (seeds 97001–97008, each with both first movers). Both runs printed `fatal: not a git repository`. That message is harmless: the bundle's `generator.commit` is just `null`.

Scripted cases (turn-start grants / effects fired / shield absorbed):

| Case | Before | After |
|---|---|---|
| AI shoved onto +1 action, off and back on | H4 A3…; I5 fires **twice**; no refusal | H3 A3…; I5 fires once; final `I5 left` refused |
| Human shoved onto +1 action, off and back on | H4 A3…; E5 fires **twice** | H3 A3…; E5 fires once; final `E5 right` refused |
| Human Shield, then AI Send home | C3 Shield, **E3 Send home fired** | C3 Shield, E3 **absorbed** |
| AI Shield, then Human Send home | I3 absorbed | I3 absorbed (unchanged) |
| Other 7 cases (freeze, shove back, teleport, adjacent placement, walk-on +1) | H4 A3… | H3 A3…; same effects and refusals as before |

Matched games:

| | Before | After |
|---|---|---|
| Wins Human / AI / draw | 8 / 8 / 0 | 6 / 10 / 0 |
| First mover won | 10 of 16 | 8 of 16 |
| Mean game length (turns) | 24.4 | 33.0 |
| Turns granting more actions than pieces on the board | 200 / 390 | 0 / 528 |
| Effects fired | 434 | 469 |
| Shield absorptions Human / AI | 0 / 4 | 3 / 3 |

Games are longer because each side lost the extra action on alternate turns. The first-mover edge (10/16 before) is gone (8/16). After the fix the AI seat won 10 of 16. With 16 games that is not evidence of an imbalance (a 50/50 coin gives 10 or more of 16 about 23% of the time), so I did not act on it.

## Regression tests: `tests/closed-loop.test.ts`

Seven tests: 2 for R3, 3 for R8, 2 for R14/R7. The scripted ones reuse the unchanged GameWatch scripts and adapter on `server/v6`.

- **On the build as received: 7 of 7 failed.** I ran them before editing `engine.ts`. The failures were: `actual 4, expected 3` (R3, twice), `I5 is used up after the forced arrival: actual 51`, I5 and E5 fired 2 times instead of 1, and `human: shield absorbed: actual false` (twice).
- **After the fix: 7 of 7 pass** (`node --experimental-strip-types --test tests/closed-loop.test.ts`).

## Existing tests

`npm run test:v6` after the fix: **42 tests, 42 pass, 0 fail** (log in `test-v6-after.log`). I did not run the existing suite on the build as received, so I cannot say whether any of these tests changed status. None failed after the fix.

## Other observations and suggestions I did not implement

- **+1 action bonus is capped at 1** (`s.bonus[owner] = Math.min(1, …)`): a piece that enters two +1 action cells during the opponent's turn (for example through a chain) gets one extra action next turn, not two. R15 does not say whether such bonuses add up, so I left it unchanged. The rules doc should say which is intended.
- **Referee symmetry check (E2) does not cover pieces that already carry a shield**, which is why the shield defect passed the referee. Adding a shielded-piece entry to the trial would catch it. I did not change it because the brief forbids changing the referee.
- **Kane's case and build IDs** cannot be checked against this workspace (see the note under Summary). If those bundles exist elsewhere, a direct diff of the `shove-chain-ai` case would confirm that my build and QX-73 are the same.
- `server/v6-build-under-test/` is generated by the evidence tool and now holds the fixed build's copy. It is not part of the game.

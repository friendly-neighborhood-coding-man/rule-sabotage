# GameWatch input contract (`gamewatch/evidence@1`)

GameWatch never simulates a game. A game provides an **adapter** that turns its own real playtests (scripted runs, AI
self-play, or recorded human sessions) into one JSON bundle; the dashboard (`gamewatch/dashboard.ts`) and the review
harness read only this bundle. Types: `gamewatch/evidence.ts`. Reference adapter: `gamewatch/adapters/rule-sabotage.ts`.

## Bundle

| Field | Meaning |
|---|---|
| `schema` | `"gamewatch/evidence@1"` |
| `game` | `{ name, version, rules: [{ id, text }] }`: the documented, intended rules, numbered so findings can cite them |
| `source` | plain sentences describing how the evidence was produced (who played, seeds, what was scripted) |
| `builds` | `[{ label, note }]`: builds under test, arbitrary labels |
| `cases` | scripted or recorded sessions, step by step (below) |
| `matches` | whole games summarised per turn, for statistics (below) |
| `generatedAt`, `generator` | time, commit and command that produced the bundle |

## Case (step-level evidence)

`{ caseId, kind, build, title, seed, firstMover, steps[] }`; each step is
`{ n, actor, action, outcome: 'ok'|'refused', note?, before: State, after: State, events: Event[] }`.

* `State` = `{ turn, toMove, actionsLeft, phase, winner, pieces: [{ id, side, square, frozenTurns, shield }], effects: [{ square, owner, effect, effectId }] }`.
  The field names fit grid/board games; another game maps its own state onto them (`pieces` = units/entities,
  `effects` = persistent board modifiers) or adds fields (extra fields are shown verbatim).
* `Event` = `{ type, ...fields }`: exactly what the game engine reported for that step, renamed but never filtered or
  edited. Refused actions are kept with the game's own refusal reason in `note`.

## Match (game-level evidence)

`{ matchId, build, seed, policy: { side: name }, firstMover, winner, reason, turns, scored, ms, rows[] }`; each row is
`{ turn, side, piecesOnBoard, actionsGranted, movesMade, placement, events[] }`.

## Rules for adapters

1. Every record comes from an actual execution. No synthetic, edited or re-ordered events.
2. Identifiers are anonymous (hashes); nothing in the bundle may carry expected verdicts or labels such as "buggy".
3. Matched comparisons use the same seeds and scripts on every build, with first movers swapped.
4. The adapter may depend on the game's engine; the dashboard and the review harness may not.

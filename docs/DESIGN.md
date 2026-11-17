# Rule Sabotage: design notes (V4)

## The game in one paragraph

A 7×7 race with 3 pieces each. Yours start at A2, A4 and A6 and must all reach column G. The AI's start at G2, G4 and G6 and must reach column A.

Players alternate turns. On a turn you may place one effect, written in plain words, on up to 3 cells anywhere eligible. Then you spend one move action per piece you have on the board.

Effects stay until something enters them. They do exactly the same thing to any piece, so the battlefield both of you build is as dangerous to its architects as to their targets.

## Turn sequence (engine: `server/engine.ts`)

1. **Actions.** At the start of your turn you get actions equal to your pieces still on the board, plus at most +1 banked from a haste effect triggered during the opponent's turn.
2. **Placement (optional, before your first move).**
   - Remove any of your own effect cells, for free.
   - Then place **one** effect definition on **1–3 cells** anywhere that has no piece and no opponent effect.
   - Re-using one of your own cells replaces that effect and counts toward the 3.
   - There is no shape and no adjacency requirement. The cells can be scattered.
3. **Move.**
   - Each action moves one piece, or your whole stack on a cell, one square orthogonally. Frozen pieces stay put.
   - Landing on your own piece stacks. Landing on enemy pieces captures them, and they return to their start squares.
   - Entering a cell with an effect fires it, whoever owns it, and consumes **that cell only**. The rest of the definition stays.
   - Forced movement lands like a normal move: it can capture, stack, or fire another effect. Chains are capped at 4.
4. **Scoring and win.** A piece reaching its goal column scores and leaves the board. All 3 scored wins.
5. **Turn limit.** At 60 turns (30 each): most pieces scored wins, then least total distance left, then a draw.

## Effects

| Effect | What it does to any piece that enters | Notes |
|---|---|---|
| Shove N/S/E/W 1–3 | forced that many squares in a compass direction (stops at the edge) | absolute, so identical for both sides |
| Shove back 1–3 | forced back the way it came | relative to the entry direction, not to the owner |
| Shove forward 1–3 | slides onward in the direction it was moving | can help the stepper |
| Freeze | can't move during its owner's next turn | one turn max |
| Send home | back to that piece's own start square | the same rule for everyone |
| Teleport | jumps to a random empty middle square | seeded RNG, so reproducible |
| Shield | ignores the next effect it enters | beneficial |
| +1 action | its owner gets +1 action (now, or banked for next turn) | beneficial |

Harmful, beneficial and situational effects all exist. A forward shove or a +1 action helps whoever takes it, so placing one is a bet on who will get there first.

**Rejected by policy, for both players:**
- winning or losing directly
- aiming at one side ("only the AI", "enemy pieces", "toward your own side")
- anything permanent or board-wide
- removing pieces directly
- several effects in one rule

Over-limit requests ("shove 5 squares") are **approximated with disclosure**, and the player must tick a box to accept.

## Natural language → rule

`server/rules.ts` defines the typed DSL. OpenRouter returns `{status, kind, dir, amount, note}` under a strict JSON schema.

The server re-validates that reply and applies the deterministic policy to the **original text** anyway. A model that says "ok" to "only the human freezes forever" is still overruled.

The preview the player confirms is stored server-side as a token, so the rule that runs is exactly the one they saw. Without OpenRouter, a deterministic EN/KO parser does the same job and is labelled as such.

**Free-model hardening.** Live runs on `openrouter/free` returned empty content about 70% of the time. The likely cause is reasoning models spending the whole token budget on thinking. Calls now:
- ask for low reasoning effort
- allow 1,500 tokens
- retry once with a plain-JSON prompt on an empty or non-JSON reply

Every failure is logged with the model and the `finish_reason`.

## The AI opponent (`server/ai.ts`, `server/game.ts`)

- **Turn planner.** The candidate set is "no placement" plus one placement for each of 12 effect variants. For each candidate, the planner:
  - chooses the effect's best cells by expected harm to the human minus 1.15× harm to itself;
  - plays a greedy move sequence with the real engine;
  - plays the human's greedy reply.

  Positions are scored by Dijkstra path cost, with effects priced in turns. Plans are scored 0.4 × after-my-turn + 0.6 × after-your-reply, minus a small upkeep for placing.
- **Information.** It plans from the public board at the start of its own turn. Turns alternate and are fully revealed, so there is nothing hidden to peek at.
- **Not scripted.** A seeded softmax picks among near-best plans, so openings vary (test: ≥3 distinct openings across 12 seeds). It never deliberately throws.
- **OpenRouter's role.** The model gets a shortlist of the top 6 engine-scored plans and picks one. It writes the effect sentence in its own words, plus a taunt and a one-line rationale. Its sentence goes through the **same** interpreter and referee as yours, and moves are re-planned on the real board afterwards.

## Kane as the live referee (`server/trial.ts`, `server/kane.ts`)

For every new effect definition, from either player:

1. **Sandbox trial.** The engine copies the game and applies only the proposed placement. It then runs scenarios with stable IDs (`T0007-S1…`):
   - **Symmetry:** for each new cell, a lone Human piece and a lone AI piece enter from the same neighbour in the same direction. Every other piece is parked, so captures can't differ by owner. Outcomes must be identical: fired, effect, end square, extra actions, chain, and frozen/shield unless the piece reached its own goal.
   - **Revisit:** the same piece re-enters the consumed cell, which must not fire again.
   - **Chains:** any chain reactions with existing effects.
   - **Softlock rollout:** both players play greedy turns for up to 10 turns. Nobody may have pieces on the board but no legal move for 2 of their own turns in a row.
2. **Engine checks (E1–E6)** run on that data:
   - legal placement
   - symmetry
   - no re-fire
   - chain cap
   - no softlock
   - placement moves nothing

   A failure rejects the rule immediately, because the engine keeps final authority.
3. **Kane inspection.** The trial is rendered as a static, script-free page at `/trial/<id>` showing raw observations, not the engine's verdict. The server opens the page in a headless Chrome/Edge and runs:
   `kane-cli run --analyzer-only --agent --cdp-endpoint <cdp> --condition "<C1>" … --condition "<C6>"`

   Kane's verdict decides what happens next:
   - every condition true: the rule is **approved** and goes live;
   - any condition false: the rule is **rejected**, and Kane's reason is shown;
   - no parseable verdict, a timeout or no CLI: the rule is **unverified** and does not go live.
4. **Evidence.** These files are written to `evidence/kane/<trial>-<signature>/`:
   - the trial HTML
   - raw Kane stdout and stderr
   - a result JSON with the verdict, per-condition results, elapsed time, exit code, CLI version and args

   Identical trials reuse the cached verdict, labelled "cached".
5. **Equal scrutiny.** Human and AI rules go through the same `referee()` with the same conditions.

## Board crowding (measured, no cap applied)

Eric's instruction was to measure before deciding on a cap. Nothing in the engine clears effects automatically, and there is no geometric restriction. `npm run selfplay -- 30` reports active effect cells per turn for five bot matchups. The results and the recommendation are in [CROWDING.md](CROWDING.md).

## Things we decided not to build

- Accounts, multiplayer, persistence and deployment.
- LLM-written code of any kind.
- Long AI dialogue: reactions are one line, triggered by real events, so they never slow down a turn.

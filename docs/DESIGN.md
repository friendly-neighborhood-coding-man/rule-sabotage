# Rule Sabotage: design notes

## The game in one paragraph

A 7×7 race. You start at A4 and win by reaching column G; the AI starts at G4 and races to column A. Each round both players secretly choose a move and, optionally, a trap. Traps can only go on that round's shared shape, they cost power (strength × squares ≤ 4), they hit **whoever** steps on them, and each square fires once. Comedy comes from the symmetry: the trap you laid for the AI is still there when you are pushed back onto it.

## Exact round sequence (engine: `server/engine.ts`)

0. **Shape.** Odd rounds draw a random row, column (B–F), diagonal or 3×3 square. Even rounds mirror the previous shape left↔right, so over two rounds neither side is favoured.
1. **Commit.** At the start of the round the server snapshots the public board and starts the AI's decision from it. The human's action arrives later and is never given to the AI (test: *the AI never receives the human's action*).
2. **Sit-outs.** A player with "lose next turn" pending sits the whole round out: no rule change and no move. Then they are immune to another skip until they have acted once, so nobody can be locked out.
3. **Rule phase (simultaneous).** Removals and replacements apply to the slots as they were at the start of the round. Then both placements happen together. A square claimed by both players this round **clashes** and stays empty. Placing over an older trap replaces it (counter-play: you can paint over the AI's trap).
4. **Move phase.** Priority alternates each round, and round 1 is a coin flip. The priority player moves first. Entering a trapped square fires it (any owner) and burns that square. If a push lands on another trap, it chains (max 3). Reverse flips your next move; the UI warns you.
5. **Win.** The first player to stand on their goal column wins immediately. In a dead-even race the priority player wins, so landing one trap flips the result. After 20 rounds: fewer columns left wins, then Sabotage score (times your traps hit the other player), then draw.

## Effects and the power budget

| Effect | Cost / square | Max squares | Notes |
|---|---|---|---|
| Push back 1 | 1 | 4 | toward the stepper's own start |
| Push back 2 | 2 | 2 | |
| Lose next turn | 2 | 2 | skip immunity prevents chains of skips |
| Reverse next move | 1 | 4 | a clever player simply presses the opposite key |
| Random teleport | 2 | 2 | seeded, so it is reproducible; lands only on empty middle squares |
| Swap places | 4 | 1 | never moves anyone into a home column, so no instant wins |
| Shield | 2 | 2 | cancels the stepper's next trap |

Hard limits enforced by the engine for both players: allowlisted effects only, budget ≤ 4, only on this round's shape in columns B–F, never under a player, 3 slots, chains ≤ 3, max 1 consecutive lost turn, no win/lose effects, nothing permanent, nothing board-wide.

**Cut after self-play:** "launch forward" boosts. Bots that placed boosters in front of themselves beat every other strategy, and games ended in under 5 rounds. Boost requests are now rejected with an explanation.

## Natural language → rule

`server/rules.ts` defines the typed DSL. OpenRouter returns `{status: ok|approximate|reject, kind, amount, note}` under a strict JSON schema. The server re-validates it and applies the deterministic policy anyway, for example blocking "only the AI…", "forever", "win the game" or "back to start". An over-limit request ("push back 5") becomes **approximate** with a disclosed note, and the player must tick a box to accept it. Nothing is silently changed. The preview the player confirms is stored server-side as a token, so the rule that runs is exactly the one they saw. Without OpenRouter, a deterministic EN/KO parser does the same job and is labelled as such.

## The AI opponent (`server/ai.ts`, `server/game.ts`)

- **Simulation.** It enumerates its legal options (5 moves × no-trap/each effect on its best squares/replace/remove), about 45 options. It simulates each against about 15 plausible human replies using the real engine. Squares are scored by Dijkstra path cost, with traps counted as lost turns.
- **Opponent model.** Replies that look good for the human are weighted more (level-1 thinking). That is why the AI ambushes the square you are likely to step on.
- **Not scripted.** A per-game seeded softmax picks among near-best options, so openings and plans vary (test: ≥3 distinct openings across 12 seeds). It never deliberately throws.
- **OpenRouter's role.** The model gets a shortlist of 7 diverse, engine-scored options and picks one. It writes the trap sentence in its own words, plus a taunt and a one-line rationale. Its sentence goes through the **same** interpreter and referee as yours. If its words mean something else, that is what gets judged.
- **Honest explanations.** The log shows the AI's *recorded* decision: the time it locked in, the chosen option, the rationale captured at decision time, and how many options and replies were simulated. Speech bubbles are labelled "said before the reveal" (taunt) or "commentary after the round" (template reactions triggered by real events).

## Kane as the live referee (`server/trial.ts`, `server/kane.ts`)

For every new rule, from either player:

1. **Sandbox trial.** The engine copies the current state, applies only that rule, and runs scenarios with stable IDs (`T0007-S1…`). Each player steps on the same square, then re-enters it (it must not fire twice). It also checks chain reactions with existing traps, an 8-round racing rollout looking for softlocks and lost-turn streaks, and the power cost.
2. **Engine checks** (E1–E6) run on that data. A failure rejects the rule immediately, because the engine keeps final authority.
3. **Kane inspection.** The trial is rendered as a static page at `/trial/<id>` showing raw observations (not the engine's verdict). The server opens it in a headless Chrome with a CDP port and runs the real CLI:
   `kane-cli run --analyzer-only --agent --cdp-endpoint <cdp> --condition "<C1>" … --condition "<C7>"`.
   Kane returns one boolean and one reason per condition in its NDJSON `run_end`. All true means approved. Any false means rejected, and the UI shows Kane's reason. No parseable verdict, a timeout or a missing CLI means **unverified**, and the rule does not go live.
4. **Evidence.** Trial HTML, raw Kane stdout/stderr and a result JSON (verdict, per-condition results, elapsed time, exit code, CLI version, args) are written to `evidence/kane/<trial>-<signature>/`. Identical trials (same rule, squares, positions and traps) reuse the cached verdict, labelled "cached".
5. **Equal scrutiny.** Human and AI rules go through the same function with the same 7 conditions, in parallel.

The 7 Kane conditions are listed in `KANE_CONDITIONS` (`server/trial.ts`).

### Why analyzer mode and not a per-turn browser agent

`--analyzer-only` is Kane's supported "judge conditions against the current page" mode. It takes no browser actions, so it is the closest thing to an arbiter call. A rule review costs one Kane run. Turns without a new rule never wait for Kane.

## Things we decided not to build

Accounts, multiplayer, persistence and deployment. LLM-written code of any kind. A boost effect (it was dominant). Long AI dialogue, because reactions are one line from real events so they never slow down a turn.

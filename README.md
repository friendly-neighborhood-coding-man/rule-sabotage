# Rule Sabotage

**Write effects in plain English (or Korean), scatter them over the board, then survive your own inventions.**

A small human-vs-AI strategy race on a 7×7 board. You move 3 pieces from column A to column G; the AI moves 3 pieces the other way. Players take turns, and a coin flip decides who starts.

On your turn you may write one effect, for example "Anything entering here is shoved two squares north". You place it on up to 3 cells anywhere that has no piece and no enemy effect. Effects stay on the board until something enters them, and they work the same on **any** piece, yours included. Then you spend one move action per piece you have on the board.

The board keeps growing into a minefield both of you built. The AI genuinely tries to win: it simulates its placements and move sequences, plus your best reply, with the real engine.

Every new effect, yours or the AI's, goes through the same pipeline before it can go live:

```
natural language ──► OpenRouter interpreter ──► engine checks ──► sandbox what-if trial ──► Kane CLI referee ──► live on the board
 (EN / 한국어)        (or labelled offline       (≤3 eligible    (a Human piece and an AI    (kane-cli judges the
                       parser)                    cells, legal)   piece must get identical    trial page: approve/reject)
                                                                  outcomes; chains; softlock)
```

The TypeScript engine (`server/engine.ts`) is the only thing that changes game state. LLM output is never executed: it can only pick from a small typed effect list that the engine validates.

## Quick start

Requires Node 22.10+ (no npm dependencies).

```bash
npm start              # http://127.0.0.1:3000
npm test               # unit + integration tests
npm run test:browser   # full games in real Chromium via Playwright (needs `playwright` installed globally)
```

With no configuration the game runs fully offline: an offline parser reads rules, a local planner drives the AI, and the UI says so.

### Turn on the real AI and the real referee

```bash
cp .env.example .env
# OPENROUTER_API_KEY=sk-or-...   (server-side only; never sent to the browser)
# OPENROUTER_MODEL=openrouter/free   (free pool; for a reliable demo pin one specific model)
# or NVIDIA's OpenAI-compatible API instead:
# LLM_PROVIDER=nvidia  NVIDIA_API_KEY=nvapi-...  NVIDIA_MODEL=meta/llama-3.3-70b-instruct
npm i -g @testmuai/kane-cli && kane-cli login     # Kane referee
npm start
```

The header chips always show what is actually running: `AI brain: OpenRouter · <model>` vs `local planner`, and `Referee: Kane CLI <version>` vs `Kane unavailable` / `engine only`.

| Setting | Effect |
|---|---|
| `KANE_REFEREE=on` (default) | Rules are reviewed by kane-cli. If Kane fails or times out the rule is **unverified and does not go live** (unless `ALLOW_UNVERIFIED_RULES=1`). |
| `KANE_REFEREE=off` | Engine checks only; rules go live labelled “NOT Kane-verified”. Good for quick offline play. |
| `KANE_MODE=analyzer` (default) | `kane-cli run --analyzer-only --condition … --cdp-endpoint` on the trial page (no browser actions, one verdict per condition). |
| `KANE_MODE=objective` | `kane-cli run "<objective>" --url <trial page>` (Kane drives a browser; slower). |

### Live verification scripts (need real credentials)

```bash
npm run eval:openrouter   # 20 Korean + 10 English + 10 must-reject rules + 10 AI turns → evidence/openrouter/
npm run kane:trial        # real Kane verdicts on normal, AI-authored and deliberately corrupted trials + in-game turns → evidence/kane/
npm run selfplay -- 30    # engine-only balance + board-crowding stats (bot vs bot, no LLM, no Kane)
```

## How to play (30 seconds)

1. **Your turn** gives you one move action per piece still on the board (3 at the start). The chip in the header counts them down.
2. **Optional, before your first move:** type an effect and click **Interpret**. The card shows exactly what the engine will run; over-limit requests are approximated only if you tick the box. Click up to **3** highlighted cells anywhere, then press **Place**. The referee reviews it (Kane, if enabled) and it goes live.
3. **Your own effects** can be removed for free: click their cell chips under "Your effects" before moving. Placing on top of your own effect replaces it, and that counts toward the 3 cells. Enemy effects can't be touched; you'll have to walk around them, or through them.
4. **Move:** click a piece, then a neighbouring square (or use the arrow keys).
   - A stack of your pieces moves together. Tick "Move only one piece" to split it.
   - Landing on an enemy piece captures it and sends it back to its start.
   - Entering an effect fires it and uses up that cell. Forced movement can set off more effects.
5. **Win** by getting all 3 pieces across. **End turn** with `E`; your turn also ends automatically when you're out of actions.

Effects: shove 1–3 squares north / south / east / west / back (the way it came) / forward (onward), freeze one turn, send home, random teleport, shield, +1 action.

More: [docs/DESIGN.md](docs/DESIGN.md) · [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## Layout

```
server/engine.ts    authoritative deterministic engine (turns, actions, stacks, captures, effects, chains, win)
server/rules.ts     typed effect DSL, input/policy guards, offline EN/KO parser
server/ai.ts        turn planner (placement + move sequence + your reply), shortlist for the LLM
server/game.ts      server-authoritative sessions, turn API, referee pipeline
server/trial.ts     sandboxed what-if trials + the page Kane inspects
server/kane.ts      real kane-cli adapter (analyzer/objective modes, evidence, cache)
server/openrouter.ts  OpenRouter calls: structured output, fallbacks, rate-limit cooldown
server/flavor.ts    AI reactions + achievements, derived only from engine events
client/             vanilla JS UI (renders server state, animates the event log)
tests/              node:test suites, Kane test double, Playwright e2e
docs/archive-v2/    the V2 handoff docs this version replaced
```

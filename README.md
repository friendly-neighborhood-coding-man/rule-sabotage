# Rule Sabotage

**Invent traps in plain English (or Korean). Then obey them too.**

A small human-vs-AI racing game on a 7×7 board. You race left→right, the AI races right→left. Every round you may invent a trap ("Anyone stepping here gets pushed back two spaces!"), but traps hit **whoever** steps on them, including the person who made them. The AI genuinely tries to win: it simulates its options against your possible replies with the real game engine. Sometimes it walks into its own trap anyway.

Every new rule, yours or the AI's, goes through the same pipeline before it can go live:

```
natural language ──► OpenRouter interpreter ──► engine safety rules ──► sandbox what-if trial ──► Kane CLI referee ──► live on the board
 (EN / 한국어)        (or labelled offline       (budget, shape,         (both players trigger it,   (kane-cli judges the
                       parser)                    no instant wins…)        chains, 8-round softlock)   trial page: approve/reject)
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
# OPENROUTER_MODEL=openrouter/free   (or any :free model)
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
npm run kane:trial        # real Kane verdicts on normal, AI-authored and deliberately corrupted trials → evidence/kane/
npm run selfplay          # engine-only balance stats (bot vs bot)
```

## How to play (30 seconds)

1. Each round a **shape** is highlighted (a row, column, diagonal or 3×3 square). It is the same shape for both players; even rounds mirror the previous one.
2. Optionally type a trap and click **Interpret**. The card shows exactly what the engine will run, its power cost, and how many squares you may paint (power × squares ≤ 4). Click squares on the shape.
3. Press a direction (arrows/WASD) to lock in your turn. The AI already locked in its move from the same public board and never sees yours.
4. Traps resolve before moves, so you can ambush the square someone is about to step on. First to reach the far column wins. In a dead heat, whoever moves first that round wins (this alternates, and round 1 is a coin flip).

More: [docs/DESIGN.md](docs/DESIGN.md) · [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) · [docs/STATUS.md](docs/STATUS.md)

## Layout

```
server/engine.ts    authoritative deterministic engine (rules of play, traps, win/tie)
server/rules.ts     typed effect DSL, power budget, input/policy guards, offline EN/KO parser
server/ai.ts        simulation planner (opponent), shortlist for the LLM
server/game.ts      server-authoritative sessions, AI pre-commit, referee pipeline
server/trial.ts     sandboxed what-if trials + the page Kane inspects
server/kane.ts      real kane-cli adapter (analyzer/objective modes, evidence, cache)
server/openrouter.ts  OpenRouter calls: structured output, fallbacks, rate-limit cooldown
server/flavor.ts    AI reactions + achievements, derived only from engine events
client/             vanilla JS UI (renders server state, animates the event log)
tests/              node:test suites, Kane test double, Playwright e2e
docs/archive-v2/    the V2 handoff docs this version replaced
```

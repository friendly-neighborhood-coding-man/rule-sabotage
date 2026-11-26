# Rule Sabotage

> **Hackathon submission: GameWatch. Kane discovers. GameWatch verifies. Together, they close the trust gap.**
> Kane explores the game on its own and reports anomalies and hypotheses about its hidden rules. GameWatch is a
> complementary verification layer: it checks every finding against recorded evidence, seals each step in a
> hash-chained ledger, and separates genuine corrections from misleading improvements.
> * **GW1:** one Kane call detected 2 of 3 planted defects. One blind coding-agent repair fixed all 3 (it found the
>   third itself), and the fixes were verified independently after the output was frozen.
> * **GW2 (pre-registered, 20 Kane calls):** in session M08, accuracy rose from 31.78% to 81.25% while coverage fell from
>   12.32% to 1.00%, with zero genuine corrections. GameWatch identified a hypothesis withdrawal, not self-correction.
>   Both treatment sessions that received contradiction feedback revised or withdrew a hypothesis, and no control
>   session did. This is observed behavioural adaptation, not improved reasoning.
> * **Disclosed limitations:** schema-invalid representations in 6 of 10 sessions, missing submissions in 8 of 10
>   revision calls, and 5 sessions per arm.
>
> **Try it in one command, with no paid calls:** [Quick Demo](#quick-demo--one-command-zero-paid-calls).
> Start at [`docs/SUBMISSION.md`](docs/SUBMISSION.md). The verified report is
> [`docs/gw2/MATCHED_RESULTS_REPORT.md`](docs/gw2/MATCHED_RESULTS_REPORT.md) and the public evidence is
> [`evidence/gw2/matched-run/`](evidence/gw2/matched-run/). See also [`docs/GW1_FINAL_REPORT.md`](docs/GW1_FINAL_REPORT.md)
> and [`gamewatch/README.md`](gamewatch/README.md) (quick start).
> GameWatch runs on **SkillFlow** (https://github.com/friendly-neighborhood-coding-man/skillflow, MIT), vendored
> unmodified at a pinned commit. The playable game is the clean V6.1 baseline.

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
# NVIDIA_API_KEY=nvapi-...   default provider; model nvidia/nemotron-3.5-bolt-e4b (best in docs/EVIDENCE.md)
# or GroqCloud:  LLM_PROVIDER=groq  GROQ_API_KEY=gsk_...  GROQ_MODEL=openai/gpt-oss-120b
npm i -g @testmuai/kane-cli && kane-cli login     # Kane referee
npm start
```

The header chips always show what is actually running: `AI brain: OpenRouter · <model>` vs `local planner`, and `Referee: Kane CLI <version>` vs `Kane unavailable` / `engine only`.

| Setting | Effect |
|---|---|
| `KANE_REFEREE=on` (opt-in; each review is a paid kane-cli call) | Rules are reviewed by kane-cli. If Kane fails or times out the rule is **unverified and does not go live** (unless `ALLOW_UNVERIFIED_RULES=1`). |
| unset / `KANE_REFEREE=off` (default) | Engine-only referee: tier 1/2 rules (fully checked by the engine) go live labelled “engine-approved”; tier-3 rules (need Kane) are **unverified and never go live**. |
| `REFEREE_TIERS=on` (default off) | Simple or fully simulable rules are decided by the engine (tier 1/2) and shown as **engine-approved, not reviewed by Kane**. Approximated, untestable or borderline rules still go to Kane and stay off the board until Kane approves. See [docs/OPTIMIZATION.md](docs/OPTIMIZATION.md). |
| `KANE_MODE=analyzer` (default) | `kane-cli run --analyzer-only --condition … --cdp-endpoint` on the trial page (no browser actions, one verdict per condition). |
| `KANE_MODE=objective` | `kane-cli run "<objective>" --url <trial page>` (Kane drives a browser; slower). |

### Live verification scripts (need real credentials)

```bash
npm run eval:openrouter   # 20 Korean + 10 English + 10 must-reject rules + 10 AI turns → evidence/openrouter/
npm run kane:trial        # real Kane verdicts on normal, AI-authored and deliberately corrupted trials + in-game turns → evidence/kane/
npm run bench:llm         # same 50 cases across NVIDIA / Groq / OpenRouter models → evidence/llm-bench/
npm run tiers:routing -- 30  # engine-only: how many rules would still need Kane with REFEREE_TIERS=on
npm run selfplay -- 30    # engine-only balance + board-crowding stats (bot vs bot, no LLM, no Kane)
```

Latest measured results from these scripts (providers benchmark and real Kane verdicts) are in [docs/EVIDENCE.md](docs/EVIDENCE.md).

### Living Balance Loop (AI self-play → anomalies → Kane → weights → promote or roll back)

```bash
npm run balance:loop                    # one bounded cycle, DRY-RUN (no Kane, nothing promoted)
npm run balance:loop -- --run-kane      # real kane-cli verification (uses credits)
npm run balance:record -- --run-kane    # the same, recorded: terminal cast + dashboard video
```

The AI planner reads `balance/balance.weights.json` (frozen per game). The loop runs in its own process and never blocks play. See [docs/BALANCE_LOOP.md](docs/BALANCE_LOOP.md).

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

## Human playtest (local, not production)

`npm run playtest` starts an isolated playtest on http://127.0.0.1:3100 against the three experimental V5.3 opponents (EV-K1.2, Softmax-v2, OA-v3), with consent-gated recording, match review and a post-game questionnaire. No Kane, no language model, no network. See `docs/HUMAN_PLAYTEST_READINESS.md` and `docs/PLAYTEST_PILOT_PROTOCOL.md`.


## V6 experimental game (13×9, not production)

`npm run play:v6` starts a separately versioned experimental game on http://127.0.0.1:3106: a 13×9 board, three pieces per
side on rows 3/5/7, and a new placement rule: no new effect on the 8 squares around an opponent piece (server-enforced, same
code for human and AI). Opponents are V6 adaptations of the three V5.3 policies (generated forks in `server/v6/forks/`, see
`npm run v6:fork`); no V5.3 result applies to them. No Kane, no language model, no network, nothing saved. The 7×7 game,
the V1–V5.3 policies and their evidence are unchanged. See `docs/V6_GAMEPLAY_EXPANSION.md`; tests: `npm run test:v6`.

The same page also offers **V6.1** (`rule-sabotage/v6.1-all-piece-proximity@1`, the default choice in the Ruleset menu): no new
effect on the 8 squares around ANY piece, yours or the opponent's. Everything else is V6. See `docs/V6_1_ALL_PIECE_PROXIMITY.md`.

V6.2 (`docs/V6_2_PLAYABILITY_AND_KANE_SHADOW.md`): decision-preserving opponent speed-ups, separate referee-aware
opponents (`-ra@1`), consent-based recording with review, questionnaire and deletion (`playtest-data/v6/`), and Kane
shadow-mode infrastructure that is prepared but never runs Kane.

V6.3 (`docs/V6_3_BUDGETED_AI_AND_PILOT.md`, `docs/KANE_SINGLE_CALL_PREFLIGHT.md`): pilot defaults (V6.1 + the `-ra@1`
opponents), an 8-second latency-bounded prototype (`-ra-b@1`, not promoted), and a reviewable single-call Kane shadow
experiment that is prepared and gated, not run.

## Quick Demo — One Command, Zero Paid Calls

**Requirements:** Git and Node.js 22.10+. No `npm install`, API keys, Kane account or paid calls are needed.

```
git clone --branch claude/gw2-matched-results --single-branch https://github.com/friendly-neighborhood-coding-man/rule-sabotage.git && cd rule-sabotage && npm run gamewatch:serve -- --notes demo-notes.ndjson --label human
```

Then open http://127.0.0.1:3210/.

**What this is: the interactive evidence-site demo.** It is the same anonymous evidence site Kane explores: scripted playtests, AI-vs-AI matches and the findings form. You browse it as a human reviewer, and anything you submit is written to `demo-notes.ndjson` in the clone. Stop the server with Ctrl+C.

**What it is not: a full experimental reproduction.** It makes no Kane call and does not re-run GW1 or GW2. To check the recorded experiments without paid calls:
* [`docs/DEMO.md`](docs/DEMO.md) verifies the GW1 freeze and recomputes its evaluation;
* [`docs/gw2/MATCHED_RESULTS_REPORT.md`](docs/gw2/MATCHED_RESULTS_REPORT.md) is the independently verified GW2 report, with the redacted evidence in [`evidence/gw2/matched-run/`](evidence/gw2/matched-run/).

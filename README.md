# Rule Sabotage V2 — Human vs OpenRouter AI, Kane-Audited Fairness

**Status (2026-11-17): implementable handoff prototype, not a completed Kane/OpenRouter live integration.**

- V1's 7×7 turn-based game is retained; every round offers one randomly selected *common* line/diagonal/3×3 shape, both sides obey identical trap effects, and each armed tile disappears after its first activation.
- Human writes Korean/English natural-language rule; OpenRouter compiles into an allowlisted TypeScript contract. OpenRouter separately generates the AI opponent's move/rule proposal using only the **pre-round** snapshot.
- A deterministic fairness guard runs for BOTH players; Kane CLI is proposed as the independent browser auditor. **Kane has not been invoked live in this package.** Kane audits the rules/behavior; it does not give the runtime permission to bypass hard limits.
- On missing API credentials or model failures, human known-phrases and AI opponent use the original offline parser/planner; this fallback is visibly labeled and never misrepresented as model success.

## Quick start (Node 22.16+)

```bash
npm start
# visit http://127.0.0.1:3000
npm test
```

The local server listens on loopback only. It runs in **offline fallback mode** without a key and works with Korean examples.

To try an actual model, first check [OpenRouter's free models](https://openrouter.ai/collections/free-models), choose one whose current provider supports `structured_outputs`, then copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. The API key MUST stay in `.env` server-side. The server explicitly requests `json_schema`, `provider.require_parameters=true` and validates returned data again regardless of provider claims. Some free models may lack the requested feature and fail closed to local fallback. **No paid model is selected by default.**

The OpenRouter account privacy policy is managed separately at <https://openrouter.ai/settings/privacy>. ZDR-disabled settings may allow retention; do not enter real personal, company, or secret information into the rule textbox. The app deliberately provides no file/email/payment tool access. No actual external LLM call was made in this handoff (no credentials were available).

## Architecture

```
Human rule text ──┐
                  ├── OpenRouter: strict Rule Compiler JSON ──┐
AI move + text ───┘                                           │
     OpenRouter opponent (pre-round public snapshot only) ────┤
                                                              ▼
                 TypeScript DSL + browser/server deterministic gate
                                                              │
                  fair game engine ← validated proposals ─────┘
                                                              │
                   browser test + Kane CLI audit (separate)
```

Current DSL has **four** effects: `back`, `freeze`, `forward`, `shield` (max one square/one turn; once per activated tile). It is a *semantic mapping*, not arbitrary TypeScript code generation: LLM text is never evaluated. 3×3 `freeze` is mechanically rejected due to the initial impact ceiling; this threshold is an explicit design hypothesis, not statistically validated balance.

## Endpoints

- `GET /api/health`: provider configured, Kane audit status, and game state authority disclosures
- `POST /api/interpret-rule` `{ "text":"밟으면 다음 턴에 쉰다" }`: OpenRouter compiler result `{kind, power, explanation}` or rejected/503
- `POST /api/choose-action` `{ "state": <V1 game state> }`: model-generated AI action, validated before browser use
- `POST /api/judge-rule` `{ "state": ..., "player":"human", "text":"...", "interpretation": {"kind":"freeze","power":1} }`: deterministic verdict **not a Kane verdict**

Basic input caps, local rate limit, origin validation, model timeout and output checks are implemented. The current game's state is still **browser-authoritative**, so a determined browser user can cheat using devtools. **Block public competitive deployment** until game sessions, commitment timing, rule interpretations and state transitions are server-authoritative and replay protected. A loopback demonstration is appropriate for initial testing, not for untrusted public production traffic.

## Checked evidence

See `docs/V2_STATUS.md` for actual local PASS/NOT_RUN/BLOCKED distinctions. Build the standalone demo with `python build_offline.py`; its model fallback is offline by design. Browser smoke: `python tests/browser_smoke.py` with Playwright and system Chromium.

## Folders

- `client/` existing V1 board/UI with V2 adapters, guards and status labels
- `server/contracts.ts` strict DSL and JSON Schemas
- `server/openrouter.ts` OpenRouter API with server-side key and bounded calls
- `server/server.ts` loopback API + static server and validation
- `server/engine.cjs`, `server/guard.cjs` deterministic server mirror of browser code; tests require engine parity
- `tests/` regression tests and V2 contracts
- `docs/CLAUDE_HANDOFF.md` next agent prompt, scope, tasks and acceptance gates
- `docs/KANE_AUDIT.md` verified Kane CLI testing plan and evidence requirements
- `docs/ACCEPTANCE.md` measurable gates, failure modes, release blockers

## Scope / honesty

Local unit tests have passed. Actual OpenRouter response adherence and live Kane CLI results require an API key/installed and authenticated CLI in the operator environment and are **NOT_RUN** here. A browser automation environment may also restrict localhost navigation, so any browser test must be reported according to how it actually ran.

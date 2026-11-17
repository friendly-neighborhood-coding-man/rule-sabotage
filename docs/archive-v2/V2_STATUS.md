# V2 evidence status — 2026-11-17

| Test surface | Result | What it proves |
|---|---|---|
| Engine V1 regression | PASS 17/17 | Existing deterministic gameplay mechanics preserved under selected tests |
| V2 contract and fairness unit tests | PASS 12/12 | Schema checks, symmetry, impact cap, input rejection, state shape validation, provider fallback |
| Browser offline smoke (`python tests/browser_smoke.py`) | PASS | 49 cells rendered, Korean rule preview, placement advances round, zero page errors on inline Chromium test |
| Loopback server HTTP smoke | PASS | `GET /api/health` 200 and correct offline disclosure; `/api/interpret-rule` 503 without configured model; invalid `/api/choose-action` 400 |
| Live OpenRouter model | NOT_RUN | Missing operator API credentials/model selection; real free-model schema compliance unverified |
| Live Kane CLI | NOT_RUN | No authenticated Kane CLI run/evidence in this environment |
| Browser navigation via http://localhost | BLOCKED_IN_RUNNER | Browser policy returned ERR_BLOCKED_BY_ADMINISTRATOR; inline HTML browser smoke succeeded instead |
| Public-competitive deployment | BLOCKED | Browser-authoritative state & actions, needs server authority and replay-safe sessions |

Do not conflate local unit-test results with Kane results. Do not claim the model connected until actual response evidence is collected. Current impact cap (14) is hypothetical; no balanced-win-rate measurement has yet been performed.

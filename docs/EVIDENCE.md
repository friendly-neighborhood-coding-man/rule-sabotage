# Measured evidence (commit 1917d6c, 2026-11-17)

All numbers below come from real runs on the operator's Windows PC. They are not from mocks. The raw files (`evidence/llm-bench/…`, `evidence/kane/…`) stay on that machine and are named here so they can be found.

## Tests

`npm test`: 37 tests, 37 passed, 0 failed, 0 skipped. Kane is covered by a test double in this suite and is labelled as such.

## LLM providers: the 50-case benchmark

- **Command:** `BENCH_PROVIDERS=nvidia,groq,openrouter BENCH_MODELS=nvidia/nemotron-3.5-bolt-e4b BENCH_INCLUDE_OPENROUTER=1 npm run bench:llm`.
- **Cases:** 20 Korean rules, 10 English rules, 10 rules that must be rejected, and 10 AI opponent turns.
- **Data:** only synthetic game data is sent. Keys stay in the server process and none appear in the output.
- **Score:** 0.35 × raw semantic correct + 0.25 × valid JSON + 0.30 × AI turns that the model answered and the engine validated + 0.10 × (1 − (429s + timeouts) / requests).
- **What is scored:** the raw model answer, before the policy check and before any fallback.

| Rank | Provider | Model | Score | AI turns valid (answered) | Valid JSON | Raw correct (ko / en / reject) | p50 / p95 ms | 429s | Timeouts | Empty / non-JSON | Fallbacks /50 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | NVIDIA | `nvidia/nemotron-3.5-bolt-e4b` | 0.961 | 10/10 (10) | 38/40 | 37/40 (19/9/9) | 940 / 1222 | 0 | 0 | 0 | 2 |
| 2 | Groq | `openai/gpt-oss-120b` | 0.940 | 9/10 (10) | 40/40 | 38/40 (20/10/8) | 762 / 1270 | 7 | 0 | 0 | 0 |
| 3 | Groq | `qwen/qwen3.8-27b` | 0.906 | 8/10 (10) | 40/40 | 38/40 (19/10/9) | 485 / 973 | 10 | 0 | 0 | 0 |
| 4 | Groq | `openai/gpt-oss-20b` | 0.801 | 5/10 (6) | 40/40 | 38/40 (20/10/8) | 501 / 1066 | 21 | 0 | 0 | 4 |
| 5 | OpenRouter | `openrouter/free` | 0.747 | 4/10 (4) | 36/40 | 35/40 (16/10/9) | 5164 / 18251 | 0 | 3 | 23 | 10 |

**Not tested further.** On an earlier NVIDIA-only run, two models failed to serve:
- `mistralai/mistral-large-4-1t-a52b` timed out 49 times.
- `minimaxai/minimax-m3.1-flash` returned 18 HTTP 503 "content safety screening unavailable" errors from NVIDIA.

**Observations**

- Some AI turns were answered by the model but rejected by the engine, because the effect sentence did not mean the planned effect. For example, a model wrote "moved to column A" when the plan was a shove. These turns fall back to the planner's own sentence.
- All three Groq models accepted "Pushed toward your own side 2 squares". That rule must be rejected. In the game, the deterministic policy still rejects it, because the policy runs on the original text.
- Nemotron's misses were one HTTP 502 on NVIDIA's side and two misread rules.
- NVIDIA trial endpoints are for evaluation only and are not assumed to be licensed for production.

**Evidence files:**
- this run: `evidence/llm-bench/bench-2026-11-17T18-41-12-161Z.md` and `.json`
- the earlier NVIDIA-only run: `bench-2026-11-17T17-59-06-483Z`

## Kane CLI: the real live referee

- **Command:** `npm run kane:trial`.
- **Setup:** kane-cli 0.10.4 in analyzer mode on Windows, signed in, with Chrome found automatically.

| Run | Expected | Kane verdict | Kane time | Cached | Conditions |
|---|---|---|---|---|---|
| A human rule | approved | approved | 105.2 s | no | 6/6 true |
| B same rule from the AI | approved | approved | 98.1 s | no | 6/6 true |
| C canary: corrupted symmetry page | rejected | **rejected** | 114.9 s | no | C1 and C2 false |
| D repeat of A | approved | approved | 0 s | yes | 6/6 true |
| E seed 11, human rule | approved | approved | 107.3 s | no | 6/6 true |
| E seed 11, AI rule | approved | approved | 104.5 s | no | 6/6 true |
| E seed 12, human rule | approved | approved | 0 s | yes | 6/6 true |
| E seed 12, AI rule | approved | approved | 81.9 s | no | 6/6 true |

Every run exited with code 0.

**C, the canary.** Kane's reason: "In the 'Symmetry' table, for every scenario the Human piece row and the AI piece row show the same values … FAIL".

**Background review in the game (E).**
- A placement request returned in 0.8–3.1 s, either as pending or as a cached approval. An AI turn returned in 17–38 s.
- Each rule went live 0–2 turns after it was proposed, once Kane approved it.
- Seed 11:
  - the human rule was proposed on turn 1 and went live on turn 3, on C1 D1 E1;
  - the AI rule was proposed on turn 2 and went live on turn 3, on F2 F4 F6.

**Latency.** One uncached Kane review took:

| Commit | Time per review |
|---|---|
| 57b16fb | 55–288 s |
| V4 | 109–175 s |
| 1917d6c | 82–115 s |

**Credits.** This trial used about 60 Kane credits ([balance redacted] → [balance redacted]).

**Evidence files:**
- the report: `evidence/kane/live-2026-11-17T18-51-04-452Z.md` and `.json`
- one folder per trial under `evidence/kane/`: T9101, T9102, T9103-canary, T0001, T0002 and T0007

# V2 acceptance gates

## Gate A: automatic mechanics (MUST PASS)

- All V1 tests remain green; V2 tests cover shape/impact symmetry, unknown effect rejection, schema validation, empty key, deterministic snapshot sanitization.
- Every candidate rule goes through BOTH runtime semantic validation and non-LLM fairness check. `3×3 + freeze` rejected for both actors; `line + freeze` accepted for both.
- No `eval`, `Function`, model-supplied JS, real-world file/email/payment integrations, or uncontrolled redirects.
- Same seed, same resolved actions yield same round outcome. Each armed tile burns after first trigger. AI never gets the current committed human move.

## Gate B: actual model (PENDING)

- Under a currently available `:free` model with schema output support, manually test at least 20 Korean paraphrases, 10 English paraphrases, 10 invalid/malicious requests, and 10 AI turn choices. Record explicit pass/fail per row; never call a failure a success due to silent coercion.
- Keep 0 unsupported dangerous proposals accepted. For supported benign single-effects, target at least 90% semantic accuracy on the hand-reviewed set; this is an acceptance target, not a measured result.
- Distinguish compiler decline, policy rejection, provider timeout, invalid JSON, and offline fallback in logs/UI. Limit repeated API calls and ensure rate-limit recovery.
- Do NOT claim 'free API available' if configured provider is unavailable or over quota.

## Gate C: real Kane CLI (PENDING)

- Execute K01-K11 where supported; preserve authentic Kane evidence and failures, CLI version, start/end timestamps.
- If Kane cannot act as a per-turn judge with acceptable latency, keep it the independently invoked auditor; DO NOT rebrand local guard results as Kane decisions.
- At least one real Kane-detected defect -> Claude fix -> Kane retest loop, with verifiable before/after results, if such a defect is found. Do not fabricate defects to satisfy a rubric.

## Gate D: game quality / release (PENDING)

- New players can play 3 rounds without instructions and understand when they lost.
- 10 sample matches show traps matter; report movement-only rate, average match length, win split and latency (no invented numbers).
- Move all game states, AI commitments and winning decisions to a server-authoritative session before public competitive release. Do not launch the current client-authoritative prototype as a cheat-resistant multiplayer game.
- Never collect real emails, cards, or personal data; keys remain out of front-end code and VCS.

## Current evidence

- Browser and local engine historical V1 baseline: 17 regression cases (see `tests/engine-v1-baseline.test.cjs`).
- V2 unit/contract tests: run `npm test` for current count and verify exit code.
- Live OpenRouter: NOT_RUN. Live Kane CLI: NOT_RUN.

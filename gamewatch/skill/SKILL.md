---
name: gamewatch-kane-qa
description: Run a blind Kane QA review of game playtest evidence (GameWatch bundle) and turn the findings into reproduced, fixed and re-verified issues.
---

# GameWatch: game QA with Kane

Use when a game has playtest evidence (AI self-play, scripted runs or human sessions) and you want Kane to find rule
violations, inconsistent behaviour, state life-cycle problems and balance anomalies, then fix and re-verify them.

## 1. Collect evidence (no new simulator)
- Write or reuse an adapter that runs the game's EXISTING engine / opponents and emits `gamewatch/evidence@1`
  (`gamewatch/INPUT_CONTRACT.md`). Same seeds and scripts on every build; swap first movers.
- Build the site: `node --experimental-strip-types gamewatch/dashboard.ts <bundle.json> <siteDir>`.
- Check the site carries no expected answers (grep for labels, internal names, verdicts).

## 2. Blind Kane review (paid: needs explicit operator authorization for every call)
- Serve on loopback: `gamewatch/kane/serve.ts --label kane`. Findings arrive through the site's report form.
- Use OBJECTIVE mode (`kane-cli run "<objective>" --url ... --agent --headless --max-steps N`). Analyzer mode answers fixed
  boolean conditions only and cannot report unknown bugs without leaking what to look for.
- Print and review the plan first: `gamewatch/kane/plan.ts` (inputs, outputs, credits, limits). One call, no retry.

## 3. Close the loop
- Give the coding agent only the findings and a blind workspace (no hidden answers, no history, no network).
- For each finding: reproduce it with a scripted playtest on the build under test, inspect the code, fix, and re-run
  the SAME scripts and matched games; compare before/after bundles.
- Classify every finding honestly: confirmed + fixed, confirmed not fixed, not reproducible (false positive),
  unsupported suggestion. Report missed problems if a ground truth exists.

## Never
- Fabricate or edit evidence or Kane output; label a test double as Kane; run paid calls without authorization.

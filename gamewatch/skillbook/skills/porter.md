# Skill: Porter

Turn game-specific evidence into analysis-ready, reviewer-ready material.

1. The adapter emits `gamewatch/evidence@1` (`gamewatch/INPUT_CONTRACT.md`); the dashboard reads only that.
2. Build the evidence pages: rules, playtest source, per-step state before/after and engine events, per-turn match
   logs, aggregate statistics, and a findings form. Anonymous ids only.
3. Leak check: no expected answers, labels, counts of known problems or revealing names on any page.
4. Prepare the Kane call with the existing verified invocation (`gamewatch/kane/run.ts`: KS1 process handling, strict
   version/balance reads, paid-call gate). Dry run only at this step.

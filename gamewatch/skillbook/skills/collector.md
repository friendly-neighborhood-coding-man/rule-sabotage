# Skill: Collector

Find what the game already has and collect REAL evidence from it. Never simulate the game yourself, never write or
edit evidence by hand.

1. Discover: the documented rules, the existing opponents / simulations, scripted playtests, recorded human playtests.
2. Collect: run the game's own engine and opponents through the adapter (`gamewatch/run-evidence.ts`): scripted
   playtests on every build, AI-vs-AI games on matched seeds with first movers swapped.
3. Identify missing evidence: every documented rule must be exercised at least once per build (coverage map supplied by
   the adapter). A gap is reported, then filled only by adding scripted playtests (coding agent, authorized), never by
   editing results.

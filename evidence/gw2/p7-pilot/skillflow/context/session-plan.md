# Task session-plan: Collector: declare the session plan before any session

## Skill (skills/collector.md)

# Skill: GW2 collector

Prepare blind evidence without looking at it as an investigator would.

- Verify the frozen generation procedure (code and build hashes) and the bundle's provenance before anything else.
- Partition with the frozen partition procedure; run the leak check on the served discovery site. A failed check stops
  the book.
- Declare the session plan before any session starts. Nothing here reads held-out or evaluation files.

## Contract

Required inputs: none
Required outputs: evidence/gw2/p7-pilot/verdicts/03-session-plan.json
Acceptance: [{"json": "{out}/03-session-plan.json", "path": "ok", "op": "==", "value": true}]

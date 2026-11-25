# Task procedures: Collector: verify the frozen generation procedure, partition procedure and bundle provenance

## Skill (skills/collector.md)

# Skill: GW2 collector

Prepare blind evidence without looking at it as an investigator would.

- Verify the frozen generation procedure (code and build hashes) and the bundle's provenance before anything else.
- Partition with the frozen partition procedure; run the leak check on the served discovery site. A failed check stops
  the book.
- Declare the session plan before any session starts. Nothing here reads held-out or evaluation files.

## Contract

Required inputs: none
Required outputs: evidence/gw2/p6-run/verdicts/01-procedures.json
Acceptance: [{"json": "{out}/01-procedures.json", "path": "ok", "op": "==", "value": true}]

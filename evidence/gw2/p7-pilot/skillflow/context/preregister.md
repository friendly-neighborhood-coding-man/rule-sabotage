# Task preregister: Collector: freeze the pre-registration into the operator's external record (Q14), verify the evidence is unopened and the partition is the committed one

## Skill (skills/collector.md)

# Skill: GW2 collector

Prepare blind evidence without looking at it as an investigator would.

- Verify the frozen generation procedure (code and build hashes) and the bundle's provenance before anything else.
- Partition with the frozen partition procedure; run the leak check on the served discovery site. A failed check stops
  the book.
- Declare the session plan before any session starts. Nothing here reads held-out or evaluation files.

## Contract

Required inputs: none
Required outputs: evidence/gw2/p7-pilot/verdicts/03b-preregister.json
Acceptance: [{"json": "{out}/03b-preregister.json", "path": "ok", "op": "==", "value": true}]

# Task investigate: Investigator: blind discovery sessions through the Kane CLI boundary (review server, access journal, submissions, closure)

## Skill (skills/investigator.md)

# Skill: GW2 investigator session (gated)

One blind discovery session per declared investigator, through the Kane CLI invocation boundary
(`gamewatch/gw2/kane-boundary.ts`). The review server serves only the discovery site and journals every request.

- Route `real` is decided by the unchanged paid-call gate before any process starts. While paid execution is disabled it
  refuses, and the book stops.
- Route `test-double` starts the repository's deterministic shim through the same boundary. Its submissions are labelled
  TEST DOUBLE and measure no agent.
- No verifier feedback is given during discovery. The server closes and seals each session.

## Contract

Required inputs: none
Required outputs: none
Acceptance: []

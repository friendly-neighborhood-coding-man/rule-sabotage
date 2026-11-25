# Task representations: Verifier: submitter representations extracted verbatim and sealed before evaluation

## Skill (skills/verifier.md)

# Skill: GW2 verifier

Turn closed sessions into evaluated, sealed records. No model, no interpretation of free text.

- Import every closed session explicitly; freeze all hypotheses at experiment level; extract submitter-authored structured
  representations verbatim (no translation, no repair: U3) and seal them before any evaluation is opened.
- Evaluate only through the gate: three-way relations, held-out prediction, competing-hypothesis discrimination.
- Report every dimension side by side, abstentions apart, no composite score; then verify the integrity of every sealed
  artifact.

## Contract

Required inputs: none
Required outputs: evidence/gw2/p6-run/verdicts/08-representations.json
Acceptance: [{"json": "{out}/08-representations.json", "path": "ok", "op": "==", "value": true}]

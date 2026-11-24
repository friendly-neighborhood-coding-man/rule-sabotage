# GameWatch QA report

Generated 2026-11-24T21:01:42.855Z. Sections marked NOT RUN were not executed in this run.

## Collector
- Rule Sabotage V6.1: 15 documented rules; sources: 9 AI opponents, 11 scripted playtests, human playtest entries: 2. kane-cli: 0.10.4.
- Evidence coverage: every one of 15 rules exercised on every build.

## Porter
- 56 evidence pages, leak check clean (11 terms).

## Analyzer: Kane review (verbatim findings)
- **[clean / no problem found]** (high) rules No documented rule violations identified., builds Reviewed build evidence.: No problem found in the reviewed evidence; no confirmed observable anomaly, lifecycle inconsistency, or balance issue was identified.
  - evidence: Case C-9fc650; reviewed documented rules and recorded playtest steps.
  - reproduce: Verify by rerunning the documented case steps and comparing resulting states and engine events against the stated rules.
  - suggestion: No fix recommended. Continue regression checks against documented rules.
- **[confirmed observable anomaly]** (high) rules R8, builds QX-73 (comparison: QX-41): QX-73 did not consume a +1 action cell after entry. The same AI piece entered I5 via shove, then stepped off and re-entered; the cell fired twice and granted two extra actions. R8 says an effect fires on arrival and is then used up, including effect-driven arrival.
  - evidence: C-9fc650 (QX-73), turn 4, steps 11 and 13: I5 +1 action fires at both entries and remains after step 11. Compare C-757669 (QX-41), turn 4, step 11: I5 is removed after the first entry; its later move I5 left is refused after actions run out.
  - reproduce: Run the scripted forced-entry +1 case on QX-73: place Shove west 2 at K5 and +1 action at I5; move AI M5-L5-K5 so shove forces it to I5; move I5-H5-I5. Verify I5 disappears immediately after the first effect-fired event and cannot fire again.
  - suggestion: Consume/remove the effect cell atomically on its first firing, including chained or forced arrivals. Add a regression asserting one effect-fired event for I5 and no extra action on re-entry.
- **[confirmed observable anomaly]** (high) rules R3, builds QX-73 (comparison: QX-41): QX-73 grants Human four starting move actions while all three Human pieces remain on the board. R3 specifies one move action per own piece, so the observed starting allowance should be three. QX-41 grants three in the matching script.
  - evidence: C-9fc650 (QX-73), turn 1 step 1: turn-start side=Human actionsGranted=4 with h1, h2, h3 all on board; also turn 3 step 6 and turn 5 step 15 show Human actionsGranted=4. Matching C-757669 (QX-41), turn 1 step 1, records actionsGranted=3.
  - reproduce: Start the forced-entry +1 scripted case on QX-73 without any prior +1 action effect. At Human turn 1, count the three Human pieces and compare the turn-start actionsGranted value; it should equal three.
  - suggestion: Initialize turn actions from the current count of the side's pieces on the board, with only a valid +1 effect modifying that allowance. Add a test asserting actionsGranted=3 for the three-piece initial state.

## Analyzer: coverage audit of the review
- 3 findings; rules cited R3, R8; not cited R1, R2, R4, R5, R6, R7, R9, R10, R11, R12, R13, R14, R15; 2 cases and 0 matches cited; 0 findings without evidence ids.

## Analyzer: balance (GameWatch engine statistics, not Kane)
- QX-41: first mover won 8/16 (sign test p=1); matched pairs 2-2 (split 4); actions minus pieces per turn: first mover 0, second mover 0; median 32 turns.
- QX-73: first mover won 10/16 (sign test p=0.454); matched pairs 2-0 (split 6); actions minus pieces per turn: first mover 1, second mover 0; median 23 turns.

## Analyzer: regression review
- vs reference QX-41: 11 scripts now match, 0 still differ, 0 regressions.


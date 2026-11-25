# GameWatch GW2 verdict-time coverage (gw1-historical-replay)

> No server-side access journal exists for GW1: the GW1 review server (gamewatch/kane/serve.ts) recorded form submissions only. Server access is therefore "unavailable" for every GW1 item; it is not "not accessed". No server access record has been, or can be, reconstructed for GW1.

Reconstruction: Kane step remarks via the imported community tool gamewatch/skillbook/steps/visit-coverage.mjs (unchanged). A recorded visit is a recognised completed click/navigation, not proof the page loaded or was read; no record is not proof of absence.

A server-recorded access means the server served the page to this session. It does not show that the page was rendered, read or understood. Missing or unusable instrumentation is reported as such, never as "not accessed".

| Column | Category (verbatim) | Server-recorded (cases / matches) | Reconstructed visits (cases / matches) | Cited | Cited without access |
|---|---|---|---|---|---|
| Finding 1 2026-11-24T18:53:13.663Z | clean / no problem found | unavailable (no GW1 journal) | 2/22 / 0/32 | C-9fc650 | C-9fc650 |
| Finding 2 2026-11-24T18:54:12.815Z | confirmed observable anomaly | unavailable (no GW1 journal) | 3/22 / 0/32 | C-757669, C-9fc650 | — |
| Finding 3 2026-11-24T18:54:34.743Z | confirmed observable anomaly | unavailable (no GW1 journal) | 3/22 / 0/32 | C-757669, C-9fc650 | — |
| Run end 2026-11-24T18:55:15.237Z | — | unavailable (no GW1 journal) | 3/22 / 0/32 | — | — |

## Findings, verbatim

Finding 1:

```json
{"at":"2026-11-24T18:53:13.663Z","source":"kane","nonceValid":true,"category":"clean / no problem found","rules":"No documented rule violations identified.","builds":"Reviewed build evidence.","claim":"No problem found in the reviewed evidence; no confirmed observable anomaly, lifecycle inconsistency, or balance issue was identified.","evidence":"Case C-9fc650; reviewed documented rules and recorded playtest steps.","reproduce":"Verify by rerunning the documented case steps and comparing resulting states and engine events against the stated rules.","suggestion":"No fix recommended. Continue regression checks against documented rules.","confidence":"high","nonce":"d9b7417e6ecb2a0c"}
```

Finding 2:

```json
{"at":"2026-11-24T18:54:12.815Z","source":"kane","nonceValid":true,"category":"confirmed observable anomaly","rules":"R8","builds":"QX-73 (comparison: QX-41)","claim":"QX-73 did not consume a +1 action cell after entry. The same AI piece entered I5 via shove, then stepped off and re-entered; the cell fired twice and granted two extra actions. R8 says an effect fires on arrival and is then used up, including effect-driven arrival.","evidence":"C-9fc650 (QX-73), turn 4, steps 11 and 13: I5 +1 action fires at both entries and remains after step 11. Compare C-757669 (QX-41), turn 4, step 11: I5 is removed after the first entry; its later move I5 left is refused after actions run out.","reproduce":"Run the scripted forced-entry +1 case on QX-73: place Shove west 2 at K5 and +1 action at I5; move AI M5-L5-K5 so shove forces it to I5; move I5-H5-I5. Verify I5 disappears immediately after the first effect-fired event and cannot fire again.","suggestion":"Consume/remove the effect cell atomically on its first firing, including chained or forced arrivals. Add a regression asserting one effect-fired event for I5 and no extra action on re-entry.","confidence":"high","nonce":"d9b7417e6ecb2a0c"}
```

Finding 3:

```json
{"at":"2026-11-24T18:54:34.743Z","source":"kane","nonceValid":true,"category":"confirmed observable anomaly","rules":"R3","builds":"QX-73 (comparison: QX-41)","claim":"QX-73 grants Human four starting move actions while all three Human pieces remain on the board. R3 specifies one move action per own piece, so the observed starting allowance should be three. QX-41 grants three in the matching script.","evidence":"C-9fc650 (QX-73), turn 1 step 1: turn-start side=Human actionsGranted=4 with h1, h2, h3 all on board; also turn 3 step 6 and turn 5 step 15 show Human actionsGranted=4. Matching C-757669 (QX-41), turn 1 step 1, records actionsGranted=3.","reproduce":"Start the forced-entry +1 scripted case on QX-73 without any prior +1 action effect. At Human turn 1, count the three Human pieces and compare the turn-start actionsGranted value; it should equal three.","suggestion":"Initialize turn actions from the current count of the side's pieces on the board, with only a valid +1 effect modifying that allowance. Add a test asserting actionsGranted=3 for the three-piece initial state.","confidence":"high","nonce":"d9b7417e6ecb2a0c"}
```


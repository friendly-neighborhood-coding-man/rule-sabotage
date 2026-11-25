# GameWatch GW2 verdict-time coverage (gw2-session)

Access journal: **valid**; attribution: single-client. Ordering: server sequence numbers.

Reconstruction: not supplied

A server-recorded access means the server served the page to this session. It does not show that the page was rendered, read or understood. Missing or unusable instrumentation is reported as such, never as "not accessed".

| Column | Category (verbatim) | Server-recorded (cases / matches) | Reconstructed visits (cases / matches) | Cited | Cited without access |
|---|---|---|---|---|---|
| Finding 1 (seq 7) 2026-11-25T13:00:54.838Z | confirmed observable anomaly | 1/22 / 0/32 | not available | C-757669, C-9fc650, M-0056c3 | C-9fc650, M-0056c3 |
| Session end (seq 10) | — | 2/22 / 0/32 | not available | — | — |

## Findings, verbatim

Finding 1:

```json
{"at":"2026-11-25T13:00:54.838Z","source":"test-double","nonceValid":true,"session":"0356aaa881ecb27a","category":"confirmed observable anomaly","rules":"R8","builds":"QX-73","claim":"TEST DOUBLE finding (scripted, not a review): a +1 action cell reached by a shove fires again on re-entry.","evidence":"C-757669 steps 6-9 (reference); C-9fc650 steps 6-9; compare M-0056c3","reproduce":"scripted","suggestion":"none","confidence":"low","nonce":"cb804de3832f7d0b"}
```


# GW1 findings and labels imported into the GW2 judgment graph

`judgments.ndjson` (`gamewatch/gw2-judgment@1`) was produced by
`node --experimental-strip-types --no-warnings gamewatch/gw2/import-gw1.ts` and is reproduced byte for byte by
`tests/gw2-judgments.test.ts` (AC-P2.7). It references the frozen GW1 files by path and SHA-256; none of them was
modified. Every timestamp comes from the sources; no import time is recorded.

| seq | node id (prefix) | kind | author | links | content |
|---|---|---|---|---|---|
| 1 | `b7c0deb15eb4` | finding | kane-cli 0.10.4 (agent, historical import) | – | notes.ndjson line 1, verbatim: clean / no problem found |
| 2 | `0d34a6392cec` | finding | kane-cli 0.10.4 | – | notes.ndjson line 2, verbatim: confirmed observable anomaly (R8) |
| 3 | `dcefe871cdcf` | finding | kane-cli 0.10.4 | – | notes.ndjson line 3, verbatim: confirmed observable anomaly (R3) |
| 4 | `3100dfb29410` | label | GW1 preparing session (Claude Code), version not recorded | evaluates 1 | false negative (inconsistent clean report) |
| 5 | `059cfe07d245` | label | same | evaluates 2 | true detection (B2) |
| 6 | `b0fbaca50165` | label | same | evaluates 3 | true detection, partial characterisation (B3) |

The three findings coexist; no node supersedes or challenges another, and nothing in the graph says which finding is
right. The Kane attribution of the findings is checked against the stored kane-cli output
(`evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson`, `args.json`): stream_start `cli_version` and
args `version` are both 0.10.4, run_end is present, and each note has `source: "kane"` and `nonceValid: true`.

**External anchor** (recorded here and in the P2 pull request, outside the file, so that removal of lines from the end
of `judgments.ndjson` can be detected):

```
count 6, lastLineSha256 bfffa8b6f65e2ba7a4836444fab911762cb812e6b97176e834062cfbb4cfcb50
node --experimental-strip-types --no-warnings gamewatch/gw2/judgments.ts verify evidence/gw2/gw1-import/judgments.ndjson --check-refs --anchor 6:bfffa8b6f65e2ba7a4836444fab911762cb812e6b97176e834062cfbb4cfcb50
```

An anchor stored in the same repository is only as strong as the repository's history; it detects accidental
truncation and naive edits, not a deliberate rewrite of both the file and this note.

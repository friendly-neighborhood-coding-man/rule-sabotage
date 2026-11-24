# Spec: blind Kane review

- Exactly one `kane-cli run "<objective>" --url http://127.0.0.1:3210/index.html --agent --headless --max-steps 25 --timeout 600`.
- Needs: the SkillFlow authorization `kane-paid` AND the code gate (`PAID_RESEARCH_EXECUTION`, single-use approval file,
  `KANE_PAID_RUN_AUTH` = run id). Either missing: stop, no Kane process.
- Outputs: `evidence/gamewatch/review/notes.ndjson` (findings, verbatim, nonce-checked), `run/GW1-blind-review/`
  (args, stdout, stderr, meta), `ledger.ndjson` (balance before/after).
- Exit 0 = ran and at least one valid finding; 2 = refused before any Kane process; 3 = ran, inconclusive or no finding.

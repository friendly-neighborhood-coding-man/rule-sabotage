# GameWatch: a Kane-powered game QA SkillBook

GameWatch reviews a game using evidence from its **existing** human or AI playtests. It never simulates the game itself.
Kane, a browser agent, reviews that evidence blind and reports findings through a form. A coding agent then reproduces,
fixes and re-verifies those findings in a workspace that hides the answers. Everything runs as a **SkillBook**, a list of
tasks with checks, branches and authorization gates, executed one task at a time by **SkillFlow**.

**First result (GW1, Rule Sabotage V6.1, three planted defects).** Kane made one call and detected 2 of the 3 defects.
A coding agent made one repair attempt, reproduced Kane's two findings, found the third defect itself, and fixed all
three. The independent probes confirm the fixes, and the controls are unchanged. Full report and limitations:
[`docs/GW1_FINAL_REPORT.md`](../docs/GW1_FINAL_REPORT.md).

## Quick start (free, no Kane, no agent; about 1 minute)

Requirements: Node.js ≥ 22.10 and Python ≥ 3.9. There is nothing to install: TypeScript runs with
`--experimental-strip-types`, and the runner is one standard-library Python file.

```
git clone https://github.com/friendly-neighborhood-coding-man/rule-sabotage && cd rule-sabotage
git checkout claude/project-thread-1a20hc            # the submission branch (PR #21)
python gamewatch/vendor/verify.py                    # vendored SkillFlow runner matches its pinned checksum
python gamewatch/vendor/skillflow/runner.py run gamewatch/skillbook/book.json --state .gw-run --workdir . \
  --var out=evidence/gamewatch/qa-demo --var build=QX-73 --var reference=QX-41 --var workspace=../gw-blind-workspace
#  discover -> collect (keeps the frozen bundle) -> gaps -> pages -> leak check -> Kane plan -> balance
#  -> stops with exit 2 "needs-authorization" at the paid Kane review
python gamewatch/vendor/skillflow/runner.py status --state .gw-run
node --experimental-strip-types gamewatch/kane/serve.ts --notes demo-notes.ndjson
#  browse the evidence site Kane reviewed at http://127.0.0.1:3210/ (a test form goes to demo-notes.ndjson,
#  not to the published Kane findings)
```

To check the published GW1 result without any paid call, see [`docs/DEMO.md`](../docs/DEMO.md). It verifies the freeze,
re-exports the blind workspace and recomputes the evaluation.

## What the SkillBook does

| Group | Tasks (`gamewatch/skillbook/book.json`) | What runs |
|---|---|---|
| **Collector** | discover → collect evidence → identify gaps (→ fill gaps with a coding agent, authorized only) | `steps/discover.ts`, `run-evidence.ts`, `steps/gaps.ts` |
| **Porter** | build evidence pages → leak check → prepare Kane call (dry run) | `dashboard.ts`, `steps/leakcheck.ts`, `kane/run.ts` |
| **Analyzer** | balance statistics → **blind Kane review (paid, authorized only)** → coverage audit → fix (coding agent, authorized only, **one attempt**, output frozen on exit) → fresh re-run of the playtests → regression review → QA report | `steps/balance.ts`, `kane/run.ts --execute`, `steps/audit.ts`, `steps/fix.ts`, `steps/regression.ts`, `steps/report.ts` |

Two gates guard the paid step: a SkillFlow authorization file, and a code gate that is disabled in every commit and
needs a single-use approval record. The operator's manual scripts handle both, enable the code gate for one process
only, and restore it afterwards. Those scripts (`gw1-manual-run.ps1`, `gw1-repair-run.ps1`) are kept outside the
repository.

## Prerequisites for the paid and agent steps

* Kane step: kane-cli **0.10.4** on PATH (or `KANE_CLI`), signed in, with Chrome available. kane-cli has no credit
  limit; GameWatch measures the balance before and after, and logs it.
* Coding-agent steps: an agent CLI (default `claude -p`; override with `GW_AGENT_CMD` as a JSON argv). The agent's own
  permission and billing settings apply.

## Bringing another game

Write an adapter (`gamewatch/adapters/rule-sabotage.ts` is the only file that imports this game) and a coverage map, and
emit the bundle described in [`INPUT_CONTRACT.md`](INPUT_CONTRACT.md) (`gamewatch/evidence@1`). The dashboard, the Kane
harness, the audit and the regression review read only that bundle.

## SkillFlow (runner) attribution

GameWatch runs on **SkillFlow**, a separate, domain-independent project:
https://github.com/friendly-neighborhood-coding-man/skillflow (MIT). `gamewatch/vendor/skillflow/` holds an
**unmodified** copy of its `runner.py` and `LICENSE`. `VENDOR.json` records the upstream URL, pinned commit
`da9785a030dd62cc0dc7bc2ca522655c2aefdb19`, license and SHA-256 checksums. GameWatch needs no clone, install, submodule
or download of SkillFlow. `python gamewatch/vendor/verify.py --upstream <checkout>` proves that the copy matches the
pinned upstream commit. To change the runner, change it upstream and re-vendor; never edit the vendored copy.

History: SkillFlow was written on 2026-11-24 for this hackathon, by the same author with Claude Code, as its own
project with its own example and tests, and then vendored here. SkillFlow contains no game-specific logic.

### Using SkillFlow on its own

```
git clone https://github.com/friendly-neighborhood-coding-man/skillflow && cd skillflow
git checkout da9785a                                  # the version GameWatch pins (or use main)
python runner.py validate examples/triage/book.json
mkdir -p /tmp/work && echo "a b c d e f g h" > /tmp/work/input.txt
python runner.py run examples/triage/book.json --state /tmp/sf --workdir /tmp/work --var limit=5   # stops, exit 2
touch /tmp/sf/authorizations/publish && python runner.py resume --state /tmp/sf                    # done
python -m unittest discover -s tests                  # 9 self-tests
```

It needs Python ≥ 3.9 and nothing else. You can also copy `runner.py` into your own project, as GameWatch does. Keep
the license, and record the commit and checksum. Exit codes: 0 done, 2 needs authorization, 3 stopped or failed,
4 limit reached, 5 invalid book.

## Commands

```
npm run gamewatch:evidence      # materialize builds, 22 cases + 32 games -> evidence/gamewatch/evidence.json (about 3 min)
npm run gamewatch:dashboard     # -> evidence/gamewatch/site/
npm run gamewatch:groundtruth   # private reproduction tests (8)
npm run gamewatch:serve         # loopback review server (no Kane); add -- --notes <file> to keep test forms separate
npm run gamewatch:kane-plan     # dry-run plan + frozen-input check (no Kane)
```

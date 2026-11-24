# GameWatch: a Kane-powered game QA SkillBook

GameWatch reviews a game using evidence from its **existing** human or AI playtests. It never simulates the game itself.
It is organised as a SkillBook run by SkillFlow, one task at a time, with checks and branching:

| Group | Tasks (`gamewatch/skillbook/book.json`) | What runs |
|---|---|---|
| **Collector** | discover → collect evidence → identify gaps (→ fill gaps with a coding agent, authorized only) | `steps/discover.ts`, `run-evidence.ts`, `steps/gaps.ts` |
| **Porter** | build evidence pages → leak check → prepare Kane call (dry run) | `dashboard.ts`, `steps/leakcheck.ts`, `kane/run.ts` |
| **Analyzer** | balance analysis → **blind Kane review (paid, authorized only)** → coverage audit → fix (coding agent, authorized only) → re-run playtests → regression review (may loop back to fix, bounded) → QA report | `steps/balance.ts`, `kane/run.ts --execute`, `steps/audit.ts`, `steps/fix.ts`, `steps/regression.ts`, `steps/report.ts` |

First integration: **Rule Sabotage V6.1** with a blind fault-injection experiment (`docs/GAMEWATCH.md`).

## Prerequisites

* Node.js ≥ 22.10 (TypeScript runs with `--experimental-strip-types`; no npm install needed) and Python ≥ 3.9 (runner).
* For the Kane step only: kane-cli **0.10.4** on PATH (or `KANE_CLI`), signed in, with Chrome available, and the
  operator's manual gated run (`gamewatch/kane/gw1-manual-run.ps1`).
* For the coding-agent steps only: an agent CLI (default `claude -p`; override with `GW_AGENT_CMD` as a JSON argv). Its
  own permission and billing settings apply; GameWatch adds no permission flags.

## Run

```
python gamewatch/vendor/verify.py                     # vendored runner matches its pinned checksum
python gamewatch/vendor/skillflow/runner.py run gamewatch/skillbook/book.json --state .gw-run --workdir . \
  --var out=evidence/gamewatch/qa --var build=QX-73 --var reference=QX-41 --var workspace=../gw-blind-workspace
python gamewatch/vendor/skillflow/runner.py status --state .gw-run
```

Without authorizations the run stops at the Kane review with exit code 2 (`needs-authorization`). After the operator
approves and creates `.gw-run/authorizations/kane-paid` (and runs the gated Kane call), `runner.py resume --state .gw-run`
continues. The coding-agent steps need `.gw-run/authorizations/coding-agent`.

## SkillFlow dependency (vendored, no download)

`gamewatch/vendor/skillflow/` holds an unmodified copy of SkillFlow's `runner.py` and `LICENSE` (MIT) from
**https://github.com/friendly-neighborhood-coding-man/skillflow**, pinned commit and checksums in `VENDOR.json`.
GameWatch needs no clone, install or download of SkillFlow. `python gamewatch/vendor/verify.py --upstream <checkout>`
proves the copy is identical to the pinned upstream commit.

History: SkillFlow was written on 2026-11-24 for this hackathon by the same author and Claude Code, as a separate
domain-independent project (own repo, own example and tests), then vendored here. GameWatch contains no other copy of
the runner, and SkillFlow contains no game-specific logic.

## Input contract

`gamewatch/INPUT_CONTRACT.md` (`gamewatch/evidence@1`): another game needs only an adapter and a coverage map.

# Kane CLI — Independent fairness audit plan

**Role:** independent browser/game behavior validator and counterexample finder. `--analyzer-only` evaluates page conditions and does not act as a general-purpose low-latency game simulation service. In the current package the in-game "judge" badge describes the deterministic local guard; NEVER claim Kane approved a proposal unless a real run produced evidence.

Official docs (check commands again on operator version):
- <https://www.testmuai.com/docs/kane-cli-cli-reference>
- <https://www.testmuai.com/docs/kane-cli-modes>
- <https://github.com/LambdaTest/kane-cli/blob/main/.agents/skills/kane-cli/SKILL.md>
- <https://www.kaneclihack.sh/>

## Operator flow

1. Install/login to a currently supported Kane CLI in the local environment. Do not put credentials into the repo. Start `npm start` and confirm `http://127.0.0.1:3000` loads in a regular browser.
2. Run a **real browser test**, adapting syntax only if supported by the installed version:

   ```bash
   kane-cli run "Play Rule Sabotage: choose a Korean freeze rule, verify it is accepted on a line and rejected on a 3x3 square, verify both players share the current shape, each triggered tile disappears once, and no bad rule changes the score or executes external operations." --url http://127.0.0.1:3000 --agent --headless
   ```

3. In a pre-opened, supported Kane desktop browser context, condition checks MAY also be supported:

   ```bash
   kane-cli run --analyzer-only --condition "The app displays both sides' rule slots and clearly labels whether fairness was checked locally or by Kane." --agent
   ```

4. Preserve the real exit code, selected tool/version, timestamp, results and any Kane-generated evidence bundle. Kane's CLI may produce a sealed `.evidence` pack; retain its actual path, not an invented one. If either command/feature is unsupported, mark it **BLOCKED/NOT_RUN** and record the error.
5. Feed failing reproductions to Claude. Fix code and rerun the SAME concrete browser condition. Record before/after verdict, patch diff and screenshots/trace. Do not claim closed-loop merely because a unit test passed.

## Mandatory fairness cases

| ID | Browser-visible test | Expected |
|---|---|---|
| K01 | Both sides shown same shape each round | PASS |
| K02 | Human creates `freeze` on horizontal shape | ACCEPT |
| K03 | Human creates `freeze` on 3×3 | REJECT (impact 18/14) |
| K04 | AI proposes same 3×3 `freeze` | REJECT under SAME rule |
| K05 | Both human and AI stepping on opponent-owned trap | Same effect regardless of owner |
| K06 | Trap activated once at one tile, other zone tiles remain | No second activation at consumed tile |
| K07 | Input asks for `10턴 속박`, instant win, or named opponent only | Reject without executing code |
| K08 | Two sides choose simultaneously | AI request includes only pre-round state, NOT current human action |
| K09 | Timeout/rate limit/free-model unavailable | Clear offline fallback label, no claim of live model success |
| K10 | Browser consoles, network, keyboard and controls on phone-sized viewport | No unexpected errors |
| K11 | Kane finds rule conflict, developer patches and Kane reruns | Real closed-loop evidence |

This is the audit **plan**, not completed evidence.

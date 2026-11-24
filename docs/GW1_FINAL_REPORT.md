# GameWatch GW1: final experimental report

Status: **READY_FOR_HACKATHON_SUBMISSION**. Experiment closed on 2026-11-24. There was 1 paid Kane call, 1 coding-agent
repair attempt, and nothing was run again.

This report covers one blind fault-injection experiment on Rule Sabotage V6.1 with GameWatch:

1. Three defects were planted in one build.
2. Kane reviewed the existing playtest evidence blind.
3. A coding agent got only Kane's findings and a stripped workspace, and made one repair attempt.
4. Its output was frozen.
5. Only then was the output compared with the private ground truth.

Design: `docs/GAMEWATCH.md`. Evidence: `evidence/gamewatch/` (published after redaction).

## 1. Result at a glance

| Planted defect (private manifest) | Rule | Kane (blind review) | Coding agent (one attempt) | Independent probes after the freeze |
|---|---|---|---|---|
| **B1** asymmetric rule: a shield protects only AI pieces | R14, R7 | **missed** | **found itself** in the existing scripted evidence, reproduced, fixed | fixed |
| **B2** life cycle: a cell reached by a forced (shove) arrival is not used up | R8 | **detected** (exact) | reproduced, fixed | fixed |
| **B3** balance bias: the first mover gets +1 action every turn | R3 | **detected** (observation correct; attributed to "Human") | reproduced, generalised to "first mover", fixed | fixed |
| controls (normal walk, freeze) | – | – | – | unchanged |

* Kane detected **2 of 3** planted defects. It did **not** detect all three, and it did **not** analyse balance
  statistically. Its B3 finding is a single observation in one scripted case (4 actions for 3 pieces), not a statistical
  balance analysis. It opened no match page.
* Kane also submitted **one inconsistent "clean" report**, and its own run summary repeats that clean verdict (§3.3).
* The repair fixed **all 3** defects, with no control regression. **B1 was fixed because the coding agent found it**,
  not because Kane reported it.

## 2. What ran (measured)

| | Value | Source |
|---|---|---|
| Kane calls | 1 (objective mode, kane-cli 0.10.4, `--max-steps 80 --timeout 2700`) | `review/run/GW1-blind-review/args.json`, `ledger.ndjson` |
| Kane process time | 267.0 s (Kane's own run duration: 193.4 s) | `meta.json` `ms`, `stdout.ndjson` `run_end.duration` |
| Credits, balance before minus after | **72.398** | `ledger.ndjson` `call-end.used` |
| Credits, Kane's own `credits_consumed` | 68.028 | `stdout.ndjson` `run_end` |
| Browser actions | 43 (33 in the main flow + 10 filling forms); 3 forms submitted, all with a valid nonce | `stdout.ndjson`, `notes.ndjson` |
| Pages opened | index, 3 of 22 case pages (C-0ad0c4 and C-757669 on QX-41, C-9fc650 on QX-73), report form; 0 of 32 match pages | `stdout.ndjson` |
| Repair attempts | 1 (Claude Code headless), agent time 635.4 s, exit 0, not stopped by the time limit | `repair/attempt.json`, `repair/FREEZE.json` |
| Repair workflow (SkillBook resume to report) | 993 s (operator's measurement) | operator report |
| Frozen output | 9 files (1 changed, 8 added), all hashes verified, no workspace code change since the freeze | `repair/FREEZE.json`, `repair-freeze.ts verify` |

The two credit figures differ by 4.37 credits (6 %). In KS1 they matched. The balance delta is what the account paid,
so it is the figure reported. The difference is recorded as measured and is not explained here.

## 3. Kane's findings, labelled after the freeze

The labels are against `gamewatch/private/mutations.json` (`gamewatch/private/evaluation/labels.json`). They were
written only after the repair output was frozen and the operator's evaluation had run.

1. **18:53:13, "clean / no problem found", cites C-9fc650 → inconsistent clean report (false negative).** Kane wrote it
   after opening only the two QX-41 cases. Its log records `analyze: the evidence shows that nothing is wrong` at that
   point. It then opened C-9fc650 (QX-73) and reported two anomalies in that same case.
2. **18:54:12, "confirmed observable anomaly", R8 → true detection of B2.** It names the right case, steps, comparison
   case and fix. A +1 action cell reached by a shove fires again on re-entry.
3. **18:54:34, "confirmed observable anomaly", R3 → true detection of B3, partial characterisation.** It observed
   `actionsGranted=4` with 3 pieces on Human turns 1, 3 and 5, and 3 on QX-41. It called this a Human problem. Human
   moves first in every scripted case, so the observation is right, but the cause (a first-mover, odd-turn bonus for
   either side) was left open.

Kane did not report B1. Kane never opened the case that shows it (the Human shield case) or any match page, so the
shield asymmetry was never in front of it.

### 3.3 Kane's run summary is stale

The `run_end` summary says "Found no evidence-supported rule violations … Submitted a clean report". Its final state
is `nothing_wrong_found: true` and its verdict is `approved`. All three were written after it had submitted the two
anomaly findings. Read on its own, the summary would hide both detections. GameWatch stores every submitted form, and
the coverage audit counts the forms, not the summary.

## 4. The repair, from the frozen report and the code

### 4.1 Code changes

`server/v6/engine.ts` is the only game file changed. It has three one-line edits; the diff is taken against the build
as received, `repair/baseline-files/server/v6/engine.ts`:

```diff
@@ startTurn
-  s.actionsLeft = onBoard(s, p).length + s.bonus[p] + (s.turn % 2);
+  s.actionsLeft = onBoard(s, p).length + s.bonus[p];
@@ land
-      if (!forced) unsetCell(s, k);
+      unsetCell(s, k);
-      const shielded = group.filter(q => q.shield && q.owner === 'ai'), hit = group.filter(q => !shielded.includes(q));
+      const shielded = group.filter(q => q.shield), hit = group.filter(q => !shielded.includes(q));
```

Compared with the clean engine, the repaired file still differs in two places. Both differences are behaviourally
equivalent, and the probes confirm it:

* It keeps `hit = group.filter(q => !shielded.includes(q))` instead of `!q.shield`. Both select the unshielded
  pieces.
* It keeps `for (const q of group) q.shield = false` instead of `for (const q of shielded)`. The pieces in `group`
  that are not in `shielded` already have no shield.

The B1 plant changed two lines. The agent corrected the one that mattered and left the harmless one.

### 4.2 How B1 was fixed although Kane did not report it

The brief asked the agent to collect "before" evidence first and to report "any other problem you found that Kane did
not report".

* In the scripted case `shield-human`, the agent saw a shielded Human piece sent home by an AI "Send home" cell, while
  the mirror case `shield-ai` absorbed correctly.
* In its matched games it counted shield absorptions of 4 for AI pieces and 0 for Human pieces.
* It reproduced the asymmetry with a direct engine test that failed for Human only.
* It traced it to `q.owner === 'ai'` in `land()` and removed the condition.

Its report also explains why the referee did not catch the defect: the symmetry trial E2 uses pieces without
shields. That is correct.

So the discovery came from **GameWatch's existing evidence**: the same scripted case and match data Kane could have
opened. It was made by the **coding agent**, not by Kane.

### 4.3 Kane's discoveries, the agent's discoveries and incidental corrections

* **Kane, and confirmed by the agent:**
  * B2: reproduced exactly as Kane described.
  * B3: reproduced. The agent widened it from "Human gets 4 actions" to "whoever plays odd-numbered turns (always the
    first mover) gets +1 every turn". It measured 200 of 390 turns granting more actions than pieces before the fix,
    and 0 of 528 after.
* **The agent alone:** B1 (§4.2).
* **The agent disagreed with Kane:** finding 1, the clean report. The agent noted that it contradicts Kane's own
  findings 2 and 3 on the same case.
* **Incidental corrections:** none in game code. Beyond the three lines above, the agent added only:
  * a read-only comparison script, `gamewatch/closed-loop/compare.ts`;
  * logs;
  * its before and after evidence bundles;
  * `tests/closed-loop.test.ts`.
* **Suggestions it did not implement** (in its report):
  * The +1 action bonus is capped at 1, and R15 is silent on whether bonuses add up.
  * The referee E2 trial could include shielded pieces.
  * It could not match Kane's case ids to its own, because ids depend on the build label.

## 5. Regression results and test counts (exact)

| Check | Result | Source |
|---|---|---|
| Fresh re-run after the freeze, scripted cases against the reference build QX-41 | **11 of 11 now match**, 0 still differ, **0 regressions** | `qa/regression.json` |
| Before the repair (QX-73 against QX-41) | **0 of 11 matched** (B3 changes the turn-start grant in every script) | `regression.ts` on the frozen bundle, recomputed |
| Agent's own re-run: matched games before → after | first mover won 10/16 → 8/16; mean length 24.4 → 33.0 turns; shield absorptions Human/AI 0/4 → 3/3 | `CLOSED_LOOP_REPORT.md` (the agent's figures, from its own bundles in `repair/output/evidence/`) |
| Existing V6 suite after the repair | **42 tests, 42 pass, 0 fail** | `repair/output/test-v6-after.log`, recomputed |
| Existing V6 suite on the build as received | 42 pass, 0 fail: the suite catches none of the three defects | recomputed |
| Agent's regression tests after the repair | **7 tests, 7 pass** (2 R3, 3 R8, 2 R14/R7) | recomputed |
| Agent's regression tests on the build as received | **7 of 7 fail** (the agent's claim, confirmed) | recomputed |
| Agent's regression tests on the clean engine | 7 of 7 pass | recomputed |
| Independent probes | B1, B2, B3 fixed; controls unchanged | operator's evaluation; recomputed identically |

"Recomputed" means re-run in a cloud scratch clone at `fa8c77c`, after the operator's evaluation:

1. The blind workspace was exported again. All **2431 files are hash-identical** to the operator's workspace baseline
   (`repair/baseline.json`), which also confirms the agent received what was leak-checked.
2. The 9 frozen files were applied.
3. `gamewatch/private/evaluate-repair.ts` ran, with the labels file. Result:
   `gamewatch/private/evaluation/EVALUATION-recomputed.json`.

The operator's own `EVALUATION.json` stays on the operator's machine.

The SkillBook's matched-game re-run statistics after the freeze are in the operator's workspace and are not published.
The aggregate numbers above are the agent's own.

## 6. Publication review and redaction

The originals are preserved privately, outside the repository, with SHA-256 manifests:

* `gw1-originals/<time>/` (review evidence and SkillFlow state) on the operator's machine;
* the first redaction pass's originals, also on the operator's machine.

Every published file was reviewed. Two redaction passes were applied. Each one records the original and published
hashes, and the rules applied:

* **Pass 1** (operator's machine, `review/REDACTION_RECORD-1.json`) redacted:
  * absolute balances in the ledger and `meta.json`;
  * the Kane recording session id and the process id;
  * absolute repository and workspace paths in `attempt.json`, `baseline.json` and the GW1 console log.
* **Pass 2** (this review, `review/REDACTION_RECORD-2.json`) found and redacted what pass 1 missed:
  * the **local user-profile path, which contains the account user name**, in `stdout.ndjson` and `stderr.txt`;
  * the Kane local session and evidence-pack ids;
  * the Kane test-manager URL, which carries the account-side project and test-case ids;
  * the absolute path in `repair-console.log`.

  The redaction script now covers all of these (`scripts/gw1-redact.ts`).
* **Pass 3** (video-production housekeeping, `review/REDACTION_RECORD-3.json`): pass 2 had replaced only the
  project and test-case prefix of Kane's `test_url`, so the share path and its share identifier were still published.
  The whole value is now one marker (`scripts/gw1-redact-url.ts`; the rule is also in `scripts/gw1-redact.ts`). Older
  V2/V3 Kane outputs still carry their test URLs; they are hash-locked by their journals and the frozen repair
  baseline, so they are left for an operator decision.
* **Not redacted, on purpose:**
  * credit consumption, estimates, timings, nonces, timestamps and every finding;
  * the approver's first name, as in KS1;
  * the frozen repair output, which contains no private metadata. It cannot be changed without breaking the freeze.
* **Not published:**
  * the 182 baseline file copies, which `export-workspace.ts` reproduces from the commit (§5 checks this hash for hash). Only the build-under-test engine is kept;
  * the agent's raw game files;
  * the SkillFlow state;
  * the operator's private evaluation console.

After pass 2, the published evidence was searched again for email addresses, user names, profile and drive paths,
UUIDs and account URLs. None remain.

## 7. Limitations

* **Single run, small sample:**
  * There was one Kane call, one repair attempt and three planted defects. Nothing here estimates detection or repair
    rates.
  * The matched games are 16 per build. The 10/16 first-mover result is not statistically significant (p = 0.45), and
    no balance claim rests on it.
* **Kane's coverage:**
  * Kane opened 3 of 22 case pages and no match page in 43 actions. It had 80 steps and did not use them.
  * Kane missed B1 because it never looked at the evidence that shows it, not because that evidence was missing.
  * Kane's summary and clean report contradict its own findings (§3.3), so a pipeline must read the forms, not the
    summary.
* **The blind setup is input-blind, not fully isolated:**
  * The workspace had no ground truth, no history, no experiment documents, no clean-engine hashes and no build labels.
  * The agent was told that a QA reviewer had looked at "a build", and that findings may be wrong or clean.
  * It knew from the brief that it was fixing reported problems. Its brief explicitly invited it to look for problems
    Kane missed, which is how B1 was found.
  * The agent ran on the operator's machine with Claude Code's normal permissions: edits inside the workspace, a short
    allow-list of shell commands, and no web tools. A permitted `node` command could have read files outside the
    workspace. Nothing in its report, its log or its output indicates that it did, but this cannot be proven.
  * The parent folder also held the operator's repository.
* **The evaluation shares tools with the evidence.** The probes and the scripted scenarios are written by the same
  author as the plants. The agent's B1 discovery used the scenario `shield-human`, which was written so that every
  rule is exercised on both sides. A game without such symmetric scripts would give a reviewer less to go on.
* **Kane saw build labels** (QX-41, QX-73) and could compare builds. That is an easier task than reviewing one build
  alone.
* **Costs:** Kane's balance delta and its own `credits_consumed` differ by 6 %. kane-cli 0.10.4 has no credit limit.
* **Authorship:** the game, GameWatch, SkillFlow, the plants and the evaluation were all written by the same team with
  Claude Code. The coding agent was a separate Claude Code instance that saw only the workspace.

## 8. Where everything is

* Kane review:
  * `evidence/gamewatch/review/`: findings (`notes.ndjson`, `kane-findings.ndjson`), ledger, approval;
  * `run/GW1-blind-review/`: arguments, raw Kane output, meta;
  * the redaction records.
* Repair: `evidence/gamewatch/repair/`. It holds `attempt.json`, `FREEZE.json`, `baseline.json`,
  `baseline-files/server/v6/engine.ts`, and `output/` (the agent's report, code, tests, logs and bundles).
* SkillBook outputs: `evidence/gamewatch/qa/` (discovery, gaps, porter, balance, audit, regression, `QA_REPORT.md`).
* Private evaluation (operator only): `gamewatch/private/` (manifest, probes, `evaluate-repair.ts`,
  `evaluation/labels.json`, `evaluation/EVALUATION-recomputed.json`).
* Corrections: `evidence/corrections/gw1-manual-run-crlf.json`.

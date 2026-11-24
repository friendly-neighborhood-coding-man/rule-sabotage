# Reproducible demonstration (no paid call, no agent)

Every step below runs on a fresh checkout, with Node.js ≥ 22.10 and Python ≥ 3.9 and nothing else. None of them calls
Kane or a coding agent. The GW1 Kane call and the one repair attempt are recorded results. GameWatch refuses to make
either one again: the Kane runner reports the recorded run for `GW1-blind-review`, and the fix step refuses a second
attempt.

```
git clone https://github.com/friendly-neighborhood-coding-man/rule-sabotage && cd rule-sabotage   # §5 assumes this folder name
git checkout claude/project-thread-1a20hc
```

## 1. The SkillBook up to the paid gate (about 1 minute)

```
python gamewatch/vendor/verify.py
python gamewatch/vendor/skillflow/runner.py run gamewatch/skillbook/book.json --state .gw-demo --workdir . \
  --var out=evidence/gamewatch/qa-demo --var build=QX-73 --var reference=QX-41 --var workspace=../gw-demo-workspace
python gamewatch/vendor/skillflow/runner.py status --state .gw-demo
```

Expected: exit 2, `needs-authorization` at `analyze-kane-review`. The run has checked that all 15 rules are exercised
on both builds, rebuilt the 56 evidence pages byte for byte, found no leaks on them, and confirmed that the frozen
inputs are unchanged. `evidence/gamewatch/qa-demo/balance.json` is GameWatch's own statistics, not Kane's.

## 2. The evidence Kane saw

```
node --experimental-strip-types gamewatch/kane/serve.ts --notes demo-notes.ndjson
```

Open http://127.0.0.1:3210/. Kane's actual path through the site was: index, C-0ad0c4 and C-757669 (both QX-41),
C-9fc650 (QX-73), then the report form. Kane's three findings are in `evidence/gamewatch/review/notes.ndjson`, and its
raw output is in `review/run/GW1-blind-review/stdout.ndjson`.

## 3. The defects are real and the referee does not hide them

```
npm run gamewatch:groundtruth          # 8/8: clean build shows none, each single-defect build shows its own
npm run test:v6                        # 42/42 on the playable game (server/v6 is the clean baseline)
```

## 4. The repair output is frozen and unchanged

```
node --experimental-strip-types --no-warnings gamewatch/skillbook/steps/repair-freeze.ts verify    # 9 files, ok
git diff --no-index evidence/gamewatch/repair/baseline-files/server/v6/engine.ts \
                    evidence/gamewatch/repair/output/server/v6/engine.ts                           # the 3-line fix
```

The agent's own account is in `evidence/gamewatch/repair/output/CLOSED_LOOP_REPORT.md`.

## 5. Recompute the independent evaluation (about 5 minutes)

The agent's workspace was exported from commit `fa8c77c`, so export it again from that commit, then apply the
frozen output:

```
git worktree add ../gw-at-fa8c77c fa8c77c
(cd ../gw-at-fa8c77c && node --experimental-strip-types --no-warnings gamewatch/closed-loop/export-workspace.ts QX-73 \
  ../gw-recompute ../rule-sabotage/evidence/gamewatch/review/kane-findings.ndjson)
cp -r evidence/gamewatch/repair/output/. ../gw-recompute/
node --experimental-strip-types --no-warnings gamewatch/private/evaluate-repair.ts \
  gamewatch/private/evaluation/labels.json --workspace ../gw-recompute
```

Expected: B1, B2 and B3 fixed; controls unchanged; V6 tests 42/42; the agent's tests 7/7. Summary: detected B2 and
B3, missed B1, repaired B1, B2 and B3, nothing remaining. The output goes to `gamewatch/private/evaluation/EVALUATION.json`.

The exported workspace is exactly what the agent received. To check, compare it with
`evidence/gamewatch/repair/baseline.json` (2431 files, LF-normalised SHA-256) **before** the `cp` step. After the `cp`,
only `server/v6/engine.ts` differs, because the frozen fix has been applied.

To see the agent's tests fail on the build as received, swap the original engine into the workspace and run them:

```
cp evidence/gamewatch/repair/baseline-files/server/v6/engine.ts ../gw-recompute/server/v6/engine.ts
(cd ../gw-recompute && node --experimental-strip-types --no-warnings --test tests/closed-loop.test.ts)   # 7 of 7 fail
```

## 6. Clean up

`.gw-demo/`, `evidence/gamewatch/qa-demo/`, `demo-notes.ndjson`, `server/v6-build-*/` and the sibling folders are
all local. Remove them when you are done (`git worktree remove ../gw-at-fa8c77c` for the worktree).

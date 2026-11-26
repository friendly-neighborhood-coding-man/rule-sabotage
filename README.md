# GW2 matched comparison: operator script

This branch holds only the Windows operator script for the GW2 matched comparison. It is kept apart from the research branches on purpose, so editing this script cannot change the tree that it checks. The branch contains no research code, credentials, logs, authorizations or results.

| File | What it is |
|---|---|
| `gw2-matched-run.ps1` | The operator script (LF line endings, ASCII) |
| `gw2-matched-run.ps1.sha256` | Its SHA-256 checksum |
| `.gitattributes` | `* -text`, so git never converts line endings and the bytes stay exact |

## Pinned commits

| | Commit | Branch | State |
|---|---|---|---|
| Reviewed | `8f810711d8860c22ff0ae1eb12ff7aad06a6b93c` | `claude/gw2-matched` (PR #33) | Both gates disabled. The full regression suite runs here. Windows validation passed |
| Candidate | `f578767e8200cbcd6e820c21ff798c72f50fff95` | `claude/gw2-matched-candidate` | Reviewed plus exactly three gate lines: `PAID_RESEARCH_EXECUTION = 'per-run-approval'`, `PAID_RESEARCH_SCOPE = /^GW2-M(0[1-9]\|10)-P[12]$/`, `AGENT_FEEDBACK_ENABLED = true`. Paid calls run only here, one per locally typed `RUN <runId>` |

SHA-256 of `gw2-matched-run.ps1`: `8abc66fd6b3efd54d74c456274f14b5e1696a436a14f899976587b7e5f4fec8a`

## Verify the download

```powershell
(Get-FileHash .\gw2-matched-run.ps1 -Algorithm SHA256).Hash.ToLower()
# must print 8abc66fd6b3efd54d74c456274f14b5e1696a436a14f899976587b7e5f4fec8a
```

Download the script with the raw URL. Do not copy it through an editor, because a CRLF conversion changes the checksum.

## Setup (once)

The script never creates, deletes or overwrites worktrees. Create both worktrees as fresh detached checkouts:

```powershell
git -C D:\Rule_Sabotage\rule-sabotage-live fetch origin claude/gw2-matched claude/gw2-matched-candidate
git -C D:\Rule_Sabotage\rule-sabotage-live worktree add --detach D:\Rule_Sabotage\gw2-matched-reviewed 8f810711d8860c22ff0ae1eb12ff7aad06a6b93c
git -C D:\Rule_Sabotage\rule-sabotage-live worktree add --detach D:\Rule_Sabotage\gw2-matched-live     f578767e8200cbcd6e820c21ff798c72f50fff95
```

## Modes

| Mode | Command | Paid calls |
|---|---|---|
| Dry run | `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -DryRun` | None. Runs the regression suite at the reviewed commit, then the generation-1 dry run with test doubles |
| Experiment | `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -AuthorizationText "<written authorization>"` | One per typed `RUN <runId>`, 20 in total, strictly in schedule order. Re-run the same command to continue after any pause; a started call is never repeated |
| Evaluation only | `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -EvaluateOnly` | None. Only after a terminal stop; it opens the held-out evidence once, after you type `EVALUATE` |

Limits, unchanged:
* phase 1 is `--max-steps 80`, timeout 2,700 s, ceiling 300 credits;
* phase 2 is `--max-steps 40`, timeout 1,350 s, ceiling 150 credits;
* the research threshold is 4,000 credits cumulative;
* a call starts only if the balance is at least 1.5 × its phase ceiling;
* there are no credit purchases and no retries.

The ceilings are decision points, not a hard cap. The full procedure is in `docs/gw2/MATCHED_EXECUTION_PROCEDURE.md` on the research branch.

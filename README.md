# GW2 matched comparison: operator script

This branch holds only the Windows operator script for the GW2 matched comparison. It is kept apart from the research branch (`claude/gw2-matched`, PR #33) on purpose: editing this script cannot change the tree that it checks. No research code, credentials, logs, authorizations or results are on this branch.

| File | What it is |
|---|---|
| `gw2-matched-run.ps1` | The operator script, byte for byte as reviewed (LF line endings, ASCII) |
| `gw2-matched-run.ps1.sha256` | Its SHA-256 checksum |
| `.gitattributes` | `* -text`, so git never converts line endings and the bytes stay exact |

* Pinned reviewed commit: `$ReviewedHead = '8f810711d8860c22ff0ae1eb12ff7aad06a6b93c'`. Both execution gates are disabled there.
* Candidate commit: `$CandidateHead = 'PENDING_CANDIDATE_HEAD'`. The paid experiment mode refuses to run until the candidate commit has been reviewed and filled in.
* SHA-256: `a3d082ef89c74edde9b1042697bc84fcb3296d0ff9a24a185779f9541361525d`

## Verify the download

```powershell
(Get-FileHash .\gw2-matched-run.ps1 -Algorithm SHA256).Hash.ToLower()
# must print a3d082ef89c74edde9b1042697bc84fcb3296d0ff9a24a185779f9541361525d
```

Download it with the raw URL, or with `git show` on this branch. Do not copy it through an editor, because a CRLF conversion changes the checksum.

## Use (Windows, PowerShell 7)

Setup is done once. The script never creates, deletes or overwrites worktrees:

```powershell
git -C D:\Rule_Sabotage\rule-sabotage-live fetch origin claude/gw2-matched
git -C D:\Rule_Sabotage\rule-sabotage-live worktree add --detach D:\Rule_Sabotage\gw2-matched-reviewed 8f810711d8860c22ff0ae1eb12ff7aad06a6b93c
```

| Mode | Command | Paid calls |
|---|---|---|
| Dry run (run this first) | `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -DryRun` | None. Runs the regression suite at the reviewed commit, then the generation-1 dry run with test doubles |
| Evaluation only | `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -EvaluateOnly` | None. Only after a terminal stop; it opens the held-out evidence once after you type `EVALUATE` |
| Experiment | `pwsh -File gw2-matched-run.ps1 -Operator "<name>" -AuthorizationText "<written authorization>"` | Yes, one per typed `RUN <runId>`. Not authorized: it needs the reviewed candidate commit and written authorization |

The full procedure is in `docs/gw2/MATCHED_EXECUTION_PROCEDURE.md` on the research branch.

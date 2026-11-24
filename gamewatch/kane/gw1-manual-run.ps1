# GW1 manual run: ONE paid Kane objective-mode blind review (GameWatch), run by the account owner.
# Adapted from ks1-manual-run.ps1 (the procedure used for the KS1 call).
#
# NOT YET AUTHORIZED. Before running, the operator fills in $ApprovedBy / $ApprovedAt below from the project thread
# message that authorizes GW1, and $ExpectedHead with the reviewed commit. The script refuses while they are PENDING.
# The 80-credit operating ceiling is NOT a provider-enforced spending limit: actual use may exceed it.
#
# What this script does, in order:
#   1. Pre-checks (stop before any change if one fails): repository and commit, case files present,
#      gate currently disabled (exactly one matching line), no earlier GW1 approval / ledger / run directory.
#   2. Writes the single-use approval record evidence\v6\kane-preflight\approval.json.
#   3. try:     enables the gate on that one line only, sets the run token for this process only, creates the SkillFlow
#               authorization kane-paid and resumes the GameWatch SkillBook run ONCE: its Kane task runs
#               gamewatch/kane/run.ts --execute EXACTLY ONCE (no retry), then the run continues until the next
#               authorization stop (the coding agent).
#      finally: restores the exact disabled line, clears the token, even if the run failed or was interrupted.
#   4. Final checks: gate disabled, token cleared; prints where the evidence is and the ledger's credit use.
#
# Evidence kept (all in evidence\gamewatch\review\): ledger.ndjson (balance before/after, actual use, outcome),
# run\GW1-blind-review\ (args.json, stdout.ndjson = raw Kane output, stderr.txt, meta.json), notes.ndjson (findings),
# gw1-console.log, approval.json; SkillFlow log and checkpoints in .gw-run\.
# Nothing is deleted. No git commit is made. Run from PowerShell 7:  pwsh -File gamewatch\kane\gw1-manual-run.ps1

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false   # a non-zero runner exit must not skip the evidence summary
Set-StrictMode -Version Latest

$Repo        = 'D:\Rule_Sabotage\rule-sabotage-live'
$ApprovedBy  = 'PENDING'   # e.g. 'Eric (account owner), project thread message cmsg_...'
$ApprovedAt  = 'PENDING'   # ISO time of that message
$ExpectedHead = 'PENDING'   # PR #21 head reviewed for this run
$RunId       = 'GW1-blind-review'
$GateFile    = Join-Path $Repo 'server\balance\v4\kanebudget.ts'
$GateOff     = "export const PAID_RESEARCH_EXECUTION: 'disabled' | 'per-run-approval' = 'disabled';"
$GateOn      = "export const PAID_RESEARCH_EXECUTION: 'disabled' | 'per-run-approval' = 'per-run-approval';"
$CaseDir     = Join-Path $Repo 'evidence\gamewatch\review'
$State       = Join-Path $Repo '.gw-run'
$Approval    = Join-Path $CaseDir 'approval.json'
$Ledger      = Join-Path $CaseDir 'ledger.ndjson'
$RunDir      = Join-Path $CaseDir "run\$RunId"
$ConsoleLog  = Join-Path $CaseDir 'gw1-console.log'
$Utf8NoBom   = New-Object System.Text.UTF8Encoding($false)

function Stop-Run([string]$why) { Write-Host "STOPPED before any change: $why" -ForegroundColor Red; exit 1 }
function Count-Exact([string]$text, [string]$line) { ([regex]::Matches($text, [regex]::Escape($line))).Count }

# ---------------------------------------------------------------- 1. pre-checks (no change yet)
if ($ApprovedBy -eq 'PENDING' -or $ApprovedAt -eq 'PENDING' -or $ExpectedHead -eq 'PENDING') { Stop-Run 'approval fields are PENDING: GW1 has not been authorized' }
Set-Location $Repo
$head = (git rev-parse HEAD).Trim()
if ($head -ne $ExpectedHead) { Stop-Run "HEAD is $head, expected $ExpectedHead" }
if ((git status --porcelain -- server/balance/v4/kanebudget.ts gamewatch/kane scripts/kane-single-call.ts)) { Stop-Run 'gate or runner file has local changes' }
if (-not (Test-Path (Join-Path $State 'state.json'))) { Stop-Run 'no GameWatch SkillBook run in .gw-run (run the book first; it stops at the Kane review)' }
& node --experimental-strip-types --no-warnings=ExperimentalWarning gamewatch/kane/plan.ts | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Run 'frozen inputs changed (gamewatch/kane/plan.ts)' }
if (Test-Path $Approval) { Stop-Run 'approval.json already exists (single use)' }
if (Test-Path $Ledger)   { Stop-Run 'ledger.ndjson already exists: an earlier GW1 attempt is recorded' }
if (Test-Path $RunDir)   { Stop-Run 'run directory already exists: an earlier GW1 attempt is recorded' }
$gateText = [IO.File]::ReadAllText($GateFile)
if ((Count-Exact $gateText $GateOff) -ne 1) { Stop-Run 'the disabled gate line is not present exactly once' }
if ((Count-Exact $gateText $GateOn)  -ne 0) { Stop-Run 'the gate is already enabled' }
if ($env:KANE_PAID_RUN_AUTH) { Stop-Run 'KANE_PAID_RUN_AUTH is already set in this shell; open a fresh one' }

# ---------------------------------------------------------------- 2. single-use approval record
$approvalRecord = [ordered]@{
  runId                 = $RunId
  approvedBy            = $ApprovedBy
  approvedAt            = $ApprovedAt
  recordCreatedAt       = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  maxCalls              = 1
  maxSteps              = 25
  ceilingCredits        = 80
  acknowledgesNoHardCap = $true
}
[IO.File]::WriteAllText($Approval, ($approvalRecord | ConvertTo-Json) + "`n", $Utf8NoBom)
Write-Host "Approval record written: $Approval"

# ---------------------------------------------------------------- 3. one run, gate restored in finally
$exitCode = $null
try {
  $enabled = $gateText.Replace($GateOff, $GateOn)          # exactly one occurrence, checked above
  [IO.File]::WriteAllText($GateFile, $enabled, $Utf8NoBom)
  if ((Count-Exact ([IO.File]::ReadAllText($GateFile)) $GateOn) -ne 1) { throw 'gate enable did not apply exactly once' }
  Write-Host 'Gate ENABLED for this run only.' -ForegroundColor Yellow

  $env:KANE_PAID_RUN_AUTH = $RunId                       # this PowerShell process only
  Write-Host "Running the single call ($RunId). No retry will be attempted." -ForegroundColor Yellow
  New-Item -ItemType Directory -Force (Join-Path $State 'authorizations') | Out-Null
  [IO.File]::WriteAllText((Join-Path $State 'authorizations\kane-paid'), "$RunId approved by $ApprovedBy at $ApprovedAt`n", $Utf8NoBom)
  & python gamewatch/vendor/skillflow/runner.py resume --state $State 2>&1 | Tee-Object -FilePath $ConsoleLog
  $exitCode = $LASTEXITCODE
  Write-Host "SkillFlow exit code: $exitCode  (2 = stopped at the next authorization, expected; see .gw-run\log.ndjson for the Kane task's own exit)"
}
finally {
  # Restore the original file content exactly (the disabled line), then clear the token, whatever happened above.
  [IO.File]::WriteAllText($GateFile, $gateText, $Utf8NoBom)
  Remove-Item Env:KANE_PAID_RUN_AUTH -ErrorAction SilentlyContinue
  Write-Host 'Gate restored to disabled; run token cleared.' -ForegroundColor Green
}

# ---------------------------------------------------------------- 4. final checks and evidence summary
$after = [IO.File]::ReadAllText($GateFile)
$gateOk  = ((Count-Exact $after $GateOff) -eq 1) -and ((Count-Exact $after $GateOn) -eq 0)
$tokenOk = -not (Test-Path Env:KANE_PAID_RUN_AUTH)
$diffOk  = -not (git status --porcelain -- server/balance/v4/kanebudget.ts)
Write-Host ("Gate disabled: {0}   token cleared: {1}   gate file identical to the commit: {2}" -f $gateOk, $tokenOk, $diffOk)
if (-not ($gateOk -and $tokenOk -and $diffOk)) { Write-Host 'WARNING: final check failed; inspect server\balance\v4\kanebudget.ts before anything else.' -ForegroundColor Red }

if (Test-Path $Ledger) {
  Write-Host "`nLedger ($Ledger):"
  Get-Content $Ledger | ForEach-Object {
    $e = $_ | ConvertFrom-Json
    if ($e.event -eq 'call-end') { Write-Host ("  call-end: before {0}  after {1}  USED {2} credits  outcome {3}  timedOut {4}  exit {5}" -f $e.detail.before, $e.detail.after, $e.detail.used, $e.detail.outcome, $e.detail.timedOut, $e.detail.exitCode) -ForegroundColor Cyan }
    else { Write-Host ("  {0}: {1}" -f $e.event, ($e.detail | ConvertTo-Json -Compress)) }
  }
} else { Write-Host 'No ledger was written (the run did not reach the gate).' }
if (Test-Path $RunDir) { Write-Host "`nRaw evidence in $RunDir :"; Get-ChildItem $RunDir | ForEach-Object { Write-Host ("  {0}  {1} bytes" -f $_.Name, $_.Length) } }
Write-Host "`nConsole output saved to $ConsoleLog. Do NOT run this script again: one call only (the runner also refuses a second call for this run id)."
Write-Host 'Report the result in the project thread; nothing has been committed.'

# GW2 matched comparison: operator script (Windows, PowerShell 7). Same operational pattern as gw2-p7-run.ps1.
# PREPARED FOR FINAL REVIEW. NOT AUTHORIZED. Kept OUTSIDE the repository on purpose: editing this file cannot change the
# tree that the checks below inspect.
#
# Two commits, checked separately (final preflight, item 6):
#   REVIEWED   both gates closed. The full regression suite (every historical "gate disabled" test included, unchanged)
#              must pass here. Worktree: D:\Rule_Sabotage\gw2-matched-reviewed
#   CANDIDATE  REVIEWED + exactly three line changes (PAID_RESEARCH_EXECUTION, PAID_RESEARCH_SCOPE,
#              AGENT_FEEDBACK_ENABLED) and nothing else, verified line by line by `cli.ts candidate-check`. The paid
#              calls run only here. Worktree: D:\Rule_Sabotage\gw2-matched-live
# The historical tests are never edited to pass on the candidate: they run on REVIEWED, and the candidate is checked
# by its exact diff against REVIEWED.
#
# Modes
#   -DryRun   NON-PAID. Needs only the reviewed worktree. Runs the regression suite there, then the complete dry run on
#             generation 1 (the development dataset) with test doubles into NEW directories. No kane-cli, no gate.
#   -EvaluateOnly  NON-PAID. Only for an experiment that is TERMINALLY STOPPED (an experiment-stopped event in the
#             external ledger). Never runs `next` or `run`, never calls kane-cli, writes no approval or authorization and
#             never sets KANE_PAID_RUN_AUTH. It checks the candidate worktree and its exact diff, re-verifies the
#             pre-registration and the integrity of every recorded transaction (failed ones included), shows the
#             operational status, and opens the held-out evidence ONCE only after you type EVALUATE. It then confirms
#             that no call started while it ran and packs the results.
#   (default) the experiment: 20 paid calls, one per approval, in the pre-registered order.
#
# Setup (once; nothing existing is deleted or overwritten):
#   git -C D:\Rule_Sabotage\rule-sabotage-live fetch origin claude/gw2-matched
#   git -C D:\Rule_Sabotage\rule-sabotage-live worktree add --detach D:\Rule_Sabotage\gw2-matched-reviewed <ReviewedHead>
#   git -C D:\Rule_Sabotage\rule-sabotage-live worktree add --detach D:\Rule_Sabotage\gw2-matched-live     <CandidateHead>
#   pwsh -File D:\Rule_Sabotage\gw2-matched-run.ps1 -Operator "Eric" -DryRun
#   pwsh -File D:\Rule_Sabotage\gw2-matched-run.ps1 -Operator "Eric" -AuthorizationText "<the written authorization>"
#   pwsh -File D:\Rule_Sabotage\gw2-matched-run.ps1 -Operator "Eric" -EvaluateOnly     (only after a terminal stop)
# Re-running after an interruption continues from the external ledger. A started call is never repeated, and any stop,
# failure or integrity problem ends the experiment (report it in the project thread; do not work around it).
#
# Between calls you see OPERATIONAL status only (exit, timeout, run_end present/valid, steps, credits, frozen). Do not
# open submissions, revision pages, raw stdout or Kane's summary until every call is frozen.

param(
  [Parameter(Mandatory = $true)][string]$Operator,
  [string]$AuthorizationText = '',
  [switch]$DryRun,
  [switch]$EvaluateOnly,
  [string]$Repo     = 'D:\Rule_Sabotage\gw2-matched-live',      # CANDIDATE worktree (paid calls run here)
  [string]$Reviewed = 'D:\Rule_Sabotage\gw2-matched-reviewed',  # REVIEWED worktree (regression suite runs here)
  [string]$Record   = 'D:\Rule_Sabotage\gw2-matched-record',    # external record, OUTSIDE both worktrees
  [string]$Run      = 'D:\Rule_Sabotage\gw2-matched-run'        # run artifacts, OUTSIDE both worktrees
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version Latest

# ---------------------------------------------------------------- fixed for this experiment
$Branch        = 'claude/gw2-matched'
$ReviewedHead  = '8f810711d8860c22ff0ae1eb12ff7aad06a6b93c'   # proposed reviewed commit (both gates closed); confirm at final review
$CandidateHead = 'PENDING_CANDIDATE_HEAD'   # filled in after the candidate commit (gate lines only) is reviewed
$CliVersion    = '0.10.4'
$Threshold     = 4000
$Ceiling       = @{ 1 = 300; 2 = 150 }
$MaxSteps      = @{ 1 = 80;  2 = 40 }
$FeedbackRuns  = @(@('GW2-M02-P2','M02'), @('GW2-M03-P2','M03'), @('GW2-M06-P2','M06'), @('GW2-M08-P2','M08'), @('GW2-M10-P2','M10'))
$Node          = @('node', '--experimental-strip-types', '--no-warnings')
$Cli           = 'gamewatch/gw2/matched/cli.ts'
$Utf8NoBom     = New-Object System.Text.UTF8Encoding($false)
$Guarded       = @('server', 'scripts', 'gamewatch', 'evidence/gw2', 'docs/gw2', 'tests', 'package.json')

function Stop-Exp([string]$why) { Write-Host "STOPPED: $why" -ForegroundColor Red; Write-Host 'Nothing is re-run. Report this message in the project thread (GW2_MATCHED_STOPPED if any paid call has happened).'; exit 1 }
function Now-Iso { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Invoke-Cli([string]$dir, [string[]]$cliArgs) {
  Push-Location $dir
  try { $out = (& $Node[0] $Node[1..2] $Cli @cliArgs 2>&1) -join "`n"; $code = $LASTEXITCODE } finally { Pop-Location }
  return @{ code = $code; text = $out }
}
function Cli-Json([string]$dir, [string[]]$cliArgs, [string]$what) {
  $r = Invoke-Cli $dir $cliArgs
  if ($r.code -ne 0) { Stop-Exp "$what failed (exit $($r.code)):`n$($r.text)" }
  return ($r.text | ConvertFrom-Json)
}
function Assert-Worktree([string]$dir, [string]$head, [string]$label) {
  if ($head -like 'PENDING*') { Stop-Exp "$label head is not filled in ($head); this script is not authorized for that step yet" }
  if (-not (Test-Path (Join-Path $dir '.git'))) { Stop-Exp "$label worktree $dir does not exist (see Setup at the top; nothing is created or deleted by this script)" }
  Push-Location $dir
  try {
    $h = (git rev-parse HEAD).Trim()
    if ($h -ne $head) { Stop-Exp "$label HEAD is $h, expected $head (use a fresh worktree: git worktree add --detach <dir> $head)" }
    $dirty = git status --porcelain --untracked-files=no -- @Guarded
    if ($dirty) { Stop-Exp "$label has local changes:`n$($dirty -join "`n")" }
    $crlf = @(git ls-files --eol | Where-Object { $_ -match '^i/lf\s+w/crlf' })
    if ($crlf.Count) { Stop-Exp "$label has $($crlf.Count) tracked LF files with CRLF in the working tree (e.g. $($crlf[0])); create a fresh worktree" }
  } finally { Pop-Location }
}
function Assert-Outside([string]$p) {
  $abs = [IO.Path]::GetFullPath($p)
  foreach ($w in @($Repo, $Reviewed)) { $wa = [IO.Path]::GetFullPath($w).TrimEnd('\') + '\'; if ($abs.StartsWith($wa, [StringComparison]::OrdinalIgnoreCase) -or $abs -eq $wa.TrimEnd('\')) { Stop-Exp "$p must be outside the worktree $w" } }
}
function Run-Regression {
  Write-Host "Disabled-gate regression at the REVIEWED commit ($ReviewedHead) ..."
  Push-Location $Reviewed
  try {
    $kb = [IO.File]::ReadAllText((Join-Path $Reviewed 'server\balance\v4\kanebudget.ts'))
    if (-not $kb.Contains("export const PAID_RESEARCH_EXECUTION: 'disabled' | 'per-run-approval' = 'disabled';")) { Stop-Exp 'the reviewed commit does not have the paid-call gate disabled' }
    & npm run test:gw2;                  if ($LASTEXITCODE -ne 0) { Stop-Exp 'npm run test:gw2 failed at the reviewed commit' }
    & npm run gw2:verify;                if ($LASTEXITCODE -ne 0) { Stop-Exp 'npm run gw2:verify failed at the reviewed commit' }
    & python gamewatch/vendor/verify.py; if ($LASTEXITCODE -ne 0) { Stop-Exp 'the vendored SkillFlow runner does not match its pinned checksum' }
  } finally { Pop-Location }
}
function Get-Balance {
  $out = (& kane-cli balance 2>&1) -join "`n"
  $m = [regex]::Matches($out, '(?m)^\s*Available credits:\s+(\d+(?:\.\d+)?)\s*$')
  if ($m.Count -ne 1) { return $null }
  return [double]$m[0].Groups[1].Value
}

function Pack-Results {
  $zip = Join-Path $Record 'gw2-matched-results.zip'
  if (Test-Path $zip) { $zip = Join-Path $Record ("gw2-matched-results-" + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.zip') }
  $staging = Join-Path $env:TEMP ("gw2-matched-pack-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force (Join-Path $staging 'run'), (Join-Path $staging 'external-record') | Out-Null
  Copy-Item -Recurse (Join-Path $Run '*') (Join-Path $staging 'run')
  Get-ChildItem $Record -Exclude '*.zip' | Copy-Item -Recurse -Destination (Join-Path $staging 'external-record')
  @{ candidate = $CandidateHead; reviewed = $ReviewedHead; operator = $Operator; packedAt = (Now-Iso); evaluateOnly = [bool]$EvaluateOnly } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $staging 'PACK.json')
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip
  Remove-Item -Recurse -Force $staging   # the temporary staging copy only; the record and the run are untouched
  Write-Host "Upload this file in the project thread: $zip"
  Write-Host 'Raw files (with your user path and Kane session ids) stay on this machine; the repository copy is redacted before commit.'
}

# ---------------------------------------------------------------- 1. tools and locations (no change yet)
if ($DryRun -and $EvaluateOnly) { Stop-Exp '-DryRun and -EvaluateOnly cannot be combined' }
foreach ($tool in 'git', 'node', 'npm', 'python') { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Exp "$tool not found on PATH" } }
$nv = (& node --version).Trim().TrimStart('v').Split('.')
if ([int]$nv[0] -lt 22 -or ([int]$nv[0] -eq 22 -and [int]$nv[1] -lt 10)) { Stop-Exp "Node $((& node --version).Trim()) is too old (need >= 22.10)" }
if ($env:KANE_PAID_RUN_AUTH) { Stop-Exp 'KANE_PAID_RUN_AUTH is already set in this shell; open a fresh one' }
if (Test-Path Env:KANE_CLI) { Stop-Exp 'KANE_CLI is set; unset it so the real kane-cli on PATH is used' }

# ---------------------------------------------------------------- DRY RUN (non-paid, generation 1 only)
if ($DryRun) {
  Assert-Worktree $Reviewed $ReviewedHead 'reviewed'
  Run-Regression
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $dry = "D:\Rule_Sabotage\gw2-matched-dryrun-$stamp"
  Assert-Outside $dry
  if (Test-Path $dry) { Stop-Exp "$dry exists (nothing is overwritten)" }
  Write-Host "Non-paid dry run on generation 1 into $dry (test doubles; no kane-cli; no gate) ..."
  Push-Location $Reviewed
  try { $out = (& $Node[0] $Node[1..2] gamewatch/gw2/matched/dry-run.ts --record "$dry\record" --run "$dry\run" --reviewed $ReviewedHead 2>&1) -join "`n"; $code = $LASTEXITCODE } finally { Pop-Location }
  New-Item -ItemType Directory -Force $dry | Out-Null
  [IO.File]::WriteAllText((Join-Path $dry 'dry-run.json'), $out + "`n", $Utf8NoBom)
  if ($code -ne 0) { Stop-Exp "the dry run failed (exit $code); see $dry\dry-run.json" }
  $d = $out | ConvertFrom-Json
  Write-Host ("Dry run: evidence {0}, {1} calls, stopped: {2}, integrity problems: {3}" -f $d.evidence, $d.calls, $d.stopped, @($d.integrityProblems).Count)
  foreach ($s in $d.evaluation.sessions) { Write-Host ("  {0} {1,-9} complete={2} accuracyChange={3} coverageChange={4} | {5}" -f $s.session, $s.arm, $s.complete, $s.heldout.change.accuracy, $s.heldout.change.coverage, $s.attribution) }
  Write-Host "Dry run complete. Upload $dry\dry-run.json in the project thread." -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- EVALUATION ONLY (non-paid; terminally stopped experiments)
if ($EvaluateOnly) {
  if ($AuthorizationText.Trim()) { Stop-Exp '-EvaluateOnly takes no -AuthorizationText (it authorizes nothing)' }
  Assert-Worktree $Repo $CandidateHead 'candidate'
  Assert-Outside $Record; Assert-Outside $Run
  if (-not (Test-Path (Join-Path $Record 'execution-ledger.ndjson'))) { Stop-Exp "$Record has no execution ledger; there is nothing to evaluate" }
  if (Test-Path (Join-Path $Run 'EVALUATION.json')) { Stop-Exp "$Run\EVALUATION.json exists; the held-out evidence is opened only once" }
  $cc = Cli-Json $Repo @('candidate-check', '--reviewed', $ReviewedHead) 'the enabled-candidate check'
  $ops = Cli-Json $Repo @('ops-status', '--record', $Record) 'ops-status'
  if (-not $ops.ledgerOk) { Stop-Exp 'the external ledger does not verify' }
  if (-not @($ops.stopped).Count) { Stop-Exp 'the experiment is not stopped; -EvaluateOnly is only for a terminally stopped experiment (run the normal mode)' }
  $ver = Cli-Json $Repo @('verify', '--record', $Record, '--run', $Run) 'the pre-registration and integrity check'
  if ($ver.commit.head -ne $CandidateHead -or $ver.commit.reviewed -ne $ReviewedHead) { Stop-Exp 'the pre-registration binds other commits than this script' }
  $startsBefore = @(Get-Content (Join-Path $Record 'execution-ledger.ndjson') | Where-Object { $_ -match '"event":"call-start"' }).Count
  Write-Host "`nEVALUATION ONLY. No call will start; kane-cli is not used." -ForegroundColor Cyan
  Write-Host "Stopped: $((@($ops.stopped) | ConvertTo-Json -Compress))"
  foreach ($f in @($ops.failed)) { Write-Host ("  failed {0} at {1}: {2}" -f $f.runId, $f.stage, $f.error) -ForegroundColor Yellow }
  foreach ($c in @($ops.calls)) { Write-Host ("  {0} exit={1} timedOut={2} runEnd={3}/{4} steps={5} used={6} {7} frozen={8}" -f $c.runId, $c.exitCode, $c.timedOut, $c.runEndPresent, $c.runEndValid, $c.steps, $c.used, $c.outcome, $c.frozen) }
  Write-Host "Research spend: $($ops.cumulativeResearchCredits). Integrity holds. Sessions with a failed call or without Freeze-2 are reported incomplete; their revision measures are unavailable."
  $answer = Read-Host 'Type EVALUATE to open the final held-out evidence ONCE now (anything else leaves it closed)'
  if ($answer -ne 'EVALUATE') { Write-Host 'The held-out evidence stays closed. Nothing was changed.'; exit 0 }
  $null = Cli-Json $Repo @('evaluate', '--record', $Record, '--run', $Run) 'the single evaluation'
  $startsAfter = @(Get-Content (Join-Path $Record 'execution-ledger.ndjson') | Where-Object { $_ -match '"event":"call-start"' }).Count
  if ($startsAfter -ne $startsBefore) { Stop-Exp "call-start count changed during evaluation ($startsBefore -> $startsAfter); report this" }
  Write-Host "Written: $Run\EVALUATION.json (no call started: $startsAfter call-start events before and after)"
  Pack-Results
  exit 0
}

# ---------------------------------------------------------------- 2. EXPERIMENT: reviewed regression + candidate checks
if (-not $AuthorizationText.Trim()) { Stop-Exp 'pass -AuthorizationText with the written operator authorization of the matched comparison' }
if (-not (Get-Command kane-cli -ErrorAction SilentlyContinue)) { Stop-Exp 'kane-cli not found on PATH' }
$v = ((& kane-cli --version 2>&1) -join "`n")
if (-not ([regex]::IsMatch($v, "(?m)^\s*$([regex]::Escape($CliVersion))\s*$"))) { Stop-Exp "kane-cli --version did not print exactly ${CliVersion}:`n$v" }
Assert-Worktree $Reviewed $ReviewedHead 'reviewed'
Assert-Worktree $Repo $CandidateHead 'candidate'
Assert-Outside $Record; Assert-Outside $Run
$marker = Join-Path $Record "regression-$ReviewedHead.ok"
if (-not (Test-Path $marker)) { Run-Regression }
$cc = Cli-Json $Repo @('candidate-check', '--reviewed', $ReviewedHead) 'the enabled-candidate check'
Write-Host "Candidate $($cc.head) = reviewed $($cc.reviewed) + gate lines only (changed: $($cc.changed -join ', '))."
Push-Location $Repo
try { & npm run gw2:verify; if ($LASTEXITCODE -ne 0) { Stop-Exp 'npm run gw2:verify failed at the candidate commit' }
      & python gamewatch/vendor/verify.py; if ($LASTEXITCODE -ne 0) { Stop-Exp 'vendored SkillFlow mismatch at the candidate commit' } } finally { Pop-Location }

# ---------------------------------------------------------------- 3. pre-registration (once) and feedback authorizations
$ledger = Join-Path $Record 'execution-ledger.ndjson'
if (-not (Test-Path $ledger)) {
  if ((Test-Path $Run) -and @(Get-ChildItem $Run -Force).Count) { Stop-Exp "$Run is not empty but the record has no ledger; move it aside (keep it) and report" }
  New-Item -ItemType Directory -Force $Record, $Run | Out-Null
  Write-Host 'Pre-registering (binds the evidence manifests, the complete execution dependency set, both commits and the schedule) ...'
  $null = Cli-Json $Repo @('preregister', '--record', $Record, '--reviewed', $ReviewedHead, '--commit', $CandidateHead) 'preregister'
}
New-Item -ItemType Directory -Force $marker | Out-Null
$ver = Cli-Json $Repo @('verify', '--record', $Record, '--run', $Run) 'the pre-registration and integrity check'
if ($ver.commit.head -ne $CandidateHead -or $ver.commit.reviewed -ne $ReviewedHead) { Stop-Exp 'the pre-registration binds other commits than this script' }
$authDir = Join-Path $Run 'authorizations'; New-Item -ItemType Directory -Force $authDir | Out-Null
foreach ($f in $FeedbackRuns) {
  $file = Join-Path $authDir "$($f[0]).json"
  if (Test-Path $file) { continue }   # written once; never overwritten
  $a = [ordered]@{ runId = $f[0]; session = $f[1]; arm = 'treatment'; phase = 2; preregSha256 = $ver.preregSha256; operatorAuthorization = "$AuthorizationText (operator $Operator, $(Now-Iso))" }
  [IO.File]::WriteAllText($file, ($a | ConvertTo-Json) + "`n", $Utf8NoBom)
}

# ---------------------------------------------------------------- 4. the calls, one per approval, strictly in order
$apprDir = Join-Path $Run 'approvals'; New-Item -ItemType Directory -Force $apprDir | Out-Null
for ($i = 0; $i -lt 21; $i++) {
  $next = Cli-Json $Repo @('next', '--record', $Record, '--run', $Run) 'the next-call check (stop, incomplete transaction or integrity)'
  if ($null -eq $next.PSObject.Properties['runId']) { break }
  $runId = $next.runId; $phase = [int]$next.phase
  $ops = Cli-Json $Repo @('ops-status', '--record', $Record) 'ops-status'
  Write-Host "`n=== $runId (session $($next.session), arm $($next.arm), phase $phase) ===" -ForegroundColor Cyan
  foreach ($c in @($ops.calls)) { Write-Host ("  {0} exit={1} timedOut={2} runEnd={3}/{4} steps={5} used={6} {7} frozen={8}" -f $c.runId, $c.exitCode, $c.timedOut, $c.runEndPresent, $c.runEndValid, $c.steps, $c.used, $c.outcome, $c.frozen) }
  $cum = $ops.cumulativeResearchCredits
  if ($null -eq $cum) { Stop-Exp 'cumulative research spend is unknown' }
  if ([double]$cum + $Ceiling[$phase] -gt $Threshold) { Stop-Exp "cumulative $cum + ceiling $($Ceiling[$phase]) would exceed the $Threshold-credit threshold" }
  if (Test-Path (Join-Path $apprDir "$runId.json")) { Stop-Exp "an approval for $runId already exists; a started call is never repeated" }
  $started = @($ops.calls | ForEach-Object { $_.runId })
  $others = @(Get-ChildItem -ErrorAction SilentlyContinue $apprDir -Filter *.json | Where-Object { $started -notcontains $_.BaseName })
  if ($others.Count) { Stop-Exp "another approval is active ($($others.Name -join ', ')); approvals are activated one at a time" }
  $bal = Get-Balance
  if ($null -eq $bal) { Stop-Exp 'kane-cli balance could not be read' }
  if ($bal -lt 1.5 * $Ceiling[$phase]) { Stop-Exp "balance $bal is below 1.5 x the phase-$phase ceiling ($(1.5 * $Ceiling[$phase])); no credit purchases" }
  Write-Host ("Balance {0}; research spend so far {1}; one call, up to {2} steps; ceiling {3} (not a cap); no retry." -f $bal, $cum, $MaxSteps[$phase], $Ceiling[$phase])
  $answer = Read-Host "Type RUN $runId to approve and start this call now (anything else stops)"
  if ($answer -ne "RUN $runId") { Stop-Exp "$runId not approved (no paid call made for it)" }
  $approval = [ordered]@{ runId = $runId; approvedBy = $Operator; approvedAt = (Now-Iso); maxCalls = 1; maxSteps = $MaxSteps[$phase]; ceilingCredits = $Ceiling[$phase]; acknowledgesNoHardCap = $true }
  [IO.File]::WriteAllText((Join-Path $apprDir "$runId.json"), ($approval | ConvertTo-Json) + "`n", $Utf8NoBom)
  $log = Join-Path $Record "console-$runId.log"; $code = $null
  Push-Location $Repo
  try {
    $env:KANE_PAID_RUN_AUTH = $runId   # this process only, this call only
    & $Node[0] $Node[1..2] $Cli run --record $Record --run $Run 2>&1 | Tee-Object -FilePath $log
    $code = $LASTEXITCODE
  } finally { Remove-Item Env:KANE_PAID_RUN_AUTH -ErrorAction SilentlyContinue; Pop-Location }
  $ops = Cli-Json $Repo @('ops-status', '--record', $Record) 'ops-status'
  $last = @($ops.calls | Where-Object { $_.runId -eq $runId })
  if ($last.Count) { $c = $last[0]; Write-Host ("After {0}: exit={1} timedOut={2} runEnd={3}/{4} steps={5} used={6} {7} frozen={8}" -f $c.runId, $c.exitCode, $c.timedOut, $c.runEndPresent, $c.runEndValid, $c.steps, $c.used, $c.outcome, $c.frozen) }
  if ($code -ne 0) { Stop-Exp "the run step exited $code for $runId; see $log (recorded in the ledger; nothing is re-run)" }
  if (@($ops.stopped).Count) { Stop-Exp "the experiment stopped after ${runId}: $((@($ops.stopped) | ConvertTo-Json -Compress))" }
  $null = Cli-Json $Repo @('verify', '--record', $Record, '--run', $Run) 'the integrity check after the call'
}

# ---------------------------------------------------------------- 5. after the last call: integrity, then the single opening
$ver = Cli-Json $Repo @('verify', '--record', $Record, '--run', $Run) 'the final integrity check'
Write-Host "`nEvery scheduled call has run and is frozen; integrity holds." -ForegroundColor Green
$answer = Read-Host 'Type EVALUATE to open the final held-out evidence ONCE now (anything else leaves it closed)'
if ($answer -eq 'EVALUATE') { $null = Cli-Json $Repo @('evaluate', '--record', $Record, '--run', $Run) 'the single evaluation'; Write-Host "Written: $Run\EVALUATION.json" }
else { Write-Host 'The held-out evidence stays closed. Run this script again and type EVALUATE when ready.' }
Pack-Results

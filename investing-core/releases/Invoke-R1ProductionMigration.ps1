# SYNTRAKE R1 — operator-controlled Supabase Production release.
# Requires: Windows PowerShell 5.1+, Git with personal GitHub access, Node.js/npm.
# This is NOT a GitHub Action and NEVER uses a CI/service_role credential.
# .\Invoke-R1ProductionMigration.ps1 -Mode Plan  (no production writes)
# .\Invoke-R1ProductionMigration.ps1 -Mode Apply (requires local typed confirmation)
[CmdletBinding()]
param([ValidateSet("Plan", "Apply")][string]$Mode = "Plan")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRef = "vbazzxqyuqcrmjytaboc"
$RepoUrl = "https://github.com/syntrakehq-byte/syntrake.git"
$SourceSHA = "d42ecf58ca46c0e33d866cced2cdf14aa36eced0"
$ReleaseName = "20261020180000_investing_first_readonly_release.sql"
$HistoricalName = "20261017191056_remote_schema.sql"
$ExpectedBlob = "f23fadf42d050a7d45f84ef166f94168256eb892"
$HistorySHA256 = "8cec567d53f9f17868c7110b48d17212e1ba8db897f513aee36e287f0016335d"
$CliVersion = "2.84.2"
$Folder = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Syntrake\R1-first-production-20261020"
$Repo = Join-Path $Folder "source"
$Isolated = Join-Path $Folder "isolated-cli"
$Migrations = Join-Path $Isolated "supabase\migrations"

function Assert([bool]$ok, [string]$reason) {
  if (-not $ok) { throw "BLOCKED: $reason" }
}
function Invoke-External([string]$exe, [string[]]$argv) {
  # Auth and password prompts happen only in the operator's console.
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "BLOCKED: external command failed ($exe, exit $LASTEXITCODE)" }
}
function Capture-External([string]$exe, [string[]]$argv) {
  # CLI warnings can use stderr on Windows PowerShell; they must not be mistaken
  # for authentication data or a successful command.
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $lines = & $exe @argv 2>&1
    $exit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  Assert ($exit -eq 0) "remote CLI operation failed: $exit"
  return ($lines | Out-String)
}
function DigestHex([string]$value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $data = [System.Text.Encoding]::UTF8.GetBytes($value)
    return [BitConverter]::ToString($sha.ComputeHash($data)).Replace("-", "").ToLowerInvariant()
  } finally { $sha.Dispose() }
}
function Supabase([string[]]$arguments) {
  Invoke-External "npx.cmd" (@("--yes", "supabase@$CliVersion", "--workdir", $Isolated) + $arguments)
}
function Supabase-Read([string[]]$arguments) {
  return Capture-External "npx.cmd" (@("--yes", "supabase@$CliVersion", "--workdir", $Isolated) + $arguments)
}
function Check-Migration-Files() {
  Assert (Test-Path -LiteralPath $Migrations -PathType Container) "missing isolated migration directory"
  $list = @(Get-ChildItem -LiteralPath $Migrations -Filter "*.sql" -File | Select-Object -ExpandProperty Name | Sort-Object)
  Assert ($list.Count -eq 2) "expected EXACTLY 2 migration SQL files"
  Assert (($list -contains $HistoricalName) -and ($list -contains $ReleaseName)) "unexpected migration name"
  Assert ((Get-Content -LiteralPath (Join-Path $Migrations $ReleaseName) -Raw) -ceq
    (Get-Content -LiteralPath $ReleaseSource -Raw)) "release SQL differs from checked Git source"
  $baseline = Get-Content -LiteralPath (Join-Path $Migrations $HistoricalName) -Raw
  Assert ($baseline -match "ALREADY APPLIED") "historical baseline safety label missing"
  Assert ($baseline -match "NEVER RUN") "historical baseline is not tagged as non-executable"
}
function Validate-History([string]$report, [bool]$alreadyApplied) {
  $lines = @($report -split "`r?`n" | Where-Object { $_ -match "^\s*\d{14}\s*[|│]" })
  $records = @()
  foreach ($line in $lines) {
    $columns = @($line -split "[|│]" | ForEach-Object { $_.Trim() })
    Assert ($columns.Count -ge 2) "unknown Supabase CLI history format"
    $records += [pscustomobject]@{ local=$columns[0]; remote=$columns[1] }
  }
  Assert ($records.Count -eq 2) "unexpected number of linked migration-history rows"
  $baseline = @($records | Where-Object { $_.local -eq "20261017191056" })
  $forward = @($records | Where-Object { $_.local -eq "20261020180000" })
  Assert ($baseline.Count -eq 1) "remote baseline version missing from local release plan"
  Assert ($baseline[0].remote -eq "20261017191056") "remote baseline is different"
  Assert ($forward.Count -eq 1) "forward migration not found in local release plan"
  if ($alreadyApplied) {
    Assert ($forward[0].remote -eq "20261020180000") "forward migration not recorded by remote"
  } else {
    Assert ($forward[0].remote -eq "") "release version is already applied or conflicts with remote"
  }
}
function Assert-DryRun([string]$report) {
  Assert ($report -match "DRY RUN") "Supabase CLI dry-run marker absent"
  Assert ($report -match [regex]::Escape($ReleaseName)) "intended forward migration not in plan"
  $sqlFiles = @([regex]::Matches($report, "\b\d{14}_[A-Za-z0-9_]+\.sql\b") | ForEach-Object { $_.Value } | Sort-Object -Unique)
  Assert ($sqlFiles.Count -eq 1) "Supabase CLI proposes unexpected or multiple migrations"
  Assert ($sqlFiles[0] -eq $ReleaseName) "Supabase CLI is not applying exact release"
  Assert ($report -notmatch "(?i)repair migration|migration repair|use --include-all") "CLI reports migration-history conflict"
}

Assert ([bool](Get-Command git.exe -ErrorAction SilentlyContinue)) "Git not installed / not on PATH"
Assert ([bool](Get-Command npx.cmd -ErrorAction SilentlyContinue)) "Node.js/npm not installed / not on PATH"
if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
  New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  Write-Host "Fetching exact approved private GitHub commit. Git may ask you to log in."
  Invoke-External "git.exe" @("clone", "--no-checkout", "--filter=blob:none", $RepoUrl, $Repo)
}
# HEAD can never be accepted from a moving branch, only pinned commit.
Invoke-External "git.exe" @("-C", $Repo, "fetch", "--no-tags", "origin", $SourceSHA)
Invoke-External "git.exe" @("-C", $Repo, "checkout", "--detach", $SourceSHA)
$sourceHead = (Capture-External "git.exe" @("-C", $Repo, "rev-parse", "HEAD")).Trim()
Assert ($sourceHead -ceq $SourceSHA) "Git checkout did not match accepted SHA"

$ReleaseSource = Join-Path $Repo "supabase\release-candidates\$ReleaseName"
$HistorySource = Join-Path $Repo "supabase\release-evidence\20261017191056_remote_schema.registry.json"
Assert (Test-Path -LiteralPath $ReleaseSource -PathType Leaf) "missing candidate release SQL"
Assert (Test-Path -LiteralPath $HistorySource -PathType Leaf) "missing historical registry evidence"
$blob=(Capture-External "git.exe" @("-C", $Repo, "hash-object", $ReleaseSource)).Trim()
Assert ($blob -eq $ExpectedBlob) "release SQL bytes differ from audited Git blob"

$history = Get-Content -LiteralPath $HistorySource -Raw | ConvertFrom-Json
Assert ($history.sourceProjectRef -eq $ProjectRef) "history source project mismatch"
Assert ($history.version -eq "20261017191056") "wrong baseline version"
Assert ($history.name -eq "remote_schema") "wrong baseline name"
Assert ($history.statementCount -eq 32) "unexpected historical SQL count"
$statements = @($history.statements)
Assert ($statements.Count -eq 32) "historical SQL array length mismatch"
Assert ((DigestHex ([string]::Join("`n", [string[]]$statements))) -eq $HistorySHA256) "historical SHA-256 mismatch"

if (-not (Test-Path -LiteralPath (Join-Path $Isolated "supabase\config.toml") -PathType Leaf)) {
  New-Item -ItemType Directory -Path $Isolated -Force | Out-Null
  Write-Host "Creating a SEPARATE Supabase CLI workdir with no older Investing/writer migrations."
  Supabase @("init")
}
New-Item -ItemType Directory -Path $Migrations -Force | Out-Null
Copy-Item -LiteralPath $ReleaseSource -Destination (Join-Path $Migrations $ReleaseName) -Force
$header = "-- RECOVERED READ-ONLY HISTORY; ALREADY APPLIED. NEVER RUN on real database.`n"
$baselineSql = $header + (($statements | ForEach-Object { [string]$_ + ";" }) -join "`n") + "`n"
[System.IO.File]::WriteAllText(
  (Join-Path $Migrations $HistoricalName),
  $baselineSql, (New-Object System.Text.UTF8Encoding($false)))
Check-Migration-Files

$version = (Supabase-Read @("--version")).Trim()
Assert ($version -match "(^|\s)$([regex]::Escape($CliVersion))(\s|$)") "CLI version not pinned to $CliVersion"
Write-Host "Supabase CLI $CliVersion, project $ProjectRef, Git $SourceSHA, SQL Git blob $ExpectedBlob."
Write-Host "Authenticate locally. Never send personal tokens or database passwords in chat."
Supabase @("login")
Supabase @("link", "--project-ref", $ProjectRef)
$linked = Join-Path $Isolated "supabase\.temp\project-ref"
Assert (Test-Path -LiteralPath $linked -PathType Leaf) "Supabase CLI linked project-ref file unavailable"
Assert ((Get-Content -LiteralPath $linked -Raw).Trim() -eq $ProjectRef) "Supabase CLI linked WRONG project"
Check-Migration-Files
$historyBefore = Supabase-Read @("migration", "list", "--linked")
Validate-History $historyBefore $false
Write-Host "PRE-APPLY HISTORY (versions only):"
Write-Host $historyBefore

$plan = Supabase-Read @("db", "push", "--linked", "--dry-run")
Assert-DryRun $plan
Write-Host "READ-ONLY CLI PLAN:"
Write-Host $plan
Write-Host "GO: only $ReleaseName would be applied. No production changes made by the dry-run."
if ($Mode -eq "Plan") {
  Write-Host "PLAN_PASS. After reviewing this output, run this same script with -Mode Apply."
  exit 0
}

$want = "APLICAR $ProjectRef 20261020180000"
Write-Host "About to apply exact reviewed SQL in Supabase Production, with NO writers, seed or roles."
$answer = Read-Host "Type exactly: $want"
Assert ($answer -ceq $want) "operator did not confirm exact target and migration"
Check-Migration-Files
Assert ((Get-Content -LiteralPath $linked -Raw).Trim() -eq $ProjectRef) "linked project drift before apply"
# NO --include-all, --include-roles, --include-seed, --yes, db reset or repair.
# If connection drops or an error occurs: STOP; DO NOT automatically retry.
Supabase @("db", "push", "--linked")
Write-Host "CLI operation returned success. Verifying migration history."
$historyAfter = Supabase-Read @("migration", "list", "--linked")
Validate-History $historyAfter $true
Write-Host $historyAfter
Write-Host "CLI_APPLY_AND_HISTORY_PASS. Independent Supabase RLS/security audit is still required."

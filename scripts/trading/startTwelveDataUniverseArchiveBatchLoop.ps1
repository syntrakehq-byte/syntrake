param(
  [string]$Endpoint = "forex_pairs",
  [string]$Timeframe = "1d",
  [int]$FromYear = 1980,
  [int]$ToYear = 2026,
  [int]$BatchSize = 25,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$runtimeDir = Join-Path $projectRoot "artifacts\trading-research\runtime"
$reportsDir = Join-Path $projectRoot "artifacts\trading-research\reports\datasets"
$safeEndpoint = $Endpoint.Replace("/", "-").ToLowerInvariant()
$safeTimeframe = $Timeframe.Replace("/", "-").ToLowerInvariant()
$logPath = Join-Path $runtimeDir "twelvedata-$safeEndpoint-$safeTimeframe-batch-loop.log"
$statePath = Join-Path $reportsDir "twelvedata-$safeEndpoint-$safeTimeframe-batch-loop-state.json"
$latestReportPath = Join-Path $reportsDir "twelvedata-universe-archive-latest.json"
$pidPath = Join-Path $runtimeDir "twelvedata-$safeEndpoint-$safeTimeframe-batch-loop.pid"
$envCandidates = @(
  (Join-Path $projectRoot ".env.local"),
  (Join-Path $projectRoot ".env.vercel.production"),
  (Join-Path $projectRoot ".env.vercel.current")
)

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null

$apiKey = $null
foreach ($envPath in $envCandidates) {
  if (-not (Test-Path $envPath)) {
    continue
  }

  $match = Select-String -Path $envPath -Pattern '^TWELVEDATA_API_KEY=(.+)$' | Select-Object -First 1
  if ($match) {
    $apiKey = $match.Matches[0].Groups[1].Value.Trim()
    if ($apiKey) {
      break
    }
  }
}

if (-not $apiKey) {
  throw "Missing TWELVEDATA_API_KEY in local env files."
}

$forceArg = ""
if ($Force.IsPresent) {
  $forceArg = " --force"
}

$loopScript = @"
`$ErrorActionPreference = 'Stop'
Set-Location '$projectRoot'
`$env:TWELVEDATA_API_KEY = '$apiKey'
`$env:NODE_OPTIONS = '--max-old-space-size=8192'

`$state = [ordered]@{
  startedAt = [DateTime]::UtcNow.ToString('o')
  updatedAt = [DateTime]::UtcNow.ToString('o')
  completedAt = `$null
  endpoint = '$Endpoint'
  timeframe = '$Timeframe'
  fromYear = $FromYear
  toYear = $ToYear
  batchSize = $BatchSize
  offsetSymbols = 0
  completedBatches = 0
  downloadedTotal = 0
  existingTotal = 0
  missingRemoteTotal = 0
  restrictedTotal = 0
  failedTotal = 0
  lastReportId = `$null
}

function Save-State {
  param([hashtable]`$Value)
  `$Value.updatedAt = [DateTime]::UtcNow.ToString('o')
  (`$Value | ConvertTo-Json -Depth 6) | Set-Content -Path '$statePath' -Encoding UTF8
}

Save-State -Value `$state

while (`$true) {
  Add-Content -Path '$logPath' -Value \"[batch-loop] starting endpoint=$Endpoint timeframe=$Timeframe offset=`$(`$state.offsetSymbols) batchSize=$BatchSize at `$([DateTime]::UtcNow.ToString('o'))\"

  npm run research:twelvedata-universe:archive -- --endpoints=$Endpoint --timeframes=$Timeframe --fromYear=$FromYear --toYear=$ToYear --limitSymbols=$BatchSize --offsetSymbols=`$(`$state.offsetSymbols)$forceArg 2>&1 | Tee-Object -FilePath '$logPath' -Append
  if (`$LASTEXITCODE -ne 0) {
    `$state.failedTotal += 1
    Save-State -Value `$state
    throw \"Archive batch failed with exit code `$LASTEXITCODE\"
  }

  if (-not (Test-Path '$latestReportPath')) {
    throw 'Latest archive report not found after batch execution.'
  }

  `$report = Get-Content '$latestReportPath' -Raw | ConvertFrom-Json
  `$state.completedBatches += 1
  `$state.lastReportId = `$report.reportId
  `$state.downloadedTotal += [int]`$report.summary.downloaded
  `$state.existingTotal += [int]`$report.summary.existing
  `$state.missingRemoteTotal += [int]`$report.summary.missingRemote
  `$state.restrictedTotal += [int]`$report.summary.restricted
  `$state.offsetSymbols += [int]`$report.summary.symbols
  Save-State -Value `$state

  Add-Content -Path '$logPath' -Value \"[batch-loop] finished endpoint=$Endpoint timeframe=$Timeframe reportId=`$(`$report.reportId) symbols=`$(`$report.summary.symbols) downloaded=`$(`$report.summary.downloaded) existing=`$(`$report.summary.existing) missingRemote=`$(`$report.summary.missingRemote) restricted=`$(`$report.summary.restricted)\"

  if ([int]`$report.summary.symbols -lt $BatchSize) {
    break
  }
}

`$state.completedAt = [DateTime]::UtcNow.ToString('o')
Save-State -Value `$state
"@

if (Test-Path $logPath) {
  Remove-Item $logPath -Force
}

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($loopScript))
$process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-EncodedCommand", $encoded -WindowStyle Hidden -PassThru
Set-Content -Path $pidPath -Value $process.Id

[pscustomobject]@{
  pid = $process.Id
  endpoint = $Endpoint
  timeframe = $Timeframe
  logPath = $logPath
  statePath = $statePath
  pidPath = $pidPath
} | ConvertTo-Json -Depth 3

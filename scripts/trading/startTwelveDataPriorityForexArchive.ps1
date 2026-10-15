$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$runtimeDir = Join-Path $projectRoot "artifacts\trading-research\runtime"
$mainReportsDir = Join-Path $projectRoot "artifacts\trading-research\reports\datasets"
$priorityReportsDir = Join-Path $mainReportsDir "priority-forex"
$catalogPath = Join-Path $mainReportsDir "twelvedata-universe-latest.json"
$statePath = Join-Path $priorityReportsDir "twelvedata-priority-forex-layered-state.json"
$logPath = Join-Path $runtimeDir "twelvedata-priority-forex.log"
$pidPath = Join-Path $runtimeDir "twelvedata-priority-forex.pid"
$envCandidates = @(
  (Join-Path $projectRoot ".env.local"),
  (Join-Path $projectRoot ".env.vercel.production"),
  (Join-Path $projectRoot ".env.vercel.current")
)

function Normalize-EnvValue([string]$value) {
  if ($null -eq $value) {
    return $null
  }
  return $value.Trim().Trim('"').Trim("'").Trim()
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $priorityReportsDir | Out-Null

$apiKey = $null
foreach ($envPath in $envCandidates) {
  if (-not (Test-Path $envPath)) {
    continue
  }
  $match = Select-String -Path $envPath -Pattern '^TWELVEDATA_API_KEY=(.+)$' | Select-Object -First 1
  if ($match) {
    $apiKey = Normalize-EnvValue $match.Matches[0].Groups[1].Value
    if ($apiKey) {
      break
    }
  }
}

if (-not $apiKey) {
  throw "Missing TWELVEDATA_API_KEY in local env files."
}

Add-Content -Path $logPath -Value "`r`n[$(Get-Date -Format o)] starting priority Forex archive"

$commandLine = @(
  "cd /d `"$projectRoot`"",
  "&& npm run research:twelvedata-universe:layered -- --endpoints=forex_pairs --timeframes=1d,4h,1h,15m,5m,1m --fromYear=1980 --toYear=2026 --batchSize=25 --reportsDir=`"$priorityReportsDir`" --catalogPath=`"$catalogPath`" --statePath=`"$statePath`" >> `"$logPath`" 2>&1"
) -join " "

$previousApiKey = $env:TWELVEDATA_API_KEY
$previousNodeOptions = $env:NODE_OPTIONS
try {
  $env:TWELVEDATA_API_KEY = $apiKey
  $env:NODE_OPTIONS = "--max-old-space-size=8192"
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", $commandLine) -WindowStyle Hidden -PassThru
} finally {
  $env:TWELVEDATA_API_KEY = $previousApiKey
  $env:NODE_OPTIONS = $previousNodeOptions
}
Set-Content -Path $pidPath -Value $process.Id

[pscustomobject]@{
  pid = $process.Id
  logPath = $logPath
  pidPath = $pidPath
  reportsDir = $priorityReportsDir
  statePath = $statePath
} | ConvertTo-Json -Depth 3

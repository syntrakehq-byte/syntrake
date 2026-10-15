$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$runtimeDir = Join-Path $projectRoot "artifacts\trading-research\runtime"
$reportsDir = Join-Path $projectRoot "artifacts\trading-research\reports\datasets\syntrake-core-daily"
$archiveDir = Join-Path $projectRoot "Data\historical-twelvedata-syntrake"
$logPath = Join-Path $runtimeDir "twelvedata-syntrake-core-daily.log"
$pidPath = Join-Path $runtimeDir "twelvedata-syntrake-core-daily.pid"
$envCandidates = @(
  (Join-Path $projectRoot ".env.local"),
  (Join-Path $projectRoot ".env.vercel.production"),
  (Join-Path $projectRoot ".env.vercel.current")
)
$instruments = "EURUSD,GBPUSD,USDJPY,XAUUSD,NAS100,US500,BTCUSD,ETHUSD"

function Normalize-EnvValue([string]$value) {
  if ($null -eq $value) {
    return $null
  }
  return $value.Trim().Trim('"').Trim("'").Trim()
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

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

Add-Content -Path $logPath -Value "`r`n[$(Get-Date -Format o)] starting Syntrake core daily archive"

$commandLine = @(
  "cd /d `"$projectRoot`"",
  "&& npm run research:twelvedata-archive -- --instruments=$instruments --timeframes=1d --full-history --download --reportsDir=`"$reportsDir`" --archiveRoot=`"$archiveDir`" >> `"$logPath`" 2>&1"
) -join " "

$previousApiKey = $env:TWELVEDATA_API_KEY
$previousNodeOptions = $env:NODE_OPTIONS
try {
  $env:TWELVEDATA_API_KEY = $apiKey
  $env:NODE_OPTIONS = "--max-old-space-size=4096"
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", $commandLine) -WindowStyle Hidden -PassThru
} finally {
  $env:TWELVEDATA_API_KEY = $previousApiKey
  $env:NODE_OPTIONS = $previousNodeOptions
}

Set-Content -Path $pidPath -Value $process.Id

[pscustomobject]@{
  pid = $process.Id
  instruments = 8
  timeframe = "1d"
  logPath = $logPath
  reportsDir = $reportsDir
  archiveDir = $archiveDir
} | ConvertTo-Json -Depth 3

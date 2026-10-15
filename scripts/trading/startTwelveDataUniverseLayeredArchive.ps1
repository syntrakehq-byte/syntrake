$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$runtimeDir = Join-Path $projectRoot "artifacts\trading-research\runtime"
$reportsDir = Join-Path $projectRoot "artifacts\trading-research\reports\datasets"
$logPath = Join-Path $runtimeDir "twelvedata-universe-layered.log"
$pidPath = Join-Path $runtimeDir "twelvedata-universe-layered.pid"
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
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null

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

Add-Content -Path $logPath -Value "`r`n[$(Get-Date -Format o)] restarting Twelve Data layered archive"

$commandLine = @(
  "set `"TWELVEDATA_API_KEY=$apiKey`"",
  "&& set `"NODE_OPTIONS=--max-old-space-size=8192`"",
  "&& cd /d `"$projectRoot`"",
  "&& npm run research:twelvedata-universe:layered -- --fromYear=1980 --toYear=2026 --batchSize=25 >> `"$logPath`" 2>&1"
) -join " "

$process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", $commandLine) -WindowStyle Hidden -PassThru
Set-Content -Path $pidPath -Value $process.Id

[pscustomobject]@{
  pid = $process.Id
  logPath = $logPath
  pidPath = $pidPath
  reportsDir = $reportsDir
} | ConvertTo-Json -Depth 3

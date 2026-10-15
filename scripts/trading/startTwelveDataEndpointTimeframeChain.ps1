param(
  [string]$Endpoint = "forex_pairs",
  [int]$FromYear = 1980,
  [int]$ToYear = 2026,
  [int]$BatchSize = 10,
  [string[]]$Timeframes = @("1d", "4h", "1h", "15m", "5m", "1m")
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$runtimeDir = Join-Path $projectRoot "artifacts\trading-research\runtime"
$safeEndpoint = $Endpoint.Replace("/", "-").ToLowerInvariant()
$logPath = Join-Path $runtimeDir "twelvedata-$safeEndpoint-timeframe-chain.log"
$pidPath = Join-Path $runtimeDir "twelvedata-$safeEndpoint-timeframe-chain.pid"
$timeframeLiteral = ($Timeframes | ForEach-Object { "'$_'" }) -join ", "

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$chainScript = @"
`$ErrorActionPreference = 'Stop'
Set-Location '$projectRoot'

function Wait-ForArchiveSlot {
  param(
    [string]`$TargetEndpoint,
    [string]`$TargetTimeframe
  )

  while (`$true) {
    `$active = Get-CimInstance Win32_Process | Where-Object {
      `$_.CommandLine -match 'runTwelveDataUniverseArchive\.ts' -and
      `$_.CommandLine -match "--endpoints=`$TargetEndpoint" -and
      `$_.CommandLine -match "--timeframes=`$TargetTimeframe"
    }

    if (-not `$active) {
      break
    }

    Start-Sleep -Seconds 30
  }
}

Add-Content -Path '$logPath' -Value "[timeframe-chain] started endpoint=$Endpoint at `$([DateTime]::UtcNow.ToString('o'))"

foreach (`$timeframe in @($timeframeLiteral)) {
  Add-Content -Path '$logPath' -Value "[timeframe-chain] waiting endpoint=$Endpoint timeframe=`$timeframe"
  Wait-ForArchiveSlot -TargetEndpoint '$Endpoint' -TargetTimeframe `$timeframe

  Add-Content -Path '$logPath' -Value "[timeframe-chain] launching endpoint=$Endpoint timeframe=`$timeframe"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'scripts/trading/startTwelveDataUniverseArchiveBatchLoop.ps1' -Endpoint '$Endpoint' -Timeframe `$timeframe -FromYear $FromYear -ToYear $ToYear -BatchSize $BatchSize | Out-Null

  Start-Sleep -Seconds 10
  Wait-ForArchiveSlot -TargetEndpoint '$Endpoint' -TargetTimeframe `$timeframe
  Add-Content -Path '$logPath' -Value "[timeframe-chain] completed endpoint=$Endpoint timeframe=`$timeframe at `$([DateTime]::UtcNow.ToString('o'))"
}

Add-Content -Path '$logPath' -Value "[timeframe-chain] finished endpoint=$Endpoint at `$([DateTime]::UtcNow.ToString('o'))"
"@

if (Test-Path $logPath) {
  Remove-Item $logPath -Force
}

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($chainScript))
$process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-EncodedCommand", $encoded -WindowStyle Hidden -PassThru
Set-Content -Path $pidPath -Value $process.Id

[pscustomobject]@{
  pid = $process.Id
  endpoint = $Endpoint
  timeframes = $Timeframes
  logPath = $logPath
  pidPath = $pidPath
} | ConvertTo-Json -Depth 4

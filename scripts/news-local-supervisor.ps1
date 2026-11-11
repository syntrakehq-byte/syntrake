param(
  [int]$RunSeconds = 30,
  [double]$CrashAfterSeconds = 8,
  [string]$LogDirectory = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $LogDirectory) { $LogDirectory = Join-Path $root "tmp-news-supervisor-logs" }
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$deadline = (Get-Date).AddSeconds($RunSeconds)
$crashInjected = $false
$restartCount = 0
$events = Join-Path $LogDirectory "supervisor-events.log"

function Write-Event([string]$Message) {
  Add-Content -LiteralPath $events -Value ("{0:o} {1}" -f (Get-Date), $Message)
}

while ((Get-Date) -lt $deadline) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
  $stdout = Join-Path $LogDirectory "worker-$stamp.out.log"
  $stderr = Join-Path $LogDirectory "worker-$stamp.err.log"
  $shutdownFile = Join-Path $LogDirectory "shutdown-$stamp.request"
  if (Test-Path -LiteralPath $shutdownFile) { Remove-Item -LiteralPath $shutdownFile -Force }
  $env:NEWS_SHUTDOWN_FILE = $shutdownFile
  $worker = Start-Process -FilePath "node" -ArgumentList @("node_modules/tsx/dist/cli.mjs", "scripts/news-postgres-worker.ts") -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-Event "START pid=$($worker.Id) restart=$restartCount"
  $started = Get-Date

  while (-not $worker.HasExited -and (Get-Date) -lt $deadline) {
    if (-not $crashInjected -and ((Get-Date) - $started).TotalSeconds -ge $CrashAfterSeconds) {
      Stop-Process -Id $worker.Id -Force
      Write-Event "CRASH_INJECTED pid=$($worker.Id)"
      $crashInjected = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }

  if (-not $worker.HasExited) {
    New-Item -ItemType File -Force -Path $shutdownFile | Out-Null
    Write-Event "COOPERATIVE_SHUTDOWN_REQUESTED pid=$($worker.Id)"
    $worker.WaitForExit(10000)
    if (-not $worker.HasExited) {
      Stop-Process -Id $worker.Id -Force
      Write-Event "FORCE_STOP_AFTER_COOPERATIVE_TIMEOUT pid=$($worker.Id)"
    }
  }

  $closed = Select-String -LiteralPath $stdout -Pattern "NEWS_STORE_CLOSED" -Quiet
  if ($closed) { Write-Event "WORKER_STORE_CLOSED pid=$($worker.Id)" }
  Write-Event "EXIT pid=$($worker.Id) code=$($worker.ExitCode)"
  if ((Get-Date) -lt $deadline) { $restartCount++ }
}

Write-Event "SUPERVISOR_STOP restarts=$restartCount crashInjected=$crashInjected"
Write-Output (Get-Content -LiteralPath $events -Raw)

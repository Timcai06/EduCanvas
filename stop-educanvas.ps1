param([switch]$KeepDb)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidPath = Join-Path $ProjectRoot '.educanvas-local.pid'
Set-Location -LiteralPath $ProjectRoot

function Stop-ProcessTree([int]$ProcessId) {
  # Stop only the process recorded by our start script and its descendants;
  # unrelated Node projects on the machine are intentionally left untouched.
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) { Stop-ProcessTree $child.ProcessId }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $PidPath) {
  $recordedPid = [int](Get-Content -LiteralPath $PidPath -Raw)
  if (Get-Process -Id $recordedPid -ErrorAction SilentlyContinue) {
    Stop-ProcessTree $recordedPid
    Write-Host "[EduCanvas] stopped app process tree ($recordedPid)"
  }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
} else {
  Write-Host '[EduCanvas] no recorded app process found'
}

if (-not $KeepDb -and (Get-Command docker -ErrorAction SilentlyContinue)) {
  docker compose stop db *> $null
  Write-Host '[EduCanvas] database stopped; data volume preserved'
}

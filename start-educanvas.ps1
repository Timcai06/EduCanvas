param(
  [switch]$SkipMigrate,
  [switch]$NoOpen,
  [ValidateRange(1, 65535)]
  [int]$Port = 3101
)

$ErrorActionPreference = 'Stop'

# Keep all runtime state beside the script so a double-click works from any cwd.
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $ProjectRoot '.educanvas-local.log'
$ErrLogPath = Join-Path $ProjectRoot '.educanvas-local.err.log'
$PidPath = Join-Path $ProjectRoot '.educanvas-local.pid'
$MigrationStatePath = Join-Path $ProjectRoot '.educanvas-migrate-state.json'
$WebUrl = "http://127.0.0.1:$Port"

Set-Location -LiteralPath $ProjectRoot

function Write-Step($Message) {
  Write-Host "[EduCanvas] $Message"
}

function Load-DotEnv($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw ".env not found: $Path"
  }

  # This parser intentionally handles only KEY=value lines. It avoids invoking a
  # shell, so a secret containing shell metacharacters is never executed.
  Get-Content -Encoding utf8 -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^\s*$' -or $_ -match '^\s*#') { return }
    if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $Name = $matches[1]
      $Value = $matches[2].Trim()
      if (
        $Value.Length -ge 2 -and
        (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
          ($Value.StartsWith("'") -and $Value.EndsWith("'")))
      ) {
        $Value = $Value.Substring(1, $Value.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
  }
}

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Http($Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch { return $false }
}

function Test-GatewayReady($Url) {
  try {
    $body = (Invoke-WebRequest -Uri "$Url/healthz" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
    return $body.service -eq 'educanvas-gateway' -and $body.protocol -eq 'gateway.v1'
  } catch { return $false }
}

function Test-PortInUse([int]$PortNumber) {
  return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $PortNumber -ErrorAction SilentlyContinue)
}

function Assert-PortsAvailable([int]$GatewayPort) {
  $webReady = Test-Http $WebUrl
  $gatewayReady = Test-GatewayReady "http://127.0.0.1:$GatewayPort"
  if ($webReady -and $gatewayReady) {
    Write-Step "EduCanvas is already running: $WebUrl"
    return $true
  }
  if ($webReady -or $gatewayReady) {
    throw "Detected a partial EduCanvas startup (Web=$webReady, Gateway=$gatewayReady). Run Stop EduCanvas.cmd first."
  }
  if (Test-PortInUse $Port) {
    throw "Port $Port is already used by another process. Use -Port to choose another Web port."
  }
  if (Test-PortInUse $GatewayPort) {
    throw "Port $GatewayPort is already used by another process. Stop that process before starting EduCanvas."
  }
  return $false
}

function Wait-Http($Url, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Http $Url) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Ensure-DockerDb {
  if (-not (Test-Command 'docker')) { throw 'Docker CLI is not available. Please install Docker Desktop.' }
  $dockerOk = $false
  try { docker info *> $null; $dockerOk = $LASTEXITCODE -eq 0 } catch { $dockerOk = $false }
  if (-not $dockerOk) {
    $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path -LiteralPath $dockerDesktop) {
      Write-Step 'Starting Docker Desktop...'
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      try { docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break } } catch { $dockerOk = $false }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $dockerOk) { throw 'Docker is not running. Start Docker Desktop, then run this script again.' }

  $dbExists = [bool](docker ps -a --filter 'name=^/educanvas-db$' --format '{{.Names}}')
  if ($dbExists) { Write-Step 'Starting existing database container...'; docker start educanvas-db *> $null }
  else { Write-Step 'Creating database container...'; docker compose up -d db }

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    docker exec educanvas-db pg_isready -U educanvas *> $null
    if ($LASTEXITCODE -eq 0) { Write-Step 'Database is ready.'; return }
    Start-Sleep -Seconds 1
  }
  throw 'Database did not become ready in time.'
}

function Get-MigrationFingerprint {
  # The marker is based only on migration source files. A normal launch therefore
  # skips an already-applied migration, while a new migration automatically runs.
  $files = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'packages\db\drizzle') -Recurse -File | Sort-Object FullName)
  $hashes = ($files | ForEach-Object { (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash }) -join ':'
  $bytes = [Text.Encoding]::UTF8.GetBytes($hashes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Run-Migrations {
  $fingerprint = Get-MigrationFingerprint
  $databaseId = (docker inspect -f '{{.Id}}' educanvas-db 2>$null).Trim()
  $cached = $null
  if (Test-Path -LiteralPath $MigrationStatePath) {
    try { $cached = Get-Content -Encoding utf8 -Raw -LiteralPath $MigrationStatePath | ConvertFrom-Json } catch { $cached = $null }
  }
  if ($cached -and $cached.fingerprint -eq $fingerprint -and $cached.databaseId -eq $databaseId) {
    Write-Step 'Migrations unchanged for this database; skipping db:migrate.'
    return
  }
  Write-Step 'Running database migrations...'
  pnpm db:migrate
  # Include the container identity so a recreated/empty database never inherits
  # a stale migration skip marker from a previous local database.
  @{ fingerprint = $fingerprint; databaseId = $databaseId; updatedAt = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $MigrationStatePath
}

function Start-EduCanvas([int]$GatewayPort) {
  $alreadyRunning = Assert-PortsAvailable $GatewayPort
  if ($alreadyRunning) { if (-not $NoOpen) { Start-Process $WebUrl }; return }

  Write-Step "Starting Web on $WebUrl and Gateway on http://127.0.0.1:$GatewayPort"
  Write-Step "stdout log: $LogPath"
  Write-Step "stderr log: $ErrLogPath"
  Remove-Item -LiteralPath $LogPath, $ErrLogPath -ErrorAction SilentlyContinue
  $env:PORT = "$Port"
  $env:EDUCANVAS_GATEWAY_PORT = "$GatewayPort"
  $process = Start-Process -PassThru -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'pnpm dev:core') -WorkingDirectory $ProjectRoot -RedirectStandardOutput $LogPath -RedirectStandardError $ErrLogPath -WindowStyle Hidden
  Set-Content -Encoding ascii -LiteralPath $PidPath -Value $process.Id

  if (Wait-Http $WebUrl 90) {
    Write-Step "Ready: $WebUrl"
    if (-not $NoOpen) { Start-Process $WebUrl }
    return
  }
  Write-Host ''
  Write-Host 'Startup failed. Last error log:'
  if (Test-Path -LiteralPath $ErrLogPath) { Get-Content -Encoding utf8 -LiteralPath $ErrLogPath -Tail 80 }
  throw "EduCanvas did not become ready. Full logs: $LogPath"
}

Load-DotEnv (Join-Path $ProjectRoot '.env')
if (-not (Test-Command 'node')) { throw 'node.exe is not available in PATH.' }
if (-not (Test-Command 'pnpm')) { throw 'pnpm is not available in PATH.' }
Write-Step 'Checking local environment...'
pnpm env:check
if (-not $env:EDUCANVAS_GATEWAY_PORT) { $env:EDUCANVAS_GATEWAY_PORT = '3200' }
$gatewayPort = [int]$env:EDUCANVAS_GATEWAY_PORT
if ($gatewayPort -lt 1 -or $gatewayPort -gt 65535) { throw 'EDUCANVAS_GATEWAY_PORT must be between 1 and 65535.' }

if (-not $SkipMigrate) { Ensure-DockerDb; Run-Migrations }
else { Write-Step 'Skipping database migration (-SkipMigrate).' }
Start-EduCanvas $gatewayPort

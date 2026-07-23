$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $ProjectRoot '.educanvas-local.log'
$ErrLogPath = Join-Path $ProjectRoot '.educanvas-local.err.log'
$WebUrl = 'http://127.0.0.1:3101'

Set-Location -LiteralPath $ProjectRoot

function Write-Step($Message) {
  Write-Host "[EduCanvas] $Message"
}

function Load-DotEnv($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw ".env not found: $Path"
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^\s*$' -or $_ -match '^\s*#') {
      return
    }
    if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
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
  } catch {
    return $false
  }
}

function Wait-Http($Url, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Http $Url) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Ensure-DockerDb {
  if (-not (Test-Command 'docker')) {
    throw 'Docker CLI is not available. Please install or start Docker Desktop.'
  }

  $dockerOk = $false
  try {
    docker info *> $null
    $dockerOk = $LASTEXITCODE -eq 0
  } catch {
    $dockerOk = $false
  }

  if (-not $dockerOk) {
    $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path -LiteralPath $dockerDesktop) {
      Write-Step 'Starting Docker Desktop...'
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      try {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) {
          $dockerOk = $true
          break
        }
      } catch {
        $dockerOk = $false
      }
      Start-Sleep -Seconds 2
    }
  }

  if (-not $dockerOk) {
    throw 'Docker is not running. Start Docker Desktop, then run this script again.'
  }

  $dbExists = $false
  try {
    $dbExists = [bool](docker ps -a --filter 'name=^/educanvas-db$' --format '{{.Names}}')
  } catch {
    $dbExists = $false
  }

  if ($dbExists) {
    Write-Step 'Starting existing database container...'
    docker start educanvas-db *> $null
  } else {
    Write-Step 'Creating database container...'
    docker compose up -d db
  }

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    docker exec educanvas-db pg_isready -U educanvas *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Step 'Database is ready.'
      return
    }
    Start-Sleep -Seconds 1
  }

  throw 'Database did not become ready in time.'
}

function Start-EduCanvas {
  if (Test-Http $WebUrl) {
    Write-Step "EduCanvas is already running: $WebUrl"
    Start-Process $WebUrl
    return
  }

  Write-Step 'Starting Web, Gateway, and Worker...'
  Remove-Item -LiteralPath $LogPath, $ErrLogPath -ErrorAction SilentlyContinue

  $env:PORT = '3101'
  Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'pnpm dev:core') `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError $ErrLogPath `
    -WindowStyle Hidden

  if (Wait-Http $WebUrl 90) {
    Write-Step "Ready: $WebUrl"
    Start-Process $WebUrl
    return
  }

  Write-Host ''
  Write-Host 'Startup failed. Last error log:'
  if (Test-Path -LiteralPath $ErrLogPath) {
    Get-Content -LiteralPath $ErrLogPath -Tail 80
  }
  throw "EduCanvas did not become ready. Full logs: $LogPath"
}

Load-DotEnv (Join-Path $ProjectRoot '.env')

if (-not (Test-Command 'node')) {
  throw 'node.exe is not available in PATH.'
}
if (-not (Test-Command 'pnpm')) {
  throw 'pnpm is not available in PATH.'
}

Ensure-DockerDb

Write-Step 'Running database migrations...'
pnpm db:migrate

Start-EduCanvas

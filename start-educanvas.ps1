$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

function Write-Step($Message) {
  Write-Host "[EduCanvas] $Message"
}

function Import-DotEnv($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw ".env not found: $Path"
  }

  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trimmed = $Line.Trim()
    if ($Trimmed.Length -eq 0 -or $Trimmed.StartsWith('#')) {
      continue
    }
    if ($Trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      continue
    }

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

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Docker {
  try {
    docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Ensure-Docker {
  if (-not (Test-Command 'docker')) {
    throw 'Docker CLI is not available. Please install or start Docker Desktop.'
  }
  if (-not (Test-Docker)) {
    $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path -LiteralPath $dockerDesktop) {
      Write-Step 'Starting Docker Desktop...'
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      if (Test-Docker) { return }
      Start-Sleep -Seconds 2
    }
  }
  if (-not (Test-Docker)) {
    throw 'Docker is not running. Start Docker Desktop, then run this script again.'
  }
}

function Invoke-Checked($Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command exited with code $LASTEXITCODE"
  }
}

if (-not (Test-Command 'node')) {
  throw 'node.exe is not available in PATH.'
}
if (-not (Test-Command 'pnpm')) {
  throw 'pnpm is not available in PATH.'
}

Import-DotEnv (Join-Path $ProjectRoot '.env')
Ensure-Docker

Write-Step 'Starting database...'
Invoke-Checked 'pnpm' @('db:up')
Write-Step 'Running database migrations...'
Invoke-Checked 'pnpm' @('db:migrate')
Write-Step 'Starting the shared Web, Gateway, and Worker runtime...'
Invoke-Checked 'node' @('tooling/local-orchestrator.mjs', 'web')

param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [ValidateSet('portable', 'unpacked')]
  [string]$Mode = 'unpacked',

  [ValidateRange(5, 120)]
  [int]$ReadyTimeoutSeconds = 30,

  [ValidateRange(1, 30)]
  [int]$IdleSampleSeconds = 5,

  [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DistRoot = (Resolve-Path (Join-Path $ProjectRoot 'apps\desktop\dist')).Path
$ResolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$DistPrefix = $DistRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $ResolvedExecutable.StartsWith($DistPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The benchmark executable must be inside apps\desktop\dist.'
}
if ([IO.Path]::GetExtension($ResolvedExecutable) -ne '.exe') {
  throw 'The benchmark target must be a Windows executable.'
}

$existing = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -eq $ResolvedExecutable
}
if ($existing) {
  throw 'The benchmark target is already running; stop it before measuring a cold start.'
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EduCanvasPackageWindow {
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@

function Get-RecordedProcessTree([int]$RootProcessId) {
  $snapshot = @(Get-CimInstance Win32_Process)
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue([pscustomobject]@{ ProcessId = $RootProcessId; Depth = 0 })
  $seen = [Collections.Generic.HashSet[int]]::new()
  $records = @()
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $seen.Add([int]$current.ProcessId)) { continue }
    $record = $snapshot | Where-Object ProcessId -eq $current.ProcessId
    if ($record) {
      $records += [pscustomobject]@{
        ProcessId = [int]$record.ProcessId
        ParentProcessId = [int]$record.ParentProcessId
        ExecutablePath = $record.ExecutablePath
        CreationDate = $record.CreationDate
        Depth = [int]$current.Depth
      }
    }
    foreach ($child in ($snapshot | Where-Object ParentProcessId -eq $current.ProcessId)) {
      $queue.Enqueue(
        [pscustomobject]@{
          ProcessId = [int]$child.ProcessId
          Depth = [int]$current.Depth + 1
        }
      )
    }
  }
  return @($records)
}

function Hide-RecordedWindows($Records) {
  foreach ($record in $Records) {
    try {
      $process = Get-Process -Id $record.ProcessId -ErrorAction Stop
      if ($process.MainWindowHandle -ne 0) {
        [EduCanvasPackageWindow]::ShowWindow($process.MainWindowHandle, 0) | Out-Null
      }
    } catch {}
  }
}

function Remember-RecordedProcessTree($Records, [hashtable]$RecordedProcesses) {
  foreach ($record in $Records) {
    $key = "{0}|{1:o}" -f $record.ProcessId, $record.CreationDate
    if (-not $RecordedProcesses.ContainsKey($key)) {
      $RecordedProcesses[$key] = $record
    }
  }
}

$startedAt = Get-Date
$clock = [Diagnostics.Stopwatch]::StartNew()
$root = Start-Process -FilePath $ResolvedExecutable -PassThru -WindowStyle Hidden
$readyMilliseconds = $null
$readyProcessId = $null
$result = $null
$recordedProcesses = @{}

try {
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  do {
    $tree = Get-RecordedProcessTree $root.Id
    Remember-RecordedProcessTree $tree $recordedProcesses
    foreach ($record in $tree) {
      try {
        $process = Get-Process -Id $record.ProcessId -ErrorAction Stop
        if ($process.MainWindowHandle -ne 0) {
          if ($null -eq $readyMilliseconds) {
            $readyMilliseconds = $clock.ElapsedMilliseconds
            $readyProcessId = $process.Id
          }
          [EduCanvasPackageWindow]::ShowWindow($process.MainWindowHandle, 0) | Out-Null
        }
      } catch {}
    }
    if ($null -ne $readyMilliseconds) { break }
    Start-Sleep -Milliseconds 25
  } while ((Get-Date) -lt $deadline)

  if ($null -eq $readyMilliseconds) {
    throw "The package did not create a window within $ReadyTimeoutSeconds seconds."
  }

  $tree = Get-RecordedProcessTree $root.Id
  Remember-RecordedProcessTree $tree $recordedProcesses
  Hide-RecordedWindows $tree
  $cpuBefore = @{}
  foreach ($record in $tree) {
    try {
      $cpuBefore[$record.ProcessId] = (Get-Process -Id $record.ProcessId -ErrorAction Stop).CPU
    } catch {}
  }
  Start-Sleep -Seconds $IdleSampleSeconds

  $tree = Get-RecordedProcessTree $root.Id
  Remember-RecordedProcessTree $tree $recordedProcesses
  Hide-RecordedWindows $tree
  $cpuDelta = 0.0
  $workingSetBytes = 0L
  $privateMemoryBytes = 0L
  $responding = $true
  foreach ($record in $tree) {
    try {
      $process = Get-Process -Id $record.ProcessId -ErrorAction Stop
      if ($cpuBefore.ContainsKey($record.ProcessId)) {
        $cpuDelta += $process.CPU - $cpuBefore[$record.ProcessId]
      }
      $workingSetBytes += $process.WorkingSet64
      $privateMemoryBytes += $process.PrivateMemorySize64
      $responding = $responding -and $process.Responding
    } catch {}
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $ResolvedExecutable
  $artifact = Get-Item -LiteralPath $ResolvedExecutable
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $ResolvedExecutable
  $result = [ordered]@{
    schema = 'educanvas.desktop.windows-performance.v1'
    measuredAt = $startedAt.ToUniversalTime().ToString('o')
    mode = $Mode
    executable = $artifact.Name
    sha256 = $hash.Hash
    signature = $signature.Status.ToString()
    artifactBytes = $artifact.Length
    readyMilliseconds = $readyMilliseconds
    readyProcessId = $readyProcessId
    processCount = @($tree).Count
    responding = $responding
    idleSampleSeconds = $IdleSampleSeconds
    hiddenIdleCpuPercent = [math]::Round(
      ($cpuDelta / $IdleSampleSeconds / [Environment]::ProcessorCount) * 100,
      2
    )
    workingSetBytes = $workingSetBytes
    privateMemoryBytes = $privateMemoryBytes
  }
} finally {
  if (-not $KeepRunning) {
    Remember-RecordedProcessTree (Get-RecordedProcessTree $root.Id) $recordedProcesses
    $recordedTree = @($recordedProcesses.Values) | Sort-Object Depth -Descending
    foreach ($record in $recordedTree) {
      # Keep descendants observed before a short-lived portable launcher exits,
      # while requiring the live PID to retain the recorded creation time.
      if ($record.CreationDate -lt $startedAt) { continue }
      $pidValue = [int]$record.ProcessId
      $liveRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
      if (-not $liveRecord -or $liveRecord.CreationDate -ne $record.CreationDate) { continue }
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }
}

if ($null -ne $result) {
  $result | ConvertTo-Json -Depth 3
}

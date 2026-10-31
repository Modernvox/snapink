[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$statePath = Join-Path $repo '.wrangler\snapink-backend-desktop.json'

function Get-ProcessInfo([int]$processId) {
  if ($processId -le 0) { return $null }
  Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
}

function Get-CommandHash([string]$commandLine) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($commandLine)
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-CreationDate([object]$value) {
  if ($value -is [datetime]) { return $value.ToUniversalTime() }
  if (-not $value) { return $null }
  $parsed = [datetime]::MinValue
  if ([datetime]::TryParse([string]$value, [Globalization.CultureInfo]::CurrentCulture,
      [Globalization.DateTimeStyles]::AssumeLocal, [ref]$parsed)) { return $parsed.ToUniversalTime() }
  try { return [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$value).ToUniversalTime() } catch { return $null }
}

function Get-CreationStamp([object]$value) {
  $date = Get-CreationDate $value
  if ($date) { return $date.ToString('o') }
  return ''
}

function Test-ProcessRecord($processInfo, $pidValue, $creationValue, $hashValue) {
  if (-not $processInfo -or [int]$processInfo.ProcessId -ne [int]$pidValue) { return $false }
  if ($creationValue -and (Get-CreationStamp $processInfo.CreationDate) -ne (Get-CreationStamp $creationValue)) { return $false }
  if ($hashValue -and (Get-CommandHash ([string]$processInfo.CommandLine)) -ne [string]$hashValue) { return $false }
  return $true
}

function Test-DescendantOf([int]$processId, [int]$ancestorId, $processes) {
  if ($processId -le 0 -or $ancestorId -le 0) { return $false }
  $byId = @{}
  foreach ($item in $processes) { $byId[[int]$item.ProcessId] = $item }
  $seen = @{}
  $current = $byId[$processId]
  for ($depth = 0; $current -and $depth -lt 32; $depth++) {
    $parentId = [int]$current.ParentProcessId
    if ($parentId -eq $ancestorId) { return $true }
    if ($parentId -le 0 -or $seen.ContainsKey($parentId)) { return $false }
    $seen[$parentId] = $true
    $parent = $byId[$parentId]
    if (-not $parent) { return $false }
    try {
      $childStart = Get-CreationDate $current.CreationDate
      $parentStart = Get-CreationDate $parent.CreationDate
      if (-not $childStart -or -not $parentStart) { return $false }
      if ($childStart -lt $parentStart) { return $false }
    } catch { return $false }
    $current = $parent
  }
  return $false
}

function Find-WranglerProcess($savedState, $processes) {
  $port = [int]$savedState.Port
  if ($port -lt 1 -or $port -gt 65535) { return @() }
  $persistPath = [string]$savedState.PersistPath
  if (-not $persistPath) { $persistPath = Join-Path $repo '.wrangler\snapink-backend-desktop' }
  if (-not $persistPath -or -not [IO.Path]::IsPathRooted($persistPath)) { return @() }
  $runId = [string]$savedState.RunId
  $wrapperId = [int]$savedState.WrapperPid
  $wrapper = Get-ProcessInfo $wrapperId
  $wrapperIsSaved = Test-ProcessRecord $wrapper $wrapperId $savedState.WrapperCreationDate $savedState.WrapperCommandHash
  if (-not $runId -and $wrapperId -le 0) {
    # The original launcher stored the cmd.exe wrapper PID in ServerPid. Recover
    # that owner only when its command itself names this isolated Wrangler run.
    $legacyId = [int]$savedState.ServerPid
    $legacyWrapper = Get-ProcessInfo $legacyId
    $legacyCommand = if ($legacyWrapper) { [string]$legacyWrapper.CommandLine } else { '' }
    $legacyPersist = [string]$savedState.PersistPath
    if (-not $legacyPersist) { $legacyPersist = Join-Path $repo '.wrangler\snapink-backend-desktop' }
    $legacyValid = $legacyWrapper -and $legacyWrapper.Name -match '^(?i:cmd)(\.exe)?$' -and
      $legacyCommand -match '(?i)wrangler.*pages\s+dev\s+dist' -and
      $legacyCommand -match "(?i)--port\s+$([int]$savedState.Port)(?:\s|$)" -and
      $legacyCommand -match '(?i)SNAPINK_LOCAL_E2E=true' -and
      $legacyPersist -and $legacyCommand.IndexOf($legacyPersist, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($legacyValid -and $savedState.ServerCreationDate) {
      $legacyValid = Test-ProcessRecord $legacyWrapper $legacyId $savedState.ServerCreationDate $savedState.ServerCommandHash
    }
    if ($legacyValid) { $wrapperId = $legacyId; $wrapperIsSaved = $true }
  }
  if (-not $wrapperIsSaved) { $wrapperId = 0 }

  $matches = @($processes | Where-Object {
    $process = $_
    $commandLine = [string]$process.CommandLine
    $valid = $process.Name -match '^(?i:node)(\.exe)?$' -and
      $commandLine -match '(?i)wrangler.*pages\s+dev\s+dist' -and
      $commandLine -match "(?i)--port\s+$port(?:\s|$)" -and
      $commandLine.IndexOf($persistPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($runId) {
      $valid = $valid -and $commandLine.IndexOf("SNAPINK_BACKEND_RUN_ID=$runId", [StringComparison]::OrdinalIgnoreCase) -ge 0
    } else {
      # Older launchers did not save a run marker. Require their isolated local binding
      # and a verifiable child relationship to the recorded command wrapper.
      $valid = $valid -and $commandLine -match '(?i)SNAPINK_LOCAL_E2E=true' -and
        $wrapperId -gt 0 -and (Test-DescendantOf ([int]$process.ProcessId) $wrapperId $processes)
    }
    if ($valid -and $wrapperId -gt 0) {
      $valid = Test-DescendantOf ([int]$process.ProcessId) $wrapperId $processes
    }
    $valid
  })

  if ($matches.Count -eq 1) { return $matches }
  if ($matches.Count -gt 1) {
    # Resolve npm's Windows shim plus the actual Wrangler CLI child by selecting
    # the deepest matching process, which owns the Pages worker process.
    $leafMatches = @($matches | Where-Object {
      $candidate = $_
      $matchingChildren = @($matches | Where-Object {
        ([int]$_.ProcessId -ne [int]$candidate.ProcessId) -and
          (Test-DescendantOf ([int]$_.ProcessId) ([int]$candidate.ProcessId) $processes)
      })
      $matchingChildren.Count -eq 0
    })
    if ($leafMatches.Count -eq 1) { return $leafMatches }
  }
  return @()
}

function Initialize-SafeTerminator {
  if ('SnapInkProcessTerminator' -as [type]) { return }
  $source = @'
using System;
using System.Runtime.InteropServices;
public static class SnapInkProcessTerminator {
    [StructLayout(LayoutKind.Sequential)] public struct FILETIME { public uint Low; public uint High; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static bool TerminateIfCreationMatches(int pid, long expectedFileTime) {
        const uint PROCESS_TERMINATE = 0x0001, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, SYNCHRONIZE = 0x00100000;
        IntPtr handle = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, (uint)pid);
        if (handle == IntPtr.Zero) return false;
        try {
            FILETIME creation, exit, kernel, user;
            if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) return false;
            long actual = unchecked((long)(((ulong)creation.High << 32) | creation.Low));
            // WMI/.NET timestamps can differ from the native FILETIME by a few ticks.
            // A 1 ms tolerance covers representation rounding while rejecting a reused PID.
            long delta = actual >= expectedFileTime ? actual - expectedFileTime : expectedFileTime - actual;
            if (delta > 10000) return false;
            return TerminateProcess(handle, 1);
        } finally { CloseHandle(handle); }
    }
}
'@
  Add-Type -TypeDefinition $source -ErrorAction Stop
}

function Stop-VerifiedProcess($processInfo) {
  if (-not $processInfo) { return $false }
  try {
    $created = Get-CreationDate $processInfo.CreationDate
    if (-not $created) { return $false }
    $expectedFileTime = $created.ToFileTimeUtc()
    Initialize-SafeTerminator
    return [SnapInkProcessTerminator]::TerminateIfCreationMatches([int]$processInfo.ProcessId, [long]$expectedFileTime)
  } catch { return $false }
}

function Remove-StateIfSameRun($stateToRemove) {
  if (-not (Test-Path -LiteralPath $statePath)) { return }
  try { $current = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $current = $null }
  if (-not $current) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue; return }
  if ([string]$current.RunId -eq [string]$stateToRemove.RunId -and
      [int]$current.LauncherPid -eq [int]$stateToRemove.LauncherPid -and
      [string]$current.LauncherCreationDate -eq [string]$stateToRemove.LauncherCreationDate) {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $statePath)) {
  Write-Host 'No SnapInk Backend started by the launcher is currently tracked.' -ForegroundColor Yellow
  exit 0
}

try {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $wranglerMatches = @(Find-WranglerProcess $state $processes)
  if ($wranglerMatches.Count -ne 1) {
    Remove-StateIfSameRun $state
    Write-Host 'No matching SnapInk backend is running. Stale tracking information was removed; no processes were stopped.' -ForegroundColor Yellow
    exit 0
  }

  $wrangler = $wranglerMatches[0]
  if ([int]$state.ServerPid -gt 0 -and [int]$state.ServerPid -eq [int]$wrangler.ProcessId) {
    if (-not (Test-ProcessRecord $wrangler $state.ServerPid $state.ServerCreationDate $state.ServerCommandHash)) {
      Remove-StateIfSameRun $state
      Write-Host 'The saved Wrangler PID has been reused or changed. No process was stopped; stale tracking information was removed.' -ForegroundColor Yellow
      exit 0
    }
  }

  # Capture and stop only descendants owned by this uniquely identified Wrangler
  # process. Process creation times are rechecked on an open Windows process handle
  # immediately before termination to make PID reuse safe.
  $owned = @($processes | Where-Object { Test-DescendantOf ([int]$_.ProcessId) ([int]$wrangler.ProcessId) $processes })
  $ordered = @($owned | Sort-Object { (Get-CreationDate $_.CreationDate).Ticks } -Descending)
  $stopped = 0
  foreach ($child in $ordered) {
    if (Stop-VerifiedProcess $child) { $stopped++ }
  }
  if (Stop-VerifiedProcess $wrangler) { $stopped++ }

  Start-Sleep -Milliseconds 500
  Remove-StateIfSameRun $state
  if ($stopped -gt 0) {
    Write-Host "SnapInk local backend stopped. Stopped $stopped verified project process(es); unrelated processes were not targeted." -ForegroundColor Green
  } else {
    Write-Host 'The matching SnapInk backend exited before it could be stopped. Tracking information was cleaned up.' -ForegroundColor Yellow
  }
} catch {
  Write-Host "Stop SnapInk Backend error: $($_.Exception.Message)" -ForegroundColor Red
  if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close this window' | Out-Null }
  exit 1
}

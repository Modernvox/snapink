[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$startScript = (Resolve-Path $PSCommandPath).Path
$statePath = Join-Path $repo '.wrangler\snapink-backend-desktop.json'
$projectRoot = Join-Path $env:TEMP 'SnapInkBackendRuntime'
$persistPath = Join-Path $repo '.wrangler\snapink-backend-desktop'
$port = 8799
$baseUrl = "http://127.0.0.1:$port"
$dashboardUrl = "$baseUrl/admin"
$server = $null
$ownsState = $false
$runId = [guid]::NewGuid().ToString('N')
$state = $null

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

function Get-ProcessRecord($processInfo) {
  if (-not $processInfo) { return $null }
  return [ordered]@{
    Pid = [int]$processInfo.ProcessId
    Name = [string]$processInfo.Name
    CreationDate = [string]$processInfo.CreationDate
    CommandHash = Get-CommandHash ([string]$processInfo.CommandLine)
  }
}

function Save-TrackingState {
  $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Get-ProcessInfo([int]$processId) {
  if ($processId -le 0) { return $null }
  Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
}

function Test-LauncherProcess($processInfo, $savedState) {
  if (-not $processInfo -or $processInfo.Name -notmatch '^(powershell|pwsh)(\.exe)?$') { return $false }
  if ($processInfo.CommandLine -notmatch '(?i)tools[\\/]start-snapink-backend\.ps1') { return $false }
  # The current launcher can be invoked with a relative -File path, so its own PID
  # is verified by the script currently executing. For an existing run, require the
  # absolute project path plus the saved creation time and command hash.
  if ([int]$processInfo.ProcessId -ne $PID -and
      $processInfo.CommandLine.IndexOf($repo, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  if ($savedState.LauncherCreationDate -and (Get-CreationStamp $processInfo.CreationDate) -ne (Get-CreationStamp $savedState.LauncherCreationDate)) { return $false }
  if ($savedState.LauncherCommandHash -and (Get-CommandHash ([string]$processInfo.CommandLine)) -ne [string]$savedState.LauncherCommandHash) { return $false }
  return $true
}

function Test-WranglerProcess($processInfo, $savedState) {
  if (-not $processInfo -or $processInfo.Name -notmatch '^node(\.exe)?$') { return $false }
  $commandLine = [string]$processInfo.CommandLine
  if ($commandLine -notmatch '(?i)wrangler.*pages\s+dev\s+dist') { return $false }
  if ($commandLine -notmatch "(?i)--port\s+$([int]$savedState.Port)(?:\s|$)") { return $false }
  $expectedPersist = [string]$savedState.PersistPath
  if (-not $expectedPersist -or $commandLine.IndexOf($expectedPersist, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  if ($savedState.RunId) {
    if ($commandLine.IndexOf("SNAPINK_BACKEND_RUN_ID=$($savedState.RunId)", [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  } elseif ($commandLine -notmatch '(?i)SNAPINK_LOCAL_E2E=true') { return $false }
  return $true
}

function Test-DescendantOf([int]$processId, [int]$ancestorId, $processes) {
  if ($processId -le 0 -or $ancestorId -le 0) { return $false }
  $byId = @{}
  foreach ($item in $processes) { $byId[[int]$item.ProcessId] = $item }
  $seen = @{}
  $current = $byId[$processId]
  for ($depth = 0; $current -and $depth -lt 24; $depth++) {
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

function Find-WranglerProcess($savedState) {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $wrapperId = [int]$savedState.WrapperPid
  $wrapper = if ($wrapperId -gt 0) { Get-ProcessInfo $wrapperId } else { $null }
  if ($wrapper -and $savedState.WrapperCreationDate -and (Get-CreationStamp $wrapper.CreationDate) -ne (Get-CreationStamp $savedState.WrapperCreationDate)) { $wrapper = $null }
  $candidates = @($processes | Where-Object {
    (Test-WranglerProcess $_ $savedState) -and
    ($wrapperId -le 0 -or -not $wrapper -or (Test-DescendantOf ([int]$_.ProcessId) $wrapperId $processes))
  })
  if ($candidates.Count -eq 1) { return $candidates[0] }
  if ($candidates.Count -gt 1) {
    # npm's Windows shim can leave both a Wrangler .bin process and its actual
    # wrangler-dist CLI child with the same arguments. Track the deepest matching
    # CLI process, which owns the Pages worker and is the process to stop.
    $leafCandidates = @($candidates | Where-Object {
      $candidate = $_
      $matchingChildren = @($candidates | Where-Object {
        ([int]$_.ProcessId -ne [int]$candidate.ProcessId) -and
        (Test-DescendantOf ([int]$_.ProcessId) ([int]$candidate.ProcessId) $processes)
      })
      $matchingChildren.Count -eq 0
    })
    if ($leafCandidates.Count -eq 1) { return $leafCandidates[0] }
  }
  return $null
}

function Wait-ForWranglerProcess([int]$seconds, $savedState) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    $processInfo = Find-WranglerProcess $savedState
    if ($processInfo) { return $processInfo }
    if ($script:server -and $script:server.HasExited) { return $null }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Test-ApiReady {
  try {
    $null = Invoke-WebRequest -Uri "$baseUrl/api/admin/orders" -UseBasicParsing -TimeoutSec 3
    return $false
  } catch {
    return $null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401
  }
}

function Wait-ForBackend([int]$seconds, [int]$launcherPid = 0) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if (Test-ApiReady) { return $true }
    if ($launcherPid -gt 0 -and $null -eq (Get-ProcessInfo $launcherPid)) { return $false }
    if ($script:server -and $script:server.HasExited) { return $false }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Open-Dashboard {
  Start-Process $dashboardUrl
  Write-Host "SnapInk local dashboard opened: $dashboardUrl" -ForegroundColor Green
}

try {
  Push-Location $repo

  if (Test-Path -LiteralPath $statePath) {
    $existing = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existingLauncher = Get-ProcessInfo ([int]$existing.LauncherPid)
    if (Test-LauncherProcess $existingLauncher $existing) {
      Write-Host 'SnapInk Backend is already starting or running. Reusing it.' -ForegroundColor Yellow
      if (Wait-ForBackend 120 ([int]$existing.LauncherPid)) {
        Open-Dashboard
        return
      }
      throw 'The tracked SnapInk backend did not become ready. Check its original terminal for the startup error.'
    }
    $existingServer = Get-ProcessInfo ([int]$existing.ServerPid)
    $existingServerRecordMatches = $existingServer -and (Test-WranglerProcess $existingServer $existing)
    if ($existingServerRecordMatches -and $existing.ServerCreationDate -and
        (Get-CreationStamp $existingServer.CreationDate) -ne (Get-CreationStamp $existing.ServerCreationDate)) { $existingServerRecordMatches = $false }
    if ($existingServerRecordMatches -and $existing.ServerCommandHash -and
        (Get-CommandHash ([string]$existingServer.CommandLine)) -ne [string]$existing.ServerCommandHash) { $existingServerRecordMatches = $false }
    if ($existingServerRecordMatches) {
      Write-Host 'The isolated SnapInk Pages server is already running. Reusing it.' -ForegroundColor Yellow
      if (Wait-ForBackend 30) { Open-Dashboard; return }
      throw 'The tracked Pages server exists but its API did not become ready.'
    }
    Remove-Item -LiteralPath $statePath -Force
  }

  $portUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portUse) {
    $owner = Get-ProcessInfo ([int]$portUse.OwningProcess)
    $description = if ($owner) { "$($owner.Name) PID $($owner.ProcessId)" } else { "PID $($portUse.OwningProcess)" }
    throw "Port $port is already in use by $description. No process was stopped; close that service or choose a free port."
  }

  $varsPath = Join-Path $repo '.dev.vars'
  if (-not (Test-Path -LiteralPath $varsPath)) {
    throw 'The local .dev.vars file is missing. Create local admin credentials before starting the dashboard.'
  }
  $varsText = Get-Content -LiteralPath $varsPath -Raw
  $adminMatch = [regex]::Match($varsText, '(?m)^ADMIN_REVIEW_TOKEN=(.+)\s*$')
  if (-not $adminMatch.Success) { throw 'ADMIN_REVIEW_TOKEN is missing from .dev.vars.' }
  $adminToken = $adminMatch.Groups[1].Value.Trim()

  Write-Host 'Building the dashboard and frontend...' -ForegroundColor Cyan
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }

  New-Item -ItemType Directory -Force -Path (Split-Path $statePath) | Out-Null
  $launcherInfo = Get-ProcessInfo $PID
  if (-not (Test-LauncherProcess $launcherInfo @{ })) { throw 'Could not verify the SnapInk PowerShell launcher process.' }
  $state = [ordered]@{
    SchemaVersion = 2; RunId = $runId; ProjectRoot = $repo; RuntimeRoot = $projectRoot; PersistPath = $persistPath
    Port = $port; Phase = 'starting'; LauncherPid = $PID
    LauncherCreationDate = Get-CreationStamp $launcherInfo.CreationDate
    LauncherCommandHash = Get-CommandHash ([string]$launcherInfo.CommandLine)
    WrapperPid = 0; WrapperCreationDate = ''; WrapperCommandHash = ''
    ServerPid = 0; ServerCreationDate = ''; ServerCommandHash = ''; StartedAt = (Get-Date).ToString('o')
  }
  Save-TrackingState
  $ownsState = $true

  Write-Host 'Applying migrations to the isolated local D1 database...' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $projectRoot | Out-Null
  foreach ($directory in @('dist','functions','migrations')) {
    $generatedPath = Join-Path $projectRoot $directory
    if (Test-Path -LiteralPath $generatedPath) {
      $item = Get-Item -LiteralPath $generatedPath -Force
      if ($item.LinkType) { throw "Generated runtime path '$generatedPath' is a link; refusing to replace it." }
      if ((Resolve-Path -LiteralPath $generatedPath).Path -ne $generatedPath) { throw "Generated runtime path '$generatedPath' resolves unexpectedly." }
      Remove-Item -LiteralPath $generatedPath -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $repo $directory) -Destination $projectRoot -Recurse
  }
  foreach ($relativeFile in @('scripts\photo-render\cad-assets.json','scripts\production-model-manifest.json','scripts\production-release-state.json','src\config\sleeveGeometry.ts')) {
    $destination = Join-Path $projectRoot $relativeFile
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo $relativeFile) -Destination $destination -Force
  }
  Copy-Item -LiteralPath (Join-Path $repo 'wrangler.test.toml') -Destination (Join-Path $projectRoot 'wrangler.toml') -Force
  Copy-Item -LiteralPath $varsPath -Destination (Join-Path $projectRoot '.dev.vars') -Force
  $originalCi = $env:CI
  $env:CI = '1'
  Push-Location $projectRoot
  try {
    & npm.cmd exec --yes --offline --package=wrangler@4.86.0 -- wrangler d1 migrations apply snapink-isolated-order-test --local --persist-to $persistPath
    $migrationExit = $LASTEXITCODE
  } finally {
    Pop-Location
    if ($null -eq $originalCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $originalCi }
  }
  if ($migrationExit -ne 0) { throw "Local D1 migrations failed with exit code $migrationExit." }

  $wranglerCommand = "cd /d `"$projectRoot`" && npm.cmd exec --yes --offline --package=wrangler@4.86.0 -- wrangler pages dev dist --ip 127.0.0.1 --port $port --d1 DB=00000000-0000-0000-0000-000000000001 --r2 PRIVATE_ASSETS=snapink-isolated-private-test --r2 MODEL_BUCKET=snapink-isolated-models-test --r2 BACKUP_BUCKET=snapink-isolated-backups-test --binding ENVIRONMENT=isolated-local-test --binding SNAPINK_LOCAL_E2E=true --binding SNAPINK_BACKEND_RUN_ID=$runId --persist-to `"$persistPath`" --show-interactive-dev-session=false"
  Write-Host "Starting local Pages Functions on $baseUrl (Ctrl+C closes this launcher)." -ForegroundColor Cyan
  $server = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$wranglerCommand`"" -WorkingDirectory $projectRoot -NoNewWindow -PassThru
  $wrapperInfo = Get-ProcessInfo $server.Id
  if (-not $wrapperInfo) { throw 'Could not verify the isolated Wrangler command wrapper.' }
  $state.WrapperPid = [int]$wrapperInfo.ProcessId
  $state.WrapperCreationDate = Get-CreationStamp $wrapperInfo.CreationDate
  $state.WrapperCommandHash = Get-CommandHash ([string]$wrapperInfo.CommandLine)
  Save-TrackingState

  if (-not (Wait-ForBackend 120 $PID)) {
    if ($server.HasExited) { throw "Wrangler Pages exited during startup (exit code $($server.ExitCode))." }
    throw "Local API did not become ready within 120 seconds at $baseUrl."
  }
  $wranglerInfo = Wait-ForWranglerProcess 15 $state
  if (-not $wranglerInfo) { throw 'The local API responded, but its isolated Wrangler process could not be verified.' }
  $state.ServerPid = [int]$wranglerInfo.ProcessId
  $state.ServerCreationDate = Get-CreationStamp $wranglerInfo.CreationDate
  $state.ServerCommandHash = Get-CommandHash ([string]$wranglerInfo.CommandLine)
  $state.Phase = 'running'
  Save-TrackingState
  $dashboardResponse = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 10
  if ([int]$dashboardResponse.StatusCode -ne 200) { throw "Dashboard returned HTTP $($dashboardResponse.StatusCode)." }

  try {
    $orders = Invoke-RestMethod -Uri "$baseUrl/api/admin/orders" -Headers @{ Authorization = "Bearer $adminToken" } -TimeoutSec 15
    if ($null -eq $orders.orders) { throw 'The local orders API returned an unexpected response.' }
  } catch {
    throw "Local D1/API verification failed: $($_.Exception.Message)"
  }

  Write-Host 'Local Pages API, D1-backed admin orders endpoint, and dashboard are ready.' -ForegroundColor Green
  Open-Dashboard
  Write-Host 'This terminal shows backend logs. Close it or use the Stop SnapInk Backend shortcut to stop only this local service.' -ForegroundColor Green

  while (-not $server.HasExited) { Start-Sleep -Seconds 1 }
  if ($server.ExitCode -ne 0) {
    # The Stop shortcut terminates the verified Wrangler process, which can leave
    # cmd.exe without an exit code. Wait briefly for that script to clear this run's
    # state, then treat the exit as intentional. Retain errors for untracked exits.
    $shutdownDeadline = (Get-Date).AddSeconds(5)
    do {
      $savedState = if (Test-Path -LiteralPath $statePath) {
        Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
      } else { $null }
      if (-not $savedState -or [string]$savedState.RunId -ne $runId) { break }
      Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $shutdownDeadline)
    if ($savedState -and [string]$savedState.RunId -eq $runId) {
      throw "Wrangler Pages stopped unexpectedly with exit code $($server.ExitCode)."
    }
  }
  Write-Host 'SnapInk local backend stopped.' -ForegroundColor Yellow
} catch {
  Write-Host "SnapInk Backend startup error: $($_.Exception.Message)" -ForegroundColor Red
  if ($server -and -not $server.HasExited) {
    $wrapperInfo = Get-ProcessInfo $server.Id
    if ($wrapperInfo -and $state -and (Get-CreationStamp $wrapperInfo.CreationDate) -eq [string]$state.WrapperCreationDate -and
        (Get-CommandHash ([string]$wrapperInfo.CommandLine)) -eq [string]$state.WrapperCommandHash) {
      & taskkill.exe /PID $server.Id /T /F 2>$null | Out-Null
    }
  }
  if ($ownsState -and (Test-Path -LiteralPath $statePath)) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
  if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close this window' | Out-Null }
  exit 1
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  if ($ownsState -and $server -and $server.HasExited -and (Test-Path -LiteralPath $statePath)) {
    $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($saved -and [int]$saved.LauncherPid -eq $PID) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
  }
}

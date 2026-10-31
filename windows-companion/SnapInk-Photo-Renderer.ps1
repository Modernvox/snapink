param(
  [string]$ApiBase,
  [string]$StateRoot,
  [string]$ConfigPath,
  [string]$BlenderPath = (Join-Path $env:LOCALAPPDATA 'SnapInk\Blender45\blender-4.5.15-windows-x64\blender.exe'),
  [string]$CadRoot = 'C:\Users\lovei\OneDrive\Documents\snapink_cad',
  [switch]$Once,
  [int]$PollSeconds = 10
)
$ErrorActionPreference='Stop'
$Workspace=Split-Path $PSScriptRoot -Parent
if(-not $StateRoot){$StateRoot=Join-Path $env:LOCALAPPDATA 'SnapInk\PhotoRenderer'}
$Config=if($ConfigPath){$ConfigPath}else{Join-Path (Join-Path $env:LOCALAPPDATA 'SnapInk\ProductionCompanion') 'companion.json'}
$Jobs=Join-Path $StateRoot 'Jobs';$Log=Join-Path $StateRoot 'photo-renderer.log'
New-Item -ItemType Directory -Force -Path $StateRoot,$Jobs|Out-Null
function Log([string]$m){$line="$(Get-Date -Format o) $m";Add-Content -LiteralPath $Log -Value $line -Encoding utf8;Write-Host $line}
if(-not(Test-Path -LiteralPath $Config)){throw 'Pair the SnapInk Windows companion first using the existing owner pairing flow.'}
$c=Get-Content -LiteralPath $Config -Raw|ConvertFrom-Json
if(-not $ApiBase){$ApiBase=[string]$c.ApiBase};$ApiBase=$ApiBase.TrimEnd('/')
if($ApiBase -notmatch '^https://' -and $ApiBase -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?/?$'){throw 'The photo renderer requires HTTPS except for loopback-only local development.'}
$secure=ConvertTo-SecureString ([string]$c.Token);$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);try{$Token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$Headers=@{Authorization="Bearer $Token"}
if(-not(Test-Path -LiteralPath $BlenderPath -PathType Leaf)){throw "Blender 4.5 LTS is not installed at '$BlenderPath'. Install only after owner approval."}
$versionText=& $BlenderPath --version 2>&1|Select-Object -First 1
if($LASTEXITCODE -ne 0 -or $versionText -notmatch 'Blender 4\.5\.') {throw "Expected Blender 4.5 LTS; found '$versionText'."}
if(-not(Test-Path -LiteralPath $CadRoot -PathType Container)){throw "Read-only SnapInk CAD root is unavailable: $CadRoot"}
$Catalog=Join-Path $Workspace 'scripts\photo-render\cad-assets.json';$Script=Join-Path $Workspace 'scripts\photo-render\blender_render.py';$OnHatScript=Join-Path $Workspace 'scripts\photo-render\render_on_hat_rear.py';$OnHatComposite=Join-Path $Workspace 'scripts\photo-render\composite_on_hat_rear.py';$OnHatReference=Join-Path $Workspace 'scripts\photo-render\on-hat-rear-reference.json'
if(-not(Test-Path -LiteralPath $Catalog) -or -not(Test-Path -LiteralPath $Script) -or -not(Test-Path -LiteralPath $OnHatScript) -or -not(Test-Path -LiteralPath $OnHatComposite) -or -not(Test-Path -LiteralPath $OnHatReference)){throw 'The local renderer scripts, locked On-Hat reference, or pinned CAD catalog are missing.'}
$catalogData=Get-Content -LiteralPath $Catalog -Raw|ConvertFrom-Json
function Set-PhotoStatus($id,$status,$message,$progress=1,$stage='rendering'){
  try{$body=@{jobId=$id;status=$status;message=$message;progress=$progress;stage=$stage}|ConvertTo-Json -Compress;Invoke-RestMethod -Uri "$ApiBase/api/photo-render/status" -Method Post -Headers $Headers -ContentType 'application/json' -Body $body|Out-Null}catch{Log "Could not report photo job ${id}: $($_.Exception.Message)"}
}
function Set-RendererHeartbeat([string]$state,[string]$message,[string]$jobId=$null){
  try{$body=@{state=$state;message=$message;currentJobId=$jobId}|ConvertTo-Json -Compress;Invoke-RestMethod -Uri "$ApiBase/api/photo-render/heartbeat" -Method Post -Headers $Headers -ContentType 'application/json' -Body $body|Out-Null}catch{Log "Could not report renderer status '$state': $($_.Exception.Message)"}
}
function Get-GpuMemoryUsedMb{
  $nvidia=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue;if(-not $nvidia){return $null}
  try{$values=& $nvidia.Source --query-gpu=memory.used --format=csv,noheader,nounits 2>$null;if($LASTEXITCODE -ne 0){return $null};$numbers=@($values|ForEach-Object{[int]($_.Trim())}|Where-Object{$_ -ge 0});if($numbers.Count){return ($numbers|Measure-Object -Maximum).Maximum};return $null}catch{return $null}
}
function Process-Photo($job){
  $id=[string]$job.id;$dir=Join-Path $Jobs $id;New-Item -ItemType Directory -Force -Path $dir|Out-Null
  try{
    $settings=$job.settings;$asset=$catalogData.configurations|Where-Object {$_.variant -eq $settings.variant -and [int]$_.size -eq [int]$settings.size}|Select-Object -First 1
    if(-not $asset -or -not $asset.renderEligible){throw 'Selected CAD configuration is missing or explicitly on validation hold.'}
    $mesh=Join-Path $CadRoot ([string]$asset.assetRelativePath -replace '/', '\')
    if(-not(Test-Path -LiteralPath $mesh -PathType Leaf)){throw "Read-only sleeve STL was not found: $mesh"}
    if((Get-FileHash -LiteralPath $mesh -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$asset.sha256).ToLowerInvariant()){throw 'Read-only sleeve STL hash does not match the pinned photo catalog.'}
    Set-PhotoStatus $id 'rendering' 'Downloading artwork from private storage.' 8 'Downloading'
    $art=Join-Path $dir 'artwork.png';Invoke-WebRequest -Uri "$ApiBase$($job.fileUrl)" -Headers $Headers -OutFile $art -UseBasicParsing
    $actual=(Get-FileHash -LiteralPath $art -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -ne ([string]$job.sourceSha256).ToLowerInvariant()){throw 'Downloaded artwork SHA-256 did not match the server job record.'}
    $vectorizer=Join-Path $Workspace 'scripts\photo-render\vectorize_artwork.py';$vectorData=Join-Path $dir 'artwork-vectors.json';$vectorOut=Join-Path $dir 'vectorizer.stdout.log';$vectorErr=Join-Path $dir 'vectorizer.stderr.log'
    $vectorProc=Start-Process -FilePath 'py.exe' -ArgumentList @('-3.12',$vectorizer,'--artwork',$art,'--output',$vectorData) -PassThru -WindowStyle Hidden -RedirectStandardOutput $vectorOut -RedirectStandardError $vectorErr -Wait
    if($vectorProc.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $vectorData -PathType Leaf)){$detail=Get-Content -LiteralPath $vectorErr -Tail 12 -ErrorAction SilentlyContinue;throw "Artwork contour validation failed: $(($detail|Out-String).Trim())"}
    $vectors=Get-Content -LiteralPath $vectorData -Raw|ConvertFrom-Json;if([int]$vectors.schemaVersion -ne 4 -or ([string]$vectors.sourceSha256).ToLowerInvariant() -ne $actual){throw 'Artwork contour data does not match the verified source image.'}
    Set-PhotoStatus $id 'rendering' 'Verified mesh and artwork; preparing camera, materials, and lights.' 18 'Preparing scene'
    $manifest=[ordered]@{id=$id;sourceSha256=[string]$job.sourceSha256;settings=$settings}
    $jobFile=Join-Path $dir 'photo-job.json';$manifest|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $jobFile -Encoding utf8
    $onHat=[string]$settings.scene -eq 'on-hat-rear';$extension=if($onHat){'png'}else{'jpg'};$contentType=if($onHat){'image/png'}else{'image/jpeg'};$out=Join-Path $dir "product-photo.$extension";$renderScript=if($onHat){$OnHatScript}else{$Script};$passDir=Join-Path $dir 'on-hat-passes';Set-PhotoStatus $id 'rendering' $(if($onHat){'Rendering raised artwork for the locked On-Hat Rear View scene.'}else{'Rendering geometry-based SnapInk product photograph.'}) 30 'Rendering'
    $stdout=Join-Path $dir 'blender.stdout.log';$stderr=Join-Path $dir 'blender.stderr.log'
    $renderArgs=@('-b','-t','8','--python',$renderScript,'--','--job',$jobFile,'--cad-root',$CadRoot,'--asset-catalog',$Catalog,'--artwork',$art,'--vector-data',$vectorData,'--output',$out);if($onHat){$renderArgs+=@('--passes-dir',$passDir)}
    $proc=Start-Process -FilePath $BlenderPath -ArgumentList $renderArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline=(Get-Date).AddMinutes(25)
    $peakGpuMemory=$null;$lastStatus=Get-Date
    while(-not $proc.HasExited){if((Get-Date) -gt $deadline){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue;throw 'Blender exceeded the 25 minute per-photo render limit.'};if($proc.WaitForExit(1000)){break};$currentGpuMemory=Get-GpuMemoryUsedMb;if($null -ne $currentGpuMemory -and ($null -eq $peakGpuMemory -or $currentGpuMemory -gt $peakGpuMemory)){$peakGpuMemory=$currentGpuMemory};if(((Get-Date)-$lastStatus).TotalSeconds -ge 8){Set-PhotoStatus $id 'rendering' 'Blender render is running; exact render percentage is unavailable.' 30 'Rendering';$lastStatus=Get-Date};$proc.Refresh()}
    $proc.WaitForExit();$proc.Refresh()
    if($null -ne $proc.ExitCode -and $proc.ExitCode -ne 0){$renderLog=Get-Content -LiteralPath $stderr -Tail 15 -ErrorAction SilentlyContinue;throw "Blender render failed (exit $($proc.ExitCode)): $(($renderLog|Out-String).Trim())"}
    $metaLine=Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue|Where-Object{$_ -match '^\{\s*"ok"\s*:\s*true\s*,'}|Select-Object -Last 1
    if(-not $metaLine){$renderLog=Get-Content -LiteralPath $stderr -Tail 50 -ErrorAction SilentlyContinue;$rendererError=$renderLog|Where-Object{$_.Trim() -match '^(RuntimeError|ValueError|Exception):'}|Select-Object -Last 1;if($rendererError){throw "Blender rejected artwork: $($rendererError.Trim())"};throw "Blender completed but returned no render metrics: $(($renderLog|Out-String).Trim())"}
    $renderMetadata=$metaLine|ConvertFrom-Json
    if($renderMetadata.renderMode -ne $job.settings.renderMode -or $renderMetadata.renderEngine -ne $(if($job.settings.renderMode -eq 'fast'){'BLENDER_EEVEE_NEXT'}else{'CYCLES'})){throw 'Blender engine metadata did not match the requested quality mode.'}
    $generationMetadata=$null
    if($onHat){$reference=Get-Content -LiteralPath $OnHatReference -Raw|ConvertFrom-Json;if($renderMetadata.scene -ne 'on-hat-rear' -or $renderMetadata.masterImageId -ne $reference.masterImageId -or $renderMetadata.masterImageSha256 -ne $reference.masterImageSha256 -or $renderMetadata.calibrationVersion -ne $reference.calibrationVersion -or [double]$renderMetadata.artworkReliefMm -ne [double]$reference.referenceCad.reliefMm){throw 'On-Hat render did not match the locked master, calibration, or raised-relief reference.'};$compositeOut=Join-Path $dir 'composite.stdout.log';$compositeErr=Join-Path $dir 'composite.stderr.log';$composite=Start-Process -FilePath 'py.exe' -ArgumentList @('-3.12',$OnHatComposite,'--passes-dir',$passDir,'--metadata',(Join-Path $passDir 'render-metadata.json'),'--job',$jobFile,'--output',$out) -PassThru -WindowStyle Hidden -RedirectStandardOutput $compositeOut -RedirectStandardError $compositeErr -Wait;if($composite.ExitCode -ne 0){$detail=Get-Content -LiteralPath $compositeErr -Tail 12 -ErrorAction SilentlyContinue;throw "On-Hat composite failed: $(($detail|Out-String).Trim())"};$compositeLine=Get-Content -LiteralPath $compositeOut -ErrorAction SilentlyContinue|Where-Object{$_ -match '^\{.*"outsideMaskUnchanged"\s*:\s*true'}|Select-Object -Last 1;if(-not $compositeLine){throw 'On-Hat compositor returned no pixel-integrity proof.'};$generationMetadata=$compositeLine|ConvertFrom-Json;if($generationMetadata.masterImageId -ne $reference.masterImageId -or $generationMetadata.masterImageSha256 -ne $reference.masterImageSha256 -or $generationMetadata.calibrationVersion -ne $reference.calibrationVersion -or $generationMetadata.width -ne 1536 -or $generationMetadata.height -ne 1024 -or -not $generationMetadata.outsideMaskUnchanged){throw 'On-Hat output failed the locked-master pixel-integrity checks.'}}
    if(-not(Test-Path -LiteralPath $out -PathType Leaf)){throw 'Blender exited without producing a photo.'}
    Set-PhotoStatus $id 'rendering' 'Uploading finished photograph to private gallery storage.' 92 'Uploading'
    $resultHeaders=@{Authorization="Bearer $Token";'X-SnapInk-Render-Mode'=[string]$renderMetadata.renderMode;'X-SnapInk-Render-Engine'=[string]$renderMetadata.renderEngine;'X-SnapInk-Render-Duration-Ms'=[string]$renderMetadata.renderDurationMs;'X-SnapInk-Peak-Gpu-Memory-Mb'=if($null -eq $peakGpuMemory){'unknown'}else{[string]$peakGpuMemory};'X-SnapInk-Gpu-Warning'=[string]$renderMetadata.gpuWarning};if($generationMetadata){$resultHeaders['X-SnapInk-Output-Metadata']=$generationMetadata|ConvertTo-Json -Compress -Depth 8}
    Invoke-WebRequest -Uri "$ApiBase/api/photo-render/result?id=$id" -Method Post -Headers $resultHeaders -ContentType $contentType -InFile $out -UseBasicParsing|Out-Null
    Log "Photo job $id completed: $($renderMetadata.renderMode) / $($renderMetadata.renderEngine), $($renderMetadata.renderDurationMs) ms, peak sampled GPU memory $(if($null -eq $peakGpuMemory){'unavailable'}else{"$peakGpuMemory MB"})."
  }catch{$message=$_.Exception.Message;Set-PhotoStatus $id 'failed' $message 0 'Failed';Log "Photo job $id failed: $message"}
}
$renderMutex=[Threading.Mutex]::new($false,'Local\SnapInkPhotoRenderer')
if(-not $renderMutex.WaitOne(0)){throw 'Another SnapInk Photo Renderer is already active. Only one local render may use the GPU at a time.'}
try{Log "SnapInk Photo Renderer running. Blender=$versionText CAD=$CadRoot polling every $PollSeconds seconds; mode and engine are recorded; production queue is not used.";do{$q=$null;try{$manufacturingApp=Get-Process -ErrorAction SilentlyContinue|Where-Object{$_.ProcessName -match '^(OrcaSlicer|SnapmakerOrca|snapmaker-orca)$'};if($manufacturingApp){$names=($manufacturingApp|ForEach-Object ProcessName|Sort-Object -Unique)-join ', ';Set-RendererHeartbeat 'paused_orca' "Paused because $names is running.";$null=Log "Snapmaker Orca is running ($names); leaving photo jobs queued to avoid GPU contention."}else{$q=Invoke-RestMethod -Uri "$ApiBase/api/photo-render/next" -Headers $Headers -Method Get;if($q.job){Set-RendererHeartbeat 'rendering' 'Rendering a geometry-based SnapInk product photo.' ([string]$q.job.id);Process-Photo $q.job;Set-RendererHeartbeat 'idle' 'Renderer connected and waiting for work.'}else{Set-RendererHeartbeat 'idle' 'Renderer connected and waiting for work.'}}}catch{Log "Photo queue request failed: $($_.Exception.Message)";Set-RendererHeartbeat 'idle' "Queue request failed: $($_.Exception.Message)"};if(-not $Once -or $q.job){Start-Sleep -Seconds ([Math]::Max(3,$PollSeconds))}}while(-not $Once)}finally{$renderMutex.ReleaseMutex();$renderMutex.Dispose()}

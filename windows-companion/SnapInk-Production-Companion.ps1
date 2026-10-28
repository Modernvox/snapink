param([string]$ApiBase,[string]$OrcaPath,[string]$StateRoot,[switch]$Configure,[switch]$InstallAtLogon,[switch]$NoOpen,[switch]$Once,[int]$PollSeconds=15)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=Join-Path $env:LOCALAPPDATA 'SnapInk\ProductionCompanion'};$Root=$StateRoot;$Config=Join-Path $Root 'companion.json';$Jobs=Join-Path $Root 'Jobs';$Log=Join-Path $Root 'companion.log'
New-Item -ItemType Directory -Force -Path $Root,$Jobs|Out-Null
function Log([string]$m){$line="$(Get-Date -Format o) $m";Add-Content -LiteralPath $Log -Value $line -Encoding utf8;Write-Host $line}
function Configure-Companion {
 if(-not $ApiBase){$ApiBase=Read-Host 'SnapInk API base URL (https://...)'};$ApiBase=$ApiBase.TrimEnd('/')
 $u=[Uri]$ApiBase;if($u.Scheme -ne 'https' -and $u.Host -notin @('localhost','127.0.0.1')){throw 'HTTPS is required except on localhost.'}
 $secret=Read-Host 'One-time device token from SnapInk Order Desk' -AsSecureString
 [ordered]@{ApiBase=$ApiBase;Token=(ConvertFrom-SecureString $secret);OrcaPath=$OrcaPath}|ConvertTo-Json|Set-Content -LiteralPath $Config -Encoding utf8
 try{& icacls.exe $Root /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F'|Out-Null}catch{}
 Log 'Credential saved using Windows DPAPI for this account.'
}
if($Configure -or -not(Test-Path -LiteralPath $Config)){Configure-Companion}
$c=Get-Content -LiteralPath $Config -Raw|ConvertFrom-Json
if(-not $ApiBase){$ApiBase=[string]$c.ApiBase};$ApiBase=$ApiBase.TrimEnd('/');if(-not $OrcaPath){$OrcaPath=[string]$c.OrcaPath}
if(-not $OrcaPath){$OrcaPath='C:\Program Files\Snapmaker_Orca\snapmaker-orca.exe'}
if($InstallAtLogon){$path=$MyInvocation.MyCommand.Path;if(-not $path){throw 'Save this script before installing logon startup.'};$arg='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$path+'"';$act=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg;$trig=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME;Register-ScheduledTask -TaskName 'SnapInk Production Companion' -Action $act -Trigger $trig -Description 'Polls SnapInk orders; never starts printing.' -Force|Out-Null;Log 'Installed logon startup.';if(-not $Once){exit 0}}
if($OrcaPath -and (Test-Path -LiteralPath $OrcaPath)){$configuredInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo($OrcaPath);if($configuredInfo.ProductName -ne 'Snapmaker Orca' -or $configuredInfo.ProductVersion -ne '2.4.0'){$OrcaPath='C:\Program Files\Snapmaker_Orca\snapmaker-orca.exe'}}
if(-not $OrcaPath -or -not(Test-Path -LiteralPath $OrcaPath)){throw 'Snapmaker Orca was not found at C:\Program Files\Snapmaker_Orca\snapmaker-orca.exe.'}
$orcaInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo($OrcaPath)
if($orcaInfo.ProductName -ne 'Snapmaker Orca' -or $orcaInfo.ProductVersion -ne '2.4.0'){throw "Expected Snapmaker Orca 2.4.0; found $($orcaInfo.ProductName) $($orcaInfo.ProductVersion)."}
$secure=ConvertTo-SecureString ([string]$c.Token);$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);try{$Token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};$Headers=@{Authorization="Bearer $Token"}
function Update-Job([string]$id,[string]$state,[string]$message){try{Invoke-RestMethod -Uri "$ApiBase/api/production/file" -Method Post -Headers $Headers -ContentType 'application/json' -Body (@{jobId=$id;status=$state;message=$message}|ConvertTo-Json -Compress)|Out-Null}catch{Log "Could not report $state for $id : $($_.Exception.Message)"}}
function Update-Stage([string]$id,[string]$stage,[string]$message){try{Invoke-RestMethod -Uri "$ApiBase/api/production/file" -Method Post -Headers $Headers -ContentType 'application/json' -Body (@{jobId=$id;stage=$stage;message=$message}|ConvertTo-Json -Compress)|Out-Null}catch{Log "Could not report stage $stage for $id : $($_.Exception.Message)"}}
function Verify-Hash([string]$path,[string]$expected,[string]$kind){if(-not(Test-Path -LiteralPath $path)){throw "$kind is missing."};$actual=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();if($actual -ne ([string]$expected).ToLowerInvariant()){throw "$kind SHA-256 does not match the job manifest."}}
function Wait-ForOrcaProject([string]$projectName,[int]$timeoutSeconds=60){$deadline=(Get-Date).AddSeconds($timeoutSeconds);do{foreach($p in (Get-Process -Name 'snapmaker-orca' -ErrorAction SilentlyContinue)){$p.Refresh();if($p.MainWindowTitle -and $p.MainWindowTitle -like "*$projectName*" -and $p.MainWindowTitle -like '*Snapmaker Orca*'){return $p}};Start-Sleep -Milliseconds 750}while((Get-Date) -lt $deadline);return $null}
function Handle-Job($j){
 $id=[string]$j.id;$dir=Join-Path $Jobs $id;New-Item -ItemType Directory -Force -Path $dir|Out-Null;$marker=Join-Path $dir 'opened.marker'
 if(Test-Path -LiteralPath $marker){Update-Job $id 'opened' 'Previously opened locally; duplicate launch suppressed.';return}
 try{
  Update-Stage $id 'transferring_to_companion' 'Downloading and verifying the approved baseline and customer design files.'
  foreach($kind in @('model','artwork','source','preview')){
   $ext=switch($kind){model{'3mf'}artwork{'svg'}source{'bin'}preview{'png'}};$path=Join-Path $dir "$kind.$ext"
   Invoke-WebRequest -Uri "$ApiBase$($j.files.$kind)" -Headers $Headers -OutFile $path -UseBasicParsing
   $hash=switch($kind){model{$j.modelSha256}artwork{$j.artworkSha256}source{$j.sourceArtworkSha256}preview{$j.previewSha256}};Verify-Hash $path $hash $kind
   if($kind -eq 'model'){Add-Type -AssemblyName System.IO.Compression.FileSystem;$zip=[IO.Compression.ZipFile]::OpenRead($path);try{if(-not($zip.Entries|Where-Object FullName -eq '3D/3dmodel.model')){throw 'The project is not a valid 3MF model.'}}finally{$zip.Dispose()}}
   if($kind -eq 'artwork' -and ((Get-Content -LiteralPath $path -TotalCount 10|Out-String) -notmatch '<svg')){throw 'The production artwork is not valid SVG.'}
  }
  Update-Job $id 'downloaded' "Verified job files saved to $dir"
  Update-Stage $id 'preparing_artwork' 'Checking artwork format and requested sleeve configuration.'
  $configKey="$($j.variant)-$([int]$j.size)"
  if($j.variant -notin @('standard','billboard') -or [int]$j.size -notin 0..5){throw "Unsupported sleeve configuration $configKey; no customized project was produced."}
  $design=$j.draftJson|ConvertFrom-Json
  $workspace=Split-Path $PSScriptRoot -Parent
  $release=Get-Content (Join-Path $workspace 'scripts\production-release-state.json') -Raw|ConvertFrom-Json
  if($design.productionGeometryVersion -ne $release.geometryVersion -or $design.positioningVersion -ne $release.positioningVersion){throw 'This saved order uses an obsolete sleeve geometry or artwork-positioning system. Reopen it in the current Studio and create a new order.'}
  if([bool]$design.hasCustomArtwork -ne ([bool]($design.text.Trim() -or $design.logoName))){throw 'The order artwork-present flag does not match its saved customer design.'}
  if([Math]::Abs([double]$design.artworkCenterXmm-[double]$design.brandingCenterXmm) -gt 0.01 -and [string]$design.align -eq 'center'){throw 'Centered artwork coordinates do not match the CAD flap-valley-to-right-edge center.'}
  if($design.styleMode -ne 'emboss'){throw 'Only raised/embossed vector artwork is enabled in this production test. Flat artwork requires manual review.'}
  if([double]$design.logoOpacity -ne 100){throw 'Partially transparent artwork cannot be represented as single-color raised geometry without changing its appearance. Manual review required.'}
  $sourceArtwork=Join-Path $dir 'source.bin';$sourceHeader=Get-Content -LiteralPath $sourceArtwork -TotalCount 3 -ErrorAction SilentlyContinue|Out-String;$manufacturingSvg=$sourceArtwork
  $cadRoot=Join-Path (Split-Path $workspace -Parent) 'snapink_cad';$python=Join-Path $cadRoot 'cq_env\Scripts\python.exe';$generator=Join-Path $workspace 'scripts\production\generate_vector_relief.py'
  $cadCatalogPath=Join-Path $workspace 'scripts\production\cad-reference-manifest.json';if(-not(Test-Path -LiteralPath $cadCatalogPath)){throw 'Hash-pinned approved CAD reference catalog is missing.'}
  $cadCatalog=Get-Content -LiteralPath $cadCatalogPath -Raw|ConvertFrom-Json;$cadProfile=$cadCatalog.profiles|Where-Object {$_.variant -eq $j.variant -and [int]$_.size -eq [int]$j.size}|Select-Object -First 1
  if(-not $cadProfile){throw "No hash-pinned sleeve/support CAD profile exists for $configKey."}
  $sleeveStep=Join-Path $cadRoot ([string]$cadProfile.sleeveStep -replace '/', '\');$supportStep=Join-Path $cadRoot ([string]$cadProfile.supportStep -replace '/', '\')
  foreach($required in @($python,$generator,$sleeveStep,$supportStep)){if(-not(Test-Path -LiteralPath $required -PathType Leaf)){throw "Required approved CAD validation tool/reference is missing: $required. Manual review required."}}
  if((Get-FileHash -LiteralPath $sleeveStep -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$cadProfile.sleeveSha256).ToLowerInvariant() -or (Get-FileHash -LiteralPath $supportStep -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$cadProfile.supportSha256).ToLowerInvariant()){throw 'Approved STEP reference hash mismatch; no project was generated.'}
  $targetWidthMm=$null;$logoX=[string]$design.logoX;$logoY=[string]$design.logoY
  if(-not [string]::IsNullOrWhiteSpace([string]$design.text)){
   $artworkSvg=Join-Path $dir 'artwork.svg';$artworkXml=New-Object System.Xml.XmlDocument;$artworkXml.XmlResolver=$null;$artworkXml.Load($artworkSvg)
   if($artworkXml.GetElementsByTagName('image','http://www.w3.org/2000/svg').Count -gt 0){throw 'Combined text and logo artwork requires a validated multi-component manufacturing workflow. Manual review required.'}
   $textNodes=$artworkXml.GetElementsByTagName('text','http://www.w3.org/2000/svg')
   if($textNodes.Count -ne 1 -or [string]$textNodes[0].InnerText -cne [string]$design.text){throw 'The exported Studio text does not match the saved design settings.'}
   if([string]$design.align -ne 'center'){throw 'Raised text with left/right alignment requires a calibrated anchor profile. Manual review required.'}
   $outlineScript=Join-Path $workspace 'scripts\production\outline_impact_text.py';$designPath=Join-Path $dir 'design-settings.json';$manufacturingSvg=Join-Path $dir 'manufacturing-text.svg'
   $j.draftJson|Set-Content -LiteralPath $designPath -Encoding utf8
   $outlineOutput=& $python $outlineScript --design $designPath --cad-step $sleeveStep --output $manufacturingSvg 2>&1
   if($LASTEXITCODE -ne 0){throw "Text could not be outlined safely. Manual review required: $($outlineOutput -join ' ')"}
   $outlineReport=($outlineOutput -join "`n")|ConvertFrom-Json;$targetWidthMm=[double]$outlineReport.targetWidthMm
  }elseif($sourceHeader -notmatch '<svg'){
   $sourceHash=(Get-FileHash -LiteralPath $sourceArtwork -Algorithm SHA256).Hash.ToLowerInvariant()
   $approvedVector=Join-Path $cadRoot 'manufacturing\SnapInk_Billboard_Production\Size_0\SNAPINK_White_Test\SNAPINK_White_Wordmark_Vector.svg'
   $approvedValidation=Join-Path (Split-Path $approvedVector -Parent) 'SNAPINK_White_Validation.json'
   if($sourceHash -ne '937bb72cdf347864c22c564c50a55ff6752075e0c337ab59b676e71c11da4790' -or -not(Test-Path -LiteralPath $approvedVector) -or (Get-FileHash -LiteralPath $approvedVector -Algorithm SHA256).Hash.ToLowerInvariant() -ne '20c13075004ed9a83084b77149b3da6825e25cae12d4ddb36dcac1465b674af1' -or -not(Test-Path -LiteralPath $approvedValidation)){throw 'Only clean closed-path SVG artwork or the exact hash-verified official SnapInk logo has a manufacturing vector. Other raster artwork requires manual review.'}
   $logoValidation=Get-Content -LiteralPath $approvedValidation -Raw|ConvertFrom-Json
   if($logoValidation.source_image_sha256 -ne $sourceHash -or -not $logoValidation.logo_valid -or -not $logoValidation.logo_step_readback_valid -or [double]$logoValidation.body_logo_intersection_mm3 -gt 0 -or [double]$logoValidation.support_logo_intersection_mm3 -gt 0){throw 'The official logo source/vector no longer matches its CAD validation record. Manual review required.'}
   $manufacturingSvg=$approvedVector
  }elseif($sourceHeader -notmatch '<svg'){throw 'Source artwork is not a clean SVG.'}
  $generationId="$id-attempt-$([int]$j.attempt)";$generatedRoot=Join-Path $Root 'Generated';$generatedDir=Join-Path $generatedRoot $generationId;$variantLabel=if($j.variant -eq 'billboard'){'Billboard'}else{'Standard'};$suffix=if([bool]$design.hasCustomArtwork){"Custom"}else{"Blank"};$projectName="SnapInk_${generationId}_${variantLabel}_Size_$([int]$j.size)_$suffix";$project=Join-Path $generatedDir "$projectName.3mf"
  Update-Stage $id 'generating_production_geometry' 'Preparing the blank-flap template and CAD-positioned customer artwork.'
  if(-not [bool]$design.hasCustomArtwork){
   $blankPackager=Join-Path $workspace 'scripts\production\package_blank_project.py'
   $blankArgs=@($blankPackager,'--baseline',(Join-Path $dir 'model.3mf'),'--baseline-sha256',[string]$j.modelSha256,'--output',$project,'--title',$projectName,'--variant',[string]$j.variant,'--size',[string]$j.size,'--body-step',$sleeveStep,'--support-step',$supportStep,'--branding-center-x-mm',[string]$design.brandingCenterXmm)
   $blankOutput=& $python @blankArgs 2>&1
   if($LASTEXITCODE -ne 0){throw "Blank-flap project packaging failed. Manual review required: $($blankOutput -join ' ')"}
  }else{
   $generatorArgs=@($generator,'--baseline',(Join-Path $dir 'model.3mf'),'--baseline-sha256',[string]$j.modelSha256,'--svg',$manufacturingSvg,'--output-dir',$generatedRoot,'--order-id',$generationId,'--variant',[string]$j.variant,'--size',[string]$j.size,'--logo-x',$logoX,'--logo-y',$logoY,'--artwork-center-x-mm',[string]$design.artworkCenterXmm,'--logo-scale',[string]$design.logoScale,'--sleeve-color',[string]$design.backgroundColor,'--sleeve-step',$sleeveStep,'--support-step',$supportStep)
   if($null -ne $targetWidthMm){$generatorArgs+=@('--target-width-mm',[string]$targetWidthMm)}
   $generatorOutput=& $python @generatorArgs 2>&1
   if($LASTEXITCODE -ne 0){throw "Artwork could not be manufactured safely. Manual review required: $($generatorOutput -join ' ')"}
  }
  Update-Stage $id 'validating_production_project' 'Checking baseline identity, CAD clearances, mesh, material slot, and Snapmaker U1 project settings.'
  $reportPath=Join-Path $generatedDir 'validation.json';if(-not(Test-Path -LiteralPath $reportPath)){throw 'The generator did not create a validation report.'}
  $report=Get-Content -LiteralPath $reportPath -Raw|ConvertFrom-Json
  if($report.baselineSha256 -ne ([string]$j.modelSha256).ToLowerInvariant() -or -not $report.package.sleeveAndSupportUnchanged -or -not $report.geometry.approvedCadClearance.passed -or $report.package.printerProfile -ne 'Snapmaker U1 (0.4 nozzle)' -or $report.package.artworkMaterial -ne 'SnapInk - EONO3D TPU 95A' -or $report.package.supportMaterial -ne 'Snapmaker PLA Basic @U1' -or -not(Test-Path -LiteralPath $project)){throw 'Generated project failed one or more manufacturing validation gates.'}
  Verify-Hash $project $report.package.outputSha256 'Generated customer-specific 3MF project'
  $manifest=[ordered]@{orderNumber=$j.orderNumber;quantity=$j.quantity;quantityPlan=[ordered]@{requested=[int]$j.quantity;projectContainsCopies=1;automaticPlateLayoutValidated=$false;manualBatchPlanningRequired=([int]$j.quantity -gt 1);accountedUnits=0;note=if([int]$j.quantity -gt 1){'Only the single customized reference part is included. Owner must plan and account for every required batch in Snapmaker Orca; no plate capacity is assumed.'}else{'One customized part is included.'}};variant=$j.variant;size=$j.size;attempt=$j.attempt;preparedAt=(Get-Date -Format o);baseline=(Join-Path $dir 'model.3mf');productionProject=$project;validation=$reportPath;artwork=(Join-Path $dir 'artwork.svg');manufacturingArtwork=$manufacturingSvg;sourceArtwork=(Join-Path $dir 'source.bin');preview=(Join-Path $dir 'preview.png');designParameters=$design}
  $manifest|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $dir 'job.json') -Encoding utf8
  $quantityMessage=if([int]$j.quantity -gt 1){" Requested quantity $($j.quantity); this project has one sleeve only, so manual multi-batch planning and quantity accounting are required."}else{''}
  Update-Stage $id 'ready_for_orca' "Validated customer-specific project saved at $project. Owner review required; printing has not started.$quantityMessage"
  if($NoOpen){Log "Validated $($j.orderNumber); Snapmaker Orca opening skipped by request.";return}
  Update-Stage $id 'opening_in_orca' 'Passing the completed 3MF to Snapmaker Orca 2.4.0 and waiting for the project window title.'
  $proc=Start-Process -FilePath $OrcaPath -ArgumentList @('"' + $project + '"') -PassThru
  if(-not $proc){throw 'Snapmaker Orca did not start.'}
  $opened=Wait-ForOrcaProject $projectName 60
  if(-not $opened){throw "Snapmaker Orca process started, but the generated project was not confirmed loaded by its window title. Project retained at $project for retry/review."}
  Set-Content -LiteralPath $marker -Value "Window title '$($opened.MainWindowTitle)' confirmed at $(Get-Date -Format o). No print was started." -Encoding utf8
  Update-Job $id 'opened' "Snapmaker Orca 2.4.0 shows '$($opened.MainWindowTitle)'. Awaiting owner review; no print was started."
  Log "Order $($j.orderNumber) generated and confirmed open in Snapmaker Orca 2.4.0. No print was initiated."
 }catch{$m=$_.Exception.Message;Update-Job $id 'failed' $m;Log "Job $id failed: $m"}
}
Log "Companion running. API=$ApiBase Orca=$OrcaPath Poll=$PollSeconds seconds."
do{try{$q=Invoke-RestMethod -Uri "$ApiBase/api/production/next" -Headers $Headers -Method Get;if($q.job){Handle-Job $q.job}}catch{Log "Queue check failed: $($_.Exception.Message)"};if(-not $Once){Start-Sleep -Seconds ([Math]::Max(5,$PollSeconds))}}while(-not $Once)

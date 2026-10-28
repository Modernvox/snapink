param(
  [Parameter(Mandatory=$true)][string]$JobJson,
  [Parameter(Mandatory=$true)][string]$Artwork,
  [Parameter(Mandatory=$true)][string]$CadRoot,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$BlenderPath = (Join-Path $env:LOCALAPPDATA 'SnapInk\Blender45\blender-4.5.15-windows-x64\blender.exe'),
  [int]$Resolution = 1600
)
$ErrorActionPreference='Stop'
$workspace=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$renderScript=Join-Path $PSScriptRoot 'blender_render.py'
$catalog=Join-Path $PSScriptRoot 'cad-assets.json'
if(-not(Test-Path -LiteralPath $BlenderPath -PathType Leaf)){throw "Blender is required: $BlenderPath"}
if(-not(Test-Path -LiteralPath $JobJson -PathType Leaf) -or -not(Test-Path -LiteralPath $Artwork -PathType Leaf)){throw 'Job JSON and artwork files must exist.'}
if(-not(Test-Path -LiteralPath $CadRoot -PathType Container)){throw 'Read-only CAD directory is unavailable.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$source=Get-Content -LiteralPath $JobJson -Raw|ConvertFrom-Json
if(-not $source.settings){throw 'Job JSON must contain a settings object.'}
$source.settings.resolution=$Resolution
$results=@()
foreach($mode in @('fast','premium')){
  $source.settings.renderMode=$mode
  $modeJob=Join-Path $OutputDirectory ("job-$mode.json")
  $output=Join-Path $OutputDirectory ("$mode.jpg")
  $stdout=Join-Path $OutputDirectory ("$mode.stdout.log")
  $stderr=Join-Path $OutputDirectory ("$mode.stderr.log")
  $source|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $modeJob -Encoding utf8
  $baselineGpu=$null;$nvidia=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if($nvidia){try{$v=& $nvidia.Source --query-gpu=memory.used --format=csv,noheader,nounits 2>$null;if($LASTEXITCODE -eq 0){$samples=@($v|ForEach-Object{[int]$_.Trim()});if($samples.Count){$baselineGpu=($samples|Measure-Object -Maximum).Maximum}}}catch{}}
  $process=Start-Process -FilePath $BlenderPath -ArgumentList @('-b','-t','8','--python',$renderScript,'--','--job',$modeJob,'--cad-root',$CadRoot,'--asset-catalog',$catalog,'--artwork',$Artwork,'--output',$output,'--diagnostics-dir',$OutputDirectory) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $deadline=(Get-Date).AddMinutes(30);$peak=$null
  while(-not $process.HasExited){if((Get-Date) -gt $deadline){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue;throw "$mode render timed out."};if($process.WaitForExit(1000)){break};$nvidia=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue;if($nvidia){try{$v=& $nvidia.Source --query-gpu=memory.used --format=csv,noheader,nounits 2>$null;if($LASTEXITCODE -eq 0){$samples=@($v|ForEach-Object{[int]$_.Trim()});if($samples.Count){$sample=($samples|Measure-Object -Maximum).Maximum;if($null -eq $peak -or $sample -gt $peak){$peak=$sample}}}}catch{}};$process.Refresh()}
  $line=Get-Content -LiteralPath $stdout|Where-Object{$_ -match '^\{\s*"ok"\s*:\s*true'}|Select-Object -Last 1
  if(-not $line -or -not(Test-Path -LiteralPath $output)){throw "$mode render did not produce expected output and metrics."}
  $metric=$line|ConvertFrom-Json
  if($process.ExitCode -ne 0 -and -not $metric.ok){throw "$mode render exited $($process.ExitCode): $((Get-Content -LiteralPath $stderr -Tail 20|Out-String).Trim())"}
  if($metric.renderMode -ne $mode -or -not $metric.assetSha256){throw "$mode metrics did not identify the requested mode and verified CAD asset."}
  if($metric.artworkReliefHeightMm -ne 0.8 -or $metric.artworkBoundaryEdges -ne 0 -or $metric.artworkNonmanifoldEdges -ne 0 -or $metric.artworkNonmanifoldVertices -ne 0){throw "$mode raised artwork did not pass the 0.8 mm manifold geometry acceptance check."}
  $results+=@{mode=$mode;engine=$metric.renderEngine;device=$metric.renderDevice;renderDurationMs=$metric.renderDurationMs;baselineGpuMemoryMb=$baselineGpu;peakSampledGpuMemoryMb=$peak;gpuMemoryDeltaMb=if($null -ne $baselineGpu -and $null -ne $peak){$peak-$baselineGpu}else{$null};gpuWarning=$metric.gpuWarning;image=(Split-Path $output -Leaf);imageFileBytes=(Get-Item -LiteralPath $output).Length;assetSha256=$metric.assetSha256;assetValidationStatus=$metric.validationStatus;resolution=$Resolution;artworkGeometrySha256=$metric.artworkGeometrySha256;artworkSourceSha256=$metric.artworkSourceSha256;artworkReliefHeightMm=$metric.artworkReliefHeightMm;artworkPlacedWidthMm=$metric.artworkPlacedWidthMm;artworkPlacedHeightMm=$metric.artworkPlacedHeightMm;artworkMeshVertices=$metric.artworkMeshVertices;artworkMeshFaces=$metric.artworkMeshFaces;artworkComponents=$metric.artworkComponents;artworkHoles=$metric.artworkHoles;artworkBoundaryEdges=$metric.artworkBoundaryEdges;artworkNonmanifoldEdges=$metric.artworkNonmanifoldEdges;artworkNonmanifoldVertices=$metric.artworkNonmanifoldVertices;artworkSignedVolumeMm3=$metric.artworkSignedVolumeMm3;artworkContourThreshold=$metric.artworkContourThreshold;artworkContourSimplifyTolerancePx=$metric.artworkContourSimplifyTolerancePx}
}
if($results[0].artworkGeometrySha256 -ne $results[1].artworkGeometrySha256){throw 'Fast and Premium did not use identical extruded artwork geometry.'}
Add-Type -AssemblyName System.Drawing
$fast=[Drawing.Image]::FromFile((Join-Path $OutputDirectory 'fast.jpg'))
$premium=[Drawing.Image]::FromFile((Join-Path $OutputDirectory 'premium.jpg'))
try{
  if($fast.Width -ne $premium.Width -or $fast.Height -ne $premium.Height){throw 'Comparison images differ in dimensions.'}
  $header=56;$canvas=[Drawing.Bitmap]::new($fast.Width*2,$fast.Height+$header)
  try{$graphics=[Drawing.Graphics]::FromImage($canvas);$graphics.Clear([Drawing.Color]::White);$graphics.DrawImage($fast,0,$header);$graphics.DrawImage($premium,$fast.Width,$header);$font=[Drawing.Font]::new('Segoe UI',20,[Drawing.FontStyle]::Bold);$brush=[Drawing.Brushes]::Black;$graphics.DrawString('FAST - Eevee',$font,$brush,16,12);$graphics.DrawString('PREMIUM - Cycles',$font,$brush,$fast.Width+16,12);$graphics.Dispose();$canvas.Save((Join-Path $OutputDirectory 'comparison.jpg'),[Drawing.Imaging.ImageFormat]::Jpeg)}finally{$canvas.Dispose()}
}finally{$fast.Dispose();$premium.Dispose()}
$results|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $OutputDirectory 'metrics.json') -Encoding utf8
Write-Output (Join-Path $OutputDirectory 'comparison.jpg')

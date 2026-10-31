# SnapInk private product photo renderer

Photo jobs use their own D1 tables and `/api/photo-render/*` routes. They do
not enter the order or manufacturing queues. The paired Windows worker claims
one photo job, verifies the artwork digest and local STL SHA-256, invokes
Blender, then uploads a JPEG to private R2 storage for ordinary scenes. The
locked On-Hat Rear View instead composites a native-size PNG onto its immutable
master and carries pixel-integrity metadata with the private output. Gallery
access requires the owner token. Worker access requires an already paired
device token.

## Renderer requirements

- Blender 4.5 LTS; install the latest 4.5.x maintenance patch available. The
  worker currently accepts 4.5.x and does not install or update software.
- Local Python 3.12 with Pillow, NumPy, and Shapely 2.1 for artwork contour
  extraction and constrained triangulation. The vector worker fails clearly
  when these dependencies are missing; it never installs packages itself.
- Windows 11 and 8 GB RAM minimum; Blender recommends 32 GB for general work.
- NVIDIA GeForce RTX 900-series or newer is supported by Blender. OptiX uses
  RTX hardware and requires a current NVIDIA driver (Blender Cycles documents
  driver 535+); the renderer falls back to CPU if OptiX is unavailable.
- No external Blender add-ons or paid image APIs are required.

The current computer reports an RTX 3070 8 GB and NVIDIA driver 610.88, which
exceeds the documented OptiX driver requirement. A RTX 3060 is also supported.

## Local worker setup (after Blender approval)

Pair this Windows PC using the existing owner dashboard device-pairing flow so
the worker can reuse the DPAPI-protected credential. Then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-companion\SnapInk-Photo-Renderer.ps1
```

The default CAD root is `C:\Users\lovei\OneDrive\Documents\snapink_cad`.
An alternate local binary path can be supplied with `-BlenderPath`; the script
accepts HTTPS APIs and loopback HTTP only. It creates job logs and temporary
files below `%LOCALAPPDATA%\SnapInk\PhotoRenderer`, not under CAD, production
models, or manufacturing folders. It never invokes Snapmaker Orca.

## CAD catalog and render placement

`cad-assets.json` pins one TPU STL hash and the exact validation text from
`SnapInk_Production/MANIFEST/PRODUCTION_MASTER_INDEX.md` for each style/size.
The worker reads those catalogued STLs only and verifies hashes before import.
Billboard sizes 0–2 are blocked because their CAD status is validation hold.
Other candidate/manual-slice statuses are displayed in the gallery and do not
mean physical validation or manufacturing approval.

The admin client uses the same `maximumContainedLogoHeightMm`, CAD branding
region, surface bounds, and geometry functions as the public Studio to size and
center each uploaded mark. The queue API repeats the 1 mm clearance, aspect
ratio, and selected geometry checks. The local vector worker traces the source
alpha contour, preserves holes and components, and uses constrained Delaunay
triangulation to build a closed 0.8 mm relief mesh. Blender maps this mesh onto
the planar CAD branding surface and rejects any non-manifold result. It does
not alter or export a manufacturing mesh.

## Renderer worker contract

The HTTP queue is independent from rendering implementation:

1. `GET /api/photo-render/next` claims a job for a paired device.
2. `GET /api/photo-render/file?id=...` returns only that worker's private input.
3. `POST /api/photo-render/status` records progress or a retryable failure.
4. `POST /api/photo-render/result?id=...` stores ordinary scene JPEGs, or the
   verified locked-master 1536 × 1024 PNG, privately and marks it complete.

## Locked On-Hat Rear View master

The canonical, read-only photograph is
`public/images/website_images/blank_sleeve_on_snapback.png`, identified as
`snapink.rear-snapback.master.v1`. Its versioned calibration manifest is
`on-hat-rear-reference.json`; the master SHA-256 and 1536 × 1024 canvas are
checked before rendering and compositing. The manifest also pins the CAD
calibration mesh and records the measured sleeve, groove, and main-body
polygons. The printable region is derived from `sleeveGeometry.ts`: it starts
to the right of the groove/flap exclusion, maintains the 1 mm edge clearance,
and keeps the approved 0.8 mm raised relief.

The companion uses the existing upload, job queue, and paired-worker flow. For
this scene Blender renders the validated relief and lighting passes; the
Python compositor maps the geometry into the master photo. It rejects changed
master/CAD hashes, invalid calibration metadata, or art crossing the printable
face. Only the rendered-art silhouette and its clipped contact-shadow/edge
allowance may change. Before upload it reopens the PNG and verifies that all
pixels outside the allowed mask equal the master. The private D1 job records
the master, artwork, CAD, calibration, output dimensions, and integrity result.
No manufacturing files are written. The admin gallery and ZIP export retain
the `.png` extension for this scene. Ordinary Photo Studio scenes keep their
existing JPEG behavior.

The checked-in script wordmark is not the approved script artwork. Use the
existing source asset only if the approved script logo is supplied; do not
substitute a font or fabricate lettering. Blender 4.5 and its Python runtime
must be available on the paired Windows companion to generate a real 3D mockup.

A future container worker can implement the same contract without changing
Photo Studio. The current Windows worker uses local Blender in background
mode, one render at a time. Cinematic, marketplace, and studio use deterministic
camera/light/material setups and do not call image generation services.

## Local checks

```powershell
node --input-type=module -e "await import('./functions-tests/photo-rendering.test.mjs')"
npm.cmd run build
```

The API tests use mock D1/R2 bindings. They do not claim Blender pixel output,
physical fit, or visual quality; those require Blender installation and owner
review of rendered samples.

## Fast and Premium comparison

Fast is the default and uses Eevee Next at 1600 × 1600. Premium uses Cycles
with OptiX when available, denoising, and CPU fallback with a warning. Premium
supports 2400 and 3000 square output. Both modes share the same imported sleeve
mesh, artwork placement, camera, materials, and scene lighting.

To compare identical geometry, artwork, camera, lighting, and resolution after
Blender is installed, prepare a renderer job JSON and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\photo-render\compare_render_modes.ps1 `
  -JobJson .\photo-job.json -Artwork .\artwork.png `
  -CadRoot C:\Users\lovei\OneDrive\Documents\snapink_cad `
  -OutputDirectory .\render-comparison
```

The script runs Fast then Premium serially and saves both source images,
`comparison.jpg`, and `metrics.json` with render duration and sampled GPU
memory. Visual quality remains unverified until the outputs are inspected.

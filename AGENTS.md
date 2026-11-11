# SnapInk artwork production rules

## Billboard flap geometry

- Every Billboard sleeve, Sizes 0–5 and future generated sizes, keeps the left flap extension straight from its left edge through the engraved ridge/groove. The main branding bow starts at the groove and continues to the right.
- Generate the flap's outer strip with `scripts/production/billboard_flap_geometry.py`. Match its width at the groove to the main branding bow so the union is continuous. Apply the same boundary to a separate cavity support where that support follows the sleeve outline.
- Do not change groove placement, snap/cavity geometry, side-wall thickness, sleeve length, artwork, or branding dimensions to implement this profile.
- Keep revised CAD candidates and baseline backups separate. This geometric correction alone does not change validation or production-approval status.

## Artwork modes

- **Standard is the default.** Unless the saved Studio design explicitly has `artworkStrokeEnabled: true`, generate only the calibrated raised artwork. Do not add a contour, extra cavity fill, or contour supports. Preserve the approved sleeve and existing removable cavity support meshes.
- **Contour is opt-in.** The saved Studio `artworkStrokeEnabled`, `artworkStrokeWidthMm`, and `artworkStrokeColor` values are the production source of truth. The Windows production companion must pass those values through to `scripts/production/generate_vector_relief.py`; do not infer contour mode from artwork shape, logo name, or filename.
- Contour geometry uses Studio's full outward dilation radius (`artworkStrokeWidthMm`) around the positioned artwork silhouette; do not halve it. Keep Studio's artwork XY position, aspect ratio, scale, and placement. Integrate the offset into the branding face with the corrected NY branding-wall thickness of 0.85 mm. The raised logo rests on that wall as in the corrected NY project.
- The contour inherits the selected sleeve body's material and color because it is fused into that body. If Studio's contour color differs from the sleeve color, fail before 3MF export rather than silently assign the wrong material.

## Geometry invariants

- The approved sleeve STEP and hash-pinned baseline 3MF remain the dimensional authority. Never scale or replace snap-fit geometry. Contour fusion may add branding-face material, but the approved sleeve must remain wholly present: `approved sleeve - generated sleeve` intersection volume must stay at or below 0.001 mm³.
- Preserve snap holes, snap engagement surfaces, grooves, flap, cavity dimensions, and side-wall thickness. Do not add material inside the cavity or to a snap wall.
- In contour mode, retain the matching approved cavity-fill support. Detect contour regions outside the branding face, create only the necessary build-plate removable supports below those regions, subtract the complete sleeve body from candidate supports, and keep supports as the separate PLA assembly component. Never model the contour itself as a build-plate support wall.
- Validate support/body and artwork/body intersections, valid solid geometry, baseline identity, 3MF component references, printer profile, and TPU/PLA tool assignments before publishing the generated 3MF. On any failed check, report the failure and do not export a ready-for-print project.
- The 3MF is a geometric production artifact, not proof of a successful physical print. Do not mark a design production-approved without the applicable review and physical validation.

## Regression checks

Run the CAD geometry regression suite with the local CadQuery environment. CadQuery's installed native libraries can hang during interpreter teardown, so this runner flushes the unittest result and exits with its status explicitly:

```powershell
..\..\cq_env\Scripts\python.exe -c "import sys,unittest,os; suite=unittest.defaultTestLoader.discover('scripts/production-tests'); result=unittest.TextTestRunner(verbosity=2).run(suite); sys.stdout.flush(); os._exit(0 if result.wasSuccessful() else 1)"
```

The suite covers standard artwork with no contour and the corrected NY contour/support construction. Keep its fixtures isolated; never rewrite approved assets or the successful NY project during test runs.

# Convert transparent SnapInk logo PNGs to SVG

Install the tracing dependencies once:

```powershell
py -3.12 -m pip install -r scripts/requirements-logo-svg.txt
```

Run the batch conversion from the repository root:

```powershell
py -3.12 scripts/convert_logo_pngs_to_svg.py
```

The command reads top-level PNG files from `public/images/logos/` and writes
same-named SVGs to `public/images/logos/svg/`. Original PNGs are read only.
New top-level PNG logos are included automatically the next time the command
runs.

The converter uses PNG alpha as the foreground mask and VTracer to build filled,
closed vector paths. Output artwork is solid black with transparent background,
which is suitable for importing and extruding as a single-color shape in
Snapmaker Orca. Tiny speckles up to VTracer's configured filter are removed and
curves are smoothed. Review each SVG before production use; the command reports
logos it cannot trace or validate and exits with a nonzero status. Adjust
`--alpha-threshold` or `--speckle` for a particular batch if the source artwork
requires a different mask cutoff or noise filter.

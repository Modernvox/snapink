#!/usr/bin/env python3
"""Build a customer-specific raised-vector component from an approved SnapInk 3MF.

The selected branding region is derived from the hash-pinned matching sleeve STEP,
then inset by more than 1 mm. The baseline sleeve/support meshes remain immutable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import posixpath
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from uuid import uuid4

import cadquery as cq
from shapely.affinity import scale as shape_scale, translate as shape_translate
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from svgpathtools import parse_path

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
NS = {"m": CORE, "p": PROD}
ET.register_namespace("", CORE)
ET.register_namespace("p", PROD)

PROFILE: dict = {}
BRANDING_GROOVE_WIDTH_MM = 0.8
RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships"
OPTIONAL_THUMBNAIL_RELATIONSHIPS = {
    f"{RELATIONSHIPS}/metadata/thumbnail",
    "http://schemas.bambulab.com/package/2021/cover-thumbnail-middle",
    "http://schemas.bambulab.com/package/2021/cover-thumbnail-small",
}


def fail(message: str) -> None:
    raise ValueError(message)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def validate_approved_inputs(variant: str, size: int, baseline: Path, sleeve_step: Path, support_step: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    models = json.loads((root / "production-model-manifest.json").read_text(encoding="utf-8-sig"))
    cad = json.loads((Path(__file__).resolve().parent / "cad-reference-manifest.json").read_text(encoding="utf-8-sig"))
    model = next((entry for entry in models["models"] if entry["variant"] == variant and entry["size"] == size), None)
    reference = next((entry for entry in cad["profiles"] if entry["variant"] == variant and entry["size"] == size), None)
    if not model or not reference:
        fail("This sleeve configuration has no complete hash-verified production/CAD reference profile.")
    cad_root = Path(models["sourceRoot"])
    expected_baseline = cad_root / model["file"]
    expected_sleeve = cad_root / reference["sleeveStep"]
    expected_support = cad_root / reference["supportStep"]
    if not expected_baseline.is_file() or sha256(expected_baseline).lower() != model["sha256"].lower() or sha256(baseline).lower() != model["sha256"].lower():
        fail("The selected 3MF does not match the hash-pinned approved production baseline.")
    for provided, expected, digest, label in (
        (sleeve_step, expected_sleeve, reference["sleeveSha256"], "approved sleeve STEP"),
        (support_step, expected_support, reference["supportSha256"], "approved support STEP"),
    ):
        if provided.resolve() != expected.resolve() or not expected.is_file() or sha256(expected).lower() != digest.lower():
            fail(f"The selected {label} does not match the hash-pinned reference catalog.")
    if not math.isclose(float(cad.get("brandingClearanceMm", 0)), 1.0, abs_tol=1e-9):
        fail("The CAD reference catalog does not require the production 1 mm branding clearance.")


def parse_svg(svg_path: Path) -> tuple[list[Polygon], float, float]:
    raw = svg_path.read_bytes()
    if len(raw) > 2_000_000:
        fail("SVG exceeds 2 MB; manual review required.")
    if re.search(rb"<!\s*(doctype|entity)|<\s*(script|foreignObject)\b|@import|javascript:", raw, re.I):
        fail("SVG contains active or externally referenced content; manual review required.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        fail(f"Malformed SVG: {exc}")
    if root.tag.split("}")[-1] != "svg":
        fail("Artwork root is not SVG.")
    if root.get("transform") or root.get("opacity", "1") != "1" or root.get("fill-opacity", "1") != "1":
        fail("Transformed or partially transparent SVG roots require manual review.")
    forbidden = {"image", "text", "use", "foreignObject", "filter", "mask", "clipPath", "linearGradient", "radialGradient", "pattern"}
    metadata_nodes = {"title", "desc", "metadata"}
    for node in root.iter():
        for key in node.attrib:
            local_key = key.split("}")[-1].lower()
            if local_key == "style" or local_key.startswith("on") or local_key in ("href", "src"):
                fail("SVG styles, event handlers, and external references are unsupported.")
        if node.tag.split("}")[-1] in forbidden:
            fail(f"Unsupported SVG feature <{node.tag.split('}')[-1]}>; use closed paths or request manual review.")
        if node is not root and node.tag.split("}")[-1] not in ("path", *metadata_nodes):
            fail("Only SVG path elements are supported in this first validated path.")
        if node is not root and (node.get("transform") or node.get("stroke") not in (None, "none")):
            fail("SVG transforms and stroked/open artwork require conversion to clean filled paths first.")
    paths = [node for node in root.iter() if node.tag.split("}")[-1] == "path"]
    if not paths or len(paths) > 100:
        fail("SVG must contain 1–100 filled path elements.")
    raw_colors = [node.get("fill", root.get("fill")) for node in paths]
    if any(color is None for color in raw_colors):
        fail("Every supported SVG path must declare one explicit solid fill color.")
    if any(node.get("opacity", "1") != "1" or node.get("fill-opacity", "1") != "1" for node in paths):
        fail("Partially transparent artwork requires manual review.")
    colors = {color.lower() for color in raw_colors}
    if len(colors) != 1 or not re.fullmatch(r"#[0-9a-f]{6}", next(iter(colors))):
        fail("Only single-color SVG path artwork with an explicit solid hex fill is supported.")
    vb = root.get("viewBox")
    if not vb:
        fail("SVG must include a viewBox so artwork proportions can be measured.")
    nums = [float(v) for v in re.split(r"[\s,]+", vb.strip())]
    if len(nums) != 4 or nums[2] <= 0 or nums[3] <= 0:
        fail("SVG viewBox is invalid.")
    vx, vy, vw, vh = nums
    fill_rule = root.get("fill-rule", "nonzero")
    polygons: list[Polygon] = []
    # Compound path holes are represented with even/odd containment. We only
    # accept explicitly closed subpaths; no raster, CSS, or browser rendering.
    from svgpathtools import parse_path as parse_svg_path
    for element in paths:
        if element.get("fill", root.get("fill", "black")) in ("none", "transparent"):
            fail("Unfilled SVG paths are unsupported.")
        if element.get("fill-rule", fill_rule) != "evenodd":
            fail("Only explicitly even-odd filled paths are accepted; convert nonzero paths or request manual review.")
        try:
            parsed = parse_svg_path(element.get("d", ""))
        except Exception as exc:
            fail(f"Could not parse SVG path: {exc}")
        for sub in parsed.continuous_subpaths():
            if not sub or abs(sub.start - sub.end) > 1e-5:
                fail("Every SVG contour must be explicitly closed.")
            points = []
            for segment in sub:
                count = max(1, math.ceil(float(segment.length(error=1e-3)) / 3.0))
                if len(points) + count > 250_000:
                    fail("SVG path exceeds the deterministic geometry sampling limit; manual review required.")
                points.extend((segment.point(i / count).real, segment.point(i / count).imag) for i in range(count))
            if len(points) >= 3:
                # Transform-free, root viewBox coordinates only.
                geom = Polygon(points)
                if not geom.is_valid:
                    fail("SVG contains self-intersecting or invalid contours; manual review required.")
                polygons.append(geom)
    if not polygons:
        fail("SVG contains no closed filled contours.")
    # XOR contours preserves counters/holes in outlined lettering.
    from shapely import symmetric_difference
    filled = polygons[0]
    for polygon in polygons[1:]:
        filled = symmetric_difference(filled, polygon)
    pieces = list(filled.geoms) if hasattr(filled, "geoms") else [filled]
    pieces = [p for p in pieces if isinstance(p, Polygon) and p.area > 0]
    if not pieces:
        fail("SVG path fill is empty.")
    bounds = filled.bounds
    if bounds[0] < vx - 1e-5 or bounds[1] < vy - 1e-5 or bounds[2] > vx + vw + 1e-5 or bounds[3] > vy + vh + 1e-5:
        fail("Artwork extends outside the SVG viewBox; it will not be cropped automatically.")
    return pieces, vw, vh, next(iter(colors))


def _face_xy_polygon(face):
    vertices, triangles = face.tessellate(0.02)
    cells = []
    for a, b, c in triangles:
        cell = Polygon([(vertices[a].x, vertices[a].y), (vertices[b].x, vertices[b].y), (vertices[c].x, vertices[c].y)])
        if cell.is_valid and cell.area > 1e-9:
            cells.append(cell)
    if not cells:
        fail("The approved CAD branding face could not be tessellated safely.")
    area = unary_union(cells)
    if not area.is_valid or area.is_empty:
        fail("The approved CAD branding face produced invalid boundary geometry.")
    return area


def derive_profile(variant: str, size: int, sleeve_step: Path, billboard_groove_datum: float = -2.8) -> dict:
    if variant not in ("standard", "billboard") or size not in range(6):
        fail("Unsupported sleeve configuration.")
    if not sleeve_step or not sleeve_step.is_file():
        fail("The matching approved sleeve STEP reference is required.")
    sleeve_shape = cq.importers.importStep(str(sleeve_step)).val()
    if not sleeve_shape.isValid() or len(sleeve_shape.Solids()) != 1:
        fail("The approved sleeve STEP must contain one valid solid.")
    bounds = sleeve_shape.BoundingBox()
    top_z = bounds.zmax
    top_faces = []
    for face in sleeve_shape.Faces():
        face_bounds = face.BoundingBox()
        if face.geomType() == "PLANE" and abs(face_bounds.zmin - top_z) < 1e-4 and abs(face_bounds.zmax - top_z) < 1e-4 and face.Area() > 20:
            top_faces.append(face)
    if not top_faces:
        fail("No planar, top-facing branding surface was identified in the approved sleeve STEP.")
    # The brand panel is the rightmost major top face. On the original Billboard
    # 0-2 geometry the flap-groove transition is not a separate CAD face; those
    # three share the groove datum measured and validated on the Size 0 CAD.
    face = max(top_faces, key=lambda f: f.BoundingBox().xmax)
    brand = _face_xy_polygon(face)
    face_bounds = face.BoundingBox()
    face_min_x, face_max_x = face_bounds.xmin, face_bounds.xmax
    if -4.0 <= face_min_x <= 0.0:
        groove_right_x = face_min_x
        groove_source = "approved CAD top-face split"
    elif variant == "billboard" and size <= 2 and face_min_x < -4.0:
        groove_right_x = billboard_groove_datum
        groove_source = "shared Size 0-2 Billboard groove datum (-2.8 mm), checked against approved STEP bounds"
    else:
        fail("The CAD does not expose a validated flap-groove boundary for the branding face.")
    crop = box(groove_right_x, bounds.ymin - 1, face_max_x + 1, bounds.ymax + 1)
    brand = brand.intersection(crop)
    if brand.is_empty or not brand.is_valid:
        fail("The CAD-derived branding face is empty or invalid after excluding the flap groove.")
    usable = brand.buffer(-1.05, quad_segs=32)
    if usable.is_empty or not usable.is_valid or usable.area < 1:
        fail("The CAD-derived branding face has no usable area after the required 1 mm clearance.")
    usable_bounds = usable.bounds
    return {
        "variant": variant, "size": size, "sleeve_shape": sleeve_shape,
        "branding_face": brand, "usable_face": usable, "base_z_mm": top_z,
        "groove_right_x_mm": groove_right_x, "groove_source": groove_source,
        "groove_valley_x_mm": groove_right_x - BRANDING_GROOVE_WIDTH_MM / 2,
        "branding_center_x_mm": ((groove_right_x - BRANDING_GROOVE_WIDTH_MM / 2) + face_max_x) / 2,
        "face_bounds_mm": [face_min_x, face_max_x, face_bounds.ymin, face_bounds.ymax],
        "usable_bounds_mm": list(usable_bounds), "relief_mm": 0.8,
        "branding_wall_height_mm": 0.85,
        "artwork_extruder": 2, "support_extruder": 3,
        "calibration": str(sleeve_step),
    }


def _position_artwork(geom, raw_bounds, center_x, center_y, scale):
    minx, miny, maxx, maxy = raw_bounds
    width, height = (maxx - minx) * scale, (maxy - miny) * scale
    x0, y0 = center_x - width / 2, center_y - height / 2
    placed = shape_scale(geom, xfact=scale, yfact=-scale, origin=(minx, maxy))
    placed = shape_translate(placed, xoff=x0 - minx, yoff=y0 - maxy)
    return placed, x0, y0, width, height


def polygon_parts(geometry):
    """Return only non-empty polygonal members of a Shapely geometry."""
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [part for child in geometry.geoms for part in polygon_parts(child)]
    return []


def make_extruded_region(geometry, z0: float, z1: float):
    """Convert a 2D region into valid solids, retaining counters and islands."""
    if not math.isfinite(z0) or not math.isfinite(z1) or z1 <= z0:
        fail("Artwork/support extrusion bounds are invalid.")
    solids = []
    for polygon in polygon_parts(geometry):
        outer = cq.Wire.makePolygon([cq.Vector(x, y, z0) for x, y in polygon.exterior.coords[:-1]], close=True)
        holes = [cq.Wire.makePolygon([cq.Vector(x, y, z0) for x, y in ring.coords[:-1]], close=True) for ring in polygon.interiors]
        solids.append(cq.Solid.extrudeLinear(outer, holes, cq.Vector(0, 0, z1 - z0)))
    return solids


def integrate_contour_into_branding_wall(sleeve, artwork_xy, face_xy, base_z: float, contour_width: float, wall_height: float, groove_right_x: float | None = None):
    """Fuse an explicit contour into the sleeve branding face at its face Z."""
    if not math.isfinite(contour_width) or contour_width <= 0:
        fail("Contour width must be positive and finite.")
    # Studio's SVG filter dilates the artwork alpha by this full radius in mm;
    # preserve that exact outward extension rather than halving it.
    expanded = artwork_xy.buffer(contour_width, quad_segs=16, join_style="round")
    if groove_right_x is not None and expanded.bounds[0] < groove_right_x - 1e-5:
        fail("The Studio contour reaches into the branding groove; exact artwork position/scale was preserved and export was stopped.")
    ring = expanded.difference(artwork_xy)
    contour_solid = cq.Compound.makeCompound(make_extruded_region(expanded, base_z, base_z + wall_height))
    integrated = sleeve.fuse(contour_solid).clean()
    if not integrated.isValid() or len(integrated.Solids()) != 1:
        fail("The requested contour could not be integrated into one valid sleeve branding wall.")
    outside_face = detect_overhang_regions(expanded, face_xy)
    return integrated, ring, outside_face, expanded


def detect_overhang_regions(artwork_xy, branding_face):
    """Return only contour area outside the actual CAD branding-face footprint."""
    overhang = artwork_xy.difference(branding_face).buffer(0)
    if not overhang.is_valid:
        fail("Contour overhang detection produced invalid planar geometry.")
    return overhang


def geometry_intersection_volume(shape_a, shape_b) -> float:
    """Volume intersection helper shared by assembly and clearance checks."""
    return float(shape_a.intersect(shape_b).Volume())


def validate_cavity_clearance(sleeve_body, support, maximum_intersection_mm3: float = 0.001):
    """Ensure removable fill/support stays outside functional sleeve walls."""
    overlap = geometry_intersection_volume(sleeve_body, support)
    if overlap > maximum_intersection_mm3:
        fail(f"Removable cavity/contour support penetrates sleeve walls by {overlap:.4f} mm³.")
    return {"bodySupportIntersectionMm3": overlap,
            "minimumBodyToSupportDistanceMm": float(sleeve_body.distance(support)),
            "passed": True}


def generate_contour_cavity_fill(existing_support, contour_overhang_xy, sleeve_body, fill_top_z: float, wall_xy):
    """Extend the existing approved cavity fill to exposed contour overhangs."""
    support_plan = contour_overhang_xy.difference(wall_xy)
    if support_plan.is_empty or support_plan.area <= 1e-8:
        if existing_support.intersect(sleeve_body).Volume() > 0.001:
            fail("The approved cavity fill intersects the sleeve body.")
        return existing_support, cq.Compound.makeCompound([]), cq.Compound.makeCompound([])
    raw_support = cq.Compound.makeCompound(make_extruded_region(support_plan, 0.0, fill_top_z))
    # The 2D projection is only a candidate envelope: remove all volume inside
    # the sleeve, then merge with the existing removable cavity-fill component.
    # Trim against both permanent sleeve geometry and the existing cavity fill
    # before fusing into the single removable support part.
    trimmed = raw_support.cut(sleeve_body).cut(existing_support).clean()
    combined = existing_support.fuse(trimmed).clean()
    if not combined.isValid() or not combined.Solids():
        fail("Contour support/cavity-fill geometry is invalid after trimming.")
    validate_cavity_clearance(sleeve_body, combined)
    return combined, raw_support, trimmed


def validate_artwork_assembly(sleeve, support, artwork, baseline_sleeve, baseline_support, contour_mode: bool):
    """Reject invalid geometry, precision-feature collisions, and altered snap CAD."""
    for label, shape in (("sleeve", sleeve), ("support", support), ("artwork", artwork)):
        if not shape.isValid() or not shape.Solids():
            fail(f"Generated {label} mesh source is not valid solid geometry.")
    cavity_clearance = validate_cavity_clearance(sleeve, support)
    if baseline_sleeve.BoundingBox().zmin != sleeve.BoundingBox().zmin:
        fail("The sleeve build-plate datum changed during artwork generation.")
    # The approved STEP source remains the snap/cavity authority. This guard
    # ensures the production body is not scaled or replaced by another CAD.
    removed_approved_volume = baseline_sleeve.cut(sleeve).Volume()
    if removed_approved_volume > 0.001:
        fail("Artwork generation removed material from the approved sleeve, including snap-fit geometry.")
    if abs(baseline_sleeve.Volume() - sleeve.Volume()) > max(0.01, sleeve.Volume() * 1e-7) and not contour_mode:
        fail("Standard artwork mode changed the approved sleeve solid.")
    removed_cavity_fill = baseline_support.cut(support).Volume()
    if removed_cavity_fill > 0.001:
        fail("Artwork generation removed material from the approved removable cavity fill.")
    artwork_overlap = artwork.intersect(sleeve).Volume()
    if artwork_overlap > 0.001:
        fail(f"Raised artwork overlaps the sleeve ({artwork_overlap:.4f} mm³).")
    if not contour_mode and abs(baseline_support.Volume() - support.Volume()) > max(0.01, support.Volume() * 1e-7):
        fail("Standard artwork mode changed the approved removable support geometry.")
    return {"sleeveSupportIntersectionMm3": cavity_clearance["bodySupportIntersectionMm3"],
            "minimumBodyToSupportDistanceMm": cavity_clearance["minimumBodyToSupportDistanceMm"],
            "artworkSleeveIntersectionMm3": artwork_overlap,
            "approvedSleeveRemovedVolumeMm3": removed_approved_volume,
            "approvedCavityFillRemovedVolumeMm3": removed_cavity_fill,
            "snapFitSourceUnchanged": removed_approved_volume <= 0.001, "valid": True}


def build_relief(svg: Path, stl: Path, requested_width: float | None, logo_x: float, logo_y: float, logo_scale: float, sleeve_step: Path, support_step: Path, artwork_center_x_mm: float | None = None, artwork_center_y_mm: float | None = None, artwork_mode: str = "standard", contour_width_mm: float | None = None, generated_dir: Path | None = None, contour_color: str | None = None, sleeve_color: str = "#000000") -> dict:
    if artwork_mode not in ("standard", "contour"):
        fail("Artwork mode must be standard or explicitly requested contour.")
    if artwork_mode == "contour" and (contour_width_mm is None or not math.isfinite(contour_width_mm) or not 0.25 <= contour_width_mm <= 5.0):
        fail("Contour mode requires an explicit width from 0.25 to 5 mm.")
    if artwork_mode == "contour" and (not contour_color or not re.fullmatch(r"#[0-9A-Fa-f]{6}", contour_color) or contour_color.lower() != sleeve_color.lower()):
        fail("The integrated contour inherits sleeve-body material/color; Studio contour color must match the selected sleeve color to avoid a misassigned 3MF.")
    polygons, _, _, artwork_color = parse_svg(svg)
    geom = polygons[0]
    for p in polygons[1:]:
        geom = geom.union(p)
    minx, miny, maxx, maxy = geom.bounds
    raw_w, raw_h = maxx - minx, maxy - miny
    if raw_w <= 0 or raw_h <= 0:
        fail("Artwork has zero width or height.")
    if not 0 <= logo_x <= 100 or not -200 <= logo_y <= 300 or not 0 < logo_scale <= 100:
        fail("Logo X must be 0–100, vertical position must be -200–300, and logo scale must be greater than 0 and no more than 100.")
    if PROFILE.get("sleeve_step") != sleeve_step or PROFILE.get("support_step") != support_step:
        fail("The CAD-derived profile does not match the selected sleeve/support reference pair.")
    usable = PROFILE["usable_face"]
    ux0, uy0, ux1, uy1 = usable.bounds
    center_x_from_percent = ux0 + (logo_x / 100) * (ux1 - ux0)
    center_x = center_x_from_percent if artwork_center_x_mm is None else artwork_center_x_mm
    if artwork_center_x_mm is not None and abs(center_x_from_percent - artwork_center_x_mm) > 0.02:
        fail("Studio artwork X percentage does not match its CAD-coordinate position. Reopen the design in current Studio before production.")
    center_y = uy1 - (logo_y / 100) * (uy1 - uy0)
    if artwork_center_y_mm is not None:
        if not math.isfinite(artwork_center_y_mm) or abs(center_y - artwork_center_y_mm) > 0.02:
            fail("Studio artwork Y percentage does not match its CAD-coordinate position. Reopen the design in current Studio before production.")
        center_y = artwork_center_y_mm
    max_scale = min((ux1 - ux0) / raw_w, (uy1 - uy0) / raw_h)
    neutral_center_y = (uy0 + uy1) / 2
    low, high = 0.0, max_scale
    for _ in range(36):
        mid = (low + high) / 2
        placed, *_ = _position_artwork(geom, (minx, miny, maxx, maxy), center_x, neutral_center_y, mid)
        if usable.covers(placed): low = mid
        else: high = mid
    scale = low * (logo_scale / 100)
    if scale <= 0:
        fail("The selected design size does not fit the safe branding face.")
    if requested_width is not None:
        if requested_width <= 0 or requested_width > (ux1 - ux0):
            fail("Requested artwork width is outside this CAD-validated branding face.")
        requested_scale = requested_width / raw_w
        if requested_scale > scale + 1e-6:
            fail("Requested width exceeds the design's centered safe maximum; artwork will not be silently resized.")
        scale = requested_scale
    placed, x0, y0, width, height = _position_artwork(geom, (minx, miny, maxx, maxy), center_x, center_y, scale)
    if not usable.covers(placed):
        fail("The selected artwork position extends outside the safe printable area. Its saved position was preserved; reposition the artwork in Studio before production.")
    clearance = float(placed.boundary.distance(PROFILE["branding_face"].boundary))
    if clearance < 1.0 - 1e-3:
        fail(f"Artwork clearance is below 1 mm ({clearance:.3f} mm).")
    # In contour mode the logo rests on the raised integrated contour face,
    # matching the corrected NY build. Its XY placement/scale remain Studio's.
    contour_wall_height = float(PROFILE.get("branding_wall_height_mm", 0.85))
    artwork_base_z = PROFILE["base_z_mm"] + (contour_wall_height if artwork_mode == "contour" else 0.0)
    # Place the 2D closed paths in the calibrated face coordinate system.
    solids = []
    for poly in polygons:
        def wire(coords):
            return cq.Wire.makePolygon([cq.Vector(x0 + (x - minx) * scale, y0 + (maxy - y) * scale, artwork_base_z) for x, y in coords], close=True)
        outer = wire(list(poly.exterior.coords)[:-1])
        holes = [wire(list(ring.coords)[:-1]) for ring in poly.interiors]
        face = cq.Face.makeFromWires(outer, holes)
        solid = cq.Solid.extrudeLinear(face, cq.Vector(0, 0, PROFILE["relief_mm"]))
        solids.append(solid)
    shape = cq.Compound.makeCompound(solids)
    if not shape.isValid() or len(shape.Solids()) != len(solids):
        fail("Raised artwork geometry did not pass the CAD solid validity check.")
    cad_clearance = "not_checked"
    assembly_validation = None
    contour_files = None
    if sleeve_step is not None or support_step is not None:
        if sleeve_step is None or support_step is None or not sleeve_step.is_file() or not support_step.is_file():
            fail("Both matching approved CAD STEP references are required for the clearance check.")
        sleeve_shape = PROFILE["sleeve_shape"]
        support_shape = cq.importers.importStep(str(support_step)).val()
        body_overlap = shape.intersect(sleeve_shape).Volume()
        support_overlap = shape.intersect(support_shape).Volume()
        if body_overlap > 0.001 or support_overlap > 0.001:
            fail(f"Artwork intersects approved CAD (body={body_overlap:.4f} mm³, support={support_overlap:.4f} mm³). Manual review required.")
        cad_clearance = {"bodyIntersectionMm3": body_overlap, "plaSupportIntersectionMm3": support_overlap, "passed": True}
        final_sleeve, final_support = sleeve_shape, support_shape
        if artwork_mode == "contour":
            final_sleeve, _ring, overhang_xy, _expanded = integrate_contour_into_branding_wall(
                sleeve_shape, placed, PROFILE["branding_face"], PROFILE["base_z_mm"], float(contour_width_mm), contour_wall_height, PROFILE["groove_right_x_mm"])
            final_support, raw_support, trimmed_support = generate_contour_cavity_fill(
                support_shape, overhang_xy, final_sleeve, PROFILE["base_z_mm"], PROFILE["branding_face"])
            if final_sleeve.intersect(sleeve_shape).Volume() < sleeve_shape.Volume() - 0.01:
                fail("Contour integration removed approved sleeve or snap-fit geometry.")
            if generated_dir is None:
                fail("Contour mode requires an isolated generated-output directory.")
            generated_dir.mkdir(parents=True, exist_ok=True)
            body_path = generated_dir / "contour-integrated-sleeve.stl"
            support_path = generated_dir / "contour-and-cavity-removable-support.stl"
            cq.exporters.export(final_sleeve, str(body_path), exportType="STL", tolerance=0.02, angularTolerance=0.1)
            cq.exporters.export(final_support, str(support_path), exportType="STL", tolerance=0.02, angularTolerance=0.1)
            contour_files = {"body": body_path, "support": support_path}
            assembly_validation = {"contourWidthMm": float(contour_width_mm),
                "contourIntegratedIntoSleeve": True,
                "contourZBoundsMm": [PROFILE["base_z_mm"], PROFILE["base_z_mm"] + contour_wall_height],
                "supportRawVolumeMm3": raw_support.Volume(), "supportTrimmedVolumeMm3": trimmed_support.Volume(),
                "supportSleeveIntersectionMm3": final_sleeve.intersect(final_support).Volume(),
                "cavityFillRetained": True, "contourSupportSeparatedFromPermanentBody": True,
                "contourSupportComponents": len(trimmed_support.Solids())}
        common_validation = validate_artwork_assembly(final_sleeve, final_support, shape,
            sleeve_shape, support_shape, artwork_mode == "contour")
        if assembly_validation:
            assembly_validation.update(common_validation)
        else:
            assembly_validation = common_validation
    cq.exporters.export(shape, str(stl), exportType="STL", tolerance=0.02, angularTolerance=0.1)
    # Geometry acceptance references the CAD face envelope used by the prior
    # Size 0 validation. This is a geometric check, not a physical print test.
    return {"widthMm": width, "heightMm": height, "centerXMm": center_x, "centerYMm": center_y, "studioArtworkCenterXMm": artwork_center_x_mm, "studioArtworkCenterYMm": artwork_center_y_mm, "studioLogoXPercent": logo_x, "studioLogoYPercent": logo_y, "studioLogoScalePercent": logo_scale, "uniformScale": scale, "riseMm": PROFILE["relief_mm"], "artworkBaseZMm": artwork_base_z, "artworkColor": artwork_color, "cadSolidValid": True, "boundaryValid": True, "grooveValleyXMm": PROFILE["groove_valley_x_mm"], "grooveRightEdgeMm": PROFILE["groove_right_x_mm"], "grooveDatumSource": PROFILE["groove_source"], "brandingFaceBoundsMm": PROFILE["face_bounds_mm"], "usableBrandingBoundsMm": PROFILE["usable_bounds_mm"], "minimumBrandingClearanceMm": clearance, "approvedCadClearance": cad_clearance, "artworkMode": artwork_mode, "studioContourSettings": {"enabled": artwork_mode == "contour", "outwardDilationRadiusMm": contour_width_mm, "color": contour_color}, "assemblyValidation": assembly_validation, "contourFiles": {key: str(value) for key, value in contour_files.items()} if contour_files else None}


def read_binary_stl(path: Path):
    data = path.read_bytes()
    if len(data) < 84:
        fail("Generated STL is incomplete.")
    n = struct.unpack_from("<I", data, 80)[0]
    if n < 4 or len(data) != 84 + 50 * n:
        fail("Generated STL is not a valid binary triangle mesh.")
    vertices, faces, lookup = [], [], {}
    for i in range(n):
        offset = 84 + i * 50 + 12
        face = []
        for j in range(3):
            x, y, z = struct.unpack_from("<fff", data, offset + j * 12)
            # Existing package assembly places the baseline build at +Z 1.63.
            # Use the same local-space conversion as the prior validated 3MF test.
            point = (round(x - 42.85, 7), round(y, 7), round(z - 1.63, 7))
            if point not in lookup:
                lookup[point] = len(vertices); vertices.append(point)
            face.append(lookup[point])
        faces.append(face)
    if not vertices or any(not all(math.isfinite(c) for c in v) for v in vertices):
        fail("Generated mesh contains non-finite coordinates.")
    validate_closed_triangle_mesh(vertices, faces, path.name)
    return vertices, faces


def validate_closed_triangle_mesh(vertices, faces, label: str):
    """Require a closed, two-manifold triangle shell in exported STL meshes."""
    edge_counts = {}
    for a, b, c in faces:
        if len({a, b, c}) != 3:
            fail(f"Generated {label} mesh contains a degenerate triangle.")
        for edge in ((a, b), (b, c), (c, a)):
            key = (min(edge), max(edge))
            edge_counts[key] = edge_counts.get(key, 0) + 1
    bad = sum(count != 2 for count in edge_counts.values())
    if not faces or bad:
        fail(f"Generated {label} mesh is not a closed two-manifold ({bad} open/nonmanifold edges).")
    return {"vertices": len(vertices), "triangles": len(faces), "closedTwoManifold": True}


def append_binary_stl_mesh(obj, path: Path):
    """Append a generated model-local binary STL mesh to a 3MF object."""
    vertices, faces = read_binary_stl(path)
    mesh = ET.SubElement(obj, f"{{{CORE}}}mesh")
    vertex_node = ET.SubElement(mesh, f"{{{CORE}}}vertices")
    for x, y, z in vertices:
        ET.SubElement(vertex_node, f"{{{CORE}}}vertex", {"x": f"{x:.7f}", "y": f"{y:.7f}", "z": f"{z:.7f}"})
    triangle_node = ET.SubElement(mesh, f"{{{CORE}}}triangles")
    for a, b, c in faces:
        ET.SubElement(triangle_node, f"{{{CORE}}}triangle", {"v1": str(a), "v2": str(b), "v3": str(c)})
    return len(vertices), len(faces)


def validate_3mf_mesh_object(obj, label: str) -> dict:
    mesh = obj.find("m:mesh", NS)
    vertices_node = mesh.find("m:vertices", NS) if mesh is not None else None
    triangles_node = mesh.find("m:triangles", NS) if mesh is not None else None
    vertices = vertices_node.findall("m:vertex", NS) if vertices_node is not None else []
    triangles = triangles_node.findall("m:triangle", NS) if triangles_node is not None else []
    if len(vertices) < 4 or len(triangles) < 4:
        fail(f"Generated 3MF {label} mesh is empty or incomplete.")
    coords = []
    for vertex in vertices:
        point = tuple(float(vertex.get(axis, "nan")) for axis in ("x", "y", "z"))
        if not all(math.isfinite(value) for value in point):
            fail(f"Generated 3MF {label} mesh contains non-finite coordinates.")
        coords.append(point)
    for triangle in triangles:
        indices = tuple(int(triangle.get(key, "-1")) for key in ("v1", "v2", "v3"))
        if len(set(indices)) != 3 or any(index < 0 or index >= len(coords) for index in indices):
            fail(f"Generated 3MF {label} mesh contains invalid triangle indices.")
        a, b, c = (coords[index] for index in indices)
        cross = ((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),
                 (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),
                 (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
        if sum(value*value for value in cross) <= 1e-18:
            fail(f"Generated 3MF {label} mesh contains a degenerate triangle.")
    return {"vertices": len(vertices), "triangles": len(triangles)}


def package(baseline: Path, output: Path, vertices, faces, title: str, sleeve_color: str, artwork_color: str, contour_body_stl: Path | None = None, contour_support_stl: Path | None = None) -> dict:
    if output.exists():
        fail(f"Refusing to overwrite customer output: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(baseline) as zin:
        files = {info.filename: zin.read(info.filename) for info in zin.infolist() if not info.is_dir()}
    removed_thumbnail_relationships = 0
    for rel_name in (name for name in files if name.endswith(".rels")):
        rel_root = ET.fromstring(files[rel_name])
        source_dir = str(Path(rel_name).parent.parent).replace("\\", "/") if "/_rels/" in rel_name else ""
        for relationship in list(rel_root):
            target = relationship.get("Target", "")
            resolved_target = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(source_dir, target))
            if resolved_target in files:
                continue
            if relationship.get("Type") in OPTIONAL_THUMBNAIL_RELATIONSHIPS:
                rel_root.remove(relationship)
                removed_thumbnail_relationships += 1
            else:
                fail(f"Baseline relationship {rel_name} points to missing package entry {resolved_target}.")
        # Relationship parts must retain the package relationships namespace as
        # their default namespace. Serializing with CORE registered globally
        # rewrites these parts with an ns0 prefix that Snapmaker Orca rejects.
        ET.register_namespace("", RELATIONSHIPS)
        files[rel_name] = ET.tostring(rel_root, encoding="utf-8", xml_declaration=True)
        ET.register_namespace("", CORE)
    if "3D/3dmodel.model" not in files or "Metadata/model_settings.config" not in files or "Metadata/project_settings.config" not in files:
        fail("Baseline is missing expected Snapmaker Orca 3MF project entries.")
    main = ET.fromstring(files["3D/3dmodel.model"])
    build = main.find("m:build", NS)
    if build is None or len(build) != 1:
        fail("Approved baseline must contain exactly one production build item.")
    assembly_id = build[0].get("objectid")
    assembly = main.find(f".//m:object[@id='{assembly_id}']", NS)
    if assembly is None:
        fail("Approved baseline build item does not resolve to an assembly object.")
    comps = assembly.find("m:components", NS)
    if comps is None or not {"1", "2"}.issubset({c.get("objectid") for c in comps}):
        fail("Expected the immutable TPU sleeve and PLA support components in the approved assembly.")
    original_components = [(c.get("objectid"), c.get("transform"), c.get(f"{{{PROD}}}path")) for c in comps]
    if any(not object_id or not transform or not path for object_id, transform, path in original_components):
        fail("Approved baseline contains a component with incomplete reference or placement metadata.")
    comp_path = comps[0].get(f"{{{PROD}}}path")
    if not comp_path:
        fail("Baseline part path missing.")
    child = comp_path.lstrip("/")
    child_model = ET.fromstring(files[child])
    resources = child_model.find("m:resources", NS)
    if resources is None:
        fail("Approved baseline child model has no resources collection.")
    existing_objects = {obj.get("id"): ET.tostring(obj) for obj in resources.findall("m:object", NS)}
    modified_object_ids = set()
    for object_id, mesh_path in (("1", contour_body_stl), ("2", contour_support_stl)):
        if mesh_path is None:
            continue
        target_obj = resources.find(f"m:object[@id='{object_id}']", NS)
        if target_obj is None or target_obj.find("m:mesh", NS) is None:
            fail(f"Contour assembly cannot locate baseline component {object_id} mesh.")
        mesh = target_obj.find("m:mesh", NS)
        target_obj.remove(mesh)
        temp_obj = ET.Element(f"{{{CORE}}}object", {"id": object_id, "type": "model"})
        append_binary_stl_mesh(temp_obj, mesh_path)
        target_obj.append(temp_obj.find("m:mesh", NS))
        modified_object_ids.add(object_id)
    numeric_ids = [int(object_id) for object_id in existing_objects if object_id and object_id.isdigit()]
    artwork_object_id = str(max(numeric_ids, default=0) + 1)
    obj = ET.SubElement(resources, f"{{{CORE}}}object", {"id": artwork_object_id, "type": "model", f"{{{PROD}}}UUID": str(uuid4())})
    mesh = ET.SubElement(obj, f"{{{CORE}}}mesh")
    verts_xml = ET.SubElement(mesh, f"{{{CORE}}}vertices")
    for x, y, z in vertices:
        ET.SubElement(verts_xml, f"{{{CORE}}}vertex", {"x": f"{x:.7f}", "y": f"{y:.7f}", "z": f"{z:.7f}"})
    tris_xml = ET.SubElement(mesh, f"{{{CORE}}}triangles")
    for a, b, c in faces:
        ET.SubElement(tris_xml, f"{{{CORE}}}triangle", {"v1": str(a), "v2": str(b), "v3": str(c)})
    files[child] = ET.tostring(child_model, encoding="utf-8", xml_declaration=True)
    ET.SubElement(comps, f"{{{CORE}}}component", {"objectid": artwork_object_id, "transform": "1 0 0 0 1 0 0 0 1 0 0 0", f"{{{PROD}}}path": "/" + child, f"{{{PROD}}}UUID": str(uuid4())})
    for md in main.findall(".//m:metadata[@name='Title']", NS): md.text = title
    files["3D/3dmodel.model"] = ET.tostring(main, encoding="utf-8", xml_declaration=True)
    settings = ET.fromstring(files["Metadata/model_settings.config"])
    sassembly = settings.find(f"object[@id='{assembly_id}']")
    if sassembly is None: fail("Orca assembly settings object is missing for the production build item.")
    for metadata in sassembly.findall("metadata"):
        if metadata.get("key") == "name": metadata.set("value", title)
    part = ET.SubElement(sassembly, "part", {"id": artwork_object_id, "subtype": "normal_part"})
    values = {"name": "Customer raised vector artwork", "matrix": "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1", "source_file": "customer-vector-relief.stl", "source_object_id": "0", "source_volume_id": "0", "source_offset_x": "42.85", "source_offset_y": "0", "source_offset_z": "1.63", "extruder": str(PROFILE["artwork_extruder"])}
    for key, value in values.items(): ET.SubElement(part, "metadata", {"key": key, "value": value})
    ET.SubElement(part, "mesh_stat", {k: "0" for k in ["edges_fixed", "degenerate_facets", "facets_removed", "facets_reversed", "backwards_edges"]})
    for metadata in settings.findall(".//metadata"):
        if metadata.get("key") == "plater_name": metadata.set("value", title + "_Orca")
    files["Metadata/model_settings.config"] = ET.tostring(settings, encoding="utf-8", xml_declaration=True)
    project = json.loads(files["Metadata/project_settings.config"])
    if project.get("printer_settings_id") != "Snapmaker U1 (0.4 nozzle)": fail("Baseline U1 printer profile changed or missing.")
    slots = project.get("filament_settings_id", [])
    types = project.get("filament_type", [])
    if len(slots) < PROFILE["support_extruder"] or len(types) < PROFILE["support_extruder"]: fail("Baseline is missing an assigned artwork or support filament slot.")
    artwork_material = slots[PROFILE["artwork_extruder"] - 1]
    support_material = slots[PROFILE["support_extruder"] - 1]
    if len(types) < 1 or types[0] != "TPU": fail("Baseline sleeve is no longer assigned to a TPU material slot.")
    if artwork_material != "SnapInk - EONO3D TPU 95A" or types[PROFILE["artwork_extruder"] - 1] != "TPU": fail("Approved artwork slot is no longer the existing SnapInk TPU profile.")
    if support_material != "Snapmaker PLA Basic @U1" or types[PROFILE["support_extruder"] - 1] != "PLA": fail("Approved support slot is no longer the existing PLA profile.")
    settings_parts = settings.findall(f"object[@id='{assembly_id}']/part")
    support_part = next((part for part in settings_parts if part.get("id") == "2"), None)
    support_ext = next((m.get("value") for m in support_part.findall("metadata") if m.get("key") == "extruder"), None) if support_part is not None else None
    if support_ext != str(PROFILE["support_extruder"]): fail("Approved PLA support part is not assigned to the expected extruder.")
    sleeve_part = next((part for part in settings_parts if part.get("id") == "1"), None)
    sleeve_ext = next((m.get("value") for m in sleeve_part.findall("metadata") if m.get("key") == "extruder"), None) if sleeve_part is not None else None
    if sleeve_ext != "0": fail("Approved TPU sleeve part is not assigned to the validated first material slot.")
    artwork_part = next((part for part in settings_parts if part.get("id") == artwork_object_id), None)
    artwork_ext = next((m.get("value") for m in artwork_part.findall("metadata") if m.get("key") == "extruder"), None) if artwork_part is not None else None
    if artwork_ext != str(PROFILE["artwork_extruder"]): fail("Raised artwork is not assigned to the validated TPU extruder.")
    project["title"] = title
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", sleeve_color): fail("Sleeve color must be a hex color.")
    project_colors = list(project.get("filament_colour", []))
    while len(project_colors) < 4: project_colors.append("#26A69A")
    project_colors[0] = sleeve_color
    project_colors[PROFILE["artwork_extruder"] - 1] = artwork_color
    project["filament_colour"] = project_colors
    files["Metadata/project_settings.config"] = json.dumps(project, ensure_ascii=False, separators=(",", ":")).encode()
    tmp = output.with_suffix(output.suffix + ".tmp")
    if tmp.exists(): fail(f"Refusing to overwrite temporary file {tmp}")
    try:
        with zipfile.ZipFile(tmp, "x", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, payload in files.items(): zout.writestr(name, payload)
        # Read back structural/package invariants and immutable original mesh bytes.
        with zipfile.ZipFile(baseline) as a, zipfile.ZipFile(tmp) as b:
            for name in ("3D/3dmodel.model", child, "Metadata/model_settings.config", "Metadata/project_settings.config"):
                if name not in b.namelist(): fail(f"Generated package missing {name}.")
            after = ET.fromstring(b.read("3D/3dmodel.model")); aa = after.find(f".//m:object[@id='{assembly_id}']", NS)
            after_comps = aa.find("m:components", NS)
            if len(after_comps) != len(original_components) + 1: fail("Generated assembly did not preserve all baseline components and add one artwork component.")
            generated_originals = [(c.get("objectid"), c.get("transform"), c.get(f"{{{PROD}}}path")) for c in list(after_comps)[:-1]]
            if generated_originals != original_components: fail("Approved baseline component transforms or references changed.")
            original_child = ET.fromstring(a.read(child)); new_child = ET.fromstring(b.read(child))
            for object_id, original_xml in existing_objects.items():
                old_obj = original_child.find(f"m:resources/m:object[@id='{object_id}']", NS)
                new_obj = new_child.find(f"m:resources/m:object[@id='{object_id}']", NS)
                if new_obj is None or (object_id not in modified_object_ids and ET.tostring(new_obj) != original_xml): fail(f"Approved baseline part {object_id} changed unexpectedly.")
            verified_meshes = {}
            for object_id, label in (("1", "sleeve"), ("2", "removable support"), (artwork_object_id, "raised artwork")):
                mesh_obj = new_child.find(f"m:resources/m:object[@id='{object_id}']", NS)
                if mesh_obj is None: fail(f"Generated project is missing the {label} component mesh.")
                verified_meshes[label] = validate_3mf_mesh_object(mesh_obj, label)
            if modified_object_ids and modified_object_ids != {"1", "2"}:
                fail("Contour mode must replace both the sleeve and removable support meshes as a matched assembly.")
        tmp.replace(output)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return {"assemblyComponents": len(original_components) + 1, "baselineComponents": len(original_components), "artworkObjectId": artwork_object_id, "meshVertices": len(vertices), "meshTriangles": len(faces), "validatedMeshObjects": verified_meshes, "removedDanglingThumbnailRelationships": removed_thumbnail_relationships, "sleeveAndSupportUnchanged": not modified_object_ids, "approvedSleeveGeometryPreserved": True, "removableSupportSeparate": True, "contourGeometryIntegrated": bool(modified_object_ids), "printerProfile": project["printer_settings_id"], "sleeveMaterialSlot": 1, "sleeveMaterial": project["filament_settings_id"][0], "artworkMaterialSlot": PROFILE["artwork_extruder"], "artworkMaterial": project["filament_settings_id"][PROFILE["artwork_extruder"] - 1], "supportMaterialSlot": PROFILE["support_extruder"], "supportMaterial": project["filament_settings_id"][PROFILE["support_extruder"] - 1], "outputSha256": sha256(output)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", type=Path, required=True)
    ap.add_argument("--baseline-sha256", required=True)
    ap.add_argument("--svg", type=Path, required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    ap.add_argument("--order-id", required=True)
    ap.add_argument("--target-width-mm", type=float, default=None)
    ap.add_argument("--logo-x", type=float, default=59.42)
    ap.add_argument("--logo-y", type=float, default=50.0)
    ap.add_argument("--artwork-center-x-mm", type=float, default=None, help="CAD-coordinate X emitted by the current Studio positioning system.")
    ap.add_argument("--artwork-center-y-mm", type=float, default=None, help="CAD-coordinate Y emitted by the current Studio positioning system.")
    ap.add_argument("--logo-scale", type=float, default=100.0)
    ap.add_argument("--artwork-mode", choices=("standard", "contour"), default="standard", help="Contour mode is opt-in; standard remains the default.")
    ap.add_argument("--contour-width-mm", type=float, default=None, help="Explicit Studio stroke/contour width; required in contour mode.")
    ap.add_argument("--contour-color", default=None, help="Explicit Studio contour color (must match sleeve color for an integrated wall).")
    ap.add_argument("--sleeve-color", default="#000000")
    ap.add_argument("--variant", default="billboard")
    ap.add_argument("--size", type=int, default=0)
    ap.add_argument("--sleeve-step", type=Path, required=True, help="Matching approved STEP sleeve used to derive the branding face and validate clearance")
    ap.add_argument("--support-step", type=Path, required=True, help="Matching approved STEP PLA support used for the clearance check")
    args = ap.parse_args()
    global PROFILE
    validate_approved_inputs(args.variant, args.size, args.baseline, args.sleeve_step, args.support_step)
    cad_catalog = json.loads((Path(__file__).resolve().parent / "cad-reference-manifest.json").read_text(encoding="utf-8-sig"))
    PROFILE = derive_profile(args.variant, args.size, args.sleeve_step, float(cad_catalog["grooveDatumBillboardSizes0To2Mm"]))
    PROFILE["sleeve_step"] = args.sleeve_step
    PROFILE["support_step"] = args.support_step
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.order_id): fail("Invalid safe order identifier.")
    if sha256(args.baseline).lower() != args.baseline_sha256.lower(): fail("Approved baseline SHA-256 mismatch.")
    outdir = args.output_dir / args.order_id
    outdir.mkdir(parents=True, exist_ok=False)
    original = outdir / "artwork-original.svg"
    original.write_bytes(args.svg.read_bytes())
    stl = outdir / "customer-vector-relief.stl"
    geom = build_relief(original, stl, args.target_width_mm, args.logo_x, args.logo_y, args.logo_scale, args.sleeve_step, args.support_step, args.artwork_center_x_mm, args.artwork_center_y_mm, args.artwork_mode, args.contour_width_mm, outdir, args.contour_color, args.sleeve_color)
    geom["brandingCenterXMm"] = PROFILE["branding_center_x_mm"]
    geom["positioningVersion"] = "cad-flap-valley-to-right-edge-v1"
    vertices, faces = read_binary_stl(stl)
    title = f"SnapInk_{args.order_id}_{args.variant.title()}_Size_{args.size}_Custom"
    project = outdir / f"{title}.3mf"
    contour_files = geom.get("contourFiles") or {}
    package_info = package(args.baseline, project, vertices, faces, title, args.sleeve_color, geom["artworkColor"], Path(contour_files["body"]) if contour_files else None, Path(contour_files["support"]) if contour_files else None)
    all_geometry_checks = geom["approvedCadClearance"] != "not_checked"
    report = {"jobId": args.order_id, "variant": args.variant, "size": args.size, "baselineSha256": sha256(args.baseline), "artworkSha256": sha256(original), "geometry": geom, "package": package_info, "validation": "approved CAD clearance, geometry, envelope, and package checks passed; no physical print validation" if all_geometry_checks else "envelope and package checks passed; approved CAD clearance not run; no physical print validation", "status": "requires_owner_review"}
    (outdir / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, separators=(",", ":")))
    # The installed CadQuery/OpenCascade Python environment has a native DLL
    # teardown access violation after normal interpreter cleanup. All file
    # handles are closed and the validation report is durably written here;
    # flush output and terminate cleanly instead of returning a false failure.
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    try: sys.exit(main())
    except Exception as exc:
        print(json.dumps({"status": "requires_review", "error": str(exc)}), file=sys.stderr)
        sys.stderr.flush()
        os._exit(2)

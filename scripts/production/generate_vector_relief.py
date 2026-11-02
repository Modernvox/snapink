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


def build_relief(svg: Path, stl: Path, requested_width: float | None, logo_x: float, logo_y: float, logo_scale: float, sleeve_step: Path, support_step: Path, artwork_center_x_mm: float | None = None) -> dict:
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
    # Place the 2D closed paths in the calibrated face coordinate system.
    solids = []
    for poly in polygons:
        def wire(coords):
            return cq.Wire.makePolygon([cq.Vector(x0 + (x - minx) * scale, y0 + (maxy - y) * scale, PROFILE["base_z_mm"]) for x, y in coords], close=True)
        outer = wire(list(poly.exterior.coords)[:-1])
        holes = [wire(list(ring.coords)[:-1]) for ring in poly.interiors]
        face = cq.Face.makeFromWires(outer, holes)
        solid = cq.Solid.extrudeLinear(face, cq.Vector(0, 0, PROFILE["relief_mm"]))
        solids.append(solid)
    shape = cq.Compound.makeCompound(solids)
    if not shape.isValid() or len(shape.Solids()) != len(solids):
        fail("Raised artwork geometry did not pass the CAD solid validity check.")
    cad_clearance = "not_checked"
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
    cq.exporters.export(shape, str(stl), exportType="STL", tolerance=0.02, angularTolerance=0.1)
    # Geometry acceptance references the CAD face envelope used by the prior
    # Size 0 validation. This is a geometric check, not a physical print test.
    return {"widthMm": width, "heightMm": height, "centerXMm": center_x, "centerYMm": center_y, "uniformScale": scale, "riseMm": PROFILE["relief_mm"], "artworkColor": artwork_color, "cadSolidValid": True, "boundaryValid": True, "grooveValleyXMm": PROFILE["groove_valley_x_mm"], "grooveRightEdgeMm": PROFILE["groove_right_x_mm"], "grooveDatumSource": PROFILE["groove_source"], "brandingFaceBoundsMm": PROFILE["face_bounds_mm"], "usableBrandingBoundsMm": PROFILE["usable_bounds_mm"], "minimumBrandingClearanceMm": clearance, "approvedCadClearance": cad_clearance}


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
    return vertices, faces


def package(baseline: Path, output: Path, vertices, faces, title: str, sleeve_color: str, artwork_color: str) -> dict:
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
    if artwork_material != "SnapInk - EONO3D TPU 95A" or types[PROFILE["artwork_extruder"] - 1] != "TPU": fail("Approved artwork slot is no longer the existing SnapInk TPU profile.")
    if support_material != "Snapmaker PLA Basic @U1" or types[PROFILE["support_extruder"] - 1] != "PLA": fail("Approved support slot is no longer the existing PLA profile.")
    settings_parts = settings.findall(f"object[@id='{assembly_id}']/part")
    support_part = next((part for part in settings_parts if part.get("id") == "2"), None)
    support_ext = next((m.get("value") for m in support_part.findall("metadata") if m.get("key") == "extruder"), None) if support_part is not None else None
    if support_ext != str(PROFILE["support_extruder"]): fail("Approved PLA support part is not assigned to the expected extruder.")
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
                if new_obj is None or ET.tostring(new_obj) != original_xml: fail(f"Approved baseline part {object_id} changed.")
        tmp.replace(output)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return {"assemblyComponents": len(original_components) + 1, "baselineComponents": len(original_components), "artworkObjectId": artwork_object_id, "meshVertices": len(vertices), "meshTriangles": len(faces), "removedDanglingThumbnailRelationships": removed_thumbnail_relationships, "sleeveAndSupportUnchanged": True, "printerProfile": project["printer_settings_id"], "sleeveMaterialSlot": 1, "sleeveMaterial": project["filament_settings_id"][0], "artworkMaterialSlot": PROFILE["artwork_extruder"], "artworkMaterial": project["filament_settings_id"][PROFILE["artwork_extruder"] - 1], "supportMaterialSlot": PROFILE["support_extruder"], "supportMaterial": project["filament_settings_id"][PROFILE["support_extruder"] - 1], "outputSha256": sha256(output)}


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
    ap.add_argument("--logo-scale", type=float, default=100.0)
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
    geom = build_relief(original, stl, args.target_width_mm, args.logo_x, args.logo_y, args.logo_scale, args.sleeve_step, args.support_step, args.artwork_center_x_mm)
    geom["brandingCenterXMm"] = PROFILE["branding_center_x_mm"]
    geom["positioningVersion"] = "cad-flap-valley-to-right-edge-v1"
    vertices, faces = read_binary_stl(stl)
    title = f"SnapInk_{args.order_id}_{args.variant.title()}_Size_{args.size}_Custom"
    project = outdir / f"{title}.3mf"
    package_info = package(args.baseline, project, vertices, faces, title, args.sleeve_color, geom["artworkColor"])
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

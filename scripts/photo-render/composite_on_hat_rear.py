"""Pixel-locked composite for the approved SnapInk rear-hat master image."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, PngImagePlugin
from shapely import contains_xy, union_all
from shapely.geometry import Polygon, box


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "scripts/photo-render/on-hat-rear-reference.json"
def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def srgb_to_linear(color):
    color = np.asarray(color, dtype=np.float32)
    return np.where(color <= 0.04045, color / 12.92, ((color + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(color):
    color = np.clip(color, 0.0, 1.0)
    return np.where(color <= 0.0031308, color * 12.92,
                    1.055 * np.power(color, 1.0 / 2.4) - 0.055)


def cad_half_width(x: float, profile: dict) -> float:
    half_body = float(profile["bodyWidthMm"]) / 2.0
    bow = float(profile.get("billboardBowMm") or 0.0)
    if bow <= 0:
        return half_body
    bow_length = float(profile["bowReferenceLengthMm"])
    bow_half = bow_length / 2.0
    radius = (bow_half * bow_half + bow * bow) / (2.0 * bow)
    dx = x - bow_half
    offset = radius - math.sqrt(max(0.0, radius * radius - dx * dx))
    return half_body + offset


def cad_to_uv(points, cad: dict) -> np.ndarray:
    """Normalize CAD points to the groove-to-right-edge printable face."""
    points = np.asarray(points, dtype=np.float32)
    groove = float(cad["grooveXmm"])
    right = float(cad["rightEdgeXmm"])
    span = right - groove
    if span <= 0:
        raise RuntimeError("CAD printable face has invalid horizontal bounds.")
    mapped = []
    profile = cad["surfaceProfile"]
    for x, y in points:
        half_width = cad_half_width(float(x), profile)
        if half_width <= 0:
            raise RuntimeError("CAD surface profile is invalid.")
        mapped.append(((float(x) - groove) / span,
                       (half_width - float(y)) / (2.0 * half_width)))
    return np.asarray(mapped, dtype=np.float32)


def validate_placement(settings: dict, vector_data: dict, art: dict) -> None:
    cad = settings.get("cadBrandingReference")
    if not cad:
        raise RuntimeError("The job is missing server-derived CAD branding bounds.")
    x0 = float(art["centerX"]) - float(art["width"]) / 2.0
    x1 = float(art["centerX"]) + float(art["width"]) / 2.0
    y0 = float(art["centerY"]) - float(art["height"]) / 2.0
    y1 = float(art["centerY"]) + float(art["height"]) / 2.0
    clearance = float(cad["edgeClearanceMm"])
    groove_max = float(cad["grooveXmm"]) + float(cad["grooveWidthMm"]) / 2.0
    if x0 < groove_max + clearance - 0.01 or x1 > float(cad["rightEdgeXmm"]) - clearance + 0.01:
        raise RuntimeError("Artwork bounds cross the groove/flap exclusion or the 1 mm CAD clearance.")
    profile = cad["surfaceProfile"]
    for x in np.linspace(x0, x1, max(2, int(math.ceil((x1 - x0) / 0.25)) + 1)):
        half_width = cad_half_width(float(x), profile)
        if y0 < -half_width + clearance - 0.01 or y1 > half_width - clearance + 0.01:
            raise RuntimeError("Artwork bounds exceed the curved CAD face or its 1 mm clearance.")
    visible = vector_data.get("visibleBoundsPx")
    source_width, source_height = vector_data.get("sourceWidth"), vector_data.get("sourceHeight")
    if (not visible or len(visible) != 4 or not source_width or not source_height
            or visible[0] < 0 or visible[1] < 0 or visible[2] > source_width or visible[3] > source_height):
        raise RuntimeError("Vector contour metadata is incomplete.")


def composite(reference: dict, args) -> dict:
    master_path = (ROOT / reference["masterImage"]).resolve()
    output_path = args.output.resolve()
    if output_path == master_path:
        raise RuntimeError("Generated output cannot overwrite the locked master image.")
    if output_path.suffix.lower() != ".png":
        raise RuntimeError("Locked-master composites must be saved as PNG.")
    if args.metadata.resolve() == master_path or not args.metadata.is_file():
        raise RuntimeError("Blender render metadata is missing.")
    if sha256(master_path) != reference["masterImageSha256"]:
        raise RuntimeError("Locked On-Hat master image SHA-256 changed; refusing to composite.")

    metadata = json.loads(args.metadata.read_text(encoding="utf-8-sig"))
    job = json.loads(args.job.read_text(encoding="utf-8-sig"))
    settings = job["settings"]
    if metadata.get("scene") != "on-hat-rear" or settings.get("scene") != "on-hat-rear":
        raise RuntimeError("Render metadata and queued Photo Type do not match.")
    for key in ("masterImageId", "masterImageSha256", "calibrationVersion"):
        if metadata.get(key) != reference.get(key):
            raise RuntimeError(f"Blender pass {key} does not match the locked master calibration.")
    if metadata.get("cadSha256") != metadata.get("catalogCadSha256"):
        raise RuntimeError("The CAD source digest does not match the pinned renderer catalog.")
    if float(metadata.get("artworkReliefMm", 0)) != float(reference["referenceCad"]["reliefMm"]):
        raise RuntimeError("Raised artwork relief does not match the approved 0.8 mm reference.")

    master = cv2.imread(str(master_path), cv2.IMREAD_COLOR)
    base = cv2.imread(str(args.passes_dir / "without-art.png"), cv2.IMREAD_COLOR)
    with_art = cv2.imread(str(args.passes_dir / "with-art.png"), cv2.IMREAD_COLOR)
    if master is None or base is None or with_art is None:
        raise RuntimeError("The locked master or Blender lighting passes are missing/corrupt.")
    expected_width, expected_height = reference["masterCanvasPx"]
    height, width = master.shape[:2]
    if [width, height] != [expected_width, expected_height]:
        raise RuntimeError("Master image dimensions do not match the locked 1536 x 1024 manifest.")
    if base.shape != with_art.shape or base.shape[:2] != tuple(metadata["renderResolutionPx"][::-1]):
        raise RuntimeError("Blender lighting passes do not match their render metadata dimensions.")

    artwork_path = Path(metadata["artworkPath"])
    if not artwork_path.is_file() or sha256(artwork_path) != metadata.get("artworkSha256"):
        raise RuntimeError("Artwork changed after the Blender geometry render.")
    vector_path = Path(metadata["vectorDataPath"])
    vector_data = json.loads(vector_path.read_text(encoding="utf-8-sig"))
    if vector_data.get("sourceSha256") != metadata["artworkSha256"]:
        raise RuntimeError("Contour cache does not match the rendered source artwork.")
    artwork_rgba = cv2.imread(str(artwork_path), cv2.IMREAD_UNCHANGED)
    if artwork_rgba is None or artwork_rgba.ndim != 3 or artwork_rgba.shape[2] != 4:
        raise RuntimeError("Artwork must be sanitized RGBA raster data.")
    validate_placement(settings, vector_data, metadata["artworkPlacementMm"])

    contour = union_all([Polygon(poly["exterior"], poly["holes"])
                         for poly in vector_data["polygons"]])
    grid_y, grid_x = np.mgrid[0:artwork_rgba.shape[0], 0:artwork_rgba.shape[1]]
    source_mask = contains_xy(contour, grid_x + 0.5, grid_y + 0.5).astype(np.float32)
    bx0, by0, bx1, by1 = map(float, vector_data["visibleBoundsPx"])
    source_corners = np.asarray([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], np.float32)

    source_cad = settings["cadBrandingReference"]
    target_cad = reference["referenceCad"]
    master_body_quad = np.asarray(reference["mainBodyQuadPx"], np.float32)
    unit_quad = np.asarray([[0, 0], [1, 0], [1, 1], [0, 1]], np.float32)
    unit_to_plate = cv2.getPerspectiveTransform(unit_quad, master_body_quad)

    frame_physical = np.asarray(metadata["framePhysicalMm"], np.float32)
    frame_unit = cad_to_uv(frame_physical, source_cad)
    frame_plate = cv2.perspectiveTransform(frame_unit.reshape(1, -1, 2), unit_to_plate)[0]
    frame_projected = np.asarray(metadata["frameProjectedCornersPx"], np.float32)
    render_to_plate = cv2.getPerspectiveTransform(frame_projected, frame_plate.astype(np.float32))

    art = metadata["artworkPlacementMm"]
    art_x0 = float(art["centerX"]) - float(art["width"]) / 2.0
    art_x1 = float(art["centerX"]) + float(art["width"]) / 2.0
    art_y0 = float(art["centerY"]) - float(art["height"]) / 2.0
    art_y1 = float(art["centerY"]) + float(art["height"]) / 2.0
    art_cad_corners = np.asarray([[art_x0, art_y1], [art_x1, art_y1],
                                  [art_x1, art_y0], [art_x0, art_y0]], np.float32)
    art_unit = cad_to_uv(art_cad_corners, source_cad)
    art_quad = cv2.perspectiveTransform(art_unit.reshape(1, -1, 2), unit_to_plate)[0]
    source_to_plate = cv2.getPerspectiveTransform(source_corners, art_quad.astype(np.float32))
    raw_coverage = cv2.warpPerspective(source_mask, source_to_plate, (width, height),
                                   flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                   borderValue=0.0)

    printable_polygon = np.asarray(reference["printableMainBodyPolygonPx"], np.float32)
    printable_mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(printable_mask, [np.round(printable_polygon).astype(np.int32)], 1)
    if np.any((raw_coverage > 0.01) & (printable_mask == 0)):
        raise RuntimeError("Artwork projection crosses the authorized printable polygon; refusing to clip or expand its mask.")
    coverage = raw_coverage * printable_mask.astype(np.float32)
    if float(coverage.max()) <= 0.0:
        raise RuntimeError("Artwork did not project into the calibrated printable main-body region.")

    base_linear = srgb_to_linear(base.astype(np.float32) / 255.0)
    with_linear = srgb_to_linear(with_art.astype(np.float32) / 255.0)
    delta = with_linear - base_linear
    mapped_delta = cv2.warpPerspective(delta, render_to_plate, (width, height),
                                       flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                       borderValue=(0, 0, 0))
    hard_mask = (coverage >= 0.5).astype(np.uint8)
    eroded = cv2.erode(hard_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    edge_band = cv2.GaussianBlur((hard_mask - eroded).astype(np.float32), (0, 0), 0.38)
    shifted = np.zeros_like(hard_mask)
    shifted[:-1, :-1] = hard_mask[1:, 1:]
    lit_edge = cv2.GaussianBlur(np.clip(hard_mask.astype(np.float32) - shifted.astype(np.float32), 0, 1),
                                (0, 0), 0.45)

    master_linear = srgb_to_linear(master.astype(np.float32) / 255.0)
    if settings.get("artColor") == "original":
        source_bgr_linear = srgb_to_linear(artwork_rgba[:, :, :3].astype(np.float32) / 255.0)
        source_opacity = artwork_rgba[:, :, 3].astype(np.float32) / 255.0
        mapped_premultiplied = cv2.warpPerspective(
            source_bgr_linear * source_opacity[..., None], source_to_plate, (width, height),
            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        mapped_opacity = cv2.warpPerspective(source_opacity, source_to_plate, (width, height),
                                             flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                             borderValue=0.0)
        mapped_color = mapped_premultiplied / np.maximum(mapped_opacity[..., None], 1e-6)
    else:
        chosen = str(settings.get("artColor", "#ffffff"))
        if len(chosen) != 7 or not chosen.startswith("#"):
            raise RuntimeError("Unsupported On-Hat artwork color.")
        rgb = [int(chosen[index:index + 2], 16) / 255.0 for index in (1, 3, 5)]
        mapped_color = np.broadcast_to(srgb_to_linear(np.asarray(rgb, np.float32))[::-1], master_linear.shape)

    candidate = master_linear * (1.0 - coverage[..., None]) + mapped_color * coverage[..., None]
    edge_light = np.clip(mapped_delta, 0.0, 0.10) * edge_band[..., None] * 0.20
    edge_light += lit_edge[..., None] * 0.040
    candidate += edge_light
    shifted_shadow = np.zeros_like(coverage)
    shifted_shadow[3:, 3:] = coverage[:-3, :-3]
    contact = cv2.GaussianBlur(np.clip(shifted_shadow - coverage, 0, 1), (0, 0), 0.8)
    candidate *= 1.0 - contact[..., None] * 0.32

    # The 5 px ring is the complete allowance for antialiasing and contact
    # shadow. It remains clipped to the 1 mm-inset CAD-printable polygon.
    shadow_support = cv2.dilate((coverage > 0.001).astype(np.uint8),
                                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    allowed_mask = ((shadow_support > 0) & (printable_mask > 0))
    encoded = np.round(linear_to_srgb(candidate) * 255.0).astype(np.uint8)
    encoded[~allowed_mask] = master[~allowed_mask]
    changed = np.any(encoded != master, axis=2)
    if np.any(changed & ~allowed_mask):
        raise RuntimeError("Output integrity check failed: pixels outside the authorized mask changed.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    generation = {
        "masterImageId": reference["masterImageId"],
        "masterImageSha256": reference["masterImageSha256"],
        "calibrationVersion": reference["calibrationVersion"],
        "artworkSha256": metadata["artworkSha256"],
        "cadSha256": metadata["cadSha256"],
        "cadVariant": settings["variant"],
        "cadSize": int(settings["size"]),
        "artworkReliefMm": metadata["artworkReliefMm"],
        "outputFormat": "image/png",
        "width": width,
        "height": height,
        "changedPixels": int(changed.sum()),
        "authorizedMaskPixels": int(allowed_mask.sum()),
        "outsideMaskUnchanged": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("SnapInk Generation", json.dumps(generation, separators=(",", ":")))
    png_info.add_text("SnapInk Master Image ID", generation["masterImageId"])
    png_info.add_text("SnapInk Artwork SHA-256", generation["artworkSha256"])
    png_info.add_text("SnapInk Calibration Version", generation["calibrationVersion"])
    rgb_image = Image.fromarray(cv2.cvtColor(encoded, cv2.COLOR_BGR2RGB), mode="RGB")
    rgb_image.save(output_path, format="PNG", pnginfo=png_info, compress_level=6)

    # Re-open the exact saved PNG and assert the native canvas and master-pixel
    # invariant one final time before the worker can upload it.
    saved = cv2.imread(str(output_path), cv2.IMREAD_COLOR)
    if saved is None or saved.shape != master.shape or not np.array_equal(saved[~allowed_mask], master[~allowed_mask]):
        output_path.unlink(missing_ok=True)
        raise RuntimeError("Saved PNG failed native-size or outside-mask master-pixel verification.")
    result = {"ok": True, "scene": "on-hat-rear", "path": str(output_path),
              "sha256": sha256(output_path), **generation}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--passes-dir", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    reference = json.loads(REFERENCE.read_text(encoding="utf-8-sig"))
    if reference.get("schemaVersion") != 2 or not reference.get("calibrationVersion"):
        raise RuntimeError("Master-image manifest schema/calibration version is unsupported.")
    result = composite(reference, args)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()

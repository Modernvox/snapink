"""Composite an approved Blender raised-artwork render onto the locked plate."""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from shapely import contains_xy, union_all
from shapely.geometry import Polygon


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "scripts/photo-render/on-hat-rear-reference.json"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def srgb_to_linear(color):
    return np.where(color <= 0.04045, color / 12.92, ((color + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(color):
    color = np.clip(color, 0.0, 1.0)
    return np.where(color <= 0.0031308, color * 12.92,
                    1.055 * np.power(color, 1.0 / 2.4) - 0.055)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--passes-dir", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    reference = json.loads(REFERENCE.read_text(encoding="utf-8-sig"))
    master_path = ROOT / reference["masterImage"]
    if sha256(master_path) != reference["masterImageSha256"]:
        raise RuntimeError("Locked On-Hat master image hash changed; refusing to composite.")
    metadata = json.loads(args.metadata.read_text(encoding="utf-8-sig"))
    job = json.loads(args.job.read_text(encoding="utf-8-sig"))
    settings = job["settings"]
    if metadata.get("scene") != "on-hat-rear" or settings.get("scene") != "on-hat-rear":
        raise RuntimeError("The render metadata and queued Photo Type do not match.")
    if metadata["masterImageSha256"] != reference["masterImageSha256"]:
        raise RuntimeError("The Blender pass does not reference the locked master image.")

    master = cv2.imread(str(master_path), cv2.IMREAD_COLOR)
    base = cv2.imread(str(args.passes_dir / "without-art.png"), cv2.IMREAD_COLOR)
    with_art = cv2.imread(str(args.passes_dir / "with-art.png"), cv2.IMREAD_COLOR)
    if master is None or base is None or with_art is None:
        raise RuntimeError("The locked master or Blender lighting passes are missing or corrupt.")
    height, width = master.shape[:2]

    sleeve_quad = np.asarray(reference["masterSleeveQuadPx"], np.float32)
    left_mid = (sleeve_quad[0] + sleeve_quad[3]) * 0.5
    right_mid = (sleeve_quad[1] + sleeve_quad[2]) * 0.5
    x_axis = right_mid - left_mid
    px_per_mm = float(np.linalg.norm(x_axis) / reference["referenceCad"]["lengthMm"])
    x_axis /= np.linalg.norm(x_axis)
    y_axis = np.asarray([x_axis[1], -x_axis[0]], np.float32)
    plate_center = sleeve_quad.mean(axis=0)
    ref_center_x = float(reference["referenceCad"]["centerXmm"])

    def physical_to_plate(points):
        points = np.asarray(points, np.float32)
        return (plate_center + (points[:, :1] - ref_center_x) * px_per_mm * x_axis
                + points[:, 1:2] * px_per_mm * y_axis)

    frame_physical = np.asarray(metadata["framePhysicalMm"], np.float32)
    frame_physical[:, 0] = ref_center_x + frame_physical[:, 0] - float(settings["geometryCenterXmm"])
    frame_projected = np.asarray(metadata["frameProjectedCornersPx"], np.float32)
    render_to_plate = cv2.getPerspectiveTransform(frame_projected,
                                                   physical_to_plate(frame_physical).astype(np.float32))

    art = metadata["artworkPlacementMm"]
    geometry_center_x = float(settings["geometryCenterXmm"])
    artwork_center_x = ref_center_x + float(art["centerX"] - geometry_center_x)
    artwork_center_y = float(art["centerY"])
    art_x0, art_x1 = artwork_center_x - float(art["width"]) / 2, artwork_center_x + float(art["width"]) / 2
    art_y0, art_y1 = artwork_center_y - float(art["height"]) / 2, artwork_center_y + float(art["height"]) / 2
    art_quad = physical_to_plate(np.asarray([[art_x0, art_y1], [art_x1, art_y1],
                                             [art_x1, art_y0], [art_x0, art_y0]], np.float32))

    artwork_path = Path(metadata["artworkPath"])
    if sha256(artwork_path) != metadata["artworkSha256"]:
        raise RuntimeError("Artwork changed after the Blender geometry render.")
    vector_data = json.loads(Path(metadata["vectorDataPath"]).read_text(encoding="utf-8-sig"))
    if vector_data["sourceSha256"] != metadata["artworkSha256"]:
        raise RuntimeError("The contour cache does not match the rendered artwork.")
    artwork_rgba = cv2.imread(str(artwork_path), cv2.IMREAD_UNCHANGED)
    if artwork_rgba is None or artwork_rgba.ndim != 3 or artwork_rgba.shape[2] != 4:
        raise RuntimeError("Artwork must be a decoded RGBA raster after browser sanitization.")
    contour = union_all([Polygon(poly["exterior"], poly["holes"])
                         for poly in vector_data["polygons"]])
    grid_y, grid_x = np.mgrid[0:artwork_rgba.shape[0], 0:artwork_rgba.shape[1]]
    source_mask = contains_xy(contour, grid_x + 0.5, grid_y + 0.5).astype(np.float32)
    bx0, by0, bx1, by1 = map(float, vector_data["visibleBoundsPx"])
    source_corners = np.asarray([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], np.float32)
    source_to_plate = cv2.getPerspectiveTransform(source_corners, art_quad.astype(np.float32))
    coverage = cv2.warpPerspective(source_mask, source_to_plate, (width, height),
                                   flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                   borderValue=0.0)

    base_linear = srgb_to_linear(base.astype(np.float32) / 255.0)
    with_linear = srgb_to_linear(with_art.astype(np.float32) / 255.0)
    delta = with_linear - base_linear
    mapped_delta = cv2.warpPerspective(delta, render_to_plate, (width, height),
                                       flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                       borderValue=(0, 0, 0))
    mask = (coverage >= 0.5).astype(np.uint8)
    eroded = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    edge_band = cv2.GaussianBlur((mask - eroded).astype(np.float32), (0, 0), 0.38)
    shifted = np.zeros_like(mask)
    shifted[:-1, :-1] = mask[1:, 1:]
    lit_edge = cv2.GaussianBlur(np.clip(mask.astype(np.float32) - shifted.astype(np.float32), 0, 1),
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
    result = master_linear * (1.0 - coverage[..., None]) + mapped_color * coverage[..., None]
    edge_light = np.clip(mapped_delta, 0.0, 0.10) * edge_band[..., None] * 0.20
    edge_light += lit_edge[..., None] * 0.040
    result += edge_light
    shifted_shadow = np.zeros_like(coverage)
    shifted_shadow[3:, 3:] = coverage[:-3, :-3]
    contact = cv2.GaussianBlur(np.clip(shifted_shadow - coverage, 0, 1), (0, 0), 0.8)
    result *= 1.0 - contact[..., None] * 0.32

    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = np.round(linear_to_srgb(result) * 255.0).astype(np.uint8)
    if not cv2.imwrite(str(args.output), encoded, [cv2.IMWRITE_JPEG_QUALITY, 95]):
        raise RuntimeError("Could not write the On-Hat Rear View output.")
    print(json.dumps({"ok": True, "scene": "on-hat-rear", "path": str(args.output),
                      "sha256": sha256(args.output), "masterSha256": reference["masterImageSha256"],
                      "width": width, "height": height,
                      "artworkGeometrySha256": metadata["artworkGeometrySha256"],
                      "artworkReliefMm": metadata["artworkReliefMm"]}))


if __name__ == "__main__":
    main()

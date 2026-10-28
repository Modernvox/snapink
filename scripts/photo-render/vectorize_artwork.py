"""Convert artwork alpha into validated vector polygons for the Blender render worker.

Runs with the owner's Python 3.12 + Pillow + Shapely. It reads only the input
image and writes private intermediate JSON; no CAD or production data is touched.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import constrained_delaunay_triangles, contains_xy, unary_union
from shapely.affinity import translate
from shapely.geometry import Polygon, box


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def alpha_geometry(alpha: np.ndarray, threshold: int):
    mask = alpha >= threshold
    ys, xs = np.nonzero(mask)
    if not len(xs):
        raise ValueError("Artwork alpha is empty at the configured 50% contour threshold.")
    bounds = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    x0, y0, x1, y1 = bounds
    mask = mask[y0:y1, x0:x1]

    # Merge horizontal pixel runs vertically before polygon union. This follows
    # source alpha contours exactly while avoiding one polygon per pixel.
    active: dict[tuple[int, int], int] = {}
    rectangles = []
    for row_index, row in enumerate(mask):
        padded = np.pad(row.astype(np.int8), (1, 1))
        changes = np.diff(padded)
        starts = np.flatnonzero(changes == 1)
        ends = np.flatnonzero(changes == -1)
        runs = {(int(a), int(b)) for a, b in zip(starts, ends)}
        for run, start_row in list(active.items()):
            if run not in runs:
                rectangles.append(box(run[0], start_row, run[1], row_index))
                del active[run]
        for run in runs:
            active.setdefault(run, row_index)
    for run, start_row in active.items():
        rectangles.append(box(run[0], start_row, run[1], mask.shape[0]))

    geom = translate(unary_union(rectangles), xoff=x0, yoff=y0)
    if geom.is_empty or not geom.is_valid:
        raise ValueError("Extracted artwork contours are empty or self-intersecting.")
    # Sub-pixel simplification removes redundant collinear raster vertices while
    # preserving topology; it is below one tenth of a source pixel.
    geom = geom.simplify(0.08, preserve_topology=True)
    if geom.is_empty or not geom.is_valid:
        raise ValueError("Simplified artwork contours failed topology validation.")
    source_polygons = [p for p in (list(geom.geoms) if hasattr(geom, "geoms") else [geom])
                       if isinstance(p, Polygon) and p.area > 0]
    # At the approved branding scale, a lone source pixel is far below any
    # printable TPU feature size. Background removal can leave isolated alpha
    # specks; they can collapse into neighboring extrusions and corrupt shell
    # validation. Exclude only singleton-pixel islands and report the count.
    noise_components = [p for p in source_polygons if p.area <= 1.0]
    polygons = [p for p in source_polygons if p.area > 1.0]
    if not polygons:
        raise ValueError("Artwork extraction produced no filled polygons after subpixel-noise filtering.")
    filtered_geom = unary_union(polygons)
    sample_x, sample_y = np.meshgrid(np.arange(mask.shape[1]) + x0 + 0.5, np.arange(mask.shape[0]) + y0 + 0.5)
    contour_mask = contains_xy(filtered_geom, sample_x, sample_y)
    contour_intersection = int(np.logical_and(mask, contour_mask).sum())
    contour_union = int(np.logical_or(mask, contour_mask).sum())
    contour_iou = contour_intersection / contour_union if contour_union else 1.0
    return mask, bounds, polygons, contour_iou, len(noise_components)


def ring_coords(ring):
    pts = [(float(x), float(y)) for x, y in list(ring.coords)[:-1]]
    if len(pts) < 3:
        raise ValueError("Contour has fewer than 3 unique vertices.")
    return pts


def export(path: Path, output: Path, threshold: int = 128):
    if path.stat().st_size > 40 * 1024 * 1024:
        raise ValueError("Artwork exceeds the 40 MiB local rendering limit.")
    im = Image.open(path).convert("RGBA")
    alpha = np.asarray(im)[:, :, 3]
    mask, bounds, polygons, contour_iou, removed_noise_count = alpha_geometry(alpha, threshold)
    x0, y0, x1, y1 = bounds
    result_polys = []
    for poly in polygons:
        if not poly.is_valid:
            raise ValueError("A polygon is self-intersecting.")
        triangles_geom = constrained_delaunay_triangles(poly)
        triangles = []
        for tri in triangles_geom.geoms:
            if tri.geom_type != "Polygon" or not poly.covers(tri):
                raise ValueError("Constrained triangulation crossed a contour or hole.")
            coords = ring_coords(tri.exterior)
            if len(coords) != 3:
                raise ValueError("Triangulator returned a non-triangular face.")
            triangles.append(coords)
        tri_area = sum(Polygon(t).area for t in triangles)
        if not math.isclose(tri_area, poly.area, rel_tol=1e-8, abs_tol=1e-7):
            raise ValueError("Triangulated top does not exactly cover its letter contour and counters.")
        result_polys.append({
            "exterior": ring_coords(poly.exterior),
            "holes": [ring_coords(r) for r in poly.interiors],
            "triangles": triangles,
            "areaPx2": poly.area,
        })
    result = {
        "schemaVersion": 4,
        "sourceSha256": file_sha(path),
        "sourceWidth": im.width,
        "sourceHeight": im.height,
        "alphaThreshold": threshold,
        "visibleBoundsPx": list(bounds),
        "silhouetteAreaPx2": sum(p.area for p in polygons),
        "componentCount": len(polygons),
        "removedSubpixelNoiseComponents": removed_noise_count,
        "holeCount": sum(len(p.interiors) for p in polygons),
        "simplifyTolerancePx": 0.08,
        "contourMaskIoU": contour_iou,
        "polygons": result_polys,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artwork", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = export(args.artwork, args.output)
    print(json.dumps({k: result[k] for k in ("sourceSha256", "visibleBoundsPx", "silhouetteAreaPx2", "componentCount", "holeCount", "simplifyTolerancePx", "contourMaskIoU")}))


if __name__ == "__main__":
    main()

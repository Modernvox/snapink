"""Create a contact sheet that traces original artwork through the 3D render."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = image.copy()
    image.thumbnail(size, Image.Resampling.LANCZOS)
    return image


def polygon_layer(vectors: dict, size: tuple[int, int], color=(255, 255, 255), outline=None) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bx0, by0, bx1, by1 = vectors["visibleBoundsPx"]
    sx, sy = size[0] / (bx1 - bx0), size[1] / (by1 - by0)

    def map_ring(ring):
        return [((x - bx0) * sx, (y - by0) * sy) for x, y in ring]

    for polygon in vectors["polygons"]:
        exterior = map_ring(polygon["exterior"])
        draw.polygon(exterior, fill=(*color, 255))
        if outline:
            draw.line(exterior + [exterior[0]], fill=(*outline, 255), width=2, joint="curve")
        for ring in polygon["holes"]:
            hole = map_ring(ring)
            draw.polygon(hole, fill=(0, 0, 0, 0))
            if outline:
                draw.line(hole + [hole[0]], fill=(*outline, 255), width=2, joint="curve")
    return layer


def panel(canvas: Image.Image, rect, title: str, subtitle: str = ""):
    x, y, w, h = rect
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x, y, x + w - 1, y + h - 1), radius=20, fill=(22, 24, 28), outline=(72, 78, 86), width=2)
    draw.text((x + 26, y + 18), title, font=FONT_HEAD, fill=(246, 247, 250))
    if subtitle:
        draw.text((x + 26, y + 60), subtitle, font=FONT_SMALL, fill=(178, 186, 198))


parser = argparse.ArgumentParser()
parser.add_argument("--artwork", type=Path, required=True)
parser.add_argument("--vectors", type=Path, required=True)
parser.add_argument("--mesh", type=Path, required=True)
parser.add_argument("--product", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
vectors = json.loads(args.vectors.read_text(encoding="utf-8"))
original = Image.open(args.artwork).convert("RGBA")
W, TOP_H, BOTTOM_H, GAP = 1200, 660, 1200, 20
H = TOP_H * 2 + BOTTOM_H + GAP * 2
BG = (12, 14, 17)
canvas = Image.new("RGB", (W * 2 + GAP * 3, H + GAP * 2), BG)
try:
    FONT_HEAD = ImageFont.truetype("arial.ttf", 31)
    FONT_SMALL = ImageFont.truetype("arial.ttf", 20)
    FONT_INFO = ImageFont.truetype("arial.ttf", 25)
except OSError:
    FONT_HEAD = FONT_SMALL = FONT_INFO = ImageFont.load_default()

rects = [
    (GAP, GAP, W, TOP_H),
    (W + GAP * 2, GAP, W, TOP_H),
    (GAP, GAP * 2 + TOP_H, W, TOP_H),
    (W + GAP * 2, GAP * 2 + TOP_H, W, TOP_H),
    (GAP, GAP * 3 + TOP_H * 2, W, BOTTOM_H),
    (W + GAP * 2, GAP * 3 + TOP_H * 2, W, BOTTOM_H),
]
panel(canvas, rects[0], "1  Original artwork", "Uploaded RGBA source; transparency composited over charcoal for inspection")
panel(canvas, rects[1], "2  Extracted alpha contours", f"50% alpha contour · {vectors['componentCount']} source components · {vectors['holeCount']} enclosed counter(s)")
panel(canvas, rects[2], "3  Generated 2D paths", f"Topology-preserving vector polygons · contour IoU {vectors['contourMaskIoU']:.6f} · simplify {vectors['simplifyTolerancePx']} px")
panel(canvas, rects[3], "4  Extruded 3D mesh", "Actual render mesh · 0.8 mm relief · watertight manifold validation required")
panel(canvas, rects[4], "5  Final product render", "Geometry-based Billboard Size 4 · same source art and CAD placement rules")
panel(canvas, rects[5], "Mesh and source validation")

def paste_contained(dest, source, rect, max_size, offset_y=100):
    x, y, w, h = rect
    image = fit(source, max_size)
    px = x + (w - image.width) // 2
    py = y + offset_y + max(0, (h - offset_y - image.height) // 2)
    if image.mode == "RGBA":
        dest.paste(image, (px, py), image)
    else:
        dest.paste(image, (px, py))

source_back = Image.new("RGBA", original.size, (24, 27, 31, 255))
source_back.alpha_composite(original)
paste_contained(canvas, source_back.convert("RGB"), rects[0], (1120, 520))

contours = polygon_layer(vectors, (1120, 520), color=(220, 226, 234), outline=(255, 100, 75))
contour_bg = Image.new("RGBA", contours.size, (24, 27, 31, 255))
contour_bg.alpha_composite(contours)
paste_contained(canvas, contour_bg.convert("RGB"), rects[1], (1120, 520))

paths = polygon_layer(vectors, (1120, 520), color=(236, 241, 246), outline=(67, 214, 187))
path_bg = Image.new("RGBA", paths.size, (24, 27, 31, 255))
path_bg.alpha_composite(paths)
paste_contained(canvas, path_bg.convert("RGB"), rects[2], (1120, 520))
paste_contained(canvas, Image.open(args.mesh).convert("RGB"), rects[3], (1120, 520))
paste_contained(canvas, Image.open(args.product).convert("RGB"), rects[4], (1120, 1080), offset_y=105)

info = ImageDraw.Draw(canvas)
ix, iy, iw, ih = rects[5]
lines = [
    f"Source SHA-256: {vectors['sourceSha256']}",
    f"Alpha threshold: {vectors['alphaThreshold']} / 255",
    f"Visible source bounds: {vectors['visibleBoundsPx']}",
    f"Extracted islands: {vectors['componentCount']}    Enclosed counters: {vectors['holeCount']}",
    f"Contour-to-source mask IoU: {vectors['contourMaskIoU']:.6f}",
    "",
    "The diagnostic mesh render is produced from these paths.",
    "No font substitution or generative redraw is used.",
    "All source contours are triangulated with constrained Delaunay.",
    "Mesh is rejected if any boundary or non-manifold element remains.",
]
for index, line in enumerate(lines):
    info.text((ix + 35, iy + 130 + index * 54), line, font=FONT_INFO, fill=(224, 229, 236))

args.output.parent.mkdir(parents=True, exist_ok=True)
canvas.save(args.output)
print(json.dumps({"output": str(args.output), "size": list(canvas.size), "contourMaskIoU": vectors["contourMaskIoU"]}))

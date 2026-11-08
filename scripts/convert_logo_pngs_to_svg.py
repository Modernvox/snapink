#!/usr/bin/env python3
"""Trace transparent PNG logos into single-color, closed-path SVG artwork."""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image

try:
    import vtracer
except ImportError as exc:  # pragma: no cover - exercised by command line use
    raise SystemExit(
        "VTracer is required. Install dependencies with: "
        "python -m pip install -r scripts/requirements-logo-svg.txt"
    ) from exc


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPOSITORY_ROOT / "public" / "images" / "logos"
DEFAULT_OUTPUT = DEFAULT_INPUT / "svg"
SVG_NAMESPACE = "{http://www.w3.org/2000/svg}"


def trace_logo(source: Path, destination: Path, alpha_threshold: int, speckle: int) -> None:
    """Use source alpha as a binary mask and trace it to a filled path SVG."""
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        width, height = rgba.size
        alpha = rgba.getchannel("A")

        if alpha.getextrema() == (255, 255):
            raise ValueError("the PNG is fully opaque; transparency cannot isolate the logo")

        # Use only alpha to form a clean, single-color silhouette. A white opaque
        # canvas keeps it out of the traced shape; VTracer then emits black artwork.
        mask = alpha.point(lambda value: 255 if value >= alpha_threshold else 0)
        if mask.getbbox() is None:
            raise ValueError("no foreground remains at the selected alpha threshold")
        traced_image = Image.new("RGB", (width, height), "white")
        traced_image.paste("black", mask=mask)

    with tempfile.TemporaryDirectory(prefix="snapink-logo-trace-") as temp_dir:
        trace_input = Path(temp_dir) / "alpha-mask.png"
        trace_output = Path(temp_dir) / destination.name
        traced_image.save(trace_input, format="PNG", optimize=True)
        vtracer.convert_image_to_svg_py(
            str(trace_input),
            str(trace_output),
            colormode="binary",
            hierarchical="cutout",
            mode="spline",
            filter_speckle=speckle,
            corner_threshold=60,
            length_threshold=4.0,
            max_iterations=10,
            splice_threshold=45,
            path_precision=3,
        )
        validate_svg(trace_output, width, height)
        os.replace(trace_output, destination)


def validate_svg(path: Path, expected_width: int, expected_height: int) -> None:
    """Reject blank, raster-embedded, open-path, or malformed tracer output."""
    try:
        root = ElementTree.parse(path).getroot()
    except (ElementTree.ParseError, OSError) as exc:
        raise ValueError(f"VTracer produced invalid SVG: {exc}") from exc

    if root.tag != f"{SVG_NAMESPACE}svg":
        raise ValueError("output root is not an SVG element")
    if root.attrib.get("width") != str(expected_width) or root.attrib.get("height") != str(expected_height):
        raise ValueError("output dimensions do not match the source PNG")
    if root.findall(f".//{SVG_NAMESPACE}image"):
        raise ValueError("output contains a raster image instead of vector paths")

    paths = root.findall(f".//{SVG_NAMESPACE}path")
    if not paths:
        raise ValueError("no vector paths were generated")
    for vector_path in paths:
        data = vector_path.attrib.get("d", "").strip()
        if not data or not re.search(r"[zZ]\s*$", data):
            raise ValueError("one or more vector paths are not closed")
        if vector_path.attrib.get("fill", "").lower() != "#000000":
            raise ValueError("the output is not a single-color, filled vector")


def convert_directory(
    input_dir: Path,
    output_dir: Path,
    alpha_threshold: int = 128,
    speckle: int = 4,
) -> tuple[int, list[tuple[str, str]]]:
    if not input_dir.is_dir():
        raise SystemExit(f"Input directory does not exist: {input_dir}")
    sources = sorted(
        (entry for entry in input_dir.iterdir() if entry.is_file() and entry.suffix.lower() == ".png"),
        key=lambda entry: entry.name.casefold(),
    )
    if not sources:
        raise SystemExit(f"No PNG logos found in: {input_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    converted = 0
    failures: list[tuple[str, str]] = []
    for source in sources:
        destination = output_dir / f"{source.stem}.svg"
        try:
            trace_logo(source, destination, alpha_threshold, speckle)
            converted += 1
            print(f"OK  {source.name} -> {destination.name}")
        except Exception as exc:  # report per-file errors and continue the batch
            failures.append((source.name, str(exc)))
            print(f"WARN  {source.name}: {exc}", file=sys.stderr)

    print(f"\nConverted {converted}/{len(sources)} PNG logos into {output_dir}")
    if failures:
        print("Logos requiring review:", file=sys.stderr)
        for filename, reason in failures:
            print(f"- {filename}: {reason}", file=sys.stderr)
    return converted, failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Directory containing source PNG logos")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Directory for generated SVG files")
    parser.add_argument("--alpha-threshold", type=int, default=128, choices=range(1, 256), metavar="1..255", help="Alpha cutoff for artwork (default: 128)")
    parser.add_argument("--speckle", type=int, default=4, choices=range(0, 257), metavar="0..256", help="VTracer's minimum speckle filter in pixels (default: 4)")
    args = parser.parse_args()

    _, failures = convert_directory(args.input, args.output, args.alpha_threshold, args.speckle)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

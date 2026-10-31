"""Small deterministic integrity test for the locked-master compositor."""
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("on_hat_compositor", Path(__file__).with_name("composite_on_hat_rear.py"))
compositor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compositor)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    reference = json.loads((ROOT / "scripts/photo-render/on-hat-rear-reference.json").read_text())
    master_path = ROOT / reference["masterImage"]
    assert digest(master_path) == reference["masterImageSha256"]
    with tempfile.TemporaryDirectory(prefix="snapink-master-composite-") as temp:
        root = Path(temp)
        artwork_path, vector_path = root / "artwork.png", root / "vectors.json"
        art = Image.new("RGBA", (120, 120), (255, 255, 255, 0))
        draw = ImageDraw.Draw(art)
        draw.rounded_rectangle((28, 40, 92, 80), radius=12, fill=(255, 255, 255, 255))
        art.save(artwork_path)
        vector_data = {
            "sourceSha256": digest(artwork_path), "sourceWidth": 120, "sourceHeight": 120,
            "visibleBoundsPx": [28, 40, 92, 80],
            "polygons": [{"exterior": [[28, 40], [92, 40], [92, 80], [28, 80]], "holes": []}],
        }
        vector_path.write_text(json.dumps(vector_data))
        pass_dir = root / "passes"
        pass_dir.mkdir()
        base = np.full((240, 240, 3), 28, dtype=np.uint8)
        with_art = base.copy()
        cv2.rectangle(with_art, (72, 88), (168, 152), (220, 220, 220), -1)
        cv2.imwrite(str(pass_dir / "without-art.png"), base)
        cv2.imwrite(str(pass_dir / "with-art.png"), with_art)

        cad = {
            "variant": "billboard", "size": 4, "geometryVersion": "blank-flap-candidate-v1",
            "positioningVersion": "cad-flap-valley-to-right-edge-v1", "grooveXmm": -3.2,
            "grooveWidthMm": 0.8, "rightEdgeXmm": 106.28, "edgeClearanceMm": 1.0,
            "surfaceProfile": {"bodyWidthMm": 24.31, "billboardBowMm": 1.5, "bowReferenceLengthMm": 88.9},
        }
        settings = {"scene": "on-hat-rear", "variant": "billboard", "size": 4, "artColor": "#ffffff", "cadBrandingReference": cad}
        job_path = root / "job.json"
        job_path.write_text(json.dumps({"settings": settings}))
        frame_physical = [[36.54, 8.0], [66.54, 8.0], [66.54, -8.0], [36.54, -8.0]]
        metadata = {
            "scene": "on-hat-rear", "masterImageId": reference["masterImageId"],
            "masterImageSha256": reference["masterImageSha256"], "calibrationVersion": reference["calibrationVersion"],
            "cadSha256": "test-cad-sha256", "catalogCadSha256": "test-cad-sha256", "artworkReliefMm": 0.8,
            "artworkPath": str(artwork_path), "artworkSha256": digest(artwork_path), "vectorDataPath": str(vector_path),
            "artworkPlacementMm": {"centerX": 51.54, "centerY": 0.0, "width": 20.0, "height": 10.0},
            "renderResolutionPx": [240, 240], "framePhysicalMm": frame_physical,
            "frameProjectedCornersPx": [[0, 0], [240, 0], [240, 240], [0, 240]],
        }
        metadata_path = root / "render.json"
        metadata_path.write_text(json.dumps(metadata))
        output = root / "mockup.png"
        result = compositor.composite(reference, SimpleNamespace(output=output, metadata=metadata_path, job=job_path, passes_dir=pass_dir))
        original = cv2.imread(str(master_path), cv2.IMREAD_COLOR)
        final = cv2.imread(str(output), cv2.IMREAD_COLOR)
        assert result["width"] == 1536 and result["height"] == 1024
        assert result["outsideMaskUnchanged"] is True and result["changedPixels"] > 0
        allowed = np.zeros(final.shape[:2], dtype=np.uint8)
        cv2.fillPoly(allowed, [np.round(np.array(reference["printableMainBodyPolygonPx"])).astype(np.int32)], 1)
        dilated = cv2.dilate((allowed > 0).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))) > 0
        assert np.array_equal(final[~dilated], original[~dilated])
        with Image.open(output) as png:
            generation = json.loads(png.info["SnapInk Generation"])
            assert generation["masterImageId"] == reference["masterImageId"]
            assert generation["outsideMaskUnchanged"] is True
        print(json.dumps({"ok": True, "masterSha256": digest(master_path), "output": "1536x1024 PNG", "changedPixels": result["changedPixels"], "outsideMaskUnchanged": True}))


if __name__ == "__main__":
    main()

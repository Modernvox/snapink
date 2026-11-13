import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../functions/_lib/artwork-limits.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { MAX_ARTWORK_EXTENSION_PER_EDGE_MM, MAX_EXTENDED_ARTWORK_HEIGHT_MM, artworkHeightExceedsMaximum, maximumArtworkHeightScalePercent, artworkWidthExceedsHorizontalBounds, artworkProductionReviewReason } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));

test("height slider exposes unrestricted values while preserving internal production review", () => {
  assert.equal(MAX_ARTWORK_EXTENSION_PER_EDGE_MM, 12.7);
  assert.equal(MAX_EXTENDED_ARTWORK_HEIGHT_MM, 38.1);
  assert.equal(artworkHeightExceedsMaximum(38.101), false);
  assert.equal(artworkHeightExceedsMaximum(38.1011), true);
  assert.equal(maximumArtworkHeightScalePercent(10), 10000);
  assert.equal(maximumArtworkHeightScalePercent(20), 10000);
  assert.equal(maximumArtworkHeightScalePercent(5, 450), 10000);
  assert.equal(maximumArtworkHeightScalePercent(0.01), 10000);
  assert.equal(maximumArtworkHeightScalePercent(0), 10000);
  for (const height of [38.1, 45, 51.06, 60]) {
    assert.equal(artworkHeightExceedsMaximum(height), height > 38.1);
  }
});

test("horizontal overflow is retained for manufacturing review across sleeve sizes", () => {
  const rightEdges = [71.52, 80.21, 88.9, 97.59, 106.28, 114.97];
  const leftEdge = -2.8;
  for (let size = 0; size <= 5; size += 1) {
    const rightEdge = rightEdges[size];
    const width = rightEdge - leftEdge;
    const center = (rightEdge + leftEdge) / 2;
    assert.equal(artworkWidthExceedsHorizontalBounds(width, center, size), false);
    assert.equal(artworkWidthExceedsHorizontalBounds(width + 1, center, size), true);
    assert.equal(artworkProductionReviewReason(width, 20, center, size), undefined);
    assert.equal(artworkProductionReviewReason(width + 1, 20, center, size), "horizontal_artwork_bounds_exceeded");
  }
  assert.equal(artworkProductionReviewReason(20, 42.16, 40, 2), "total_height_exceeds_38_1_mm");
  assert.equal(artworkProductionReviewReason(20, 20, 40, 2, 12.701), "artwork_extension_exceeds_12_7_mm");
});

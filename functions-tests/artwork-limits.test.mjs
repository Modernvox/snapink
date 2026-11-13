import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../functions/_lib/artwork-limits.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { MAX_ARTWORK_EXTENSION_PER_EDGE_MM, MAX_EXTENDED_ARTWORK_HEIGHT_MM, artworkHeightExceedsMaximum, maximumArtworkHeightScalePercent } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));

test("height slider maximum follows the 38.1 mm physical height without changing defaults or width", () => {
  assert.equal(MAX_ARTWORK_EXTENSION_PER_EDGE_MM, 12.7);
  assert.equal(MAX_EXTENDED_ARTWORK_HEIGHT_MM, 38.1);
  assert.equal(artworkHeightExceedsMaximum(38.101), false);
  assert.equal(artworkHeightExceedsMaximum(38.1011), true);
  assert.equal(maximumArtworkHeightScalePercent(10), 381);
  assert.equal(maximumArtworkHeightScalePercent(20), 200);
  assert.equal(maximumArtworkHeightScalePercent(5, 450), 762);
  assert.equal(maximumArtworkHeightScalePercent(0.01), 381000);
  assert.equal(maximumArtworkHeightScalePercent(0), 200);
});

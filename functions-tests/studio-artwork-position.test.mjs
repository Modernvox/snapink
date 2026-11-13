import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../src/config/sleeveGeometry.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const geometry = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));

test("horizontal movement preserves selected logo width and height for every sleeve size", () => {
  for (const variant of ["standard", "billboard"]) {
    for (let size = 0; size <= 5; size += 1) {
      const baseRange = geometry.usableBrandingCanvasRangePercentFor(variant, size);
      const leftCenter = geometry.studioArtworkPositionFor(variant, size, baseRange.start, 50).centerXmm;
      const rightCenter = geometry.studioArtworkPositionFor(variant, size, baseRange.end, 50).centerXmm;
      const centerPercent = (baseRange.start + baseRange.end) / 2;
      const centered = geometry.studioArtworkPositionFor(variant, size, centerPercent, 50).centerXmm;
      const fit = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, 1.8, 100, 100);
      const movementRange = geometry.artworkHorizontalPositionRangePercentFor(variant, size, fit.widthMm, centerPercent);
      const positions = [movementRange.start, (movementRange.start + movementRange.end) / 2, movementRange.end];
      const placements = positions.map((x) => geometry.studioLogoPlacementMmFor(variant, size, x, 1.8, 100, 100));

      assert.ok(leftCenter < rightCenter, `${variant} size ${size} position range moves in X`);
      assert.ok(movementRange.start <= movementRange.end, `${variant} size ${size} has an ordered valid range`);
      assert.ok(placements[0].centerXmm < placements[2].centerXmm, `${variant} size ${size} reaches both boundaries`);
      for (const placement of placements) {
        assert.equal(placement.widthMm, fit.widthMm, `${variant} size ${size} width stays fixed`);
        assert.equal(placement.heightMm, fit.heightMm, `${variant} size ${size} height stays fixed`);
      }

      const taller = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, 1.8, 100, 175);
      assert.equal(taller.widthMm, fit.widthMm, `${variant} size ${size} height control leaves width alone`);
      assert.equal(taller.heightMm, fit.heightMm * 1.75, `${variant} size ${size} height control acts vertically`);

      const tooWide = geometry.artworkHorizontalPositionRangePercentFor(variant, size, fit.widthMm * 10, centerPercent);
      assert.deepEqual(tooWide, { start: centerPercent, end: centerPercent }, `${variant} size ${size} freezes movement when width cannot fit`);
    }
  }
});

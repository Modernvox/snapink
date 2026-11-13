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
      assert.ok(tooWide.start < tooWide.end, `${variant} size ${size} keeps full movement for oversized artwork`);
    }
  }
});

test("Nike PNG supports unrestricted physical heights while position stays independent", () => {
  // Native alpha bbox measured from nike_white.png: canvas 1774×887, visible 1663×759.
  const visibleAspectRatio = 1663 / 759;
  for (const variant of ["standard", "billboard"]) {
    for (let size = 0; size <= 5; size += 1) {
      const range = geometry.usableBrandingCanvasRangePercentFor(variant, size);
      const centerPercent = (range.start + range.end) / 2;
      const defaultPlacement = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, visibleAspectRatio, 75, 100);
      assert.ok(Math.abs(defaultPlacement.heightMm - 16.725) < 0.01, `${variant} size ${size} uses the visible PNG height`);
      const centerY = geometry.artworkCenterYForPositionMm(variant, size, 50, defaultPlacement.heightMm, 1, 12.7, 12.7);
      for (const targetHeightMm of [38.1, 45, 51.06, 60]) {
        const scale = targetHeightMm / defaultPlacement.baseHeightMm * 100;
        const sized = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, visibleAspectRatio, 75, scale);
        const moved = geometry.studioLogoPlacementMmFor(variant, size, range.end, visibleAspectRatio, 75, scale);
        assert.ok(Math.abs(sized.heightMm - targetHeightMm) < 1e-8);
        assert.equal(moved.heightMm, sized.heightMm, "horizontal position does not alter height");
        assert.equal(geometry.artworkCenterYForPositionMm(variant, size, 50, sized.heightMm, 1, 12.7, 12.7), centerY, "height does not recenter artwork");
      }
    }
  }
});

test("visible ITGIRL PNG bounds retain independent artwork scaling while oversized height is reviewable", () => {
  // Native alpha bbox measured from Itgirl_logo.png: canvas 2172×724, visible 2168×708.
  const visibleAspectRatio = 2168 / 708;
  for (const variant of ["standard", "billboard"]) {
    for (let size = 0; size <= 5; size += 1) {
      const range = geometry.usableBrandingCanvasRangePercentFor(variant, size);
      const centerPercent = (range.start + range.end) / 2;
      const base = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, visibleAspectRatio, 75, 100);
      const stretched = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, visibleAspectRatio, 75, 250);
      const shifted = geometry.studioLogoPlacementMmFor(variant, size, range.end, visibleAspectRatio, 75, 250);

      assert.ok(Math.abs(base.heightMm - (base.baseHeightMm)) < 1e-9, `${variant} size ${size} preserves the uploaded artwork's visible height`);
      assert.equal(stretched.widthMm, base.widthMm, `${variant} size ${size} vertical scaling leaves width unchanged`);
      assert.equal(stretched.heightMm, base.heightMm * 2.5, `${variant} size ${size} stretches height independently`);
      assert.equal(shifted.widthMm, stretched.widthMm, `${variant} size ${size} horizontal movement preserves width`);
      assert.equal(shifted.heightMm, stretched.heightMm, `${variant} size ${size} horizontal movement preserves height`);
      assert.equal(geometry.artworkHeightExceedsMaximum(stretched.heightMm), true, `${variant} size ${size} marks over-limit production height for review`);
    }
  }
});

test("Artwork Width stretches only X, stays anchored, and horizontal movement changes only its center", () => {
  const visibleAspectRatios = [1663 / 759, 2168 / 708]; // nike_white.png and Itgirl_logo.png visible alpha bounds.
  for (const variant of ["standard", "billboard"]) {
    for (let size = 0; size <= 5; size += 1) {
      const range = geometry.usableBrandingCanvasRangePercentFor(variant, size);
      const centerPercent = (range.start + range.end) / 2;
      for (const aspectRatio of visibleAspectRatios) {
        const original = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, aspectRatio, 75, 130, 100);
        const compressed = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, aspectRatio, 75, 130, 35);
        const enlarged = geometry.studioLogoPlacementMmFor(variant, size, centerPercent, aspectRatio, 75, 130, 300);
        const moved = geometry.studioLogoPlacementMmFor(variant, size, range.end, aspectRatio, 75, 130, 300);

        assert.equal(compressed.heightMm, original.heightMm, `${variant} size ${size} width compression leaves height unchanged`);
        assert.equal(enlarged.heightMm, original.heightMm, `${variant} size ${size} width enlargement leaves height unchanged`);
        assert.equal(compressed.widthMm, original.widthMm * 0.35, `${variant} size ${size} compression applies only on X`);
        assert.equal(enlarged.widthMm, original.widthMm * 3, `${variant} size ${size} enlargement applies only on X`);
        assert.equal(enlarged.centerXmm, original.centerXmm, `${variant} size ${size} width change keeps the center fixed`);
        assert.equal(moved.widthMm, enlarged.widthMm, `${variant} size ${size} horizontal movement preserves width`);
        assert.equal(moved.heightMm, enlarged.heightMm, `${variant} size ${size} horizontal movement preserves height`);
        assert.notEqual(moved.centerXmm, enlarged.centerXmm, `${variant} size ${size} horizontal movement changes the center`);
      }
    }
  }
});

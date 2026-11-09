import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function loadModule(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

test("Snapback 360 hat masters share the black master calibration and source-preserving sleeve mask", async () => {
  const registry = await loadModule("../src/config/snapback360MasterRegistry.ts");
  const { SNAPBACK360_MASTER, SNAPBACK360_MASTERS, SNAPBACK360_CALIBRATION_MASTER_ID, SNAPBACK360_LOGO_LIBRARY } = registry;
  const customizerImage = await loadModule("../src/utils/snapback360ProductImage.ts");
  assert.equal(customizerImage.snapback360EffectiveRearScale(0), 1.45, "new rear artwork starts at the former 145% size");
  assert.equal(customizerImage.snapback360EffectiveRearScale(10), 1.595, "+10% is relative to the 145% baseline");
  assert.equal(customizerImage.snapback360EffectiveRearScale(-10), 1.305, "-10% is relative to the 145% baseline");
  assert.equal(customizerImage.snapback360RearAdjustmentPercent(1.45), 0, "saved legacy 145% scale displays as 0% adjustment");
  assert.ok(Math.abs(customizerImage.snapback360RearAdjustmentPercent(1) - (-31.0344827586)) < 1e-8,
    "legacy saved scale values convert to the corresponding relative adjustment");
  assert.equal(SNAPBACK360_MASTER.id, "snapback360-black-trucker");
  assert.equal(SNAPBACK360_MASTER.name, "Snapback 360 — Black Trucker");
  assert.equal(SNAPBACK360_MASTER.type, "combined-front-rear-product-image");
  assert.equal(SNAPBACK360_CALIBRATION_MASTER_ID, SNAPBACK360_MASTER.id);
  assert.notEqual(SNAPBACK360_MASTER.regions.front.calibration.version, SNAPBACK360_MASTER.regions.rear.calibration.version);
  assert.notDeepEqual(SNAPBACK360_MASTER.regions.front.calibration.quadPx, SNAPBACK360_MASTER.regions.rear.calibration.quadPx);
  assert.equal(SNAPBACK360_MASTER.regions.front.calibration.locked, false);
  assert.equal(SNAPBACK360_MASTER.regions.rear.calibration.locked, false);
  assert.ok(SNAPBACK360_LOGO_LIBRARY.some(({ file }) => file === "svg/apex_logo.svg"));
  assert.ok(SNAPBACK360_LOGO_LIBRARY.some(({ file }) => file === "svg/New_York_logo.svg"));
  assert.ok(SNAPBACK360_LOGO_LIBRARY.some(({ file }) => file === "apex_logo.png"));
  assert.ok(SNAPBACK360_LOGO_LIBRARY.find(({ file }) => file === "svg/apex_logo.svg"));
  assert.ok(SNAPBACK360_LOGO_LIBRARY.find(({ file }) => file === "svg/New_York_logo.svg"));
  assert.equal(SNAPBACK360_MASTERS.length, 4, "the hat catalog has exactly four approved masters");
  const sleeveColors = await loadModule("../src/config/manufacturedSleeveColors.ts");
  assert.deepEqual(sleeveColors.MANUFACTURED_SLEEVE_COLORS.map(({ label }) => label), ["Black", "White", "Red", "Yellow"]);
  assert.equal(SNAPBACK360_MASTERS.length * sleeveColors.MANUFACTURED_SLEEVE_COLORS.length, 16, "four hats and four manufactured sleeve colors yield 16 combinations");
  for (const master of SNAPBACK360_MASTERS) {
    const masterBytes = fs.readFileSync(new URL(`../public${master.image}`, import.meta.url));
    assert.deepEqual([masterBytes.readUInt32BE(16), masterBytes.readUInt32BE(20)], [1254, 1254], `${master.hatColor} master resolution is preserved`);
    assert.equal(createHash("sha256").update(masterBytes).digest("hex"), master.imageSha256, `${master.hatColor} master matches its registered source hash`);
    assert.equal(master.calibrationGeometryVersion, SNAPBACK360_MASTER.calibrationGeometryVersion, `${master.hatColor} master uses the shared geometry version`);
    assert.strictEqual(master.sleeveMask, SNAPBACK360_MASTER.sleeveMask, `${master.hatColor} master reuses the exact shared sleeve mask`);
    if (master.id === SNAPBACK360_CALIBRATION_MASTER_ID) {
      assert.ok(master.regions.front.calibration && master.regions.rear.calibration, "the black reference owns the only calibration pair");
    } else {
      assert.equal(master.regions.front.calibration, undefined, `${master.hatColor} has no separate front calibration`);
      assert.equal(master.regions.rear.calibration, undefined, `${master.hatColor} has no separate rear calibration`);
    }
    assert.equal(master.sleeveMask.length, 8, "the shared rear sleeve mask follows the registered sleeve surface");
    for (const color of sleeveColors.MANUFACTURED_SLEEVE_COLORS) {
      assert.ok(Math.abs(customizerImage.snapback360MaterialIllumination(master.sleeveBaseLuminance * 255, master.sleeveBaseLuminance * 255, master.sleeveBaseLuminance * 255, master.sleeveBaseLuminance) - 1) < 1e-10,
        `${master.hatColor} hat supports a neutral ${color.label} sleeve at the registered material baseline`);
      const targetRgb = [1, 3, 5].map((offset) => Number.parseInt(color.hex.slice(offset, offset + 2), 16));
      const sourcePixels = new Uint8ClampedArray([128, 128, 128, 255, 23, 41, 59, 255]);
      const maskPixels = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
      customizerImage.recolorSnapback360Pixels(sourcePixels, maskPixels, color.hex, 128 / 255);
      assert.deepEqual([...sourcePixels], [...targetRgb, 255, 23, 41, 59, 255], `${master.hatColor} + ${color.label} changes only the masked sleeve pixel`);
    }
  }
  for (const entry of SNAPBACK360_LOGO_LIBRARY) {
    assert.ok(fs.existsSync(new URL(`../public${entry.src}`, import.meta.url)), `logo asset exists: ${entry.file}`);
  }

  const imagePath = new URL(`../public${SNAPBACK360_MASTER.image}`, import.meta.url);
  const image = fs.readFileSync(imagePath);
  const dimensions = [image.readUInt32BE(16), image.readUInt32BE(20)];
  assert.deepEqual(dimensions, [1254, 1254]);
  assert.equal(createHash("sha256").update(image).digest("hex"), SNAPBACK360_MASTER.imageSha256);

  const apex = { src: "/images/logos/svg/apex_logo.svg", label: "APEX" };
  const ny = { src: "/images/logos/svg/New_York_logo.svg", label: "New York" };
  const pngBytes = fs.readFileSync(new URL("../public/images/logos/apex_logo.png", import.meta.url));
  assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "uploaded PNG fixture is a real PNG");
  const upload = { src: `data:image/png;base64,${pngBytes.toString("base64")}`, label: "upload.png" };
  const resolve = customizerImage.resolveSnapback360ArtworkSelections;
  assert.deepEqual(resolve(apex, null, false), { front: apex, rear: apex }, "same library logo is inherited for the rear sleeve");
  assert.deepEqual(resolve(upload, null, false), { front: upload, rear: upload }, "same uploaded PNG is inherited for the rear sleeve");
  assert.deepEqual(resolve(upload, ny, true), { front: upload, rear: ny }, "uploaded front and library rear");
  assert.deepEqual(resolve(apex, upload, true), { front: apex, rear: upload }, "library front and uploaded rear");
  assert.deepEqual(resolve(apex, ny, true), { front: apex, rear: ny }, "different library logos remain independent");

  const sleeveQuad = [[100, 100], [300, 100], [300, 150], [100, 150]];
  const standardInsets = customizerImage.snapback360StudioArtworkExtensionRatios(40, 0, 0);
  assert.deepEqual(standardInsets, { topExtensionRatio: 0, bottomExtensionRatio: 0 });
  assert.deepEqual(customizerImage.extendSnapback360QuadForArtwork(sleeveQuad, standardInsets.topExtensionRatio, standardInsets.bottomExtensionRatio), sleeveQuad,
    "standard artwork keeps the calibrated sleeve frame at its original scale");

  const extendedInsets = customizerImage.snapback360StudioArtworkExtensionRatios(40, 10, 5);
  assert.deepEqual(extendedInsets, { topExtensionRatio: 0.25, bottomExtensionRatio: 0.125 });
  assert.deepEqual(customizerImage.extendSnapback360QuadForArtwork(sleeveQuad, extendedInsets.topExtensionRatio, extendedInsets.bottomExtensionRatio),
    [[100, 87.5], [300, 87.5], [300, 156.25], [100, 156.25]],
    "extended artwork expands past the sleeve without shrinking the calibrated sleeve core");

  const defaultPlacement = { offsetXRatio: 0, offsetYRatio: 0, scale: 1, rotationDeg: 0, perspectivePercent: 0 };
  const movedPlacement = { ...defaultPlacement, offsetXRatio: 0.1, offsetYRatio: 0.2, scale: 1.5 };
  const frontMoved = customizerImage.placeSnapback360ArtworkQuad(sleeveQuad, sleeveQuad, movedPlacement);
  const rearUnchanged = customizerImage.placeSnapback360ArtworkQuad(sleeveQuad, sleeveQuad, defaultPlacement);
  assert.deepEqual(frontMoved, [[70, 97.5], [370, 97.5], [370, 172.5], [70, 172.5]],
    "per-design offsets and scale transform the artwork around its calibrated surface");
  assert.deepEqual(rearUnchanged, sleeveQuad, "front placement edits do not change rear placement");
  assert.deepEqual(customizerImage.placeSnapback360ArtworkQuad(sleeveQuad, sleeveQuad, defaultPlacement), sleeveQuad,
    "default placement preserves the existing calibrated artwork transform");
  const extendedPlaced = customizerImage.placeSnapback360ArtworkQuad(
    customizerImage.extendSnapback360QuadForArtwork(sleeveQuad, extendedInsets.topExtensionRatio, extendedInsets.bottomExtensionRatio),
    sleeveQuad,
    defaultPlacement,
  );
  assert.equal(extendedPlaced[0][1], 87.5, "rear preview placement retains legitimate top extension");
});

test("Snapback 360 Shop gallery images receive their own type and ordering", async () => {
  const shop = await loadModule("../functions/_lib/shop.js");
  const image = { name: "snapink-snapback360-apex-snapback-360.png" };
  assert.equal(shop.shopProductImageType(image), "snapback-360");
  assert.equal(shop.SHOP_PRODUCT_IMAGE_ORDER[shop.shopProductImageRank(image)], "snapback-360");
});

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

test("Snapback 360 master is an independent, source-preserving two-region master", async () => {
  const registry = await loadModule("../src/config/snapback360MasterRegistry.ts");
  const { SNAPBACK360_MASTER, SNAPBACK360_LOGO_LIBRARY } = registry;
  assert.equal(SNAPBACK360_MASTER.id, "snapback360-black-trucker");
  assert.equal(SNAPBACK360_MASTER.name, "Snapback 360 — Black Trucker");
  assert.equal(SNAPBACK360_MASTER.type, "combined-front-rear-product-image");
  assert.notEqual(SNAPBACK360_MASTER.regions.front.calibration.version, SNAPBACK360_MASTER.regions.rear.calibration.version);
  assert.notDeepEqual(SNAPBACK360_MASTER.regions.front.calibration.quadPx, SNAPBACK360_MASTER.regions.rear.calibration.quadPx);
  assert.equal(SNAPBACK360_MASTER.regions.front.calibration.locked, false);
  assert.equal(SNAPBACK360_MASTER.regions.rear.calibration.locked, false);
  assert.ok(SNAPBACK360_LOGO_LIBRARY.some(({ file }) => file === "svg/apex_logo.svg"));
  assert.ok(SNAPBACK360_LOGO_LIBRARY.some(({ file }) => file === "svg/New_York_logo.svg"));
  assert.ok(SNAPBACK360_LOGO_LIBRARY.some(({ file }) => file === "apex_logo.png"));

  const imagePath = new URL(`../public${SNAPBACK360_MASTER.image}`, import.meta.url);
  const image = fs.readFileSync(imagePath);
  const dimensions = [image.readUInt32BE(16), image.readUInt32BE(20)];
  assert.deepEqual(dimensions, [1254, 1254]);
  assert.equal(createHash("sha256").update(image).digest("hex"), SNAPBACK360_MASTER.imageSha256);
});

test("Snapback 360 Shop gallery images receive their own type and ordering", async () => {
  const shop = await loadModule("../functions/_lib/shop.js");
  const image = { name: "snapink-snapback360-apex-snapback-360.png" };
  assert.equal(shop.shopProductImageType(image), "snapback-360");
  assert.equal(shop.SHOP_PRODUCT_IMAGE_ORDER[shop.shopProductImageRank(image)], "snapback-360");
});

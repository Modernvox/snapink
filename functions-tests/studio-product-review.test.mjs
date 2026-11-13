import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../functions/api/admin/studio-shop-product.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { onRequestPost } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));

test("Studio product API refuses horizontally out-of-bounds artwork pending manufacturing review", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    name: "Wide artwork review test", categoryId: "test-category", style: "standard", color: "#000000", artworkTier: "standard",
    artworkSize: "2", artworkWidthMm: "120", artworkWidthScale: "300", artworkHeightMm: "18", artworkHeightScale: "100",
    artworkExtensionMm: "0", artworkTopExtensionMm: "0", artworkBottomExtensionMm: "0",
    artworkCenterXmm: "42.85", artworkCenterYmm: "0", artworkStrokeEnabled: "false",
    artworkStrokeWidthMm: "1.5", artworkStrokeColor: "#000000",
  })) form.set(key, value);
  const request = new Request("https://snapbacksleeves.com/api/admin/studio-shop-product", {
    method: "POST",
    headers: { Authorization: "Bearer admin-test-token" },
    body: form,
  });
  const response = await onRequestPost({ request, env: { ADMIN_REVIEW_TOKEN: "admin-test-token", DB: {}, PRIVATE_ASSETS: {} } });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /manufacturing review/i);
});

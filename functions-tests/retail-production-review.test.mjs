import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../functions/api/admin/retail-orders.js", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { onRequestPatch } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));

const order = {
  id: "0123456789abcdef0123456789abcdef",
  orderNumber: "SI-TEST-OVERSIZED",
  status: "PENDING_REVIEW",
  quantity: 1,
  variant: "standard",
  size: 2,
  customerEmail: "customer@example.test",
  draftJson: JSON.stringify({ artworkHeightMm: 42.16, artworkWidthMm: 80, extendedArtwork: true, productionReviewRequired: true }),
};
const env = {
  ADMIN_REVIEW_TOKEN: "admin-test-token",
  DB: { prepare: () => ({ bind: () => ({ first: async () => order }) }) },
};

test("oversized artwork cannot be approved for checkout without explicit production review", async () => {
  const request = new Request("https://snapbacksleeves.com/api/admin/retail-orders", {
    method: "PATCH",
    headers: { Authorization: "Bearer admin-test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ id: order.id, action: "approve", extendedReviewApproved: true }),
  });
  const response = await onRequestPatch({ request, env });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /manufacturing review/i);
});

import { readShopProducts } from "./_lib/shop.js";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const STATIC_URLS = [
  "https://snapbacksleeves.com/",
  "https://snapbacksleeves.com/customize",
  "https://snapbacksleeves.com/fit-guide",
  "https://snapbacksleeves.com/pilot",
  "https://snapbacksleeves.com/wholesale-info",
  "https://snapbacksleeves.com/contact",
  "https://snapbacksleeves.com/shop",
];

const xmlEscape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

export async function onRequestGet({ env }) {
  let products = [];
  if (env.DB) {
    try {
      products = await readShopProducts(env.DB);
    } catch (error) {
      console.error("Sitemap shop catalog read failed", error instanceof Error ? error.message : "unknown");
      return new Response("Shop catalog is temporarily unavailable.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
  }

  const urls = new Set(STATIC_URLS);
  for (const product of products) {
    if (typeof product.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)) {
      urls.add(`https://snapbacksleeves.com/shop/${product.slug}`);
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${[...urls].map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

import siteImageRenditions from "../config/siteImageRenditions.json";

export function getSiteImageRendition(source) {
  if (!source) return null;
  let key = source;
  try {
    key = decodeURIComponent(new URL(source, window.location.origin).pathname);
  } catch {
    key = source.split("?")[0];
  }

  return siteImageRenditions[key] || null;
}

export function applySiteImageRendition(image, source, sizes = "100vw") {
  if (!image || !source) return false;
  const rendition = getSiteImageRendition(source);
  if (!rendition) {
    image.src = source;
    return false;
  }

  image.src = rendition.src;
  image.srcset = rendition.srcset;
  image.sizes = sizes;
  image.width = rendition.width;
  image.height = rendition.height;
  image.decoding = "async";
  return true;
}

export function applyShopProductThumbnail(image, source, sizes = "100vw") {
  if (!image || !source) return false;
  try {
    const url = new URL(source, window.location.origin);
    if (url.pathname === "/api/shop/product-image") {
      url.searchParams.set("variant", "thumbnail");
      image.src = `${url.pathname}${url.search}`;
      image.sizes = sizes;
      image.decoding = "async";
      return true;
    }
  } catch { /* Fall through to the existing static rendition map. */ }
  return applySiteImageRendition(image, source, sizes);
}

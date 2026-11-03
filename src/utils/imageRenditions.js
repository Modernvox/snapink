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

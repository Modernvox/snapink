const suffixPatterns = [
  /\s*[–—-]\s*SnapInk\s+Sleeve(?:™|TM)?\s*$/i,
  /\s*[–—-]\s*Swappable\s+Snapback\s+Hat\s+Strap(?:\s*[–—-]\s*SnapInk\s+Sleeve(?:™|TM)?)?\s*$/i,
  /\s*[–—-]\s*Swappable\s+Cover\s*$/i,
  /\s+SnapInk\s+Sleeve(?:™|TM)?\s*$/i,
  /\s+Swappable\s+Snapback\s+Hat\s+Strap(?:\s*[–—-]\s*SnapInk\s+Sleeve(?:™|TM)?)?\s*$/i,
  /\s+Swappable\s+Cover\s*$/i,
];

export function shopProductDesignName(value) {
  let design = String(value || "").normalize("NFKC").replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "").trim();
  let previous;
  do {
    previous = design;
    for (const pattern of suffixPatterns) design = design.replace(pattern, "").trim();
  } while (design !== previous);
  return design.replace(/[\s–—-]+$/u, "").trim();
}

export function canonicalShopProductName(value) {
  const design = shopProductDesignName(value);
  return design ? `${design} Swappable Snapback Hat Strap – SnapInk Sleeve™` : "";
}

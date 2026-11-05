const removeWords = (value, pattern) => value.replace(pattern, " ");

export function shopProductDesignName(value) {
  let design = String(value || "").normalize("NFKC").trim();
  design = design
    .replace(/\s*[–—-]\s*SnapInk\s+Sleeve™?\s*$/i, " ")
    .replace(/\s*[–—-]\s*Swappable\s+Cover\s*$/i, " ");
  design = removeWords(design, /\b(?:swappable\s+)?snapback\s+hat\s+strap(?:\s+(?:sleeve|cover))?\b/gi);
  design = removeWords(design, /\bsnapback\s+strap(?:\s+(?:sleeve|cover))?\b/gi);
  design = removeWords(design, /\bSnapInk\s+Sleeve(?:™)?(?=\W|$)/gi);
  design = removeWords(design, /\bSwappable\b/gi);
  return design.replace(/\s+/g, " ").replace(/^[–—-]\s*|\s*[–—-]$/g, "").trim();
}

export function canonicalShopProductName(value) {
  const design = shopProductDesignName(value);
  return design ? `${design} Swappable Snapback Hat Strap – SnapInk Sleeve™` : "";
}

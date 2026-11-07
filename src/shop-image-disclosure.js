const PREVIEW_TYPES = ["on-hat", "on-desk", "packaging", "male-lifestyle", "female-lifestyle"];

export function isGeneratedShopPreview(image) {
  const identity = [image?.url, image?.alt, image?.label, image?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return PREVIEW_TYPES.some((type) => identity.includes(type));
}

export function createProductPreviewDisclosure(className = "shop-preview-disclosure") {
  const note = document.createElement("div");
  note.className = className;
  note.setAttribute("role", "note");
  const label = document.createElement("strong");
  label.textContent = "PRODUCT PREVIEW";
  const copy = document.createElement("span");
  copy.textContent = "Actual sleeve has raised 3D lettering & artwork.";
  note.append(label, copy);
  return note;
}

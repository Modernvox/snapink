const RIGHT_EDGE_X_MM = [71.52, 80.21, 88.9, 97.59, 106.28, 114.97];
const FLAP_VALLEY_X_MM = -3.2;
const GEOMETRY_VERSION = "blank-flap-candidate-v1";
const POSITIONING_VERSION = "cad-flap-valley-to-right-edge-v1";

export function validDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).length > 32) return false;
  const allowed = new Set(["size","variant","text","font","fontSize","fontWeight","tracking","lineHeight","fill","stroke","strokeWidth","styleMode","arc","posX","posY","align","safeMargin","bgType","backgroundColor","logoName","logoX","logoY","logoScale","logoOpacity","productionGeometryVersion","positioningVersion","brandingCenterXmm","artworkCenterXmm","hasCustomArtwork"]);
  if (Object.keys(draft).some((key) => !allowed.has(key))) return false;
  if (draft.productionGeometryVersion !== GEOMETRY_VERSION || draft.positioningVersion !== POSITIONING_VERSION) return false;
  if (typeof draft.hasCustomArtwork !== "boolean" || !Number.isFinite(draft.brandingCenterXmm) || !Number.isFinite(draft.artworkCenterXmm)) return false;
  if (typeof draft.text !== "string" || draft.text.length > 500 || typeof draft.font !== "string" || draft.font.length > 180 || !/^[\w ,.'"-]+$/.test(draft.font)) return false;
  if (!Number.isFinite(draft.fontSize) || draft.fontSize < 60 || draft.fontSize > 500 || !Number.isFinite(draft.fontWeight) || draft.fontWeight < 100 || draft.fontWeight > 1200) return false;
  if (!Number.isFinite(draft.tracking) || draft.tracking < -0.1 || draft.tracking > 0.3 || !Number.isFinite(draft.lineHeight) || draft.lineHeight < 0.9 || draft.lineHeight > 1.6 || !Number.isFinite(draft.arc) || draft.arc < -15 || draft.arc > 20) return false;
  if (![draft.posX,draft.posY,draft.logoX,draft.logoY].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) return false;
  const edge = RIGHT_EDGE_X_MM[draft.size];
  if (!Number.isFinite(edge)) return false;
  const expectedCenter = (FLAP_VALLEY_X_MM + edge) / 2;
  const expectedArtworkCenter = (-12.725 + draft.posX / 100 * (edge + 12.725));
  if (Math.abs(draft.brandingCenterXmm - expectedCenter) > 0.01) return false;
  if (draft.text.trim() && Math.abs(draft.artworkCenterXmm - expectedArtworkCenter) > 0.01) return false;
  if (!draft.text.trim() && (Math.abs(draft.artworkCenterXmm - expectedCenter) > 0.01 || Math.abs(draft.logoX - ((expectedCenter - (FLAP_VALLEY_X_MM + 0.4 + 1.05)) / ((edge - 1.05) - (FLAP_VALLEY_X_MM + 0.4 + 1.05))) * 100) > 0.05)) return false;
  if (!Number.isFinite(draft.safeMargin) || draft.safeMargin < 0 || draft.safeMargin > 12 || !Number.isFinite(draft.logoScale) || draft.logoScale < 0 || draft.logoScale > 100 || !Number.isFinite(draft.logoOpacity) || draft.logoOpacity < 0 || draft.logoOpacity > 100) return false;
  if (!Number.isFinite(draft.strokeWidth) || draft.strokeWidth < 0 || draft.strokeWidth > 40 || !["emboss","flat"].includes(draft.styleMode) || !["start","center","end"].includes(draft.align) || draft.bgType !== "vector") return false;
  for (const color of [draft.fill,draft.stroke,draft.backgroundColor]) if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) return false;
  if (draft.hasCustomArtwork !== Boolean(draft.text.trim() || draft.logoName)) return false;
  return draft.logoName == null || (typeof draft.logoName === "string" && draft.logoName.length <= 180);
}

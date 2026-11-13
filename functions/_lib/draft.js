import { MAX_ARTWORK_EXTENSION_PER_EDGE_MM, MAX_EXTENDED_ARTWORK_HEIGHT_MM } from "./artwork-limits.js";

const RIGHT_EDGE_X_MM = [71.52, 80.21, 88.9, 97.59, 106.28, 114.97];
const FLAP_VALLEY_X_MM = -3.2;
const GEOMETRY_VERSION = "blank-flap-candidate-v1";
const POSITIONING_VERSION = "cad-flap-valley-to-right-edge-v1";
const STUDIO_ARTWORK_VERTICAL_POSITION_MIN = -400;

export function validDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).length > 48) return false;
  const allowed = new Set(["size","variant","text","font","fontSize","fontWeight","tracking","lineHeight","fill","stroke","strokeWidth","styleMode","arc","posX","posY","logoPosY","align","safeMargin","bgType","backgroundColor","logoName","logoX","logoY","logoScale","artworkHeightScale","logoOpacity","artworkStrokeEnabled","artworkStrokeWidthMm","artworkStrokeColor","productionGeometryVersion","positioningVersion","brandingCenterXmm","artworkCenterXmm","artworkCenterYmm","artworkWidthMm","artworkHeightMm","artworkExtensionMm","artworkTopExtensionMm","artworkBottomExtensionMm","extendedArtwork","hasCustomArtwork"]);
  if (Object.keys(draft).some((key) => !allowed.has(key))) return false;
  if (draft.productionGeometryVersion !== GEOMETRY_VERSION || draft.positioningVersion !== POSITIONING_VERSION) return false;
  if (typeof draft.hasCustomArtwork !== "boolean" || !Number.isFinite(draft.brandingCenterXmm) || !Number.isFinite(draft.artworkCenterXmm) || (draft.artworkCenterYmm != null && !Number.isFinite(draft.artworkCenterYmm))) return false;
  if (typeof draft.text !== "string" || draft.text.length > 500 || typeof draft.font !== "string" || draft.font.length > 180 || !/^[\w ,.'"-]+$/.test(draft.font)) return false;
  if (!Number.isFinite(draft.fontSize) || draft.fontSize < 60 || draft.fontSize > 500 || !Number.isFinite(draft.fontWeight) || draft.fontWeight < 100 || draft.fontWeight > 1200) return false;
  if (!Number.isFinite(draft.tracking) || draft.tracking < -0.1 || draft.tracking > 0.3 || !Number.isFinite(draft.lineHeight) || draft.lineHeight < 0.9 || draft.lineHeight > 1.6 || !Number.isFinite(draft.arc) || draft.arc < -15 || draft.arc > 20) return false;
  if (![draft.posX,draft.logoX].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) return false;
  if (!Number.isFinite(draft.posY) || draft.posY < STUDIO_ARTWORK_VERTICAL_POSITION_MIN || draft.posY > 200) return false;
  if (!Number.isFinite(draft.logoY) || draft.logoY < -200 || draft.logoY > 300) return false;
  if (draft.logoPosY != null && (!Number.isFinite(draft.logoPosY) || draft.logoPosY < STUDIO_ARTWORK_VERTICAL_POSITION_MIN || draft.logoPosY > 200)) return false;
  const edge = RIGHT_EDGE_X_MM[draft.size];
  if (!Number.isFinite(edge)) return false;
  const expectedCenter = (FLAP_VALLEY_X_MM + edge) / 2;
  const expectedArtworkCenter = (-12.725 + draft.posX / 100 * (edge + 12.725));
  if (Math.abs(draft.brandingCenterXmm - expectedCenter) > 0.01) return false;
  if (draft.text.trim() && Math.abs(draft.artworkCenterXmm - expectedArtworkCenter) > 0.01) return false;
  if (!draft.text.trim() && (Math.abs(draft.artworkCenterXmm - expectedCenter) > 0.01 || Math.abs(draft.logoX - ((expectedCenter - (FLAP_VALLEY_X_MM + 0.4 + 1.05)) / ((edge - 1.05) - (FLAP_VALLEY_X_MM + 0.4 + 1.05))) * 100) > 0.05)) return false;
  if (!Number.isFinite(draft.safeMargin) || draft.safeMargin < 0 || draft.safeMargin > 12 || !Number.isFinite(draft.logoScale) || draft.logoScale < 0 || draft.logoScale > 100 || (draft.artworkHeightScale != null && (!Number.isFinite(draft.artworkHeightScale) || draft.artworkHeightScale < 25)) || !Number.isFinite(draft.logoOpacity) || draft.logoOpacity < 0 || draft.logoOpacity > 100) return false;
  const hasArtworkReviewMetadata = draft.extendedArtwork != null || draft.artworkExtensionMm != null || draft.artworkWidthMm != null || draft.artworkHeightMm != null || draft.artworkTopExtensionMm != null || draft.artworkBottomExtensionMm != null;
  const hasDirectionalExtensionMetadata = draft.artworkTopExtensionMm != null || draft.artworkBottomExtensionMm != null;
  const requiresPremiumArtwork = hasDirectionalExtensionMetadata
    ? draft.artworkBottomExtensionMm > 0.001 || (draft.artworkTopExtensionMm > 0.001 && draft.artworkTopExtensionMm <= 12.7 + 0.001)
    : draft.artworkExtensionMm > 0.001;
  if (hasArtworkReviewMetadata && (![draft.artworkWidthMm,draft.artworkHeightMm,draft.artworkExtensionMm].every(Number.isFinite)
    || draft.artworkWidthMm < 0 || draft.artworkWidthMm > 200 || draft.artworkHeightMm < 0 || draft.artworkHeightMm > MAX_EXTENDED_ARTWORK_HEIGHT_MM + 0.001
    || draft.artworkExtensionMm < 0 || draft.artworkExtensionMm > MAX_ARTWORK_EXTENSION_PER_EDGE_MM + 0.001
    || (hasDirectionalExtensionMetadata && (!Number.isFinite(draft.artworkTopExtensionMm) || !Number.isFinite(draft.artworkBottomExtensionMm)
      || draft.artworkTopExtensionMm < 0 || draft.artworkTopExtensionMm > MAX_ARTWORK_EXTENSION_PER_EDGE_MM + 0.001
      || draft.artworkBottomExtensionMm < 0 || draft.artworkBottomExtensionMm > MAX_ARTWORK_EXTENSION_PER_EDGE_MM + 0.001
      || Math.abs(draft.artworkExtensionMm - Math.max(draft.artworkTopExtensionMm, draft.artworkBottomExtensionMm)) > 0.001))
    || typeof draft.extendedArtwork !== "boolean" || draft.extendedArtwork !== requiresPremiumArtwork)) return false;
  if (!Number.isFinite(draft.strokeWidth) || draft.strokeWidth < 0 || draft.strokeWidth > 40 || !["emboss","flat"].includes(draft.styleMode) || !["start","center","end"].includes(draft.align) || draft.bgType !== "vector") return false;
  for (const color of [draft.fill,draft.stroke,draft.backgroundColor]) if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) return false;
  if (draft.artworkStrokeEnabled != null && typeof draft.artworkStrokeEnabled !== "boolean") return false;
  if (draft.artworkStrokeWidthMm != null && (!Number.isFinite(draft.artworkStrokeWidthMm) || draft.artworkStrokeWidthMm < 0.25 || draft.artworkStrokeWidthMm > 5)) return false;
  if (draft.artworkStrokeColor != null && (typeof draft.artworkStrokeColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(draft.artworkStrokeColor))) return false;
  if (draft.artworkStrokeEnabled && (!Number.isFinite(draft.artworkStrokeWidthMm) || draft.artworkStrokeWidthMm < 0.25 || draft.artworkStrokeWidthMm > 5 || typeof draft.artworkStrokeColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(draft.artworkStrokeColor))) return false;
  if (draft.hasCustomArtwork !== Boolean(draft.text.trim() || draft.logoName)) return false;
  return draft.logoName == null || (typeof draft.logoName === "string" && draft.logoName.length <= 180);
}

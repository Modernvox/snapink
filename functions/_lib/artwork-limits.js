export const MAX_ARTWORK_EXTENSION_PER_EDGE_MM = 12.7;
export const MAX_EXTENDED_ARTWORK_HEIGHT_MM = 38.1;
export const ARTWORK_MEASUREMENT_TOLERANCE_MM = 0.001;
const ARTWORK_LEFT_BOUNDARY_X_MM = -1.75;
const ARTWORK_RIGHT_EDGE_X_MM = [71.52, 80.21, 88.9, 97.59, 106.28, 114.97];
const ARTWORK_RIGHT_INSET_MM = 1.05;

export function artworkHeightExceedsMaximum(heightMm) {
  return !Number.isFinite(heightMm) || heightMm > MAX_EXTENDED_ARTWORK_HEIGHT_MM + ARTWORK_MEASUREMENT_TOLERANCE_MM;
}

export function artworkWidthExceedsHorizontalBounds(widthMm, centerXmm, size) {
  if (!Number.isFinite(widthMm) || !Number.isFinite(centerXmm) || widthMm < 0) return true;
  if (widthMm <= ARTWORK_MEASUREMENT_TOLERANCE_MM) return false;
  const rightEdge = ARTWORK_RIGHT_EDGE_X_MM[size];
  if (!Number.isFinite(rightEdge)) return true;
  return centerXmm - widthMm / 2 < ARTWORK_LEFT_BOUNDARY_X_MM - ARTWORK_MEASUREMENT_TOLERANCE_MM
    || centerXmm + widthMm / 2 > rightEdge - ARTWORK_RIGHT_INSET_MM + ARTWORK_MEASUREMENT_TOLERANCE_MM;
}

export function artworkProductionReviewReason(widthMm = 0, heightMm = 0, centerXmm = 0, size) {
  if (artworkHeightExceedsMaximum(heightMm)) return "total_height_exceeds_38_1_mm";
  if (artworkWidthExceedsHorizontalBounds(widthMm, centerXmm, size)) return "horizontal_artwork_bounds_exceeded";
  return undefined;
}
export function maximumArtworkHeightScalePercent(baseHeightMm, currentScale = 100) {
  const safeCurrentScale = Number.isFinite(currentScale) && currentScale >= 0 ? currentScale : 100;
  const physicalMaximum = Number.isFinite(baseHeightMm) && baseHeightMm > 0
    ? MAX_EXTENDED_ARTWORK_HEIGHT_MM * 100 / baseHeightMm
    : 200;
  return Math.max(
    safeCurrentScale,
    Math.max(200, physicalMaximum)
  );
}

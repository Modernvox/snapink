export const MAX_ARTWORK_EXTENSION_PER_EDGE_MM = 12.7;
export const MAX_EXTENDED_ARTWORK_HEIGHT_MM = 38.1;
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

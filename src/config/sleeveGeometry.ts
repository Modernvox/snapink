import {
  MAX_ARTWORK_EXTENSION_PER_EDGE_MM,
  artworkHeightExceedsMaximum,
  MAX_EXTENDED_ARTWORK_HEIGHT_MM,
  maximumArtworkHeightScalePercent,
} from "../../functions/_lib/artwork-limits.js";

export { MAX_EXTENDED_ARTWORK_HEIGHT_MM, artworkHeightExceedsMaximum, maximumArtworkHeightScalePercent };

/**
 * Read-only transcription of the validated production-family dimensions.
 * Sources: snapink_cad/manufacturing/SnapInk_Official_Base_Sleeve_2_Production_Baseline
 * and snapink_cad/manufacturing/SnapInk_Billboard_Production.
 * This is display and artwork-clipping data only; it does not generate CAD.
 */
export type SleeveVariant = "standard" | "billboard";

/** Version stamped into every order so stale coordinates cannot be manufactured silently. */
export const POSITIONING_VERSION = "cad-flap-valley-to-right-edge-v1";
export const GEOMETRY_VERSION = "blank-flap-candidate-v1";

export interface SleeveGeometry {
  size: number;
  functionalLengthMm: number;
  overallMinXmm: number;
  overallMaxXmm: number;
  channelLengthMm: number;
  channelWidthMm: number;
  channelHeightMinMm: number;
  channelHeightMaxMm: number;
  pegHoleCentersMm: number[];
}

export interface GeometryFamily {
  label: string;
  validatedStatus: string;
  bodyWidthMm: number;
  billboardBowMm?: number;
  bowReferenceLengthMm?: number;
  sizes: readonly SleeveGeometry[];
}

const FUNCTIONAL_LENGTHS = [71.52, 80.21, 88.9, 97.59, 106.28, 114.97];
const CHANNEL_LENGTHS = [66.675, 73.535, 82.225, 90.915, 99.605, 108.295];
const FIRST_HOLE_X_MM = 70.1;
export const SNAP_PEG_PITCH_MM = 8.69;
export const SNAP_PEG_HOLE_DIAMETER_MM = 2.72;
export const BRANDING_EXTENSION_MM = 15.875;
export const BRANDING_ENTRY_X_MM = 3.15;
export const BRANDING_GROOVE_X_MM = BRANDING_ENTRY_X_MM - 6.35;
export const BRANDING_GROOVE_WIDTH_MM = 0.8;
export const BRANDING_GROOVE_DEPTH_MM = 0.25;
export const BRANDING_EDGE_CLEARANCE_MM = 1;
/** Maximum permitted artwork extension above the physical sleeve edge. */
export const MAX_STUDIO_TOP_ARTWORK_EXTENSION_MM = MAX_ARTWORK_EXTENSION_PER_EDGE_MM;
/** Existing top margin retained by product-image export pipelines. */
export const MAX_TOP_ARTWORK_EXTENSION_MM = MAX_ARTWORK_EXTENSION_PER_EDGE_MM;
/** Maximum permitted artwork extension below the physical sleeve edge. */
export const MAX_BOTTOM_ARTWORK_EXTENSION_MM = MAX_ARTWORK_EXTENSION_PER_EDGE_MM;
/** The production CAD references expose the groove's right edge at -2.8 mm. */
export const APPROVED_CAD_GROOVE_RIGHT_EDGE_X_MM = -2.8;
/** Python production insets the CAD-derived branding face by 1.05 mm. */
export const PRODUCTION_BRANDING_INSET_MM = 1.05;
/** Position sliders preserve legacy values while exposing the approved edge extensions. */
export const ARTWORK_VERTICAL_POSITION_MIN = -400;
export const ARTWORK_VERTICAL_POSITION_MAX = 200;
export const CAD_BODY_HEIGHT_MM = 3.26;
export const MINIMUM_CHANNEL_MM = 66.675;
export const SUPPORT_STYLE = "separate full-width PLA support, 0.200 mm cavity-side clearance";

/** Visual-only sleeve scale in Studio's photographic composite. */
export const STUDIO_SLEEVE_PREVIEW_SCALE = 1.25;

/** Shared desktop-only vertical shift in native 1000px preview coordinates. */
export const STUDIO_DESKTOP_SLEEVE_VERTICAL_OFFSET_STAGE_PX = -5;
/** Incremental desktop-only offsets applied on top of the shared shift. */
export const STUDIO_DESKTOP_SLEEVE_VERTICAL_SIZE_ADJUSTMENT_STAGE_PX = {
  0: 3,
  1: 3,
  2: 0,
  3: 3,
  4: 0,
  5: 3,
} as const;

/** Prior desktop CSS-pixel calibration plus Round 2 additions in 1000-stage px. */
export const STUDIO_DESKTOP_SLEEVE_CALIBRATION_PX = {
  0: { widthIncrease: 200, heightDecrease: 30, round2: { widthIncreaseStagePx: 20, heightIncreaseStagePx: 30 } },
  1: { widthIncrease: 125, heightDecrease: 10, round2: { widthIncreaseStagePx: 20, heightIncreaseStagePx: 20 } },
  2: { widthIncrease: 100, heightDecrease: 5, round2: { widthIncreaseStagePx: 0, heightIncreaseStagePx: 20 } },
  3: { widthIncrease: 50, heightDecrease: 0, round2: { widthIncreaseStagePx: 5, heightIncreaseStagePx: 10 } },
  4: { widthIncrease: 15, heightDecrease: 0, round2: { widthIncreaseStagePx: 15, heightIncreaseStagePx: 16 } },
  5: { widthIncrease: 12, heightDecrease: 0, round2: { widthIncreaseStagePx: 8, heightIncreaseStagePx: 10 } },
} as const;

/** Mobile-only sleeve endpoint calibration in the native 1000px stage coordinate system.
 * Sizes 0–3 match Size 5's CAD-derived right endpoint; Size 4 extends 2px;
 * Size 5 remains the horizontal master. The renderer resolves 0–3 from CAD
 * lengths and the active mobile strap thickness, before camera zoom.
 */
export const STUDIO_MOBILE_SLEEVE_RIGHT_EDGE_CALIBRATION = {
  matchSize: { 0: 5, 1: 5, 2: 5, 3: 5 },
  additionalStagePx: { 4: 2, 5: 0 },
} as const;
/** Expand the mobile sleeve at its top edge while holding its bottom fixed. */
export const STUDIO_MOBILE_SLEEVE_TOP_EXPANSION_STAGE_PX = 3;
/** Incremental mobile-only top-edge adjustment for the next calibration round. */
export const STUDIO_MOBILE_SLEEVE_TOP_EXPANSION_ADDITIONAL_STAGE_PX = 2;

/** Pixel landmarks measured from the owner-approved blank Size 4 on-hat master. */
export const APPROVED_BLANK_SLEEVE_VISUAL_REFERENCE = {
  imagePath: "/images/website_images/blank_sleeve_on_snapback.png",
  sha256: "225f963838a487afdadab2bbf9d93ecca143796cb6fd0faceca942d6cc6b69dc",
  variant: "billboard" as const,
  size: 4,
  cadLengthMm: 119.005,
  cadGrooveXmm: -3.2,
  sleeveBoundsPx: { left: 309, right: 1126 },
  grooveCenterlinePx: [[393, 626], [388, 854]] as const,
} as const;

function sizes(): readonly SleeveGeometry[] {
  return FUNCTIONAL_LENGTHS.map((functionalLengthMm, size) => ({
    size,
    functionalLengthMm,
    overallMinXmm: BRANDING_ENTRY_X_MM - BRANDING_EXTENSION_MM,
    overallMaxXmm: functionalLengthMm,
    channelLengthMm: CHANNEL_LENGTHS[size],
    channelWidthMm: 22.01,
    channelHeightMinMm: size === 0 ? 1.9 : 1.44,
    channelHeightMaxMm: 1.9,
    pegHoleCentersMm: Array.from(
      { length: size },
      (_, index) => Number((FIRST_HOLE_X_MM + index * SNAP_PEG_PITCH_MM).toFixed(3))
    ),
  }));
}

/**
 * Per-project branding boundaries read from the approved Orca 2.4.0 meshes.
 * The native mesh X coordinates were measured independently for each body;
 * the standard CAD coordinate frame is mesh X + 42.85 mm. The groove center
 * is read from the through-width groove in each model, not from the whole
 * model bounds. Keeping one entry per approved project prevents future size
 * variants from silently inheriting another model's face bounds.
 */
// One CAD-measured boundary table is deliberately shared by both variants.
// X=-3.2 mm is the flap-valley center; the right edge is measured per size.
const APPROVED_FLAP_VALLEY_X_MM = -3.2;
const APPROVED_BRANDING_RIGHT_EDGE_X_MM = [71.52, 80.21, 88.9, 97.59, 106.28, 114.97] as const;

export interface BrandingRegion {
  flapValleyXmm: number;
  /** Compatibility alias for existing groove rendering and exported SVG data. */
  grooveXmm: number;
  rightEdgeXmm: number;
  centerXmm: number;
}

export function brandingRegionFor(variant: SleeveVariant, size: number): BrandingRegion {
  if (!Number.isInteger(size) || size < 0 || size >= APPROVED_BRANDING_RIGHT_EDGE_X_MM.length) {
    throw new RangeError(`Unsupported SnapInk sleeve size: ${size}`);
  }
  const modelGeometry = geometryFor(variant, size);
  const flapValleyXmm = APPROVED_FLAP_VALLEY_X_MM;
  const rightEdgeXmm = APPROVED_BRANDING_RIGHT_EDGE_X_MM[size];
  if (Math.abs(rightEdgeXmm - modelGeometry.overallMaxXmm) > 0.001) {
    throw new Error(`Branding edge does not match approved ${variant} size ${size} model bounds.`);
  }
  if (Math.abs(flapValleyXmm + BRANDING_GROOVE_WIDTH_MM / 2 - APPROVED_CAD_GROOVE_RIGHT_EDGE_X_MM) > 0.001) {
    throw new Error(`Flap-valley reference does not match the approved ${variant} size ${size} CAD groove.`);
  }
  return {
    flapValleyXmm,
    grooveXmm: flapValleyXmm,
    rightEdgeXmm,
    centerXmm: (flapValleyXmm + rightEdgeXmm) / 2,
  };
}

/**
 * Map the Studio SVG canvas to the same CAD coordinate used by production.
 * `logoX`/`logoY` in an order draft are percentages of Python's inset usable
 * face bounds, not percentages of the sleeve's overall bounding box.
 */
export function studioArtworkPositionFor(
  variant: SleeveVariant,
  size: number,
  canvasXPercent: number,
  canvasYPercent: number
): { centerXmm: number; centerYmm: number; logoX: number; logoY: number } {
  if (![canvasXPercent, canvasYPercent].every(Number.isFinite)) {
    throw new RangeError("Studio artwork position must be finite.");
  }
  const geometry = geometryFor(variant, size);
  const bounds = surfaceBounds(variant, size);
  const branding = brandingRegionFor(variant, size);
  const centerXmm = geometry.overallMinXmm
    + (canvasXPercent / 100) * (geometry.overallMaxXmm - geometry.overallMinXmm);
  const centerYmm = bounds.maxY - (canvasYPercent / 100) * (bounds.maxY - bounds.minY);
  const usableMinX = branding.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + PRODUCTION_BRANDING_INSET_MM;
  const usableMaxX = branding.rightEdgeXmm - PRODUCTION_BRANDING_INSET_MM;
  const usableMinY = bounds.minY + PRODUCTION_BRANDING_INSET_MM;
  const usableMaxY = bounds.maxY - PRODUCTION_BRANDING_INSET_MM;
  if (usableMaxX <= usableMinX || usableMaxY <= usableMinY) {
    throw new Error(`Approved ${variant} size ${size} branding face has no usable area.`);
  }
  return {
    centerXmm,
    centerYmm,
    logoX: ((centerXmm - usableMinX) / (usableMaxX - usableMinX)) * 100,
    logoY: ((usableMaxY - centerYmm) / (usableMaxY - usableMinY)) * 100,
  };
}

export function brandingCenterCanvasPercentFor(variant: SleeveVariant, size: number): number {
  const geometry = geometryFor(variant, size);
  const branding = brandingRegionFor(variant, size);
  return ((branding.centerXmm - geometry.overallMinXmm)
    / (geometry.overallMaxXmm - geometry.overallMinXmm)) * 100;
}

/** CAD artwork limits after excluding the groove and edge insets, in Studio canvas %. */
export function usableBrandingCanvasRangePercentFor(variant: SleeveVariant, size: number): { start: number; end: number } {
  const geometry = geometryFor(variant, size);
  const branding = brandingRegionFor(variant, size);
  const usableMinX = branding.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + PRODUCTION_BRANDING_INSET_MM;
  const usableMaxX = branding.rightEdgeXmm - PRODUCTION_BRANDING_INSET_MM;
  const canvasLength = geometry.overallMaxXmm - geometry.overallMinXmm;
  return {
    start: ((usableMinX - geometry.overallMinXmm) / canvasLength) * 100,
    end: ((usableMaxX - geometry.overallMinXmm) / canvasLength) * 100,
  };
}

/** Center of the CAD branding face after excluding the groove and edge insets. */
export function usableBrandingCenterCanvasPercentFor(variant: SleeveVariant, size: number): number {
  const range = usableBrandingCanvasRangePercentFor(variant, size);
  return (range.start + range.end) / 2;
}

export function usableBrandingAlignmentCanvasPercentFor(
  variant: SleeveVariant,
  size: number,
  alignment: "start" | "center" | "end"
): number {
  const range = usableBrandingCanvasRangePercentFor(variant, size);
  if (alignment === "start") return range.start;
  if (alignment === "end") return range.end;
  return (range.start + range.end) / 2;
}

export const SLEEVE_GEOMETRY: Record<SleeveVariant, GeometryFamily> = {
  standard: {
    label: "Standard",
    validatedStatus:
      "Size 2 is the physically validated Official Base Sleeve 2 baseline. Sizes 0, 1, 3, 4, and 5 are CAD and slicer validated; not physically printed.",
    bodyWidthMm: 24.31,
    sizes: sizes(),
  },
  billboard: {
    label: "Billboard",
    validatedStatus:
      "Sizes 0–5 are CAD/read-back checked family candidates. Orca projects are unsliced and physical fit is untested.",
    bodyWidthMm: 24.31,
    billboardBowMm: 1.5,
    bowReferenceLengthMm: 88.9,
    sizes: sizes(),
  },
};

export function geometryFor(variant: SleeveVariant, size: number): SleeveGeometry {
  const geometry = SLEEVE_GEOMETRY[variant].sizes[size];
  if (!geometry) throw new RangeError(`Unsupported SnapInk sleeve size: ${size}`);
  if (geometry.channelLengthMm < MINIMUM_CHANNEL_MM) {
    throw new Error(`Size ${size} channel is below the validated ${MINIMUM_CHANNEL_MM} mm minimum.`);
  }
  return geometry;
}

/** CAD groove coordinate as a fraction of each sleeve's actual X bounds. */
export function sleeveGrooveFractionFor(variant: SleeveVariant, size: number): number {
  const geometry = geometryFor(variant, size);
  const grooveXmm = brandingRegionFor(variant, size).grooveXmm;
  const fraction = (grooveXmm - geometry.overallMinXmm)
    / (geometry.overallMaxXmm - geometry.overallMinXmm);

  if (variant === APPROVED_BLANK_SLEEVE_VISUAL_REFERENCE.variant
      && size === APPROVED_BLANK_SLEEVE_VISUAL_REFERENCE.size) {
    const reference = APPROVED_BLANK_SLEEVE_VISUAL_REFERENCE;
    const cadLengthMm = geometry.overallMaxXmm - geometry.overallMinXmm;
    const measuredGrooveX = (reference.grooveCenterlinePx[0][0] + reference.grooveCenterlinePx[1][0]) / 2;
    const measuredFraction = (measuredGrooveX - reference.sleeveBoundsPx.left)
      / (reference.sleeveBoundsPx.right - reference.sleeveBoundsPx.left);
    if (Math.abs(cadLengthMm - reference.cadLengthMm) > 0.001
        || Math.abs(grooveXmm - reference.cadGrooveXmm) > 0.001
        || Math.abs(fraction - measuredFraction) > 0.025) {
      throw new Error("The CAD groove datum no longer matches the approved blank sleeve photo reference.");
    }
  }

  return fraction;
}

/**
 * Studio camera framing presets, derived from the approved CAD overall sleeve
 * lengths. Size 5 is the native (1×) framing; shorter physical sleeves zoom in
 * by the inverse length ratio. Mobile references are already closure close-ups,
 * so their size range is compressed to this configurable 8% zoom-out span.
 * These values affect only the shared hat-and-sleeve camera transform.
 */
const overallSleeveLengthMm = (geometry: SleeveGeometry) => geometry.overallMaxXmm - geometry.overallMinXmm;
const desktopCameraZoom = (variant: SleeveVariant) => {
  const referenceLength = overallSleeveLengthMm(geometryFor(variant, 5));
  return SLEEVE_GEOMETRY[variant].sizes.map((geometry) => referenceLength / overallSleeveLengthMm(geometry));
};
const mobileCameraZoom = (variant: SleeveVariant) => {
  const desktop = desktopCameraZoom(variant);
  const closest = Math.max(...desktop);
  const widestZoom = 0.92;
  return desktop.map((zoom) => widestZoom + (1 - widestZoom) * ((zoom - 1) / (closest - 1)));
};

export const STUDIO_HAT_CAMERA_ZOOM_CONFIG = {
  desktop: {
    standard: desktopCameraZoom("standard"),
    billboard: desktopCameraZoom("billboard"),
  },
  mobile: {
    standard: mobileCameraZoom("standard"),
    billboard: mobileCameraZoom("billboard"),
  },
} as const;

export interface SurfaceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const STANDARD_HALF_WIDTH_MM = SLEEVE_GEOMETRY.standard.bodyWidthMm / 2;
function billboardBowOffset(x: number): number {
  const referenceLength = SLEEVE_GEOMETRY.billboard.bowReferenceLengthMm!;
  const half = referenceLength / 2;
  const bow = SLEEVE_GEOMETRY.billboard.billboardBowMm!;
  const radius = (half * half + bow * bow) / (2 * bow);
  // The CAD Size 4 HatLaunch repair continues this exact circle past the
  // Size 2 reference end instead of dropping back to Standard width. The
  // archive has no matching repaired STEP for sizes 3 or 5; those sizes use
  // their validated family end lengths with this same documented CAD rule.
  const dx = x - half;
  return radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
}

export function surfaceBounds(variant: SleeveVariant, size: number): SurfaceBounds {
  const geometry = geometryFor(variant, size);
  const maxY = variant === "billboard"
    ? Number((STANDARD_HALF_WIDTH_MM + Math.max(
      billboardBowOffset(geometry.overallMinXmm),
      billboardBowOffset(geometry.overallMaxXmm)
    )).toFixed(3))
    : STANDARD_HALF_WIDTH_MM;
  return {
    minX: geometry.overallMinXmm,
    maxX: geometry.overallMaxXmm,
    minY: -maxY,
    maxY,
  };
}

/** Returns the CAD top-face half-width at a functional X coordinate. */
export function halfWidthAt(variant: SleeveVariant, x: number): number {
  if (variant === "standard") return STANDARD_HALF_WIDTH_MM;
  return STANDARD_HALF_WIDTH_MM + billboardBowOffset(x);
}

/** Measure a centered artwork rectangle against production CAD dimensions. */
export function artworkBoundsStatusMm(
  variant: SleeveVariant,
  size: number,
  centerXmm: number,
  centerYmm: number,
  widthMm: number,
  heightMm: number,
  edgeMarginMm = BRANDING_EDGE_CLEARANCE_MM,
  visibleProfile?: readonly { x: number; top: number; bottom: number }[]
): {
  extensionMm: number;
  topExtensionMm: number;
  bottomExtensionMm: number;
  crossesLockedEdge: boolean;
  crossesLeftEdge: boolean;
  crossesRightEdge: boolean;
  crossesGroove: boolean;
  violatesClearance: boolean;
  violatesTopClearance: boolean;
  violatesBottomClearance: boolean;
} {
  const branding = brandingRegionFor(variant, size);
  const left = branding.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + PRODUCTION_BRANDING_INSET_MM;
  const right = branding.rightEdgeXmm - PRODUCTION_BRANDING_INSET_MM;
  const artLeft = centerXmm - widthMm / 2;
  const artRight = centerXmm + widthMm / 2;
  const grooveLeft = branding.grooveXmm - BRANDING_GROOVE_WIDTH_MM / 2 - edgeMarginMm;
  const grooveRight = branding.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + edgeMarginMm;
  let topExtensionMm = 0;
  let bottomExtensionMm = 0;
  const crossesLeftEdge = artLeft < left - 1e-6;
  const crossesRightEdge = artRight > right + 1e-6;
  const fallbackSampleCount = Math.max(1, Math.ceil(widthMm / 0.1));
  const profile = visibleProfile?.length ? visibleProfile : Array.from({ length: fallbackSampleCount + 1 }, (_, i) => ({
    x: i / fallbackSampleCount,
    top: 0,
    bottom: 1,
  }));
  const crossesGroove = visibleProfile?.length
    ? profile.some((point) => {
      const x = artLeft + widthMm * point.x;
      return x > grooveLeft && x < grooveRight;
    })
    : artLeft < grooveRight && artRight > grooveLeft;
  for (const point of profile) {
    const x = artLeft + widthMm * point.x;
    const halfWidth = halfWidthAt(variant, x);
    const artTop = centerYmm + heightMm * (0.5 - point.top);
    const artBottom = centerYmm + heightMm * (0.5 - point.bottom);
    const topDelta = artTop - halfWidth;
    const bottomDelta = -halfWidth - artBottom;
    topExtensionMm = Math.max(topExtensionMm, topDelta);
    bottomExtensionMm = Math.max(bottomExtensionMm, bottomDelta);
  }
  topExtensionMm = Math.max(0, topExtensionMm);
  bottomExtensionMm = Math.max(0, bottomExtensionMm);
  // The 1 mm clearance applies only when the artwork is fully contained.
  // Near an edge, artwork may either retain that clearance or intentionally
  // cross the edge as an explicitly extended design.
  let violatesTopClearance = false;
  let violatesBottomClearance = false;
  if (topExtensionMm <= 1e-6 && bottomExtensionMm <= 1e-6) {
    for (const point of profile) {
      const x = artLeft + widthMm * point.x;
      const halfWidth = halfWidthAt(variant, x);
      const topDelta = centerYmm + heightMm * (0.5 - point.top) - halfWidth;
      const bottomDelta = -halfWidth - (centerYmm + heightMm * (0.5 - point.bottom));
      if (topDelta > -edgeMarginMm + 1e-6) violatesTopClearance = true;
      if (bottomDelta > -edgeMarginMm + 1e-6) violatesBottomClearance = true;
      if (violatesTopClearance && violatesBottomClearance) break;
    }
  }
  return {
    extensionMm: Math.max(topExtensionMm, bottomExtensionMm),
    topExtensionMm,
    bottomExtensionMm,
    crossesLockedEdge: crossesLeftEdge || crossesRightEdge || crossesGroove,
    crossesLeftEdge,
    crossesRightEdge,
    crossesGroove,
    violatesClearance: violatesTopClearance || violatesBottomClearance,
    violatesTopClearance,
    violatesBottomClearance,
  };
}

/** Safe vertical center limits for artwork of the given full height. */
export function artworkVerticalCenterRangeMm(
  variant: SleeveVariant,
  size: number,
  artworkHeightMm: number,
  edgeMarginMm = BRANDING_EDGE_CLEARANCE_MM,
  topExtensionMm = 0,
  bottomExtensionMm = 0
): { minCenterY: number; maxCenterY: number } {
  const branding = brandingRegionFor(variant, size);
  const left = branding.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + PRODUCTION_BRANDING_INSET_MM;
  const right = branding.rightEdgeXmm - PRODUCTION_BRANDING_INSET_MM;
  const halfArtworkHeight = Math.max(0, artworkHeightMm) / 2;
  let minCenterY = -Infinity;
  let maxCenterY = Infinity;
  const samples = Math.max(1, Math.ceil((right - left) / 0.25));
  for (let i = 0; i <= samples; i += 1) {
    const x = left + ((right - left) * i) / samples;
    const halfWidth = halfWidthAt(variant, x);
    minCenterY = Math.max(minCenterY, -halfWidth - bottomExtensionMm + (bottomExtensionMm > 0 ? 0 : edgeMarginMm) + halfArtworkHeight);
    maxCenterY = Math.min(maxCenterY, halfWidth + topExtensionMm - (topExtensionMm > 0 ? 0 : edgeMarginMm) - halfArtworkHeight);
  }
  return { minCenterY, maxCenterY };
}

/**
 * Resolve the artwork control to the CAD top-face centerline. 0 is the top
 * safe position, 100 the bottom safe position, and values outside that range
 * extrapolate while preserving the user's requested offset.
 */
export function artworkCenterYForPositionMm(
  variant: SleeveVariant,
  size: number,
  positionPercent: number,
  artworkHeightMm: number,
  edgeMarginMm = BRANDING_EDGE_CLEARANCE_MM,
  topExtensionMm = 0,
  bottomExtensionMm = 0
): number {
  const bounds = surfaceBounds(variant, size);
  const baseRange = artworkVerticalCenterRangeMm(variant, size, artworkHeightMm, edgeMarginMm);
  const extendedRange = artworkVerticalCenterRangeMm(variant, size, artworkHeightMm, edgeMarginMm, topExtensionMm, bottomExtensionMm);
  if (positionPercent < 0 && topExtensionMm > 0) {
    const halfArtworkHeight = Math.max(0, artworkHeightMm) / 2;
    const baseTop = baseRange.maxCenterY >= baseRange.minCenterY ? baseRange.maxCenterY : bounds.maxY - halfArtworkHeight;
    const extendedTop = extendedRange.maxCenterY >= extendedRange.minCenterY ? extendedRange.maxCenterY : bounds.maxY + topExtensionMm - halfArtworkHeight;
    return baseTop + (extendedTop - baseTop) * Math.min(1, Math.max(0, -positionPercent / Math.abs(ARTWORK_VERTICAL_POSITION_MIN)));
  }
  if (positionPercent > 100 && bottomExtensionMm > 0) {
    const bottomCenter = baseRange.minCenterY >= baseRange.maxCenterY
      ? bounds.minY + Math.max(0, artworkHeightMm) / 2
      : baseRange.minCenterY;
    const extendedBottomCenter = extendedRange.minCenterY <= extendedRange.maxCenterY
      ? extendedRange.minCenterY
      : bounds.minY - bottomExtensionMm + Math.max(0, artworkHeightMm) / 2;
    return bottomCenter + (extendedBottomCenter - bottomCenter) * Math.min(1, Math.max(0, (positionPercent - 100) / 100));
  }
  const { minCenterY, maxCenterY } = topExtensionMm > 0 || bottomExtensionMm > 0 ? baseRange : extendedRange;
  if (maxCenterY >= minCenterY) {
    return maxCenterY - ((maxCenterY - minCenterY) * positionPercent) / 100;
  }
  // If the artwork cannot fit vertically, still move it with the slider using
  // the sleeve's physical edge as the reference. The warning reports the fit.
  const halfArtworkHeight = Math.max(0, artworkHeightMm) / 2;
  const topCenterY = bounds.maxY - halfArtworkHeight;
  const bottomCenterY = bounds.minY + halfArtworkHeight;
  return topCenterY - ((topCenterY - bottomCenterY) * positionPercent) / 100;
}

function toCanvas(x: number, y: number, bounds: SurfaceBounds, width: number, height: number): [number, number] {
  return [
    ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    ((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * height,
  ];
}

/**
 * Maps the top printable CAD face into the customizer's SVG coordinates.
 * Billboard curvature follows the fixed Size 2 circle and continues through
 * each sleeve's right end, matching the corrected Size 4 CAD repair.
 */
export function brandingSurfacePath(
  variant: SleeveVariant,
  size: number,
  width: number,
  height: number,
  topExtensionMm = 0,
  bottomExtensionMm = 0
): string {
  const bounds = surfaceBounds(variant, size);
  if (variant === "standard") {
    const extensionPx = topExtensionMm * height / (bounds.maxY - bounds.minY);
    const bottomExtensionPx = bottomExtensionMm * height / (bounds.maxY - bounds.minY);
    return `M 0 ${-extensionPx} H ${width} V ${height + bottomExtensionPx} H 0 Z`;
  }

  const stepMm = 0.25;
  const xs: number[] = [bounds.minX];
  for (let x = bounds.minX + stepMm; x < bounds.maxX; x += stepMm) xs.push(x);
  xs.push(bounds.maxX);
  const upper: [number, number][] = [];
  for (const x of xs) {
    upper.push(toCanvas(x, halfWidthAt(variant, x) + topExtensionMm, bounds, width, height));
  }
  const lower: [number, number][] = [];
  for (const x of [...xs].reverse()) {
    lower.push(toCanvas(x, -halfWidthAt(variant, x) - bottomExtensionMm, bounds, width, height));
  }
  const points = [...upper, ...lower];
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`).join(" ")} Z`;
}

/** Adds the actual through-width branding groove as a no-art exclusion. */
export function nonPrintableGroovePath(
  variant: SleeveVariant,
  size: number,
  width: number,
  height: number
): string {
  const bounds = surfaceBounds(variant, size);
  const grooveX = brandingRegionFor(variant, size).grooveXmm;
  const left = grooveX - BRANDING_GROOVE_WIDTH_MM / 2;
  const right = grooveX + BRANDING_GROOVE_WIDTH_MM / 2;
  const [x0] = toCanvas(left, 0, bounds, width, height);
  const [x1] = toCanvas(right, 0, bounds, width, height);
  return `M ${x0.toFixed(3)} -10 L ${x1.toFixed(3)} -10 L ${x1.toFixed(3)} ${height + 10} L ${x0.toFixed(3)} ${height + 10} Z`;
}

export function cadXToCanvasX(variant: SleeveVariant, size: number, x: number, width: number): number {
  const bounds = surfaceBounds(variant, size);
  return ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width;
}

/**
 * Largest full-image height that fits the usable top face at a chosen center.
 * Includes the CAD curve, the machined groove exclusion, the logo aspect ratio,
 * and a physical edge margin. Returned dimensions are millimeters.
 */
export function maximumContainedLogoHeightMm(
  variant: SleeveVariant,
  size: number,
  centerXmm: number,
  centerYmm: number,
  aspectRatio: number,
  edgeMarginMm = BRANDING_EDGE_CLEARANCE_MM,
  topExtensionMm = 0
): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return 0;
  const geometry = geometryFor(variant, size);
  const bounds = surfaceBounds(variant, size);
  const groove = brandingRegionFor(variant, size).grooveXmm;
  const grooveMin = groove - BRANDING_GROOVE_WIDTH_MM / 2;
  const grooveMax = groove + BRANDING_GROOVE_WIDTH_MM / 2;
  const xLimitMm = Math.max(0, bounds.maxX - bounds.minX - 2 * edgeMarginMm);
  const yLimitMm = Math.max(0, bounds.maxY - bounds.minY + topExtensionMm - 2 * edgeMarginMm);
  let low = 0;
  let high = Math.min(yLimitMm, xLimitMm / aspectRatio);

  const fits = (heightMm: number) => {
    const widthMm = heightMm * aspectRatio;
    const left = centerXmm - widthMm / 2;
    const right = centerXmm + widthMm / 2;
    if (left < bounds.minX + edgeMarginMm || right > bounds.maxX - edgeMarginMm) return false;
    if (left < grooveMax + edgeMarginMm && right > grooveMin - edgeMarginMm) return false;

    const samples = Math.max(1, Math.ceil(widthMm / 0.25));
    for (let i = 0; i <= samples; i += 1) {
      const x = left + (widthMm * i) / samples;
      const halfWidth = halfWidthAt(variant, x);
      if (centerYmm - heightMm / 2 < -halfWidth + edgeMarginMm) return false;
      if (centerYmm + heightMm / 2 > halfWidth + topExtensionMm - (topExtensionMm > 0 ? 0 : edgeMarginMm)) return false;
    }
    return true;
  };

  if (!fits(0)) return 0;
  for (let i = 0; i < 32; i += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  // Deflate a tiny amount so SVG/raster rounding cannot touch the margin.
  return Math.max(0, low - 0.01);
}

/** Resolve the Studio's overall logo scale from a stable calibrated center. */
export function studioLogoBaseHeightMmFor(
  variant: SleeveVariant,
  size: number,
  aspectRatio: number,
  logoScalePercent: number
): number {
  const bounds = surfaceBounds(variant, size);
  const usable = usableBrandingCanvasRangePercentFor(variant, size);
  const calibratedCenterX = studioArtworkPositionFor(variant, size, (usable.start + usable.end) / 2, 50).centerXmm;
  const maxHeight = maximumContainedLogoHeightMm(
    variant,
    size,
    calibratedCenterX,
    (bounds.minY + bounds.maxY) / 2,
    aspectRatio
  );
  return maxHeight * (Math.max(0, Math.min(200, logoScalePercent)) / 100);
}

/** Position varies only X; the selected logo dimensions come from fixed size controls. */
export function studioLogoPlacementMmFor(
  variant: SleeveVariant,
  size: number,
  positionPercent: number,
  aspectRatio: number,
  logoScalePercent: number,
  artworkHeightScalePercent: number
): { centerXmm: number; baseHeightMm: number; widthMm: number; heightMm: number } {
  const centerXmm = studioArtworkPositionFor(variant, size, positionPercent, 50).centerXmm;
  const baseHeightMm = studioLogoBaseHeightMmFor(variant, size, aspectRatio, logoScalePercent);
  return {
    centerXmm,
    baseHeightMm,
    widthMm: baseHeightMm * aspectRatio,
    heightMm: baseHeightMm * (Math.max(0, artworkHeightScalePercent) / 100),
  };
}

/** Horizontal slider limits that preserve a fixed artwork width. */
export function artworkHorizontalPositionRangePercentFor(
  variant: SleeveVariant,
  size: number,
  artworkWidthMm: number,
  currentPositionPercent: number
): { start: number; end: number } {
  const geometry = geometryFor(variant, size);
  const branding = brandingRegionFor(variant, size);
  const usableMinX = branding.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + PRODUCTION_BRANDING_INSET_MM;
  const usableMaxX = branding.rightEdgeXmm - PRODUCTION_BRANDING_INSET_MM;
  const current = Number.isFinite(currentPositionPercent) ? currentPositionPercent : usableBrandingCenterCanvasPercentFor(variant, size);
  const width = Number.isFinite(artworkWidthMm) ? Math.max(0, artworkWidthMm) : Infinity;
  const minCenterX = usableMinX + width / 2;
  const maxCenterX = usableMaxX - width / 2;
  if (maxCenterX < minCenterX) return { start: current, end: current };
  const canvasLength = geometry.overallMaxXmm - geometry.overallMinXmm;
  return {
    start: ((minCenterX - geometry.overallMinXmm) / canvasLength) * 100,
    end: ((maxCenterX - geometry.overallMinXmm) / canvasLength) * 100,
  };
}

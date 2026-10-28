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
/** The production CAD references expose the groove's right edge at -2.8 mm. */
export const APPROVED_CAD_GROOVE_RIGHT_EDGE_X_MM = -2.8;
/** Python production insets the CAD-derived branding face by 1.05 mm. */
export const PRODUCTION_BRANDING_INSET_MM = 1.05;
export const CAD_BODY_HEIGHT_MM = 3.26;
export const MINIMUM_CHANNEL_MM = 66.675;
export const SUPPORT_STYLE = "separate full-width PLA support, 0.200 mm cavity-side clearance";

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
function halfWidthAt(variant: SleeveVariant, x: number): number {
  if (variant === "standard") return STANDARD_HALF_WIDTH_MM;
  return STANDARD_HALF_WIDTH_MM + billboardBowOffset(x);
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
  height: number
): string {
  const bounds = surfaceBounds(variant, size);
  if (variant === "standard") {
    return `M 0 0 H ${width} V ${height} H 0 Z`;
  }

  const stepMm = 0.25;
  const xs: number[] = [bounds.minX];
  for (let x = bounds.minX + stepMm; x < bounds.maxX; x += stepMm) xs.push(x);
  xs.push(bounds.maxX);
  const upper: [number, number][] = [];
  for (const x of xs) {
    upper.push(toCanvas(x, halfWidthAt(variant, x), bounds, width, height));
  }
  const lower: [number, number][] = [];
  for (const x of [...xs].reverse()) {
    lower.push(toCanvas(x, -halfWidthAt(variant, x), bounds, width, height));
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
  edgeMarginMm = BRANDING_EDGE_CLEARANCE_MM
): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return 0;
  const geometry = geometryFor(variant, size);
  const bounds = surfaceBounds(variant, size);
  const groove = brandingRegionFor(variant, size).grooveXmm;
  const grooveMin = groove - BRANDING_GROOVE_WIDTH_MM / 2;
  const grooveMax = groove + BRANDING_GROOVE_WIDTH_MM / 2;
  const xLimitMm = Math.max(0, bounds.maxX - bounds.minX - 2 * edgeMarginMm);
  const yLimitMm = Math.max(0, bounds.maxY - bounds.minY - 2 * edgeMarginMm);
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
      if (centerYmm + heightMm / 2 > halfWidth - edgeMarginMm) return false;
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

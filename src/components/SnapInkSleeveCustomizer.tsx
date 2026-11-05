import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useId,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import {
  BRANDING_GROOVE_WIDTH_MM,
  ARTWORK_VERTICAL_POSITION_MAX,
  ARTWORK_VERTICAL_POSITION_MIN,
  BRANDING_EDGE_CLEARANCE_MM,
  MAX_BOTTOM_ARTWORK_EXTENSION_MM,
  MAX_TOP_ARTWORK_EXTENSION_MM,
  GEOMETRY_VERSION,
  POSITIONING_VERSION,
  STUDIO_DESKTOP_SLEEVE_CALIBRATION_PX,
  STUDIO_DESKTOP_SLEEVE_VERTICAL_OFFSET_STAGE_PX,
  STUDIO_DESKTOP_SLEEVE_VERTICAL_SIZE_ADJUSTMENT_STAGE_PX,
  STUDIO_MOBILE_SLEEVE_RIGHT_EDGE_CALIBRATION,
  STUDIO_MOBILE_SLEEVE_TOP_EXPANSION_STAGE_PX,
  STUDIO_MOBILE_SLEEVE_TOP_EXPANSION_ADDITIONAL_STAGE_PX,
  SLEEVE_GEOMETRY,
  STUDIO_HAT_CAMERA_ZOOM_CONFIG,
  STUDIO_SLEEVE_PREVIEW_SCALE,
  brandingRegionFor,
  artworkBoundsStatusMm,
  artworkVerticalCenterRangeMm,
  brandingSurfacePath,
  artworkCenterYForPositionMm,
  cadXToCanvasX,
  geometryFor,
  maximumContainedLogoHeightMm,
  nonPrintableGroovePath,
  sleeveGrooveFractionFor,
  surfaceBounds,
  studioArtworkPositionFor,
  usableBrandingAlignmentCanvasPercentFor,
  usableBrandingCanvasRangePercentFor,
  usableBrandingCenterCanvasPercentFor,
  type SleeveVariant,
} from "../config/sleeveGeometry";
import {
  DESKTOP_REAR_OPENING_RIGHT_EDGE_PX,
  HAT_TEMPLATE_REGISTRY,
  getHatTemplate,
  type HatTemplateImageProfile,
  type HatTemplateId,
} from "../config/hatTemplateRegistry";
import PACKAGING_PRODUCT_PHOTO from "../config/packagingProductPhoto.json";
import DESK_PRODUCT_PHOTO_CALIBRATION from "../config/deskProductPhotoCalibration.json";
import STANDARD_DESK_PRODUCT_PHOTO_CALIBRATION from "../config/standardDeskProductPhotoCalibration.json";
import { createProductPhotoZip } from "../utils/productPhotoZip";

const CITY_LIFESTYLE_BACKGROUND_PATHS = {
  desktop: "/images/product_images/desktop_lifesttyle_city.png",
  mobile: "/images/product_images/nobile_lifestyle_city.png",
} as const;
const SLEEVE_CHARACTER_LIMITS = [8, 8, 10, 10, 12, 14] as const;

function hatForegroundImagePath(templateId: HatTemplateId, mobile: boolean) {
  const color = templateId.replace(/^hat-/, "");
  return `/images/hat_templates/experimental/hat-${color}-${mobile ? "mobile" : "desktop"}-transparent.png`;
}

async function inspectTransparency(file: Blob): Promise<boolean> {
  // Some browser SVG decoders do not support createImageBitmap for SVG files.
  // Inspect clean local vector structure first so a transparent SVG never gets
  // sent through AI background removal merely because of decoder limitations.
  if (file.type === "image/svg+xml" || ("name" in file && String(file.name).toLowerCase().endsWith(".svg"))) {
    const source = await file.text();
    if (source.length > 2_000_000 || /<!\s*(doctype|entity)|<\s*(script|foreignObject|image|use)\b|javascript:|url\s*\(/i.test(source)) return false;
    const documentSvg = new DOMParser().parseFromString(source, "image/svg+xml");
    const root = documentSvg.documentElement;
    if (root.localName !== "svg" || documentSvg.querySelector("parsererror") || root.hasAttribute("style")) return false;
    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (!viewBox || viewBox.length !== 4 || viewBox.some((part) => !Number.isFinite(part)) || viewBox[2] <= 0 || viewBox[3] <= 0) return false;
    const elements = Array.from(root.children);
    if (!elements.length || elements.some((element) => element.hasAttribute("style") || element.hasAttribute("transform") || element.hasAttribute("opacity") || element.hasAttribute("fill-opacity"))) return false;
    const hasFullViewBoxRect = Array.from(root.querySelectorAll("rect")).some((rect) => {
      const x = Number(rect.getAttribute("x") || 0), y = Number(rect.getAttribute("y") || 0);
      const width = Number(rect.getAttribute("width")), height = Number(rect.getAttribute("height"));
      return Number.isFinite(width) && Number.isFinite(height) && x <= viewBox[0] && y <= viewBox[1]
        && x + width >= viewBox[0] + viewBox[2] && y + height >= viewBox[1] + viewBox[3]
        && rect.getAttribute("fill") !== "none";
    });
    return !hasFullViewBoxRect;
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) return true;
    }
    return false;
  } finally {
    bitmap.close();
  }
}

// ---------- Types ----------
export type SleeveDraft = {
  size: number;
  variant: SleeveVariant;
  text: string;
  font: string;
  fontSize: number;
  fontWeight: number;
  tracking: number;
  lineHeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  styleMode: "emboss" | "flat";
  arc: number;
  posX: number;
  posY: number;
  logoPosY: number;
  align: "start" | "center" | "end";
  safeMargin: number;
  bgType: "vector";
  backgroundColor: string;
  logoDataUrl?: string;
  logoName?: string;
  logoX: number;
  logoY: number;
  logoScale: number;
  artworkHeightScale: number;
  logoOpacity: number;
  productionGeometryVersion: string;
  positioningVersion: string;
  brandingCenterXmm: number;
  artworkCenterXmm: number;
  artworkCenterYmm: number;
  artworkWidthMm: number;
  artworkHeightMm: number;
  artworkExtensionMm: number;
  extendedArtwork: boolean;
  hasCustomArtwork: boolean;
};

export interface SnapInkSleeveCustomizerProps {
  width?: number;
  onChange?: (draft: SleeveDraft) => void;
  className?: string;
  initial?: Partial<SleeveDraft>;
  fixedProductConfiguration?: boolean;
  fixedArtworkColor?: string;
  forcedStyleMode?: "emboss" | "flat";
  enableProductPhotoGeneration?: boolean;
}

export interface SnapInkSleeveCustomizerRef {
  downloadPNG: () => void;
  getOrderFiles: () => Promise<{ artworkSvg: string; previewPng: string; emailPreviewPng: string; sourceArtwork: string }>;
}

function defaultArtworkYForViewport() {
  // New designs start centered; saved `initial.posY` values remain authoritative.
  return OFFICIAL_STUDIO_DEFAULTS.posY;
}

function defaultArtworkXForViewport(
  variant: SleeveVariant,
  size: number,
  alignment: "start" | "center" | "end" = "center"
) {
  return usableBrandingAlignmentCanvasPercentFor(variant, size, alignment);
}

// ---------- Fonts ----------
const WEB_SAFE_FONTS = [
  // --- HYPE / MUSIC / STREET ---
  { label: "Impact / Arial Black", stack: "Impact, Arial Black, system-ui, sans-serif" },
  { label: "Bebas Neue", stack: "'Bebas Neue', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Anton", stack: "'Anton', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "League Gothic", stack: "'League Gothic', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Staatliches", stack: "'Staatliches', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Black Ops One", stack: "'Black Ops One', Impact, 'Arial Black', system-ui, sans-serif" },

  // --- MODERN BRAND TEXT ---
  { label: "Montserrat", stack: "'Montserrat', system-ui, sans-serif" },
  { label: "Open Sans", stack: "'Open Sans', system-ui, sans-serif" },
  { label: "Raleway", stack: "'Raleway', system-ui, sans-serif" },
  { label: "Sawarabi Gothic", stack: "'Sawarabi Gothic', system-ui, sans-serif" },

  // --- EMOTIONAL / POSITIVE ---
  { label: "Poppins", stack: "'Poppins', system-ui, sans-serif" },

  // --- LUXURY / FASHION SERIF ---
  { label: "Playfair Display", stack: "'Playfair Display', serif" },
  { label: "Cinzel Decorative", stack: "'Cinzel Decorative', serif" },
  { label: "Prata", stack: "'Prata', serif" },

  // --- TRUE CURSIVE FONTS ---
  { label: "Great Vibes", stack: "'Great Vibes', cursive" },
  { label: "Pacifico", stack: "'Pacifico', cursive" },
  { label: "Tangerine", stack: "'Tangerine', cursive" },
  { label: "Hurricane", stack: "'Hurricane', cursive" },

  // NEW — High-quality cursive additions
  { label: "Petemoss", stack: "'Petemoss', cursive" },
  { label: "Ms Madi", stack: "'Ms Madi', cursive" },
  { label: "Kristi", stack: "'Kristi', cursive" },
  { label: "Clicker Script", stack: "'Clicker Script', cursive" },
  { label: "Delius Swash Caps", stack: "'Delius Swash Caps', cursive" },
  { label: "Norican", stack: "'Norican', cursive" },
];

const STUDIO_DEFAULT_ARTWORK_SCALE_PERCENT = 75;

const OFFICIAL_STUDIO_DEFAULTS: Pick<
  SleeveDraft,
  | "size" | "variant" | "text" | "font" | "fontSize" | "fontWeight"
  | "tracking" | "lineHeight" | "fill" | "stroke" | "strokeWidth"
  | "styleMode" | "arc" | "posX" | "posY" | "logoPosY" | "align" | "safeMargin"
  | "bgType" | "backgroundColor" | "logoX" | "logoY" | "logoScale" | "logoOpacity"
> = {
  size: 2,
  variant: "billboard",
  text: "",
  font: WEB_SAFE_FONTS.find((item) => item.label === "Bebas Neue")!.stack,
  fontSize: Math.round(396 * (STUDIO_DEFAULT_ARTWORK_SCALE_PERCENT / 100)),
  fontWeight: 300,
  tracking: 0,
  lineHeight: 1,
  fill: "#FFFFFF",
  stroke: "#000000",
  strokeWidth: 0,
  styleMode: "emboss",
  arc: 0,
  posX: usableBrandingCenterCanvasPercentFor("billboard", 2),
  posY: 50,
  logoPosY: 50,
  align: "center",
  safeMargin: 6,
  bgType: "vector",
  backgroundColor: "#000000",
  logoX: studioArtworkPositionFor(
    "billboard",
    2,
    usableBrandingCenterCanvasPercentFor("billboard", 2),
    50
  ).logoX,
  logoY: 50,
  logoScale: STUDIO_DEFAULT_ARTWORK_SCALE_PERCENT,
  logoOpacity: 100,
};

// ---------- Color Swatches ----------
const COLOR_SWATCHES = [
  { label: "Black", value: "#000000" },
  { label: "Cool Grey", value: "#90999D" },
  { label: "White", value: "#FFFFFF" },
  { label: "Deep Red", value: "#D7021C" },
  { label: "Soft Pink", value: "#FFBDD1" },
  { label: "Brown / Tan", value: "#A47C48" },
  { label: "Orange", value: "#FFA11D" },
  { label: "Yellow", value: "#FFDF03" },
  { label: "Bright Blue", value: "#0378D0" },
  { label: "Navy Blue", value: "#274E96" },
  { label: "Purple", value: "#8B69CE" },
  { label: "Green", value: "#00EB75" },
  { label: "Neon Red", value: "#FF073A" },
  { label: "Neon Green", value: "#39FF14" },
];

const HAT_COLOR_SWATCHES: Readonly<Record<HatTemplateId, string>> = {
  "hat-black": "#191919",
  "hat-white": "#F5F5F2",
  "hat-red": "#D31527",
  "hat-blue": "#1759A8",
  "hat-green": "#237943",
  "hat-yellow": "#E5C51A",
  "hat-neon-yellow": "#DFFF00",
  "hat-orange": "#F07816",
  "hat-pink": "#E987AA",
  "hat-purple": "#7541A5",
};

// Photo previews use the approved product photos. These crop bounds remove
// transparent canvas only; the source files themselves stay untouched. The
// face polygons follow the visible branding panels in those images.
const SLEEVE_PHOTO = {
  billboard: {
    src: "/images/website_images/blank_billboard_sleeve_matte.png",
    sourceWidth: 1774,
    sourceHeight: 887,
    crop: { x: 96, y: 250, width: 1583, height: 388 },
    face: [[263, 270], [1677, 257], [1678, 620], [263, 630]],
  },
  standard: {
    src: "/images/website_images/blank_standard_sleeve.png",
    sourceWidth: 2027,
    sourceHeight: 776,
    crop: { x: 237, y: 176, width: 1553, height: 421 },
    face: [[445, 183], [1786, 183], [1786, 590], [445, 590]],
  },
} as const;

const MOBILE_STAGE_WIDTH_HEIGHT_RATIO = 9 / 16;
const STUDIO_STAGE_COORDINATE_WIDTH = 1000;
const MOBILE_PHOTO_TEXT_NUDGE_X_PX = 11;
const MOBILE_PHOTO_TEXT_NUDGE_Y_PX = 13;
// Visual preview only; matches the approved raised artwork reference height.
const STUDIO_EMBOSSED_PREVIEW_RELIEF_MM = 0.8;
// Render-only extrusion: stacked SVG copies create visible sidewalls without
// changing artwork dimensions or the relief value used in draft/order data.
const STUDIO_EMBOSSED_PREVIEW_EXTRUSION_MM = 1.35;
const STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS = 16;
// Natural-image pixel bounds for the download-only upper hat through nose crop.
const STUDIO_PNG_EXPORT_CROP_NATURAL_PX = {
  desktop: { top: 0, bottom: 700 },
  mobile: { top: 24, bottom: 1100 },
} as const;
// Calibrated against snapink_billboard_blank_rear_test_v5.png. The groove is
// the primary anchor; matching it to the left strap exit and the sleeve's
// right end to the right strap opening determines a uniform scale.
const REAR_PRODUCT_PHOTO = {
  hatSrc: "/images/product_images/snapink_hat_rear_master.webp",
  width: 911,
  height: 1024,
  grooveSourceX: 465,
  studioExportWidth: 4222,
  leftStrapExitX: 260,
  rightStrapOpeningX: 716,
  sleeveCenterY: 716.5,
  scale: 4,
} as const;
const BILLBOARD_ON_DESK_PRODUCT_PHOTO = {
  masterSrc: DESK_PRODUCT_PHOTO_CALIBRATION.masterImage,
  width: DESK_PRODUCT_PHOTO_CALIBRATION.masterDimensions.width,
  height: DESK_PRODUCT_PHOTO_CALIBRATION.masterDimensions.height,
  printableFace: DESK_PRODUCT_PHOTO_CALIBRATION.printableFace,
  calibration: DESK_PRODUCT_PHOTO_CALIBRATION.candidates.find((candidate) => candidate.id === "08")!,
} as const;
const STANDARD_ON_DESK_PRODUCT_PHOTO = {
  masterSrc: STANDARD_DESK_PRODUCT_PHOTO_CALIBRATION.masterImage,
  width: STANDARD_DESK_PRODUCT_PHOTO_CALIBRATION.masterDimensions.width,
  height: STANDARD_DESK_PRODUCT_PHOTO_CALIBRATION.masterDimensions.height,
  printableFace: STANDARD_DESK_PRODUCT_PHOTO_CALIBRATION.printableFace,
  calibration: STANDARD_DESK_PRODUCT_PHOTO_CALIBRATION.candidates.find((candidate) => candidate.id === "01")!,
} as const;
const onDeskProductPhotoFor = (variant: SleeveVariant) =>
  variant === "standard" ? STANDARD_ON_DESK_PRODUCT_PHOTO : BILLBOARD_ON_DESK_PRODUCT_PHOTO;
const DESKTOP_SLEEVE_PREVIEW_BOUNDARY_ADJUSTMENTS_STAGE_PX: Record<
  SleeveVariant,
  { rightEdgeInset: number; alignRightToHatEdge: boolean; heightReduction: number; verticalShift: number }
> = {
  billboard: { rightEdgeInset: 0, alignRightToHatEdge: true, heightReduction: 0, verticalShift: -2 },
  standard: { rightEdgeInset: 0, alignRightToHatEdge: true, heightReduction: 20, verticalShift: 0 },
};

/**
 * Camera framing is derived from the approved CAD lengths. A shorter sleeve
 * receives a closer camera view; size 5 uses the widest framing. The hat and
 * sleeve are transformed together around the registry's closure anchor.
 */
export function studioHatZoomForSize(size: number, variant: SleeveVariant, mobile = false): number {
  if (!Number.isInteger(size) || size < 0 || size > 5) throw new RangeError(`Unsupported SnapInk sleeve size: ${size}`);
  return mobile
    ? STUDIO_HAT_CAMERA_ZOOM_CONFIG.mobile[variant][size]
    : STUDIO_HAT_CAMERA_ZOOM_CONFIG.desktop[variant][size];
}

function hatComposition(
  template: HatTemplateImageProfile,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth = template.imageDimensions.width,
  naturalHeight = template.imageDimensions.height
) {
  const fitScale = Math.min(canvasWidth / naturalWidth, canvasHeight / naturalHeight);
  const drawnWidth = naturalWidth * fitScale;
  const drawnHeight = naturalHeight * fitScale;
  const left = (canvasWidth - drawnWidth) / 2;
  const top = (canvasHeight - drawnHeight) / 2;
  const scaleX = (naturalWidth / template.imageDimensions.width) * fitScale;
  const scaleY = (naturalHeight / template.imageDimensions.height) * fitScale;
  const map = ([x, y]: readonly [number, number]) => [left + x * scaleX, top + y * scaleY] as const;
  const placement = template.sleevePlacement;
  const [grooveTop, grooveBottom] = placement.grooveLinePx.map(map);
  const [strapCenterTop, strapCenterBottom] = placement.strapCenterlinePx.map(map);
  const [strapTopLeft, strapTopRight, strapBottomRight, strapBottomLeft] = [
    placement.femaleStrapQuadPx.topLeft,
    placement.femaleStrapQuadPx.topRight,
    placement.femaleStrapQuadPx.bottomRight,
    placement.femaleStrapQuadPx.bottomLeft,
  ].map(map);
  const sleeveBounds = {
    left: left + placement.sleeveBoundsPx.left * scaleX,
    top: top + placement.sleeveBoundsPx.top * scaleY,
    right: left + placement.sleeveBoundsPx.right * scaleX,
    bottom: top + placement.sleeveBoundsPx.bottom * scaleY,
  };
  // Keep the registry's normalized sleeve scale authoritative for the image
  // calibration instead of deriving a second height adjustment in Studio.
  const calibratedSleeveHeight = placement.uniformScale * template.imageDimensions.height * fitScale;
  sleeveBounds.bottom = sleeveBounds.top + calibratedSleeveHeight;
  const grooveX = (grooveTop[0] + grooveBottom[0]) / 2;
  const grooveY = (grooveTop[1] + grooveBottom[1]) / 2;
  const strapTop = (strapTopLeft[1] + strapTopRight[1]) / 2;
  const strapBottom = (strapBottomLeft[1] + strapBottomRight[1]) / 2;
  const strapRight = (strapTopRight[0] + strapBottomRight[0]) / 2;
  const rearOpeningRight = template.imageDimensions.width === 1447
    ? left + DESKTOP_REAR_OPENING_RIGHT_EDGE_PX * scaleX
    : strapRight;
  const strapCenterY = (strapCenterTop[1] + strapCenterBottom[1]) / 2;
  const strapThicknessPx = placement.strapThicknessPx * scaleY;
  return {
    template, fitScale, drawnWidth, drawnHeight, left, top,
    strapTop, strapBottom, strapRight, rearOpeningRight, strapCenterY, strapThicknessPx, grooveX, grooveY, sleeveBounds,
    rotationDeg: placement.rotationDeg,
    grooveScaleX: scaleX,
    grooveScaleY: scaleY,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function loadStudioImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A Photo Studio preview image could not be loaded."));
    image.src = src;
  });
}

function drawImageContained(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function drawStudioComposition(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sleeve: HTMLImageElement,
  ghostHat: HTMLImageElement | null,
  sleeveWidthPercent: number,
  sleeveHeightPercent: number,
  template: HatTemplateImageProfile,
  cameraZoom: number,
  sleeveGrooveFraction: number,
  sleeveRotationDeg: number,
  sleeveCenterXPercent: number,
  sleeveBottomYPercent: number,
  preserveDesktopGrooveAnchor: boolean,
  lifestyleBackground: HTMLImageElement | null = null,
  stageVerticalOffset = 0,
  hasExtendedArtworkMargin = false
) {
  if (!ghostHat) {
    context.drawImage(sleeve, 0, 0, canvas.width, canvas.height);
    return;
  }

  const composition = hatComposition(template, canvas.width, canvas.height, ghostHat.naturalWidth, ghostHat.naturalHeight);
  context.save();
  context.translate(0, stageVerticalOffset);
  context.translate(composition.grooveX, composition.grooveY);
  context.scale(cameraZoom, cameraZoom);
  context.translate(-composition.grooveX, -composition.grooveY);
  if (lifestyleBackground) {
    drawImageContained(context, lifestyleBackground, canvas.width, canvas.height);
  }
  context.drawImage(ghostHat, composition.left, composition.top, composition.drawnWidth, composition.drawnHeight);
  const sleeveWidth = canvas.width * sleeveWidthPercent / 100;
  const sleeveHeight = canvas.height * sleeveHeightPercent / 100;
  const sleeveCenterX = canvas.width * sleeveCenterXPercent / 100;
  const sleeveCenterY = canvas.height * sleeveBottomYPercent / 100 - sleeveHeight / 2;
  context.save();
  context.translate(sleeveCenterX + sleeveWidth * (sleeveGrooveFraction - 0.5), sleeveCenterY);
  context.rotate(sleeveRotationDeg * Math.PI / 180);
  const topExtensionPixels = hasExtendedArtworkMargin ? sleeveWidth * MAX_TOP_ARTWORK_EXTENSION_MM / overallLengthMm : 0;
  const bottomExtensionPixels = hasExtendedArtworkMargin ? sleeveWidth * MAX_BOTTOM_ARTWORK_EXTENSION_MM / overallLengthMm : 0;
  context.drawImage(
    sleeve,
    preserveDesktopGrooveAnchor ? -sleeveWidth * sleeveGrooveFraction : -sleeveWidth / 2,
    -sleeveHeight / 2 - topExtensionPixels,
    sleeveWidth,
    sleeveHeight + topExtensionPixels + bottomExtensionPixels
  );
  context.restore();
  context.restore();
}

// ---------- Component ----------
const SnapInkSleeveCustomizer = forwardRef<
  SnapInkSleeveCustomizerRef,
  SnapInkSleeveCustomizerProps
>(function SnapInkSleeveCustomizer(
  { width = 1400, onChange, className = "", initial = {}, fixedProductConfiguration = false, fixedArtworkColor, forcedStyleMode, enableProductPhotoGeneration = false },
  ref
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mobileStageRef = useRef<HTMLDivElement | null>(null);
  const [mobileStageWidth, setMobileStageWidth] = useState(0);
  const [stageClientWidth, setStageClientWidth] = useState(() =>
    typeof window !== "undefined" && window.innerWidth <= 640
      ? Math.max(1, window.innerWidth - 92)
      : 1000
  );
  const [isMobilePreview, setIsMobilePreview] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
  );
  const attachStageRef = useCallback((stage: HTMLDivElement | null) => {
    stageRef.current = stage;
    if (stage) setStageClientWidth(stage.clientWidth || 1000);
  }, []);
  const attachMobileStageRef = useCallback((stage: HTMLDivElement | null) => {
    mobileStageRef.current = stage;
    if (stage) setMobileStageWidth(stage.clientWidth);
  }, []);
  const uid = useId();
  const ghostId = `ghost-${uid.replace(/:/g, "")}`;

  // State
  const [text, setText] = useState(initial.text ?? OFFICIAL_STUDIO_DEFAULTS.text);
  const [font, setFont] = useState(initial.font ?? OFFICIAL_STUDIO_DEFAULTS.font);
  const [fontSize, setFontSize] = useState(initial.fontSize ?? OFFICIAL_STUDIO_DEFAULTS.fontSize);
  const [fontWeight, setFontWeight] = useState(initial.fontWeight ?? OFFICIAL_STUDIO_DEFAULTS.fontWeight);
  const [tracking, setTracking] = useState(initial.tracking ?? OFFICIAL_STUDIO_DEFAULTS.tracking);
  const [lineHeight, setLineHeight] = useState(initial.lineHeight ?? OFFICIAL_STUDIO_DEFAULTS.lineHeight);
  const [fill, setFill] = useState(initial.fill ?? OFFICIAL_STUDIO_DEFAULTS.fill);
  const [stroke, setStroke] = useState(initial.stroke ?? OFFICIAL_STUDIO_DEFAULTS.stroke);
  const [strokeWidth, setStrokeWidth] = useState(initial.strokeWidth ?? OFFICIAL_STUDIO_DEFAULTS.strokeWidth);
  const [styleMode, setStyleMode] = useState<"emboss" | "flat">(
    initial.styleMode ?? OFFICIAL_STUDIO_DEFAULTS.styleMode
  );
  useEffect(() => { if (forcedStyleMode) setStyleMode(forcedStyleMode); }, [forcedStyleMode]);
  const [arc, setArc] = useState(initial.arc ?? OFFICIAL_STUDIO_DEFAULTS.arc);
  const initialVariant = initial.variant ?? OFFICIAL_STUDIO_DEFAULTS.variant;
  const initialSize = initial.size ?? OFFICIAL_STUDIO_DEFAULTS.size;
  const initialAlign = initial.align ?? OFFICIAL_STUDIO_DEFAULTS.align;
  const [posX, setPosX] = useState(initial.posX ?? defaultArtworkXForViewport(initialVariant, initialSize, initialAlign));
  const variantPosXRef = useRef<Partial<Record<SleeveVariant, number>> | null>(null);
  if (variantPosXRef.current === null) {
    variantPosXRef.current = initial.posX === undefined ? {} : { [initialVariant]: initial.posX };
  }
  const [posY, setPosY] = useState(initial.posY ?? defaultArtworkYForViewport());
  // Migrate earlier drafts that used the text vertical control for logo
  // placement, while keeping the logo's new position independently editable.
  const [logoPosY, setLogoPosY] = useState(initial.logoPosY ?? initial.posY ?? 50);
  const [isDraggingArtwork, setIsDraggingArtwork] = useState(false);
  const artworkDragRef = useRef<null | { pointerId: number; x: number; y: number; posX: number; centerYmm: number }>(null);
  const [align, setAlign] = useState<"start" | "center" | "end">(initialAlign);
  const [showGuides, setShowGuides] = useState(false);
  const [safeMargin, setSafeMargin] = useState(initial.safeMargin ?? OFFICIAL_STUDIO_DEFAULTS.safeMargin);
  const [backgroundColor, setBackgroundColor] = useState(
    initial.backgroundColor ?? OFFICIAL_STUDIO_DEFAULTS.backgroundColor
  );
  useEffect(() => { if (fixedArtworkColor && /^#[0-9A-Fa-f]{6}$/.test(fixedArtworkColor)) setFill(fixedArtworkColor); }, [fixedArtworkColor]);
  const [exportScale, setExportScale] = useState(2);
  const [isGeneratingProductImage, setIsGeneratingProductImage] = useState(false);
  type ProductPhotoKey = "rear" | "packaging" | "desk" | "maleLifestyle" | "femaleLifestyle";
  const productPhotoOptions: {key: ProductPhotoKey; label: string}[] = [{key:"rear",label:"On-Hat Product Image"},{key:"packaging",label:"Packaging Product Image"},{key:"desk",label:"On-Desk Product Image"},{key:"maleLifestyle",label:"Male Lifestyle Image"},{key:"femaleLifestyle",label:"Female Lifestyle Image"}];
  const [productPhotoChoice, setProductPhotoChoice] = useState<ProductPhotoKey[]>(() => { try { const v=JSON.parse(localStorage.getItem("snapink.productPhotoSelections.v1")||"null"); return Array.isArray(v)?v.filter((x):x is ProductPhotoKey=>["rear","packaging","desk","maleLifestyle","femaleLifestyle"].includes(x)): ["rear","packaging","desk"]; } catch { return ["rear","packaging","desk"]; } });
  const [lifestylePreview, setLifestylePreview] = useState<"maleLifestyle"|"femaleLifestyle">("maleLifestyle");
  const [lifestyleCalibration, setLifestyleCalibration] = useState(()=>{try{return JSON.parse(localStorage.getItem("snapink.lifestyleCalibration.v1")||"null")||{x:530,y:263,width:370,height:100,rotation:0,perspective:0};}catch{return{x:530,y:263,width:370,height:100,rotation:0,perspective:0};}});
  const [lifestyleLivePreview,setLifestyleLivePreview]=useState("");
  const [productPhotoProgress, setProductPhotoProgress] = useState("");
  const [generatedShopImages, setGeneratedShopImages] = useState<Record<string,Blob>|null>(null);
  const [generatedPhotoEntries,setGeneratedPhotoEntries]=useState<{key:string;label:string;filename:string;blob:Blob}[]>([]);
  const [shopImageSelection,setShopImageSelection]=useState<string[]>([]);
  const generatedPreviewUrls=useMemo(()=>generatedPhotoEntries.map(entry=>({key:entry.key,url:URL.createObjectURL(entry.blob)})),[generatedPhotoEntries]);
  useEffect(()=>()=>generatedPreviewUrls.forEach(item=>URL.revokeObjectURL(item.url)),[generatedPreviewUrls]);
  const [generatedShopImageSignature, setGeneratedShopImageSignature] = useState("");
  const lifestylePreviewSignature=JSON.stringify({design:shopImageDesignSignature(),lifestylePreview,lifestyleCalibration});
  useEffect(()=>{let active=true;let objectUrl="";(async()=>{try{const sleeve=await renderStudioPNGBlob({sleeveOnly:true,artworkOnly:true,scale:REAR_PRODUCT_PHOTO.scale});const sleeveUrl=URL.createObjectURL(sleeve);try{const image=await loadStudioImage(sleeveUrl);const result=await renderLifestyleProductPhoto(lifestylePreview,image);if(active){objectUrl=URL.createObjectURL(result);setLifestyleLivePreview(objectUrl);}}finally{URL.revokeObjectURL(sleeveUrl);}}catch{}})();return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[lifestylePreviewSignature]);
  const [studioAdminToken, setStudioAdminToken] = useState("");
  const [showPublishProduct, setShowPublishProduct] = useState(false);
  const [publishProductName, setPublishProductName] = useState("");
  const [publishProductCardDescription, setPublishProductCardDescription] = useState("");
  const [publishProductDescription, setPublishProductDescription] = useState("");
  const [approveExtendedArtwork, setApproveExtendedArtwork] = useState(false);
  const [publishProductStatus, setPublishProductStatus] = useState("");
  const [publishingProduct, setPublishingProduct] = useState(false);
  const [showArtworkTransparencyWarning, setShowArtworkTransparencyWarning] = useState(() => {
    try {
      return window.localStorage.getItem("snapink.artworkTransparencyWarning.dismissed.v1") !== "true";
    } catch {
      return true;
    }
  });
  const [logoDataUrl, setLogoDataUrl] = useState(initial.logoDataUrl ?? "");
  const [logoAspectRatio, setLogoAspectRatio] = useState(1);
  const [logoSourceAspectRatio, setLogoSourceAspectRatio] = useState(1);
  const [logoVisibleBounds, setLogoVisibleBounds] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [logoAlphaProfile, setLogoAlphaProfile] = useState<Array<{ x: number; top: number; bottom: number }>>([]);
  const [logoName, setLogoName] = useState(initial.logoName ?? "");
  const [logoInputVersion, setLogoInputVersion] = useState(0);
  const mobileLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoNeedsRemoval, setLogoNeedsRemoval] = useState(false);
  const [logoHasProcessedRemoval, setLogoHasProcessedRemoval] = useState(false);
  const [logoRemovalBusy, setLogoRemovalBusy] = useState(false);
  const [logoRemovalMessage, setLogoRemovalMessage] = useState("");
  const [logoRemovalProgress, setLogoRemovalProgress] = useState(0);
  const [logoSourceFile, setLogoSourceFile] = useState<File | null>(null);
  const logoUploadTaskRef = useRef(0);
  const measuredLogoDataUrlRef = useRef("");
  const logoRemovalLockRef = useRef(0);
  const [logoScale, setLogoScale] = useState(initial.logoScale ?? OFFICIAL_STUDIO_DEFAULTS.logoScale);
  const [artworkHeightScale, setArtworkHeightScale] = useState(initial.artworkHeightScale ?? 100);
  const [logoOpacity, setLogoOpacity] = useState(initial.logoOpacity ?? OFFICIAL_STUDIO_DEFAULTS.logoOpacity);
  const [variant, setVariant] = useState<SleeveVariant>(initial.variant ?? OFFICIAL_STUDIO_DEFAULTS.variant);

  // Mobile accordion
  const [mobileOpen, setMobileOpen] = useState<"text" | "logo" | "position" | "export">(
    "export"
  );
  const [toolbarAdvancedOpen, setToolbarAdvancedOpen] = useState(false);
  const [showExtendedArtworkInfo, setShowExtendedArtworkInfo] = useState(false);
  const [desktopCustomizationCollapsed, setDesktopCustomizationCollapsed] = useState(false);
  const [mobileEntryCollapsed, setMobileEntryCollapsed] = useState(Boolean(initial.logoDataUrl));
  const [ghostHat, setGhostHat] = useState(true);
  const [previewBackground, setPreviewBackground] = useState<"studio" | "city">("studio");
  const [sleeveSize, setSleeveSize] = useState(initial.size ?? OFFICIAL_STUDIO_DEFAULTS.size);
  const characterLimit = SLEEVE_CHARACTER_LIMITS[sleeveSize as 0 | 1 | 2 | 3 | 4 | 5];
  // The photographic preview is always rendered with Size 0 geometry.
  // `sleeveSize` remains the customer's actual production selection.
  const previewSleeveSize = 0;
  const [sizeConfirmation, setSizeConfirmation] = useState<number | null>(null);
  const sizeConfirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSizeConfirmationRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (sizeConfirmationTimerRef.current) clearTimeout(sizeConfirmationTimerRef.current);
  }, []);
  const [hatTemplateId, setHatTemplateId] = useState<HatTemplateId>("hat-black");
  const [hatColorPickerOpen, setHatColorPickerOpen] = useState(false);
  const [sizeExamplesOpen, setSizeExamplesOpen] = useState(false);
  const [hatNaturalSize, setHatNaturalSize] = useState({ src: "", width: 0, height: 0 });
  const [fitLightboxSize, setFitLightboxSize] = useState<number | null>(null);
  const [fitLightboxZoom, setFitLightboxZoom] = useState(1);
  const [fitLightboxPan, setFitLightboxPan] = useState({ x: 0, y: 0 });
  const fitLightboxOpen = fitLightboxSize !== null;
  const fitLightboxDialogRef = useRef<HTMLDivElement | null>(null);
  const fitLightboxRef = useRef<HTMLDivElement | null>(null);
  const fitLightboxImageRef = useRef<HTMLImageElement | null>(null);
  const fitLightboxCloseRef = useRef<HTMLButtonElement | null>(null);
  const fitLightboxPreviousFocusRef = useRef<HTMLElement | null>(null);
  const fitGestureRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    startX: number;
    startY: number;
    startZoom: number;
    startPan: { x: number; y: number };
    startDistance: number;
    pinching: boolean;
  }>({ pointers: new Map(), startX: 0, startY: 0, startZoom: 1, startPan: { x: 0, y: 0 }, startDistance: 0, pinching: false });

  useEffect(() => {
    if (!hatColorPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".snapink-hat-picker")) return;
      setHatColorPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHatColorPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [hatColorPickerOpen]);

  const navigateFitLightbox = useCallback((direction: -1 | 1) => {
    setFitLightboxSize((current) => current === null ? current : (current + direction + 6) % 6);
    setFitLightboxZoom(1);
    setFitLightboxPan({ x: 0, y: 0 });
    fitGestureRef.current.pointers.clear();
  }, []);

  useEffect(() => {
    if (!fitLightboxOpen) return;
    fitLightboxPreviousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fitLightboxCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setFitLightboxSize(null); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); navigateFitLightbox(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); navigateFitLightbox(1); }
      else if (event.key === "Tab") {
        const controls = fitLightboxDialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      fitGestureRef.current.pointers.clear();
      if (fitLightboxPreviousFocusRef.current?.isConnected) fitLightboxPreviousFocusRef.current.focus();
    };
  }, [fitLightboxOpen, navigateFitLightbox]);

  function beginFitGesture(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const gesture = fitGestureRef.current;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.pointers.size === 1) {
      gesture.startX = event.clientX;
      gesture.startY = event.clientY;
      gesture.startZoom = fitLightboxZoom;
      gesture.startPan = fitLightboxPan;
      gesture.pinching = false;
    } else if (gesture.pointers.size === 2) {
      const [a, b] = [...gesture.pointers.values()];
      gesture.startDistance = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.startZoom = fitLightboxZoom;
      gesture.startPan = fitLightboxPan;
      gesture.pinching = true;
    }
  }

  function moveFitGesture(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = fitGestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.pointers.size >= 2 && gesture.startDistance > 0) {
      const [a, b] = [...gesture.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const zoom = Math.min(4, Math.max(1, gesture.startZoom * distance / gesture.startDistance));
      setFitLightboxZoom(zoom);
      if (zoom <= 1) setFitLightboxPan({ x: 0, y: 0 });
      event.preventDefault();
    } else if (fitLightboxZoom > 1) {
      const image = fitLightboxImageRef.current;
      const viewport = fitLightboxRef.current;
      if (!image || !viewport) return;
      const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
      const maxX = Math.max(0, (image.offsetWidth * fitLightboxZoom - viewport.clientWidth) / 2);
      const maxY = Math.max(0, (image.offsetHeight * fitLightboxZoom - viewport.clientHeight) / 2);
      setFitLightboxPan({ x: Math.min(maxX, Math.max(-maxX, gesture.startPan.x + dx)), y: Math.min(maxY, Math.max(-maxY, gesture.startPan.y + dy)) });
      event.preventDefault();
    }
  }

  function endFitGesture(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = fitGestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size === 0) {
      const dx = event.clientX - gesture.startX;
      if (!gesture.pinching && fitLightboxZoom <= 1 && Math.abs(dx) >= 55) navigateFitLightbox(dx < 0 ? 1 : -1);
      gesture.pinching = false;
      gesture.startDistance = 0;
    } else if (gesture.pointers.size === 1) {
      const remaining = [...gesture.pointers.values()][0];
      gesture.startX = remaining.x;
      gesture.startY = remaining.y;
      gesture.startPan = fitLightboxPan;
      gesture.startZoom = fitLightboxZoom;
      gesture.pinching = false;
    }
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const updateViewport = () => setIsMobilePreview(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const stage = svgRef.current?.closest(".snapink-product-stage") as HTMLDivElement | null;
    if (!stage) return;
    const updateWidth = () => setStageClientWidth(stage.clientWidth || 1000);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(stage);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    const stage = mobileStageRef.current;
    if (!stage) return;
    const updateWidth = () => setMobileStageWidth(stage.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  function startNewDesign() {
    logoUploadTaskRef.current += 1;
    logoRemovalLockRef.current = 0;
    setText(OFFICIAL_STUDIO_DEFAULTS.text);
    setFont(OFFICIAL_STUDIO_DEFAULTS.font);
    setFontSize(OFFICIAL_STUDIO_DEFAULTS.fontSize);
    setFontWeight(OFFICIAL_STUDIO_DEFAULTS.fontWeight);
    setTracking(OFFICIAL_STUDIO_DEFAULTS.tracking);
    setLineHeight(OFFICIAL_STUDIO_DEFAULTS.lineHeight);
    setFill(OFFICIAL_STUDIO_DEFAULTS.fill);
    setStroke(OFFICIAL_STUDIO_DEFAULTS.stroke);
    setStrokeWidth(OFFICIAL_STUDIO_DEFAULTS.strokeWidth);
    setStyleMode(OFFICIAL_STUDIO_DEFAULTS.styleMode);
    setArc(OFFICIAL_STUDIO_DEFAULTS.arc);
    setPosX(defaultArtworkXForViewport(OFFICIAL_STUDIO_DEFAULTS.variant, OFFICIAL_STUDIO_DEFAULTS.size, OFFICIAL_STUDIO_DEFAULTS.align));
    setPosY(50);
    setLogoPosY(50);
    setAlign(OFFICIAL_STUDIO_DEFAULTS.align);
    setSafeMargin(OFFICIAL_STUDIO_DEFAULTS.safeMargin);
    setBackgroundColor(OFFICIAL_STUDIO_DEFAULTS.backgroundColor);
    setLogoDataUrl("");
    setLogoName("");
    setLogoSourceFile(null);
    setLogoNeedsRemoval(false);
    setLogoHasProcessedRemoval(false);
    setLogoRemovalBusy(false);
    setLogoRemovalProgress(0);
    setLogoRemovalMessage("");
    setLogoInputVersion((version) => version + 1);
    setLogoScale(OFFICIAL_STUDIO_DEFAULTS.logoScale);
    setLogoOpacity(OFFICIAL_STUDIO_DEFAULTS.logoOpacity);
    setVariant(OFFICIAL_STUDIO_DEFAULTS.variant);
    setSleeveSize(OFFICIAL_STUDIO_DEFAULTS.size);
    setGhostHat(true);
    setShowGuides(false);
  }

  // Normalize (tm)
  useEffect(() => {
    const normalized = text.replace(/\(tm\)/gi, "™");
    if (normalized !== text) setText(normalized);
  }, [text]);

  useEffect(() => {
    if (!logoDataUrl) {
      setLogoAspectRatio(1);
      setLogoSourceAspectRatio(1);
      setLogoVisibleBounds({ x: 0, y: 0, width: 1, height: 1 });
      setLogoAlphaProfile([]);
      return;
    }
    const uploadedImage = new Image();
    let active = true;
    uploadedImage.onload = () => {
      if (!active || uploadedImage.naturalWidth <= 0 || uploadedImage.naturalHeight <= 0) return;
      const imageWidth = uploadedImage.naturalWidth;
      const imageHeight = uploadedImage.naturalHeight;
      let visible = { x: 0, y: 0, width: imageWidth, height: imageHeight };
      const alphaColumnTop = new Int32Array(imageWidth).fill(imageHeight);
      const alphaColumnBottom = new Int32Array(imageWidth).fill(-1);
      try {
        // Use the source alpha at native resolution. A downsampled scan can
        // shift the visible bounds and therefore the CAD width used for checks.
        const tileSize = 1024;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          let minX = imageWidth;
          let minY = imageHeight;
          let maxX = -1;
          let maxY = -1;
          for (let tileY = 0; tileY < imageHeight; tileY += tileSize) {
            for (let tileX = 0; tileX < imageWidth; tileX += tileSize) {
              const tileWidth = Math.min(tileSize, imageWidth - tileX);
              const tileHeight = Math.min(tileSize, imageHeight - tileY);
              canvas.width = tileWidth;
              canvas.height = tileHeight;
              context.drawImage(uploadedImage, tileX, tileY, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
              const pixels = context.getImageData(0, 0, tileWidth, tileHeight).data;
              for (let y = 0; y < tileHeight; y += 1) {
                for (let x = 0; x < tileWidth; x += 1) {
                  if (pixels[(y * tileWidth + x) * 4 + 3] === 0) continue;
                  const sourceX = tileX + x;
                  const sourceY = tileY + y;
                  minX = Math.min(minX, sourceX);
                  minY = Math.min(minY, sourceY);
                  maxX = Math.max(maxX, sourceX);
                  maxY = Math.max(maxY, sourceY);
                  alphaColumnTop[sourceX] = Math.min(alphaColumnTop[sourceX], sourceY);
                  alphaColumnBottom[sourceX] = Math.max(alphaColumnBottom[sourceX], sourceY);
                }
              }
            }
          }
          if (maxX >= minX && maxY >= minY) {
            visible = {
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            };
          }
        }
      } catch {
        // Keep the full image canvas as the visible area if alpha inspection is unavailable.
      }
      if (!active) return;
      const cropX = Math.max(0, Math.floor(visible.x));
      const cropY = Math.max(0, Math.floor(visible.y));
      const cropRight = Math.min(imageWidth, Math.ceil(visible.x + visible.width));
      const cropBottom = Math.min(imageHeight, Math.ceil(visible.y + visible.height));
      const cropWidth = cropRight - cropX;
      const cropHeight = cropBottom - cropY;
      const alphaProfile = Array.from({ length: Math.max(0, cropWidth) }, (_, index) => {
        const sourceX = cropX + index;
        const top = alphaColumnTop[sourceX];
        const bottom = alphaColumnBottom[sourceX];
        if (bottom < top) return null;
        return {
          x: (index + 0.5) / cropWidth,
          top: (top - cropY) / cropHeight,
          bottom: (bottom - cropY + 1) / cropHeight,
        };
      }).filter((point): point is { x: number; top: number; bottom: number } => point !== null);
      setLogoAlphaProfile(alphaProfile);

      // Trim transparent padding once when the logo is loaded. The resulting data URL
      // is shared by the editor, saved draft, preview, and PNG export.
      if (cropWidth > 0 && cropHeight > 0 && (cropX > 0 || cropY > 0 || cropWidth < imageWidth || cropHeight < imageHeight)) {
        const croppedCanvas = document.createElement("canvas");
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        const croppedContext = croppedCanvas.getContext("2d");
        if (croppedContext) {
          croppedContext.drawImage(uploadedImage, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
          try {
            const trimmedDataUrl = croppedCanvas.toDataURL("image/png");
            setLogoVisibleBounds({ x: 0, y: 0, width: 1, height: 1 });
            setLogoAspectRatio(cropWidth / cropHeight);
            setLogoSourceAspectRatio(cropWidth / cropHeight);
            setLogoDataUrl(trimmedDataUrl);
            return;
          } catch {
            // Keep the original upload if the browser cannot encode the cropped image.
          }
        }
      }
      const bounds = {
        x: visible.x / imageWidth,
        y: visible.y / imageHeight,
        width: visible.width / imageWidth,
        height: visible.height / imageHeight,
      };
      setLogoVisibleBounds(bounds);
      setLogoAspectRatio(visible.width / visible.height);
      setLogoSourceAspectRatio(imageWidth / imageHeight);
      measuredLogoDataUrlRef.current = logoDataUrl;
    };
    uploadedImage.src = logoDataUrl;
    return () => { active = false; };
  }, [logoDataUrl]);

  const draftCanvasX = text.trim() || logoDataUrl
    ? posX
    : usableBrandingCenterCanvasPercentFor(variant, sleeveSize);
  const productionBrandingRegion = brandingRegionFor(variant, sleeveSize);

  useEffect(() => {
    const pendingSize = pendingSizeConfirmationRef.current;
    if (isMobilePreview || pendingSize === null || pendingSize !== sleeveSize) return;
    pendingSizeConfirmationRef.current = null;
    setSizeConfirmation(pendingSize);
    if (sizeConfirmationTimerRef.current) clearTimeout(sizeConfirmationTimerRef.current);
    sizeConfirmationTimerRef.current = setTimeout(() => {
      setSizeConfirmation(null);
      sizeConfirmationTimerRef.current = null;
    }, 2000);
  }, [sleeveSize, isMobilePreview]);

  const viewW = 1600;
  // All photographic preview artwork and sleeve coordinates use the fixed
  // Size 0 visual reference. Production draft calculations above continue to
  // use the customer's actual `sleeveSize` selection.
  const renderGeometrySize = previewSleeveSize;
  const activeGeometry = geometryFor(variant, renderGeometrySize);
  const bounds = surfaceBounds(variant, renderGeometrySize);
  const brandingRegion = brandingRegionFor(variant, renderGeometrySize);
  const previewBounds = surfaceBounds(variant, previewSleeveSize);
  const previewSleeveViewH = viewW * ((previewBounds.maxY - previewBounds.minY) / (previewBounds.maxX - previewBounds.minX));
  const viewH = viewW * ((bounds.maxY - bounds.minY) / (bounds.maxX - bounds.minX));
  const sleevePhoto = SLEEVE_PHOTO[variant];
  const photoScale = viewW / sleevePhoto.crop.width;
  const previewViewH = sleevePhoto.crop.height * photoScale;
  const photoImageScaleY = viewH / previewViewH;
  const photoPoint = (point: readonly [number, number]) => [
    (point[0] - sleevePhoto.crop.x) * photoScale,
    (point[1] - sleevePhoto.crop.y) * photoScale * photoImageScaleY,
  ] as const;
  const photoFacePoints = sleevePhoto.face.map(photoPoint);
  const photoFaceExtensionRatio = MAX_TOP_ARTWORK_EXTENSION_MM / (bounds.maxY - bounds.minY);
  const extendedPhotoTopLeft: [number, number] = [
    photoFacePoints[0][0] + (photoFacePoints[0][0] - photoFacePoints[3][0]) * photoFaceExtensionRatio,
    photoFacePoints[0][1] + (photoFacePoints[0][1] - photoFacePoints[3][1]) * photoFaceExtensionRatio,
  ];
  const extendedPhotoTopRight: [number, number] = [
    photoFacePoints[1][0] + (photoFacePoints[1][0] - photoFacePoints[2][0]) * photoFaceExtensionRatio,
    photoFacePoints[1][1] + (photoFacePoints[1][1] - photoFacePoints[2][1]) * photoFaceExtensionRatio,
  ];
  const photoFaceBottomExtensionRatio = MAX_BOTTOM_ARTWORK_EXTENSION_MM / (bounds.maxY - bounds.minY);
  const extendedPhotoBottomRight: [number, number] = [
    photoFacePoints[2][0] + (photoFacePoints[2][0] - photoFacePoints[1][0]) * photoFaceBottomExtensionRatio,
    photoFacePoints[2][1] + (photoFacePoints[2][1] - photoFacePoints[1][1]) * photoFaceBottomExtensionRatio,
  ];
  const extendedPhotoBottomLeft: [number, number] = [
    photoFacePoints[3][0] + (photoFacePoints[3][0] - photoFacePoints[0][0]) * photoFaceBottomExtensionRatio,
    photoFacePoints[3][1] + (photoFacePoints[3][1] - photoFacePoints[0][1]) * photoFaceBottomExtensionRatio,
  ];
  const extendedPhotoArtworkClipPath = `M ${extendedPhotoTopLeft[0]} ${extendedPhotoTopLeft[1]} L ${extendedPhotoTopRight[0]} ${extendedPhotoTopRight[1]} L ${photoFacePoints[1][0]} ${photoFacePoints[1][1]} L ${extendedPhotoBottomRight[0]} ${extendedPhotoBottomRight[1]} L ${extendedPhotoBottomLeft[0]} ${extendedPhotoBottomLeft[1]} L ${photoFacePoints[3][0]} ${photoFacePoints[3][1]} Z`;
  const photoFacePath = variant === "billboard"
    ? (() => {
      const [[leftTopX, leftTopY], [rightTopX, rightTopY], [rightBottomX, rightBottomY], [leftBottomX, leftBottomY]] = photoFacePoints;
      // Follow the hat opening's slight inward curve at the Billboard free end.
      // This only crops the preview image; CAD dimensions and Standard stay intact.
      const inset = (rightTopX - leftTopX) * 0.0045;
      return `M ${leftTopX.toFixed(2)} ${leftTopY.toFixed(2)} L ${rightTopX.toFixed(2)} ${rightTopY.toFixed(2)} C ${(rightTopX - inset).toFixed(2)} ${(rightTopY + (rightBottomY - rightTopY) * 0.28).toFixed(2)} ${(rightBottomX - inset).toFixed(2)} ${(rightTopY + (rightBottomY - rightTopY) * 0.72).toFixed(2)} ${rightBottomX.toFixed(2)} ${rightBottomY.toFixed(2)} L ${leftBottomX.toFixed(2)} ${leftBottomY.toFixed(2)} Z`;
    })()
    : `M ${photoFacePoints.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
  // Map the validated CAD branding region onto the photographed branding face.
  // This transform affects only the visual mockup. Production coordinates and
  // exported manufacturing artwork retain their original CAD coordinate space.
  const photoFaceLeft = photoFacePoints[0][0];
  const photoFaceRight = photoFacePoints[1][0];
  const photoFaceTop = (photoFacePoints[0][1] + photoFacePoints[1][1]) / 2;
  const photoFaceBottom = (photoFacePoints[2][1] + photoFacePoints[3][1]) / 2;
  const cadArtworkStart = cadXToCanvasX(
    variant,
    renderGeometrySize,
    brandingRegion.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2,
    viewW
  );
  const cadArtworkEnd = cadXToCanvasX(
    variant,
    renderGeometrySize,
    brandingRegion.rightEdgeXmm,
    viewW
  );
  const artworkScaleX = (photoFaceRight - photoFaceLeft) / (cadArtworkEnd - cadArtworkStart);
  const artworkTranslateX = photoFaceLeft - cadArtworkStart * artworkScaleX;
  // The Studio SVG artwork uses canvas Y (0..viewH), while the CAD y bounds
  // are physical millimeters centered around zero. Map its canvas range to the
  // photograph face without treating millimeter coordinates as SVG pixels.
  const artworkScaleY = (photoFaceBottom - photoFaceTop) / viewH;
  const artworkTranslateY = photoFaceTop;
  const photoArtworkTransform = `matrix(${artworkScaleX} 0 0 ${artworkScaleY} ${artworkTranslateX} ${artworkTranslateY})`;
  // Use the CAD groove as the sole attachment datum. The approved Size 4
  // blank-sleeve master is checked against this CAD fraction in the geometry
  // module. The source product photo is split at its visible groove and each
  // side is mapped to the corresponding CAD interval so the groove stays put
  // while the flap and body take their true size-specific lengths.
  const previewBrandingRegion = brandingRegionFor(variant, previewSleeveSize);
  const previewArtworkStart = cadXToCanvasX(
    variant,
    previewSleeveSize,
    previewBrandingRegion.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2,
    viewW
  );
  const previewArtworkEnd = cadXToCanvasX(variant, previewSleeveSize, previewBrandingRegion.rightEdgeXmm, viewW);
  const photoGrooveCanvasX = photoFaceLeft
    + ((cadXToCanvasX(variant, previewSleeveSize, previewBrandingRegion.grooveXmm, viewW) - previewArtworkStart)
      / (previewArtworkEnd - previewArtworkStart)) * (photoFaceRight - photoFaceLeft);
  const photoGrooveSourceX = clamp(
    sleevePhoto.crop.x + (photoGrooveCanvasX / viewW) * sleevePhoto.crop.width,
    sleevePhoto.crop.x + 1,
    sleevePhoto.crop.x + sleevePhoto.crop.width - 1
  );
  const cadGrooveCanvasX = sleeveGrooveFractionFor(variant, previewSleeveSize) * viewW;
  const sleeveGrooveFraction = cadGrooveCanvasX / viewW;
  const sleeveColorRgb = backgroundColor.match(/[0-9a-f]{2}/gi)?.map((value) => parseInt(value, 16) / 255) ?? [0, 0, 0];
  const isBlackSleeve = backgroundColor.toLowerCase() === "#000000";
  // The approved sleeve master is photographed in black. Treat that image as
  // a lighting texture over the selected material color so its near-black
  // pixels cannot muddy saturated colors. Black bypasses the filter and white
  // retains its established output.
  const sleeveMaterialFloor = backgroundColor.toLowerCase() === "#ffffff"
    ? 0.82
    : backgroundColor.toLowerCase() === "#000000" ? 0 : 0.3;
  const sleeveTextureAmplitude = 1 - sleeveMaterialFloor;
  const sleeveColorFilterId = `sleeve-color-${uid}`;
  const billboardMatteGradientId = `billboard-matte-${uid}`;
  const scaledFontSize = fontSize * (viewH / 450);
  // Measure the glyphs using the same browser font metrics as the SVG preview;
  // do not treat the SVG line-height box as printed artwork.
  const textGlyphBounds = (() => {
    if (!text.trim() || typeof document === "undefined") return { width: 0, height: 0 };
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return { width: 0, height: 0 };
    context.font = `${fontWeight} ${scaledFontSize}px "${font.replace(/"/g, "\\\"")}"`;
    const lines = text.split("\n");
    const metrics = lines.map((line) => context.measureText(line));
    const trackingPx = tracking * scaledFontSize;
    const width = Math.max(0, ...metrics.map((metric, index) =>
      metric.width + Math.max(0, lines[index].length - 1) * trackingPx
    )) + strokeWidth * (viewH / 450);
    const ascent = Math.max(0, ...metrics.map((metric) => metric.actualBoundingBoxAscent || 0));
    const descent = Math.max(0, ...metrics.map((metric) => metric.actualBoundingBoxDescent || 0));
    const height = ascent + descent + (lines.length - 1) * scaledFontSize * lineHeight
      + strokeWidth * (viewH / 450);
    return { width, height };
  })();
  const textArtworkWidthMm = textGlyphBounds.width * ((bounds.maxX - bounds.minX) / viewW);
  const textArtworkHeightMm = textGlyphBounds.height * ((bounds.maxY - bounds.minY) / viewH);
  const margin = (safeMargin / 100) * viewH;

  const pathId = `text-arc-path-${uid}`;
  const surfaceClipId = `printable-surface-${uid}`;
  const embossFaceHighlightId = `emboss-face-highlight-${uid}`;
  const grooveCutoutPath = useMemo(
    () => nonPrintableGroovePath(variant, renderGeometrySize, viewW, viewH),
    [variant, renderGeometrySize, viewH]
  );
  const overallLengthMm = activeGeometry.overallMaxXmm - activeGeometry.overallMinXmm;
  const largestGeometry = SLEEVE_GEOMETRY[variant].sizes[5];
  const largestOverallLengthMm = largestGeometry.overallMaxXmm - largestGeometry.overallMinXmm;
  const sleeveScaleRatio = overallLengthMm / largestOverallLengthMm;
  const currentHatTemplate = getHatTemplate(hatTemplateId);
  const currentHatProfile = isMobilePreview ? currentHatTemplate.mobile : currentHatTemplate;
  const isCityLifestylePreview = previewBackground === "city" && ghostHat && !fixedProductConfiguration;
  const renderedHatImagePath = isCityLifestylePreview
    ? hatForegroundImagePath(currentHatTemplate.id, isMobilePreview)
    : currentHatProfile.imagePath;
  const lifestyleBackgroundPath = isMobilePreview
    ? CITY_LIFESTYLE_BACKGROUND_PATHS.mobile
    : CITY_LIFESTYLE_BACKGROUND_PATHS.desktop;
  const loadedHatSize = hatNaturalSize.src === renderedHatImagePath ? hatNaturalSize : null;
  // Match the active source photograph's natural ratio. This fills the widened
  // desktop frame without cropping or distorting hat pixels.
  const stageAspectRatio = isMobilePreview
    ? MOBILE_STAGE_WIDTH_HEIGHT_RATIO
    : currentHatProfile.imageDimensions.width / currentHatProfile.imageDimensions.height;
  const stageCoordinateHeight = STUDIO_STAGE_COORDINATE_WIDTH / stageAspectRatio;
  const currentStageClientWidth = (svgRef.current?.closest(".snapink-product-stage") as HTMLDivElement | null)?.clientWidth
    || (typeof window !== "undefined" && window.innerWidth <= 640 ? Math.max(1, window.innerWidth - 92) : stageClientWidth);
  const stageComposition = hatComposition(
    currentHatProfile,
    STUDIO_STAGE_COORDINATE_WIDTH,
    stageCoordinateHeight,
    loadedHatSize?.width,
    loadedHatSize?.height
  );
  const cameraZoom = studioHatZoomForSize(previewSleeveSize, variant, isMobilePreview);
  // Keep the desktop photographic preview framed at Size 0. Mobile retains
  // its existing size-dependent camera presets.
  const desktopZoomFitScale = 1 / Math.max(...STUDIO_HAT_CAMERA_ZOOM_CONFIG.desktop[variant]);
  const renderedCameraZoom = isMobilePreview ? cameraZoom : cameraZoom * desktopZoomFitScale;
  const desktopSleeveCalibration = !isMobilePreview && ghostHat
    ? STUDIO_DESKTOP_SLEEVE_CALIBRATION_PX[previewSleeveSize]
    : null;
  const desktopBoundaryAdjustment = !isMobilePreview && ghostHat
    ? DESKTOP_SLEEVE_PREVIEW_BOUNDARY_ADJUSTMENTS_STAGE_PX[variant]
    : { rightEdgeInset: 0, alignRightToHatEdge: false, heightReduction: 0, verticalShift: 0 };
  // Keep the Round 1 CSS-pixel adjustment unchanged. Round 2 additions use
  // native stage-reference pixels directly, before the existing camera zoom.
  const previousDesktopAdjustmentScale = desktopSleeveCalibration
    ? (STUDIO_STAGE_COORDINATE_WIDTH / Math.max(1, currentStageClientWidth)) / cameraZoom
    : 0;
  // Calibrate the sleeve's physical width from the photographed strap's
  // thickness, then derive its longitudinal span from the actual CAD bounds.
  // The old mapping reused a photographed rectangle's width and only applied
  // the size ratio, which made the CAD sleeve too short and distorted its
  // length-to-width proportions. CAD X runs from the flap through the right
  // edge; the template groove remains the physical attachment datum.
  const baseSleeveHeightPx = stageComposition.strapThicknessPx * STUDIO_SLEEVE_PREVIEW_SCALE;
  const baseSleeveWidthPx = baseSleeveHeightPx * (viewW / previewSleeveViewH);
  const desktopCalibratedWidthAdjustmentPx = desktopSleeveCalibration
    ? desktopSleeveCalibration.widthIncrease * previousDesktopAdjustmentScale
      + desktopSleeveCalibration.round2.widthIncreaseStagePx
    : 0;
  const desktopHeightAdjustmentPx = desktopSleeveCalibration
    ? -desktopSleeveCalibration.heightDecrease * previousDesktopAdjustmentScale
      + desktopSleeveCalibration.round2.heightIncreaseStagePx
      - desktopBoundaryAdjustment.heightReduction
    : 0;
  const desktopSleeveWidthBeforeEdgeAdjustmentPx = baseSleeveWidthPx + desktopCalibratedWidthAdjustmentPx;
  const desktopSleeveLeftPx = stageComposition.grooveX
    - desktopSleeveWidthBeforeEdgeAdjustmentPx * sleeveGrooveFraction;
  const desktopHatEdgeAlignmentCorrectionPx = desktopBoundaryAdjustment.alignRightToHatEdge
    ? stageComposition.rearOpeningRight
      - (desktopSleeveLeftPx + desktopSleeveWidthBeforeEdgeAdjustmentPx)
    : 0;
  const desktopWidthAdjustmentPx = desktopCalibratedWidthAdjustmentPx
    - desktopBoundaryAdjustment.rightEdgeInset + desktopHatEdgeAlignmentCorrectionPx;
  const mobileRightEdgeAdjustmentPx = isMobilePreview && ghostHat
    ? variant === "standard"
      // Match the mobile Billboard preview's CAD-derived Size 5 endpoint so
      // both styles share the same right edge from their fixed groove datum.
      ? (() => {
        const referenceSize = STUDIO_MOBILE_SLEEVE_RIGHT_EDGE_CALIBRATION.matchSize[0];
        const referenceGeometry = SLEEVE_GEOMETRY.billboard.sizes[referenceSize];
        const referenceBounds = surfaceBounds("billboard", referenceSize);
        const referenceLengthMm = referenceGeometry.overallMaxXmm - referenceGeometry.overallMinXmm;
        const referenceWidthPx = baseSleeveHeightPx
          * (referenceLengthMm / (referenceBounds.maxY - referenceBounds.minY));
        const billboardRightFromGroovePx = referenceWidthPx
          * (1 - sleeveGrooveFractionFor("billboard", referenceSize));
        const standardRightFromGroovePx = baseSleeveWidthPx * (1 - sleeveGrooveFraction);
        return billboardRightFromGroovePx - standardRightFromGroovePx;
      })()
      : renderGeometrySize <= 3
      ? (() => {
        const referenceSize = STUDIO_MOBILE_SLEEVE_RIGHT_EDGE_CALIBRATION.matchSize[renderGeometrySize as 0 | 1 | 2 | 3];
        const referenceGeometry = SLEEVE_GEOMETRY[variant].sizes[referenceSize];
        const referenceLengthMm = referenceGeometry.overallMaxXmm - referenceGeometry.overallMinXmm;
        const referenceBounds = surfaceBounds(variant, referenceSize);
        const referenceGrooveFraction = sleeveGrooveFractionFor(variant, referenceSize);
        const currentRightFromGroovePx = baseSleeveWidthPx * (1 - sleeveGrooveFraction);
        const referenceWidthPx = baseSleeveHeightPx
          * (referenceLengthMm / (referenceBounds.maxY - referenceBounds.minY));
        const referenceRightFromGroovePx = referenceWidthPx * (1 - referenceGrooveFraction);
        // This is a right-edge-only extension; the left flap and groove stay
        // at their original positions in the mobile stage.
        return referenceRightFromGroovePx - currentRightFromGroovePx;
      })()
      : STUDIO_MOBILE_SLEEVE_RIGHT_EDGE_CALIBRATION.additionalStagePx[renderGeometrySize as 4 | 5]
    : 0;
  const mobileTopExpansionPx = isMobilePreview && ghostHat
    ? STUDIO_MOBILE_SLEEVE_TOP_EXPANSION_STAGE_PX + STUDIO_MOBILE_SLEEVE_TOP_EXPANSION_ADDITIONAL_STAGE_PX
    : 0;
  const sleevePreviewHeightPx = Math.max(1, baseSleeveHeightPx + desktopHeightAdjustmentPx + mobileTopExpansionPx);
  const sleevePreviewHeightPercent = (sleevePreviewHeightPx / stageCoordinateHeight) * 100;
  const sleevePreviewWidthPx = baseSleeveWidthPx + desktopWidthAdjustmentPx + mobileRightEdgeAdjustmentPx;
  const sleevePreviewWidthPercent = (sleevePreviewWidthPx / STUDIO_STAGE_COORDINATE_WIDTH) * 100;
  const sleeveRenderViewW = isMobilePreview
    ? viewW * (sleevePreviewWidthPx / baseSleeveWidthPx)
    : viewW;
  const sleeveRenderGrooveFraction = isMobilePreview && ghostHat
    ? cadGrooveCanvasX / sleeveRenderViewW
    : sleeveGrooveFraction;
  const mobileBodyExtensionCanvasPx = isMobilePreview && ghostHat ? sleeveRenderViewW - viewW : 0;
  const photoFaceRenderPath = mobileBodyExtensionCanvasPx > 0
    ? `M ${photoFacePoints.map(([x, y], index) => `${(index === 1 || index === 2 ? x + mobileBodyExtensionCanvasPx : x).toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`
    : photoFacePath;
  // Mobile's rectangular face mask lets the matte darkening reach the clipped
  // Billboard free edge. Match that overlay boundary on desktop only; keep the
  // curved artwork clip and the sleeve contour unchanged.
  const billboardMatteRenderPath = variant === "billboard" && !isMobilePreview
    ? `M ${photoFacePoints.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`
    : photoFaceRenderPath;
  const billboardPhotoRightContourClipPath = variant === "billboard"
    ? `M 0 0 H ${sleeveRenderViewW} C ${sleeveRenderViewW - 7} ${viewH * 0.28} ${sleeveRenderViewW - 7} ${viewH * 0.72} ${sleeveRenderViewW} ${viewH} H 0 Z`
    : null;
  const desktopSleeveVerticalOffsetPercent = !isMobilePreview && ghostHat
    ? ((STUDIO_DESKTOP_SLEEVE_VERTICAL_OFFSET_STAGE_PX
      + STUDIO_DESKTOP_SLEEVE_VERTICAL_SIZE_ADJUSTMENT_STAGE_PX[previewSleeveSize]
      + desktopBoundaryAdjustment.verticalShift) / stageCoordinateHeight) * 100
    : 0;
  // Expand upward while holding the sleeve's bottom edge in place.
  const mobileTopExpansionCenterOffsetPercent = mobileTopExpansionPx
    ? (-mobileTopExpansionPx / 2 / stageCoordinateHeight) * 100
    : 0;
  const sleevePreviewCenterYPercent = ghostHat
    ? (stageComposition.strapCenterY / stageCoordinateHeight) * 100
      + desktopSleeveVerticalOffsetPercent + mobileTopExpansionCenterOffsetPercent
    : 50;
  const sleevePreviewBottomYPercent = sleevePreviewCenterYPercent + sleevePreviewHeightPercent / 2;
  const sleeveSvgHeight = viewH;
  const sleevePreviewCenterXPercent = ghostHat
    ? (((isMobilePreview
      ? stageComposition.grooveX - baseSleeveWidthPx * sleeveGrooveFraction + sleevePreviewWidthPx / 2
      : stageComposition.grooveX - desktopSleeveWidthBeforeEdgeAdjustmentPx * sleeveGrooveFraction + sleevePreviewWidthPx / 2))
      / STUDIO_STAGE_COORDINATE_WIDTH) * 100
    : 50;
  const sleevePreviewLeftPercent = sleevePreviewCenterXPercent - sleevePreviewWidthPercent / 2;
  const sleevePreviewGrooveXPercent = sleevePreviewCenterXPercent
    + sleevePreviewWidthPercent * (sleeveRenderGrooveFraction - 0.5);
  const sleevePreviewRightPercent = sleevePreviewCenterXPercent + sleevePreviewWidthPercent / 2;
  const cameraOriginXPercent = (stageComposition.grooveX / STUDIO_STAGE_COORDINATE_WIDTH) * 100;
  const cameraOriginYPercent = (stageComposition.grooveY / stageCoordinateHeight) * 100;
  const productionBounds = surfaceBounds(variant, sleeveSize);
  const productionLogoCenterXmm = studioArtworkPositionFor(variant, sleeveSize, draftCanvasX, 50).centerXmm;
  // Billboard logos center on the inset face customers see as printable,
  // excluding the groove/flap side from the visual centering zone. Preview
  // size and validation share this same selected-CAD fit calculation.
  const logoFitCenterXmm = productionLogoCenterXmm;
  const logoFitCenterYmm = (productionBounds.minY + productionBounds.maxY) / 2;
  const logoMaxHeightMm = maximumContainedLogoHeightMm(
    variant,
    sleeveSize,
    logoFitCenterXmm,
    logoFitCenterYmm,
    logoAspectRatio
  );
  const logoBaseHeightMm = logoMaxHeightMm * (clamp(logoScale, 0, 200) / 100);
  const selectedBrandingRange = usableBrandingCanvasRangePercentFor(variant, sleeveSize);
  const previewBrandingRange = usableBrandingCanvasRangePercentFor(variant, renderGeometrySize);
  const renderPosX = previewBrandingRange.start
    + ((posX - selectedBrandingRange.start) / (selectedBrandingRange.end - selectedBrandingRange.start))
      * (previewBrandingRange.end - previewBrandingRange.start);
  const logoCenterXmm = studioArtworkPositionFor(variant, renderGeometrySize, renderPosX, 50).centerXmm;
  const logoHeightMm = logoBaseHeightMm;
  // Boundary placement follows the visible alpha image face. Emboss extrusion
  // is rendered as offset edge layers and must not inflate the centered face
  // bounds used for clearance checks.
  const logoArtworkHeightMm = logoHeightMm * artworkHeightScale / 100;
  const textArtworkHeightMmScaled = textArtworkHeightMm * artworkHeightScale / 100;
  const textCenterYmm = artworkCenterYForPositionMm(
    variant,
    renderGeometrySize,
    posY,
    textArtworkHeightMmScaled,
    BRANDING_EDGE_CLEARANCE_MM,
    MAX_TOP_ARTWORK_EXTENSION_MM,
    MAX_BOTTOM_ARTWORK_EXTENSION_MM
  );
  const textCenterCanvasY = ((bounds.maxY - textCenterYmm) / (bounds.maxY - bounds.minY)) * viewH;
  const logoPositionCenterYmm = artworkCenterYForPositionMm(
    variant,
    renderGeometrySize,
    logoPosY,
    logoArtworkHeightMm,
    BRANDING_EDGE_CLEARANCE_MM,
    MAX_TOP_ARTWORK_EXTENSION_MM,
    MAX_BOTTOM_ARTWORK_EXTENSION_MM
  );
  // All previews and exports use the same CAD-referenced artwork position.
  const logoCenterYmm = logoPositionCenterYmm;
  const svgUnitsPerMm = viewW / overallLengthMm;
  const embossedExtrusionX = STUDIO_EMBOSSED_PREVIEW_EXTRUSION_MM * svgUnitsPerMm * 0.32;
  const embossedExtrusionY = STUDIO_EMBOSSED_PREVIEW_EXTRUSION_MM * svgUnitsPerMm * 0.72;
  const visibleLogoWidthSvg = logoHeightMm * logoAspectRatio * svgUnitsPerMm;
  const visibleLogoHeightSvg = logoHeightMm * svgUnitsPerMm;
  const logoImageHeightSvg = visibleLogoHeightSvg / logoVisibleBounds.height;
  // Use the source bitmap's true aspect ratio for its full SVG image box.
  // The visible alpha bounds determine the centered artwork footprint; do not
  // apply their width/height ratio a second time to the source dimensions.
  const logoImageWidthSvg = logoImageHeightSvg * logoSourceAspectRatio;
  const logoCenterCanvasX = cadXToCanvasX(variant, renderGeometrySize, logoCenterXmm, viewW);
  const logoCenterCanvasY = ((bounds.maxY - logoCenterYmm) / (bounds.maxY - bounds.minY)) * viewH;
  const logoImageX = logoCenterCanvasX - visibleLogoWidthSvg / 2 - logoVisibleBounds.x * logoImageWidthSvg;
  const logoImageY = logoCenterCanvasY - visibleLogoHeightSvg / 2 - logoVisibleBounds.y * logoImageHeightSvg;
  const artworkCenterCanvasPercent = usableBrandingCenterCanvasPercentFor(variant, sleeveSize);
  const usableArtworkRange = usableBrandingCanvasRangePercentFor(variant, sleeveSize);
  const artworkMinXCanvasPercent = usableArtworkRange.start;
  const artworkMaxXCanvasPercent = usableArtworkRange.end;
  const productionTextHeightMm = textArtworkHeightMmScaled
    * ((productionBounds.maxY - productionBounds.minY) / (bounds.maxY - bounds.minY));
  const productionTextWidthMm = textArtworkWidthMm
    * ((productionBounds.maxX - productionBounds.minX) / (bounds.maxX - bounds.minX));
  const productionLogoBaseHeightMm = logoDataUrl ? logoBaseHeightMm : 0;
  // Studio applies artworkHeightScale only on Y (scale(1, scaleY)). Keep the
  // visible width on its independent logoScale so validation matches preview.
  const productionLogoHeightMm = logoDataUrl
    ? productionLogoBaseHeightMm * artworkHeightScale / 100
    : 0;
  const productionCenterYmm = artworkCenterYForPositionMm(
    variant,
    sleeveSize,
    logoDataUrl ? logoPosY : posY,
    logoDataUrl ? productionLogoHeightMm : productionTextHeightMm,
    BRANDING_EDGE_CLEARANCE_MM,
    MAX_TOP_ARTWORK_EXTENSION_MM,
    MAX_BOTTOM_ARTWORK_EXTENSION_MM
  );
  const selectedArtworkWidthMm = logoDataUrl
    ? productionLogoBaseHeightMm * logoAspectRatio
    : productionTextWidthMm;
  const selectedArtworkHeightMm = logoDataUrl ? productionLogoHeightMm : productionTextHeightMm;
  const artworkStatus = artworkBoundsStatusMm(
    variant, sleeveSize, productionLogoCenterXmm, productionCenterYmm,
    selectedArtworkWidthMm, selectedArtworkHeightMm, undefined,
    logoDataUrl ? logoAlphaProfile : undefined
  );
  const artworkExtensionMm = artworkStatus.extensionMm;
  const artworkExceedsAllowedExtension = artworkStatus.topExtensionMm > MAX_TOP_ARTWORK_EXTENSION_MM + 0.001
    || artworkStatus.bottomExtensionMm > MAX_BOTTOM_ARTWORK_EXTENSION_MM + 0.001;
  const artworkIsExtended = artworkStatus.topExtensionMm > 0.001 || artworkStatus.bottomExtensionMm > 0.001;
  const artworkInvalid = artworkStatus.crossesLockedEdge || artworkStatus.violatesClearance || artworkExceedsAllowedExtension;
  const artworkInvalidBoundary = artworkStatus.crossesLeftEdge ? "left edge clearance"
    : artworkStatus.crossesRightEdge ? "right edge clearance"
      : artworkStatus.crossesGroove ? "left edge clearance at the flap groove"
        : artworkStatus.violatesTopClearance ? "top edge clearance"
          : artworkStatus.violatesBottomClearance ? "bottom edge clearance"
            : artworkStatus.topExtensionMm > MAX_TOP_ARTWORK_EXTENSION_MM + 0.001 ? "maximum top extension (12.7 mm)"
              : "maximum bottom extension (12.7 mm)";
  function artworkPointInCadCanvas(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const overlay = svg?.querySelector<SVGGElement>('[data-artwork-overlay="true"]');
    const matrix = overlay?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }
  function beginArtworkDrag(event: React.PointerEvent<SVGElement>) {
    if (!logoDataUrl || logoNeedsRemoval || (event.pointerType === "mouse" && event.button !== 0)) return;
    const point = artworkPointInCadCanvas(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    artworkDragRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, posX, centerYmm: logoPositionCenterYmm };
    setIsDraggingArtwork(true);
  }
  function moveArtworkDrag(event: React.PointerEvent<SVGElement>) {
    const drag = artworkDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = artworkPointInCadCanvas(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const renderedGeometry = geometryFor(variant, renderGeometrySize);
    const selectedGeometry = geometryFor(variant, sleeveSize);
    const renderedLengthMm = renderedGeometry.overallMaxXmm - renderedGeometry.overallMinXmm;
    const selectedLengthMm = selectedGeometry.overallMaxXmm - selectedGeometry.overallMinXmm;
    const deltaXmm = (point.x - drag.x) * renderedLengthMm / viewW;
    setPosX(clamp(drag.posX + deltaXmm * 100 / selectedLengthMm, artworkMinXCanvasPercent, artworkMaxXCanvasPercent));

    const targetCenterYmm = drag.centerYmm
      - (point.y - drag.y) * (bounds.maxY - bounds.minY) / viewH;
    const baseRange = artworkVerticalCenterRangeMm(variant, renderGeometrySize, logoArtworkHeightMm, BRANDING_EDGE_CLEARANCE_MM);
    const extensionRange = artworkVerticalCenterRangeMm(
      variant, renderGeometrySize, logoArtworkHeightMm, BRANDING_EDGE_CLEARANCE_MM,
      MAX_TOP_ARTWORK_EXTENSION_MM, MAX_BOTTOM_ARTWORK_EXTENSION_MM
    );
    let nextPosition = 50;
    if (targetCenterYmm > baseRange.maxCenterY && extensionRange.maxCenterY > baseRange.maxCenterY) {
      nextPosition = -100 * (targetCenterYmm - baseRange.maxCenterY) / (extensionRange.maxCenterY - baseRange.maxCenterY);
    } else if (targetCenterYmm < baseRange.minCenterY && baseRange.minCenterY > extensionRange.minCenterY) {
      nextPosition = 100 + 100 * (baseRange.minCenterY - targetCenterYmm) / (baseRange.minCenterY - extensionRange.minCenterY);
    } else if (baseRange.maxCenterY > baseRange.minCenterY) {
      nextPosition = 100 * (baseRange.maxCenterY - targetCenterYmm) / (baseRange.maxCenterY - baseRange.minCenterY);
    }
    setLogoPosY(clamp(nextPosition, ARTWORK_VERTICAL_POSITION_MIN, ARTWORK_VERTICAL_POSITION_MAX));
  }
  function endArtworkDrag(event: React.PointerEvent<SVGElement>) {
    if (artworkDragRef.current?.pointerId !== event.pointerId) return;
    artworkDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDraggingArtwork(false);
  }
  const logoOutsidePrintableArea = Boolean((logoDataUrl || text.trim()) && !logoNeedsRemoval && (
    artworkInvalid
  ));
  const productionCanvasY = ((productionBounds.maxY - productionCenterYmm)
    / (productionBounds.maxY - productionBounds.minY)) * 100;
  const productionDraftPosition = studioArtworkPositionFor(variant, sleeveSize, draftCanvasX, productionCanvasY);
  // Push changes upward after the size-aware CAD position has been resolved.
  useEffect(() => {
    onChange?.({
      size: sleeveSize,
      variant,
      text,
      font,
      fontSize,
      fontWeight,
      tracking,
      lineHeight,
      fill,
      stroke,
      strokeWidth,
      styleMode,
      arc,
      posX,
      posY,
      logoPosY,
      align,
      safeMargin,
      bgType: "vector",
      backgroundColor,
      logoDataUrl: logoDataUrl || undefined,
      logoName: logoName || undefined,
      // Production percentages use the customer's selected CAD sleeve size.
      logoX: productionDraftPosition.logoX,
      logoY: productionDraftPosition.logoY,
      logoScale,
      artworkHeightScale,
      logoOpacity,
      productionGeometryVersion: GEOMETRY_VERSION,
      positioningVersion: POSITIONING_VERSION,
      brandingCenterXmm: productionBrandingRegion.centerXmm,
      artworkCenterXmm: productionDraftPosition.centerXmm,
      artworkCenterYmm: productionCenterYmm,
      artworkWidthMm: selectedArtworkWidthMm,
      artworkHeightMm: selectedArtworkHeightMm,
      artworkExtensionMm,
      extendedArtwork: artworkIsExtended,
      hasCustomArtwork: Boolean(text.trim() || logoDataUrl),
    });
  }, [
    text,
    font,
    fontSize,
    fontWeight,
    tracking,
    lineHeight,
    fill,
    stroke,
    strokeWidth,
    styleMode,
    arc,
    posX,
    posY,
    logoPosY,
    align,
    safeMargin,
    backgroundColor,
    logoDataUrl,
    logoName,
    logoScale,
    artworkHeightScale,
    logoOpacity,
    sleeveSize,
    variant,
    onChange,
    productionDraftPosition.logoX,
    productionDraftPosition.logoY,
    productionBrandingRegion.centerXmm,
    selectedArtworkWidthMm,
    selectedArtworkHeightMm,
    artworkExtensionMm,
  ]);
  const mobilePhotoTextOffset = (() => {
    if (!isMobilePreview || !ghostHat || fixedProductConfiguration || mobileStageWidth <= 0) {
      return { x: 0, y: 0 };
    }
    const sleeveCssWidth = mobileStageWidth * sleevePreviewWidthPercent / 100;
    const sleeveCssHeight = (mobileStageWidth / stageAspectRatio) * sleevePreviewHeightPercent / 100;
    const cameraScale = sleeveCssWidth > 0 && sleeveCssHeight > 0 ? cameraZoom : 0;
    const textScaleX = (sleeveCssWidth / sleeveRenderViewW) * artworkScaleX * cameraScale;
    const textScaleY = (sleeveCssHeight / sleeveSvgHeight) * artworkScaleY * cameraScale;
    if (textScaleX <= 0 || textScaleY <= 0) return { x: 0, y: 0 };
    const rotation = stageComposition.rotationDeg * Math.PI / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const offsetX = MOBILE_PHOTO_TEXT_NUDGE_X_PX;
    const offsetY = MOBILE_PHOTO_TEXT_NUDGE_Y_PX;
    return {
      x: (cos * offsetX + sin * offsetY) / textScaleX,
      y: (-sin * offsetX + cos * offsetY) / textScaleY,
    };
  })();

  function centerCurrentArtwork() {
    setAlign("center");
    setPosX(artworkCenterCanvasPercent);
    setPosY(50);
  }

  function resetCurrentArtworkPosition() {
    setAlign(OFFICIAL_STUDIO_DEFAULTS.align);
    setPosX(defaultArtworkXForViewport(variant, sleeveSize, OFFICIAL_STUDIO_DEFAULTS.align));
    setPosY(50);
    setLogoPosY(50);
  }

  function handleVariantChange(nextVariant: SleeveVariant) {
    if (nextVariant === variant) return;
    if (isMobilePreview) {
      const positions = variantPosXRef.current!;
      positions[variant] = posX;
      const nextPosition = positions[nextVariant]
        ?? defaultArtworkXForViewport(nextVariant, sleeveSize, align);
      positions[nextVariant] = nextPosition;
      setVariant(nextVariant);
      setPosX(nextPosition);
      return;
    }
    const wasDesktopCentered = !isMobilePreview && align === "center" && Math.abs(posX - artworkCenterCanvasPercent) < 0.01;
    setVariant(nextVariant);
    if (wasDesktopCentered) {
      setPosX(usableBrandingCenterCanvasPercentFor(nextVariant, sleeveSize));
    }
  }

  function handleSizeChange(nextSize: number) {
    if (nextSize === sleeveSize) return;
    setSleeveSize(nextSize);
    if (!isMobilePreview) {
      // Keep desktop artwork stationary while the photographic sleeve stays at Size 0.
      pendingSizeConfirmationRef.current = nextSize;
    }
  }

  function handleAlignmentChange(nextAlign: "start" | "center" | "end") {
    setAlign(nextAlign);
    if (isMobilePreview) {
      if (nextAlign === "start") setPosX(artworkMinXCanvasPercent);
      else if (nextAlign === "end") setPosX(artworkMaxXCanvasPercent);
      else {
        setPosX(artworkCenterCanvasPercent);
        setPosY(50);
      }
    } else if (nextAlign === "center") {
      setPosX(artworkCenterCanvasPercent);
    }
  }

  const arcPath = useMemo(() => {
    const a = clamp(arc, -20, 20);
    const leftX = margin;
    const rightX = viewW - margin;
    const baseY = clamp(textCenterCanvasY, margin, viewH - margin);
    const midY = clamp(baseY + (a / 100) * viewH, margin, viewH - margin);
    return `M ${leftX} ${baseY} Q ${viewW / 2} ${midY} ${rightX} ${baseY}`;
  }, [arc, textCenterCanvasY, margin, viewH]);

  async function renderStudioPNGBlob(options: { sleeveOnly?: boolean; artworkOnly?: boolean; scale?: number } = {}): Promise<Blob> {
    if (logoNeedsRemoval) {
      throw new Error("Remove the logo background before exporting, or upload a transparent PNG.");
    }
    const svg = svgRef.current;
    if (!svg) throw new Error("The Studio sleeve preview is unavailable.");

    const exportSvg = svg.cloneNode(true) as SVGSVGElement;
    exportSvg.querySelectorAll('[data-preview-only="true"]').forEach((node) => node.remove());
    if(options.artworkOnly)exportSvg.querySelectorAll('[data-product-image="true"]').forEach(node=>node.remove());
    exportSvg.removeAttribute("style");
    const topExtensionSvgUnits = MAX_TOP_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    const bottomExtensionSvgUnits = MAX_BOTTOM_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    exportSvg.setAttribute("viewBox", `0 ${-topExtensionSvgUnits} ${viewW} ${viewH + topExtensionSvgUnits + bottomExtensionSvgUnits}`);
    exportSvg.setAttribute("width", String(viewW));
    exportSvg.setAttribute("height", String(viewH + topExtensionSvgUnits + bottomExtensionSvgUnits));
    try {
      for (const image of Array.from(exportSvg.querySelectorAll("image"))) {
        const href = image.getAttribute("href");
        if (href && !href.startsWith("data:")) {
          const response = await fetch(new URL(href, window.location.href), { credentials: "same-origin" });
          if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
          const imageBlob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not package the sleeve image for PNG export."));
            reader.readAsDataURL(imageBlob);
          });
          image.setAttribute("href", dataUrl);
        }
      }
    } catch (error) {
      console.error("Studio PNG export could not package its image assets.", error);
      throw new Error("The sleeve image could not be prepared for export.");
    }

    const xml = new XMLSerializer().serializeToString(exportSvg);
    const svgUrl = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const sleeveImage = await loadStudioImage(svgUrl);
      const includeHat = options.sleeveOnly ? false : ghostHat;
      const ghostImage = includeHat ? await loadStudioImage(renderedHatImagePath) : null;
      const lifestyleImage = ghostImage && isCityLifestylePreview
        ? await loadStudioImage(lifestyleBackgroundPath)
        : null;
      const scale = options.scale ?? exportScale;
      const canvas = document.createElement("canvas");
      canvas.width = ghostImage
        ? Math.round(viewW * scale)
        : Math.round(viewW * sleeveScaleRatio * scale);
      canvas.height = ghostImage
        ? Math.round(canvas.width / stageAspectRatio)
        : Math.round((previewViewH + topExtensionSvgUnits + bottomExtensionSvgUnits) * sleeveScaleRatio * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG export canvas is unavailable.");
      const exportCrop = isMobilePreview
        ? STUDIO_PNG_EXPORT_CROP_NATURAL_PX.mobile
        : STUDIO_PNG_EXPORT_CROP_NATURAL_PX.desktop;
      let stageVerticalOffset = 0;
      let framedHeight = canvas.height;
      if (ghostImage) {
        const composition = hatComposition(
          currentHatProfile,
          canvas.width,
          canvas.height,
          ghostImage.naturalWidth,
          ghostImage.naturalHeight
        );
        const sourceYToStageY = (sourceY: number) => composition.top
          + (sourceY / ghostImage.naturalHeight) * composition.drawnHeight;
        const cameraY = (stageY: number) => composition.grooveY
          + (stageY - composition.grooveY) * cameraZoom;
        const frameTop = cameraY(sourceYToStageY(exportCrop.top));
        const frameBottom = cameraY(sourceYToStageY(exportCrop.bottom));
        stageVerticalOffset = -frameTop;
        framedHeight = Math.max(1, Math.ceil(frameBottom - frameTop));
      }
      drawStudioComposition(
        context,
        canvas,
        sleeveImage,
        ghostImage,
        sleevePreviewWidthPercent,
        sleevePreviewHeightPercent,
        currentHatProfile,
        cameraZoom,
        sleeveGrooveFraction,
        stageComposition.rotationDeg,
        sleevePreviewCenterXPercent,
        sleevePreviewBottomYPercent,
        !isMobilePreview,
        lifestyleImage,
        stageVerticalOffset,
        true
      );
      let outputCanvas = canvas;
      if (ghostImage) {
        const framedCanvas = document.createElement("canvas");
        framedCanvas.width = canvas.width;
        framedCanvas.height = framedHeight;
        const framedContext = framedCanvas.getContext("2d");
        if (!framedContext) throw new Error("PNG framing canvas is unavailable.");
        framedContext.drawImage(canvas, 0, 0, canvas.width, framedHeight, 0, 0, canvas.width, framedHeight);
        outputCanvas = framedCanvas;
      }
      return await new Promise<Blob>((resolve, reject) => outputCanvas.toBlob(
        (output) => output ? resolve(output) : reject(new Error("PNG encoding failed.")),
        "image/png"
      ));
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  function downloadPNGBlob(png: Blob, filename: string) {
    const downloadUrl = URL.createObjectURL(png);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  function downloadProductPhotoZip(zip: Blob, filename: string) {
    const downloadUrl = URL.createObjectURL(zip);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  async function renderPackagingProductPhoto(packageImage: HTMLImageElement, sleeveImage: HTMLImageElement) {
    const { width, height, sleeve, contactShadow } = PACKAGING_PRODUCT_PHOTO;
    if (packageImage.naturalWidth !== width || packageImage.naturalHeight !== height) {
      throw new Error("The approved packaging master has unexpected dimensions.");
    }
    const sleeveWidth = sleeve.width;
    const sleeveHeight = Math.round(sleeveWidth * sleeveImage.naturalHeight / sleeveImage.naturalWidth);
    const sleeveLeft = Math.round(sleeve.centerX - sleeveWidth / 2);
    const extensionPixels = sleeveWidth * MAX_TOP_ARTWORK_EXTENSION_MM / overallLengthMm;
    const sleeveTop = sleeve.topY - extensionPixels;
    if (sleeveLeft < 0 || sleeveTop < 0 || sleeveLeft + sleeveWidth > width || sleeveTop + sleeveHeight > height) {
      throw new Error("The approved packaging sleeve placement falls outside the package image.");
    }

    const shadowMask = document.createElement("canvas");
    shadowMask.width = width;
    shadowMask.height = height;
    const maskContext = shadowMask.getContext("2d");
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = width;
    shadowCanvas.height = height;
    const shadowContext = shadowCanvas.getContext("2d");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!maskContext || !shadowContext || !context) throw new Error("The packaging product-image canvas is unavailable.");

    maskContext.imageSmoothingEnabled = true;
    maskContext.imageSmoothingQuality = "high";
    maskContext.drawImage(sleeveImage, sleeveLeft, sleeveTop, sleeveWidth, sleeveHeight);
    maskContext.globalCompositeOperation = "source-in";
    maskContext.fillStyle = `rgba(0, 0, 0, ${contactShadow.opacity})`;
    maskContext.fillRect(0, 0, width, height);
    shadowContext.filter = `blur(${contactShadow.blurRadius}px)`;
    shadowContext.drawImage(shadowMask, contactShadow.offsetX, contactShadow.offsetY);

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(packageImage, 0, 0);
    context.drawImage(shadowCanvas, 0, 0);
    context.drawImage(sleeveImage, sleeveLeft, sleeveTop, sleeveWidth, sleeveHeight);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (output) => output ? resolve(output) : reject(new Error("Packaging product PNG encoding failed.")),
      "image/png",
    ));
  }

  async function renderDeskProductPhoto(productStyle: SleeveVariant = variant) {
    if (logoNeedsRemoval) throw new Error("Finish removing the logo background before generating a product image.");
    const svg = svgRef.current;
    if (!svg) throw new Error("The Studio artwork is unavailable.");
    const productPhoto = onDeskProductPhotoFor(productStyle);
    const calibration = productPhoto.calibration;
    const { width, height, artworkQuad } = calibration;
    const exportSvg = svg.cloneNode(true) as SVGSVGElement;
    exportSvg.querySelectorAll('[data-preview-only="true"], [data-product-image="true"], line').forEach((node) => node.remove());
    const topExtensionSvgUnits = MAX_TOP_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    const bottomExtensionSvgUnits = MAX_BOTTOM_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    exportSvg.setAttribute("viewBox", `0 ${-topExtensionSvgUnits} ${viewW} ${viewH + topExtensionSvgUnits + bottomExtensionSvgUnits}`);
    exportSvg.setAttribute("width", String(viewW));
    exportSvg.setAttribute("height", String(viewH + topExtensionSvgUnits + bottomExtensionSvgUnits));
    if (styleMode === "emboss") {
      // Production relief is 0.8 mm; the generic Studio preview extrusion is
      // intentionally deeper. Thin only the copied sidewall layers for desk photos.
      for (const layer of Array.from(exportSvg.querySelectorAll<SVGElement>("[data-emboss-extrusion-step]"))) {
        const transform = layer.getAttribute("transform") || "";
        layer.setAttribute("transform", transform.replace(
          /translate\(\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*[, ]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*\)/i,
          (_match, x: string, y: string) => `translate(${Number(x) * 0.35} ${Number(y) * 0.35})`,
        ));
        const opacity = Number(layer.getAttribute("opacity") ?? 1);
        layer.setAttribute("opacity", String(opacity * 0.8));
      }
    }
    exportSvg.removeAttribute("style");
    for (const image of Array.from(exportSvg.querySelectorAll("image"))) {
      const href = image.getAttribute("href");
      if (href && !href.startsWith("data:")) {
        const response = await fetch(new URL(href, window.location.href), { credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not prepare the selected artwork for the desk product image.");
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not package the selected artwork.")); reader.readAsDataURL(blob);
        });
        image.setAttribute("href", dataUrl);
      }
    }
    const source = new Image();
    const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(exportSvg)], { type: "image/svg+xml;charset=utf-8" }));
    try {
      await new Promise<void>((resolve, reject) => { source.onload = () => resolve(); source.onerror = () => reject(new Error("Could not render the selected Studio artwork.")); source.src = svgUrl; });
    } finally { URL.revokeObjectURL(svgUrl); }
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = Math.max(1, Math.round(svg.viewBox.baseVal.width));
    sourceCanvas.height = Math.max(1, Math.round(svg.viewBox.baseVal.height + topExtensionSvgUnits + bottomExtensionSvgUnits));
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("The artwork export canvas is unavailable.");
    sourceContext.drawImage(source, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    let minX = sourceCanvas.width, minY = sourceCanvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < sourceCanvas.height; y++) for (let x = 0; x < sourceCanvas.width; x++) {
      if (pixels.data[(y * sourceCanvas.width + x) * 4 + 3] > 4) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
    if (maxX < minX || maxY < minY) throw new Error("Add text or a logo before generating a desk product image.");
    const artWidth = maxX - minX + 1, artHeight = maxY - minY + 1;
    const art = document.createElement("canvas"); art.width = artWidth; art.height = artHeight;
    const artContext = art.getContext("2d");
    if (!artContext) throw new Error("The artwork crop could not be created.");
    artContext.drawImage(sourceCanvas, minX, minY, artWidth, artHeight, 0, 0, artWidth, artHeight);

    // The Studio SVG already includes uploaded-image bounds, logoScale/fontSize,
    // photoArtworkTransform, responsive preview transforms, and the position controls.
    // Map its rendered artwork fraction from the visible sleeve face onto the desk face;
    // Calibration 08 contributes perspective only and never normalizes designs to LIFT size.
    const physicalSourceFace = JSON.parse(svg.getAttribute("data-photo-face-points") || "[]") as [number, number][];
    if (physicalSourceFace.length !== 4) throw new Error("The Studio sleeve face geometry is unavailable.");
    const sourceFacePoints: [number, number][] = [
      [physicalSourceFace[0][0] + (physicalSourceFace[0][0] - physicalSourceFace[3][0]) * photoFaceExtensionRatio, physicalSourceFace[0][1] + (physicalSourceFace[0][1] - physicalSourceFace[3][1]) * photoFaceExtensionRatio + topExtensionSvgUnits],
      [physicalSourceFace[1][0] + (physicalSourceFace[1][0] - physicalSourceFace[2][0]) * photoFaceExtensionRatio, physicalSourceFace[1][1] + (physicalSourceFace[1][1] - physicalSourceFace[2][1]) * photoFaceExtensionRatio + topExtensionSvgUnits],
      [physicalSourceFace[2][0] + (physicalSourceFace[2][0] - physicalSourceFace[1][0]) * photoFaceBottomExtensionRatio, physicalSourceFace[2][1] + (physicalSourceFace[2][1] - physicalSourceFace[1][1]) * photoFaceBottomExtensionRatio + topExtensionSvgUnits],
      [physicalSourceFace[3][0] + (physicalSourceFace[3][0] - physicalSourceFace[0][0]) * photoFaceBottomExtensionRatio, physicalSourceFace[3][1] + (physicalSourceFace[3][1] - physicalSourceFace[0][1]) * photoFaceBottomExtensionRatio + topExtensionSvgUnits],
    ];
    const boundsOf = (points: [number, number][]) => ({
      left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x)),
      top: Math.min(...points.map(([, y]) => y)), bottom: Math.max(...points.map(([, y]) => y)),
    });
    const sourceFace = boundsOf(sourceFacePoints);
    const deskFace = boundsOf([
      productPhoto.printableFace.topLeft, productPhoto.printableFace.topRight,
      productPhoto.printableFace.bottomRight, productPhoto.printableFace.bottomLeft,
    ]);
    const targetCenterX = deskFace.left + ((minX + maxX) / 2 - sourceFace.left) /
      (sourceFace.right - sourceFace.left) * (deskFace.right - deskFace.left);
    const targetCenterY = deskFace.top + ((minY + maxY) / 2 - sourceFace.top) /
      (sourceFace.bottom - sourceFace.top) * (deskFace.bottom - deskFace.top);
    const targetWidth = artWidth / (sourceFace.right - sourceFace.left) * (deskFace.right - deskFace.left);
    // Apply a uniform scale from sleeve-face width. Independent X/Y normalization would
    // stretch artwork when the source hat photo and the desk photo have different face ratios.
    const targetHeight = artHeight / (sourceFace.right - sourceFace.left) * (deskFace.right - deskFace.left);
    const target = artworkQuad.map(([x, y]) => [
      targetCenterX + (x - calibration.centerX) * targetWidth / width,
      targetCenterY + (y - calibration.centerY) * targetHeight / height,
    ]) as [number, number][];

    const master = await loadStudioImage(productPhoto.masterSrc);
    if (master.naturalWidth !== productPhoto.width || master.naturalHeight !== productPhoto.height) {
      throw new Error("The desk master image dimensions do not match its approved calibration.");
    }
    const canvas = document.createElement("canvas"); canvas.width = productPhoto.width; canvas.height = productPhoto.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The desk product-image canvas is unavailable.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // Inverse homography samples each output pixel from the source bitmap. This avoids
    // triangle-mesh seams and interpolates premultiplied alpha so transparent holes stay clean.
    const correspondences = [
      [target[0][0], target[0][1], 0, 0], [target[1][0], target[1][1], artWidth, 0],
      [target[2][0], target[2][1], artWidth, artHeight], [target[3][0], target[3][1], 0, artHeight],
    ];
    const equations: number[][] = [], values: number[] = [];
    for (const [x, y, u, v] of correspondences) {
      equations.push([x,y,1,0,0,0,-u*x,-u*y]); values.push(u);
      equations.push([0,0,0,x,y,1,-v*x,-v*y]); values.push(v);
    }
    for (let col=0; col<8; col++) {
      let pivot=col; for(let row=col+1;row<8;row++) if(Math.abs(equations[row][col])>Math.abs(equations[pivot][col])) pivot=row;
      [equations[col],equations[pivot]]=[equations[pivot],equations[col]]; [values[col],values[pivot]]=[values[pivot],values[col]];
      const divisor=equations[col][col]; if(Math.abs(divisor)<1e-12) throw new Error("Calibration 08 perspective transform is singular.");
      for(let j=col;j<8;j++) equations[col][j]/=divisor; values[col]/=divisor;
      for(let row=0;row<8;row++) if(row!==col) { const factor=equations[row][col]; for(let j=col;j<8;j++) equations[row][j]-=factor*equations[col][j]; values[row]-=factor*values[col]; }
    }
    const [h0,h1,h2,h3,h4,h5,h6,h7]=values;
    const sourcePixels=artContext.getImageData(0,0,artWidth,artHeight).data;
    const outputPixels=context.createImageData(canvas.width,canvas.height);
    const minTargetX=Math.max(0,Math.floor(Math.min(...target.map(([x])=>x))));
    const maxTargetX=Math.min(canvas.width-1,Math.ceil(Math.max(...target.map(([x])=>x))));
    const minTargetY=Math.max(0,Math.floor(Math.min(...target.map(([,y])=>y))));
    const maxTargetY=Math.min(canvas.height-1,Math.ceil(Math.max(...target.map(([,y])=>y))));
    const sourceFaceArray = [sourceFacePoints[0], sourceFacePoints[1], sourceFacePoints[2], sourceFacePoints[3]];
    const deskFaceVertices = [productPhoto.printableFace.topLeft, productPhoto.printableFace.topRight, productPhoto.printableFace.bottomRight, productPhoto.printableFace.bottomLeft];
    const extendBothEdges = (face: [number, number][]) => [
      [face[0][0] + (face[0][0] - face[3][0]) * photoFaceExtensionRatio, face[0][1] + (face[0][1] - face[3][1]) * photoFaceExtensionRatio] as [number, number],
      [face[1][0] + (face[1][0] - face[2][0]) * photoFaceExtensionRatio, face[1][1] + (face[1][1] - face[2][1]) * photoFaceExtensionRatio] as [number, number],
      [face[2][0] + (face[2][0] - face[1][0]) * photoFaceBottomExtensionRatio, face[2][1] + (face[2][1] - face[1][1]) * photoFaceBottomExtensionRatio] as [number, number],
      [face[3][0] + (face[3][0] - face[0][0]) * photoFaceBottomExtensionRatio, face[3][1] + (face[3][1] - face[0][1]) * photoFaceBottomExtensionRatio] as [number, number],
    ];
    const facePoly=extendBothEdges(deskFaceVertices);
    const insideFace=(x:number,y:number) => { let inside=false; for(let i=0,j=facePoly.length-1;i<facePoly.length;j=i++) { const [xi,yi]=facePoly[i],[xj,yj]=facePoly[j]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside; } return inside; };
    // The Studio SVG already applies the selected artwork opacity and carries
    // the embossed face, highlights, and relief layers. Keep the front-face
    // colors independent of the sleeve master pixels so its TPU grain cannot
    // appear through otherwise opaque lettering.
    for(let y=minTargetY;y<=maxTargetY;y++) for(let x=minTargetX;x<=maxTargetX;x++) {
      const px=x+.5,py=y+.5; if(!insideFace(px,py)) continue;
      const denominator=h6*px+h7*py+1; if(Math.abs(denominator)<1e-9) continue;
      const sx=(h0*px+h1*py+h2)/denominator, sy=(h3*px+h4*py+h5)/denominator;
      if(sx<0||sy<0||sx>=artWidth||sy>=artHeight) continue;
      const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(artWidth-1,x0+1),y1=Math.min(artHeight-1,y0+1),fx=sx-x0,fy=sy-y0;
      const samples=[[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]];
      let alpha=0,red=0,green=0,blue=0;
      for(const [ix,iy,weight] of samples) { const at=(iy*artWidth+ix)*4, a=sourcePixels[at+3]/255*weight; alpha+=a; red+=sourcePixels[at]*a; green+=sourcePixels[at+1]*a; blue+=sourcePixels[at+2]*a; }
      if(alpha<=0) continue;
      const at=(y*canvas.width+x)*4; outputPixels.data[at]=Math.round(red/alpha); outputPixels.data[at+1]=Math.round(green/alpha); outputPixels.data[at+2]=Math.round(blue/alpha); outputPixels.data[at+3]=Math.round(alpha*255);
    }
    const overlayPixels = outputPixels;
    context.putImageData(overlayPixels, 0, 0);
    context.globalAlpha = 1;
    const resultContext = canvas.getContext("2d");
    if (!resultContext) throw new Error("The desk product-image output is unavailable.");
    resultContext.globalCompositeOperation = "destination-over";
    resultContext.drawImage(master, 0, 0);
    resultContext.globalCompositeOperation = "source-over";
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error("Desk product PNG encoding failed.")),"image/png"));
  }

  async function handleExportPNG() {
    try {
      const png = await renderStudioPNGBlob();
      downloadPNGBlob(png, `snapink-preview-${Date.now()}-${exportScale}x.png`);
    } catch (error) {
      console.error("Studio PNG export could not be rendered.", error);
      alert(error instanceof Error ? error.message : "The Studio preview could not be converted to a PNG. Please try again.");
    }
  }

  function productPhotoSlug() {
    const label = text.trim() || logoName.replace(/\.[^.]+$/, "") || "custom-design";
    const slug = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "custom-design";
  }

  function shopImageDesignSignature() {
    return JSON.stringify({variant,text,font,fontSize,fontWeight,tracking,lineHeight,fill,stroke,strokeWidth,styleMode,arc,posX,posY,logoPosY,align,safeMargin,backgroundColor,logoDataUrl,logoScale,artworkHeightScale,logoOpacity,sleeveSize,lifestyleCalibration});
  }

  async function renderLifestyleProductPhoto(key:"maleLifestyle"|"femaleLifestyle", artworkImage:HTMLImageElement) {
    const master=await loadStudioImage(`/images/product_images/${key==="maleLifestyle"?"male_master.png":"female_master.png"}`);
    if(master.naturalWidth!==1448||master.naturalHeight!==1086) throw new Error("The approved lifestyle master must remain 4:3.");
    const canvas=document.createElement("canvas");canvas.width=master.naturalWidth;canvas.height=master.naturalHeight;
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("The lifestyle image canvas is unavailable.");
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(master,0,0);
    // Female master has a small fixed photo registration offset; the admin controls remain one shared male-master calibration.
    const registration=key==="femaleLifestyle"?{x:5,y:12,width:-2,height:-5}:{x:0,y:0,width:0,height:0};
    const c=lifestyleCalibration,x=c.x+registration.x,y=c.y+registration.y,w=c.width+registration.width,h=c.height+registration.height;
    const angle=(Number(c.rotation)||0)*Math.PI/180,inset=w*Math.max(-0.8,Math.min(0.8,Number(c.perspective)||0))/200;
    const rotatePoint=(px:number,py:number):[number,number]=>[x+w/2+px*Math.cos(angle)-py*Math.sin(angle),y+h/2+px*Math.sin(angle)+py*Math.cos(angle)];
    const target=[rotatePoint(-w/2+inset,-h/2),rotatePoint(w/2-inset,-h/2),rotatePoint(w/2,h/2),rotatePoint(-w/2,h/2)];
    const source:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[artworkImage.naturalWidth,0],[artworkImage.naturalWidth,artworkImage.naturalHeight],[0,artworkImage.naturalHeight]];
    const drawTriangle=(ids:[number,number,number])=>{const [i0,i1,i2]=ids,[sx0,sy0]=source[i0],[sx1,sy1]=source[i1],[sx2,sy2]=source[i2],[dx0,dy0]=target[i0],[dx1,dy1]=target[i1],[dx2,dy2]=target[i2];const det=sx0*(sy1-sy2)+sx1*(sy2-sy0)+sx2*(sy0-sy1);if(!det)return;const a=(dx0*(sy1-sy2)+dx1*(sy2-sy0)+dx2*(sy0-sy1))/det,cx=(dx0*(sx2-sx1)+dx1*(sx0-sx2)+dx2*(sx1-sx0))/det,e=(dx0*(sx1*sy2-sx2*sy1)+dx1*(sx2*sy0-sx0*sy2)+dx2*(sx0*sy1-sx1*sy0))/det,b=(dy0*(sy1-sy2)+dy1*(sy2-sy0)+dy2*(sy0-sy1))/det,d=(dy0*(sx2-sx1)+dy1*(sx0-sx2)+dy2*(sx1-sx0))/det,f=(dy0*(sx1*sy2-sx2*sy1)+dy1*(sx2*sy0-sx0*sy2)+dy2*(sx0*sy1-sx1*sy0))/det;ctx.save();ctx.beginPath();ctx.moveTo(dx0,dy0);ctx.lineTo(dx1,dy1);ctx.lineTo(dx2,dy2);ctx.closePath();ctx.clip();ctx.transform(a,b,cx,d,e,f);ctx.drawImage(artworkImage,0,0);ctx.restore();};
    // Two clipped affine triangles map artwork through the shared four-corner perspective quad.
    drawTriangle([0,1,2]);drawTriangle([0,2,3]);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Lifestyle PNG encoding failed.")),"image/png"));
  }

  async function renderRearProductPhoto(sleeveImage: HTMLImageElement, productStyle: SleeveVariant = variant) {
    const hatImage = await loadStudioImage(REAR_PRODUCT_PHOTO.hatSrc);
    if (hatImage.naturalWidth !== REAR_PRODUCT_PHOTO.width || hatImage.naturalHeight !== REAR_PRODUCT_PHOTO.height) {
      throw new Error("The approved rear hat master has unexpected dimensions.");
    }
    const composition = document.createElement("canvas");
    composition.width = REAR_PRODUCT_PHOTO.width;
    composition.height = REAR_PRODUCT_PHOTO.height;
    const context = composition.getContext("2d");
    if (!context) throw new Error("The product-image canvas is unavailable.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(hatImage, 0, 0);

    // Keep Billboard's approved rear-photo datum untouched. Standard shares the
    // same hat opening and artwork scale, with its own CAD groove fraction.
    const grooveFraction = productStyle === "billboard"
      ? REAR_PRODUCT_PHOTO.grooveSourceX / REAR_PRODUCT_PHOTO.studioExportWidth
      : sleeveGrooveFractionFor("standard", previewSleeveSize);
    const sleeveWidth = Math.round(
      (REAR_PRODUCT_PHOTO.rightStrapOpeningX - REAR_PRODUCT_PHOTO.leftStrapExitX) / (1 - grooveFraction)
    );
    const sleeveHeight = Math.round(sleeveWidth * sleeveImage.naturalHeight / sleeveImage.naturalWidth);
    const sleeveLeft = Math.round(REAR_PRODUCT_PHOTO.leftStrapExitX - grooveFraction * sleeveWidth);
    const extensionPixels = sleeveWidth * MAX_TOP_ARTWORK_EXTENSION_MM / overallLengthMm;
    // The sleeve PNG reserves identical transparent margins above and below;
    // its midpoint therefore remains the original physical sleeve midpoint.
    const sleeveTop = Math.round(
      REAR_PRODUCT_PHOTO.sleeveCenterY - sleeveHeight / 2
      - (productStyle === "standard" ? 5 : 0)
    );
    context.drawImage(sleeveImage, sleeveLeft, sleeveTop, sleeveWidth, sleeveHeight);
    // Frame the completed, calibrated hat + sleeve composition as a unit. The
    // square canvas gives the hat consistent Shop sizing without moving or
    // scaling the sleeve independently of the master photograph.
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const framedContext = canvas.getContext("2d");
    if (!framedContext) throw new Error("The product-image canvas is unavailable.");
    framedContext.fillStyle = "#ffffff";
    framedContext.fillRect(0, 0, canvas.width, canvas.height);
    framedContext.drawImage(composition, (canvas.width - composition.width) / 2, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (output) => output ? resolve(output) : reject(new Error("Product image PNG encoding failed.")),
      "image/png"
    ));
  }

  async function renderPackagingProductImage(sleeveImage: HTMLImageElement) {
    const packageImage = await loadStudioImage(PACKAGING_PRODUCT_PHOTO.packageSrc);
    return await renderPackagingProductPhoto(packageImage, sleeveImage);
  }

  function productPhotoStageError(name: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(`${name} failed: ${detail}`);
  }

  async function handleGenerateProductImage() {
    if (!enableProductPhotoGeneration || isGeneratingProductImage || productPhotoChoice.length===0) return;
    if (artworkInvalid) {
      alert(`Artwork exceeds ${artworkInvalidBoundary}. Move or resize it before generating product images.`);
      return;
    }
    setIsGeneratingProductImage(true);
    let sleeveUrl: string | null = null;
    try {
      const slug=productPhotoSlug();
      sleeveUrl=URL.createObjectURL(await renderStudioPNGBlob({sleeveOnly:true,scale:REAR_PRODUCT_PHOTO.scale}));
      const sleeveImage=await loadStudioImage(sleeveUrl);
      const labels=Object.fromEntries(productPhotoOptions.map(x=>[x.key,x.label]));
      const needsSleeve=productPhotoChoice.some(key=>key==="rear"||key==="packaging"||key==="desk");
      let artworkImage:HTMLImageElement|null=null;
      if(productPhotoChoice.some(key=>key==="maleLifestyle"||key==="femaleLifestyle")){const artUrl=URL.createObjectURL(await renderStudioPNGBlob({sleeveOnly:true,artworkOnly:true,scale:REAR_PRODUCT_PHOTO.scale}));try{artworkImage=await loadStudioImage(artUrl);}finally{URL.revokeObjectURL(artUrl);}}
      if(!needsSleeve){URL.revokeObjectURL(sleeveUrl);sleeveUrl=null;}
      const entries:{key:string;label:string;filename:string;blob:Blob}[]=[];
      for(const [i,key] of productPhotoChoice.entries()) {
        setProductPhotoProgress(`Generating ${labels[key]} (${i+1} of ${productPhotoChoice.length})…`);
        let blob:Blob;
        if(key==="rear")blob=await renderRearProductPhoto(sleeveImage,variant);
        else if(key==="packaging")blob=await renderPackagingProductImage(sleeveImage);
        else if(key==="desk")blob=await renderDeskProductPhoto(variant);
        else {if(!artworkImage)throw new Error("Studio artwork could not be prepared.");blob=await renderLifestyleProductPhoto(key,artworkImage);}
        const imageSlug:Record<ProductPhotoKey,string>={rear:"on-hat",packaging:"packaging",desk:"on-desk",maleLifestyle:"male-lifestyle",femaleLifestyle:"female-lifestyle"};
        const filename=`snapink-${variant}-${slug}-${imageSlug[key]}.png`;
        entries.push({key,label:labels[key],filename,blob});
      }
      setGeneratedPhotoEntries(entries);setGeneratedShopImages(Object.fromEntries(entries.map(x=>[x.key,x.blob])));
      setShopImageSelection(entries.map(x=>x.key));setGeneratedShopImageSignature(shopImageDesignSignature());
      if(entries.length===1)downloadPNGBlob(entries[0].blob,entries[0].filename);
      else {const zip=await createProductPhotoZip(entries);downloadProductPhotoZip(zip,`snapink-${variant}-${slug}-product-images.zip`);}
    } catch (error) {
      console.error("SnapInk product image could not be generated.", error);
      alert(error instanceof Error ? error.message : "The product image could not be generated. Please try again.");
    } finally {
      if (sleeveUrl) URL.revokeObjectURL(sleeveUrl);
      setIsGeneratingProductImage(false);
      setProductPhotoProgress("");
    }
  }
  async function handleStudioAdminAccess() {
    if (!generatedShopImages) { alert("Generate product images first, then click Add to Shop."); return; }
    const token=window.prompt("Administrator token")||"";if(!token)return;
    try {
      const response=await fetch("/api/admin/studio-shop-product",{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if(!response.ok)throw new Error(response.status===401?"Administrator token was not accepted.":"Shop publishing is not configured yet.");
      setStudioAdminToken(token);
    } catch(error) { alert(error instanceof Error?error.message:"Administrator access could not be verified."); }
  }
  function handleAddToShop() {
    if (!studioAdminToken) return;
    if (!generatedShopImages) { alert("Generate product images first, then click Add to Shop."); return; }
    if (generatedShopImageSignature !== shopImageDesignSignature()) { setGeneratedShopImages(null);setGeneratedPhotoEntries([]); alert("The design changed after these images were generated. Generate the product images again before publishing."); return; }
    setPublishProductName(text.trim()||logoName.replace(/\.[^.]+$/, ""));setPublishProductCardDescription("");setPublishProductDescription("");setPublishProductStatus("");setApproveExtendedArtwork(false);setShowPublishProduct(true);
  }
  async function handlePublishProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!generatedShopImages||publishingProduct)return;
    if (artworkIsExtended && (!approveExtendedArtwork || artworkInvalid)) { setPublishProductStatus("Extended artwork needs explicit admin pricing approval and must remain inside the permitted boundaries."); return; }
    setPublishingProduct(true);setPublishProductStatus("Publishing product…");
    const form=new FormData();form.set("name",publishProductName);form.set("cardDescription",publishProductCardDescription);form.set("description",publishProductDescription);form.set("style",variant);form.set("color",backgroundColor);
    for(const key of shopImageSelection){const entry=generatedPhotoEntries.find(x=>x.key===key);if(entry)form.append("galleryImages",entry.blob,entry.filename);}
    form.set("extendedArtwork", artworkIsExtended ? "true" : "false");form.set("artworkExtensionMm",String(artworkExtensionMm));form.set("artworkWidthMm",String(selectedArtworkWidthMm));form.set("artworkHeightMm",String(selectedArtworkHeightMm));form.set("artworkHeightScale",String(artworkHeightScale));form.set("artworkCenterXmm",String(productionDraftPosition.centerXmm));form.set("artworkCenterYmm",String(productionCenterYmm));form.set("approveExtendedArtwork",approveExtendedArtwork ? "true" : "false");
    try {
      const response=await fetch("/api/admin/studio-shop-product",{method:"POST",headers:{Authorization:`Bearer ${studioAdminToken}`},body:form});const result=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(result?.error||"Product could not be published.");
      setPublishProductStatus(result.duplicate?"This product was already published: ":"Product published: ");
      setPublishProductStatus(`${result.duplicate?"This product was already published: ":"Product published: "}${location.origin}${result.product.url}`);
    } catch(error) {setPublishProductStatus(error instanceof Error?error.message:"Product could not be published.");}
    finally{setPublishingProduct(false);}
  }
  async function handleGetOrderFiles() {
    if (logoNeedsRemoval) throw new Error("Finish logo background removal before submitting the design.");
    if (artworkExceedsAllowedExtension) throw new Error(`Artwork exceeds ${artworkInvalidBoundary}.`);
    if (artworkStatus.crossesLockedEdge) throw new Error(`Artwork exceeds ${artworkInvalidBoundary}. Move or resize it before submitting.`);
    if (artworkStatus.violatesClearance) throw new Error(`Artwork exceeds ${artworkInvalidBoundary}; keep at least 1 mm clearance.`);
    const source = logoDataUrl;
    const hasTextArtwork = text.trim().length > 0;
    const blankDesign = !source && !hasTextArtwork;
    const resolveDataUrl = async (url: string): Promise<string> => {
      if (url.startsWith("data:")) return url;
      const parsed = new URL(url, window.location.href);
      if (parsed.origin !== window.location.origin) throw new Error("Artwork must be stored locally before submission.");
      const response = await fetch(parsed.href, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Could not package the original artwork.");
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not package the artwork file."));
        reader.readAsDataURL(blob);
      });
    };
    const emptyArtworkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${viewH}" viewBox="0 0 1600 ${viewH}"></svg>`;
    const sourceArtwork = logoSourceFile ? await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not package the original uploaded artwork."));
      reader.readAsDataURL(logoSourceFile);
    }) : source ? await resolveDataUrl(source) : await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not package the empty Studio artwork source."));
      reader.readAsDataURL(new Blob([emptyArtworkSvg], { type: "image/svg+xml;charset=utf-8" }));
    });
    const svg = svgRef.current;
    if (!svg) throw new Error("Studio preview is unavailable.");
    const previewSvg = svg.cloneNode(true) as SVGSVGElement;
    previewSvg.querySelectorAll('[data-preview-only="true"]').forEach((node) => node.remove());
    previewSvg.removeAttribute("style");
    for (const image of Array.from(previewSvg.querySelectorAll("image"))) {
      const href = image.getAttribute("href");
      if (href) image.setAttribute("href", await resolveDataUrl(href));
    }
    const previewTopPadding = MAX_TOP_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    const previewBottomPadding = MAX_BOTTOM_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    previewSvg.setAttribute("viewBox", `0 ${-previewTopPadding} ${viewW} ${viewH + previewTopPadding + previewBottomPadding}`);
    previewSvg.setAttribute("width", String(viewW));
    previewSvg.setAttribute("height", String(viewH + previewTopPadding + previewBottomPadding));
    const previewXml = new XMLSerializer().serializeToString(previewSvg);

    // Saved/manufacturing SVGs stay in the original CAD coordinate system and
    // never contain the presentation photo. Only the separate PNG preview has
    // the product image composited beneath the artwork.
    const artworkSvgNode = previewSvg.cloneNode(true) as SVGSVGElement;
    artworkSvgNode.querySelectorAll('[data-mobile-photographic-text-offset="true"]').forEach((node) => {
      node.removeAttribute("transform");
    });
    artworkSvgNode.querySelectorAll('[data-product-image="true"]').forEach((node) => node.remove());
    const artworkOverlay = artworkSvgNode.querySelector<SVGGElement>('[data-artwork-overlay="true"]');
    const artworkClip = artworkSvgNode.querySelector<SVGGElement>('[data-artwork-clip="true"]');
    artworkOverlay?.removeAttribute("transform");
    artworkClip?.setAttribute("clip-path", `url(#${surfaceClipId}-printable-cad)`);
    const productionTopPadding = MAX_TOP_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    const productionBottomPadding = MAX_BOTTOM_ARTWORK_EXTENSION_MM * viewH / (bounds.maxY - bounds.minY);
    artworkSvgNode.setAttribute("viewBox", `0 ${-productionTopPadding} ${viewW} ${viewH + productionTopPadding + productionBottomPadding}`);
    artworkSvgNode.setAttribute("width", String(viewW));
    artworkSvgNode.setAttribute("height", String(viewH + productionTopPadding + productionBottomPadding));
    const artworkXml = new XMLSerializer().serializeToString(artworkSvgNode);
    const xml = blankDesign ? emptyArtworkSvg : artworkXml;
    const artworkSvg = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not package the production SVG."));
      reader.readAsDataURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    });
    const svgUrl = URL.createObjectURL(new Blob([previewXml], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const sleeveImage = await loadStudioImage(svgUrl);
      const ghostImage = ghostHat
        ? await loadStudioImage(await resolveDataUrl(renderedHatImagePath))
        : null;
      const lifestyleImage = isCityLifestylePreview
        ? await loadStudioImage(await resolveDataUrl(lifestyleBackgroundPath))
        : null;
      // A 1.25× stage preview includes the hat and corrected overlay placement
      // while remaining below the existing private preview upload size limit.
      const previewScale = 1.25;
      const canvas = document.createElement("canvas");
      canvas.width = ghostHat
        ? Math.round(viewW * previewScale)
        : Math.round(viewW * sleeveScaleRatio * previewScale);
      canvas.height = ghostHat
        ? Math.round(canvas.width / stageAspectRatio)
        : Math.round(previewViewH * sleeveScaleRatio * previewScale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Preview rendering is unavailable.");
      drawStudioComposition(
        context,
        canvas,
        sleeveImage,
        ghostImage,
        sleevePreviewWidthPercent,
        sleevePreviewHeightPercent,
        currentHatProfile,
        cameraZoom,
        sleeveGrooveFraction,
        stageComposition.rotationDeg,
        sleevePreviewCenterXPercent,
        sleevePreviewBottomYPercent,
        !isMobilePreview,
        lifestyleImage
        ,0,
        true
      );
      const previewBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (output) => output ? resolve(output) : reject(new Error("Could not encode the design preview.")),
        "image/png"
      ));
      const previewPng = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not package the design preview."));
        reader.readAsDataURL(previewBlob);
      });
      // Create a smaller private preview attachment so the order email stays within Cloudflare's message-size limit.
      const maxEmailPreviewBytes = 3.4 * 1024 * 1024;
      const emailCanvas = document.createElement("canvas");
      let emailScale = Math.min(1, 1440 / Math.max(canvas.width, canvas.height));
      let emailPreviewBlob: Blob | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        emailCanvas.width = Math.max(1, Math.round(canvas.width * emailScale));
        emailCanvas.height = Math.max(1, Math.round(canvas.height * emailScale));
        const emailContext = emailCanvas.getContext("2d");
        if (!emailContext) throw new Error("Could not prepare the design email attachment.");
        emailContext.drawImage(canvas, 0, 0, emailCanvas.width, emailCanvas.height);
        emailPreviewBlob = await new Promise<Blob>((resolve, reject) => emailCanvas.toBlob(
          (output) => output ? resolve(output) : reject(new Error("Could not encode the email design preview.")),
          "image/png"
        ));
        if (emailPreviewBlob.size <= maxEmailPreviewBytes) break;
        emailScale *= 0.8;
      }
      if (!emailPreviewBlob || emailPreviewBlob.size > maxEmailPreviewBytes) throw new Error("The design preview is too large to attach to the order email. Please simplify the image and try again.");
      const emailPreviewPng = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not package the email design preview."));
        reader.readAsDataURL(emailPreviewBlob);
      });
      // Text-only orders have no separately uploaded source file. Preserve the
      // exact Studio vector export as their source record; the companion uses
      // the saved text/font settings to generate manufacturing outlines.
      return { artworkSvg, previewPng, emailPreviewPng, sourceArtwork: sourceArtwork || artworkSvg };
    } finally { URL.revokeObjectURL(svgUrl); }
  }

  useImperativeHandle(ref, () => ({ downloadPNG: handleExportPNG, getOrderFiles: handleGetOrderFiles }), [
    exportScale, sleeveScaleRatio, viewW, viewH, previewViewH, surfaceClipId,
    sleevePreviewWidthPercent, sleevePreviewCenterYPercent, sleevePreviewBottomYPercent,
    sleevePreviewHeightPercent, sleevePreviewCenterXPercent, sleeveSize, ghostHat,
    currentHatTemplate, currentHatProfile, cameraZoom, sleeveGrooveFraction,
    stageComposition.rotationDeg, stageAspectRatio, isMobilePreview,
    logoNeedsRemoval, logoDataUrl, logoSourceFile, text,
  ]);

  const textAnchor =
    align === "start" ? "start" : align === "end" ? "end" : "middle";

  const renderStudioText = () => (
    <text
      fontFamily={font}
      fontSize={scaledFontSize}
      fontWeight={fontWeight}
      letterSpacing={`${tracking}em`}
      fill={fill}
      stroke={strokeWidth > 0 ? stroke : "none"}
      strokeWidth={strokeWidth * (viewH / 450)}
      dominantBaseline="central"
      textAnchor={textAnchor}
      paintOrder="stroke fill"
    >
      {Math.abs(arc) < 1
        ? text.split("\n").map((line, i, arr) => (
            <tspan
              key={i}
              x={(renderPosX / 100) * 1600}
              y={textCenterCanvasY + (i - (arr.length - 1) / 2) * (scaledFontSize * lineHeight)}
            >
              {line}
            </tspan>
          ))
        : (() => {
            const lines = text.split("\n");
            const centerOffset = clamp(renderPosX, safeMargin, 100 - safeMargin);
            const lineGapPct = ((scaledFontSize * lineHeight) / viewH) * 100;
            return lines.map((line, i) => {
              const offsetPct = centerOffset + (i - (lines.length - 1) / 2) * lineGapPct;
              return (
                <textPath
                  key={i}
                  href={`#${pathId}`}
                  startOffset={`${clamp(offsetPct, safeMargin, 100 - safeMargin)}%`}
                >
                  {line}
                </textPath>
              );
            });
          })()}
    </text>
  );

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload a PNG, JPG, SVG, or another image file.");
      e.target.value = "";
      return;
    }
    measuredLogoDataUrlRef.current = "";

    const task = ++logoUploadTaskRef.current;
    logoRemovalLockRef.current = 0;
    setLogoRemovalBusy(false);
    setLogoRemovalProgress(0);
    setLogoRemovalMessage("Checking image transparency…");
    setLogoNeedsRemoval(false);
    setLogoHasProcessedRemoval(false);
    setLogoSourceFile(file);
    setLogoDataUrl("");
    setLogoName(file.name);
    inspectTransparency(file).then((hasTransparency) => {
      if (task !== logoUploadTaskRef.current) return;
      setLogoNeedsRemoval(!hasTransparency);
      setLogoRemovalMessage(hasTransparency
        ? "Transparent background detected. The logo is ready to use."
        : "This image has a solid background. Remove it to place only the artwork on the sleeve.");
      if (!hasTransparency) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (task === logoUploadTaskRef.current && typeof reader.result === "string") {
          setLogoDataUrl(reader.result);
          if (instance === "mobile") setMobileEntryCollapsed(true);
        }
      };
      reader.onerror = () => {
        if (task === logoUploadTaskRef.current) setLogoRemovalMessage("This image could not be read. Please try another image or a transparent PNG.");
      };
      reader.readAsDataURL(file);
    }).catch(() => {
      if (task === logoUploadTaskRef.current) {
        setLogoNeedsRemoval(true);
        setLogoRemovalMessage("Could not verify transparency. Try automatic removal or upload a transparent PNG.");
      }
    });
  }

  async function removeLogoBackground() {
    if (logoRemovalLockRef.current !== 0) return;
    const file = logoSourceFile;
    if (!file) {
      setLogoRemovalMessage("Please select the logo image again, then try background removal.");
      return;
    }
    const task = ++logoUploadTaskRef.current;
    logoRemovalLockRef.current = task;
    setLogoRemovalBusy(true);
    setLogoRemovalProgress(0);
    setLogoRemovalMessage("Starting background removal on this device. On first use, the AI model downloads and may take a moment.");
    try {
      const { removeBackground } = await import("@bg0/browser");
      const result = await removeBackground(file, {
        quality: "quality",
        onProgress: ({ progress, message }: { progress: number; stage: string; message: string }) => {
          if (task === logoUploadTaskRef.current) {
            setLogoRemovalProgress(Math.round(progress * 100));
            setLogoRemovalMessage(message);
          }
        },
      });
      if (task !== logoUploadTaskRef.current) return;
      const outputFile = new File([result.blob], file.name.replace(/\.[^.]+$/, "") + "-transparent.png", { type: "image/png" });
      const transparent = await inspectTransparency(outputFile);
      if (!transparent) throw new Error("The result did not contain transparency.");
      const reader = new FileReader();
      reader.onload = () => {
        if (task !== logoUploadTaskRef.current || typeof reader.result !== "string") return;
        setLogoDataUrl(reader.result);
        if (instance === "mobile") setMobileEntryCollapsed(true);
        setLogoName(outputFile.name);
        setLogoNeedsRemoval(false);
        setLogoHasProcessedRemoval(true);
        setLogoRemovalMessage("Background removed on this device. Review the edges; if details are missing, upload a transparent PNG.");
      };
      reader.onerror = () => {
        if (task === logoUploadTaskRef.current) setLogoRemovalMessage("The transparent result could not be loaded. Please upload a transparent PNG.");
      };
      reader.readAsDataURL(outputFile);
    } catch (error) {
      if (task === logoUploadTaskRef.current) {
        console.error("SnapInk logo background removal failed", error);
        setLogoRemovalMessage("Automatic background removal could not complete reliably. Please upload a transparent PNG.");
      }
    } finally {
      if (logoRemovalLockRef.current === task) {
        logoRemovalLockRef.current = 0;
        if (task === logoUploadTaskRef.current) setLogoRemovalBusy(false);
      }
    }
  }

  function clearLogo() {
    logoUploadTaskRef.current += 1;
    logoRemovalLockRef.current = 0;
    setLogoDataUrl("");
    setLogoName("");
    setLogoSourceFile(null);
    setLogoNeedsRemoval(false);
    setLogoHasProcessedRemoval(false);
    setLogoRemovalBusy(false);
    setLogoRemovalMessage("");
    setLogoInputVersion((version) => version + 1);
  }

  const dismissArtworkTransparencyWarning = () => {
    setShowArtworkTransparencyWarning(false);
    try {
      window.localStorage.setItem("snapink.artworkTransparencyWarning.dismissed.v1", "true");
    } catch {
      // The warning remains dismissed for this mounted session when storage is unavailable.
    }
  };

  const artworkTransparencyWarning = (desktop = false) => showArtworkTransparencyWarning ? (
    <aside aria-label="Artwork transparency requirement" className={`relative rounded-lg border border-[#D8C08C] bg-[#F4E7C7] px-2.5 py-2 pr-11 text-left text-[#17130B] sm:p-3 sm:pr-12${desktop ? " snapink-basic-panel-info" : ""}`}>
      <button type="button" onClick={dismissArtworkTransparencyWarning} aria-label="Dismiss artwork transparency warning" title="Dismiss warning" className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-xl font-semibold leading-none text-[#17130B] hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5A4212]">×</button>
      <p className="snapink-basic-panel-light-text pr-1 text-[10px] font-black leading-snug sm:pr-0 sm:text-xs">IMPORTANT: REMOVE YOUR IMAGE BACKGROUND BEFORE UPLOADING</p>
      <p className="snapink-basic-panel-light-text mt-1 text-[10px] leading-snug sm:text-xs">Your logo or artwork must have a transparent background. White, black, or colored backgrounds may appear on your finished sleeve. Remove the background before uploading for the best results.</p>
      <p className="snapink-basic-panel-light-text mt-1 text-[10px] font-semibold leading-snug sm:text-xs">Recommended format: PNG with transparency.</p>
      <a className="mt-1 inline-block text-[10px] font-bold leading-snug text-[#5A4212] underline decoration-[#8D6D26] underline-offset-2 hover:text-black sm:text-xs" href="https://www.remove.bg/" target="_blank" rel="noopener noreferrer">Need to remove your background? Remove it here ↗</a>
    </aside>
  ) : null;

  const logoControls = (instance: "mobile" | "desktop") => (
    <div className={instance === "mobile" ? "snapink-mobile-upload-content" : "space-y-3"}>
      <div>
        {instance === "mobile" ? <div className="snapink-mobile-upload-picker">
          <span className="snapink-mobile-control-label" style={mobileOverlayWhiteTextStyle}>Upload Artwork</span>
          {artworkTransparencyWarning(instance === "desktop")}
          <div className="snapink-mobile-upload-row">
            <button type="button" className="snapink-mobile-choose-image" style={{ color: "#FFFFFF", WebkitTextFillColor: "#FFFFFF", textShadow: "0 1px 3px rgba(0, 0, 0, 0.85)" }} onClick={() => mobileLogoInputRef.current?.click()}>Choose Image</button>
            {logoName && <span className="snapink-mobile-upload-status" title={logoName} aria-label={`Artwork uploaded: ${logoName}`}>
              <span aria-hidden="true">✓</span> Artwork uploaded
            </span>}
            {logoName && <button type="button" onClick={clearLogo} className="snapink-mobile-remove-artwork" aria-label="Remove uploaded artwork" title="Remove uploaded artwork">Remove</button>}
            {(logoNeedsRemoval || logoHasProcessedRemoval || logoRemovalBusy) && <button
              type="button"
              onClick={removeLogoBackground}
              disabled={logoRemovalBusy || !logoSourceFile}
              className="snapink-mobile-remove-background"
              aria-label={logoRemovalBusy ? "Removing artwork background" : logoHasProcessedRemoval ? "Retry background removal" : "Remove artwork background"}
              title={logoRemovalMessage || "Remove artwork background"}
            >
              {logoRemovalBusy ? "Working…" : logoHasProcessedRemoval ? "Retry BG" : "Remove BG"}
            </button>}
          </div>
          <input ref={mobileLogoInputRef} key={logoInputVersion} className="snapink-mobile-file-input" type="file" accept="image/*" aria-label="Upload Artwork" onChange={handleLogoUpload} />
          {logoRemovalMessage && <span className="sr-only" aria-live="polite" aria-busy={logoRemovalBusy}>{logoRemovalMessage}{logoRemovalBusy && logoRemovalProgress > 0 ? ` ${logoRemovalProgress}%` : ""}</span>}
        </div> : <>
          {artworkTransparencyWarning(true)}
          <label className="snapink-basic-panel-light-text block text-xs text-neutral-400 mb-1">Upload logo or artwork</label>
          <input
            key={logoInputVersion}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="w-full rounded-xl bg-neutral-800/80 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 file:mr-3 file:rounded-lg file:border-0 file:bg-si-button file:px-3 file:py-1.5 file:font-semibold file:text-neutral-950"
          />
        </>}
        {instance === "desktop" && logoName && <div className="snapink-basic-panel-filename-row mt-2 flex items-center justify-between gap-3 text-xs text-neutral-400">
            <span className="snapink-basic-panel-light-text truncate">{logoName}</span>
            <button type="button" onClick={clearLogo} className="snapink-desktop-artwork-remove rounded-lg border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800">Remove</button>
          </div>}
        {instance === "desktop" && logoRemovalMessage && (
          <div className="snapink-basic-panel-upload-status mt-2 space-y-2" aria-live="polite" aria-busy={logoRemovalBusy}>
            <p className={`snapink-basic-panel-light-text text-xs leading-relaxed ${logoNeedsRemoval ? "text-amber-200" : "text-neutral-400"}`}>
              {logoRemovalMessage}{logoRemovalBusy && logoRemovalProgress > 0 ? ` ${logoRemovalProgress}%` : ""}
            </p>
            {logoRemovalBusy && (
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-700" role="progressbar" aria-label="Logo background removal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={logoRemovalProgress} aria-valuetext={logoRemovalMessage}>
                <div className={`h-full rounded-full bg-si-button transition-all duration-300 ${logoRemovalProgress === 0 ? "w-1/3 animate-pulse" : ""}`} style={logoRemovalProgress > 0 ? { width: `${logoRemovalProgress}%` } : undefined} />
              </div>
            )}
            {(logoNeedsRemoval || logoHasProcessedRemoval) && (
              <button
                type="button"
                onClick={removeLogoBackground}
                disabled={logoRemovalBusy || !logoSourceFile}
                className="rounded-lg bg-si-button px-3 py-2 text-xs font-semibold text-neutral-950 hover:bg-si-hover disabled:cursor-wait disabled:opacity-60"
              >
                {logoRemovalBusy ? "Processing logo…" : logoHasProcessedRemoval ? "Retry background removal" : "Remove background"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <p className="col-span-2 text-xs leading-5 text-neutral-400">
          Artwork is centered between this sleeve’s flap groove and far-right edge, then centered vertically on the branding surface.
        </p>
      </div>
    </div>
  );

  const colorGroups = (
    <div className="snapink-color-groups" role="group" aria-label="Sleeve and artwork colors" data-preview-only="true">
      {([
        { key: "text" as const, label: "Text Fill Color", value: fill, onChange: setFill, locked: Boolean(fixedArtworkColor) },
        { key: "outline" as const, label: "Outline Color", value: stroke, onChange: setStroke, locked: false },
        { key: "sleeve" as const, label: "Sleeve Color", value: backgroundColor, onChange: setBackgroundColor, locked: Boolean(fixedProductConfiguration) },
      ]).map((color) => (
        <fieldset className="snapink-color-group" key={color.key} disabled={color.locked}>
          <legend>{color.label}</legend>
          <ColorSwatchRow value={color.value} onChange={color.onChange} />
        </fieldset>
      ))}
    </div>
  );

  const hatColorSelector = (instance: "mobile" | "desktop") => (
    <div className="snapink-hat-picker">
      <button
        type="button"
        className="snapink-hat-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={hatColorPickerOpen}
        aria-controls={`snapink-hat-colors-${uid}-${instance}`}
        onClick={() => setHatColorPickerOpen((open) => !open)}
      >
        <span className="snapink-hat-picker-trigger-swatch" style={{ backgroundColor: HAT_COLOR_SWATCHES[hatTemplateId] }} />
        <span className="snapink-hat-picker-trigger-label">Hat Color</span>
        <span className="snapink-hat-picker-trigger-value">{currentHatTemplate.displayName.replace(" Trucker Hat", "")}</span>
        <span className={`snapink-hat-picker-chevron ${hatColorPickerOpen ? "is-open" : ""}`} aria-hidden="true">⌄</span>
      </button>
      {hatColorPickerOpen && <div id={`snapink-hat-colors-${uid}-${instance}`} className="snapink-hat-picker-menu" role="group" aria-label="Choose a hat color">
        {HAT_TEMPLATE_REGISTRY.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-pressed={hatTemplateId === template.id}
            onClick={() => { setHatTemplateId(template.id); setHatColorPickerOpen(false); }}
            className={`snapink-hat-picker-option ${hatTemplateId === template.id ? "is-selected" : ""}`}
          >
            <span className="snapink-hat-picker-option-swatch" style={{ backgroundColor: HAT_COLOR_SWATCHES[template.id] }} />
            <span>{template.displayName.replace(" Trucker Hat", "")}</span>
            {hatTemplateId === template.id && <span className="snapink-hat-picker-check" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>}
      <span className="sr-only" aria-live="polite">{currentHatTemplate.displayName} selected</span>
    </div>
  );

  const previewBackgroundSelector = (
    <div className="snapink-preview-background-toggle" role="group" aria-label="Preview background">
      <button
        type="button"
        aria-pressed={previewBackground === "studio"}
        onClick={() => setPreviewBackground("studio")}
        className={previewBackground === "studio" ? "is-selected" : ""}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.25h12v9.5H2zM4 5.5h8M4 7.75h5M4 10h8" /></svg>
        <span>Studio</span>
      </button>
      <button
        type="button"
        aria-pressed={previewBackground === "city"}
        disabled={!ghostHat || fixedProductConfiguration}
        title={!ghostHat ? "Show the hat preview to use a background" : fixedProductConfiguration ? "Background selection is unavailable in this preview" : undefined}
        onClick={() => setPreviewBackground("city")}
        className={previewBackground === "city" ? "is-selected" : ""}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13.5V6h3v7.5M6.5 13.5V2.5H11v11M12.5 13.5V5H14v8.5M1.5 13.5h13" /><path d="M8 4.5h1M8 6.5h1M8 8.5h1M8 10.5h1" /></svg>
        <span>NYC Lifestyle</span>
      </button>
    </div>
  );

  const mobileOverlayWhiteTextStyle = {
    color: "#FFFFFF",
    WebkitTextFillColor: "#FFFFFF",
    opacity: 1,
    textShadow: "0 1px 3px rgba(0, 0, 0, 0.85)",
  } as const;
  const textInputControl = (instance: "mobile" | "desktop") => (
    <label className="snapink-toolbar-text">
      <span className={instance === "desktop" ? "snapink-basic-panel-light-text" : undefined} style={instance === "mobile" ? mobileOverlayWhiteTextStyle : undefined}>Text</span>
      <input aria-label="Custom text" value={text} onChange={(event) => setText(event.target.value)} placeholder={instance === "mobile" ? "YOUR TEXT" : "ENTER YOUR TEXT"} maxLength={characterLimit} />
    </label>
  );
  const logoUploadControl = (instance: "mobile" | "desktop") => (
    <div className="snapink-toolbar-logo">
      {logoControls(instance)}
    </div>
  );

  const extendedArtworkNotice = (idSuffix: string) => {
    const visible = artworkIsExtended && !artworkInvalid;
    const infoId = `snapink-extended-artwork-info-${uid}-${idSuffix}`;
    const currentExtendedPrice = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format((sleeveSize <= 2 ? 2499 : 2999) / 100);
    return (
      <div className={`snapink-extended-artwork-slot${visible ? "" : " is-inactive"}`} aria-hidden={!visible}>
        <div className="snapink-extended-artwork-notice" role="status">
          <span>EXTENDED ARTWORK — PREMIUM DESIGN</span>
          <button
            type="button"
            className="snapink-extended-artwork-info-button"
            aria-label="More information about extended design pricing"
            aria-expanded={visible && showExtendedArtworkInfo}
            aria-controls={infoId}
            onClick={() => setShowExtendedArtworkInfo((open) => !open)}
          >ⓘ</button>
        </div>
        {visible && showExtendedArtworkInfo && <div id={infoId} className="snapink-extended-artwork-popover" role="note">
          <button type="button" aria-label="Close extended artwork information" onClick={() => setShowExtendedArtworkInfo(false)}>×</button>
          <p>Your artwork extends beyond the sleeve's top or bottom edge. Extended designs require additional production work.</p>
          <strong>Extended Design Pricing</strong>
          <p>Sizes 0–2: $24.99 · Sizes 3–5: $29.99</p>
          <p>Selected size {sleeveSize} premium design price: {currentExtendedPrice}. Final production feasibility will be confirmed during design review.</p>
        </div>}
      </div>
    );
  };

  const previewToolbar = (instance: "mobile" | "desktop", basicOnly = false) => (
    <div className={`snapink-preview-toolbar${basicOnly ? " snapink-desktop-basic-toolbar" : ""}`} style={instance === "desktop" && !basicOnly ? {
      position: "static",
      width: "100%",
      minWidth: 0,
      margin: 0,
      padding: "14px clamp(12px, 1.5vw, 20px)",
      border: 0,
      borderRadius: "inherit",
      background: "transparent",
      boxShadow: "none",
    } : undefined}>
      <div className="snapink-toolbar-primary">
        {instance === "desktop" && textInputControl(instance)}
        {instance === "desktop" && logoUploadControl(instance)}
        <label className="snapink-toolbar-select">
          <span className={instance === "desktop" ? "snapink-basic-panel-light-text" : undefined}>Font</span>
          <select aria-label="Font" value={font} style={{ fontFamily: font }} onChange={(event) => setFont(event.target.value)}>
            {WEB_SAFE_FONTS.map((f) => <option key={f.label} value={f.stack} style={{ fontFamily: f.stack }}>{f.label}</option>)}
          </select>
        </label>
        <label className="snapink-toolbar-select">
          <span className={instance === "desktop" ? "snapink-basic-panel-light-text" : undefined}>Style</span>
          <select aria-label="Text style" disabled={Boolean(forcedStyleMode)} value={styleMode} onChange={(event) => setStyleMode(event.target.value as "emboss" | "flat")}>
            <option value="emboss">Embossed</option>
            <option value="flat">Printed</option>
          </select>
        </label>
        <label className="snapink-toolbar-select">
          <span className={instance === "desktop" ? "snapink-basic-panel-light-text" : undefined}>Sleeve</span>
          <select aria-label="Sleeve Style" disabled={fixedProductConfiguration} value={variant} onChange={(event) => handleVariantChange(event.target.value as SleeveVariant)}>
            <option value="standard">Standard</option>
            <option value="billboard">Billboard</option>
          </select>
        </label>
      </div>
      {!basicOnly && colorGroups}
      {!basicOnly && <div className="snapink-toolbar-secondary">
        <span className="snapink-toolbar-count" aria-live="polite">{text.length}/{characterLimit}</span>
        <button type="button" className="snapink-toolbar-advanced-toggle" aria-expanded={toolbarAdvancedOpen} onClick={() => setToolbarAdvancedOpen((open) => !open)}>
          {toolbarAdvancedOpen ? "Close advanced" : "Advanced controls"}
        </button>
      </div>}
      {!basicOnly && toolbarAdvancedOpen && <div className="snapink-toolbar-advanced">
        {instance === "desktop" && <Range label="Font size" min={60} max={500} value={fontSize} setValue={setFontSize} suffix="px" />}
        <Range label="Font weight" min={100} max={1200} step={50} value={fontWeight} setValue={setFontWeight} />
        <Range label="Tracking" min={-0.1} max={0.3} step={0.01} value={tracking} setValue={setTracking} suffix="em" />
        <Range label="Line height" min={0.9} max={1.6} step={0.01} value={lineHeight} setValue={setLineHeight} />
        <Range label="Arc" min={-15} max={20} value={arc} setValue={setArc} suffix="%" />
        <Range label="Horizontal position" min={artworkMinXCanvasPercent} max={artworkMaxXCanvasPercent} step="any" precision={3} value={posX} setValue={setPosX} suffix="%" />
        <Range label="Text vertical position" min={ARTWORK_VERTICAL_POSITION_MIN} max={ARTWORK_VERTICAL_POSITION_MAX} step={0.5} value={posY} setValue={setPosY} suffix="%" />
        <Range label="Text inset" min={0} max={12} step={0.5} value={safeMargin} setValue={setSafeMargin} suffix="%" />
        {logoDataUrl && <>
          <Range label="Artwork vertical position" min={ARTWORK_VERTICAL_POSITION_MIN} max={ARTWORK_VERTICAL_POSITION_MAX} step={0.5} value={logoPosY} setValue={setLogoPosY} suffix="%" />
          <p className="text-xs text-neutral-500">Left moves artwork up; right moves it down.</p>
          {logoOutsidePrintableArea && <p role="alert" className="text-xs text-red-300">Artwork exceeds {artworkInvalidBoundary}. Move or resize it before submitting.</p>}
          {extendedArtworkNotice("toolbar")}
          <Range label="Logo size" min={0} max={200} step={1} value={logoScale} setValue={setLogoScale} suffix="%" />
          <Range label="Artwork Height" min={25} max={200} step={1} value={artworkHeightScale} setValue={setArtworkHeightScale} suffix="%" />
          <Range label="Logo opacity" min={10} max={100} step={5} value={logoOpacity} setValue={setLogoOpacity} suffix="%" />
        </>}
        <label className="snapink-toolbar-guides"><input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} /> Show safe area</label>
      </div>}
    </div>
  );

  const studioIntroCopy = (
    <p>
      Choose Standard or Billboard style, select your exposed-peg configuration, customize text and colors, upload a logo, and preview your sleeve on a hat. Export a design preview when ready. Sizes 0–5 match exposed pegs; sleeves fit standard plastic 7-peg snapback closures. <a href="/fit-guide.html">Will It Fit? View the Fit Guide.</a> Production access is available through reviewed pilot-partner applications.
    </p>
  );

  // Shared preview inner block (used on mobile + desktop)
  const strapPreviewInner = (instance: "mobile" | "desktop") => (
    <div className="snapink-preview-content flex min-w-0 flex-col gap-3">
      <div className={`snapink-preview-controls order-2 flex min-w-0 flex-wrap items-center justify-between gap-3 px-1 lg:order-none ${fixedProductConfiguration ? "hidden" : ""}`}>
        <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
          <div className="snapink-size-control flex min-w-0 flex-col gap-1 text-xs text-neutral-300 sm:col-span-2">
            <span>Choose Your Size</span>
            <button
              type="button"
              className="snapink-size-examples-toggle"
              aria-expanded={sizeExamplesOpen}
              aria-controls={`snapink-size-examples-${uid}-${instance}`}
              onClick={() => setSizeExamplesOpen((open) => !open)}
            >
              {sizeExamplesOpen ? "− Hide Size Examples" : "+ View Size Examples"}
            </button>
            <div id={`snapink-size-examples-${uid}-${instance}`} className="snapink-fit-grid mt-2" role="group" aria-label="Snapback compatibility configurations" hidden={!sizeExamplesOpen}>
              {[0, 1, 2, 3, 4, 5].map((size) => (
                <div key={size} className={"snapink-fit-card min-w-0 overflow-hidden rounded-lg border p-1 transition-colors " + (sleeveSize === size ? "border-si-accent bg-neutral-800" : "border-neutral-700 bg-neutral-900")}>
                  <button type="button" aria-label={`Enlarge Size ${size} — ${size} exposed ${size === 1 ? "peg" : "pegs"} example`} className="snapink-fit-example-trigger" onClick={() => { setFitLightboxSize(size); setFitLightboxZoom(1); setFitLightboxPan({ x: 0, y: 0 }); }}>
                    <img src={`/images/website_images/${size}_pegs.png`} alt={`Compatibility view showing ${size} exposed ${size === 1 ? "peg" : "pegs"}`} loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-neutral-100 object-contain" />
                    <span className="snapink-fit-zoom-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2M10.8 7.7v6.2M7.7 10.8h6.2"/></svg></span>
                  </button>
                  <button type="button" aria-label={`Choose size ${size}: ${size} exposed ${size === 1 ? "peg" : "pegs"}`} aria-pressed={sleeveSize === size} onClick={() => handleSizeChange(size)} className="snapink-fit-card-select block w-full px-1 py-1.5 text-center text-xs font-semibold text-neutral-200">
                    Size {size} — {size} exposed {size === 1 ? "peg" : "pegs"}
                  </button>
                </div>
              ))}
            </div>
            <span className="mt-2 block text-xs leading-5 text-neutral-500">Select a fit above to update the sleeve preview. Size 0 has no retaining holes and retains its sliding channel.</span>
          </div>
          <p className="text-xs leading-5 text-neutral-400 sm:col-span-2">
            Your SnapInk size matches the number of pegs left exposed when you wear your hat.
          </p>
        </div>
        <button type="button" disabled={fixedProductConfiguration} aria-pressed={!ghostHat} onClick={() => { const next = !ghostHat; setGhostHat(next); if (!next) setPreviewBackground("studio"); }} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200">
          {ghostHat ? "Sleeve-only view" : "Show Ghost Hat"}
        </button>
        <button type="button" onClick={startNewDesign} className="min-h-10 rounded-lg border border-si-accent/50 px-3 py-2 text-xs font-semibold text-si-accent hover:bg-si-button/10">
          New design
        </button>
      </div>
      <div className="snapink-stage-wrap">
      <div className="snapink-preview-config-row" aria-label="Preview options">
        {hatColorSelector(instance)}
        <div className="snapink-size-buttons" role="group" aria-label="Sleeve Size">
          <span className="snapink-size-buttons-label">Sleeve Size</span>
          {[0, 1, 2, 3, 4, 5].map((size) => (
            <button key={size} type="button" disabled={fixedProductConfiguration} aria-label={`Size ${size}: ${size} exposed ${size === 1 ? "peg" : "pegs"}`} aria-pressed={sleeveSize === size} onClick={() => handleSizeChange(size)} className={`snapink-size-button ${sleeveSize === size ? "is-selected" : ""}`}>
              {size}
            </button>
          ))}
        </div>
        {previewBackgroundSelector}
        {instance === "desktop"
          ? <aside className="snapink-studio-intro-toolbar" aria-label="About SnapInk Studio">{studioIntroCopy}</aside>
          : <details className="snapink-studio-intro-mobile">
              <summary>About SnapInk Studio</summary>
              {studioIntroCopy}
            </details>}
      </div>
      <div className="snapink-preview-stage-frame" style={{ position: "relative" }}>
      <div
      ref={instance === "mobile" ? attachMobileStageRef : attachStageRef}
      className={`snapink-product-stage order-1 relative w-full overflow-hidden rounded-2xl border lg:order-none ${ghostHat && previewSleeveSize !== 0 && !fixedProductConfiguration ? "" : "snapink-product-stage--sleeve-only"}`}
      style={{ aspectRatio: stageAspectRatio, backgroundColor: "#303030", borderColor: "#505050", position: "relative", isolation: "isolate" }}
    >
      <div aria-hidden="true" className="snapink-stage-light absolute inset-0" />
      <div aria-hidden="true" className="snapink-stage-shadow absolute left-1/2 top-[88%] h-[7%] w-[54%] -translate-x-1/2 rounded-[50%]" />
      {instance === "desktop" && !isMobilePreview && sizeConfirmation !== null && (
        <div key={sizeConfirmation} className="snapink-size-confirmation" role="status" aria-live="polite">
          <span className="snapink-size-confirmation-icon" aria-hidden="true">✓</span>
          <span><strong>Size {sizeConfirmation} selected &amp; saved</strong><small>Your sleeve size has been updated.</small></span>
        </div>
      )}
      <div className="snapink-preview-notices pointer-events-none absolute right-3 top-3 z-20 flex max-w-[min(88%,320px)] flex-col items-end gap-1 text-right">
        <span className="snapink-preview-only-badge rounded-md border border-[#D8BF86]/35 bg-black/75 px-2 py-1 text-[10px] font-bold leading-none tracking-[0.08em] text-[#D8BF86] shadow-sm backdrop-blur-[2px]">
          PREVIEW ONLY
        </span>
        <span className="snapink-color-disclaimer rounded bg-black/65 px-2 py-1 text-[10px] leading-tight text-white/90 shadow-sm backdrop-blur-[2px]">
          Actual colors and matte finish may vary.
        </span>
      </div>
      <div
        className="absolute inset-0 transition-transform duration-300 motion-reduce:transition-none"
        style={{
          transform: `scale(${ghostHat && !fixedProductConfiguration ? renderedCameraZoom : 1})`,
          transformOrigin: `${cameraOriginXPercent}% ${cameraOriginYPercent}%`,
        }}
      >
      {isCityLifestylePreview && !fixedProductConfiguration && <img
        aria-hidden="true"
        src={lifestyleBackgroundPath}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ pointerEvents: "none", zIndex: currentHatTemplate.sleevePlacement.layerOrder.hat }}
        onError={() => setPreviewBackground("studio")}
        data-testid="studio-city-lifestyle-background"
      />}
      {ghostHat && !fixedProductConfiguration && <img
        aria-hidden="true"
        src={renderedHatImagePath}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ pointerEvents: "none", zIndex: currentHatTemplate.sleevePlacement.layerOrder.hat }}
        onLoad={(event) => setHatNaturalSize({
          src: renderedHatImagePath,
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })}
        onError={() => { if (isCityLifestylePreview) setPreviewBackground("studio"); }}
        data-testid="studio-hat-preview"
        data-hat-template={currentHatTemplate.id}
        data-hat-template-profile={isMobilePreview ? "mobile" : "desktop"}
        data-hat-rendered-src={renderedHatImagePath}
      />}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${sleeveRenderViewW} ${sleeveSvgHeight}`}
        width={sleeveRenderViewW}
        height={sleeveSvgHeight}
        data-production-logo-x-percent={productionDraftPosition.logoX}
        data-production-logo-y-percent={productionDraftPosition.logoY}
        data-production-geometry-version={GEOMETRY_VERSION}
        data-positioning-version={POSITIONING_VERSION}
        data-photo-face-points={JSON.stringify(photoFacePoints)}
        data-sleeve-variant={variant}
        data-sleeve-size={sleeveSize}
        data-preview-sleeve-size={previewSleeveSize}
        data-hat-preview-src={currentHatProfile.imagePath}
        data-stage-sleeve-top-percent={sleevePreviewCenterYPercent - sleevePreviewHeightPercent / 2}
        data-stage-sleeve-height-percent={sleevePreviewHeightPercent}
        data-stage-sleeve-bottom-percent={sleevePreviewCenterYPercent + sleevePreviewHeightPercent / 2}
        data-stage-sleeve-offset-px={0}
        data-stage-sleeve-preview-offset-px={0}
        data-stage-css-width-px={currentStageClientWidth}
        data-stage-sleeve-bottom-cover-source-px={0}
        data-stage-sleeve-bottom-extra-px={0}
        data-stage-sleeve-vertical-scale={1}
        data-stage-sleeve-extra-height-preview-px={0}
        data-stage-hat-strap-top-percent={(stageComposition.strapTop / stageCoordinateHeight) * 100}
        data-stage-hat-strap-bottom-percent={(stageComposition.strapBottom / stageCoordinateHeight) * 100}
        data-stage-sleeve-left-percent={sleevePreviewLeftPercent}
        data-stage-billboard-groove-x-percent={variant === "billboard" && ghostHat ? sleevePreviewGrooveXPercent : undefined}
        data-stage-standard-groove-x-percent={variant === "standard" && ghostHat ? sleevePreviewGrooveXPercent : undefined}
        data-stage-hat-opening-left-percent={ghostHat ? cameraOriginXPercent : undefined}
        data-stage-sleeve-right-percent={sleevePreviewRightPercent}
        data-stage-hat-opening-right-percent={ghostHat ? (stageComposition.rearOpeningRight / STUDIO_STAGE_COORDINATE_WIDTH) * 100 : undefined}
        data-stage-camera-zoom={cameraZoom}
        data-hat-template-id={currentHatTemplate.id}
        data-hat-template-rotation={stageComposition.rotationDeg}
        data-hat-template-artwork-layer={currentHatTemplate.sleevePlacement.layerOrder.artwork}
        data-branding-center-x-mm={brandingRegion.centerXmm}
        data-branding-center-y-mm={logoCenterYmm}
        preserveAspectRatio="none"
        overflow="visible"
        xmlns="http://www.w3.org/2000/svg"
        className="snapink-sleeve-render absolute left-1/2 top-1/2 block h-auto -translate-x-1/2 -translate-y-1/2 rounded-sm"
        // Sleeve placement comes directly from the selected template registry;
        // CAD dimensions determine size while the camera frames the composition.
        style={{
          width: `${sleevePreviewWidthPercent}%`,
          height: `${sleevePreviewHeightPercent}%`,
          left: `${sleevePreviewCenterXPercent}%`,
          top: `${sleevePreviewCenterYPercent}%`,
          zIndex: currentHatTemplate.sleevePlacement.layerOrder.sleeve,
          transform: `rotate(${stageComposition.rotationDeg}deg)`,
          transformOrigin: `${sleeveRenderGrooveFraction * 100}% 50%`,
        }}
      >
        <defs>
          <filter id={embossFaceHighlightId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feOffset
              in="SourceAlpha"
              dx={STUDIO_EMBOSSED_PREVIEW_EXTRUSION_MM * svgUnitsPerMm * 0.08}
              dy={STUDIO_EMBOSSED_PREVIEW_EXTRUSION_MM * svgUnitsPerMm * 0.08}
              result="embossLightOffset"
            />
            <feComposite in="SourceAlpha" in2="embossLightOffset" operator="out" result="embossTopLeftEdge" />
            <feFlood floodColor="#ffffff" floodOpacity="0.62" result="embossHighlightColor" />
            <feComposite in="embossHighlightColor" in2="embossTopLeftEdge" operator="in" result="embossHighlight" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="embossHighlight" />
            </feMerge>
          </filter>

          <path id={pathId} d={arcPath} />
          <clipPath id={`${surfaceClipId}-printable-cad`} clipPathUnits="userSpaceOnUse">
            <path d={`${brandingSurfacePath(variant, renderGeometrySize, viewW, viewH, MAX_TOP_ARTWORK_EXTENSION_MM, MAX_BOTTOM_ARTWORK_EXTENSION_MM)} ${grooveCutoutPath}`} fillRule="evenodd" clipRule="evenodd" />
          </clipPath>
          <clipPath id={`${surfaceClipId}-printable-photo`} clipPathUnits="userSpaceOnUse">
            <path d={extendedPhotoArtworkClipPath} />
          </clipPath>
          {billboardPhotoRightContourClipPath && <clipPath id={`${surfaceClipId}-billboard-photo-contour`} clipPathUnits="userSpaceOnUse">
            <path d={billboardPhotoRightContourClipPath} />
          </clipPath>}
          {variant === "billboard" && <linearGradient
            id={billboardMatteGradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={viewW}
            y2="0"
          >
            <stop offset="54%" stopColor="#000000" stopOpacity="0" />
            <stop offset="76%" stopColor="#000000" stopOpacity="0.045" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.14" />
          </linearGradient>}
          {!isBlackSleeve && <filter id={sleeveColorFilterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={`0.213 0.715 0.072 0 0 0.213 0.715 0.072 0 0 0.213 0.715 0.072 0 0 0 0 0 1 0`} />
            <feComponentTransfer>
              <feFuncR type="gamma" amplitude={sleeveColorRgb[0] * sleeveTextureAmplitude} exponent="0.42" offset={sleeveColorRgb[0] * sleeveMaterialFloor} />
              <feFuncG type="gamma" amplitude={sleeveColorRgb[1] * sleeveTextureAmplitude} exponent="0.42" offset={sleeveColorRgb[1] * sleeveMaterialFloor} />
              <feFuncB type="gamma" amplitude={sleeveColorRgb[2] * sleeveTextureAmplitude} exponent="0.42" offset={sleeveColorRgb[2] * sleeveMaterialFloor} />
            </feComponentTransfer>
          </filter>}
        </defs>

        <svg
          data-product-image="true"
          x="0"
          y="0"
          width={sleeveRenderViewW}
          height={sleeveSvgHeight}
          aria-hidden="true"
        >
          <g clipPath={variant === "billboard" ? `url(#${surfaceClipId}-billboard-photo-contour)` : undefined}>
          <svg x="0" y="0" width={cadGrooveCanvasX} height={sleeveSvgHeight}
            viewBox={`${sleevePhoto.crop.x} ${sleevePhoto.crop.y} ${photoGrooveSourceX - sleevePhoto.crop.x} ${sleevePhoto.crop.height}`}
            preserveAspectRatio="none">
            <image href={sleevePhoto.src} x="0" y="0" width={sleevePhoto.sourceWidth} height={sleevePhoto.sourceHeight}
              preserveAspectRatio="none" filter={!isBlackSleeve ? `url(#${sleeveColorFilterId})` : undefined}
              data-testid="studio-blank-sleeve-photo" />
          </svg>
          <svg x={cadGrooveCanvasX} y="0" width={sleeveRenderViewW - cadGrooveCanvasX} height={sleeveSvgHeight}
            viewBox={`${photoGrooveSourceX} ${sleevePhoto.crop.y} ${sleevePhoto.crop.x + sleevePhoto.crop.width - photoGrooveSourceX} ${sleevePhoto.crop.height}`}
            preserveAspectRatio="none">
            <image href={sleevePhoto.src} x="0" y="0" width={sleevePhoto.sourceWidth} height={sleevePhoto.sourceHeight}
              preserveAspectRatio="none" filter={!isBlackSleeve ? `url(#${sleeveColorFilterId})` : undefined} />
          </svg>
          </g>
          {variant === "billboard" && <path
            d={billboardMatteRenderPath}
            fill={`url(#${billboardMatteGradientId})`}
            pointerEvents="none"
            data-billboard-matte-lighting="true"
          />}
        </svg>

        <g clipPath={`url(#${surfaceClipId}-printable-photo)`} data-artwork-clip="true">
        <g transform={photoArtworkTransform} data-artwork-overlay="true">
          <g transform={`translate(0 ${logoDataUrl ? logoCenterCanvasY : textCenterCanvasY}) scale(1 ${artworkHeightScale / 100}) translate(0 ${-(logoDataUrl ? logoCenterCanvasY : textCenterCanvasY)})`} data-artwork-height-scale={artworkHeightScale}>
          <defs><path id={pathId} d={arcPath} /></defs>
        {logoDataUrl && !logoNeedsRemoval && (
          <g>
            {styleMode === "emboss" && Array.from({ length: STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS }, (_, index) => {
              const layer = STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS - index;
              const depth = layer / STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS;
              const sideBrightness = 0.36 + (1 - depth) * 0.3;
              return (
                <image
                  key={`logo-extrusion-${layer}`}
                  href={logoDataUrl}
                  x={logoImageX}
                  y={logoImageY}
                  width={logoImageWidthSvg}
                  height={logoImageHeightSvg}
                  preserveAspectRatio="xMidYMid meet"
                  transform={`translate(${embossedExtrusionX * depth} ${embossedExtrusionY * depth})`}
                  style={{ filter: `brightness(${sideBrightness})` }}
                  opacity={logoOpacity / 100}
                  data-emboss-extrusion-step={layer}
                  aria-hidden="true"
                />
              );
            })}
            <image
              href={logoDataUrl}
              x={logoImageX}
              y={logoImageY}
              width={logoImageWidthSvg}
              height={logoImageHeightSvg}
              preserveAspectRatio="xMidYMid meet"
              filter={styleMode === "emboss" ? `url(#${embossFaceHighlightId})` : undefined}
              opacity={logoOpacity / 100}
              data-testid="studio-logo-artwork"
              data-branding-center-x-mm={brandingRegion.centerXmm}
              data-branding-groove-valley-x-mm={brandingRegion.grooveXmm}
              data-branding-right-edge-x-mm={brandingRegion.rightEdgeXmm}
              data-visible-center-canvas-x={logoCenterCanvasX}
              data-visible-bounds-x={logoVisibleBounds.x}
              data-visible-bounds-width={logoVisibleBounds.width}
            />
            <rect
              x={logoCenterCanvasX - visibleLogoWidthSvg / 2}
              y={logoCenterCanvasY - visibleLogoHeightSvg / 2}
              width={visibleLogoWidthSvg}
              height={visibleLogoHeightSvg}
              fill="transparent"
              pointerEvents="all"
              data-preview-only="true"
              data-artwork-drag-target="true"
              onPointerDown={beginArtworkDrag}
              onPointerMove={moveArtworkDrag}
              onPointerUp={endArtworkDrag}
              onPointerCancel={endArtworkDrag}
              style={{ cursor: isDraggingArtwork ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
            />
            {isDraggingArtwork && <rect
              x={logoCenterCanvasX - visibleLogoWidthSvg / 2}
              y={logoCenterCanvasY - visibleLogoHeightSvg / 2}
              width={visibleLogoWidthSvg}
              height={visibleLogoHeightSvg}
              fill="none"
              stroke="#D8BF86"
              strokeWidth={Math.max(1, svgUnitsPerMm * 0.18)}
              strokeDasharray={`${svgUnitsPerMm * 0.8} ${svgUnitsPerMm * 0.55}`}
              pointerEvents="none"
              data-preview-only="true"
              data-artwork-selection-outline="true"
            />}
          </g>
        )}

        {showGuides && (
          <g opacity="0.3">
            <line
              x1={1600 / 2}
              y1={margin}
              x2={1600 / 2}
              y2={viewH - margin}
              stroke="#fff"
              strokeDasharray="6 6"
            />
            <line
              x1={margin}
              y1={viewH / 2}
              x2={1600 - margin}
              y2={viewH / 2}
              stroke="#fff"
              strokeDasharray="6 6"
            />
          </g>
        )}

        {Boolean(text) && styleMode === "emboss" && Array.from({ length: STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS }, (_, index) => {
          const layer = STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS - index;
          const depth = layer / STUDIO_EMBOSSED_PREVIEW_EXTRUSION_STEPS;
          const sideBrightness = 0.36 + (1 - depth) * 0.3;
          return (
            <g
              key={`text-extrusion-${layer}`}
              transform={`translate(${embossedExtrusionX * depth} ${embossedExtrusionY * depth})`}
              style={{ filter: `brightness(${sideBrightness})` }}
              data-emboss-extrusion-step={layer}
              aria-hidden="true"
            >
              <g transform={isMobilePreview && ghostHat && !fixedProductConfiguration
                ? `translate(${mobilePhotoTextOffset.x} ${mobilePhotoTextOffset.y})`
                : undefined}>
                {renderStudioText()}
              </g>
            </g>
          );
        })}

        {Boolean(text) && (
          <g filter={styleMode === "emboss" ? `url(#${embossFaceHighlightId})` : undefined}>
            <g
              transform={isMobilePreview && ghostHat && !fixedProductConfiguration
                ? `translate(${mobilePhotoTextOffset.x} ${mobilePhotoTextOffset.y})`
                : undefined}
              data-mobile-photographic-text-offset={isMobilePreview && ghostHat && !fixedProductConfiguration ? "true" : undefined}
            >
              {renderStudioText()}
            </g>
          </g>
        )}
          </g>
        </g>
        </g>
      </svg>
      </div>
      </div>
      {instance === "desktop" && <div className={`snapink-desktop-basic-overlay${desktopCustomizationCollapsed ? " is-collapsed" : ""}`} data-preview-only="true" role="group" aria-label="Basic Studio controls">
        {previewToolbar("desktop", true)}
      </div>}
      {instance === "desktop" && <div className={`snapink-desktop-controls-overlay${desktopCustomizationCollapsed ? " is-collapsed" : ""}`} data-preview-only="true" style={{
        position: "absolute",
        zIndex: 30,
        left: desktopCustomizationCollapsed ? "50%" : "4%",
        right: desktopCustomizationCollapsed ? "auto" : "4%",
        bottom: "3%",
        width: desktopCustomizationCollapsed ? "max-content" : undefined,
        transform: desktopCustomizationCollapsed ? "translateX(-50%)" : "none",
        boxSizing: "border-box",
        border: desktopCustomizationCollapsed ? "1px solid #D8BF86" : "1px solid rgba(232, 216, 176, .95)",
        borderRadius: 16,
        background: desktopCustomizationCollapsed ? "rgba(23, 23, 23, .96)" : "rgba(250, 249, 246, .94)",
        boxShadow: desktopCustomizationCollapsed ? "0 6px 18px rgba(0, 0, 0, .3)" : "0 12px 32px rgba(0, 0, 0, .28)",
        backdropFilter: desktopCustomizationCollapsed ? "none" : "blur(10px)",
        transition: "left 220ms ease, right 220ms ease, transform 220ms ease, background-color 220ms ease, box-shadow 220ms ease, border-color 220ms ease",
      }}>
        <div
          id={`snapink-desktop-controls-content-${uid}`}
          className="snapink-desktop-controls-content"
          aria-hidden={desktopCustomizationCollapsed}
          inert={desktopCustomizationCollapsed}
        >
          {previewToolbar(instance)}
        </div>
        <button
          type="button"
          className="snapink-desktop-controls-toggle"
          aria-expanded={!desktopCustomizationCollapsed}
          aria-controls={`snapink-desktop-controls-content-${uid}`}
          onClick={() => setDesktopCustomizationCollapsed((collapsed) => !collapsed)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className={desktopCustomizationCollapsed ? "" : "is-open"}>
            <path d="m3 6 5 5 5-5" />
          </svg>
          <span>{desktopCustomizationCollapsed ? "Customize" : "Hide Controls"}</span>
        </button>
      </div>}
      {instance === "mobile" && <div className="snapink-mobile-entry-overlay" data-preview-only="true" style={{
        position: "absolute",
        zIndex: 30,
        left: "6%",
        right: "6%",
        bottom: 16,
        boxSizing: "border-box",
        pointerEvents: "none",
      }}>
        {!mobileEntryCollapsed && <div className="snapink-mobile-entry-panel" style={{ pointerEvents: "auto" }}>
          <div className="snapink-mobile-entry-primary">
            <div className="snapink-mobile-text-size">
              <label className="snapink-mobile-text-size-heading" htmlFor={`mobile-text-size-${uid}`}>
                <span className="snapink-mobile-control-label" style={mobileOverlayWhiteTextStyle}>Text Size</span>
                <output className="snapink-mobile-text-size-value" style={mobileOverlayWhiteTextStyle} aria-live="polite">{fontSize}px</output>
              </label>
              <input id={`mobile-text-size-${uid}`} type="range" min={60} max={500} step={1} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Text Size" />
            </div>
            {textInputControl("mobile")}
            {logoUploadControl("mobile")}
          </div>
        </div>}
        <button
          type="button"
          className="mx-auto mt-2 block rounded-full border border-[#D8BF86] bg-black/85 px-4 py-1.5 text-xs font-bold text-[#F2E8CC] shadow"
          style={{ pointerEvents: "auto" }}
          aria-expanded={!mobileEntryCollapsed}
          onClick={() => setMobileEntryCollapsed((collapsed) => !collapsed)}
        >
          {mobileEntryCollapsed ? "Customize" : "Hide Controls"}
        </button>
      </div>}
      </div>
      </div>
    </div>
  );

  return (
    <>
    <div
      className={`
        w-full
        px-2 sm:px-3 lg:px-4
        lg:mx-auto
        ${className}
      `}
      style={{ width: "100%", maxWidth: width > 1400 ? width : "none" }}
    >
      {/* ---------- MOBILE LAYOUT (accordion + preview on top) ---------- */}
      <div className="snapink-studio-workspace-mobile lg:hidden space-y-4 pb-20">
        {/* Preview at top */}
        <div className="snapink-preview-card p-2.5 sm:p-4 rounded-3xl border border-neutral-700/80 bg-neutral-900/75 shadow-xl shadow-black/20">
          {strapPreviewInner("mobile")}
        </div>
        <details className="snapink-mobile-customize">
          <summary>Customize Your Sleeve</summary>
          {previewToolbar("mobile")}
        </details>
      <div className="snapink-mobile-controls min-h-0 space-y-4 pb-4">

        {/* Text / Styling panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() =>
              setMobileOpen(mobileOpen === "text" ? "position" : "text")
            }
          >
            <span>Text &amp; Styling</span>
            <span className="text-neutral-400">
              {mobileOpen === "text" ? "-" : "+"}
            </span>
          </button>
          {mobileOpen === "text" && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-neutral-400">
                    Font
                  </label>
                  <select
                    className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50"
                    value={font}
                    style={{ fontFamily: font }}
                    onChange={(e) => setFont(e.target.value)}
                  >
                    {WEB_SAFE_FONTS.map((f) => (
                      <option
                        key={f.label}
                        value={f.stack}
                        style={{ fontFamily: f.stack }}
                      >
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-neutral-400">
                    Style
                  </label>
                  <select
                    className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50"
                    disabled={Boolean(forcedStyleMode)}
                    value={styleMode}
                    onChange={(e) =>
                      setStyleMode(e.target.value as "emboss" | "flat")
                    }
                  >
                    <option value="emboss">Embossed</option>
                    <option value="flat">Printed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Range
                  label="Font weight"
                  min={100}
                  max={1200}
                  step={50}
                  value={fontWeight}
                  setValue={setFontWeight}
                />
                <Range
                  label="Tracking"
                  min={-0.1}
                  max={0.3}
                  step={0.01}
                  value={tracking}
                  setValue={setTracking}
                  suffix="em"
                />
                <Range
                  label="Line height"
                  min={0.9}
                  max={1.6}
                  step={0.01}
                  value={lineHeight}
                  setValue={setLineHeight}
                />
                <Range
                  label="Arc (bow)"
                  min={-15}
                  max={20}
                  value={arc}
                  setValue={setArc}
                  suffix="%"
                />
              </div>

            </div>
          )}
        </div>

        {/* Position panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() =>
              setMobileOpen(mobileOpen === "position" ? "export" : "position")
            }
          >
            <span>Position &amp; Guides</span>
            <span className="text-neutral-400">
              {mobileOpen === "position" ? "-" : "+"}
            </span>
          </button>
          {mobileOpen === "position" && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              <div className="grid grid-cols-3 gap-3 items-center">
                <div className="col-span-2">
                  <label className="block text-xs text-neutral-400">
                    Alignment
                  </label>
                  <div className="flex gap-1">
                    {["start", "center", "end"].map((k) => (
                      <button
                        key={k}
                        onClick={() =>
                          handleAlignmentChange(k as "start" | "center" | "end")
                        }
                        className={`px-3 py-1.5 rounded-lg border text-sm ${
                          align === k
                            ? "bg-si-button/15 text-si-accent border-si-accent"
                            : "bg-neutral-800/70 border-neutral-700 text-neutral-300"
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={centerCurrentArtwork}
                    className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2 text-xs"
                  >
                    Center text
                  </button>
                  <button
                    onClick={resetCurrentArtworkPosition}
                    className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2 text-xs"
                  >
                    Reset position
                  </button>
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Range
                  label="Horizontal position"
                  min={artworkMinXCanvasPercent}
                  max={artworkMaxXCanvasPercent}
                  step="any"
                  precision={3}
                  value={posX}
                  setValue={setPosX}
                  suffix="%"
                />
                <Range
                  label="Text vertical position"
                  min={0}
                  max={100}
                  step={0.5}
                  value={posY}
                  setValue={setPosY}
                  suffix="%"
                />
              </div>
              {logoDataUrl && <Range
                label="Artwork vertical position"
                min={ARTWORK_VERTICAL_POSITION_MIN}
                max={ARTWORK_VERTICAL_POSITION_MAX}
                step={0.5}
                value={logoPosY}
                setValue={setLogoPosY}
                suffix="%"
              />}
              {(logoDataUrl || text.trim()) && <Range label="Artwork Height" min={25} max={200} step={1} value={artworkHeightScale} setValue={setArtworkHeightScale} suffix="%" />}
              {logoDataUrl && <p className="text-xs text-neutral-500">Left moves artwork up; right moves it down.</p>}
              {logoOutsidePrintableArea && <p role="alert" className="text-xs text-red-300">Artwork exceeds {artworkInvalidBoundary}. Move or resize it before submitting.</p>}
              {extendedArtworkNotice("mobile")}

              <div className="grid grid-cols-2 gap-3">
                <Range
                  label="Text inset"
                  min={0}
                  max={12}
                  step={0.5}
                  value={safeMargin}
                  setValue={setSafeMargin}
                  suffix="%"
                />
                <div>
                  <label className="block text-xs text-neutral-400">
                    Guides
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      id="guides-mobile"
                      type="checkbox"
                      checked={showGuides}
                      onChange={(e) => setShowGuides(e.target.checked)}
                    />
                    <label
                      htmlFor="guides-mobile"
                      className="text-neutral-300 text-sm"
                    >
                      Show safe area
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Export panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() =>
              setMobileOpen(mobileOpen === "export" ? "text" : "export")
            }
          >
            <span>Export</span>
            <span className="text-neutral-400">
              {mobileOpen === "export" ? "-" : "+"}
            </span>
          </button>
          {mobileOpen === "export" && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              <button
                onClick={handleExportPNG}
                className="w-full rounded-xl bg-si-button hover:bg-si-hover text-neutral-950 font-black px-4 py-3"
              >
                Download PNG preview
              </button>
              {enableProductPhotoGeneration && <>
                <fieldset className="space-y-1"><legend className="text-xs text-neutral-400">Product images</legend>{productPhotoOptions.map(option=><label key={option.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={productPhotoChoice.includes(option.key)} onChange={e=>{const next=e.target.checked?[...productPhotoChoice,option.key]:productPhotoChoice.filter(x=>x!==option.key);setProductPhotoChoice(next);localStorage.setItem("snapink.productPhotoSelections.v1",JSON.stringify(next));}} />{option.label}</label>)}</fieldset>
                <button
                  type="button"
                  onClick={handleGenerateProductImage}
                  disabled={isGeneratingProductImage||productPhotoChoice.length===0}
                  title="Generate the selected product image."
                  className="w-full rounded-xl border border-si-accent px-4 py-3 font-black text-si-accent hover:bg-si-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGeneratingProductImage ? "Generating Product Image…" : "Generate Product Image"}
                </button>
                {isGeneratingProductImage && productPhotoProgress && <p role="status" aria-live="polite" className="text-xs text-neutral-300">{productPhotoProgress}</p>}
                <div className="space-y-2 rounded-lg border border-neutral-700 p-2"><label className="text-xs">Lifestyle preview <select value={lifestylePreview} onChange={e=>setLifestylePreview(e.target.value as typeof lifestylePreview)} className="ml-2 rounded bg-neutral-800 p-1"><option value="maleLifestyle">Male</option><option value="femaleLifestyle">Female</option></select></label><img className="w-full rounded" src={lifestyleLivePreview||`/images/product_images/${lifestylePreview==="maleLifestyle"?"male_master.png":"female_master.png"}`} alt={`${lifestylePreview} lifestyle preview`} /><div className="grid grid-cols-2 gap-2">{(["x","y","width","height","rotation","perspective"] as const).map(k=><label key={k} className="text-xs capitalize">{k}<input type="number" value={lifestyleCalibration[k]??0} onChange={e=>{const v={...lifestyleCalibration,[k]:Number(e.target.value)};setLifestyleCalibration(v);localStorage.setItem("snapink.lifestyleCalibration.v1",JSON.stringify(v));}} className="mt-1 w-full rounded bg-neutral-800 px-2 py-1" /></label>)}</div><p className="text-xs text-neutral-500">Shared calibration applies to both masters.</p></div>
                {generatedPhotoEntries.map(entry=><div key={entry.key} className="rounded border border-neutral-700 p-2"><img className="w-full rounded" src={generatedPreviewUrls.find(item=>item.key===entry.key)?.url} alt={entry.label} /><label className="flex items-center gap-2 py-1 text-xs"><input type="checkbox" checked={shopImageSelection.includes(entry.key)} onChange={e=>setShopImageSelection(e.target.checked?[...shopImageSelection,entry.key]:shopImageSelection.filter(x=>x!==entry.key))} />Include in shop gallery</label><button type="button" onClick={()=>downloadPNGBlob(entry.blob,entry.filename)} className="text-xs underline">Download {entry.label}</button></div>)}
                <p className="text-xs text-neutral-400">Choose any image combination. Multiple images download as a ZIP.</p>
                <button type="button" onClick={studioAdminToken?handleAddToShop:handleStudioAdminAccess} disabled={isGeneratingProductImage || publishingProduct} className="w-full rounded-xl bg-si-accent px-4 py-3 font-black text-neutral-950 hover:bg-si-hover disabled:opacity-50">{studioAdminToken?"ADD TO SHOP":"ADMIN ACCESS"}</button>
              </>}

              <div className="flex items-center gap-2 text-xs text-neutral-420">
                <span>Scale</span>
                <select
                  className="rounded bg-neutral-800/80 border border-neutral-700 px-2 py-1 text-neutral-200"
                  value={exportScale}
                  onChange={(e) => setExportScale(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-neutral-400">
                Saves a PNG preview of your sleeve concept.
              </p>

            </div>
          )}
        </div>
        </div>

      </div>

      {/* ---------- DESKTOP LAYOUT (compact controls + preview workspace) ---------- */}
      <div className="snapink-studio-workspace-desktop min-w-0">
        {/* LEFT SETTINGS COLUMN */}
        <div className="min-w-0 space-y-4">
          <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
            <label className="block text-sm text-neutral-300">Custom text</label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ENTER YOUR TEXT"
              maxLength={characterLimit}
              className="w-full rounded-xl bg-neutral-800/80 border border-neutral-700 px-3 py-2 text-neutral-50"
            />

            <div className="text-right text-xs mt-1">
              <span
                className={`${
                  text.length >= characterLimit ? "text-red-500" : "text-neutral-400"
                }`}
              >
                {text.length}/{characterLimit} characters
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400">Font</label>
                <select
                  className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50"
                  value={font}
                  style={{ fontFamily: font }}
                  onChange={(e) => setFont(e.target.value)}
                >
                  {WEB_SAFE_FONTS.map((f) => (
                    <option
                      key={f.label}
                      value={f.stack}
                      style={{ fontFamily: f.stack }}
                    >
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-neutral-400">Style</label>
                <select
                  className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50"
                  disabled={Boolean(forcedStyleMode)}
                  value={styleMode}
                  onChange={(e) =>
                    setStyleMode(e.target.value as "emboss" | "flat")
                  }
                >
                  <option value="emboss">Embossed</option>
                  <option value="flat">Printed</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Range
                label="Font size"
                min={60}
                max={500}
                value={fontSize}
                setValue={setFontSize}
                suffix="px"
              />
              <Range
                label="Font weight"
                min={100}
                max={1200}
                step={50}
                value={fontWeight}
                setValue={setFontWeight}
              />
              <Range
                label="Tracking"
                min={-0.1}
                max={0.3}
                step={0.01}
                value={tracking}
                setValue={setTracking}
                suffix="em"
              />
              <Range
                label="Line height"
                min={0.9}
                max={1.6}
                step={0.01}
                value={lineHeight}
                setValue={setLineHeight}
              />
              <Range
                label="Arc (bow)"
                min={-15}
                max={20}
                value={arc}
                setValue={setArc}
                suffix="%"
              />
            </div>

        </div>

        {/* LOGO BOX */}
          <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
            <div>
              <h3 className="text-neutral-200 font-semibold">Logo placement</h3>
              <p className="mt-1 text-xs text-neutral-400">
                Upload a mark and position it inside the same strap preview.
              </p>
            </div>
          </div>
        </div>

        {/* PREVIEW AND ACTIONS COLUMN */}
        <div className="min-w-0 space-y-4">
          {/* The live product render leads the desktop workspace. */}
          <div className="snapink-preview-card p-3 sm:p-4 rounded-3xl border border-neutral-700/80 bg-neutral-900/75 shadow-xl shadow-black/25">
            {strapPreviewInner("desktop")}
          </div>
          {/* ALIGNMENT BOX */}
          <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
            <div className="grid grid-cols-3 gap-3 items-center">
              <div className="col-span-2">
                <label className="block text-xs text-neutral-400">
                  Alignment
                </label>
                <div className="flex gap-1">
                  {["start", "center", "end"].map((k) => (
                    <button
                      key={k}
                      onClick={() =>
                        handleAlignmentChange(k as "start" | "center" | "end")
                      }
                      className={`px-3 py-1.5 rounded-lg border text-sm ${
                        align === k
                          ? "bg-si-button/15 text-si-accent border-si-accent"
                          : "bg-neutral-800/70 border-neutral-700 text-neutral-300"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={centerCurrentArtwork}
                  className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2"
                >
                  Center text
                </button>
                <button
                  onClick={resetCurrentArtworkPosition}
                  className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2"
                >
                  Reset position
                </button>
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <Range
                label="Horizontal position"
                min={artworkMinXCanvasPercent}
                max={artworkMaxXCanvasPercent}
                step="any"
                precision={3}
                value={posX}
                setValue={setPosX}
                suffix="%"
              />
              <Range
                label="Text vertical position"
                min={0}
                max={100}
                step={0.5}
                value={posY}
                setValue={setPosY}
                suffix="%"
              />
            </div>
            {logoDataUrl && <Range
              label="Artwork vertical position"
              min={ARTWORK_VERTICAL_POSITION_MIN}
              max={ARTWORK_VERTICAL_POSITION_MAX}
              step={0.5}
              value={logoPosY}
              setValue={setLogoPosY}
              suffix="%"
            />}
              {(logoDataUrl || text.trim()) && <Range label="Artwork Height" min={25} max={200} step={1} value={artworkHeightScale} setValue={setArtworkHeightScale} suffix="%" />}
            {logoDataUrl && <p className="text-xs text-neutral-500">Left moves artwork up; right moves it down.</p>}
            {logoOutsidePrintableArea && <p role="alert" className="text-xs text-red-300">Artwork exceeds {artworkInvalidBoundary}. Move or resize it before submitting.</p>}
            {extendedArtworkNotice("desktop")}

            <div className="grid grid-cols-2 gap-3">
              <Range
                label="Text inset"
                min={0}
                max={12}
                step={0.5}
                value={safeMargin}
                setValue={setSafeMargin}
                suffix="%"
              />
              <div>
                <label className="block text-xs text-neutral-400">
                  Guides
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="guides-desktop"
                    type="checkbox"
                    checked={showGuides}
                    onChange={(e) => setShowGuides(e.target.checked)}
                  />
                  <label
                    htmlFor="guides-desktop"
                    className="text-neutral-300 text-sm"
                  >
                    Show safe area
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* ACTIONS BOX */}
          <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3 h-fit">
            <h3 className="text-neutral-200 font-semibold">Actions</h3>

            <button
              onClick={handleExportPNG}
              className="w-full rounded-xl bg-si-button hover:bg-si-hover text-neutral-950 font-black px-4 py-3"
            >
              Download PNG preview
            </button>
            {enableProductPhotoGeneration && <>
              <fieldset className="space-y-1"><legend className="text-xs text-neutral-400">Product images</legend>{productPhotoOptions.map(option=><label key={option.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={productPhotoChoice.includes(option.key)} onChange={e=>{const next=e.target.checked?[...productPhotoChoice,option.key]:productPhotoChoice.filter(x=>x!==option.key);setProductPhotoChoice(next);localStorage.setItem("snapink.productPhotoSelections.v1",JSON.stringify(next));}} />{option.label}</label>)}</fieldset>
              <button
                type="button"
                onClick={handleGenerateProductImage}
                disabled={isGeneratingProductImage||productPhotoChoice.length===0}
                title="Generate the selected product image."
                className="w-full rounded-xl border border-si-accent px-4 py-3 font-black text-si-accent hover:bg-si-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGeneratingProductImage ? "Generating Product Image…" : "Generate Product Image"}
              </button>
              {isGeneratingProductImage && productPhotoProgress && <p role="status" aria-live="polite" className="text-xs text-neutral-300">{productPhotoProgress}</p>}
              <div className="space-y-2 rounded-lg border border-neutral-700 p-2"><label className="text-xs">Lifestyle preview <select value={lifestylePreview} onChange={e=>setLifestylePreview(e.target.value as typeof lifestylePreview)} className="ml-2 rounded bg-neutral-800 p-1"><option value="maleLifestyle">Male</option><option value="femaleLifestyle">Female</option></select></label><img className="w-full rounded" src={lifestyleLivePreview||`/images/product_images/${lifestylePreview==="maleLifestyle"?"male_master.png":"female_master.png"}`} alt={`${lifestylePreview} lifestyle preview`} /><div className="grid grid-cols-2 gap-2">{(["x","y","width","height","rotation","perspective"] as const).map(k=><label key={k} className="text-xs capitalize">{k}<input type="number" value={lifestyleCalibration[k]??0} onChange={e=>{const v={...lifestyleCalibration,[k]:Number(e.target.value)};setLifestyleCalibration(v);localStorage.setItem("snapink.lifestyleCalibration.v1",JSON.stringify(v));}} className="mt-1 w-full rounded bg-neutral-800 px-2 py-1" /></label>)}</div><p className="text-xs text-neutral-500">Shared calibration applies to both masters.</p></div>
              {generatedPhotoEntries.map(entry=><div key={entry.key} className="rounded border border-neutral-700 p-2"><img className="w-full rounded" src={generatedPreviewUrls.find(item=>item.key===entry.key)?.url} alt={entry.label} /><label className="flex items-center gap-2 py-1 text-xs"><input type="checkbox" checked={shopImageSelection.includes(entry.key)} onChange={e=>setShopImageSelection(e.target.checked?[...shopImageSelection,entry.key]:shopImageSelection.filter(x=>x!==entry.key))} />Include in shop gallery</label><button type="button" onClick={()=>downloadPNGBlob(entry.blob,entry.filename)} className="text-xs underline">Download {entry.label}</button></div>)}
              <p className="text-xs text-neutral-400">Choose any image combination. Multiple images download as a ZIP.</p>
              <button type="button" onClick={studioAdminToken?handleAddToShop:handleStudioAdminAccess} disabled={isGeneratingProductImage || publishingProduct} className="w-full rounded-xl bg-si-accent px-4 py-3 font-black text-neutral-950 hover:bg-si-hover disabled:opacity-50">{studioAdminToken?"ADD TO SHOP":"ADMIN ACCESS"}</button>
            </>}

            <div className="flex items-center gap-2 text-xs text-neutral-420">
              <span>Scale</span>
              <select
                className="rounded bg-neutral-800/80 border border-neutral-700 px-2 py-1 text-neutral-200"
                value={exportScale}
                onChange={(e) => setExportScale(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-neutral-400">
              Saves a PNG preview of your sleeve concept.
            </p>

          </div>

        </div>
      </div>
    </div>
    {fitLightboxSize !== null && typeof document !== "undefined" && createPortal(
      <div ref={fitLightboxDialogRef} className="snapink-fit-lightbox" role="dialog" aria-modal="true" aria-labelledby={`snapink-fit-lightbox-title-${uid}`} onClick={(event) => {
        const target = event.target;
        const clickedControl = target instanceof Element && Boolean(target.closest(".snapink-fit-lightbox-image, .snapink-fit-lightbox-arrow, .snapink-fit-lightbox-close, .snapink-fit-lightbox-footer"));
        if (fitLightboxZoom <= 1 && !clickedControl) setFitLightboxSize(null);
      }}>
        <div className="snapink-fit-lightbox-header">
          <h2 id={`snapink-fit-lightbox-title-${uid}`}>Size {fitLightboxSize} — {fitLightboxSize} exposed {fitLightboxSize === 1 ? "peg" : "pegs"}</h2>
          <button ref={fitLightboxCloseRef} type="button" className="snapink-fit-lightbox-close" aria-label="Close enlarged size example" onClick={() => setFitLightboxSize(null)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div
          ref={fitLightboxRef}
          className="snapink-fit-lightbox-viewer"
          onClick={(event) => { if (event.target === event.currentTarget && fitLightboxZoom <= 1) setFitLightboxSize(null); }}
          onPointerDown={beginFitGesture}
          onPointerMove={moveFitGesture}
          onPointerUp={endFitGesture}
          onPointerCancel={endFitGesture}
        >
          <button type="button" className="snapink-fit-lightbox-arrow snapink-fit-lightbox-prev" aria-label="Previous size" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); navigateFitLightbox(-1); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <img
            ref={fitLightboxImageRef}
            className="snapink-fit-lightbox-image"
            src={`/images/website_images/${fitLightboxSize}_pegs.png`}
            alt={`Size ${fitLightboxSize} compatibility example with ${fitLightboxSize} exposed ${fitLightboxSize === 1 ? "peg" : "pegs"}`}
            draggable={false}
            decoding="async"
            style={{ transform: `translate(${fitLightboxPan.x}px, ${fitLightboxPan.y}px) scale(${fitLightboxZoom})` }}
            onClick={(event) => event.stopPropagation()}
          />
          <button type="button" className="snapink-fit-lightbox-arrow snapink-fit-lightbox-next" aria-label="Next size" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); navigateFitLightbox(1); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
        <div className="snapink-fit-lightbox-footer">
          <span>Swipe between sizes · Pinch to zoom · Drag to pan</span>
          <div>
            <button type="button" aria-label="Zoom out" disabled={fitLightboxZoom <= 1} onClick={() => { const zoom = Math.max(1, fitLightboxZoom - 0.5); setFitLightboxZoom(zoom); if (zoom === 1) setFitLightboxPan({ x: 0, y: 0 }); }}>−</button>
            <span>{Math.round(fitLightboxZoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" disabled={fitLightboxZoom >= 4} onClick={() => setFitLightboxZoom(Math.min(4, fitLightboxZoom + 0.5))}>+</button>
          </div>
        </div>
      </div>,
      document.body
    )}
      {showPublishProduct && <div role="dialog" aria-modal="true" aria-label="Add product to shop" className="fixed inset-0 z-[10000] grid place-items-center bg-black/70 p-4" onClick={(event)=>{if(event.target===event.currentTarget)setShowPublishProduct(false);}}>
        <form onSubmit={handlePublishProduct} className="w-full max-w-lg space-y-4 rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Add product to shop</h2><p className="mt-1 text-sm text-neutral-400">Selected generated Studio images will be attached to one listing.</p></div><button type="button" aria-label="Close" onClick={()=>setShowPublishProduct(false)} className="rounded-lg px-3 py-1 text-neutral-300">×</button></div>
          <label className="block text-sm">Product Name<input required maxLength={100} value={publishProductName} onChange={(event)=>setPublishProductName(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" /></label>
          <label className="block text-sm">Short Shop card description (optional)<textarea maxLength={240} value={publishProductCardDescription} onChange={(event)=>setPublishProductCardDescription(event.target.value)} placeholder={`${publishProductName || "This design"} adds a distinctive, interchangeable detail to your compatible snapback.`} rows={2} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" /></label>
          <label className="block text-sm">Full product description (optional)<textarea maxLength={2000} value={publishProductDescription} onChange={(event)=>setPublishProductDescription(event.target.value)} placeholder={`Make the ${publishProductName || "design"} your own with a SnapInk sleeve made for compatible snapback closures. Sleeve only; hat sold separately.`} rows={3} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" /></label>
          <p className="text-sm text-neutral-300">Sleeve Style: {variant === "standard" ? "Standard" : "Billboard"} · Sleeve Color: {backgroundColor}</p>
          <p className="text-xs text-neutral-400">{artworkIsExtended ? "Extended design prices: sizes 0-2 $24.99 | sizes 3-5 $29.99" : "Sizes 0-3: $15.99 | Sizes 4-5: $18.99"}</p>
          {artworkIsExtended && <div className="space-y-2 rounded-lg border border-amber-500/70 bg-amber-950/60 p-3 text-sm text-amber-100"><strong>Extended Artwork — Pricing Review Required</strong><p>Extension top {artworkStatus.topExtensionMm.toFixed(1)} mm / bottom {artworkStatus.bottomExtensionMm.toFixed(1)} mm; artwork {selectedArtworkWidthMm.toFixed(1)} × {selectedArtworkHeightMm.toFixed(1)} mm; height {artworkHeightScale}%; position X {productionDraftPosition.centerXmm.toFixed(1)} mm, Y {productionCenterYmm.toFixed(1)} mm. Extended design pricing: sizes 0-2 $24.99; sizes 3-5 $29.99. Final production feasibility will be confirmed during design review.</p><label className="flex items-start gap-2"><input type="checkbox" checked={approveExtendedArtwork} onChange={(event)=>setApproveExtendedArtwork(event.target.checked)} /><span>I approve publishing this extended design at the premium design price shown above, subject to production review.</span></label></div>}
          {publishProductStatus && <p role="status" className="break-all text-sm text-neutral-200">{publishProductStatus.includes("/shop/")?<><a className="underline" href={publishProductStatus.slice(publishProductStatus.indexOf(location.origin)+location.origin.length)} target="_blank" rel="noreferrer">{publishProductStatus}</a></>:publishProductStatus}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setShowPublishProduct(false)} className="rounded-lg border border-neutral-600 px-4 py-2">Close</button><button type="submit" disabled={publishingProduct||!generatedShopImages||(artworkIsExtended&&!approveExtendedArtwork)||artworkInvalid} className="rounded-lg bg-si-accent px-4 py-2 font-black text-neutral-950 disabled:opacity-50">{publishingProduct?"Publishing…":"Publish Product"}</button></div>
        </form>
      </div>}
    </>
  );
});

export default SnapInkSleeveCustomizer;

// ---------- Range Component ----------
function Range({
  label,
  min,
  max,
  step = 1,
  precision = 1,
  value,
  setValue,
  suffix = "",
}: {
  label: string;
  min: number;
  max: number;
  step?: number | "any";
  precision?: number;
  value: number;
  setValue: (n: number) => void;
  suffix?: string;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-xs text-neutral-400">{label}</label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="min-w-0 flex-1 accent-si-accent"
        />
        <span className="w-14 shrink-0 text-right text-neutral-300 text-sm tabular-nums">
          {Number(value.toFixed(precision))}
          {suffix}
        </span>
      </div>
    </div>
  );
}

// ---------- Color Swatches ----------
function ColorSwatchRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_SWATCHES.map((c) => {
        const selected = c.value.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c.label}
            type="button"
            aria-label={c.label}
            aria-pressed={selected}
            onClick={() => onChange(c.value)}
            className={`w-7 h-7 rounded-full border ${
              selected ? "ring-2 ring-si-accent border-white" : "border-neutral-600"
            }`}
            style={{ backgroundColor: c.value }}
            title={c.label}
          />
        );
      })}
    </div>
  );
}

// ---------- Dev tests ----------
if (import.meta.env.DEV) {
  console.assert(clamp(5, 0, 10) === 5);
  console.assert(clamp(-1, 0, 10) === 0);
  console.assert(clamp(11, 0, 10) === 10);
}

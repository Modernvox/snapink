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
import {
  BRANDING_GROOVE_WIDTH_MM,
  GEOMETRY_VERSION,
  POSITIONING_VERSION,
  PRODUCTION_BRANDING_INSET_MM,
  SLEEVE_GEOMETRY,
  brandingRegionFor,
  brandingCenterCanvasPercentFor,
  brandingSurfacePath,
  cadXToCanvasX,
  geometryFor,
  maximumContainedLogoHeightMm,
  nonPrintableGroovePath,
  surfaceBounds,
  studioArtworkPositionFor,
  type SleeveVariant,
} from "../config/sleeveGeometry";

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
  align: "start" | "center" | "end";
  safeMargin: number;
  bgType: "vector";
  backgroundColor: string;
  logoDataUrl?: string;
  logoName?: string;
  logoX: number;
  logoY: number;
  logoScale: number;
  logoOpacity: number;
  productionGeometryVersion: string;
  positioningVersion: string;
  brandingCenterXmm: number;
  artworkCenterXmm: number;
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
}

export interface SnapInkSleeveCustomizerRef {
  downloadPNG: () => void;
  getOrderFiles: () => Promise<{ artworkSvg: string; previewPng: string; sourceArtwork: string }>;
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

const OFFICIAL_STUDIO_DEFAULTS: Pick<
  SleeveDraft,
  | "size" | "variant" | "text" | "font" | "fontSize" | "fontWeight"
  | "tracking" | "lineHeight" | "fill" | "stroke" | "strokeWidth"
  | "styleMode" | "arc" | "posX" | "posY" | "align" | "safeMargin"
  | "bgType" | "backgroundColor" | "logoX" | "logoY" | "logoScale" | "logoOpacity"
> = {
  size: 2,
  variant: "billboard",
  text: "",
  font: WEB_SAFE_FONTS.find((item) => item.label === "Bebas Neue")!.stack,
  fontSize: 396,
  fontWeight: 300,
  tracking: 0,
  lineHeight: 1,
  fill: "#FFFFFF",
  stroke: "#000000",
  strokeWidth: 0,
  styleMode: "emboss",
  arc: 0,
  posX: brandingCenterCanvasPercentFor("billboard", 2),
  posY: 50,
  align: "center",
  safeMargin: 6,
  bgType: "vector",
  backgroundColor: "#000000",
  logoX: studioArtworkPositionFor(
    "billboard",
    2,
    brandingCenterCanvasPercentFor("billboard", 2),
    50
  ).logoX,
  logoY: 50,
  logoScale: 100,
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

// Photo previews use the approved product photos. These crop bounds remove
// transparent canvas only; the source files themselves stay untouched. The
// face polygons follow the visible branding panels in those images.
const SLEEVE_PHOTO = {
  billboard: {
    src: "/images/website_images/blank_billboard_sleeve.png",
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

// Approved size-specific photographs. Values are the PNG's real dimensions;
// the strap bounds are measured in each source photo and used only for preview
// placement. The CAD coordinate system remains independent of these values.
const HAT_PREVIEW = [
  // Standard sleeve bounds are measured per source photo. The right edge
  // reaches the strap boundary; exposed male pegs are preserved as cutouts.
  { src: "/images/website_images/0_pegs.png", width: 914, height: 609, strap: { left: 96, right: 812, top: 342, bottom: 521 }, standardSleeveRight: 812 },
  { src: "/images/website_images/1_pegs.png", width: 318, height: 247, strap: { left: 42, right: 285, top: 165, bottom: 237 }, standardSleeveRight: 285 },
  { src: "/images/website_images/2_pegs.png", width: 963, height: 642, strap: { left: 112, right: 878, top: 412, bottom: 594 }, standardSleeveRight: 878 },
  { src: "/images/website_images/3_pegs.png", width: 963, height: 642, strap: { left: 95, right: 880, top: 402, bottom: 582 }, standardSleeveRight: 880 },
  { src: "/images/website_images/4_pegs.png", width: 963, height: 642, strap: { left: 93, right: 881, top: 418, bottom: 594 }, standardSleeveRight: 881 },
  { src: "/images/website_images/5_pegs.png", width: 963, height: 642, strap: { left: 80, right: 911, top: 434, bottom: 603 }, standardSleeveRight: 911 },
] as const;
const STUDIO_STAGE_WIDTH_HEIGHT_RATIO = 1000 / 650;
// Sleeve preview calibration extras are defined as CSS pixels at the approved
// 1440px desktop layout, where the stage renders 585px wide. Convert them to
// stage-relative height so the same completed composition scales on mobile.
const STUDIO_PREVIEW_REFERENCE_STAGE_WIDTH_PX = 585;
type SleevePreviewCalibration = {
  horizontalScale: number;
  horizontalOffsetHatSourcePx: number;
  verticalScale: number;
  verticalOffsetHatSourcePx: number;
  verticalExtraPreviewPx: number;
};
// Independent per-photo, per-style preview calibration. Horizontal anchors
// use each photo's measured opening/strap bounds; vertical bounds are measured
// separately from that photo's strap. Preview-only values never enter CAD.
const SLEEVE_PREVIEW_CALIBRATION: Record<SleeveVariant, readonly SleevePreviewCalibration[]> = {
  standard: [
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 0 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
  ],
  billboard: [
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
    { horizontalScale: 1, horizontalOffsetHatSourcePx: 0, verticalScale: 1, verticalOffsetHatSourcePx: 0, verticalExtraPreviewPx: 10 },
  ],
};
const LONGEST_SLEEVE_LENGTH_MM =
  SLEEVE_GEOMETRY.standard.sizes[5].overallMaxXmm -
  SLEEVE_GEOMETRY.standard.sizes[5].overallMinXmm;

function hatComposition(
  size: number,
  variant: SleeveVariant,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth = HAT_PREVIEW[size].width,
  naturalHeight = HAT_PREVIEW[size].height
) {
  const hat = HAT_PREVIEW[size];
  const fitScale = Math.min(canvasWidth / naturalWidth, canvasHeight / naturalHeight);
  const drawnWidth = naturalWidth * fitScale;
  const drawnHeight = naturalHeight * fitScale;
  const left = (canvasWidth - drawnWidth) / 2;
  const top = (canvasHeight - drawnHeight) / 2;
  const sourceScaleX = naturalWidth / hat.width;
  const sourceScaleY = naturalHeight / hat.height;
  const calibration = SLEEVE_PREVIEW_CALIBRATION[variant][size];
  const strapTop = top + hat.strap.top * sourceScaleY * fitScale;
  const strapBottom = top + hat.strap.bottom * sourceScaleY * fitScale;
  const horizontalOffset = calibration.horizontalOffsetHatSourcePx * sourceScaleX * fitScale;
  const verticalOffset = calibration.verticalOffsetHatSourcePx * sourceScaleY * fitScale;
  const sleeveTop = strapTop + verticalOffset;
  const sleeveBottom = sleeveTop + (strapBottom - strapTop) * calibration.verticalScale;
  const strapWidth = (hat.strap.right - hat.strap.left) * sourceScaleX * fitScale;
  const strapLeft = left + hat.strap.left * sourceScaleX * fitScale;
  const sleeveAnchorX = strapLeft + horizontalOffset;
  const standardSleeveWidth = (hat.standardSleeveRight - hat.strap.left) * sourceScaleX * fitScale;
  return { hat, fitScale, drawnWidth, drawnHeight, left, top, strapTop, strapBottom, sleeveTop, sleeveBottom, strapWidth, strapLeft, sleeveAnchorX, standardSleeveWidth, calibration };
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

function drawStudioComposition(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sleeve: HTMLImageElement,
  ghostHat: HTMLImageElement | null,
  sleeveWidthPercent: number,
  sleeveHeightPercent: number,
  size: number,
  variant: SleeveVariant,
  sleeveCenterXPercent: number,
  sleeveBottomYPercent: number
) {
  if (!ghostHat) {
    context.drawImage(sleeve, 0, 0, canvas.width, canvas.height);
    return;
  }

  const composition = hatComposition(size, variant, canvas.width, canvas.height, ghostHat.naturalWidth, ghostHat.naturalHeight);
  context.drawImage(ghostHat, composition.left, composition.top, composition.drawnWidth, composition.drawnHeight);
  const sleeveWidth = canvas.width * sleeveWidthPercent / 100;
  const sleeveHeight = canvas.height * sleeveHeightPercent / 100;
  context.drawImage(
    sleeve,
    canvas.width * sleeveCenterXPercent / 100 - sleeveWidth / 2,
    canvas.height * sleeveBottomYPercent / 100 - sleeveHeight,
    sleeveWidth,
    sleeveHeight
  );
}

// ---------- Component ----------
const SnapInkSleeveCustomizer = forwardRef<
  SnapInkSleeveCustomizerRef,
  SnapInkSleeveCustomizerProps
>(function SnapInkSleeveCustomizer(
  { width = 1400, onChange, className = "", initial = {}, fixedProductConfiguration = false, fixedArtworkColor, forcedStyleMode },
  ref
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dlRef = useRef<HTMLAnchorElement | null>(null);
  const [stageClientWidth, setStageClientWidth] = useState(() =>
    typeof window !== "undefined" && window.innerWidth <= 640
      ? Math.max(1, window.innerWidth - 92)
      : 1000
  );
  const attachStageRef = useCallback((stage: HTMLDivElement | null) => {
    stageRef.current = stage;
    if (stage) setStageClientWidth(stage.clientWidth || 1000);
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
  const [posX, setPosX] = useState(initial.posX ?? brandingCenterCanvasPercentFor(initialVariant, initialSize));
  const [posY, setPosY] = useState(initial.posY ?? OFFICIAL_STUDIO_DEFAULTS.posY);
  const [align, setAlign] = useState<"start" | "center" | "end">(
    initial.align ?? OFFICIAL_STUDIO_DEFAULTS.align
  );
  const [showGuides, setShowGuides] = useState(false);
  const [safeMargin, setSafeMargin] = useState(initial.safeMargin ?? OFFICIAL_STUDIO_DEFAULTS.safeMargin);
  const [backgroundColor, setBackgroundColor] = useState(
    initial.backgroundColor ?? OFFICIAL_STUDIO_DEFAULTS.backgroundColor
  );
  useEffect(() => { if (fixedArtworkColor && /^#[0-9A-Fa-f]{6}$/.test(fixedArtworkColor)) setFill(fixedArtworkColor); }, [fixedArtworkColor]);
  const [exportScale, setExportScale] = useState(2);
  const [logoDataUrl, setLogoDataUrl] = useState(initial.logoDataUrl ?? "");
  const [logoAspectRatio, setLogoAspectRatio] = useState(1);
  const [logoVisibleBounds, setLogoVisibleBounds] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [logoName, setLogoName] = useState(initial.logoName ?? "");
  const [logoInputVersion, setLogoInputVersion] = useState(0);
  const [logoNeedsRemoval, setLogoNeedsRemoval] = useState(false);
  const [logoHasProcessedRemoval, setLogoHasProcessedRemoval] = useState(false);
  const [logoRemovalBusy, setLogoRemovalBusy] = useState(false);
  const [logoRemovalMessage, setLogoRemovalMessage] = useState("");
  const [logoRemovalProgress, setLogoRemovalProgress] = useState(0);
  const [logoSourceFile, setLogoSourceFile] = useState<File | null>(null);
  const logoUploadTaskRef = useRef(0);
  const logoRemovalLockRef = useRef(0);
  const [logoScale, setLogoScale] = useState(initial.logoScale ?? OFFICIAL_STUDIO_DEFAULTS.logoScale);
  const [logoOpacity, setLogoOpacity] = useState(initial.logoOpacity ?? OFFICIAL_STUDIO_DEFAULTS.logoOpacity);
  const [variant, setVariant] = useState<SleeveVariant>(initial.variant ?? OFFICIAL_STUDIO_DEFAULTS.variant);

  // Mobile accordion
  const [mobileOpen, setMobileOpen] = useState<"text" | "logo" | "position" | "export">(
    "text"
  );
  const [ghostHat, setGhostHat] = useState(true);
  const [sleeveSize, setSleeveSize] = useState(initial.size ?? OFFICIAL_STUDIO_DEFAULTS.size);
  const [hatNaturalSize, setHatNaturalSize] = useState({ src: "", width: 0, height: 0 });

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
    setPosX(brandingCenterCanvasPercentFor(OFFICIAL_STUDIO_DEFAULTS.variant, OFFICIAL_STUDIO_DEFAULTS.size));
    setPosY(OFFICIAL_STUDIO_DEFAULTS.posY);
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
      setLogoVisibleBounds({ x: 0, y: 0, width: 1, height: 1 });
      return;
    }
    const uploadedImage = new Image();
    let active = true;
    uploadedImage.onload = () => {
      if (!active || uploadedImage.naturalWidth <= 0 || uploadedImage.naturalHeight <= 0) return;
      const imageWidth = uploadedImage.naturalWidth;
      const imageHeight = uploadedImage.naturalHeight;
      let visible = { x: 0, y: 0, width: imageWidth, height: imageHeight };
      try {
        const scanScale = Math.min(1, 1024 / Math.max(imageWidth, imageHeight));
        const scanWidth = Math.max(1, Math.round(imageWidth * scanScale));
        const scanHeight = Math.max(1, Math.round(imageHeight * scanScale));
        const canvas = document.createElement("canvas");
        canvas.width = scanWidth;
        canvas.height = scanHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(uploadedImage, 0, 0, scanWidth, scanHeight);
          const pixels = context.getImageData(0, 0, scanWidth, scanHeight).data;
          let minX = scanWidth;
          let minY = scanHeight;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < scanHeight; y += 1) {
            for (let x = 0; x < scanWidth; x += 1) {
              if (pixels[(y * scanWidth + x) * 4 + 3] === 0) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          if (maxX >= minX && maxY >= minY) {
            visible = {
              x: minX / scanWidth * imageWidth,
              y: minY / scanHeight * imageHeight,
              width: (maxX - minX + 1) / scanWidth * imageWidth,
              height: (maxY - minY + 1) / scanHeight * imageHeight,
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
    };
    uploadedImage.src = logoDataUrl;
    return () => { active = false; };
  }, [logoDataUrl]);

  const draftCanvasX = text.trim() ? posX : brandingCenterCanvasPercentFor(variant, sleeveSize);
  const draftCanvasY = text.trim() ? posY : 50;
  const productionDraftPosition = studioArtworkPositionFor(variant, sleeveSize, draftCanvasX, draftCanvasY);

  // Push changes upward
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
      align,
      safeMargin,
      bgType: "vector",
      backgroundColor,
      logoDataUrl: logoDataUrl || undefined,
      logoName: logoName || undefined,
      // Production percentages are normalized to its CAD-derived 1.05 mm
      // inset face bounds. They are not percentages of the sleeve viewBox.
      logoX: productionDraftPosition.logoX,
      logoY: productionDraftPosition.logoY,
      logoScale,
      logoOpacity,
      productionGeometryVersion: GEOMETRY_VERSION,
      positioningVersion: POSITIONING_VERSION,
      brandingCenterXmm: brandingRegion.centerXmm,
      artworkCenterXmm: productionDraftPosition.centerXmm,
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
    align,
    safeMargin,
    backgroundColor,
    logoDataUrl,
    logoName,
    logoScale,
    logoOpacity,
    sleeveSize,
    variant,
    onChange,
    productionDraftPosition.logoX,
    productionDraftPosition.logoY,
  ]);

  const viewW = 1600;
  const activeGeometry = geometryFor(variant, sleeveSize);
  const bounds = surfaceBounds(variant, sleeveSize);
  const brandingRegion = brandingRegionFor(variant, sleeveSize);
  const viewH = viewW * ((bounds.maxY - bounds.minY) / (bounds.maxX - bounds.minX));
  const sleevePhoto = SLEEVE_PHOTO[variant];
  const photoScale = viewW / sleevePhoto.crop.width;
  const previewViewH = sleevePhoto.crop.height * photoScale;
  const photoPoint = (point: readonly [number, number]) => [
    (point[0] - sleevePhoto.crop.x) * photoScale,
    (point[1] - sleevePhoto.crop.y) * photoScale,
  ] as const;
  const photoFacePoints = sleevePhoto.face.map(photoPoint);
  const photoFacePath = `M ${photoFacePoints.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
  // Map the validated CAD branding region onto the photographed branding face.
  // This transform affects only the visual mockup. Production coordinates and
  // exported manufacturing artwork retain their original CAD coordinate space.
  const photoFaceLeft = photoFacePoints[0][0];
  const photoFaceRight = photoFacePoints[1][0];
  const photoFaceTop = (photoFacePoints[0][1] + photoFacePoints[1][1]) / 2;
  const photoFaceBottom = (photoFacePoints[2][1] + photoFacePoints[3][1]) / 2;
  const cadArtworkStart = cadXToCanvasX(
    variant,
    sleeveSize,
    brandingRegion.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2,
    viewW
  );
  const cadArtworkEnd = cadXToCanvasX(
    variant,
    sleeveSize,
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
  // The Billboard product photo includes the flap extension to the left of
  // its CAD branding groove. Map the CAD groove through the same calibrated
  // photo transform used for artwork so the mockup can anchor that groove to
  // the hat opening without changing the sleeve's scale or proportions.
  const billboardGrooveCanvasX = artworkTranslateX
    + cadXToCanvasX(variant, sleeveSize, brandingRegion.grooveXmm, viewW) * artworkScaleX;
  const billboardGrooveFraction = variant === "billboard" ? billboardGrooveCanvasX / viewW : 0;
  // The Standard master has its own physical groove at the left edge of its
  // photographed branding face. Convert that source-image position into the
  // cropped sleeve canvas so it can be anchored to each hat opening.
  const standardGrooveFraction = variant === "standard" ? photoFaceLeft / viewW : 0;
  const sleeveGrooveFraction = variant === "billboard" ? billboardGrooveFraction : standardGrooveFraction;
  const sleeveColorRgb = backgroundColor.match(/[0-9a-f]{2}/gi)?.map((value) => parseInt(value, 16) / 255) ?? [0, 0, 0];
  const isBlackSleeve = backgroundColor.toLowerCase() === "#000000";
  // The approved sleeve master is photographed in black. Preserve its texture
  // by tinting its grayscale lighting, but lift the white material's base so
  // the black source albedo does not make a selected white sleeve render gray.
  const whiteSleeveFloor = backgroundColor.toLowerCase() === "#ffffff" ? 0.82 : 0;
  const sleeveTextureAmplitude = 1 - whiteSleeveFloor;
  const sleeveColorFilterId = `sleeve-color-${uid}`;
  const scaledFontSize = fontSize * (viewH / 450);
  const margin = (safeMargin / 100) * viewH;

  const pathId = `text-arc-path-${uid}`;
  const surfaceClipId = `printable-surface-${uid}`;
  const surfacePath = useMemo(
    () => brandingSurfacePath(variant, sleeveSize, viewW, viewH),
    [variant, sleeveSize, viewH]
  );
  const grooveCutoutPath = useMemo(
    () => nonPrintableGroovePath(variant, sleeveSize, viewW, viewH),
    [variant, sleeveSize, viewH]
  );
  const overallLengthMm = activeGeometry.overallMaxXmm - activeGeometry.overallMinXmm;
  const largestGeometry = SLEEVE_GEOMETRY[variant].sizes[5];
  const largestOverallLengthMm = largestGeometry.overallMaxXmm - largestGeometry.overallMinXmm;
  const sleeveScaleRatio = overallLengthMm / largestOverallLengthMm;
  const currentHat = HAT_PREVIEW[sleeveSize];
  const loadedHatSize = hatNaturalSize.src === currentHat.src ? hatNaturalSize : null;
  const currentStageClientWidth = (svgRef.current?.closest(".snapink-product-stage") as HTMLDivElement | null)?.clientWidth
    || (typeof window !== "undefined" && window.innerWidth <= 640 ? Math.max(1, window.innerWidth - 92) : stageClientWidth);
  const stageComposition = hatComposition(
    sleeveSize,
    variant,
    1000,
    650,
    loadedHatSize?.width,
    loadedHatSize?.height
  );
  // Each style anchors its own actual groove to the opening's left edge.
  // Standard's right edge reaches the photo's strap boundary; exposed pegs
  // remain visible through cutouts in the overlay. Both images scale evenly.
  const sleevePreviewWidthPx = variant === "billboard" && ghostHat
    ? (stageComposition.strapWidth / (1 - billboardGrooveFraction)) * stageComposition.calibration.horizontalScale
    : variant === "standard" && ghostHat
      ? (stageComposition.standardSleeveWidth / (1 - standardGrooveFraction)) * stageComposition.calibration.horizontalScale
      : stageComposition.strapWidth * sleeveScaleRatio;
  const sleevePreviewWidthPercent = (sleevePreviewWidthPx / 1000) * 100;
  const sleevePreviewBaseHeightPercent = sleevePreviewWidthPercent
    * (previewViewH / viewW)
    * STUDIO_STAGE_WIDTH_HEIGHT_RATIO;
  const sleevePreviewBaseBottomYPercent = ghostHat
    ? (stageComposition.sleeveBottom / 650) * 100
    : 50;
  const sleeveExtraHeightPercent = ghostHat
    ? (stageComposition.calibration.verticalExtraPreviewPx
      / (STUDIO_PREVIEW_REFERENCE_STAGE_WIDTH_PX / STUDIO_STAGE_WIDTH_HEIGHT_RATIO)) * 100
    : 0;
  const sleevePreviewBottomYPercent = sleevePreviewBaseBottomYPercent;
  const sleevePreviewHeightPercent = ghostHat
    ? ((stageComposition.strapBottom - stageComposition.strapTop) / 650) * 100
      * stageComposition.calibration.verticalScale + sleeveExtraHeightPercent
    : sleevePreviewBaseHeightPercent;
  const sleeveSvgHeight = previewViewH;
  const sleevePreviewCenterYPercent = sleevePreviewBottomYPercent - sleevePreviewHeightPercent / 2;
  const sleevePreviewCenterXPercent = ghostHat
    ? ((stageComposition.sleeveAnchorX + sleevePreviewWidthPx * (0.5 - sleeveGrooveFraction)) / 1000) * 100
    : 50;
  const sleevePreviewLeftPercent = sleevePreviewCenterXPercent - sleevePreviewWidthPercent / 2;
  const sleevePreviewGrooveXPercent = sleevePreviewCenterXPercent
    + sleevePreviewWidthPercent * (sleeveGrooveFraction - 0.5);
  const sleevePreviewRightPercent = sleevePreviewCenterXPercent + sleevePreviewWidthPercent / 2;
  const maximumWidthMm = bounds.maxY - bounds.minY;
  // Artwork is always centered on the CAD branding wall, never on the total sleeve.
  const logoCenterXmm = brandingRegion.centerXmm;
  const logoCenterYmm = (bounds.minY + bounds.maxY) / 2;
  const logoMaxHeightMm = maximumContainedLogoHeightMm(
    variant,
    sleeveSize,
    logoCenterXmm,
    logoCenterYmm,
    logoAspectRatio
  );
  const logoHeightMm = logoMaxHeightMm * (clamp(logoScale, 0, 100) / 100);
  const svgUnitsPerMm = viewW / overallLengthMm;
  const visibleLogoWidthSvg = logoHeightMm * logoAspectRatio * svgUnitsPerMm;
  const visibleLogoHeightSvg = logoHeightMm * svgUnitsPerMm;
  const logoImageHeightSvg = visibleLogoHeightSvg / logoVisibleBounds.height;
  const logoImageWidthSvg = logoImageHeightSvg * logoAspectRatio * logoVisibleBounds.width / logoVisibleBounds.height;
  const logoCenterCanvasX = cadXToCanvasX(variant, sleeveSize, logoCenterXmm, viewW);
  const logoCenterCanvasY = viewH / 2;
  const logoImageX = logoCenterCanvasX - visibleLogoWidthSvg / 2 - logoVisibleBounds.x * logoImageWidthSvg;
  const logoImageY = logoCenterCanvasY - visibleLogoHeightSvg / 2 - logoVisibleBounds.y * logoImageHeightSvg;
  const artworkCenterCanvasPercent = brandingCenterCanvasPercentFor(variant, sleeveSize);
  const artworkMinXCanvasPercent = (cadXToCanvasX(
    variant,
    sleeveSize,
    brandingRegion.grooveXmm + BRANDING_GROOVE_WIDTH_MM / 2 + PRODUCTION_BRANDING_INSET_MM,
    viewW
  ) / viewW) * 100;
  const artworkMaxXCanvasPercent = (cadXToCanvasX(
    variant,
    sleeveSize,
    brandingRegion.rightEdgeXmm - PRODUCTION_BRANDING_INSET_MM,
    viewW
  ) / viewW) * 100;

  function centerCurrentArtwork() {
    setAlign("center");
    setPosX(artworkCenterCanvasPercent);
    setPosY(50);
  }

  function resetCurrentArtworkPosition() {
    // Reset uses the same CAD-derived center as Center, including the 1 mm
    // production inset represented by the usable branding face.
    centerCurrentArtwork();
  }

  function handleVariantChange(nextVariant: SleeveVariant) {
    const wasCentered = align === "center" && Math.abs(posX - artworkCenterCanvasPercent) < 0.01;
    setVariant(nextVariant);
    if (wasCentered) setPosX(brandingCenterCanvasPercentFor(nextVariant, sleeveSize));
  }

  function handleSizeChange(nextSize: number) {
    const wasCentered = align === "center" && Math.abs(posX - artworkCenterCanvasPercent) < 0.01;
    setSleeveSize(nextSize);
    if (wasCentered) setPosX(brandingCenterCanvasPercentFor(variant, nextSize));
  }

  function handleAlignmentChange(nextAlign: "start" | "center" | "end") {
    setAlign(nextAlign);
    if (nextAlign === "center") setPosX(artworkCenterCanvasPercent);
  }

  const arcPath = useMemo(() => {
    const a = clamp(arc, -20, 20);
    const leftX = margin;
    const rightX = viewW - margin;
    const baseY = clamp((posY / 100) * viewH, margin, viewH - margin);
    const midY = clamp(baseY + (a / 100) * viewH, margin, viewH - margin);
    return `M ${leftX} ${baseY} Q ${viewW / 2} ${midY} ${rightX} ${baseY}`;
  }, [arc, margin, posY]);

  // Export PNG
  async function handleExportPNG() {
    if (logoNeedsRemoval) {
      alert("Remove the logo background before exporting, or upload a transparent PNG.");
      return;
    }
    const svg = svgRef.current;
    if (!svg) return;

    // Inline local image assets before serializing. Blob-backed SVG image loads
    // can otherwise finish after the parent SVG has already been rasterized.
    const exportSvg = svg.cloneNode(true) as SVGSVGElement;
    exportSvg.querySelectorAll('[data-preview-only="true"]').forEach((node) => node.remove());
    exportSvg.removeAttribute("style");
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
      alert("The sleeve image could not be prepared for export. Please try again.");
      return;
    }
    const xml = new XMLSerializer().serializeToString(exportSvg);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const sleeveImage = await loadStudioImage(url);
      const ghostImage = ghostHat
        ? await loadStudioImage(HAT_PREVIEW[sleeveSize].src)
        : null;
      const scale = exportScale;
      const canvas = document.createElement("canvas");
      canvas.width = ghostHat
        ? Math.round(viewW * scale)
        : Math.round(viewW * sleeveScaleRatio * scale);
      canvas.height = ghostHat
        ? Math.round(canvas.width / STUDIO_STAGE_WIDTH_HEIGHT_RATIO)
        : Math.round(previewViewH * sleeveScaleRatio * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG export canvas is unavailable.");
      drawStudioComposition(
        context,
        canvas,
        sleeveImage,
        ghostImage,
        sleevePreviewWidthPercent,
        sleevePreviewHeightPercent,
        sleeveSize,
        variant,
        sleevePreviewCenterXPercent,
        sleevePreviewBottomYPercent
      );
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (output) => output ? resolve(output) : reject(new Error("PNG encoding failed.")),
        "image/png"
      ));
      const downloadUrl = URL.createObjectURL(png);
      const anchor = dlRef.current || document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `snapink-preview-${Date.now()}-${scale}x.png`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Studio PNG export could not be rendered.", error);
      alert("The Studio preview could not be converted to a PNG. Please try again.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleGetOrderFiles() {
    if (logoNeedsRemoval) throw new Error("Finish logo background removal before submitting the design.");
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
    const previewXml = new XMLSerializer().serializeToString(previewSvg);

    // Saved/manufacturing SVGs stay in the original CAD coordinate system and
    // never contain the presentation photo. Only the separate PNG preview has
    // the product image composited beneath the artwork.
    const artworkSvgNode = previewSvg.cloneNode(true) as SVGSVGElement;
    artworkSvgNode.querySelectorAll('[data-product-image="true"]').forEach((node) => node.remove());
    const artworkOverlay = artworkSvgNode.querySelector<SVGGElement>('[data-artwork-overlay="true"]');
    const artworkClip = artworkSvgNode.querySelector<SVGGElement>('[data-artwork-clip="true"]');
    artworkOverlay?.removeAttribute("transform");
    artworkClip?.setAttribute("clip-path", `url(#${surfaceClipId}-printable-cad)`);
    artworkSvgNode.setAttribute("viewBox", `0 0 ${viewW} ${viewH}`);
    artworkSvgNode.setAttribute("width", String(viewW));
    artworkSvgNode.setAttribute("height", String(viewH));
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
        ? await loadStudioImage(await resolveDataUrl(HAT_PREVIEW[sleeveSize].src))
        : null;
      // A 1.25× stage preview includes the hat and corrected overlay placement
      // while remaining below the existing private preview upload size limit.
      const previewScale = 1.25;
      const canvas = document.createElement("canvas");
      canvas.width = ghostHat
        ? Math.round(viewW * previewScale)
        : Math.round(viewW * sleeveScaleRatio * previewScale);
      canvas.height = ghostHat
        ? Math.round(canvas.width / STUDIO_STAGE_WIDTH_HEIGHT_RATIO)
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
        sleeveSize,
        variant,
        sleevePreviewCenterXPercent,
        sleevePreviewBottomYPercent
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
      // Text-only orders have no separately uploaded source file. Preserve the
      // exact Studio vector export as their source record; the companion uses
      // the saved text/font settings to generate manufacturing outlines.
      return { artworkSvg, previewPng, sourceArtwork: sourceArtwork || artworkSvg };
    } finally { URL.revokeObjectURL(svgUrl); }
  }

  useImperativeHandle(ref, () => ({ downloadPNG: handleExportPNG, getOrderFiles: handleGetOrderFiles }), [
    exportScale, sleeveScaleRatio, viewW, viewH, previewViewH, surfaceClipId,
    sleevePreviewWidthPercent, sleevePreviewCenterYPercent, sleevePreviewBottomYPercent,
    sleevePreviewHeightPercent, sleevePreviewCenterXPercent, sleeveSize, ghostHat,
    logoNeedsRemoval, logoDataUrl, logoSourceFile, text,
  ]);

  const textAnchor =
    align === "start" ? "start" : align === "end" ? "end" : "middle";

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload a PNG, JPG, SVG, or another image file.");
      e.target.value = "";
      return;
    }

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
        if (task === logoUploadTaskRef.current && typeof reader.result === "string") setLogoDataUrl(reader.result);
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

  const logoControls = (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-neutral-400 mb-1">
          Upload logo or mark
        </label>
        <input
          key={logoInputVersion}
          type="file"
          accept="image/*"
          onChange={handleLogoUpload}
          className="w-full rounded-xl bg-neutral-800/80 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 file:mr-3 file:rounded-lg file:border-0 file:bg-si-button file:px-3 file:py-1.5 file:font-semibold file:text-neutral-950"
        />
        {logoRemovalMessage && (
          <div className="mt-2 space-y-2" aria-live="polite" aria-busy={logoRemovalBusy}>
            <p className={`text-xs leading-relaxed ${logoNeedsRemoval ? "text-amber-200" : "text-neutral-400"}`}>
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
        {logoName && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-neutral-400">
            <span className="truncate">{logoName}</span>
            <button
              type="button"
              onClick={clearLogo}
              className="rounded-lg border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <p className="col-span-2 text-xs leading-5 text-neutral-400">
          Artwork is centered between this sleeve’s flap groove and far-right edge, then centered vertically on the branding surface.
        </p>
        <button type="button" onClick={centerCurrentArtwork} className="rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-xs text-neutral-100 hover:border-si-accent/60">
          Center artwork on branding area
        </button>
        <button type="button" onClick={resetCurrentArtworkPosition} className="rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-xs text-neutral-100 hover:border-si-accent/60">
          Reset position
        </button>
        <Range
          label="Logo size"
          min={0}
          max={100}
          step={1}
          value={logoScale}
          setValue={setLogoScale}
          suffix="%"
        />
        <p className="text-xs leading-5 text-neutral-500">
          Your artwork stays within the sleeve as you resize it.
        </p>
        <Range
          label="Logo opacity"
          min={10}
          max={100}
          step={5}
          value={logoOpacity}
          setValue={setLogoOpacity}
          suffix="%"
        />
      </div>
    </div>
  );

  // Shared preview inner block (used on mobile + desktop)
  const strapPreviewInner = (
    <div className="snapink-preview-content flex min-w-0 flex-col gap-3">
      <div className={`snapink-preview-controls flex min-w-0 flex-wrap items-center justify-between gap-3 px-1 ${fixedProductConfiguration ? "hidden" : ""}`}>
        <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-neutral-300">
            <span>Sleeve Style</span>
            <select aria-label="Sleeve Style" disabled={fixedProductConfiguration} value={variant} onChange={(e) => handleVariantChange(e.target.value as SleeveVariant)} className="min-h-10 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white">
              <option value="standard">Standard</option>
              <option value="billboard">Billboard</option>
            </select>
          </label>
          <label className="snapink-size-control flex min-w-0 flex-col gap-1 text-xs text-neutral-300 sm:col-span-2">
            <span>Choose Your Size</span>
            <select aria-label="Choose Your Size" disabled={fixedProductConfiguration} value={sleeveSize} onChange={(e) => handleSizeChange(Number(e.target.value))} className="min-h-10 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white">
              {[0, 1, 2, 3, 4, 5].map((size) => <option key={size} value={size}>{`Size ${size} — ${size} exposed ${size === 1 ? "peg" : "pegs"}`}</option>)}
            </select>
            {sleeveSize === 0 && <span className="block text-xs leading-5 text-amber-300">Size 0 preview uses its supported Studio sleeve geometry.</span>}
            <div className="snapink-fit-grid mt-2" role="group" aria-label="Snapback compatibility configurations">
              {[0, 1, 2, 3, 4, 5].map((size) => (
                <button key={size} type="button" aria-label={"Choose size " + size + ": " + size + " exposed " + (size === 1 ? "peg" : "pegs")} aria-pressed={sleeveSize === size} onClick={() => handleSizeChange(size)} className={"snapink-fit-card min-w-0 overflow-hidden rounded-lg border p-1 text-left transition-colors " + (sleeveSize === size ? "border-si-accent bg-neutral-800" : "border-neutral-700 bg-neutral-900 hover:border-neutral-500")}>
                  <img src={"/images/website_images/" + size + "_pegs.png"} alt={"Compatibility view showing " + size + " exposed " + (size === 1 ? "peg" : "pegs")} loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-neutral-100 object-contain" />
                  <span className="snapink-fit-card-label block px-1 py-1.5 text-center text-xs font-semibold text-neutral-200">Size {size} — {size} exposed {size === 1 ? "peg" : "pegs"}</span>
                </button>
              ))}
            </div>
            <span className="mt-2 block text-xs leading-5 text-neutral-500">Select a fit above to update the sleeve preview. Size 0 has no retaining holes and retains its sliding channel.</span>
          </label>
          <p className="text-xs leading-5 text-neutral-400 sm:col-span-2">
            Your SnapInk size matches the number of pegs left exposed when you wear your hat.
          </p>
        </div>
        <button type="button" disabled={fixedProductConfiguration} aria-pressed={!ghostHat} onClick={() => setGhostHat(!ghostHat)} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200">
          {ghostHat ? "Sleeve-only view" : "Show Ghost Hat"}
        </button>
        <button type="button" onClick={startNewDesign} className="min-h-10 rounded-lg border border-si-accent/50 px-3 py-2 text-xs font-semibold text-si-accent hover:bg-si-button/10">
          New design
        </button>
      </div>
      <div
      ref={attachStageRef}
      className={`snapink-product-stage relative w-full overflow-hidden rounded-2xl border ${ghostHat && sleeveSize !== 0 && !fixedProductConfiguration ? "" : "snapink-product-stage--sleeve-only"}`}
      style={{ aspectRatio: "1000/650", backgroundColor: "#303030", borderColor: "#505050" }}
    >
      <div aria-hidden="true" className="snapink-stage-light absolute inset-0" />
      <div aria-hidden="true" className="snapink-stage-shadow absolute left-1/2 top-[88%] h-[7%] w-[54%] -translate-x-1/2 rounded-[50%]" />
      {ghostHat && !fixedProductConfiguration && <img
        aria-hidden="true"
        src={HAT_PREVIEW[sleeveSize].src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ pointerEvents: "none" }}
        onLoad={(event) => setHatNaturalSize({
          src: HAT_PREVIEW[sleeveSize].src,
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })}
        data-testid="studio-hat-preview"
        data-hat-size={sleeveSize}
      />}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewW} ${sleeveSvgHeight}`}
        width={viewW}
        height={sleeveSvgHeight}
        data-production-logo-x-percent={productionDraftPosition.logoX}
        data-production-logo-y-percent={productionDraftPosition.logoY}
        data-production-geometry-version={GEOMETRY_VERSION}
        data-positioning-version={POSITIONING_VERSION}
        data-sleeve-variant={variant}
        data-sleeve-size={sleeveSize}
        data-hat-preview-src={HAT_PREVIEW[sleeveSize].src}
        data-stage-sleeve-top-percent={sleevePreviewCenterYPercent - sleevePreviewHeightPercent / 2}
        data-stage-sleeve-height-percent={sleevePreviewHeightPercent}
        data-stage-sleeve-bottom-percent={sleevePreviewCenterYPercent + sleevePreviewHeightPercent / 2}
        data-stage-sleeve-offset-px={stageComposition.calibration.verticalOffsetHatSourcePx}
        data-stage-css-width-px={currentStageClientWidth}
        data-stage-sleeve-bottom-cover-source-px={0}
        data-stage-sleeve-bottom-extra-px={0}
        data-stage-sleeve-vertical-scale={stageComposition.calibration.verticalScale}
        data-stage-sleeve-extra-height-preview-px={stageComposition.calibration.verticalExtraPreviewPx}
        data-stage-hat-strap-top-percent={(stageComposition.strapTop / 650) * 100}
        data-stage-hat-strap-bottom-percent={(stageComposition.strapBottom / 650) * 100}
        data-stage-sleeve-left-percent={sleevePreviewLeftPercent}
        data-stage-billboard-groove-x-percent={variant === "billboard" && ghostHat ? sleevePreviewGrooveXPercent : undefined}
        data-stage-standard-groove-x-percent={variant === "standard" && ghostHat ? sleevePreviewGrooveXPercent : undefined}
        data-stage-hat-opening-left-percent={ghostHat ? (stageComposition.sleeveAnchorX / 1000) * 100 : undefined}
        data-stage-sleeve-right-percent={sleevePreviewRightPercent}
        data-stage-hat-opening-right-percent={ghostHat ? ((stageComposition.sleeveAnchorX + (variant === "standard" ? stageComposition.standardSleeveWidth : stageComposition.strapWidth) * stageComposition.calibration.horizontalScale) / 1000) * 100 : undefined}
        data-branding-center-x-mm={brandingRegion.centerXmm}
        data-branding-center-y-mm={logoCenterYmm}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        className="snapink-sleeve-render absolute left-1/2 top-1/2 block h-auto -translate-x-1/2 -translate-y-1/2 rounded-sm"
        // The 12 style/size profiles independently align the visible sleeve
        // bounds to each photographed strap without changing CAD coordinates.
        style={{
          width: `${sleevePreviewWidthPercent}%`,
          height: `${sleevePreviewHeightPercent}%`,
          left: `${sleevePreviewCenterXPercent}%`,
          top: `${sleevePreviewCenterYPercent}%`,
        }}
      >
        <defs>
          <filter id="emboss" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur
              in="SourceAlpha"
              stdDeviation="1.25"
              result="alpha"
            />
            <feSpecularLighting
              in="alpha"
              surfaceScale="3"
              specularConstant="1.1"
              specularExponent="35"
              lightingColor="#ffffff"
              result="spec"
            >
              <fePointLight x="-200" y="-300" z="400" />
            </feSpecularLighting>
            <feComposite
              in="spec"
              in2="SourceAlpha"
              operator="in"
              result="litSpec"
            />
            <feMerge>
              <feMergeNode in="litSpec" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="shadowText" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodOpacity="0.3" />
          </filter>

          <path id={pathId} d={arcPath} />
          <clipPath id={`${surfaceClipId}-printable-cad`} clipPathUnits="userSpaceOnUse">
            <path d={`${surfacePath} ${grooveCutoutPath}`} fillRule="evenodd" clipRule="evenodd" />
          </clipPath>
          <clipPath id={`${surfaceClipId}-printable-photo`} clipPathUnits="userSpaceOnUse">
            <path d={photoFacePath} />
          </clipPath>
          {!isBlackSleeve && <filter id={sleeveColorFilterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={`0.213 0.715 0.072 0 0 0.213 0.715 0.072 0 0 0.213 0.715 0.072 0 0 0 0 0 1 0`} />
            <feComponentTransfer>
              <feFuncR type="gamma" amplitude={sleeveColorRgb[0] * sleeveTextureAmplitude} exponent="0.42" offset={sleeveColorRgb[0] * whiteSleeveFloor} />
              <feFuncG type="gamma" amplitude={sleeveColorRgb[1] * sleeveTextureAmplitude} exponent="0.42" offset={sleeveColorRgb[1] * whiteSleeveFloor} />
              <feFuncB type="gamma" amplitude={sleeveColorRgb[2] * sleeveTextureAmplitude} exponent="0.42" offset={sleeveColorRgb[2] * whiteSleeveFloor} />
            </feComponentTransfer>
          </filter>}
        </defs>

        <svg
          data-product-image="true"
          x="0"
          y="0"
          width={viewW}
          height={previewViewH}
          viewBox={`${sleevePhoto.crop.x} ${sleevePhoto.crop.y} ${sleevePhoto.crop.width} ${sleevePhoto.crop.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <image
            href={sleevePhoto.src}
            x="0"
            y="0"
            width={sleevePhoto.sourceWidth}
            height={sleevePhoto.sourceHeight}
            preserveAspectRatio="none"
            filter={!isBlackSleeve ? `url(#${sleeveColorFilterId})` : undefined}
            data-testid="studio-blank-sleeve-photo"
          />
        </svg>

        <g clipPath={`url(#${surfaceClipId}-printable-photo)`} data-artwork-clip="true">
        <g transform={photoArtworkTransform} data-artwork-overlay="true">
          <defs><path id={pathId} d={arcPath} /></defs>
        {logoDataUrl && !logoNeedsRemoval && (
          <image
            href={logoDataUrl}
            x={logoImageX}
            y={logoImageY}
            width={logoImageWidthSvg}
            height={logoImageHeightSvg}
            preserveAspectRatio="xMidYMid meet"
            opacity={logoOpacity / 100}
            data-testid="studio-logo-artwork"
            data-branding-center-x-mm={brandingRegion.centerXmm}
            data-branding-groove-valley-x-mm={brandingRegion.grooveXmm}
            data-branding-right-edge-x-mm={brandingRegion.rightEdgeXmm}
            data-visible-center-canvas-x={logoCenterCanvasX}
            data-visible-bounds-x={logoVisibleBounds.x}
            data-visible-bounds-width={logoVisibleBounds.width}
          />
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

        {Boolean(text) && (
          <g
            filter={
              styleMode === "emboss" ? "url(#emboss)" : "url(#shadowText)"
            }
          >
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
                      x={(posX / 100) * 1600}
                      y={
                        (posY / 100) * viewH +
                        (i - (arr.length - 1) / 2) *
                          (scaledFontSize * lineHeight)
                      }
                    >
                      {line}
                    </tspan>
                  ))
                : (() => {
                    const lines = text.split("\n");
                    const centerOffset = clamp(
                      posX,
                      safeMargin,
                      100 - safeMargin
                    );
                    const lineGapPct =
                      ((scaledFontSize * lineHeight) / viewH) * 100;

                    return lines.map((line, i) => {
                      const offsetPct =
                        centerOffset +
                        (i - (lines.length - 1) / 2) * lineGapPct;

                      return (
                        <textPath
                          key={i}
                          href={`#${pathId}`}
                          startOffset={`${clamp(
                            offsetPct,
                            safeMargin,
                            100 - safeMargin
                          )}%`}
                        >
                          {line}
                        </textPath>
                      );
                    });
                  })()}
            </text>
          </g>
        )}
        </g>
        </g>
      </svg>
      </div>
    </div>
  );

  return (
    <div
      className={`
        w-full
        px-2 sm:px-3 lg:px-4
        lg:max-w-[1400px] lg:mx-auto
        ${className}
      `}
      style={{ maxWidth: width }}
    >
      {/* ---------- MOBILE LAYOUT (accordion + preview on top) ---------- */}
      <div className="lg:hidden space-y-4 pb-20">
        {/* Preview at top */}
        <div className="snapink-preview-card p-2.5 sm:p-4 rounded-3xl border border-neutral-700/80 bg-neutral-900/75 shadow-xl shadow-black/20">
          {strapPreviewInner}
        </div>

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
              <label className="block text-sm text-neutral-300">
                Custom text
              </label>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="ENTER YOUR TEXT"
                maxLength={25}
                className="w-full rounded-xl bg-neutral-800/80 border border-neutral-700 px-3 py-2 text-neutral-50"
              />

              <div className="text-right text-xs mt-1">
                <span
                  className={`${
                    text.length >= 25 ? "text-red-500" : "text-neutral-400"
                  }`}
                >
                  {text.length}/25 characters
                </span>
              </div>

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

              <div className="space-y-3 mt-2">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">
                    Fill color (text)
                  </label>
                  {fixedArtworkColor ? <span className="text-sm text-neutral-200">Selected matte TPU color</span> : <ColorSwatchRow value={fill} onChange={setFill} />}
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1">
                    Outline color
                  </label>
                  <ColorSwatchRow value={stroke} onChange={setStroke} />
                </div>

                {!fixedProductConfiguration && <div>
                  <label className="block text-xs text-neutral-400 mb-1">
                    Sleeve color
                  </label>
                  <ColorSwatchRow
                    value={backgroundColor}
                    onChange={setBackgroundColor}
                  />
                </div>}
              </div>
            </div>
          )}
        </div>

        {/* Logo panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() =>
              setMobileOpen(mobileOpen === "logo" ? "position" : "logo")
            }
          >
            <span>Logo Upload</span>
            <span className="text-neutral-400">
              {mobileOpen === "logo" ? "-" : "+"}
            </span>
          </button>
          {mobileOpen === "logo" && (
            <div className="px-4 pb-4 pt-1">
              {logoControls}
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
                  step={0.5}
                  value={posX}
                  setValue={setPosX}
                  suffix="%"
                />
                <Range
                  label="Vertical position"
                  min={20}
                  max={80}
                  step={0.5}
                  value={posY}
                  setValue={setPosY}
                  suffix="%"
                />
              </div>

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

              <a ref={dlRef} className="hidden" />
            </div>
          )}
        </div>

        {/* Sticky-ish mobile CTA */}
        <div className={`fixed inset-x-0 bottom-2 px-4 lg:hidden ${fixedProductConfiguration ? "hidden" : ""}`}>
          <button
            onClick={handleExportPNG}
            className="w-full rounded-xl bg-si-button hover:bg-si-hover text-neutral-950 font-black px-4 py-3 shadow-lg shadow-si-accent/20"
          >
            Download PNG
          </button>
        </div>
      </div>

      {/* ---------- DESKTOP LAYOUT (3 columns, preview spans right side) ---------- */}
      <div className="hidden lg:grid lg:grid-cols-4 gap-4">
        {/* LEFT COLUMN */}
        <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
          <label className="block text-sm text-neutral-300">Custom text</label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ENTER YOUR TEXT"
            maxLength={25}
            className="w-full rounded-xl bg-neutral-800/80 border border-neutral-700 px-3 py-2 text-neutral-50"
          />

          <div className="text-right text-xs mt-1">
            <span
              className={`${
                text.length >= 25 ? "text-red-500" : "text-neutral-400"
              }`}
            >
              {text.length}/25 characters
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

          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Fill color (text)
              </label>
              {fixedArtworkColor ? <span className="text-sm text-neutral-200">Selected matte TPU color</span> : <ColorSwatchRow value={fill} onChange={setFill} />}
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Outline color
              </label>
              <ColorSwatchRow value={stroke} onChange={setStroke} />
            </div>

            {!fixedProductConfiguration && <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Sleeve color
              </label>
              <ColorSwatchRow
                value={backgroundColor}
                onChange={setBackgroundColor}
              />
            </div>}
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
          {logoControls}
        </div>

        {/* RIGHT SIDE (two boxes + preview spanning) */}
        <div className="col-span-2 space-y-4">
          {/* The live product render leads the desktop workspace. */}
          <div className="snapink-preview-card p-3 sm:p-4 rounded-3xl border border-neutral-700/80 bg-neutral-900/75 shadow-xl shadow-black/25">
            {strapPreviewInner}
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
                step={0.5}
                value={posX}
                setValue={setPosX}
                suffix="%"
              />
              <Range
                label="Vertical position"
                min={20}
                max={80}
                step={0.5}
                value={posY}
                setValue={setPosY}
                suffix="%"
              />
            </div>

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

            <a ref={dlRef} className="hidden" />
          </div>

        </div>
      </div>
    </div>
  );
});

export default SnapInkSleeveCustomizer;

// ---------- Range Component ----------
function Range({
  label,
  min,
  max,
  step = 1,
  value,
  setValue,
  suffix = "",
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
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
          {Number(value.toFixed(1))}
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

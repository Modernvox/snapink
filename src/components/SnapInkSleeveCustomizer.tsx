import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useId,
} from "react";

// ---------- Types ----------
export type SleeveDraft = {
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
};

export interface SnapInkSleeveCustomizerProps {
  width?: number;
  onChange?: (draft: SleeveDraft) => void;
  className?: string;
  initial?: Partial<SleeveDraft>;
}

export interface SnapInkSleeveCustomizerRef {
  downloadPNG: () => void;
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ---------- Component ----------
const SnapInkSleeveCustomizer = forwardRef<
  SnapInkSleeveCustomizerRef,
  SnapInkSleeveCustomizerProps
>(function SnapInkSleeveCustomizer(
  { width = 1400, onChange, className = "", initial = {} },
  ref
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dlRef = useRef<HTMLAnchorElement | null>(null);
  const uid = useId();

  // State
  const [text, setText] = useState(initial.text ?? "SNAPINK");
  const [font, setFont] = useState(initial.font ?? WEB_SAFE_FONTS[0].stack);
  const [fontSize, setFontSize] = useState(initial.fontSize ?? 240);
  const [fontWeight, setFontWeight] = useState(initial.fontWeight ?? 400);
  const [tracking, setTracking] = useState(initial.tracking ?? 0);
  const [lineHeight, setLineHeight] = useState(initial.lineHeight ?? 1.0);
  const [fill, setFill] = useState(initial.fill ?? "#FFFFFF");
  const [stroke, setStroke] = useState(initial.stroke ?? "#000000");
  const [strokeWidth, setStrokeWidth] = useState(initial.strokeWidth ?? 0);
  const [styleMode, setStyleMode] = useState<"emboss" | "flat">(
    initial.styleMode ?? "emboss"
  );
  const [arc, setArc] = useState(initial.arc ?? 0);
  const [posX, setPosX] = useState(initial.posX ?? 50);
  const [posY, setPosY] = useState(initial.posY ?? 50);
  const [align, setAlign] = useState<"start" | "center" | "end">(
    initial.align ?? "center"
  );
  const [showGuides, setShowGuides] = useState(true);
  const [safeMargin, setSafeMargin] = useState(initial.safeMargin ?? 6);
  const [backgroundColor, setBackgroundColor] = useState(
    initial.backgroundColor ?? "#000000"
  );
  const [exportScale, setExportScale] = useState(2);

  // Mobile accordion
  const [mobileOpen, setMobileOpen] = useState<"text" | "position" | "export">("text");

  // Normalize (tm)
  useEffect(() => {
    const normalized = text.replace(/\(tm\)/gi, "™");
    if (normalized !== text) setText(normalized);
  }, [text]);

  // Push changes upward
  useEffect(() => {
    onChange?.({
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
    onChange,
  ]);

  const viewW = 1600;
  const viewH = 450;
  const margin = (safeMargin / 100) * viewH;

  const pathId = `text-arc-path-${uid}`;

  const arcPath = useMemo(() => {
    const a = clamp(arc, -20, 20);
    const leftX = margin;
    const rightX = viewW - margin;
    const baseY = clamp((posY / 100) * viewH, margin, viewH - margin);
    const midY = clamp(baseY + (a / 100) * viewH, margin, viewH - margin);
    return `M ${leftX} ${baseY} Q ${viewW / 2} ${midY} ${rightX} ${baseY}`;
  }, [arc, margin, posY]);

  // Export PNG
  function handleExportPNG() {
    const svg = svgRef.current;
    if (!svg) return;

    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = exportScale;
      const canvas = document.createElement("canvas");
      canvas.width = viewW * scale;
      canvas.height = viewH * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      URL.revokeObjectURL(url);

      canvas.toBlob((png) => {
        if (!png) return;
        const dlUrl = URL.createObjectURL(png);
        const a = dlRef.current || document.createElement("a");
        a.href = dlUrl;
        a.download = `snapink-preview-${Date.now()}-${scale}x.png`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      }, "image/png");
    };
    img.src = url;
  }

  useImperativeHandle(ref, () => ({ downloadPNG: handleExportPNG }), [
    exportScale,
  ]);

  const textAnchor =
    align === "start" ? "start" : align === "end" ? "end" : "middle";

  // Shared preview inner block (used on mobile + desktop)
  const StrapPreviewInner = () => (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-800"
      style={{ aspectRatio: "1600/450" }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 1600 450"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 block h-full w-full"
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
        </defs>

        <rect x="0" y="0" width="1600" height="450" fill={backgroundColor} />

        {showGuides && (
          <g opacity="0.18">
            <rect
              x={margin}
              y={margin}
              width={1600 - margin * 2}
              height={450 - margin * 2}
              fill="none"
              stroke="#ff0000"
              strokeDasharray="10 7"
            />
            <line
              x1={1600 / 2}
              y1={margin}
              x2={1600 / 2}
              y2={450 - margin}
              stroke="#fff"
              strokeDasharray="6 6"
            />
            <line
              x1={margin}
              y1={450 / 2}
              x2={1600 - margin}
              y2={450 / 2}
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
              fontSize={fontSize}
              fontWeight={fontWeight}
              letterSpacing={`${tracking}em`}
              fill={fill}
              stroke={strokeWidth > 0 ? stroke : "none"}
              strokeWidth={strokeWidth}
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
                        (posY / 100) * 450 +
                        (i - (arr.length - 1) / 2) *
                          (fontSize * lineHeight)
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
                      ((fontSize * lineHeight) / 450) * 100;

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
      </svg>
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
    >
        {/* ---------- MOBILE LAYOUT ---------- */}
        <div className="lg:hidden space-y-4">
            <div className="p-4 rounded-3xl border border-neutral-800 bg-neutral-800">
                <StrapPreviewInner />
            </div>

            { /* … your accordion panels … */ }
        </div>

        {/* ---------- DESKTOP LAYOUT ---------- */}
        <div className="hidden lg:grid lg:grid-cols-3 gap-4">
            { /* … rest of your desktop layout … */ }
        </div>
    </div>
  );

        {/* Text / Styling panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() => setMobileOpen(mobileOpen === "text" ? "position" : "text")}
          >
            <span>Text & Styling</span>
            <span className="text-neutral-400">
              {mobileOpen === "text" ? "−" : "+"}
            </span>
          </button>
          {mobileOpen === "text" && (
            <div className="px-4 pb-4 pt-1 space-y-3">
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
                  <ColorSwatchRow value={fill} onChange={setFill} />
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1">
                    Outline color
                  </label>
                  <ColorSwatchRow value={stroke} onChange={setStroke} />
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1">
                    Strap / background color
                  </label>
                  <ColorSwatchRow
                    value={backgroundColor}
                    onChange={setBackgroundColor}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Position panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() => setMobileOpen(mobileOpen === "position" ? "export" : "position")}
          >
            <span>Position & Guides</span>
            <span className="text-neutral-400">
              {mobileOpen === "position" ? "−" : "+"}
            </span>
          </button>
          {mobileOpen === "position" && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              <div className="grid grid-cols-3 gap-3 items-center">
                <div className="col-span-2">
                  <label className="block text-xs text-neutral-400">Alignment</label>
                  <div className="flex gap-1">
                    {["start", "center", "end"].map((k) => (
                      <button
                        key={k}
                        onClick={() => setAlign(k as "start" | "center" | "end")}
                        className={`px-3 py-1.5 rounded-lg border text-sm ${
                          align === k
                            ? "bg-pink-600/20 text-pink-200 border-pink-500"
                            : "bg-neutral-800/70 border-neutral-700 text-neutral-300"
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    setPosX(50);
                    setPosY(50);
                  }}
                  className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2 text-xs"
                >
                  Center text
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Range
                  label="Position X"
                  min={safeMargin}
                  max={100 - safeMargin}
                  step={0.5}
                  value={posX}
                  setValue={setPosX}
                  suffix="%"
                />
                <Range
                  label="Position Y"
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
                  label="Safe margin"
                  min={0}
                  max={12}
                  step={0.5}
                  value={safeMargin}
                  setValue={setSafeMargin}
                  suffix="%"
                />
                <div>
                  <label className="block text-xs text-neutral-400">Guides</label>
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
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 overflow-hidden mb-16">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-neutral-100"
            onClick={() => setMobileOpen(mobileOpen === "export" ? "text" : "export")}
          >
            <span>Export</span>
            <span className="text-neutral-400">
              {mobileOpen === "export" ? "−" : "+"}
            </span>
          </button>
          {mobileOpen === "export" && (
            <div className="px-4 pb-4 pt-1 space-y-3">
              <button
                onClick={handleExportPNG}
                className="w-full rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold px-4 py-3"
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
                Saves a PNG the cart can attach at checkout.
              </p>

              <a ref={dlRef} className="hidden" />
            </div>
          )}
        </div>

        {/* Sticky-ish mobile CTA (optional you can tweak) */}
        <div className="fixed inset-x-0 bottom-2 px-4">
          <button
            onClick={handleExportPNG}
            className="w-full rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold px-4 py-3 shadow-lg shadow-pink-500/30"
          >
            Download PNG
          </button>
        </div>
      </div>

      {/* ---------- DESKTOP LAYOUT (3 columns, preview spans right side) ---------- */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-4">
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
              <ColorSwatchRow value={fill} onChange={setFill} />
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Outline color
              </label>
              <ColorSwatchRow value={stroke} onChange={setStroke} />
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Strap / background color
              </label>
              <ColorSwatchRow
                value={backgroundColor}
                onChange={setBackgroundColor}
              />
            </div>
          </div>
        </div>

        {/* RIGHT SIDE (two boxes + preview spanning) */}
        <div className="col-span-2 space-y-4">
          {/* ALIGNMENT BOX */}
          <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
            <div className="grid grid-cols-3 gap-3 items-center">
              <div className="col-span-2">
                <label className="block text-xs text-neutral-400">Alignment</label>
                <div className="flex gap-1">
                  {["start", "center", "end"].map((k) => (
                    <button
                      key={k}
                      onClick={() => setAlign(k as "start" | "center" | "end")}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${
                        align === k
                          ? "bg-pink-600/20 text-pink-200 border-pink-500"
                          : "bg-neutral-800/70 border-neutral-700 text-neutral-300"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  setPosX(50);
                  setPosY(50);
                }}
                className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2"
              >
                Center text
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Range
                label="Position X"
                min={safeMargin}
                max={100 - safeMargin}
                step={0.5}
                value={posX}
                setValue={setPosX}
                suffix="%"
              />
              <Range
                label="Position Y"
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
                label="Safe margin"
                min={0}
                max={12}
                step={0.5}
                value={safeMargin}
                setValue={setSafeMargin}
                suffix="%"
              />
              <div>
                <label className="block text-xs text-neutral-400">Guides</label>
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
              className="w-full rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold px-4 py-3"
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
              Saves a PNG the cart can attach at checkout.
            </p>

            <a ref={dlRef} className="hidden" />
          </div>

          {/* PREVIEW — spans under right-side boxes */}
          <div className="p-4 rounded-3xl border border-neutral-800 bg-neutral-800">
            <StrapPreviewInner />
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
    <div>
      <label className="block text-xs text-neutral-400">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-full accent-pink-500"
        />
        <span className="w-16 text-right text-neutral-300 text-sm tabular-nums">
          {value}
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
              selected ? "ring-2 ring-pink-500 border-white" : "border-neutral-600"
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
if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
  console.assert(clamp(5, 0, 10) === 5);
  console.assert(clamp(-1, 0, 10) === 0);
  console.assert(clamp(11, 0, 10) === 10);
}

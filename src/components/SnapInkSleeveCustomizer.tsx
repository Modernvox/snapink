import logoBg from "@/assets/logo_shape.svg"; 

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
  bgType: "image" | "vector";
  bgFit: "cover" | "contain";
};

export interface SnapInkSleeveCustomizerProps {
  backgroundImageUrl?: string; // file import, same-origin URL, or data URL
  width?: number;               // CSS pixel width cap for preview container
  onChange?: (draft: SleeveDraft) => void;
  className?: string;
  initial?: Partial<SleeveDraft>;
}

export interface SnapInkSleeveCustomizerRef {
  downloadPNG: () => void;
}

// Built-in vector fallback (simplified, no filters)
const DEFAULT_BG = "";

/**
 * A curated list of typefaces for the customizer.  The first family in each
 * stack corresponds to a webfont loaded via Google Fonts (see `customize.html`),
 * followed by sensible local fallbacks.  Each label appears in the font
 * selection dropdown.  Feel free to add or remove entries to suit your brand.
 */
const WEB_SAFE_FONTS: { label: string; stack: string }[] = [
  // Bold / Block / Display
  { label: "Impact / Arial Black", stack: "Impact, Arial Black, system-ui, sans-serif" },
  { label: "Bebas Neue", stack: "'Bebas Neue', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Anton", stack: "'Anton', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Staatliches", stack: "'Staatliches', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Bungee", stack: "'Bungee', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Black Ops One", stack: "'Black Ops One', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Stint Ultra Expanded", stack: "'Stint Ultra Expanded', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Teko", stack: "'Teko', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Righteous", stack: "'Righteous', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Kanit", stack: "'Kanit', Impact, 'Arial Black', system-ui, sans-serif" },
  { label: "Oxanium", stack: "'Oxanium', Impact, 'Arial Black', system-ui, sans-serif" },

  // Modern Sans / Clean / Fashion
  { label: "Montserrat", stack: "'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Inter", stack: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Open Sans", stack: "'Open Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Lato", stack: "'Lato', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Oswald", stack: "'Oswald', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Poppins", stack: "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Raleway", stack: "'Raleway', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Nunito", stack: "'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Zalando Sans", stack: "'Zalando Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Julius Sans One", stack: "'Julius Sans One', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Unica One", stack: "'Unica One', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: "Sawarabi Gothic", stack: "'Sawarabi Gothic', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },

  // Luxury Serif / High-End
  { label: "Playfair Display", stack: "'Playfair Display', Georgia, 'Times New Roman', serif" },
  { label: "Abril Fatface", stack: "'Abril Fatface', Georgia, 'Times New Roman', serif" },
  { label: "Cinzel", stack: "'Cinzel', Georgia, 'Times New Roman', serif" },
  { label: "Cinzel Decorative", stack: "'Cinzel Decorative', Georgia, 'Times New Roman', serif" },
  { label: "Marcellus", stack: "'Marcellus', Georgia, 'Times New Roman', serif" },
  { label: "Cormorant Garamond", stack: "'Cormorant Garamond', Georgia, 'Times New Roman', serif" },
  { label: "Prata", stack: "'Prata', Georgia, 'Times New Roman', serif" },
  { label: "Cardo", stack: "'Cardo', Georgia, 'Times New Roman', serif" },
  { label: "Libre Baskerville", stack: "'Libre Baskerville', Georgia, 'Times New Roman', serif" },
  { label: "Zilla Slab", stack: "'Zilla Slab', Georgia, 'Times New Roman', serif" },

  // Script / Cursive / Signature
  { label: "Great Vibes", stack: "'Great Vibes', cursive" },
  { label: "Tangerine", stack: "'Tangerine', cursive" },
  { label: "Hurricane", stack: "'Hurricane', cursive" },
  { label: "Pacifico", stack: "'Pacifico', 'Comic Sans MS', cursive, sans-serif" }
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Try to inline remote images as data URLs to avoid canvas taint on export
async function toDataUrlSafe(src: string): Promise<string> {
  try {
    if (src.startsWith("data:")) return src; // already safe

    // Attempt fetch (works for same-origin or proper CORS)
    const url = new URL(src, window.location.origin);
    const res = await fetch(url.toString(), { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    // Fallback to original (export may taint if CORS headers are absent)
    return src;
  }
}

const SnapInkSleeveCustomizer = forwardRef<SnapInkSleeveCustomizerRef, SnapInkSleeveCustomizerProps>(
function SnapInkSleeveCustomizer(
  {
    backgroundImageUrl,
    width = 1400,
    onChange,
    className = "",
    initial = {},
  },
  ref
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dlRef = useRef<HTMLAnchorElement | null>(null);
  const uid = useId();

  const [text, setText] = useState<string>(initial.text ?? "SNAPINK");
  const [font, setFont] = useState<string>(initial.font ?? WEB_SAFE_FONTS[0].stack);
  const [fontSize, setFontSize] = useState<number>(initial.fontSize ?? 140);
  const [tracking, setTracking] = useState<number>(initial.tracking ?? 0);
  const [lineHeight, setLineHeight] = useState<number>(initial.lineHeight ?? 1.0);
  const [fill, setFill] = useState<string>(initial.fill ?? "#ffffff");
  const [stroke, setStroke] = useState<string>(initial.stroke ?? "#000000");
  const [strokeWidth, setStrokeWidth] = useState<number>(initial.strokeWidth ?? 0);
  const [styleMode, setStyleMode] = useState<"emboss" | "flat">(initial.styleMode ?? "emboss");
  const [arc, setArc] = useState<number>(initial.arc ?? 8);
  const [posX, setPosX] = useState<number>(initial.posX ?? 50);
  const [posY, setPosY] = useState<number>(initial.posY ?? 55);
  const [align, setAlign] = useState<"start" | "center" | "end">(initial.align ?? "center");
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [safeMargin, setSafeMargin] = useState<number>(initial.safeMargin ?? 6);
  const [bgType, setBgType] = useState<"image" | "vector">(initial.bgType ?? "image");
  const [bgFit, setBgFit] = useState<"cover" | "contain">(initial.bgFit ?? "contain");

  // PNG export scale (1x–4x)
  const [exportScale, setExportScale] = useState<number>(2);

  // Background URL chosen by user/type
  const rawBgUrl = useMemo(() => {
    if (bgType === "vector") return DEFAULT_BG;
    return backgroundImageUrl || DEFAULT_BG;
  }, [bgType, backgroundImageUrl]);

  // A version safe for PNG export (attempts to inline)
  const [safeBgUrl, setSafeBgUrl] = useState<string>(rawBgUrl);
  useEffect(() => {
    let alive = true;
    (async () => {
      const safe = await toDataUrlSafe(rawBgUrl);
      if (alive) setSafeBgUrl(safe);
    })();
    return () => { alive = false; };
  }, [rawBgUrl]);

  // Normalize TM when user types "(tm)"
  useEffect(() => {
    const normalized = text.replace(/\(tm\)/gi, "™");
    if (normalized !== text) setText(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Keyboard nudging for position
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 2 : 0.5;
      if (e.key === "ArrowLeft")  setPosX(v => clamp(v - step, safeMargin, 100 - safeMargin));
      if (e.key === "ArrowRight") setPosX(v => clamp(v + step, safeMargin, 100 - safeMargin));
      if (e.key === "ArrowUp")    setPosY(v => clamp(v - step, 0, 100));
      if (e.key === "ArrowDown")  setPosY(v => clamp(v + step, 0, 100));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeMargin]);

  // Emit changes
  useEffect(() => {
    onChange?.({
      text, font, fontSize, tracking, lineHeight,
      fill, stroke, strokeWidth, styleMode,
      arc, posX, posY, align, safeMargin, bgType, bgFit,
    });
  }, [
    text, font, fontSize, tracking, lineHeight,
    fill, stroke, strokeWidth, styleMode,
    arc, posX, posY, align, safeMargin, bgType, bgFit, onChange
  ]);

  // Derived sizes
  const viewW = 1600;
  const viewH = 450;
  const margin = (safeMargin / 100) * viewH;

  const pathId = `text-arc-path-${uid}`;

  // Arc path with control point clamped into safe area
  const arcPath = useMemo(() => {
    const a = clamp(arc, -20, 20);
    const leftX = margin;
    const rightX = viewW - margin;
    const baseY = clamp((posY / 100) * viewH, margin, viewH - margin);
    const midY  = clamp(baseY + (a / 100) * viewH, margin, viewH - margin);
    return `M ${leftX} ${baseY} Q ${viewW / 2} ${midY} ${rightX} ${baseY}`;
  }, [arc, margin, posY]);

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
      ctx.fillStyle = "#0b0b0b";
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
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  useImperativeHandle(ref, () => ({ downloadPNG: handleExportPNG }), [exportScale]);

  const textAnchor = align === "start" ? "start" : align === "end" ? "end" : "middle";

  return (
    <div
      className={`w-full ${className}`}
      style={{ maxWidth: width ?? 1400, margin: "0 auto", padding: "0 1rem" }}
    >
      {/* Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
          <label className="block text-sm text-neutral-300">Custom text</label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value.toUpperCase())}
            placeholder="ENTER YOUR TEXT"
            maxLength={40}
            className="w-full rounded-xl bg-neutral-800/80 border border-neutral-700 px-3 py-2 text-neutral-50 focus:outline-none focus:ring-2 focus:ring-pink-500/60"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400">Font</label>
              <select
                className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50"
                value={font}
                onChange={(e) => setFont(e.target.value)}
              >
                {WEB_SAFE_FONTS.map((f) => (
                  <option key={f.label} value={f.stack}>
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
                onChange={(e) => setStyleMode(e.target.value as "emboss" | "flat")}
              >
                <option value="emboss">Embossed</option>
                <option value="flat">Printed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Range label="Font size" min={60} max={340} step={1} value={fontSize} setValue={setFontSize} suffix="px" />
            <Range label="Tracking" min={-0.1} max={0.3} step={0.01} value={tracking} setValue={setTracking} suffix="em" />
            <Range label="Line height" min={0.9} max={1.6} step={0.01} value={lineHeight} setValue={setLineHeight} />
            <Range label="Arc (bow)" min={-15} max={20} step={1} value={arc} setValue={setArc} suffix="%" />
          </div>

          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs text-neutral-400">Fill</label>
              <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} className="w-full h-9 rounded overflow-hidden" />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Outline</label>
              <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} className="w-full h-9 rounded overflow-hidden" />
            </div>
            <Range label="Stroke" min={0} max={6} step={0.5} value={strokeWidth} setValue={setStrokeWidth} />
          </div>
        </div>

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
                setPosY(55);
              }}
              className="rounded-lg border border-neutral-700 bg-neutral-800/70 text-neutral-200 px-3 py-2 hover:bg-neutral-800"
            >
              Center text
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Range label="Position X" min={safeMargin} max={100 - safeMargin} step={0.5} value={posX} setValue={setPosX} suffix="%" />
            <Range label="Position Y (baseline)" min={20} max={80} step={0.5} value={posY} setValue={setPosY} suffix="%" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Range label="Safe margin" min={0} max={12} step={0.5} value={safeMargin} setValue={setSafeMargin} suffix="%" />
            <div>
              <label className="block text-xs text-neutral-400">Guides</label>
              <div className="flex items-center gap-2">
                <input id="guides" type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                <label htmlFor="guides" className="text-neutral-300 text-sm">
                  Show safe area
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400">Background</label>
              <select className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50" value={bgType} onChange={(e) => setBgType(e.target.value as "image" | "vector")}>
                <option value="image">Photo/PNG/SVG</option>
                <option value="vector">Built-in vector</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Image fit</label>
              <select className="w-full rounded-lg bg-neutral-800/80 border border-neutral-700 px-2 py-2 text-neutral-50" value={bgFit} onChange={(e) => setBgFit(e.target.value as "cover" | "contain")}>
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 shadow-sm space-y-3">
          <h3 className="text-neutral-200 font-semibold">Actions</h3>
          <button onClick={handleExportPNG} className="w-full rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold px-4 py-3">
            Download PNG preview
          </button>
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span>Scale</span>
            <select
              className="rounded bg-neutral-800/80 border border-neutral-700 px-2 py-1 text-neutral-200"
              value={exportScale}
              onChange={(e) => setExportScale(Number(e.target.value))}
            >
              {[1,2,3,4].map(s => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
          <p className="text-xs text-neutral-400">Saves a PNG the cart can attach at checkout.</p>
          <a ref={dlRef} className="hidden" />
        </div>
      </div>

      {/* PREVIEW */}
      <div className="rounded-3xl border border-neutral-800 bg-neutral-800 p-4">
        <div className="relative w-full overflow-hidden rounded-2xl" style={{ aspectRatio: `1600/450` }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 1600 450`}
            xmlns="http://www.w3.org/2000/svg"
            className="absolute inset-0 block h-full w-full"
          >
            <defs>
              {/* Emboss / Lighting */}
              <filter id="emboss" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="1.25" result="alpha" />
                <feSpecularLighting in="alpha" surfaceScale="3" specularConstant="1.1" specularExponent="35" lightingColor="#ffffff" result="spec">
                  <fePointLight x="-200" y="-300" z="400" />
                </feSpecularLighting>
                <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip" />
                <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="bevel" />
                <feMerge>
                  <feMergeNode in="bevel" />
                  <feMergeNode in="specClip" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* subtle text shadow for flat mode */}
              <filter id="shadowText" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodOpacity="0.3" />
              </filter>

              {/* text path for arc */}
              <path id={pathId} d={arcPath} />
            </defs>

            {/* background as a direct <image> (scales predictably) */}
            <image
              href={safeBgUrl}
              crossOrigin="anonymous"
              x="0"
              y="0"
              width={1600}
              height={450}
              preserveAspectRatio={bgFit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
            />

            {/* safe area guides */}
            {showGuides && (
              <g opacity="0.18">
                <rect x={margin} y={margin} width={1600 - margin * 2} height={450 - margin * 2} fill="none" stroke="#ffffff" strokeDasharray="10 7" />
                <line x1={1600 / 2} y1={margin} x2={1600 / 2} y2={450 - margin} stroke="#fff" strokeDasharray="6 6" />
                <line x1={margin} y1={450 / 2} x2={1600 - margin} y2={450 / 2} stroke="#fff" strokeDasharray="6 6" />
              </g>
            )}

            {/* TEXT */}
            {Boolean(text) && (
              <g style={{ filter: styleMode === "emboss" ? "url(#emboss)" : "url(#shadowText)" }}>
                <text
                  fontFamily={font}
                  fontSize={fontSize}
                  letterSpacing={`${tracking}em`}
                  fill={fill}
                  stroke={strokeWidth > 0 ? stroke : "none"}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dominantBaseline="central"
                  textAnchor={textAnchor}
                  paintOrder="stroke fill"
                >
                  {Math.abs(arc) < 1 ? (
                    // Straight layout (supports multi-line)
                    text.split("\n").map((line, i, arr) => (
                      <tspan
                        key={i}
                        x={(posX / 100) * 1600}
                        y={(posY / 100) * 450 + (i - (arr.length - 1) / 2) * (fontSize * lineHeight)}
                      >
                        {line}
                      </tspan>
                    ))
                  ) : (
                    // Arced layout: stack lines by offsetting startOffset a bit
                    (() => {
                      const lines = text.split("\n");
                      const centerOffset = clamp(posX, safeMargin, 100 - safeMargin);
                      const lineGapPct = (fontSize * lineHeight) / 450 * 100; // visual approximation
                      return lines.map((line, i) => {
                        const offsetPct = centerOffset + (i - (lines.length - 1) / 2) * lineGapPct;
                        return (
                          <textPath key={i} href={`#${pathId}`} startOffset={`${clamp(offsetPct, safeMargin, 100 - safeMargin)}%`}>
                            {line}
                          </textPath>
                        );
                      });
                    })()
                  )}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
});

export default SnapInkSleeveCustomizer;

function Range({
  label, min, max, step = 1, value, setValue, suffix = "",
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
          {value}{suffix}
        </span>
      </div>
    </div>
  );
}

// ---------- Lightweight Dev Tests (run only in dev) ----------
if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
  console.assert(clamp(5, 0, 10) === 5, "clamp: inside range should be same");
  console.assert(clamp(-1, 0, 10) === 0, "clamp: below min should equal min");
  console.assert(clamp(11, 0, 10) === 10, "clamp: above max should equal max");
}

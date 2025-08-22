import React, { useMemo, useRef, useState, useEffect } from "react";

// SnapInk Custom Strap Builder
// Single-file React component with Tailwind CSS classes
// - Live SVG preview of hat back + strap
// - Text entry with character/count validation
// - Font, size, spacing, casing, color, style (matte / glossy / metallic / neon)
// - Left/center/right alignment
// - Download PNG mockup
// - Price updates by characters (example pricing logic)

const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));

const FONTS = [
  { id: "inter", label: "Sans (Inter)", stack: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" },
  { id: "serif", label: "Serif (Merriweather)", stack: "Merriweather, ui-serif, Georgia, Cambria, Times New Roman, serif" },
  { id: "condensed", label: "Condensed (Impact)", stack: "Impact, Haettenschweiler, Franklin Gothic, Arial Narrow, sans-serif" }
];

const STYLES = [
  { id: "matte", label: "Matte", desc: "Flat ink look" },
  { id: "gloss", label: "Gloss", desc: "Shiny ink look" },
  { id: "metal", label: "Metallic", desc: "Brushed gold/metal effect" },
  { id: "neon", label: "Neon", desc: "Soft glow" }
];

const DEFAULTS = {
  text: "SUCCESS",
  font: FONTS[0].id,
  size: 44,
  letterSpacing: 1,
  casing: "upper",
  align: "center",
  strapColor: "#111111",
  textColor: "#ffffff",
  style: "matte",
  outline: true,
};

export default function App() {
  const [text, setText] = useState(DEFAULTS.text);
  const [font, setFont] = useState(DEFAULTS.font);
  const [size, setSize] = useState(DEFAULTS.size);
  const [letterSpacing, setLetterSpacing] = useState(DEFAULTS.letterSpacing);
  const [casing, setCasing] = useState(DEFAULTS.casing);
  const [align, setAlign] = useState(DEFAULTS.align);
  const [strapColor, setStrapColor] = useState(DEFAULTS.strapColor);
  const [textColor, setTextColor] = useState(DEFAULTS.textColor);
  const [style, setStyle] = useState(DEFAULTS.style);
  const [outline, setOutline] = useState(DEFAULTS.outline);

  const [maxChars, setMaxChars] = useState(14); // responsive cap (you can tweak)

  const displayText = useMemo(() => {
    const raw = text || "";
    if (casing === "upper") return raw.toUpperCase();
    if (casing === "lower") return raw.toLowerCase();
    return raw;
  }, [text, casing]);

  const over = displayText.length > maxChars;

  // Pricing example: base $24.99 + $0.60 per character over 6
  const price = useMemo(() => {
    const base = 24.99;
    const add = Math.max(0, displayText.length - 6) * 0.6;
    return (base + add).toFixed(2);
  }, [displayText.length]);

  const svgRef = useRef(null);

  // Dynamically compute available text width inside strap
  const STRAP = { x: 50, y: 188, w: 460, h: 64, r: 12 };

  // Adjust maxChars based on size/letterSpacing heuristics
  useEffect(() => {
    const capacity = Math.floor( (STRAP.w / ((size*0.55) + letterSpacing*2)) );
    setMaxChars(clamp(capacity, 6, 22));
  }, [size, letterSpacing]);

  function fontStack(id){
    return FONTS.find(f=>f.id===id)?.stack || FONTS[0].stack;
  }

  function textAnchor(){
    return align === "left" ? "start" : align === "right" ? "end" : "middle";
  }

  function textX(){
    return align === "left" ? STRAP.x + 18 : align === "right" ? STRAP.x + STRAP.w - 18 : STRAP.x + STRAP.w/2;
  }

  // Visual effects
  const defs = (
    <defs>
      {/* Gloss highlight */}
      <linearGradient id="glossGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.0" />
      </linearGradient>

      {/* Brushed metal gradient */}
      <linearGradient id="metalGold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#8a6c28"/>
        <stop offset="25%" stopColor="#d7b45a"/>
        <stop offset="50%" stopColor="#f0d98a"/>
        <stop offset="75%" stopColor="#c9a94e"/>
        <stop offset="100%" stopColor="#7c652a"/>
      </linearGradient>

      {/* Soft neon glow */}
      <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      {/* Inner shadow for strap */}
      <filter id="innerShadow" x="-50%" y="-50%" width="200%" height="200%">
        <feOffset dx="0" dy="1" />
        <feGaussianBlur stdDeviation="2" result="offset-blur"/>
        <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse"/>
        <feFlood floodColor="#000" floodOpacity="0.45"/>
        <feComposite operator="in" in2="inverse"/>
        <feComposite operator="over" in2="SourceGraphic"/>
      </filter>
    </defs>
  );

  function downloadPNG(){
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const image64 = `data:image/svg+xml;base64,${svg64}`;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 560; canvas.height = 280;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0,0,canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapink-strap-${displayText.replace(/\s+/g,'-').toLowerCase()}.png`;
      a.click();
    };
    img.src = image64;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-6xl mx-auto p-6 grid lg:grid-cols-[1.3fr,1fr] gap-6">
        {/* Preview */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold tracking-tight">Live preview</h2>
            <button onClick={downloadPNG} className="px-3 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm">Download PNG</button>
          </div>

          {/* SVG mockup */}
          <svg ref={svgRef} viewBox="0 0 560 280" className="w-full h-auto">
            {defs}
            {/* background vignette */}
            <defs>
              <radialGradient id="bgGrad" cx="50%" cy="40%" r="70%">
                <stop offset="0%" stopColor="#1b1b1b" />
                <stop offset="100%" stopColor="#0a0a0a" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="560" height="280" fill="url(#bgGrad)" />

            {/* hat silhouette */}
            <g opacity="0.85">
              <path d="M70 190 q-6 -66 60 -100 q60 -30 150 -16 q88 12 120 60 q18 26 16 56" fill="#202020"/>
              <path d="M70 190 h420 v16 q0 12 -12 12 h-396 q-12 0 -12 -12z" fill="#1a1a1a"/>
              {/* stitch lines */}
              <path d="M280 74 v96" stroke="#2a2a2a" strokeWidth="2" strokeDasharray="4 4"/>
            </g>

            {/* strap base */}
            <g filter="url(#innerShadow)">
              <rect x={STRAP.x} y={STRAP.y} rx={STRAP.r} ry={STRAP.r} width={STRAP.w} height={STRAP.h} fill={strapColor} />
              {/* peg dots */}
              <g opacity="0.35">
                {Array.from({length:7}).map((_,i)=> (
                  <circle key={i} cx={STRAP.x+34 + i*58} cy={STRAP.y+STRAP.h/2} r="4" fill="#000" />
                ))}
              </g>
            </g>

            {/* gloss over strap if gloss style */}
            {style === 'gloss' && (
              <rect x={STRAP.x+2} y={STRAP.y+2} rx={STRAP.r-2} ry={STRAP.r-2} width={STRAP.w-4} height={Math.max(10, STRAP.h*0.45)} fill="url(#glossGrad)" opacity="0.55" />
            )}

            {/* text shadow/outline */}
            {outline && (
              <text x={textX()} y={STRAP.y + STRAP.h/2 + size/3.2}
                textAnchor={textAnchor()}
                fontSize={size+4}
                letterSpacing={`${letterSpacing}px`}
                fontFamily={fontStack(font)}
                fill="#000"
                opacity="0.6"
                style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 4 }}>
                {displayText}
              </text>
            )}

            {/* main text */}
            <text x={textX()} y={STRAP.y + STRAP.h/2 + size/3.2}
              textAnchor={textAnchor()}
              fontSize={size}
              letterSpacing={`${letterSpacing}px`}
              fontFamily={fontStack(font)}
              fill={style === 'metal' ? 'url(#metalGold)' : textColor}
              filter={style === 'neon' ? 'url(#neonGlow)' : undefined}
              style={{ fontWeight: 800 }}>
              {displayText}
            </text>
          </svg>

          {/* warnings */}
          <div className="mt-3 text-sm">
            <span className={`px-2 py-1 rounded-md ${over? 'bg-amber-500/20 text-amber-300' : 'bg-neutral-800 text-neutral-300'}`}>
              {displayText.length}/{maxChars} characters {over && '(too long for best fit)'}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 space-y-5">
          <h2 className="text-xl font-bold tracking-tight">Customize your strap</h2>

          {/* Text */}
          <div className="space-y-2">
            <label className="text-sm text-neutral-300">Text</label>
            <input
              value={text}
              onChange={e=>setText(e.target.value.slice(0, 28))}
              placeholder="Type your word or name"
              className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-pink-600"
            />
            <div className="flex gap-2 text-sm">
              {['upper','lower','as-is'].map(v=> (
                <button key={v} onClick={()=>setCasing(v)} className={`px-2.5 py-1 rounded-md border ${casing===v?'border-pink-500 bg-pink-500/20':'border-neutral-700 bg-neutral-800'} text-neutral-200`}>{v.toUpperCase()}</button>
              ))}
            </div>
          </div>

          {/* Typography */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-neutral-300">Font</label>
              <select value={font} onChange={e=>setFont(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700">
                {FONTS.map(f=> <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-neutral-300">Style</label>
              <select value={style} onChange={e=>setStyle(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700">
                {STYLES.map(s=> <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-neutral-300">Size</label>
              <input type="range" min={28} max={60} value={size} onChange={e=>setSize(parseInt(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="text-sm text-neutral-300">Letter spacing</label>
              <input type="range" min={0} max={6} value={letterSpacing} onChange={e=>setLetterSpacing(parseInt(e.target.value))} className="w-full" />
            </div>
          </div>

          {/* Alignment */}
          <div className="space-y-1">
            <label className="text-sm text-neutral-300">Alignment</label>
            <div className="flex gap-2">
              {['left','center','right'].map(v=> (
                <button key={v} onClick={()=>setAlign(v)} className={`px-3 py-1.5 rounded-md border ${align===v?'border-pink-500 bg-pink-500/20':'border-neutral-700 bg-neutral-800'} text-neutral-200`}>{v}</button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-neutral-300">Strap color</label>
              <input type="color" value={strapColor} onChange={e=>setStrapColor(e.target.value)} className="mt-1 w-full h-10 bg-neutral-800 rounded" />
            </div>
            <div>
              <label className="text-sm text-neutral-300">Text color</label>
              <input type="color" value={textColor} onChange={e=>setTextColor(e.target.value)} disabled={style==='metal'} className={`mt-1 w-full h-10 rounded ${style==='metal'?'opacity-50 cursor-not-allowed':''} bg-neutral-800`} />
              {style==='metal' && <p className="text-xs text-neutral-400 mt-1">Metallic uses gradient fill.</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={outline} onChange={e=>setOutline(e.target.checked)} /> Outline/Shadow</label>
          </div>

          {/* Price + CTA */}
          <div className="pt-2 flex items-center justify-between">
            <div className="text-sm text-neutral-300">Estimated price <span className="font-semibold text-white">${price}</span></div>
            <button className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold" disabled={over} title={over? 'Shorten text to fit':''}>
              Add to cart
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-neutral-500 pb-8">Tip: keep it under {maxChars} characters for the cleanest fit.</p>
    </div>
  );
}

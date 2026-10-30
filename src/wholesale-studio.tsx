import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer, { type SnapInkSleeveCustomizerRef, type SleeveDraft } from "./components/SnapInkSleeveCustomizer";

type Color = { id: string; manufacturer: string; name: string; hex: string; materialType: string };
const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
};
const dataUrl = async (blob: Blob) => await new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not package saved design files.")); reader.readAsDataURL(blob);
});
async function hasUnselectedArtworkColors(source: string | undefined, selected: string[]) {
  if (!source) return false;
  try {
    const blob = await (await fetch(source)).blob();
    if (blob.type === "image/svg+xml") {
      const text = await blob.text();
      const paints = [...text.matchAll(/\b(?:fill|stroke)=["'](#[0-9a-f]{6})["']/gi)].map((match) => match[1].toUpperCase());
      const unique = [...new Set(paints.filter((color) => color !== "NONE"))];
      return unique.some((color) => !selected.some((choice) => choice.toUpperCase() === color));
    }
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas"); canvas.width = Math.min(128, bitmap.width); canvas.height = Math.min(128, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) return true;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Map<string, number>();
      for (let i=0;i<pixels.length;i+=4) { if(pixels[i+3]<96)continue; const hex=[0,1,2].map((n)=>Math.min(255,Math.round(pixels[i+n]/32)*32).toString(16).padStart(2,"0")).join("").toUpperCase();colors.set(hex,(colors.get(hex)||0)+1); }
      const significant = [...colors].filter(([, count]) => count >= 3).map(([hex]) => `#${hex}`);
      const selectedBuckets = selected.map((hex) => `#${[1,3,5].map((index) => Math.min(255,Math.round(parseInt(hex.slice(index,index+2),16)/32)*32).toString(16).padStart(2,"0")).join("").toUpperCase()}`);
      return significant.some((color) => !selectedBuckets.includes(color));
    } finally { bitmap.close(); }
  } catch { return true; }
}

function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const style = params.get("variant") === "standard" ? "standard" : "billboard";
  const sizeValue = Number(params.get("size") || 4), size = Number.isInteger(sizeValue) && sizeValue >= 0 && sizeValue <= 6 ? sizeValue : 4;
  const colorId = params.get("color") || "", designId = params.get("designId") || "", returnLineValue = Number(params.get("returnLine")), returnLine = Number.isInteger(returnLineValue) && returnLineValue >= 0 ? returnLineValue : null;
  const ref = useRef<SnapInkSleeveCustomizerRef>(null);
  const [colors, setColors] = useState<Color[]>([]), [base, setBase] = useState<Color | null>(null);
  const [draft, setDraft] = useState<SleeveDraft | null>(null), [initial, setInitial] = useState<Partial<SleeveDraft> | null>(null);
  const [primaryColorId, setPrimaryColorId] = useState(""), [secondColorId, setSecondColorId] = useState(""), [error, setError] = useState("Checking partner access…"), [saving, setSaving] = useState(false);
  const [designName, setDesignName] = useState("Custom sleeve design");
  const [restoredId] = useState("");
  const primary = colors.find((color) => color.id === primaryColorId) || null;
  const second = colors.find((color) => color.id === secondColorId) || null;
  const artColorIds = useMemo(() => [...new Set([primary?.id, second?.id].filter(Boolean))] as string[], [primary, second]);
  const artColors = useMemo(() => [...new Set([primary?.hex.toUpperCase(), second?.hex.toUpperCase()].filter(Boolean))] as string[], [primary, second]);
  const colorCount = useMemo(() => new Set([base?.hex.toUpperCase(), ...artColors].filter(Boolean)).size, [base, artColors]);

  useEffect(() => {
    let active = true;
    (async () => {
      const config = await api("/api/wholesale");
      if (!active) return;
      const options = (config.colors || []) as Color[]; setColors(options);
      const selected = options.find((item) => item.id === colorId) || options[0] || null;
      setBase(selected);
      const preferredArt = options.find((item) => item.id !== selected?.id && item.hex.toUpperCase() === "#FFFFFF") || options.find((item) => item.id !== selected?.id) || selected;
      setPrimaryColorId(preferredArt?.id || "");
      let values: Partial<SleeveDraft> = { variant: style, size, ...(selected ? { backgroundColor: selected.hex } : {}), ...(preferredArt ? { fill: preferredArt.hex } : {}) };
      if (designId) {
        const { design } = await api(`/api/wholesale/designs?id=${encodeURIComponent(designId)}`);
        setDesignName(design.designName || "Custom sleeve design");
        values = { ...JSON.parse(design.draftJson), variant: style, size, ...(selected ? { backgroundColor: selected.hex } : {}) };
        const sourceResponse = await fetch(`/api/wholesale/design-files?id=${encodeURIComponent(designId)}&kind=source`, { credentials: "same-origin", cache: "no-store" });
        if (!sourceResponse.ok) throw new Error("Could not reopen the saved source artwork.");
        const blob = await sourceResponse.blob();
        if (blob.type.startsWith("image/")) values.logoDataUrl = await dataUrl(blob);
        const savedColors = design.artworkColorsJson ? JSON.parse(design.artworkColorsJson) : [];
        const firstSaved = options.find((item: Color) => item.id === savedColors[0] || item.hex.toUpperCase() === String(savedColors[0]).toUpperCase());
        const secondSaved = options.find((item: Color) => item.id === savedColors[1] || item.hex.toUpperCase() === String(savedColors[1]).toUpperCase());
        if (firstSaved) { setPrimaryColorId(firstSaved.id); values.fill = firstSaved.hex; }
        setSecondColorId(secondSaved?.id || "");
      }
      setInitial(values); setError("");
    })().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Partner Studio could not load."); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!draft || !ref.current || !base || saving) return;
    if (!draft.hasCustomArtwork) { setError("Add text or upload artwork before saving a custom sleeve."); return; }
    if (colorCount > 3 || artColors.length > 2) { setError("A sleeve can use no more than three distinct TPU colors including its base."); return; }
    setSaving(true); setError("Saving private design…");
    try {
      const files = await ref.current.getOrderFiles();
      const colorReviewRequired = await hasUnselectedArtworkColors(draft.logoDataUrl, [base.hex, ...artColors]);
      const safeDraft = { ...draft, logoDataUrl: undefined, colorReviewRequired };
      const result = await api("/api/wholesale/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: restoredId || undefined, designName, sleeveStyle: style, sleeveSize: size, baseColorId: base.id, artworkColors: artColorIds, draft: safeDraft, files }) });
      sessionStorage.setItem("snapink.wholesale.returnDesign", JSON.stringify({ design: result.design, returnLine }));
      location.assign("/wholesale");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Design could not be saved."); }
    finally { setSaving(false); }
  }

  if (!initial) return <main className="wholesale-studio"><a href="/wholesale">← Back to wholesale</a><p role="status">{error}</p></main>;
  return <main className="wholesale-studio">
    <header><a href="/wholesale">← Back to wholesale order</a><h1>SnapInk Studio · Custom Sleeve</h1><p>Approved partner workspace. This design is private and is not sent to manufacturing.</p><label>Design name<input maxLength={100} value={designName} onChange={(event)=>setDesignName(event.target.value)} /></label></header>
    {base && <section className="studio-config"><span className="color-chip" style={{ background: base.hex }} /> Base: {base.manufacturer} {base.name} · {style === "standard" ? "Standard" : "Billboard"} · Size {size}</section>}
    <section className="studio-colors"><label>Artwork color 1<select value={primaryColorId} onChange={(event) => setPrimaryColorId(event.target.value)} required>{colors.map(color => <option key={color.id} value={color.id}>{color.manufacturer} · {color.name}</option>)}</select></label><label>Artwork color 2 (optional)<select value={secondColorId} onChange={(event) => setSecondColorId(event.target.value)}><option value="">No second artwork color</option>{colors.map(color => <option key={color.id} value={color.id}>{color.manufacturer} · {color.name}</option>)}</select></label><p><strong>Colors used: {colorCount} / 3</strong> · Color 1 drives Studio text. Use color 2 only for artwork already supplied in that color; artwork is never silently recolored.</p><p>Palette checks flag uploaded art that does not match the selected TPU colors. SnapInk reviews flagged designs. Do not use PLA for permanent raised artwork.</p></section>
    <SnapInkSleeveCustomizer key={`${style}-${size}-${base?.id}-${restoredId}`} ref={ref} width={1600} initial={initial} onChange={setDraft} fixedProductConfiguration fixedArtworkColor={primary?.hex} forcedStyleMode="emboss" />
    <section className="studio-save"><p className="notice" role="status" aria-live="polite">{error}</p><button disabled={saving || !base || colorCount > 3 || artColors.length > 2} onClick={save}>{saving ? "Saving…" : "Add to Wholesale Order"}</button></section>
  </main>;
}

const mount = document.getElementById("wholesale-studio-root");
if (mount) createRoot(mount).render(<React.StrictMode><App /></React.StrictMode>);

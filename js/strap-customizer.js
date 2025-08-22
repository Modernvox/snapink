// /js/strap-customizer.js
// === SnapInk Strap Customizer (DOM-safe) ===
window.addEventListener('DOMContentLoaded', () => {
  // ---- Elements ----
  const $ = (s) => document.getElementById(s);
  const bgImageEl     = $('bgImage');
  const strapRectEl   = $('strapRect');
  const overlayEl     = $('strap-overlay');
  const textLayerEl   = $('strapTextLayer');

  const strapText     = $('strapText');
  const fontSelect    = $('font');
  const sizeRange     = $('size');
  const trackingRange = $('tracking');
  const textColor     = $('textColor');
  const strapColor    = $('strapColor');
  const upperCheck    = $('upper');
  const shadowCheck   = $('shadow');
  const downloadBtn   = $('download');

  const canvas = $('exportCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  // Background selector buttons (future-friendly)
  const bgButtons = Array.from(document.querySelectorAll('[data-bg]'));

  if (!bgImageEl || !strapRectEl || !textLayerEl) {
    console.warn('Customizer: required nodes missing. Check customize.html IDs.');
    return;
  }

  // Cloudflare BG (default)
  const CF_BG = "https://imagedelivery.net/fYqzQPf1CS3qAF1vZpfSLw/e0459dcc-97bf-444c-6f05-330f77204f00/public";

  // Build state with null-safe reads
  const state = {
    bgSrc: CF_BG,
    strapColor: (strapColor && strapColor.value) || '#111111',
    text: 'YOUR TEXT',
    font: (fontSelect && fontSelect.value) || 'Inter, system-ui, sans-serif',
    size: parseInt((sizeRange && sizeRange.value) || '30', 10),
    tracking: parseInt((trackingRange && trackingRange.value) || '1', 10),
    textColor: (textColor && textColor.value) || '#ffffff',
    upper: !!(upperCheck && upperCheck.checked),
    shadow: shadowCheck ? shadowCheck.checked : true,
  };

  // ---- Utilities ----
  function setAriaPressed(targetBtn) {
    bgButtons.forEach(btn => btn.setAttribute('aria-pressed', btn === targetBtn ? 'true' : 'false'));
  }

  // Fit live text within strap width (shrinks down if needed)
  function fitText() {
    if (!textLayerEl || !strapRectEl) return;
    const requested = state.size || 30;
    let px = requested;
    textLayerEl.style.fontSize = `${px}px`;
    // 92% of strap width to leave breathing room
    const maxW = strapRectEl.clientWidth * 0.92;
    let guard = 0;
    while (textLayerEl.scrollWidth > maxW && px > 10 && guard < 60) {
      px -= 1; guard += 1;
      textLayerEl.style.fontSize = `${px}px`;
    }
  }

  function applyToDOM() {
    // Background
    if (bgImageEl.getAttribute('src') !== state.bgSrc) {
      bgImageEl.setAttribute('src', state.bgSrc);
    }

    // Strap color block
    if (strapRectEl) strapRectEl.style.background = state.strapColor;

    // Text content + casing
    const content = state.upper ? (state.text || '').toUpperCase() : (state.text || '');
    textLayerEl.textContent = content || 'YOUR TEXT';

    // Text style
    textLayerEl.style.fontFamily    = state.font;
    textLayerEl.style.letterSpacing = `${state.tracking}px`;
    textLayerEl.style.color         = state.textColor;
    textLayerEl.style.textShadow    = state.shadow ? '0 1px 2px rgba(0,0,0,.55)' : 'none';
    textLayerEl.style.fontSize      = `${state.size}px`;

    fitText();
  }

  // ---- Export helpers ----
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = src;
    });
  }

  function drawObjectCover(ctx, img, cw, ch) {
    const iw = img.width, ih = img.height;
    const scale = Math.max(cw / iw, ch / ih);
    const w = iw * scale, h = ih * scale;
    const x = (cw - w) / 2, y = (ch - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function cssFontToCanvasFont(cssStack) {
    const first = (cssStack || '').split(',')[0].trim();
    return first.replace(/['"]/g, '') || 'Inter';
  }

  function drawSpacedText(ctx, text, xCenter, y, spacing) {
    if (!text) return;
    const glyphW = [...text].map(ch => ctx.measureText(ch).width);
    const totalSpacing = spacing * Math.max(0, text.length - 1);
    const totalW = glyphW.reduce((a,b)=>a+b,0) + totalSpacing;

    let x = xCenter - totalW/2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      ctx.fillText(ch, x + glyphW[i]/2, y);
      x += glyphW[i] + spacing;
    }
  }

  async function exportPNG() {
    if (!canvas || !ctx) return;
    const W = 1600, H = 1000;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0,0,W,H);

    // 1) Background
    try {
      const bg = await loadImage(state.bgSrc);
      drawObjectCover(ctx, bg, W, H);
    } catch {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0,0,W,H);
    }

    // 2) Strap rect (mirror CSS percentages)
    const strap = {
      x: 0.15 * W,
      y: 0.72 * H,
      w: 0.70 * W,
      h: 0.115 * H
    };
    roundRect(ctx, strap.x, strap.y, strap.w, strap.h, 16);
    ctx.fillStyle = state.strapColor;
    ctx.fill();

    // 3) Sheen overlay
    const grd = ctx.createLinearGradient(0, strap.y, 0, strap.y + strap.h);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)');
    grd.addColorStop(1, 'rgba(0,0,0,0.35)');
    roundRect(ctx, strap.x, strap.y, strap.w, strap.h, 16);
    ctx.fillStyle = grd;
    ctx.fill();

    // 4) Text
    const content = state.upper ? (state.text || '').toUpperCase() : (state.text || 'YOUR TEXT');
    // Scale the UI font size up for 1600px export
    const basePx = Math.max(10, Math.min(96, (state.size || 30) * (W / 800)));
    ctx.font = `700 ${basePx}px ${cssFontToCanvasFont(state.font)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.textColor;

    // Optional shadow
    if (state.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    // Auto-shrink to fit strap width
    const maxTextW = strap.w * 0.92;
    let px = basePx;
    while (ctx.measureText(content).width > maxTextW && px > 10) {
      px -= 1;
      ctx.font = `700 ${px}px ${cssFontToCanvasFont(state.font)}`;
    }

    const spacing = (state.tracking || 0) * (W / 800);
    const xCenter = strap.x + strap.w/2;
    const yCenter = strap.y + strap.h/2 + px*0.1; // small optical tweak
    drawSpacedText(ctx, content, xCenter, yCenter, spacing);

    // 5) Save
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = 'snapink-strap.png';
    a.href = url;
    a.click();
  }

  // ---- Events ----
  bgButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.bgSrc = btn.dataset.bg;
      setAriaPressed(btn);
      applyToDOM();
    });
  });

  strapText?.addEventListener('input', (e) => {
    state.text = e.target.value;
    applyToDOM();
  });
  fontSelect?.addEventListener('change', (e) => { state.font = e.target.value; applyToDOM(); });
  sizeRange?.addEventListener('input', (e) => { state.size = parseInt(e.target.value,10) || 30; applyToDOM(); });
  trackingRange?.addEventListener('input', (e) => { state.tracking = parseInt(e.target.value,10) || 0; applyToDOM(); });
  textColor?.addEventListener('input', (e) => { state.textColor = e.target.value || '#ffffff'; applyToDOM(); });
  strapColor?.addEventListener('input', (e) => { state.strapColor = e.target.value || '#111111'; applyToDOM(); });
  upperCheck?.addEventListener('change', (e) => { state.upper = !!e.target.checked; applyToDOM(); });
  shadowCheck?.addEventListener('change', (e) => { state.shadow = !!e.target.checked; applyToDOM(); });

  downloadBtn?.addEventListener('click', exportPNG);

  // Initial paint
  applyToDOM();
  window.addEventListener('resize', fitText);
});

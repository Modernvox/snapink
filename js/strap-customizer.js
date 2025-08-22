// === SnapInk Strap Customizer ===
// Assumes the DOM from customize.html above.

(function () {
  // ---- Elements ----
  const bgImageEl     = document.getElementById('bgImage');
  const strapRectEl   = document.getElementById('strapRect');
  const overlayEl     = document.getElementById('strap-overlay');
  const textLayerEl   = document.getElementById('strapTextLayer');

  const strapText     = document.getElementById('strapText');
  const fontSelect    = document.getElementById('font');
  const sizeRange     = document.getElementById('size');
  const trackingRange = document.getElementById('tracking');
  const textColor     = document.getElementById('textColor');
  const strapColor    = document.getElementById('strapColor');
  const upperCheck    = document.getElementById('upper');
  const shadowCheck   = document.getElementById('shadow');
  const downloadBtn   = document.getElementById('download');

  // Background selector buttons (future-friendly)
  const bgButtons = Array.from(document.querySelectorAll('[data-bg]'));

  // Canvas for export
  const canvas = document.getElementById('exportCanvas');
  const ctx = canvas.getContext('2d');

  const CF_BG = "https://imagedelivery.net/fYqzQPf1CS3qAF1vZpfSLw/e0459dcc-97bf-444c-6f05-330f77204f00/public";

const state = {
  bgSrc: CF_BG,                    // ← use Cloudflare image by default
  strapColor: strapColor.value || '#111111',
  text: 'YOUR TEXT',
  font: fontSelect.value,
  size: parseInt(sizeRange.value, 10) || 30,
  tracking: parseInt(trackingRange.value, 10) || 1,
  textColor: textColor.value || '#ffffff',
  upper: false,
  shadow: true,
};

  // ---- Utilities ----
  function setAriaPressed(targetBtn) {
    bgButtons.forEach(btn => btn.setAttribute('aria-pressed', btn === targetBtn ? 'true' : 'false'));
  }

  function applyToDOM() {
    // Background swaps
    if (bgImageEl.getAttribute('src') !== state.bgSrc) {
      bgImageEl.setAttribute('src', state.bgSrc);
    }

    // Strap color block
    strapRectEl.style.background = state.strapColor;

    // Text content + casing
    const content = state.upper ? (state.text || '').toUpperCase() : (state.text || '');
    textLayerEl.textContent = content || 'YOUR TEXT';

    // Text style
    textLayerEl.style.fontFamily = state.font;
    textLayerEl.style.fontSize = `${state.size}px`;
    textLayerEl.style.letterSpacing = `${state.tracking}px`;
    textLayerEl.style.color = state.textColor;
    textLayerEl.style.textShadow = state.shadow ? '0 1px 2px rgba(0,0,0,.55)' : 'none';
  }

  // Draw the composite to canvas (1600x1000)
  async function exportPNG() {
    // 1) Draw background
    const bg = await loadImage(state.bgSrc);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Fill canvas fully with the background (object-cover equivalent)
    drawObjectCover(ctx, bg, canvas.width, canvas.height);

    // 2) Compute strap rect in canvas coords (mirror the % used in CSS)
    const strap = {
      x: 0.15 * canvas.width,
      y: 0.72 * canvas.height,
      w: 0.70 * canvas.width,
      h: 0.115 * canvas.height
    };

    // 3) Strap color rectangle with rounded corners
    roundRect(ctx, strap.x, strap.y, strap.w, strap.h, 16);
    ctx.fillStyle = state.strapColor;
    ctx.fill();

    // 4) Sheen overlay (subtle)
    const grd = ctx.createLinearGradient(0, strap.y, 0, strap.y + strap.h);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)');
    grd.addColorStop(1, 'rgba(0,0,0,0.35)');
    roundRect(ctx, strap.x, strap.y, strap.w, strap.h, 16);
    ctx.fillStyle = grd;
    ctx.fill();

    // 5) Text
    const content = state.upper ? (state.text || '').toUpperCase() : (state.text || 'YOUR TEXT');
    const fontPx = Math.max(10, Math.min(96, state.size * (canvas.width / 800))); // scale size up for 1600px width
    ctx.font = `700 ${fontPx}px ${cssFontToCanvasFont(state.font)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.textColor;

    // Fake letter-spacing on canvas by drawing each char manually
    const spacing = state.tracking * (canvas.width / 800); // simple scale
    const xCenter = strap.x + strap.w / 2;
    const yCenter = strap.y + strap.h / 2;

    if (state.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    drawSpacedText(ctx, content, xCenter, yCenter, spacing);

    // 6) Save
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = 'snapink-strap.png';
    a.href = url;
    a.click();
  }

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
    const w = iw * scale;
    const h = ih * scale;
    const x = (cw - w) / 2;
    const y = (ch - h) / 2;
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

  // Convert a CSS font stack to a single family for canvas
  function cssFontToCanvasFont(cssStack) {
    // Take the first family name block
    const first = cssStack.split(',')[0].trim();
    return first.replace(/['"]/g, '') || 'Inter';
  }

  // Draw text with manual letter spacing centered around xCenter
  function drawSpacedText(ctx, text, xCenter, y, spacing) {
    if (!text) return;
    // Measure width by summing glyphs + spacing
    const widths = [...text].map(ch => ctx.measureText(ch).width);
    const totalSpacing = spacing * Math.max(0, text.length - 1);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + totalSpacing;

    let x = xCenter - totalWidth / 2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      ctx.fillText(ch, x + widths[i] / 2, y);
      x += widths[i] + spacing;
    }
  }

  // ---- Event wiring ----
  bgButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.bgSrc = btn.dataset.bg;
      setAriaPressed(btn);
      applyToDOM();
    });
  });

  strapText.addEventListener('input', (e) => {
    state.text = e.target.value;
    applyToDOM();
  });

  fontSelect.addEventListener('change', (e) => {
    state.font = e.target.value;
    applyToDOM();
  });

  sizeRange.addEventListener('input', (e) => {
    state.size = parseInt(e.target.value, 10) || 30;
    applyToDOM();
  });

  trackingRange.addEventListener('input', (e) => {
    state.tracking = parseInt(e.target.value, 10) || 0;
    applyToDOM();
  });

  textColor.addEventListener('input', (e) => {
    state.textColor = e.target.value || '#ffffff';
    applyToDOM();
  });

  strapColor.addEventListener('input', (e) => {
    state.strapColor = e.target.value || '#111111';
    applyToDOM();
  });

  upperCheck.addEventListener('change', (e) => {
    state.upper = !!e.target.checked;
    applyToDOM();
  });

  shadowCheck.addEventListener('change', (e) => {
    state.shadow = !!e.target.checked;
    applyToDOM();
  });

  downloadBtn.addEventListener('click', exportPNG);

  // Initial paint
  applyToDOM();
})();

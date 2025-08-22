// /js/strap-customizer.js
// === SnapInk Strap Customizer (defensive, DOM-ready) ===

(function () {
  window.addEventListener('DOMContentLoaded', () => {
    // ---- Grab DOM nodes ----
    const bgImageEl   = document.getElementById('bgImage');
    const strapRectEl = document.getElementById('strapRect');
    const textLayerEl = document.getElementById('strapTextLayer');
    const overlayEl   = document.getElementById('strap-overlay'); // optional visual

    // If any of the critical preview nodes are missing, bail quietly
    if (!bgImageEl || !strapRectEl || !textLayerEl) {
      console.warn('[strap-customizer] Preview elements not found on this page. Skipping init.');
      return;
    }

    // Controls (fall back to safe stubs if missing so we never throw)
    const strapText     = document.getElementById('strapText')     || { value: '', addEventListener: () => {} };
    const fontSelect    = document.getElementById('font')          || { value: "Inter, system-ui, sans-serif", addEventListener: () => {} };
    const sizeRange     = document.getElementById('size')          || { value: '30', addEventListener: () => {} };
    const trackingRange = document.getElementById('tracking')      || { value: '1', addEventListener: () => {} };
    const textColor     = document.getElementById('textColor')     || { value: '#ffffff', addEventListener: () => {} };
    const strapColor    = document.getElementById('strapColor')    || { value: '#111111', addEventListener: () => {} };
    const upperCheck    = document.getElementById('upper')         || { checked: false, addEventListener: () => {} };
    const shadowCheck   = document.getElementById('shadow')        || { checked: true, addEventListener: () => {} };
    const downloadBtn   = document.getElementById('download')      || null;

    // Background selector buttons (future-friendly)
    const bgButtons = Array.from(document.querySelectorAll('[data-bg]'));

    // Export canvas
    const canvas = document.getElementById('exportCanvas') || null;
    const ctx    = canvas ? canvas.getContext('2d') : null;

    const CF_BG = "https://imagedelivery.net/fYqzQPf1CS3qAF1vZpfSLw/e0459dcc-97bf-444c-6f05-330f77204f00/public";

    const state = {
      bgSrc: CF_BG,
      strapColor: strapColor.value || '#111111',
      text: 'YOUR TEXT',
      font: fontSelect.value || "Inter, system-ui, sans-serif",
      size: parseInt(sizeRange.value, 10) || 30,
      tracking: parseInt(trackingRange.value, 10) || 1,
      textColor: textColor.value || '#ffffff',
      upper: !!upperCheck.checked,
      shadow: !!shadowCheck.checked,
    };

    // ---- Helpers ----
    function setAriaPressed(targetBtn) {
      bgButtons.forEach(btn => btn.setAttribute('aria-pressed', btn === targetBtn ? 'true' : 'false'));
    }

    function applyPreview() {
      // Background
      if (bgImageEl.getAttribute('src') !== state.bgSrc) {
        bgImageEl.setAttribute('src', state.bgSrc);
      }

      // Strap color block
      strapRectEl.style.background = state.strapColor;

      // Text content & style
      const content = state.upper ? (state.text || '').toUpperCase() : (state.text || '');
      textLayerEl.textContent = content || 'YOUR TEXT';

      textLayerEl.style.fontFamily   = state.font;
      textLayerEl.style.fontWeight   = '700';
      textLayerEl.style.fontSize     = `${state.size}px`;
      textLayerEl.style.letterSpacing= `${state.tracking}px`;
      textLayerEl.style.color        = state.textColor;
      textLayerEl.style.textShadow   = state.shadow ? '0 1px 2px rgba(0,0,0,.55)' : 'none';

      // Optional overlay exists? keep its position matching CSS
      if (overlayEl) {
        overlayEl.style.display = 'block';
      }
    }

    // Image loader for export
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

    function cssFontToCanvasFont(cssStack) {
      const first = (cssStack || '').split(',')[0].trim();
      return first.replace(/['"]/g, '') || 'Inter';
    }

    function drawSpacedText(ctx, text, xCenter, y, spacing) {
      if (!text) return;
      const widths = [...text].map(ch => ctx.measureText(ch).width);
      const totalSpacing = spacing * Math.max(0, text.length - 1);
      const totalWidth = widths.reduce((a,b)=>a+b,0) + totalSpacing;

      let x = xCenter - totalWidth / 2;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        ctx.fillText(ch, x + widths[i] / 2, y);
        x += widths[i] + spacing;
      }
    }

    async function exportPNG() {
      if (!canvas || !ctx) return;

      // 1) Background
      const bg = await loadImage(state.bgSrc);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawObjectCover(ctx, bg, canvas.width, canvas.height);

      // 2) Strap rect (mirror CSS %)
      const strap = {
        x: 0.15 * canvas.width,
        y: 0.72 * canvas.height,
        w: 0.70 * canvas.width,
        h: 0.115 * canvas.height,
      };

      roundRect(ctx, strap.x, strap.y, strap.w, strap.h, 16);
      ctx.fillStyle = state.strapColor;
      ctx.fill();

      // 3) Sheen
      const grd = ctx.createLinearGradient(0, strap.y, 0, strap.y + strap.h);
      grd.addColorStop(0, 'rgba(255,255,255,0.10)');
      grd.addColorStop(1, 'rgba(0,0,0,0.35)');
      roundRect(ctx, strap.x, strap.y, strap.w, strap.h, 16);
      ctx.fillStyle = grd;
      ctx.fill();

      // 4) Text
      const content = state.upper ? (state.text || '').toUpperCase() : (state.text || 'YOUR TEXT');
      const fontPx = Math.max(10, Math.min(96, state.size * (canvas.width / 800)));
      ctx.font = `700 ${fontPx}px ${cssFontToCanvasFont(state.font)}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = state.textColor;

      if (state.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      }

      const spacing = state.tracking * (canvas.width / 800);
      drawSpacedText(ctx, content, strap.x + strap.w / 2, strap.y + strap.h / 2, spacing);

      // 5) Save
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = 'snapink-strap.png';
      a.href = url;
      a.click();
    }

    // ---- Listeners ----
    bgButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        state.bgSrc = btn.dataset.bg;
        setAriaPressed(btn);
        applyPreview();
      });
    });

    strapText.addEventListener('input', (e) => {
      state.text = e.target.value;
      applyPreview();
    });

    fontSelect.addEventListener('change', (e) => {
      state.font = e.target.value;
      applyPreview();
    });

    sizeRange.addEventListener('input', (e) => {
      state.size = parseInt(e.target.value, 10) || 30;
      applyPreview();
    });

    trackingRange.addEventListener('input', (e) => {
      state.tracking = parseInt(e.target.value, 10) || 0;
      applyPreview();
    });

    textColor.addEventListener('input', (e) => {
      state.textColor = e.target.value || '#ffffff';
      applyPreview();
    });

    strapColor.addEventListener('input', (e) => {
      state.strapColor = e.target.value || '#111111';
      applyPreview();
    });

    upperCheck.addEventListener('change', (e) => {
      state.upper = !!e.target.checked;
      applyPreview();
    });

    shadowCheck.addEventListener('change', (e) => {
      state.shadow = !!e.target.checked;
      applyPreview();
    });

    if (downloadBtn) downloadBtn.addEventListener('click', exportPNG);

    // Initial paint
    applyPreview();
  });
})();

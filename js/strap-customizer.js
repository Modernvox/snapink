// Simple strap designer: live preview + PNG export

const el = (id) => document.getElementById(id);

const strapText   = el("strapText");
const font        = el("font");
const size        = el("size");
const tracking    = el("tracking");
const textColor   = el("textColor");
const strapColor  = el("strapColor");
const upper       = el("upper");
const shadow      = el("shadow");
const strap       = el("strap");
const strapLabel  = el("strapLabel");
const mock        = el("mock");
const downloadBtn = el("download");
const addToCart   = el("addToCart");
const canvas      = el("exportCanvas");
const ctx         = canvas.getContext("2d");

// Defaults
strapText.value = "YOUR TEXT";

// Live apply styles to the DOM preview
function applyPreview() {
  const raw = strapText.value || "";
  const text = upper.checked ? raw.toUpperCase() : raw;

  strap.style.background = strapColor.value;
  strapLabel.textContent = text;
  strapLabel.style.color = textColor.value;
  strapLabel.style.fontFamily = font.value;
  strapLabel.style.fontSize = `${size.value}px`;
  strapLabel.style.letterSpacing = `${tracking.value * 0.5}px`;
  strapLabel.style.textShadow = shadow.checked ? "0 1px 2px rgba(0,0,0,.6)" : "none";
}

["input", "change"].forEach(evt => {
  [strapText, font, size, tracking, textColor, strapColor, upper, shadow].forEach(c =>
    c.addEventListener(evt, applyPreview)
  );
});

// Initial render
applyPreview();

// Export a clean PNG from a canvas render
function exportPNG() {
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background gradient “nightclub vibe”
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, "#0b0b0c");
  g.addColorStop(1, "#111114");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // “Hat” silhouette hint
  ctx.fillStyle = "#0e0e10";
  ctx.beginPath();
  ctx.arc(canvas.width * 0.5, canvas.height * 0.48, canvas.width * 0.38, Math.PI, 0);
  ctx.fill();

  // Strap bar
  const strapW = canvas.width * 0.7;
  const strapH = 100;
  const strapX = (canvas.width - strapW) / 2;
  const strapY = canvas.height * 0.68 - strapH / 2;

  // Strap base with subtle gloss
  ctx.fillStyle = strapColor.value;
  roundRect(ctx, strapX, strapY, strapW, strapH, 12);
  ctx.fill();

  // Top gloss
  const gloss = ctx.createLinearGradient(0, strapY, 0, strapY + strapH);
  gloss.addColorStop(0, "rgba(255,255,255,0.08)");
  gloss.addColorStop(0.4, "rgba(255,255,255,0.02)");
  gloss.addColorStop(1, "rgba(255,255,255,0.00)");
  ctx.fillStyle = gloss;
  roundRect(ctx, strapX, strapY, strapW, strapH, 12);
  ctx.fill();

  // Text
  const raw = strapText.value || "";
  const text = upper.checked ? raw.toUpperCase() : raw;

  ctx.fillStyle = textColor.value;
  ctx.font = `${parseInt(size.value, 10) * 2}px ${font.value}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const letterSpacing = parseFloat(tracking.value) * 1.0; // px at 2x scale
  drawSpacedText(ctx, text, canvas.width / 2, strapY + strapH / 2, letterSpacing, shadow.checked);

  // Export
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `snapink-strap-${Date.now()}.png`;
  a.click();
}

downloadBtn.addEventListener("click", exportPNG);

// Demo “add to cart” to localStorage (matches your index.html demo cart)
addToCart.addEventListener("click", () => {
  const item = {
    id: "strap_custom_" + Date.now(),
    title: `Custom Strap: "${(strapText.value || "YOUR TEXT").slice(0, 24)}"`,
    price: 39.99,
    qty: 1,
    image: null
  };
  try {
    const cart = JSON.parse(localStorage.getItem("snapink_cart") || "[]");
    cart.push(item);
    localStorage.setItem("snapink_cart", JSON.stringify(cart));
    alert("Design added to cart (demo). Open the cart on the main page to see it.");
  } catch {
    alert("Could not add to cart (localStorage).");
  }
});

// Helpers
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSpacedText(ctx, text, cx, cy, spacing, withShadow) {
  const chars = [...text];
  const widths = chars.map(ch => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, -spacing);
  let x = cx - total / 2;

  chars.forEach((ch, i) => {
    if (withShadow) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.fillText(ch, x + widths[i] / 2 - spacing / 2, cy);
      ctx.restore();
    } else {
      ctx.fillText(ch, x + widths[i] / 2 - spacing / 2, cy);
    }
    x += widths[i];
  });
}

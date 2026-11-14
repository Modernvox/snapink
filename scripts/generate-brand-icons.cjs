const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "public");
const wordmarkPath = path.join(root, "public/images/logos/svg/wordmark_white.svg");
const wordmark = fs.readFileSync(wordmarkPath, "utf8");

function createIco(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = header.length;
  pngs.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...pngs.map(({ data }) => data)]);
}

async function renderIcon(size) {
  const margin = Math.round(size * 0.05);
  const logoSize = size - margin * 2;
  const logo = await sharp(Buffer.from(wordmark))
    .resize(logoSize, logoSize, { fit: "contain" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();
}

async function main() {
  const sizes = [16, 32, 48, 180, 192, 512];
  const icons = new Map();
  for (const size of sizes) icons.set(size, await renderIcon(size));

  for (const size of [16, 32, 48]) {
    fs.writeFileSync(path.join(outputDir, `favicon-${size}x${size}.png`), icons.get(size));
  }
  fs.writeFileSync(
    path.join(outputDir, "favicon.ico"),
    createIco([16, 32, 48].map((size) => ({ size, data: icons.get(size) }))),
  );
  fs.writeFileSync(path.join(outputDir, "apple-touch-icon.png"), icons.get(180));
  fs.writeFileSync(path.join(outputDir, "android-chrome-192x192.png"), icons.get(192));
  fs.writeFileSync(path.join(outputDir, "android-chrome-512x512.png"), icons.get(512));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

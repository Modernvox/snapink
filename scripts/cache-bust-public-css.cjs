const { createHash } = require("node:crypto");
const { readFile, writeFile } = require("node:fs/promises");

async function main() {
  const cssPath = "dist/style.css";
  const htmlPath = "dist/customize.html";
  const css = await readFile(cssPath);
  const hash = createHash("sha256").update(css).digest("hex").slice(0, 12);
  const html = await readFile(htmlPath, "utf8");
  const placeholder = "/style.css?v=__CSS_HASH__";

  if (!html.includes(placeholder)) {
    throw new Error(`Expected CSS cache-busting placeholder in ${htmlPath}`);
  }

  await writeFile(htmlPath, html.replace(placeholder, `/style.css?v=${hash}`));
  process.stdout.write(`Versioned Studio stylesheet with ${hash}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

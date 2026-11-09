import type { Snapback360Point, Snapback360Quad } from "../config/snapback360MasterRegistry";

export interface Snapback360ArtworkSelection {
  src: string;
  label: string;
}

export interface Snapback360ArtworkPlacement {
  offsetXRatio: number;
  offsetYRatio: number;
  scale: number;
  rotationDeg: number;
  perspectivePercent: number;
}

export const SNAPBACK360_REAR_BASELINE_SCALE = 1.45;

export function snapback360RearAdjustmentPercent(effectiveScale: number) {
  return (effectiveScale / SNAPBACK360_REAR_BASELINE_SCALE - 1) * 100;
}

export function snapback360EffectiveRearScale(adjustmentPercent: number) {
  return SNAPBACK360_REAR_BASELINE_SCALE * (1 + adjustmentPercent / 100);
}

export function snapback360MaterialIllumination(red: number, green: number, blue: number, baseLuminance: number) {
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  const normalizedLight = luminance / baseLuminance;
  return Math.max(0.74, Math.min(1.15, 0.72 + 0.28 * normalizedLight));
}

export function recolorSnapback360Pixels(
  pixels: Uint8ClampedArray,
  maskPixels: Uint8ClampedArray,
  targetColor: string,
  baseLuminance: number,
) {
  if (pixels.length !== maskPixels.length || pixels.length % 4 || !/^#[\da-f]{6}$/i.test(targetColor) || !(baseLuminance > 0)) {
    throw new Error("Snapback 360 pixel mask or color is invalid.");
  }
  const target = [1, 3, 5].map((offset) => Number.parseInt(targetColor.slice(offset, offset + 2), 16));
  for (let index = 0; index < pixels.length; index += 4) {
    const coverage = maskPixels[index + 3] / 255;
    if (!coverage) continue;
    const illumination = snapback360MaterialIllumination(pixels[index], pixels[index + 1], pixels[index + 2], baseLuminance);
    for (let channel = 0; channel < 3; channel++) {
      const recolored = Math.max(0, Math.min(255, target[channel] * illumination));
      pixels[index + channel] = Math.round(pixels[index + channel] * (1 - coverage) + recolored * coverage);
    }
  }
  return pixels;
}

export function recolorSnapback360Sleeve(
  master: HTMLImageElement,
  targetColor: string,
  sleeveMask: readonly Snapback360Point[],
  baseLuminance: number,
) {
  if (!/^#[\da-f]{6}$/i.test(targetColor) || sleeveMask.length < 3 || !(baseLuminance > 0)) {
    throw new Error("Snapback 360 sleeve color or mask configuration is invalid.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = master.naturalWidth; canvas.height = master.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Snapback 360 sleeve recolor canvas is unavailable.");
  context.drawImage(master, 0, 0);
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = canvas.width; maskCanvas.height = canvas.height;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) throw new Error("Snapback 360 sleeve mask canvas is unavailable.");
  maskContext.fillStyle = "#fff";
  maskContext.beginPath();
  maskContext.moveTo(sleeveMask[0][0], sleeveMask[0][1]);
  for (let index = 1; index < sleeveMask.length; index++) maskContext.lineTo(sleeveMask[index][0], sleeveMask[index][1]);
  maskContext.closePath(); maskContext.fill();
  const mask = maskContext.getImageData(0, 0, canvas.width, canvas.height).data;
  recolorSnapback360Pixels(source.data, mask, targetColor, baseLuminance);
  context.putImageData(source, 0, 0);
  return canvas;
}

export function resolveSnapback360ArtworkSelections(
  front: Snapback360ArtworkSelection | null,
  rear: Snapback360ArtworkSelection | null,
  useDifferentRearArtwork: boolean,
) {
  return { front, rear: useDifferentRearArtwork ? rear : front };
}

const pointInPolygon = (x: number, y: number, polygon: Snapback360Quad) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

function inverseHomography(target: Snapback360Quad, sourceWidth: number, sourceHeight: number) {
  const correspondences = [
    [target[0][0], target[0][1], 0, 0],
    [target[1][0], target[1][1], sourceWidth, 0],
    [target[2][0], target[2][1], sourceWidth, sourceHeight],
    [target[3][0], target[3][1], 0, sourceHeight],
  ];
  const equations: number[][] = [];
  const values: number[] = [];
  for (const [x, y, u, v] of correspondences) {
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(equations[row][column]) > Math.abs(equations[pivot][column])) pivot = row;
    }
    [equations[column], equations[pivot]] = [equations[pivot], equations[column]];
    [values[column], values[pivot]] = [values[pivot], values[column]];
    const divisor = equations[column][column];
    if (Math.abs(divisor) < 1e-12) throw new Error("Snapback 360 calibration perspective is singular.");
    for (let j = column; j < 8; j++) equations[column][j] /= divisor;
    values[column] /= divisor;
    for (let row = 0; row < 8; row++) if (row !== column) {
      const factor = equations[row][column];
      for (let j = column; j < 8; j++) equations[row][j] -= factor * equations[column][j];
      values[row] -= factor * values[column];
    }
  }
  return values;
}

function alphaBounds(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Snapback 360 artwork could not be inspected.");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (pixels[(y * canvas.width + x) * 4 + 3] > 2) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Selected Snapback 360 artwork is empty.");
  return { canvas, left, top, width: right - left + 1, height: bottom - top + 1 };
}

function scaledQuad(quad: Snapback360Quad, scaleX: number, scaleY: number): Snapback360Quad {
  const centerX = quad.reduce((sum, point) => sum + point[0], 0) / 4;
  const centerY = quad.reduce((sum, point) => sum + point[1], 0) / 4;
  const horizontal = [
    ((quad[1][0] - quad[0][0]) + (quad[2][0] - quad[3][0])) / 2,
    ((quad[1][1] - quad[0][1]) + (quad[2][1] - quad[3][1])) / 2,
  ] as const;
  const vertical = [
    ((quad[3][0] - quad[0][0]) + (quad[2][0] - quad[1][0])) / 2,
    ((quad[3][1] - quad[0][1]) + (quad[2][1] - quad[1][1])) / 2,
  ] as const;
  const determinant = horizontal[0] * vertical[1] - horizontal[1] * vertical[0];
  if (Math.abs(determinant) < 1e-9) throw new Error("Snapback 360 artwork region is degenerate.");
  return quad.map(([x, y]) => {
    const dx = x - centerX, dy = y - centerY;
    const u = (dx * vertical[1] - dy * vertical[0]) / determinant;
    const v = (horizontal[0] * dy - horizontal[1] * dx) / determinant;
    return [centerX + horizontal[0] * u * scaleX + vertical[0] * v * scaleY,
      centerY + horizontal[1] * u * scaleX + vertical[1] * v * scaleY] as const;
  }) as unknown as Snapback360Quad;
}

export function extendSnapback360QuadForArtwork(
  quad: Snapback360Quad,
  topExtensionRatio: number,
  bottomExtensionRatio: number,
): Snapback360Quad {
  const top = Math.max(0, topExtensionRatio), bottom = Math.max(0, bottomExtensionRatio);
  const leftSide = [quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]] as const;
  const rightSide = [quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]] as const;
  return [
    [quad[0][0] - leftSide[0] * top, quad[0][1] - leftSide[1] * top],
    [quad[1][0] - rightSide[0] * top, quad[1][1] - rightSide[1] * top],
    [quad[2][0] + rightSide[0] * bottom, quad[2][1] + rightSide[1] * bottom],
    [quad[3][0] + leftSide[0] * bottom, quad[3][1] + leftSide[1] * bottom],
  ];
}

export function snapback360StudioArtworkExtensionRatios(
  sleeveBoundsHeightMm: number,
  topExtensionMm: number,
  bottomExtensionMm: number,
) {
  if (!Number.isFinite(sleeveBoundsHeightMm) || sleeveBoundsHeightMm <= 0) {
    throw new Error("Studio sleeve bounds are invalid for Snapback 360 artwork mapping.");
  }
  return {
    topExtensionRatio: Math.max(0, topExtensionMm) / sleeveBoundsHeightMm,
    bottomExtensionRatio: Math.max(0, bottomExtensionMm) / sleeveBoundsHeightMm,
  };
}

export function placeSnapback360ArtworkQuad(
  baseQuad: Snapback360Quad,
  anchorQuad: Snapback360Quad,
  placement: Snapback360ArtworkPlacement,
): Snapback360Quad {
  const anchor = quadMetrics(anchorQuad);
  const base = quadMetrics(baseQuad);
  const scale = Number.isFinite(placement.scale) ? Math.max(0.05, Math.min(5, placement.scale)) : 1;
  const angle = (Number(placement.rotationDeg) || 0) * Math.PI / 180;
  const offsetX = (Number(placement.offsetXRatio) || 0) * anchor.width;
  const offsetY = (Number(placement.offsetYRatio) || 0) * anchor.height;
  const positioned = baseQuad.map(([x, y]) => {
    const dx = (x - anchor.centerX) * scale;
    const dy = (y - anchor.centerY) * scale;
    return [
      anchor.centerX + offsetX + dx * Math.cos(angle) - dy * Math.sin(angle),
      anchor.centerY + offsetY + dx * Math.sin(angle) + dy * Math.cos(angle),
    ] as const;
  }) as unknown as Snapback360Quad;
  const perspective = Number(placement.perspectivePercent) || 0;
  if (Math.abs(perspective) < 0.001 || base.width < 0.001) return positioned;
  const metrics = quadMetrics(positioned);
  const axis = metrics.rotationDeg * Math.PI / 180;
  const ux = Math.cos(axis), uy = Math.sin(axis);
  const halfDelta = metrics.width * Math.max(-150, Math.min(150, perspective)) / 400;
  const move = (point: Snapback360Point, distance: number): Snapback360Point => [point[0] + ux * distance, point[1] + uy * distance];
  return [move(positioned[0], -halfDelta), move(positioned[1], halfDelta), move(positioned[2], halfDelta), move(positioned[3], -halfDelta)];
}

export function snapback360ArtworkTargetQuad(
  artwork: HTMLImageElement,
  region: Snapback360Quad,
  placement: Snapback360ArtworkPlacement,
  options: { studioArtboard?: { topExtensionRatio: number; bottomExtensionRatio: number } } = {},
): Snapback360Quad {
  if (options.studioArtboard) {
    return placeSnapback360ArtworkQuad(
      extendSnapback360QuadForArtwork(region, options.studioArtboard.topExtensionRatio, options.studioArtboard.bottomExtensionRatio),
      region,
      placement,
    );
  }
  const { width: sourceWidth, height: sourceHeight } = alphaBounds(artwork);
  const averageWidth = (Math.hypot(region[1][0] - region[0][0], region[1][1] - region[0][1]) +
    Math.hypot(region[2][0] - region[3][0], region[2][1] - region[3][1])) / 2;
  const averageHeight = (Math.hypot(region[3][0] - region[0][0], region[3][1] - region[0][1]) +
    Math.hypot(region[2][0] - region[1][0], region[2][1] - region[1][1])) / 2;
  const fit = Math.min(averageWidth / sourceWidth, averageHeight / sourceHeight);
  const base = scaledQuad(region, sourceWidth * fit / averageWidth, sourceHeight * fit / averageHeight);
  return placeSnapback360ArtworkQuad(base, region, placement);
}

function warpArtworkPixels(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetQuad: Snapback360Quad,
  width: number,
  height: number,
) {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = inverseHomography(targetQuad, sourceWidth, sourceHeight);
  const layer = document.createElement("canvas");
  layer.width = width; layer.height = height;
  const context = layer.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Snapback 360 artwork layer is unavailable.");
  const output = context.createImageData(width, height);
  const minX = Math.max(0, Math.floor(Math.min(...targetQuad.map(([x]) => x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...targetQuad.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...targetQuad.map(([, y]) => y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...targetQuad.map(([, y]) => y))));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    if (!pointInPolygon(px, py, targetQuad)) continue;
    const denominator = h6 * px + h7 * py + 1;
    if (Math.abs(denominator) < 1e-9) continue;
    const sx = (h0 * px + h1 * py + h2) / denominator;
    const sy = (h3 * px + h4 * py + h5) / denominator;
    if (sx < 0 || sy < 0 || sx >= sourceWidth || sy >= sourceHeight) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(sourceWidth - 1, x0 + 1), y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0;
    const samples = [
      [x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)],
      [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy],
    ];
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (const [sampleX, sampleY, weight] of samples) {
      const at = (sampleY * sourceWidth + sampleX) * 4;
      const sampleAlpha = source[at + 3] / 255 * weight;
      alpha += sampleAlpha; red += source[at] * sampleAlpha; green += source[at + 1] * sampleAlpha; blue += source[at + 2] * sampleAlpha;
    }
    if (alpha <= 0) continue;
    const at = (y * width + x) * 4;
    output.data[at] = Math.round(red / alpha); output.data[at + 1] = Math.round(green / alpha);
    output.data[at + 2] = Math.round(blue / alpha); output.data[at + 3] = Math.round(alpha * 255);
  }
  context.putImageData(output, 0, 0);
  return layer;
}

function createArtworkLayer(
  artwork: HTMLImageElement,
  region: Snapback360Quad,
  width: number,
  height: number,
  placement: Snapback360ArtworkPlacement = { offsetXRatio: 0, offsetYRatio: 0, scale: 1, rotationDeg: 0, perspectivePercent: 0 },
) {
  const { canvas: sourceCanvas, left, top, width: sourceWidth, height: sourceHeight } = alphaBounds(artwork);
  const averageWidth = (Math.hypot(region[1][0] - region[0][0], region[1][1] - region[0][1]) +
    Math.hypot(region[2][0] - region[3][0], region[2][1] - region[3][1])) / 2;
  const averageHeight = (Math.hypot(region[3][0] - region[0][0], region[3][1] - region[0][1]) +
    Math.hypot(region[2][0] - region[1][0], region[2][1] - region[1][1])) / 2;
  const fit = Math.min(averageWidth / sourceWidth, averageHeight / sourceHeight);
  const fitWidth = sourceWidth * fit;
  const fitHeight = sourceHeight * fit;
  const fittedRegion = placeSnapback360ArtworkQuad(
    scaledQuad(region, fitWidth / averageWidth, fitHeight / averageHeight), region, placement,
  );
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Snapback 360 artwork sampling is unavailable.");
  const source = sourceContext.getImageData(left, top, sourceWidth, sourceHeight).data;
  return warpArtworkPixels(source, sourceWidth, sourceHeight, fittedRegion, width, height);
}

function createStudioArtworkLayer(
  artworkArtboard: HTMLImageElement,
  sleeveRegion: Snapback360Quad,
  topExtensionRatio: number,
  bottomExtensionRatio: number,
  width: number,
  height: number,
  placement: Snapback360ArtworkPlacement = { offsetXRatio: 0, offsetYRatio: 0, scale: 1, rotationDeg: 0, perspectivePercent: 0 },
) {
  const source = document.createElement("canvas");
  source.width = artworkArtboard.naturalWidth; source.height = artworkArtboard.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Studio rear artwork could not be sampled.");
  sourceContext.drawImage(artworkArtboard, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const extendedRegion = extendSnapback360QuadForArtwork(sleeveRegion, topExtensionRatio, bottomExtensionRatio);
  return warpArtworkPixels(pixels, source.width, source.height, placeSnapback360ArtworkQuad(extendedRegion, sleeveRegion, placement), width, height);
}

export async function compositeSnapback360ProductImage(
  master: HTMLImageElement,
  frontArtwork: HTMLImageElement,
  rearArtwork: HTMLImageElement,
  frontRegion: Snapback360Quad,
  rearRegion: Snapback360Quad,
  rearStudioArtboard?: { topExtensionRatio: number; bottomExtensionRatio: number },
  placements: { front?: Snapback360ArtworkPlacement; rear?: Snapback360ArtworkPlacement } = {},
  sleeveColor?: { hex: string; mask: readonly Snapback360Point[]; baseLuminance: number },
) {
  if (!master.naturalWidth || !master.naturalHeight) throw new Error("Snapback 360 master image could not be loaded.");
  const canvas = document.createElement("canvas");
  canvas.width = master.naturalWidth; canvas.height = master.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Snapback 360 product-image canvas is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const recoloredMaster = sleeveColor ? recolorSnapback360Sleeve(master, sleeveColor.hex, sleeveColor.mask, sleeveColor.baseLuminance) : null;
  context.drawImage(recoloredMaster || master, 0, 0);
  context.drawImage(createArtworkLayer(frontArtwork, frontRegion, canvas.width, canvas.height, placements.front), 0, 0);
  const rearLayer = rearStudioArtboard
    ? createStudioArtworkLayer(rearArtwork, rearRegion, rearStudioArtboard.topExtensionRatio, rearStudioArtboard.bottomExtensionRatio, canvas.width, canvas.height, placements.rear)
    : createArtworkLayer(rearArtwork, rearRegion, canvas.width, canvas.height, placements.rear);
  context.drawImage(rearLayer, 0, 0);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Snapback 360 PNG encoding failed.")), "image/png",
  ));
}

export async function compositeSnapback360RegionPreview(
  master: HTMLImageElement,
  artwork: HTMLImageElement,
  region: Snapback360Quad,
) {
  const empty = document.createElement("canvas");
  empty.width = master.naturalWidth; empty.height = master.naturalHeight;
  const context = empty.getContext("2d");
  if (!context) throw new Error("Snapback 360 calibration preview is unavailable.");
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(master, 0, 0);
  context.drawImage(createArtworkLayer(artwork, region, empty.width, empty.height), 0, 0);
  return await new Promise<Blob>((resolve, reject) => empty.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Snapback 360 calibration preview could not be saved.")), "image/png",
  ));
}

export function quadMetrics(quad: Snapback360Quad) {
  const average = (a: Snapback360Point, b: Snapback360Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const width = (average(quad[0], quad[1]) + average(quad[3], quad[2])) / 2;
  const height = (average(quad[0], quad[3]) + average(quad[1], quad[2])) / 2;
  return {
    centerX: quad.reduce((sum, [x]) => sum + x, 0) / 4,
    centerY: quad.reduce((sum, [, y]) => sum + y, 0) / 4,
    width,
    height,
    rotationDeg: Math.atan2(quad[1][1] - quad[0][1], quad[1][0] - quad[0][0]) * 180 / Math.PI,
    perspectivePercent: width ? (average(quad[3], quad[2]) - average(quad[0], quad[1])) / width * 100 : 0,
  };
}

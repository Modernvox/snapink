import type { Snapback360Point, Snapback360Quad } from "../config/snapback360MasterRegistry";

export interface Snapback360ArtworkSelection {
  src: string;
  label: string;
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
) {
  const { canvas: sourceCanvas, left, top, width: sourceWidth, height: sourceHeight } = alphaBounds(artwork);
  const averageWidth = (Math.hypot(region[1][0] - region[0][0], region[1][1] - region[0][1]) +
    Math.hypot(region[2][0] - region[3][0], region[2][1] - region[3][1])) / 2;
  const averageHeight = (Math.hypot(region[3][0] - region[0][0], region[3][1] - region[0][1]) +
    Math.hypot(region[2][0] - region[1][0], region[2][1] - region[1][1])) / 2;
  const fit = Math.min(averageWidth / sourceWidth, averageHeight / sourceHeight);
  const fitWidth = sourceWidth * fit;
  const fitHeight = sourceHeight * fit;
  const fittedRegion = scaledQuad(region, fitWidth / averageWidth, fitHeight / averageHeight);
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
) {
  const source = document.createElement("canvas");
  source.width = artworkArtboard.naturalWidth; source.height = artworkArtboard.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Studio rear artwork could not be sampled.");
  sourceContext.drawImage(artworkArtboard, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const extendedRegion = extendSnapback360QuadForArtwork(sleeveRegion, topExtensionRatio, bottomExtensionRatio);
  return warpArtworkPixels(pixels, source.width, source.height, extendedRegion, width, height);
}

export async function compositeSnapback360ProductImage(
  master: HTMLImageElement,
  frontArtwork: HTMLImageElement,
  rearArtwork: HTMLImageElement,
  frontRegion: Snapback360Quad,
  rearRegion: Snapback360Quad,
  rearStudioArtboard?: { topExtensionRatio: number; bottomExtensionRatio: number },
) {
  if (!master.naturalWidth || !master.naturalHeight) throw new Error("Snapback 360 master image could not be loaded.");
  const canvas = document.createElement("canvas");
  canvas.width = master.naturalWidth; canvas.height = master.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Snapback 360 product-image canvas is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(master, 0, 0);
  context.drawImage(createArtworkLayer(frontArtwork, frontRegion, canvas.width, canvas.height), 0, 0);
  const rearLayer = rearStudioArtboard
    ? createStudioArtworkLayer(rearArtwork, rearRegion, rearStudioArtboard.topExtensionRatio, rearStudioArtboard.bottomExtensionRatio, canvas.width, canvas.height)
    : createArtworkLayer(rearArtwork, rearRegion, canvas.width, canvas.height);
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

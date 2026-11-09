import logoFiles from "./snapback360LogoLibrary.json";

export type Snapback360RegionId = "front" | "rear";
export type Snapback360Point = readonly [x: number, y: number];
export type Snapback360Quad = readonly [
  topLeft: Snapback360Point,
  topRight: Snapback360Point,
  bottomRight: Snapback360Point,
  bottomLeft: Snapback360Point,
];

export interface Snapback360RegionCalibration {
  quadPx: Snapback360Quad;
  locked: boolean;
  version: string;
}

export interface ProductImageMaster {
  id: string;
  name: string;
  hatColor: "black" | "white" | "red" | "yellow";
  type: "combined-front-rear-product-image";
  image: string;
  imageDimensions: { width: number; height: number };
  imageSha256: string;
  sleeveBaseLuminance: number;
  sleeveMask: readonly Snapback360Point[];
  calibrationGeometryVersion: string;
  regions: Record<Snapback360RegionId, {
    name: string;
    calibration?: Snapback360RegionCalibration;
  }>;
}

const SNAPBACK360_SHARED_SLEEVE_MASK: readonly Snapback360Point[] =
  [[722, 552], [729, 549], [1063, 549], [1072, 554], [1073, 635], [1065, 642], [730, 642], [721, 635]];

function createMaster(
  id: string,
  name: string,
  hatColor: ProductImageMaster["hatColor"],
  image: string,
  imageSha256: string,
  sleeveBaseLuminance: number,
  calibrationGeometryVersion: string,
  calibration?: { version: string; frontQuad: Snapback360Quad; rearQuad: Snapback360Quad },
): ProductImageMaster {
  return {
    id, name, hatColor, type: "combined-front-rear-product-image", image,
    imageDimensions: { width: 1254, height: 1254 }, imageSha256, sleeveBaseLuminance,
    calibrationGeometryVersion,
    sleeveMask: SNAPBACK360_SHARED_SLEEVE_MASK,
    regions: {
      front: { name: "Front Hat Artwork", ...(calibration ? { calibration: { quadPx: calibration.frontQuad, locked: false, version: `${calibration.version}-front-v1` } } : {}) },
      rear: { name: "Rear SnapInk Sleeve Artwork", ...(calibration ? { calibration: { quadPx: calibration.rearQuad, locked: false, version: `${calibration.version}-rear-v1` } } : {}) },
    },
  };
}

export const SNAPBACK360_MASTERS: readonly ProductImageMaster[] = [
  createMaster("snapback360-black-trucker", "Snapback 360 — Black Trucker", "black", "/images/product_images/master.png", "8c82cbeda36726613f46b46964b4a0118f73b5a5d3807eed8cb9d8596749e973", 0.105,
    "snapback360-shared-v1", { version: "snapback360-black-trucker", frontQuad: [[164, 425], [584, 425], [602, 738], [153, 738]], rearQuad: [[737, 562], [1056, 562], [1058, 638], [736, 638]] }),
  createMaster("snapback360-white-trucker", "Snapback 360 — White Trucker", "white", "/images/product_images/master_white.png", "927d5be37ca086db074428441740363899bef89b05e94aee7cc374df4e4297a6", 0.855,
    "snapback360-shared-v1"),
  createMaster("snapback360-crimson-trucker", "Snapback 360 — Crimson Red Trucker", "red", "/images/product_images/red_master.png", "e6530c49877eb10a154007acc9f2cf0dc1b5327af78c47ec84dd673ab0e81697", 0.155,
    "snapback360-shared-v1"),
  createMaster("snapback360-yellow-trucker", "Snapback 360 — Yellow Trucker", "yellow", "/images/product_images/yellow_master.png", "6247a0bc3445f61bea38e170506ea3fb9ad6659be1ebd5be925c3c9f4a6305ff", 0.635,
    "snapback360-shared-v1"),
];

export const SNAPBACK360_MASTER = SNAPBACK360_MASTERS[0];
export const SNAPBACK360_CALIBRATION_MASTER_ID = SNAPBACK360_MASTER.id;
export const SNAPBACK360_CALIBRATION_STORAGE_KEY = "snapink.productPhotoMasterCalibrations.v1";
export const SNAPBACK360_LOGO_LIBRARY = (logoFiles as string[]).map((file) => ({
  file,
  name: file.replace(/^svg\//, "").replace(/\.(?:svg|png)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
  src: `/images/logos/${file.split("/").map(encodeURIComponent).join("/")}`,
}));

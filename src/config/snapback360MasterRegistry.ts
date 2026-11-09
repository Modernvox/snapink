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
  type: "combined-front-rear-product-image";
  image: string;
  imageDimensions: { width: number; height: number };
  imageSha256: string;
  regions: Record<Snapback360RegionId, {
    name: string;
    calibration: Snapback360RegionCalibration;
  }>;
}

export const SNAPBACK360_MASTER: ProductImageMaster = {
  id: "snapback360-black-trucker",
  name: "Snapback 360 — Black Trucker",
  type: "combined-front-rear-product-image",
  image: "/images/product_images/snapback360-black-trucker-master.png",
  imageDimensions: { width: 1254, height: 1254 },
  imageSha256: "8c82cbeda36726613f46b46964b4a0118f73b5a5d3807eed8cb9d8596749e973",
  regions: {
    front: {
      name: "Front Hat Artwork",
      calibration: {
        quadPx: [[164, 425], [584, 425], [602, 738], [153, 738]],
        locked: false,
        version: "snapback360-black-trucker-front-v1",
      },
    },
    rear: {
      name: "Rear SnapInk Sleeve Artwork",
      calibration: {
        quadPx: [[737, 562], [1056, 562], [1058, 638], [736, 638]],
        locked: false,
        version: "snapback360-black-trucker-rear-v1",
      },
    },
  },
};

export const SNAPBACK360_MASTERS = [SNAPBACK360_MASTER] as const;
export const SNAPBACK360_CALIBRATION_STORAGE_KEY = "snapink.productPhotoMasterCalibrations.v1";
export const SNAPBACK360_LOGO_LIBRARY = (logoFiles as string[]).map((file) => ({
  file,
  name: file.replace(/^svg\//, "").replace(/\.(?:svg|png)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
  src: `/images/logos/${file.split("/").map(encodeURIComponent).join("/")}`,
}));

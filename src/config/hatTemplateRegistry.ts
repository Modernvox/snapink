/**
 * Approved desktop and mobile photo templates used by SnapInk Studio.
 *
 * All calibration points use each source image's natural pixel coordinates.
 * The images are front views with the hat worn backward. `femaleStrapQuadPx`
 * marks the seven-hole strap; the sleeve's groove aligns to its left boundary,
 * the small flap may extend left over the cap fabric, and the sleeve right edge
 * stops before the exposed male pegs. The registry does not alter or crop any
 * source photo. Studio uses these source-pixel measurements for preview
 * placement, camera anchoring, scale, rotation, and image layer order.
 */

export type HatTemplateId =
  | "hat-black"
  | "hat-white"
  | "hat-red"
  | "hat-blue"
  | "hat-green"
  | "hat-yellow"
  | "hat-neon-yellow"
  | "hat-orange"
  | "hat-pink"
  | "hat-purple";

export type HatTemplatePoint = readonly [x: number, y: number];

export interface HatSleevePlacement {
  coordinateSpace: "natural-image-pixels";
  /** Female strap face, measured from the source image. */
  femaleStrapQuadPx: {
    topLeft: HatTemplatePoint;
    topRight: HatTemplatePoint;
    bottomRight: HatTemplatePoint;
    bottomLeft: HatTemplatePoint;
  };
  /** Vertical sleeve groove reference; the flap extends to the left. */
  grooveLinePx: readonly [top: HatTemplatePoint, bottom: HatTemplatePoint];
  /** Female strap centerline and transverse thickness in source pixels. */
  strapCenterlinePx: readonly [top: HatTemplatePoint, bottom: HatTemplatePoint];
  strapThicknessPx: number;
  /** Overall overlay bounds include the narrow flap extension. */
  sleeveBoundsPx: { left: number; top: number; right: number; bottom: number };
  positionPx: { x: number; y: number };
  /** Uniform scale as a fraction of the source image's natural height. */
  uniformScale: number;
  rotationDeg: number;
  layerOrder: { hat: number; sleeve: number; artwork: number };
}

export interface HatTemplateImageProfile {
  imagePath: string;
  imageDimensions: { width: number; height: number };
  imageSha256: string;
  presentation: {
    aspectRatio: number;
    objectFit: "contain";
    crop: "none";
  };
  sleevePlacement: HatSleevePlacement;
}

export interface HatTemplate extends HatTemplateImageProfile {
  id: HatTemplateId;
  displayName: string;
  hatColor: string;
  /** Shared 9:16 master composition with its own mobile-only pixel calibration. */
  mobile: HatTemplateImageProfile;
}

type RawSleevePlacement = Omit<HatSleevePlacement, "positionPx" | "uniformScale" | "rotationDeg" | "strapCenterlinePx" | "strapThicknessPx">;
type RawHatTemplate = Omit<HatTemplate, "presentation" | "sleevePlacement" | "mobile"> & {
  mobile: Omit<HatTemplateImageProfile, "presentation" | "sleevePlacement">;
};

const MOBILE_REFERENCE_DIMENSIONS = { width: 1080, height: 1920 } as const;
// Shared desktop photograph geometry: right edge of the rear hat opening,
// measured on the black master and reused by its geometry-locked color variants.
export const DESKTOP_REAR_OPENING_RIGHT_EDGE_PX = 923;
const DESKTOP_HAT_SLEEVE_CALIBRATION: RawSleevePlacement = {
  coordinateSpace: "natural-image-pixels",
  femaleStrapQuadPx: {
    topLeft: [523, 394], topRight: [843, 392],
    bottomRight: [843, 473], bottomLeft: [523, 478],
  },
  grooveLinePx: [[523, 394], [523, 478]],
  sleeveBoundsPx: { left: 501, top: 392, right: 843, bottom: 478 },
  layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
};

const MOBILE_HAT_SLEEVE_CALIBRATION: RawSleevePlacement = {
  coordinateSpace: "natural-image-pixels",
  femaleStrapQuadPx: {
    topLeft: [250, 649], topRight: [694, 649],
    bottomRight: [697, 774], bottomLeft: [250, 774],
  },
  grooveLinePx: [[250, 649], [250, 774]],
  sleeveBoundsPx: { left: 218, top: 649, right: 697, bottom: 775 },
  layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
};

function calibratePlacement(raw: RawSleevePlacement, dimensions: { width: number; height: number }): HatSleevePlacement {
  const bounds = raw.sleeveBoundsPx;
  const { topLeft, topRight, bottomRight, bottomLeft } = raw.femaleStrapQuadPx;
  const strapCenterlinePx = [
    [(topLeft[0] + topRight[0]) / 2, (topLeft[1] + topRight[1]) / 2] as const,
    [(bottomLeft[0] + bottomRight[0]) / 2, (bottomLeft[1] + bottomRight[1]) / 2] as const,
  ] as const;
  const distance = (a: HatTemplatePoint, b: HatTemplatePoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    ...raw,
    strapCenterlinePx,
    strapThicknessPx: (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2,
    positionPx: {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
    },
    uniformScale: (bounds.bottom - bounds.top) / dimensions.height,
    rotationDeg: Math.atan2(
      raw.femaleStrapQuadPx.topRight[1] - raw.femaleStrapQuadPx.topLeft[1],
      raw.femaleStrapQuadPx.topRight[0] - raw.femaleStrapQuadPx.topLeft[0],
    ) * (180 / Math.PI),
  };
}

function imageProfile(
  input: { imagePath: string; imageDimensions: { width: number; height: number }; imageSha256: string },
  placement: RawSleevePlacement,
): HatTemplateImageProfile {
  const { width, height } = input.imageDimensions;
  return {
    ...input,
    presentation: {
      aspectRatio: width / height,
      objectFit: "contain",
      crop: "none",
    },
    sleevePlacement: calibratePlacement(placement, input.imageDimensions),
  };
}

function template(input: RawHatTemplate): HatTemplate {
  return {
    id: input.id,
    displayName: input.displayName,
    hatColor: input.hatColor,
    ...imageProfile(input, DESKTOP_HAT_SLEEVE_CALIBRATION),
    mobile: imageProfile(input.mobile, MOBILE_HAT_SLEEVE_CALIBRATION),
  };
}

export const HAT_TEMPLATE_REGISTRY: readonly HatTemplate[] = [
  template({
    id: "hat-black",
    displayName: "Black Trucker Hat",
    hatColor: "black",
    imagePath: "/images/hat_templates/hat-black.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "5bd59417af98a5f8a22f56728e245bcedb848ad3946b270931bee2607a2f39b7",
    mobile: {
      imagePath: "/images/hat_templates/hat-black-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "962a084512ae33be8721f6540ca8398f2263d154812a16d31679a7cd6b7e80a4",
    },
  }),
  template({
    id: "hat-white",
    displayName: "White Trucker Hat",
    hatColor: "white",
    imagePath: "/images/hat_templates/geometry-locked/hat-white.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "efde027b620510550201449ac07eae399d861c4989c3bf832e38a88ff62be007",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-white-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "488d0f472488c167d72eef5d27df7e81b7b6ab6fdaef91ed75f089a8e6c58057",
    },
  }),
  template({
    id: "hat-red",
    displayName: "Red Trucker Hat",
    hatColor: "red",
    imagePath: "/images/hat_templates/geometry-locked/hat-red.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "c3d3479a144727ee6765a4d0206bdc9e548423810fb159ea528f0e461fd9fb3d",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-red-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "b9db4e9525e88d175d0a8611279b0ed490cef2eed34fb6025d93e28a5d500770",
    },
  }),
  template({
    id: "hat-blue",
    displayName: "Royal Blue Trucker Hat",
    hatColor: "blue",
    imagePath: "/images/hat_templates/geometry-locked/hat-blue.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "883367342162e4013bcc88d2130c209ff8b1d29974c6694c7de9f3ad59d7d283",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-blue-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "401a0186b3cfecc09f915806b6e965a908b5b71e2db497c5ffc7c79a33ab9a9b",
    },
  }),
  template({
    id: "hat-green",
    displayName: "Green Trucker Hat",
    hatColor: "green",
    imagePath: "/images/hat_templates/geometry-locked/hat-green.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "af6c182705dc82c5b99c7f2d70298cd17f65d74a90c7df99f57dd949c8775d10",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-green-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "9dae23cc8e5134287baae45a9671aa59cd2c596488776f5b793a9b6b1e77ba7a",
    },
  }),
  template({
    id: "hat-yellow",
    displayName: "Golden Yellow Trucker Hat",
    hatColor: "yellow",
    imagePath: "/images/hat_templates/geometry-locked/hat-yellow.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "12b80022bc142bf2c10e9cfdf0548a8742963ad97079f2abee5721f979771a4c",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-yellow-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "ef996a686026547e32ab95f3f0ba85da3d89ffb17498586a6b5c585a1c9a9eaa",
    },
  }),
  template({
    id: "hat-neon-yellow",
    displayName: "Neon Yellow Trucker Hat",
    hatColor: "neon-yellow",
    imagePath: "/images/hat_templates/geometry-locked/hat-neon-yellow.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "8f452b929a5434176e566b0c75de8756bd3d8f648a8763f2b966cff1a754b525",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-neon-yellow-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "98ebcc97979a6a15d2ffefb0c8f73a52f8192d626e72f0b187ea131f95791d3d",
    },
  }),
  template({
    id: "hat-orange",
    displayName: "Orange Trucker Hat",
    hatColor: "orange",
    imagePath: "/images/hat_templates/geometry-locked/hat-orange.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "16899255c2d0d0b8822809a8817637ee4de2517c52ed633446ddf25105b0c7e2",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-orange-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "507706faf694ad0b55a16a003584075d792e3d31e792c95d57c2a67b91104d13",
    },
  }),
  template({
    id: "hat-pink",
    displayName: "Pink Trucker Hat",
    hatColor: "pink",
    imagePath: "/images/hat_templates/geometry-locked/hat-pink.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "6d184e1bcaf311b6d8fb45448f6e108cb5ae085d8bebd1b0f5a00f2a55492aff",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-pink-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "4a364eb15907b6a3f7a4aa4da04806bb5f9cdb6a1e8558f6b24c09ba56afe4da",
    },
  }),
  template({
    id: "hat-purple",
    displayName: "Purple Trucker Hat",
    hatColor: "purple",
    imagePath: "/images/hat_templates/geometry-locked/hat-purple.png",
    imageDimensions: { width: 1447, height: 1087 },
    imageSha256: "c06bcf6b71a6d5d0e95e05c3ead9edfb1cd07de9426c5fcdfc2455939eb8d073",
    mobile: {
      imagePath: "/images/hat_templates/geometry-locked/hat-purple-mobile.png",
      imageDimensions: MOBILE_REFERENCE_DIMENSIONS,
      imageSha256: "09628a5ddad1c15754f4cbefb1a94a65a008165fff411d7f3f2d758afb9552d7",
    },
  }),
] as const;

export const HAT_TEMPLATE_BY_ID: Readonly<Record<HatTemplateId, HatTemplate>> =
  Object.fromEntries(HAT_TEMPLATE_REGISTRY.map((item) => [item.id, item])) as Record<HatTemplateId, HatTemplate>;

export function getHatTemplate(id: HatTemplateId): HatTemplate {
  return HAT_TEMPLATE_BY_ID[id];
}

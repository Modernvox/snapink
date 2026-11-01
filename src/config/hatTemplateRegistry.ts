/**
 * Approved photo templates used by SnapInk Studio hat-color switching.
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

export interface HatTemplate {
  id: HatTemplateId;
  displayName: string;
  hatColor: string;
  imagePath: string;
  imageDimensions: { width: number; height: number };
  imageSha256: string;
  presentation: {
    aspectRatio: number;
    objectFit: "contain";
    crop: "none";
  };
  sleevePlacement: {
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
    /** Overall overlay bounds include the narrow flap extension. */
    sleeveBoundsPx: { left: number; top: number; right: number; bottom: number };
    positionPx: { x: number; y: number };
    /** Uniform scale as a fraction of the source image's natural height. */
    uniformScale: number;
    rotationDeg: number;
    layerOrder: { hat: number; sleeve: number; artwork: number };
  };
}

function template(input: Omit<HatTemplate, "presentation" | "sleevePlacement"> & {
  sleevePlacement: Omit<HatTemplate["sleevePlacement"], "positionPx" | "uniformScale" | "rotationDeg">;
}): HatTemplate {
  const bounds = input.sleevePlacement.sleeveBoundsPx;
  const { width, height } = input.imageDimensions;
  return {
    ...input,
    presentation: {
      aspectRatio: width / height,
      objectFit: "contain",
      crop: "none",
    },
    sleevePlacement: {
      ...input.sleevePlacement,
      positionPx: {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      },
      uniformScale: (bounds.bottom - bounds.top) / height,
      rotationDeg: Math.atan2(
        input.sleevePlacement.femaleStrapQuadPx.topRight[1] - input.sleevePlacement.femaleStrapQuadPx.topLeft[1],
        input.sleevePlacement.femaleStrapQuadPx.topRight[0] - input.sleevePlacement.femaleStrapQuadPx.topLeft[0],
      ) * (180 / Math.PI),
    },
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
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 394], topRight: [843, 392],
        bottomRight: [843, 473], bottomLeft: [523, 478],
      },
      grooveLinePx: [[523, 394], [523, 478]],
      sleeveBoundsPx: { left: 501, top: 392, right: 843, bottom: 478 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-white",
    displayName: "White Trucker Hat",
    hatColor: "white",
    imagePath: "/images/hat_templates/hat-white.png",
    imageDimensions: { width: 1446, height: 1087 },
    imageSha256: "90059e5abdf3e26f6b7f201b3cb958981764872a546a8e57c860e07739c9343e",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [524, 394], topRight: [844, 392],
        bottomRight: [844, 473], bottomLeft: [524, 478],
      },
      grooveLinePx: [[524, 394], [524, 478]],
      sleeveBoundsPx: { left: 502, top: 392, right: 844, bottom: 478 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-red",
    displayName: "Red Trucker Hat",
    hatColor: "red",
    imagePath: "/images/hat_templates/hat-red.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "eeefd58241b7fef77b6949fd0ce274f27262fb33210d948406e06527f6960859",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 393], topRight: [843, 391],
        bottomRight: [843, 472], bottomLeft: [523, 477],
      },
      grooveLinePx: [[523, 393], [523, 477]],
      sleeveBoundsPx: { left: 501, top: 391, right: 843, bottom: 477 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-blue",
    displayName: "Royal Blue Trucker Hat",
    hatColor: "blue",
    imagePath: "/images/hat_templates/hat-blue.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "1ba9764d486bff190b9433229d5c825505771b6bd3503f1b9afe2bd6af6f6b64",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 392], topRight: [843, 390],
        bottomRight: [843, 472], bottomLeft: [523, 477],
      },
      grooveLinePx: [[523, 392], [523, 477]],
      sleeveBoundsPx: { left: 501, top: 390, right: 843, bottom: 477 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-green",
    displayName: "Green Trucker Hat",
    hatColor: "green",
    imagePath: "/images/hat_templates/hat-green.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "26de821952b265d9ef0aedfa7bf1b51c51507b375fd21409fdf9b39148dddf10",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 392], topRight: [842, 390],
        bottomRight: [842, 471], bottomLeft: [523, 476],
      },
      grooveLinePx: [[523, 392], [523, 476]],
      sleeveBoundsPx: { left: 501, top: 390, right: 842, bottom: 476 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-yellow",
    displayName: "Golden Yellow Trucker Hat",
    hatColor: "yellow",
    imagePath: "/images/hat_templates/hat-yellow.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "e5efdc703ac9d751a16d190163bcf472d46d23c14a78885134e04f6bc5f43c2c",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 392], topRight: [842, 390],
        bottomRight: [842, 472], bottomLeft: [523, 477],
      },
      grooveLinePx: [[523, 392], [523, 477]],
      sleeveBoundsPx: { left: 501, top: 390, right: 842, bottom: 477 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-neon-yellow",
    displayName: "Neon Yellow Trucker Hat",
    hatColor: "neon-yellow",
    imagePath: "/images/hat_templates/hat-neon-yellow.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "1cae14c48e667e45730ca3a7592a7b9ad70600002a53a9adcd3f332f7c2430be",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [522, 393], topRight: [842, 391],
        bottomRight: [842, 472], bottomLeft: [522, 477],
      },
      grooveLinePx: [[522, 393], [522, 477]],
      sleeveBoundsPx: { left: 500, top: 391, right: 842, bottom: 477 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-orange",
    displayName: "Orange Trucker Hat",
    hatColor: "orange",
    imagePath: "/images/hat_templates/hat-orange.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "5b60987f814a01f50fba91f726458f434c9875f28db8113558696277a5a19aff",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 392], topRight: [843, 390],
        bottomRight: [843, 472], bottomLeft: [523, 476],
      },
      grooveLinePx: [[523, 392], [523, 476]],
      sleeveBoundsPx: { left: 501, top: 390, right: 843, bottom: 476 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-pink",
    displayName: "Pink Trucker Hat",
    hatColor: "pink",
    imagePath: "/images/hat_templates/hat-pink.png",
    imageDimensions: { width: 1446, height: 1088 },
    imageSha256: "67e60a8903a96947782ccc2c52c0578781e6abbb3541b179781d3a01a0140ac0",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [525, 394], topRight: [845, 392],
        bottomRight: [845, 473], bottomLeft: [525, 478],
      },
      grooveLinePx: [[525, 394], [525, 478]],
      sleeveBoundsPx: { left: 503, top: 392, right: 845, bottom: 478 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
  template({
    id: "hat-purple",
    displayName: "Purple Trucker Hat",
    hatColor: "purple",
    imagePath: "/images/hat_templates/hat-purple.png",
    imageDimensions: { width: 1445, height: 1088 },
    imageSha256: "d66cefab9462720182716d13f017578e96612e678031cc0eaafd58fcfadbf850",
    sleevePlacement: {
      coordinateSpace: "natural-image-pixels",
      femaleStrapQuadPx: {
        topLeft: [523, 392], topRight: [843, 390],
        bottomRight: [843, 471], bottomLeft: [523, 476],
      },
      grooveLinePx: [[523, 392], [523, 476]],
      sleeveBoundsPx: { left: 501, top: 390, right: 843, bottom: 476 },
      layerOrder: { hat: 0, sleeve: 10, artwork: 20 },
    },
  }),
] as const;

export const HAT_TEMPLATE_BY_ID: Readonly<Record<HatTemplateId, HatTemplate>> =
  Object.fromEntries(HAT_TEMPLATE_REGISTRY.map((item) => [item.id, item])) as Record<HatTemplateId, HatTemplate>;

export function getHatTemplate(id: HatTemplateId): HatTemplate {
  return HAT_TEMPLATE_BY_ID[id];
}

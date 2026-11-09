export const MANUFACTURED_SLEEVE_COLORS = [
  { id: "black", label: "Black", hex: "#000000" },
  { id: "white", label: "White", hex: "#FFFFFF" },
  { id: "red", label: "Red", hex: "#D7021C" },
  { id: "yellow", label: "Yellow", hex: "#FFDF03" },
] as const;

export type ManufacturedSleeveColor = (typeof MANUFACTURED_SLEEVE_COLORS)[number];

export function isManufacturedSleeveColor(hex: string): boolean {
  return MANUFACTURED_SLEEVE_COLORS.some((color) => color.hex.toLowerCase() === hex.toLowerCase());
}

export enum FaviconShape {
  Circle = "circle",
  Rounded = "rounded",
  Square = "square",
  Squircle = "squircle",
  Hexagon = "hexagon",
  Star = "star",
  Flower = "flower",
}

export const FAVICON_SHAPE_VALUES: readonly string[] = Object.freeze(
  Object.values(FaviconShape),
);

export const DEFAULT_FAVICON_SHAPE = FaviconShape.Circle;

export const FAVICON_SHAPE_SETTING = "faviconShape";

export const isFaviconShape = (value: unknown): value is FaviconShape =>
  typeof value === "string" && FAVICON_SHAPE_VALUES.includes(value);

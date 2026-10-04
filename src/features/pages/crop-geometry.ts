import type { ImageBounds } from "./image-crop";
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));
export function moveCrop(
  bounds: ImageBounds,
  handle: CropHandle,
  dx: number,
  dy: number,
  width: number,
  height: number,
): ImageBounds {
  if (handle === "move")
    return {
      ...bounds,
      x: clamp(bounds.x + dx, 0, width - bounds.width),
      y: clamp(bounds.y + dy, 0, height - bounds.height),
    };
  let left = bounds.x,
    top = bounds.y,
    right = left + bounds.width,
    bottom = top + bounds.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - 1);
  if (handle.includes("e")) right = clamp(right + dx, left + 1, width);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - 1);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + 1, height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

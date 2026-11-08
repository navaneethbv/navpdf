/**
 * The point level or plumb with `anchor`, whichever is nearer to `point`, as a CAD program's
 * ortho mode keeps a line horizontal or vertical. Page rotations are quarter turns, so level and
 * plumb in PDF space are level and plumb on screen too.
 */
export function orthoPoint(
  anchor: readonly [number, number] | readonly number[],
  point: readonly [number, number] | readonly number[],
): [number, number] {
  const dx = Math.abs(point[0] - anchor[0]);
  const dy = Math.abs(point[1] - anchor[1]);
  return dx >= dy ? [point[0], anchor[1]] : [anchor[0], point[1]];
}

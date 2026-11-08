/**
 * The PDF offset that moves something by (`right`, `down`) on screen when its page is shown
 * turned clockwise by `rotation` degrees (page /Rotate plus view rotation).
 */
export function screenToPageOffset(
  right: number,
  down: number,
  rotation: number,
): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [down, right];
    case 180:
      return [-right, down];
    case 270:
      return [-down, -right];
    default:
      return [right, -down];
  }
}

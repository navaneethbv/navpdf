/** Parses "#rrggbb" into colour channels from 0 to 1, or null when it is not in that form. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return null;
  const [, red, green, blue] = match;
  return [red, green, blue].map((channel) => Number.parseInt(channel, 16) / 255) as [
    number,
    number,
    number,
  ];
}

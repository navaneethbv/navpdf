import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { detectImageBounds } from "../../src/features/pages/image-crop";

async function borderedImage(background: string, jpeg = false) {
  const content = await sharp({
    create: { width: 80, height: 60, channels: 4, background: "#174965" },
  })
    .png()
    .toBuffer();
  const source = sharp({ create: { width: 120, height: 100, channels: 4, background } }).composite([
    { input: content, left: 13, top: 17 },
  ]);
  const encoded = await (jpeg ? source.jpeg({ quality: 95 }) : source.png()).toBuffer();
  const { data, info } = await sharp(encoded)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

describe("image margin detection", () => {
  it.each(["white", "black", "#d1c6ac", "#00000000"])(
    "trims asymmetric %s borders without cutting content",
    async (color) => {
      expect(detectImageBounds(await borderedImage(color))).toEqual({
        x: 13,
        y: 17,
        width: 80,
        height: 60,
      });
    },
  );
  it("tolerates JPEG border noise while retaining the content", async () => {
    const bounds = detectImageBounds(await borderedImage("white", true));
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeLessThanOrEqual(13);
    expect(bounds!.y).toBeLessThanOrEqual(17);
    expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(93);
    expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(77);
    expect(bounds!.width).toBeLessThan(100);
  });
  it("does not crop blank images or a single pixel", () => {
    expect(
      detectImageBounds({ width: 3, height: 4, data: new Uint8Array(48).fill(255) }),
    ).toBeNull();
    expect(
      detectImageBounds({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }),
    ).toBeNull();
  });
  it("refuses inconsistent corners and keeps content that reaches each edge", () => {
    const data = new Uint8Array(5 * 5 * 4).fill(255);
    const ink = (pixel: number) => data.set([0, 0, 0, 255], pixel * 4);
    ink(0);
    expect(detectImageBounds({ width: 5, height: 5, data })).toBeNull();
    data.fill(255);
    [2, 10, 14, 22].forEach(ink);
    expect(detectImageBounds({ width: 5, height: 5, data })).toBeNull();
  });
  it("retains isolated marks near the edge", async () => {
    const pixels = await borderedImage("white");
    pixels.data.set([0, 0, 0, 255], (2 * pixels.width + 3) * 4);
    expect(detectImageBounds(pixels)).toEqual({ x: 3, y: 2, width: 90, height: 75 });
  });
  it.each([0, -1, 1.5, 20000, NaN])("rejects invalid dimensions %s", (width) => {
    expect(() => detectImageBounds({ width, height: 1, data: new Uint8Array(4) })).toThrow(
      "Invalid image pixels",
    );
  });
  it("rejects incomplete RGBA buffers", () => {
    expect(() => detectImageBounds({ width: 2, height: 2, data: new Uint8Array(4) })).toThrow();
  });
});

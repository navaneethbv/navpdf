// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  decodeImageFrames,
  expandImageInput,
} from "../../src/features/pages/extended-image-import";
vi.mock("../../src/services/native", () => ({ native: false }));
function frames(...sizes: number[]) {
  const buffer = new ArrayBuffer(4 + sizes.reduce((a, b) => a + b + 4, 0)),
    view = new DataView(buffer);
  view.setUint32(0, sizes.length);
  let offset = 4;
  for (const size of sizes) {
    view.setUint32(offset, size);
    offset += 4;
    new Uint8Array(buffer, offset, 4).set([137, 80, 78, 71]);
    offset += size;
  }
  return buffer;
}
describe("extended image import", () => {
  it("expands TIFF pages in order with stable filenames", () => {
    const result = decodeImageFrames(frames(8, 16), "scan.tiff");
    expect(result.map((f) => [f.name, f.size, f.type])).toEqual([
      ["scan-page-1.png", 8, "image/png"],
      ["scan-page-2.png", 16, "image/png"],
    ]);
  });
  it("rejects incomplete or oversized protocol messages", () => {
    expect(() => decodeImageFrames(new ArrayBuffer(1), "a")).toThrow();
    expect(() => decodeImageFrames(frames(8).slice(0, 10), "a")).toThrow();
    const bad = frames(8);
    new DataView(bad).setUint32(4, 30 * 1024 * 1024);
    expect(() => decodeImageFrames(bad, "a")).toThrow();
    expect(() => decodeImageFrames(frames(), "a")).toThrow();
  });
  it("passes regular images through and reports native-only conversion", async () => {
    const png = new File(["x"], "a.png");
    expect(await expandImageInput(png)).toEqual([png]);
    await expect(expandImageInput(new File(["x"], "a.heic"))).rejects.toThrow("native macOS");
  });
});

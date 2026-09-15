import { describe, it, expect } from "vitest";
import { ocrRecognizePage, ocrGetEngineInfo } from "../../src/services/native";

describe("OCR capability boundary", () => {
  it("reports OCR unavailable in the browser instead of advertising a simulated engine", async () => {
    await expect(ocrGetEngineInfo()).rejects.toThrow("native macOS");
  });

  it("never returns invented recognition for browser image input", async () => {
    await expect(
      ocrRecognizePage(new Uint8Array([137, 80, 78, 71]), {
        pageIndex: 0,
        language: "en-US",
      }),
    ).rejects.toThrow("native macOS");
  });
});

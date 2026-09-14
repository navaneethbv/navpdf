import { describe, expect, it } from "vitest";
import { AnnotationEditorType } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  FREEHAND_HIGHLIGHT_OPACITY,
  installHighlightInterop,
  interoperableFreehandHighlight,
} from "../../src/features/viewer/highlight-interop";

const freehand = {
  annotationType: AnnotationEditorType.HIGHLIGHT,
  quadPoints: null,
  opacity: 1,
  color: [245, 207, 88],
  pageIndex: 0,
};

describe("freehand highlight interoperability", () => {
  it("saves newly drawn freehand highlights with partial opacity", () => {
    expect(interoperableFreehandHighlight(freehand)).toEqual({
      ...freehand,
      opacity: FREEHAND_HIGHLIGHT_OPACITY,
      color: [235, 159, 0],
    });
  });

  it("keeps light highlight colors unchanged on white under Multiply", () => {
    for (const color of [
      [245, 207, 128],
      [128, 212, 155],
      [140, 201, 247],
      [243, 161, 192],
    ]) {
      const saved = interoperableFreehandHighlight({ ...freehand, color });
      const alpha = saved.opacity;
      saved.color.forEach((channel, index) =>
        expect(
          Math.abs(255 * (1 - alpha) + channel * alpha - color[index]),
        ).toBeLessThanOrEqual(1),
      );
    }
  });

  it("leaves text highlights, other editors and saved translucency alone", () => {
    const text = { ...freehand, quadPoints: [1, 2, 3, 4, 5, 6, 7, 8] };
    const ink = { ...freehand, annotationType: AnnotationEditorType.INK };
    const reopened = { ...freehand, opacity: 0.5 };
    const deleted = {
      annotationType: AnnotationEditorType.HIGHLIGHT,
      deleted: true,
    };
    for (const value of [text, ink, reopened, deleted])
      expect(interoperableFreehandHighlight(value)).toBe(value);
  });

  it("transforms serialized storage values and keeps other fields", () => {
    const transfer: unknown[] = [];
    class Storage {
      get serializable() {
        return {
          map: new Map<string, unknown>([
            ["free", freehand],
            ["value", { value: "form text" }],
          ]),
          hash: "abc",
          transfer,
        };
      }
    }
    const storage = new Storage();
    installHighlightInterop(storage);
    const serialized = storage.serializable as unknown as {
      map: Map<string, { opacity?: number; value?: string }>;
      hash: string;
      transfer: unknown[];
    };
    expect(serialized.map.get("free")?.opacity).toBe(
      FREEHAND_HIGHLIGHT_OPACITY,
    );
    expect(serialized.map.get("value")).toEqual({ value: "form text" });
    expect(serialized.hash).toBe("abc");
    expect(serialized.transfer).toBe(transfer);
  });

  it("does not replace empty serialization or storage without a getter", () => {
    const empty = { map: undefined, hash: "", transfer: undefined };
    class Empty {
      get serializable() {
        return empty;
      }
    }
    const storage = new Empty();
    installHighlightInterop(storage);
    expect(storage.serializable).toBe(empty);
    const plain = {};
    installHighlightInterop(plain);
    expect(Object.keys(plain)).toEqual([]);
  });
});

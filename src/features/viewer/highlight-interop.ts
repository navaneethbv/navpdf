import { AnnotationEditorType } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Opacity written for NavPDF freehand highlights.
 *
 * pdf.js saves a freehand highlight as an `/Ink` annotation (`/IT /InkHighlight`)
 * whose appearance relies on the Multiply blend mode to keep text readable.
 * Preview ignores that blend mode but honors opacity, so a fully opaque
 * freehand highlight hides the text beneath it. Text-selection highlights are
 * saved as `/Highlight` annotations and render correctly without this change.
 */
export const FREEHAND_HIGHLIGHT_OPACITY = 0.5;

interface SerializedEditor {
  annotationType?: number;
  quadPoints?: unknown;
  opacity?: number;
  color?: number[];
}

/**
 * Return the saved form of a serialized pdf.js editor value.
 *
 * Only newly drawn freehand highlights (no quad points, full opacity) change.
 * Their color is compensated so that readers honoring Multiply still show the
 * chosen color on a white page; channels darker than the opacity allows are
 * clamped and render paler than chosen.
 */
export function interoperableFreehandHighlight<T extends SerializedEditor>(
  value: T,
): T {
  if (
    value.annotationType !== AnnotationEditorType.HIGHLIGHT ||
    value.quadPoints ||
    value.opacity !== 1 ||
    !Array.isArray(value.color)
  )
    return value;
  const alpha = FREEHAND_HIGHLIGHT_OPACITY;
  return {
    ...value,
    opacity: alpha,
    color: value.color.map((channel) =>
      Math.round(
        Math.min(255, Math.max(0, (channel - 255 * (1 - alpha)) / alpha)),
      ),
    ),
  };
}

interface Serializable {
  map?: Map<string, unknown>;
}

/**
 * Apply `interoperableFreehandHighlight` wherever this document's annotation
 * storage is serialized: saving, recovery copies, page mutations and printing.
 *
 * The transform is deterministic, so pdf.js's cache hash over the original
 * values still identifies the transformed output.
 */
export function installHighlightInterop(storage: object) {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(storage),
    "serializable",
  );
  const read = descriptor?.get;
  if (!read) return;
  Object.defineProperty(storage, "serializable", {
    configurable: true,
    get() {
      const serialized = read.call(this) as Serializable;
      if (!serialized.map?.size) return serialized;
      const map = new Map<string, unknown>();
      for (const [key, value] of serialized.map)
        map.set(
          key,
          interoperableFreehandHighlight(value as SerializedEditor),
        );
      return { ...serialized, map };
    },
  });
}

// Helpers for annotation appearance streams. Readers draw an annotation from its normal
// appearance, so annotations NavPDF creates carry one instead of relying on reader defaults.

import {
  StandardFonts,
  appendBezierCurve,
  beginText,
  closePath,
  endText,
  lineTo,
  moveText,
  moveTo,
  setFontAndSize,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFOperator,
  type PDFRef,
} from "pdf-lib";

/** Counter-rotates appearance content so it reads upright on a page displayed with `rotation`. */
export function uprightMatrix(rotation: 0 | 90 | 180 | 270): number[] {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));
  return [cos, sin, -sin, cos, 0, 0];
}

/** Path operators for a rectangle with rounded corners, ready to stroke or fill. */
export function roundedRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): PDFOperator[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  // Control point distance that approximates a quarter circle with a cubic curve.
  const k = r * 0.5523;
  const right = x + width;
  const top = y + height;
  return [
    moveTo(x + r, y),
    lineTo(right - r, y),
    appendBezierCurve(right - r + k, y, right, y + r - k, right, y + r),
    lineTo(right, top - r),
    appendBezierCurve(right, top - r + k, right - r + k, top, right - r, top),
    lineTo(x + r, top),
    appendBezierCurve(x + r - k, top, x, top - r + k, x, top - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
  ];
}

/** Rejects text a standard font cannot encode, naming the first unsupported character. */
export function encodeStandardText(font: PDFFont, text: string) {
  try {
    return font.encodeText(text);
  } catch {
    const unsupported = [...text].find((char) => {
      try {
        font.encodeText(char);
        return false;
      } catch {
        return true;
      }
    });
    throw new Error(
      `"${unsupported ?? text}" cannot be drawn with the built-in fonts. Use Latin characters.`,
    );
  }
}

/** Largest size, up to `max`, at which `text` fits `width`. */
export function fitFontSize(font: PDFFont, text: string, width: number, max: number) {
  const unit = font.widthOfTextAtSize(text, 1);
  return unit > 0 ? Math.max(1, Math.min(max, width / unit)) : max;
}

/** Operators that draw one line of text with its left baseline at `x`, `y`. */
export function textLine(
  font: PDFFont,
  name: string,
  text: string,
  size: number,
  x: number,
  y: number,
): PDFOperator[] {
  return [
    beginText(),
    setFontAndSize(name, size),
    moveText(x, y),
    showText(encodeStandardText(font, text)),
    endText(),
  ];
}

export interface AppearanceFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export async function embedAppearanceFonts(doc: PDFDocument): Promise<AppearanceFonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

/** Registers a form XObject appearance whose content is drawn in a `width` x `height` box. */
export function appearanceStream(
  doc: PDFDocument,
  operators: PDFOperator[],
  options: { width: number; height: number; matrix?: number[]; fonts?: AppearanceFonts },
): PDFRef {
  const resources = options.fonts
    ? { Font: { Helv: options.fonts.regular.ref, HeBo: options.fonts.bold.ref } }
    : undefined;
  const stream = doc.context.formXObject(operators, {
    BBox: [0, 0, options.width, options.height],
    Matrix: options.matrix ?? [1, 0, 0, 1, 0, 0],
    ...(resources ? { Resources: resources } : {}),
  });
  return doc.context.register(stream);
}

/** The appearance dictionary entry pointing at a normal appearance. */
export function normalAppearance(doc: PDFDocument, ref: PDFRef) {
  return doc.context.obj({ N: ref });
}

export const APPEARANCE_FONT_NAMES = { regular: "Helv", bold: "HeBo" } as const;

// Rubber stamp annotations with their own appearance, so Preview, Acrobat and PDF.js all show
// the same stamp. Stamps are review markup, not signatures or certification.

import {
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from "pdf-lib";
import { pdfText } from "./text-string.ts";
import { toPdfDate } from "../document-commands.ts";
import { fromTopLeftVisual, visibleBox } from "./page-box.ts";
import {
  APPEARANCE_FONT_NAMES,
  appearanceStream,
  embedAppearanceFonts,
  encodeStandardText,
  fitFontSize,
  normalAppearance,
  roundedRectangle,
  textLine,
  uprightMatrix,
} from "./appearance.ts";

/** Stamp names defined by the PDF specification, plus a custom label. */
export const STANDARD_STAMPS = {
  Approved: { label: "APPROVED", tone: "green" },
  Final: { label: "FINAL", tone: "green" },
  ForPublicRelease: { label: "FOR PUBLIC RELEASE", tone: "green" },
  Draft: { label: "DRAFT", tone: "blue" },
  ForComment: { label: "FOR COMMENT", tone: "blue" },
  Experimental: { label: "EXPERIMENTAL", tone: "blue" },
  Departmental: { label: "DEPARTMENTAL", tone: "blue" },
  AsIs: { label: "AS IS", tone: "blue" },
  NotApproved: { label: "NOT APPROVED", tone: "red" },
  Confidential: { label: "CONFIDENTIAL", tone: "red" },
  NotForPublicRelease: { label: "NOT FOR PUBLIC RELEASE", tone: "red" },
  TopSecret: { label: "TOP SECRET", tone: "red" },
  Expired: { label: "EXPIRED", tone: "red" },
  Sold: { label: "SOLD", tone: "red" },
} as const;

export type StandardStampName = keyof typeof STANDARD_STAMPS;
export type StampTone = "green" | "blue" | "red";

const TONES: Record<StampTone, [number, number, number]> = {
  green: [0.09, 0.45, 0.22],
  blue: [0.1, 0.3, 0.65],
  red: [0.72, 0.1, 0.12],
};

export const STAMP_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type StampPosition = (typeof STAMP_POSITIONS)[number];

export interface StampInput {
  page: number;
  /** A standard stamp name, or `Custom` with `label`. */
  stamp: StandardStampName | "Custom";
  label?: string;
  tone?: StampTone;
  /** An optional second line, such as the reviewer and date. */
  detail?: string;
  position: StampPosition;
  /** Stamp width in points as displayed; height follows from the content. */
  width?: number;
  author?: string;
  id?: string;
}

const MARGIN = 24;

function placement(position: StampPosition, visual: { width: number; height: number }) {
  return (stamp: { width: number; height: number }) => {
    const [vertical, horizontal = "center"] =
      position === "center" ? ["center", "center"] : position.split("-");
    const spareX = visual.width - stamp.width;
    const spareY = visual.height - stamp.height;
    const x = { left: MARGIN, center: spareX / 2, right: spareX - MARGIN }[horizontal] ?? 0;
    const y = { top: MARGIN, center: spareY / 2, bottom: spareY - MARGIN }[vertical] ?? 0;
    return { x: Math.max(0, x), y: Math.max(0, y) };
  };
}

function stampText(input: StampInput) {
  if (input.stamp === "Custom") {
    const label = input.label?.trim().toUpperCase() ?? "";
    if (!label) throw new Error("Enter the text for the custom stamp.");
    if (label.length > 40) throw new Error("Custom stamp text is limited to 40 characters.");
    return { label, tone: input.tone ?? "blue" };
  }
  const standard = STANDARD_STAMPS[input.stamp];
  if (!standard) throw new Error("Choose a stamp.");
  return { label: standard.label, tone: input.tone ?? standard.tone };
}

/** Adds a stamp annotation with an upright appearance at a preset position on the page. */
export async function addStamp(pdfBytes: Uint8Array, input: StampInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = input.page - 1;
  if (!Number.isInteger(input.page) || pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error("Stamp page is outside the document.");
  const page = doc.getPage(pageIndex);
  const box = visibleBox(page);
  const quarterTurn = box.rotation === 90 || box.rotation === 270;
  const visual = {
    width: quarterTurn ? box.height : box.width,
    height: quarterTurn ? box.width : box.height,
  };
  const { label, tone } = stampText(input);
  const detail = input.detail?.trim() ?? "";
  if (detail.length > 80) throw new Error("The stamp detail line is limited to 80 characters.");

  const fonts = await embedAppearanceFonts(doc);
  encodeStandardText(fonts.bold, label);
  if (detail) encodeStandardText(fonts.regular, detail);
  const width = Math.min(Math.max(input.width ?? 180, 72), visual.width - 2 * MARGIN);
  if (width < 72) throw new Error("The page is too small for a stamp.");
  const padding = 8;
  const labelSize = fitFontSize(fonts.bold, label, width - 2 * padding, 28);
  const detailSize = detail
    ? fitFontSize(fonts.regular, detail, width - 2 * padding, Math.max(6, labelSize * 0.38))
    : 0;
  const height = padding * 2 + labelSize * 0.75 + (detail ? detailSize * 1.4 : 0);
  const color = TONES[tone];

  const labelWidth = fonts.bold.widthOfTextAtSize(label, labelSize);
  const operators = [
    pushGraphicsState(),
    setStrokingRgbColor(...color),
    setFillingRgbColor(...color),
    setLineWidth(2.5),
    ...roundedRectangle(1.25, 1.25, width - 2.5, height - 2.5, 6),
    stroke(),
    ...textLine(
      fonts.bold,
      APPEARANCE_FONT_NAMES.bold,
      label,
      labelSize,
      (width - labelWidth) / 2,
      height - padding - labelSize * 0.75,
    ),
    ...(detail
      ? textLine(
          fonts.regular,
          APPEARANCE_FONT_NAMES.regular,
          detail,
          detailSize,
          (width - fonts.regular.widthOfTextAtSize(detail, detailSize)) / 2,
          padding,
        )
      : []),
    popGraphicsState(),
  ];
  const appearance = appearanceStream(doc, operators, {
    width,
    height,
    matrix: uprightMatrix(box.rotation),
    fonts,
  });

  const where = placement(input.position, visual)({ width, height });
  const rect = fromTopLeftVisual(page, where.x, where.y, width, height);
  const now = toPdfDate();
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: "Stamp",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Name: PDFName.of(input.stamp === "Custom" ? "NavPDFCustom" : input.stamp),
    F: 4,
    P: page.ref,
    C: color,
    NM: pdfText(input.id ?? `navpdf-stamp-${crypto.randomUUID()}`),
    T: pdfText(input.author?.trim() || "NavPDF"),
    Contents: pdfText(detail ? `${label}\n${detail}` : label),
    M: pdfText(now),
    CreationDate: pdfText(now),
    AP: normalAppearance(doc, appearance),
  });
  page.node.addAnnot(doc.context.register(annotation));
  return doc.save();
}

import { flattenDocument } from "../../services/pdf/flatten";
import type { CompressionReport, DiscardOptions, EngineResult } from "../../types/engine";

export const NO_DISCARDS: DiscardOptions = {
  javascript: false,
  thumbnails: false,
  tags: false,
  bookmarks: false,
  printSettings: false,
  alternateImages: false,
  comments: false,
  multimedia: false,
  metadata: false,
  attachments: false,
  privateData: false,
};

export const DISCARD_LABELS: Record<keyof DiscardOptions, string> = {
  javascript: "JavaScript actions",
  thumbnails: "Embedded page thumbnails",
  tags: "Document tags (reduces accessibility)",
  bookmarks: "Bookmarks",
  printSettings: "Embedded print settings",
  alternateImages: "Alternate images",
  comments: "Comments and markups",
  multimedia: "Multimedia (sound, movie, 3D and rich media)",
  metadata: "Document information and metadata",
  attachments: "File attachments",
  privateData: "Private application data",
};

/**
 * Optionally flattens form fields, then runs the optimizer with the chosen discards. The report
 * always describes the original document, and a flattening the user asked for is kept even
 * when compression saves no space.
 */
export async function optimize(
  original: Uint8Array,
  flattenForms: boolean,
  run: (bytes: Uint8Array) => Promise<EngineResult<CompressionReport>>,
): Promise<EngineResult<CompressionReport>> {
  if (!flattenForms) return run(original);
  const flattened = await flattenDocument(original, { annotations: false, forms: true });
  const result = await run(flattened.bytes);
  const note = `Form field widgets flattened: ${flattened.report.widgets}`;
  const discarded = [note, ...(result.report.discarded ?? [])];
  const faithful = result.report.checks.every((check) => check.passed);
  if (result.bytes || !faithful || flattened.report.widgets === 0) {
    return {
      ...result,
      report: { ...result.report, beforeBytes: original.length, discarded },
    };
  }
  return {
    bytes: new Uint8Array(flattened.bytes),
    report: {
      ...result.report,
      beforeBytes: original.length,
      afterBytes: flattened.bytes.length,
      useful: true,
      discarded,
      message: "Form fields were flattened; compression saved no further space.",
    },
  };
}

import { loadPdfFromBytes } from "../../services/pdf";
import { copyAnnotations } from "../../services/pdf/comment-batch";

/** The most pixels a drag preview is drawn with. */
const MAX_PREVIEW_PIXELS = 4_000_000;

export interface CommentPreview {
  /** A PNG of the comments alone, with a transparent background. */
  url: string;
  /** Where the picture sits in the page view at scale 1, in CSS pixels from its top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Draws the selected comments alone, without the page's content, so a drag can show the comments
 * themselves where they would go. Comments must be on one page; returns null otherwise.
 */
export async function renderCommentPreview(
  pdfBytes: Uint8Array,
  ids: string[],
  scale: number,
): Promise<CommentPreview | null> {
  let clip;
  try {
    clip = await copyAnnotations(pdfBytes, ids);
  } catch {
    return null;
  }
  const task = loadPdfFromBytes(clip.bytes as Uint8Array<ArrayBuffer>);
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const unit = page.getViewport({ scale: 1, rotation: page.rotate });
    const fit = Math.min(scale, Math.sqrt(MAX_PREVIEW_PIXELS / (unit.width * unit.height)));
    const viewport = page.getViewport({ scale: fit, rotation: page.rotate });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    // The page is blank and the canvas transparent, so only the comments' pixels are drawn.
    await page.render({ canvasContext: context, viewport, background: "rgba(0,0,0,0)" } as never)
      .promise;
    const url = canvas.toDataURL("image/png");
    canvas.width = 0;
    canvas.height = 0;
    return {
      url,
      left: 0,
      top: 0,
      width: unit.width,
      height: unit.height,
    };
  } catch {
    return null;
  } finally {
    await task.destroy().catch(() => {});
  }
}

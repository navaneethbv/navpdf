import type { PDFFindController } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
/** PDF.js 6 exposes matches but no jump-to-result command. Keep its cursor
 * synchronized before dispatching Find Again, so Next/Previous remain correct.
 * Covered against the pinned PDF.js version by the search integration test.
 */
export function positionSearchCursor(
  find: PDFFindController,
  page: number,
  index: number,
) {
  const matches = find.pageMatches as number[][] | undefined;
  if (!matches?.[page - 1]?.[index] && matches?.[page - 1]?.[index] !== 0)
    return false;
  const offset = find._offset as
    | { pageIdx: number | null; matchIdx: number | null; wrapped: boolean }
    | undefined;
  if (!offset) return false;
  offset.pageIdx = page - 1;
  offset.matchIdx = index - 1;
  offset.wrapped = false;
  return true;
}

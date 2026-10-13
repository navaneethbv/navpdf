import { PDFDocument } from "pdf-lib";
import { extractPages } from "../../services/document-commands";
import { createZip } from "../convert/ooxml";
import { MAX_ARCHIVE_FILES } from "./page-selection";

const MAX_ARCHIVE_BYTES = 1024 ** 3;

export interface PageArchiveProgress {
  isCancelled?: () => boolean;
  onProgress?: (completed: number, total: number) => void;
}

/** Reuses the extraction boundary, including its external-page-link handling. */
export async function createPageArchive(
  source: Uint8Array,
  groups: number[][],
  progress: PageArchiveProgress = {},
): Promise<Uint8Array> {
  const checkCancelled = () => {
    if (progress.isCancelled?.()) throw new DOMException("Export cancelled.", "AbortError");
  };
  checkCancelled();
  if (!groups.length) throw new Error("Select at least one page to export.");
  if (groups.length > MAX_ARCHIVE_FILES) throw new Error("A ZIP can contain at most 1,000 PDFs.");
  if (source.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The source exceeds the 1 GB limit.");
  const document = await PDFDocument.load(source);
  const totalPages = document.getPageCount();
  const seen = new Set<number>();
  for (const group of groups) {
    if (!group.length) throw new Error("Each PDF must contain at least one page.");
    for (const [position, page] of group.entries()) {
      if (!Number.isSafeInteger(page) || page < 0 || page >= totalPages) {
        throw new Error("A selected page is outside the document.");
      }
      if (seen.has(page) || (position > 0 && page <= group[position - 1])) {
        throw new Error("Pages must be unique and in source order.");
      }
      seen.add(page);
    }
  }
  const entries: { name: string; data: Uint8Array }[] = [];
  let archiveSize = 22;
  for (const group of groups) {
    checkCancelled();
    const data = await extractPages(source, group);
    checkCancelled();
    const first = group[0] + 1;
    const last = group[group.length - 1] + 1;
    const name = group.length === 1 ? `page-${first}.pdf` : `pages-${first}-${last}.pdf`;
    archiveSize += data.byteLength + 76 + 2 * name.length;
    if (archiveSize > MAX_ARCHIVE_BYTES) {
      throw new Error("The ZIP exceeds the 1 GB export limit. Choose fewer pages.");
    }
    entries.push({ name, data });
    progress.onProgress?.(entries.length, groups.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  checkCancelled();
  return createZip(entries);
}

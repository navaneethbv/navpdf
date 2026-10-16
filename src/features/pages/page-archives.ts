import { mapInOrder } from "../../utils/async-sequence";
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
  validateGroups(groups, totalPages);
  const entries: { name: string; data: Uint8Array }[] = [];
  let archiveSize = 22;
  const extractGroup = async (group: number[]) => {
    checkCancelled();
    const data = await extractPages(source, group);
    checkCancelled();
    const first = group[0] + 1;
    const last = group.at(-1)! + 1;
    const name = group.length === 1 ? `page-${first}.pdf` : `pages-${first}-${last}.pdf`;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { name, data };
  };
  for await (const { name, data } of mapInOrder(groups, extractGroup)) {
    archiveSize += data.byteLength + 76 + 2 * name.length;
    if (archiveSize > MAX_ARCHIVE_BYTES) {
      throw new Error("The ZIP exceeds the 1 GB export limit. Choose fewer pages.");
    }
    entries.push({ name, data });
    progress.onProgress?.(entries.length, groups.length);
  }
  checkCancelled();
  return createZip(entries);
}

function validateGroups(groups: number[][], totalPages: number) {
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
}

/** Split before each distinct top-level bookmark, retaining any leading unbookmarked pages. */
export async function bookmarkPageGroups(source: Uint8Array): Promise<number[][]> {
  const { readBookmarkTree } = await import("../../services/pdf/bookmarks");
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  const bookmarks = readBookmarkTree(doc);
  const starts = [
    ...new Set([
      0,
      ...bookmarks.flatMap((bookmark) => (bookmark.page === null ? [] : [bookmark.page])),
    ]),
  ].sort((a, b) => a - b);
  if (!bookmarks.some((bookmark) => bookmark.page !== null))
    throw new Error("No top-level bookmarks have page destinations.");
  if (starts.length > MAX_ARCHIVE_FILES) throw new Error("A ZIP can contain at most 1,000 PDFs.");
  return starts.map((first, index) =>
    Array.from(
      { length: (starts[index + 1] ?? doc.getPageCount()) - first },
      (_, offset) => first + offset,
    ),
  );
}

/** Every chosen group is measured from an actual PDF serialization, not a source-size estimate. */
export async function sizePageGroups(
  source: Uint8Array,
  maxBytes: number,
  progress: PageArchiveProgress = {},
): Promise<number[][]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_ARCHIVE_BYTES)
    throw new Error("Choose a maximum file size between 1 KB and 1 GB.");
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  const count = doc.getPageCount();
  if (count > 1000) throw new Error("Splitting by size is limited to 1,000 source pages.");
  const groups: number[][] = [];
  const cancelled = () => {
    if (progress.isCancelled?.()) throw new DOMException("Export cancelled.", "AbortError");
  };
  for (let first = 0; first < count;) {
    cancelled();
    let low = first + 1;
    let high = count;
    let chosen: number[] | null = null;
    // Sizes need not be perfectly monotonic. Binary search may choose more parts than optimal,
    // but only an explicitly measured, fitting range is ever accepted.
    while (low <= high) {
      cancelled();
      const end = Math.floor((low + high) / 2);
      const group = Array.from({ length: end - first }, (_, offset) => first + offset);
      const bytes = await extractPages(source, group);
      cancelled();
      if (bytes.byteLength <= maxBytes) {
        chosen = group;
        low = end + 1;
      } else high = end - 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!chosen)
      throw new Error(
        `Page ${first + 1} cannot fit the chosen size without compression. Increase the limit.`,
      );
    groups.push(chosen);
    first += chosen.length;
    progress.onProgress?.(first, count);
  }
  return groups;
}

const MAX_PAGE_COUNT = 100_000;
const MAX_RANGE_LENGTH = 10_000;
export const MAX_ARCHIVE_FILES = 1_000;

function pageIndices(totalPages: number): number[] {
  if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGE_COUNT) {
    throw new Error("The page count must be between 1 and 100,000.");
  }
  return Array.from({ length: totalPages }, (_, index) => index);
}

function checkedSelection(totalPages: number, selected: number[]): number[] {
  pageIndices(totalPages);
  if (selected.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= totalPages)) {
    throw new Error("A selected page is outside the document.");
  }
  return [...new Set(selected)].sort((left, right) => left - right);
}

/** Strict one-based ranges, returned as unique zero-based indices in source order. */
export function parseSelectionRange(range: string, totalPages: number): number[] {
  pageIndices(totalPages);
  if (range.length > MAX_RANGE_LENGTH) throw new Error("The page range is too long.");
  const selected = new Set<number>();
  for (const token of range.split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token.trim());
    if (!match) throw new Error("Enter a page range such as 1-3, 5.");
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      Math.min(start, end) < 1 ||
      Math.max(start, end) > totalPages
    ) {
      throw new Error(`Choose page numbers from 1 to ${totalPages}.`);
    }
    for (let page = Math.min(start, end); page <= Math.max(start, end); page++) {
      selected.add(page - 1);
    }
  }
  return [...selected].sort((left, right) => left - right);
}

export function presetSelection(
  preset: "odd" | "even" | "invert",
  totalPages: number,
  selected: number[],
): number[] {
  const current = new Set(checkedSelection(totalPages, selected));
  return pageIndices(totalPages).filter((index) => {
    if (preset === "invert") return !current.has(index);
    return index % 2 === (preset === "odd" ? 0 : 1);
  });
}

export function reversePageOrder(totalPages: number): number[] {
  return pageIndices(totalPages).reverse();
}

/** The destination uses its original index; selected pages keep their source order. */
export function moveSelectionBefore(
  totalPages: number,
  selected: number[],
  destination: number | "end",
): number[] {
  const moving = checkedSelection(totalPages, selected);
  if (!moving.length) throw new Error("Select at least one page to move.");
  const selectedSet = new Set(moving);
  if (destination !== "end") {
    if (!Number.isSafeInteger(destination) || destination < 0 || destination >= totalPages) {
      throw new Error(`Choose a destination page from 1 to ${totalPages}.`);
    }
    if (selectedSet.has(destination)) {
      throw new Error("Choose a destination outside the selection, or move to the end.");
    }
  }
  const remaining = pageIndices(totalPages).filter((index) => !selectedSet.has(index));
  const position = destination === "end" ? remaining.length : remaining.indexOf(destination);
  return [...remaining.slice(0, position), ...moving, ...remaining.slice(position)];
}

function assertArchiveCount(count: number) {
  if (count > MAX_ARCHIVE_FILES) {
    throw new Error("A ZIP can contain at most 1,000 PDFs. Use larger groups or fewer pages.");
  }
}

export function fixedPageGroups(totalPages: number, pagesPerFile: number): number[][] {
  const pages = pageIndices(totalPages);
  if (!Number.isSafeInteger(pagesPerFile) || pagesPerFile < 1 || pagesPerFile > totalPages) {
    throw new Error(`Pages per file must be a whole number from 1 to ${totalPages}.`);
  }
  assertArchiveCount(Math.ceil(totalPages / pagesPerFile));
  const groups: number[][] = [];
  for (let index = 0; index < pages.length; index += pagesPerFile) {
    groups.push(pages.slice(index, index + pagesPerFile));
  }
  return groups;
}

export function individualPageGroups(totalPages: number, selected: number[]): number[][] {
  const pages = checkedSelection(totalPages, selected);
  if (!pages.length) throw new Error("Select at least one page to export.");
  assertArchiveCount(pages.length);
  return pages.map((page) => [page]);
}

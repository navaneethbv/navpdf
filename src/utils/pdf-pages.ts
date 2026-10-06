/**
 * Yields each requested page with its number, one at a time and in order. A page is only
 * requested once the previous one has been consumed, so a caller that stops early, for example
 * on cancellation, never loads the pages after it.
 */
export async function* pagesInOrder<Page>(
  pdf: { getPage(pageNumber: number): Promise<Page> },
  pageNumbers: Iterable<number>,
): AsyncGenerator<readonly [number, Page]> {
  for (const pageNumber of pageNumbers) {
    yield pdf.getPage(pageNumber).then((page) => [pageNumber, page] as const);
  }
}

/** The page numbers 1 to `pageCount`. */
export function allPageNumbers(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

export type RangeMode = "all" | "current" | "custom";

/**
 * Resolve a print range selection to zero-based page indices.
 *
 * Accepts comma-separated single pages and `start-end` spans using the
 * one-based page numbers shown in the interface. Out-of-range values are
 * dropped rather than silently printing the wrong pages, and a custom range
 * that selects nothing is rejected so the user is told instead of receiving
 * an unexpected full-document print.
 */
export function parsePageRange(
  mode: RangeMode,
  custom: string,
  currentPage: number,
  totalPages: number,
): number[] {
  if (mode === "all") {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  if (mode === "current") {
    return [Math.max(0, Math.min(currentPage - 1, totalPages - 1))];
  }

  const selected = new Set<number>();
  for (const part of custom.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const span = token.split("-").map((n) => Number.parseInt(n.trim(), 10));
    const [start, end] =
      span.length === 1 ? [span[0], span[0]] : [span[0], span[1]];
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    for (let page = from; page <= to; page++) {
      if (page >= 1 && page <= totalPages) selected.add(page - 1);
    }
  }

  if (selected.size === 0) {
    throw new Error(
      `Enter a page range between 1 and ${totalPages}, for example 1-3, 5.`,
    );
  }
  return [...selected].sort((a, b) => a - b);
}

export type RangeMode = "all" | "current" | "custom";

function parseCustomPageRange(custom: string, totalPages: number): number[] {
  const selected = new Set<number>();

  for (const part of custom.split(",")) {
    const token = part.trim();
    if (!token) continue;

    let start: number;
    let end: number;
    if (/^\d+$/.test(token)) {
      start = Number(token);
      end = start;
    } else if (/^\d+\s*-\s*\d+$/.test(token)) {
      const [first, last] = token.split("-").map((value) => Number(value.trim()));
      start = first;
      end = last;
    } else if (token.includes("-")) {
      throw new Error("Incomplete range");
    } else {
      throw new Error("Invalid page range");
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new Error("Invalid page range: page numbers must be safe integers");
    }
    const from = Math.max(1, Math.min(start, end));
    const to = Math.min(totalPages, Math.max(start, end));
    for (let page = from; page <= to; page++) {
      selected.add(page - 1);
    }
  }

  if (selected.size === 0) {
    throw new Error("No pages match the selected page range");
  }
  return [...selected].sort((a, b) => a - b);
}

/**
 * Resolve a page selection to zero based page indices.
 *
 * The two argument form parses a custom range such as `1-3, 5`.
 * The four argument form preserves the existing all/current/custom API.
 */
export function parsePageRange(custom: string, totalPages: number): number[];
export function parsePageRange(
  mode: RangeMode,
  custom: string,
  currentPage: number,
  totalPages: number,
): number[];
export function parsePageRange(
  first: string,
  second: number | string,
  third?: number,
  fourth?: number,
): number[] {
  if (third === undefined && fourth === undefined && typeof second === "number") {
    return parseCustomPageRange(first, second);
  }

  const mode = first as RangeMode;
  const custom = second as string;
  const currentPage = third as number;
  const totalPages = fourth as number;

  if (mode === "all") {
    return Array.from({ length: totalPages }, (_, index) => index);
  }
  if (mode === "current") {
    return [Math.max(0, Math.min(currentPage - 1, totalPages - 1))];
  }
  return parseCustomPageRange(custom, totalPages);
}

// Bates numbering across several files: each file continues the numbering where the previous one
// ended, in the order chosen. A file that fails keeps no numbers, and the next file continues
// from the last number used.

import { applyBatesNumbering, type BatesNumberingOptions } from "../../services/document-commands";
import { csvField } from "../convert/formats";
import { createZip } from "../convert/ooxml";
import { uniqueName } from "../../utils/unique-name";

export const MAX_BATES_FILES = 50;
export const MAX_BATES_FILE_BYTES = 200 * 1024 * 1024;

export interface BatesFileResult {
  name: string;
  bytes: Uint8Array | null;
  first?: string;
  last?: string;
  pages?: number;
  error?: string;
}

/** Numbers each file in turn, continuing from `options.startNumber`. */
export async function batesAcrossFiles(
  files: { name: string; bytes: Uint8Array }[],
  options: Omit<BatesNumberingOptions, "pageIndices">,
  onProgress?: (index: number, total: number) => void,
  cancelled: () => boolean = () => false,
): Promise<BatesFileResult[]> {
  if (!files.length) throw new Error("Choose PDF files to number.");
  if (files.length > MAX_BATES_FILES) throw new Error(`Choose at most ${MAX_BATES_FILES} files.`);
  let next = options.startNumber ?? 1;
  const results: BatesFileResult[] = [];
  for (const [index, file] of files.entries()) {
    if (cancelled()) break;
    onProgress?.(index + 1, files.length);
    try {
      if (file.bytes.length > MAX_BATES_FILE_BYTES) throw new Error("Files are limited to 200 MB.");
      const result = await applyBatesNumbering(file.bytes, { ...options, startNumber: next });
      const items = result.manifest.items;
      if (!items.length) throw new Error("The file has no pages.");
      results.push({
        name: file.name,
        bytes: result.bytes,
        first: items[0].batesNumber,
        last: items.at(-1)!.batesNumber,
        pages: items.length,
      });
      next += items.length;
    } catch (cause) {
      results.push({
        name: file.name,
        bytes: null,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return results;
}

/** A ZIP of the numbered copies with a CSV listing each file's first and last number. */
export function batesArchive(results: BatesFileResult[]) {
  const used = new Set<string>();
  const entries = results.flatMap((result) => {
    if (!result.bytes) return [];
    const base = `${result.name.replace(/\.pdf$/i, "") || "Document"} (Bates)`;
    const name = uniqueName((copy) => (copy === 1 ? `${base}.pdf` : `${base} ${copy}.pdf`), used);
    return [{ name, data: result.bytes }];
  });
  if (!entries.length) throw new Error("No file was numbered.");
  const rows = [
    ["File", "Pages", "First", "Last", "Problem"],
    ...results.map((result) => [
      result.name,
      result.pages === undefined ? "" : String(result.pages),
      result.first ?? "",
      result.last ?? "",
      result.error ?? "",
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
  entries.push({ name: "Bates numbers.csv", data: new TextEncoder().encode(csv) });
  return createZip(entries);
}

// Bookmarks copied in any tab with their subtrees, and bookmark trees exported to or imported
// from JSON. Destinations travel as page numbers with their view; a page the target document
// lacks leaves the bookmark without a destination.

import type { EditableBookmark } from "../../services/pdf/bookmarks";

/** The most bookmarks a clipboard or JSON file holds, and how deep they may nest. */
const MAX_BOOKMARKS = 10_000;
const MAX_DEPTH = 32;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const VIEWS = ["XYZ", "Fit", "FitH", "FitV", "FitR", "FitB", "FitBH", "FitBV"];
/** Outline item flags: italic and bold. */
const ITALIC = 1;
const BOLD = 2;

let clipboard: EditableBookmark[] | null = null;

function count(nodes: EditableBookmark[]): number {
  return nodes.reduce((total, node) => total + 1 + count(node.children), 0);
}

/** A copy with new identifiers throughout, so it can be pasted next to the original. */
export function cloneBookmarks(nodes: EditableBookmark[], depth = 0): EditableBookmark[] {
  if (depth > MAX_DEPTH) throw new Error(`Bookmark nesting exceeds ${MAX_DEPTH} levels.`);
  return nodes.map((node) => ({
    ...node,
    id: crypto.randomUUID(),
    view: node.view ? [...node.view] : undefined,
    color: node.color ? [...node.color] : undefined,
    children: cloneBookmarks(node.children, depth + 1),
  }));
}

export function setBookmarkClipboard(nodes: EditableBookmark[]) {
  if (!nodes.length) throw new Error("Choose a bookmark to copy.");
  if (count(nodes) > MAX_BOOKMARKS) throw new Error("Too many bookmarks to copy.");
  clipboard = cloneBookmarks(nodes);
}

export function getBookmarkClipboard(): EditableBookmark[] | null {
  return clipboard;
}

export function clearBookmarkClipboard() {
  clipboard = null;
}

/**
 * Bookmarks ready to add to a document of `pageCount` pages: fresh identifiers, and no
 * destination for pages the document lacks. Returns how many lost their destination.
 */
export function bookmarksForDocument(
  nodes: EditableBookmark[],
  pageCount: number,
): { nodes: EditableBookmark[]; unplaced: number } {
  let unplaced = 0;
  const visit = (items: EditableBookmark[]): EditableBookmark[] =>
    items.map((node) => {
      const outside = node.page !== null && (node.page < 0 || node.page >= pageCount);
      if (outside) unplaced++;
      return {
        ...node,
        page: outside ? null : node.page,
        view: outside ? undefined : node.view,
        children: visit(node.children),
      };
    });
  return { nodes: visit(cloneBookmarks(nodes)), unplaced };
}

/** One bookmark in exported JSON. Pages count from 1. */
export interface BookmarkJson {
  title: string;
  page: number | null;
  view?: (number | string | null)[];
  color?: [number, number, number];
  bold?: boolean;
  italic?: boolean;
  open?: boolean;
  children?: BookmarkJson[];
}

export interface BookmarkFile {
  format: "navpdf-bookmarks";
  version: 1;
  bookmarks: BookmarkJson[];
}

function toJson(node: EditableBookmark): BookmarkJson {
  const entry: BookmarkJson = {
    title: node.title,
    page: node.page === null ? null : node.page + 1,
  };
  if (node.page !== null && node.view?.length) entry.view = node.view;
  if (node.color?.length === 3) entry.color = node.color as [number, number, number];
  if (node.flags && node.flags & BOLD) entry.bold = true;
  if (node.flags && node.flags & ITALIC) entry.italic = true;
  if (node.children.length) {
    entry.open = !node.collapsed;
    entry.children = node.children.map(toJson);
  }
  return entry;
}

/** The bookmark tree, or one bookmark's subtree, as JSON. */
export function exportBookmarksJson(nodes: EditableBookmark[]): string {
  const file: BookmarkFile = {
    format: "navpdf-bookmarks",
    version: 1,
    bookmarks: nodes.map(toJson),
  };
  return JSON.stringify(file, null, 2);
}

function invalid(reason: string): never {
  throw new Error(`This bookmark file is not valid: ${reason}.`);
}

function fromJson(value: unknown, depth: number, total: { count: number }): EditableBookmark {
  if (depth > MAX_DEPTH) invalid(`bookmarks nest more than ${MAX_DEPTH} levels`);
  if (++total.count > MAX_BOOKMARKS) invalid(`it has more than ${MAX_BOOKMARKS} bookmarks`);
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("a bookmark is not an object");
  const entry = value as Record<string, unknown>;
  const title = entry.title;
  if (typeof title !== "string" || !title.trim() || title.length > 1000)
    invalid("each title must have 1 to 1,000 characters");
  const page = entry.page;
  if (page !== null && (typeof page !== "number" || !Number.isInteger(page) || page < 1))
    invalid("pages must be whole numbers from 1, or null");
  let view: (number | string | null)[] | undefined;
  if (entry.view !== undefined) {
    const raw = entry.view;
    if (
      !Array.isArray(raw) ||
      raw.length > 5 ||
      typeof raw[0] !== "string" ||
      !VIEWS.includes(raw[0]) ||
      raw
        .slice(1)
        .some((item) => item !== null && (typeof item !== "number" || !Number.isFinite(item)))
    )
      invalid("a view is not a PDF destination view");
    view = raw as (number | string | null)[];
  }
  let color: number[] | undefined;
  if (entry.color !== undefined) {
    const raw = entry.color;
    if (
      !Array.isArray(raw) ||
      raw.length !== 3 ||
      !raw.every((item) => typeof item === "number" && item >= 0 && item <= 1)
    )
      invalid("colours must be three numbers from 0 to 1");
    color = raw as number[];
  }
  for (const key of ["bold", "italic", "open"])
    if (entry[key] !== undefined && typeof entry[key] !== "boolean")
      invalid(`${key} must be true or false`);
  const children = entry.children;
  if (children !== undefined && !Array.isArray(children)) invalid("children must be a list");
  const flags = (entry.bold ? BOLD : 0) | (entry.italic ? ITALIC : 0);
  const node: EditableBookmark = {
    id: crypto.randomUUID(),
    title: title as string,
    page: page === null ? null : (page as number) - 1,
    children: (children ?? []).map((child: unknown) => fromJson(child, depth + 1, total)),
  };
  if (view && node.page !== null) node.view = view;
  if (color) node.color = color;
  if (flags) node.flags = flags;
  if (node.children.length && entry.open === false) node.collapsed = true;
  return node;
}

/** Bookmarks read from exported JSON, validated before any is added. */
export function parseBookmarksJson(source: string): EditableBookmark[] {
  if (new TextEncoder().encode(source).length > MAX_JSON_BYTES) invalid("it is larger than 2 MB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    invalid("it is not JSON");
  }
  const file = parsed as Partial<BookmarkFile> | null;
  if (
    !file ||
    file.format !== "navpdf-bookmarks" ||
    file.version !== 1 ||
    !Array.isArray(file.bookmarks)
  )
    invalid("it was not exported from NavPDF bookmarks");
  const total = { count: 0 };
  return file.bookmarks!.map((entry) => fromJson(entry, 0, total));
}

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { resolveDestination } from "./link-targets.ts";

export interface EditableBookmark {
  id: string;
  title: string;
  page: number | null;
  children: EditableBookmark[];
  view?: (number | string | null)[];
  flags?: number;
  color?: number[];
  collapsed?: boolean;
}

export function readBookmarkTree(doc: PDFDocument): EditableBookmark[] {
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return [];
  const pages = new Map(doc.getPages().map((page, index) => [page.ref.toString(), index]));
  const visited = new Set<PDFDict>();
  const walk = (first: unknown, depth: number): EditableBookmark[] => {
    if (depth > 32) throw new Error("Bookmark nesting exceeds 32 levels.");
    const result: EditableBookmark[] = [];
    let node = first;
    while (node instanceof PDFDict) {
      if (visited.has(node) || visited.size >= 10000)
        throw new Error("Invalid or oversized bookmark tree.");
      visited.add(node);
      const title = node.lookup(PDFName.of("Title"));
      const action = node.lookupMaybe(PDFName.of("A"), PDFDict);
      if (action && action.lookupMaybe(PDFName.of("S"), PDFName)?.asString() !== "/GoTo")
        throw new Error(
          "Bookmarks with external or executable actions are not supported by this operation.",
        );
      const raw = node.lookup(PDFName.of("Dest")) ?? action?.lookup(PDFName.of("D"));
      const destination = resolveDestination(doc, raw);
      if (raw && !destination) throw new Error("A bookmark destination could not be resolved.");
      const target = destination?.get(0);
      const page =
        target instanceof PDFRef
          ? pages.get(target.toString())
          : target instanceof PDFNumber
            ? target.asNumber()
            : undefined;
      if (
        destination &&
        (page === undefined || !Number.isInteger(page) || page < 0 || page >= doc.getPageCount())
      )
        throw new Error("A bookmark targets a missing page.");
      const color = node
        .lookupMaybe(PDFName.of("C"), PDFArray)
        ?.asArray()
        .map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN));
      const view = destination
        ?.asArray()
        .slice(1)
        .map((value) => {
          if (value instanceof PDFNumber) return value.asNumber();
          if (value instanceof PDFName) return value.decodeText();
          if (value.toString() === "null") return null;
          throw new Error("Unsupported bookmark destination.");
        });
      result.push({
        id: `bookmark-${visited.size}`,
        color,
        flags: node.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber(),
        collapsed: (node.lookupMaybe(PDFName.of("Count"), PDFNumber)?.asNumber() ?? 0) < 0,
        title:
          title instanceof PDFString || title instanceof PDFHexString
            ? title.decodeText()
            : "Untitled",
        page: page ?? null,
        view,
        children: walk(node.lookup(PDFName.of("First")), depth + 1),
      });
      node = node.lookup(PDFName.of("Next"));
    }
    return result;
  };
  return walk(root.lookup(PDFName.of("First")), 0);
}

export function writeBookmarkTree(doc: PDFDocument, entries: EditableBookmark[]): void {
  if (!entries.length) {
    doc.catalog.delete(PDFName.of("Outlines"));
    return;
  }
  const root = doc.context.obj({ Type: "Outlines" });
  const rootRef = doc.context.register(root);
  let count = 0;
  const seen = new Set<EditableBookmark>();
  const write = (
    nodes: EditableBookmark[],
    parent: PDFRef,
    depth: number,
  ): { refs: PDFRef[]; count: number } => {
    if (depth > 32) throw new Error("Bookmark nesting exceeds 32 levels.");
    const dicts: PDFDict[] = [],
      refs: PDFRef[] = [];
    let descendants = 0;
    for (const node of nodes) {
      if (++count > 10000 || seen.has(node)) throw new Error("Invalid or oversized bookmark tree.");
      seen.add(node);
      if (!node.title.trim() || node.title.length > 1000)
        throw new Error("Bookmark titles must contain 1 to 1,000 characters.");
      const dict = doc.context.obj({ Title: PDFHexString.fromText(node.title), Parent: parent });
      if (node.page !== null) {
        if (!Number.isInteger(node.page) || node.page < 0 || node.page >= doc.getPageCount())
          throw new Error("Bookmark page is outside the document.");
        const view = node.view?.length ? node.view : ["Fit"];
        if (
          typeof view[0] !== "string" ||
          !["XYZ", "Fit", "FitH", "FitV", "FitR", "FitB", "FitBH", "FitBV"].includes(view[0]) ||
          view
            .slice(1)
            .some(
              (value) => value !== null && (typeof value !== "number" || !Number.isFinite(value)),
            )
        )
          throw new Error("Invalid bookmark view destination.");
        const destination = doc.context.obj([doc.getPage(node.page).ref, ...view]);
        dict.set(PDFName.of("Dest"), destination);
      }
      if (node.color) {
        if (
          node.color.length !== 3 ||
          !node.color.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
        )
          throw new Error("Invalid bookmark color.");
        dict.set(PDFName.of("C"), doc.context.obj(node.color));
      }
      if (node.flags !== undefined) dict.set(PDFName.of("F"), PDFNumber.of(node.flags));
      const ref = doc.context.register(dict);
      const children = write(node.children, ref, depth + 1);
      if (children.refs.length) {
        dict.set(PDFName.of("First"), children.refs[0]);
        dict.set(PDFName.of("Last"), children.refs[children.refs.length - 1]);
        dict.set(
          PDFName.of("Count"),
          PDFNumber.of(node.collapsed ? -children.count : children.count),
        );
      }
      descendants += children.count + 1;
      dicts.push(dict);
      refs.push(ref);
    }
    dicts.forEach((dict, i) => {
      if (i) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i + 1 < refs.length) dict.set(PDFName.of("Next"), refs[i + 1]);
    });
    return { refs, count: descendants };
  };
  const tree = write(entries, rootRef, 0);
  root.set(PDFName.of("First"), tree.refs[0]);
  root.set(PDFName.of("Last"), tree.refs[tree.refs.length - 1]);
  root.set(PDFName.of("Count"), PDFNumber.of(tree.count));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

export async function loadBookmarks(bytes: Uint8Array): Promise<EditableBookmark[]> {
  return readBookmarkTree(await PDFDocument.load(bytes));
}

export async function saveBookmarks(
  bytes: Uint8Array,
  entries: EditableBookmark[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  writeBookmarkTree(doc, entries);
  return doc.save({ updateFieldAppearances: false });
}

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  PDFHexString,
} from "pdf-lib";

function destinationArray(value: unknown): PDFArray | null {
  if (value instanceof PDFArray) return value;
  if (!(value instanceof PDFDict)) return null;
  const destination = value.lookup(PDFName.of("D"));
  return destination instanceof PDFArray ? destination : null;
}

function leafDestination(node: PDFDict, target: string): PDFArray | null {
  const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!names) return null;
  for (let i = 0; i + 1 < names.size(); i += 2) {
    const key = names.lookup(i);
    if (!(key instanceof PDFString || key instanceof PDFHexString)) continue;
    if (key.decodeText() === target) return destinationArray(names.lookup(i + 1));
  }
  return null;
}

function searchNameTree(root: PDFDict, target: string): PDFArray | null {
  const pending = [root];
  const visited = new Set<PDFDict>();
  while (pending.length) {
    const node = pending.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    if (visited.size > 10000) throw new Error("The destination name tree is too large.");
    const destination = leafDestination(node, target);
    if (destination) return destination;
    const children = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (!children) continue;
    // Reverse push preserves the name tree's original search order.
    for (let i = children.size() - 1; i >= 0; i--) {
      const child = children.lookup(i);
      if (child instanceof PDFDict && !visited.has(child)) pending.push(child);
    }
  }
  return null;
}

export function resolveNamedDestination(doc: PDFDocument, name: string): PDFArray | null {
  const destinations = doc.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
  const direct = destinationArray(destinations?.lookup(PDFName.of(name)));
  if (direct) return direct;
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const tree = names?.lookupMaybe(PDFName.of("Dests"), PDFDict);
  return tree ? searchNameTree(tree, name) : null;
}

export function resolveDestination(doc: PDFDocument, value: unknown): PDFArray | null {
  if (value instanceof PDFName || value instanceof PDFString || value instanceof PDFHexString)
    return resolveNamedDestination(doc, value.decodeText());
  return value instanceof PDFArray ? value : null;
}

function resolveTargetPage(
  doc: PDFDocument,
  value: unknown,
  pages: Map<string, number>,
): number | null {
  let destination = value;
  if (value instanceof PDFName) destination = resolveNamedDestination(doc, value.decodeText());
  else if (value instanceof PDFString || value instanceof PDFHexString) {
    destination = resolveNamedDestination(doc, value.decodeText());
  }
  if (!(destination instanceof PDFArray) || destination.size() === 0) return null;
  const first = destination.get(0);
  if (first instanceof PDFRef) return pages.get(first.toString()) ?? null;
  return first instanceof PDFNumber ? first.asNumber() : null;
}

function internalDestination(annotation: PDFDict) {
  const direct = annotation.lookup(PDFName.of("Dest"));
  if (direct) return direct;
  const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
  const kind = action?.lookupMaybe(PDFName.of("S"), PDFName);
  return kind?.asString() === "/GoTo" ? action?.lookup(PDFName.of("D")) : undefined;
}

function stripLinks(
  doc: PDFDocument,
  annotations: PDFArray,
  kept: Set<number>,
  pages: Map<string, number>,
) {
  let removed = 0;
  for (let i = annotations.size() - 1; i >= 0; i--) {
    const annotation = annotations.lookup(i);
    if (!(annotation instanceof PDFDict)) continue;
    if (annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() !== "/Link") continue;
    const destination = internalDestination(annotation);
    if (!destination) continue;
    const target = resolveTargetPage(doc, destination, pages);
    if (target !== null && kept.has(target)) continue;
    annotations.remove(i);
    removed++;
  }
  return removed;
}

/** Remove local links whose targets will not survive the page operation. */
export function stripExternalPageLinks(doc: PDFDocument, keptPages: Set<number>): number {
  const pages = doc.getPages();
  const pageRefToIdx = new Map(pages.map((page, index) => [page.ref.toString(), index]));
  let removed = 0;
  for (const [index, page] of pages.entries()) {
    if (!keptPages.has(index)) continue;
    const annotations = page.node.Annots();
    if (!annotations) continue;
    removed += stripLinks(doc, annotations, keptPages, pageRefToIdx);
    if (annotations.size() === 0) page.node.delete(PDFName.of("Annots"));
  }
  return removed;
}

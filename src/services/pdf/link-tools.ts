// Document-wide link maintenance: inventory, removal of every or only broken link, and links
// created from web addresses found in the text layer. New links only ever open http(s)
// addresses through the existing safe-URL policy; nothing is followed or launched here.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, PDFHexString } from "pdf-lib";
import type { PdfRect } from "../../types/engine";
import { validateSafeUrl } from "../document-commands.ts";
import { internalTargetPage } from "./link-targets.ts";
import { clampRectToBox, visibleBox } from "./page-box.ts";
import { pdfText } from "./text-string.ts";

export const MAX_NEW_LINKS = 5000;
const MAX_OUTLINE_NODES = 10_000;

export interface LinkInventory {
  total: number;
  web: number;
  internal: number;
  broken: number;
  other: number;
  brokenBookmarks: number;
}

export interface FoundUrl {
  page: number;
  rect: PdfRect;
  url: string;
}

const pageIndexes = (doc: PDFDocument) =>
  new Map(doc.getPages().map((page, index) => [page.ref.toString(), index]));

const isLink = (value: unknown): value is PDFDict =>
  value instanceof PDFDict &&
  value.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() === "/Link";

function uriOf(annotation: PDFDict) {
  const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
  if (action?.lookupMaybe(PDFName.of("S"), PDFName)?.asString() !== "/URI") return null;
  const uri = action.lookup(PDFName.of("URI"));
  return uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : "";
}

/** Each outline node once, guarding against cycles and oversized trees. */
function outlineNodes(doc: PDFDocument): PDFDict[] {
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const nodes: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const pending = [root?.lookup(PDFName.of("First"))];
  while (pending.length) {
    let node = pending.pop();
    while (node instanceof PDFDict && !seen.has(node)) {
      if (seen.size >= MAX_OUTLINE_NODES) throw new Error("The bookmark tree is too large.");
      seen.add(node);
      nodes.push(node);
      pending.push(node.lookup(PDFName.of("First")));
      node = node.lookup(PDFName.of("Next"));
    }
  }
  return nodes;
}

function brokenBookmarks(doc: PDFDocument, pages: Map<string, number>) {
  return outlineNodes(doc).filter((node) => internalTargetPage(doc, node, pages) === null);
}

export async function inspectLinks(bytes: Uint8Array): Promise<LinkInventory> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pageIndexes(doc);
  const result: LinkInventory = {
    total: 0,
    web: 0,
    internal: 0,
    broken: 0,
    other: 0,
    brokenBookmarks: brokenBookmarks(doc, pages).length,
  };
  for (const page of doc.getPages()) {
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      const link = doc.context.lookup(annotation);
      if (!isLink(link)) continue;
      result.total++;
      const target = internalTargetPage(doc, link, pages);
      if (target === null) result.broken++;
      else if (target !== undefined) result.internal++;
      else if (uriOf(link) !== null) result.web++;
      else result.other++;
    }
  }
  return result;
}

export interface LinkRemoval {
  bytes: Uint8Array;
  removedLinks: number;
  clearedBookmarks: number;
}

/**
 * Removes every link annotation, or only internal links and bookmark destinations that no
 * longer reach a page. Broken bookmarks keep their titles and children; only the dead
 * destination is cleared so no part of the outline disappears.
 */
export async function removeLinks(bytes: Uint8Array, mode: "all" | "broken"): Promise<LinkRemoval> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pageIndexes(doc);
  let removedLinks = 0;
  for (const page of doc.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let index = annotations.size() - 1; index >= 0; index--) {
      const link = annotations.lookup(index);
      if (!isLink(link)) continue;
      if (mode === "broken" && internalTargetPage(doc, link, pages) !== null) continue;
      annotations.remove(index);
      removedLinks++;
    }
    if (annotations.size() === 0) page.node.delete(PDFName.of("Annots"));
  }
  let clearedBookmarks = 0;
  if (mode === "broken") {
    for (const node of brokenBookmarks(doc, pages)) {
      node.delete(PDFName.of("Dest"));
      node.delete(PDFName.of("A"));
      clearedBookmarks++;
    }
  }
  if (!removedLinks && !clearedBookmarks)
    throw new Error(mode === "all" ? "This PDF has no links." : "No broken links were found.");
  return { bytes: await doc.save(), removedLinks, clearedBookmarks };
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`{}|\\^]+/gi;

/** Web addresses in one string with trailing sentence punctuation and unbalanced ")" removed. */
export function findUrls(text: string): { start: number; end: number; url: string }[] {
  const found: { start: number; end: number; url: string }[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    let value = match[0];
    while (/[.,;:!?'")\]]$/.test(value)) {
      if (value.endsWith(")") && value.split("(").length > value.split(")").length - 1) break;
      value = value.slice(0, -1);
    }
    const candidate = /^www\./i.test(value) ? `https://${value}` : value;
    const checked = validateSafeUrl(candidate);
    if (!checked.valid || !checked.normalizedUrl || !/^https?:/.test(checked.normalizedUrl))
      continue;
    if (!new URL(checked.normalizedUrl).hostname.includes(".")) continue;
    found.push({ start: match.index, end: match.index + value.length, url: checked.normalizedUrl });
  }
  return found;
}

const overlaps = (a: number[], b: number[]) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Adds a web link over each found address unless a link to it already covers that spot. */
export async function addUrlLinks(
  bytes: Uint8Array,
  found: FoundUrl[],
): Promise<{ bytes: Uint8Array; added: number }> {
  if (found.length > MAX_NEW_LINKS) throw new Error("Too many links to add at once.");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let added = 0;
  for (const entry of found) {
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > doc.getPageCount())
      throw new Error("A link page is outside the document.");
    const checked = validateSafeUrl(entry.url);
    if (!checked.valid || !checked.normalizedUrl) throw new Error("A link address is not allowed.");
    const page = doc.getPage(entry.page - 1);
    const rect = clampRectToBox(entry.rect, visibleBox(page));
    if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) continue;
    const existing = (page.node.Annots()?.asArray() ?? []).map((ref) => doc.context.lookup(ref));
    const covered = existing.some((link) => {
      if (!isLink(link) || uriOf(link) !== checked.normalizedUrl) return false;
      const box = link.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asRectangle();
      return box && overlaps([box.x, box.y, box.x + box.width, box.y + box.height], rect);
    });
    if (covered) continue;
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      F: 4,
      P: page.ref,
      A: { Type: "Action", S: "URI", URI: pdfText(checked.normalizedUrl) },
    });
    page.node.addAnnot(doc.context.register(link));
    added++;
  }
  if (!added) throw new Error("Every web address already has a link.");
  return { bytes: await doc.save(), added };
}

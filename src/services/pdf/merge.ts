import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFPage,
  PDFPageLeaf,
  PDFString,
} from "pdf-lib";
import type { MergeInputItem } from "../../types/operations";
import { readBookmarkTree, writeBookmarkTree, type EditableBookmark } from "./bookmarks.ts";
import { resolveDestination, stripExternalPageLinks } from "./link-targets.ts";

const name = PDFName.of;

function checkedFieldType(field: PDFDict, inheritedType?: string): string | undefined {
  if (field.has(name("AA")) || field.has(name("A")))
    throw new Error("Forms with automatic actions are not supported when combining.");
  const fieldType = field.lookupMaybe(name("FT"), PDFName)?.asString() ?? inheritedType;
  if (fieldType === "/Sig" && field.has(name("V")))
    throw new Error(
      "Combining signed PDFs would invalidate their signatures. Use unsigned copies.",
    );
  return fieldType;
}

function prepareFields(source: PDFDocument, kept: Set<number>): PDFDict | undefined {
  const form = source.catalog.lookupMaybe(name("AcroForm"), PDFDict);
  if (!form) return;
  if (form.has(name("XFA")) || form.has(name("CO")))
    throw new Error(
      "Combining XFA forms or calculated forms is not supported. The originals are unchanged.",
    );
  const selectedWidgets = new Set<PDFDict>();
  const allWidgets = new Set<PDFDict>();
  source.getPages().forEach((page, index) => {
    for (const item of page.node.Annots()?.asArray() ?? []) {
      const dict = source.context.lookup(item);
      if (
        !(dict instanceof PDFDict) ||
        dict.lookupMaybe(name("Subtype"), PDFName)?.asString() !== "/Widget"
      )
        continue;
      allWidgets.add(dict);
      if (kept.has(index)) selectedWidgets.add(dict);
    }
  });
  const seen = new Set<PDFDict>();
  const prune = (array: PDFArray, depth: number, inheritedType?: string) => {
    if (depth > 32) throw new Error("Form nesting exceeds 32 levels.");
    for (let i = array.size() - 1; i >= 0; i--) {
      const field = array.lookup(i);
      if (!(field instanceof PDFDict) || seen.has(field) || seen.size >= 10000)
        throw new Error("Invalid or oversized form field tree.");
      seen.add(field);
      const fieldType = checkedFieldType(field, inheritedType);
      const kids = field.lookupMaybe(name("Kids"), PDFArray);
      if (kids) {
        prune(kids, depth + 1, fieldType);
        if (!kids.size()) array.remove(i);
      } else if (allWidgets.has(field) && !selectedWidgets.has(field)) array.remove(i);
    }
  };
  const fields = form.lookupMaybe(name("Fields"), PDFArray);
  if (fields) prune(fields, 0);
  return form;
}

function copyFormResources(
  source: PDFDocument,
  target: PDFDocument,
  form: PDFDict,
  targetForm: PDFDict,
  copier: PDFObjectCopier,
  sourceIndex: number,
): Map<string, string> {
  const resourceNames = new Map<string, string>();
  const sourceResources = form.lookupMaybe(name("DR"), PDFDict);
  let targetResources = targetForm.lookupMaybe(name("DR"), PDFDict);
  if (!targetResources) {
    targetResources = target.context.obj({});
    targetForm.set(name("DR"), targetResources);
  }
  for (const [kind, value] of sourceResources?.entries() ?? []) {
    const resources = source.context.lookup(value);
    if (!(resources instanceof PDFDict)) throw new Error("Unsupported form resource dictionary.");
    let destination = targetResources.lookupMaybe(kind, PDFDict);
    if (!destination) {
      destination = target.context.obj({});
      targetResources.set(kind, destination);
    }
    for (const [key, resource] of resources.entries()) {
      const renamed = name(`Source${sourceIndex + 1}_${key.decodeText()}`);
      resourceNames.set(key.asString(), renamed.asString());
      destination.set(renamed, copier.copy(resource));
    }
  }
  return resourceNames;
}

function copyForm(
  source: PDFDocument,
  target: PDFDocument,
  form: PDFDict,
  copier: PDFObjectCopier,
  sourceIndex: number,
) {
  const targetForm = target.catalog.getOrCreateAcroForm().dict;
  if (form.lookup(name("NeedAppearances"))?.toString() === "true")
    targetForm.set(name("NeedAppearances"), target.context.obj(true));
  let fields = targetForm.lookupMaybe(name("Fields"), PDFArray);
  if (!fields) {
    fields = target.context.obj([]);
    targetForm.set(name("Fields"), fields);
  }
  const resourceNames = copyFormResources(source, target, form, targetForm, copier, sourceIndex);
  const rewriteAppearance = (value: unknown) => {
    if (!(value instanceof PDFString || value instanceof PDFHexString)) return undefined;
    return PDFString.of(
      value
        .decodeText()
        .replace(/\/[^\s<>()[\]{}%/]+/g, (token) => resourceNames.get(token) ?? token),
    );
  };
  const defaultAppearance = rewriteAppearance(form.lookup(name("DA")));
  const existingNames = new Set(
    fields.asArray().map((ref) => {
      const dict = target.context.lookup(ref, PDFDict);
      const title = dict.lookup(name("T"));
      return title instanceof PDFString || title instanceof PDFHexString ? title.decodeText() : "";
    }),
  );
  const visited = new Set<PDFDict>();
  const update = (field: PDFDict) => {
    if (visited.has(field)) return;
    visited.add(field);
    const appearance = rewriteAppearance(field.lookup(name("DA")));
    if (appearance) field.set(name("DA"), appearance);
    for (const kid of field.lookupMaybe(name("Kids"), PDFArray)?.asArray() ?? [])
      update(target.context.lookup(kid, PDFDict));
  };
  for (const ref of form.lookupMaybe(name("Fields"), PDFArray)?.asArray() ?? []) {
    const copied = copier.copy(ref);
    const field = target.context.lookup(copied, PDFDict);
    update(field);
    if (!field.has(name("DA")) && defaultAppearance) field.set(name("DA"), defaultAppearance);
    if (!field.has(name("Q")) && form.has(name("Q")))
      field.set(name("Q"), copier.copy(form.get(name("Q"))!));
    const title = field.lookup(name("T"));
    const originalName =
      title instanceof PDFString || title instanceof PDFHexString ? title.decodeText() : "field";
    let unique = originalName;
    let suffix = 1;
    while (
      [...existingNames].some(
        (existing) =>
          existing === unique ||
          existing.startsWith(`${unique}.`) ||
          unique.startsWith(`${existing}.`),
      )
    )
      unique = `Source${sourceIndex + 1}_${originalName}_${suffix++}`;
    existingNames.add(unique);
    field.set(name("T"), PDFHexString.fromText(unique));
    fields.push(copied);
  }
}

function normalizeLink(source: PDFDocument, pages: PDFPage[], dict: PDFDict): void {
  const action = dict.lookupMaybe(name("A"), PDFDict);
  let owner: PDFDict | undefined;
  if (dict.has(name("Dest"))) owner = dict;
  else if (action?.lookupMaybe(name("S"), PDFName)?.asString() === "/GoTo") owner = action;
  if (!owner) return;
  const key = owner === dict ? name("Dest") : name("D");
  const dest = resolveDestination(source, owner.lookup(key));
  if (!dest) return;
  const explicit = dest.clone();
  const page = explicit.get(0);
  if (page instanceof PDFNumber) explicit.set(0, pages[page.asNumber()].ref);
  owner.set(key, explicit);
}

function normalizeLinks(source: PDFDocument, kept: Set<number>) {
  stripExternalPageLinks(source, kept);
  const pages = source.getPages();
  for (const index of kept) {
    for (const annotation of pages[index].node.Annots()?.asArray() ?? []) {
      const dict = source.context.lookup(annotation, PDFDict);
      normalizeLink(source, pages, dict);
    }
  }
}

function remapBookmarks(
  nodes: EditableBookmark[],
  mapping: Map<number, number>,
  sourceIndex: number,
): EditableBookmark[] {
  return nodes.flatMap((node) => {
    const children = remapBookmarks(node.children, mapping, sourceIndex);
    const page = node.page === null ? null : mapping.get(node.page);
    if (page === undefined && !children.length) return [];
    return [{ ...node, id: `source-${sourceIndex}-${node.id}`, page: page ?? null, children }];
  });
}

function selectedPages(source: PDFDocument, ranges?: number[]): number[] {
  const selected = ranges?.length
    ? ranges.filter((i) => Number.isInteger(i) && i >= 0 && i < source.getPageCount())
    : source.getPageIndices();
  if (new Set(selected).size !== selected.length)
    throw new Error("Select each source page only once when preserving forms and bookmarks.");
  return selected;
}

export async function mergePreservingStructure(
  inputs: (Uint8Array | MergeInputItem)[],
): Promise<Uint8Array> {
  if (!inputs.length) throw new Error("At least one document is required to merge.");
  const target = await PDFDocument.create();
  const bookmarks: EditableBookmark[] = [];
  for (const [sourceIndex, input] of inputs.entries()) {
    const item = input instanceof Uint8Array ? { bytes: input } : input;
    const source = await PDFDocument.load(item.bytes);
    const selected = selectedPages(source, item.ranges);
    if (!selected.length) continue;
    const kept = new Set(selected);
    const offset = target.getPageCount();
    const mapping = new Map(selected.map((index, position) => [index, offset + position]));
    bookmarks.push(...remapBookmarks(readBookmarkTree(source), mapping, sourceIndex));
    const form = prepareFields(source, kept);
    normalizeLinks(source, kept);
    const copier = PDFObjectCopier.for(source.context, target.context);
    for (const index of selected) {
      const ref = copier.copy(source.getPage(index).ref);
      const node = target.context.lookup(ref);
      if (!(node instanceof PDFPageLeaf)) throw new Error("Invalid copied page.");
      target.addPage(PDFPage.of(node, ref, target));
    }
    if (form) copyForm(source, target, form, copier, sourceIndex);
  }
  if (!target.getPageCount()) throw new Error("No valid pages were selected to merge.");
  writeBookmarkTree(target, bookmarks);
  return target.save({ updateFieldAppearances: false });
}

// Show or hide form field actions on links, which PDF.js does not run. They are read from the
// document so the viewer can run them; nothing is executed from the PDF but this action.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import { annotationIdentifier } from "../document-commands.ts";

export interface HideAction {
  /** Fully qualified names of the fields the action shows or hides. */
  fields: string[];
  hide: boolean;
}

function text(value: unknown) {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

/** The full name of a field dictionary, joining its ancestors' partial names with dots. */
function fieldName(dict: PDFDict) {
  const parts: string[] = [];
  let current: PDFDict | undefined = dict;
  for (let depth = 0; current && depth < 32; depth++) {
    const partial = text(current.lookup(PDFName.of("T")));
    if (partial) parts.unshift(partial);
    const parent: unknown = current.lookup(PDFName.of("Parent"));
    current = parent instanceof PDFDict ? parent : undefined;
  }
  return parts.join(".");
}

function targets(doc: PDFDocument, value: unknown): string[] {
  const entries = value instanceof PDFArray ? value.asArray() : [value];
  return entries.flatMap((entry) => {
    const name = text(entry);
    if (name) return [name];
    const field = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
    return field instanceof PDFDict ? [fieldName(field)].filter(Boolean) : [];
  });
}

/** The show or hide action of one link annotation, or null for any other annotation. */
function hideActionOf(doc: PDFDocument, annotation: unknown): HideAction | null {
  if (!(annotation instanceof PDFDict)) return null;
  if (annotation.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) return null;
  const action = annotation.lookup(PDFName.of("A"));
  if (!(action instanceof PDFDict) || action.lookup(PDFName.of("S")) !== PDFName.of("Hide"))
    return null;
  const fields = targets(doc, action.lookup(PDFName.of("T")));
  if (!fields.length) return null;
  const hide = action.lookup(PDFName.of("H"));
  return { fields, hide: hide === undefined || String(hide) !== "false" };
}

/** Hide actions of link annotations by PDF.js annotation id, such as "12R". */
export async function readHideActions(bytes: Uint8Array) {
  const actions = new Map<string, HideAction>();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false }).catch(() => null);
  if (!doc) return actions;
  const entries = doc.getPages().flatMap((page) => page.node.Annots()?.asArray() ?? []);
  for (const entry of entries) {
    const action = entry instanceof PDFRef ? hideActionOf(doc, doc.context.lookup(entry)) : null;
    if (action) actions.set(annotationIdentifier(entry), action);
  }
  return actions;
}

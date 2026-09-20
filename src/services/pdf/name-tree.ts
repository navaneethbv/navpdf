import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef } from "pdf-lib";

export interface EmbeddedFileEntry {
  name: string;
  nameObj: PDFObject;
  fileSpec: PDFDict;
  fileSpecRef?: PDFRef;
  containingDict: PDFDict;
  indexInNames: number;
}

export function decodeNameTreeKey(keyObj: unknown): string {
  if (!keyObj) return "";
  if (typeof (keyObj as { decodeText?: () => string }).decodeText === "function") {
    return (keyObj as { decodeText: () => string }).decodeText();
  }
  if (typeof (keyObj as { asString?: () => string }).asString === "function") {
    return (keyObj as { asString: () => string }).asString();
  }
  if (typeof (keyObj as { value?: string }).value === "string") {
    return (keyObj as { value: string }).value;
  }
  return typeof keyObj === "string" ? keyObj : "";
}

/**
 * Traverses an EmbeddedFiles name tree in a PDF document.
 * Handles indirect references, multi-level /Kids balanced trees, and direct /Names leaves.
 */
export function walkEmbeddedFiles(doc: PDFDocument): EmbeddedFileEntry[] {
  const namesObj = doc.context.lookup(doc.catalog.get(PDFName.of("Names")));
  if (!(namesObj instanceof PDFDict)) return [];

  const efObj = doc.context.lookup(namesObj.get(PDFName.of("EmbeddedFiles")));
  if (!(efObj instanceof PDFDict)) return [];

  const results: EmbeddedFileEntry[] = [];
  const visited = new Set<PDFDict>();

  function traverse(node: PDFDict) {
    if (visited.has(node)) return;
    visited.add(node);

    const kids = doc.context.lookup(node.get(PDFName.of("Kids")));
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = doc.context.lookup(kids.get(i));
        if (kid instanceof PDFDict) {
          traverse(kid);
        }
      }
      return;
    }

    const names = doc.context.lookup(node.get(PDFName.of("Names")));
    if (names instanceof PDFArray) {
      for (let i = 0; i < names.size(); i += 2) {
        const keyItem = names.get(i);
        const valItem = names.get(i + 1);
        const keyResolved = doc.context.lookup(keyItem);
        const valResolved = doc.context.lookup(valItem);

        if (valResolved instanceof PDFDict) {
          const name = decodeNameTreeKey(keyResolved);
          results.push({
            name,
            nameObj: keyResolved as PDFObject,
            fileSpec: valResolved,
            fileSpecRef: valItem instanceof PDFRef ? valItem : undefined,
            containingDict: node,
            indexInNames: i,
          });
        }
      }
    }
  }

  traverse(efObj);
  return results;
}

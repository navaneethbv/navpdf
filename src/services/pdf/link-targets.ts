import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  PDFHexString,
} from "pdf-lib";

/**
 * Strips or rewrites Link annotations on kept pages that target pages outside the kept page set.
 * Returns the number of removed annotations.
 */
export function stripExternalPageLinks(
  doc: PDFDocument,
  keptPages: Set<number>,
): number {
  const pages = doc.getPages();
  const pageRefToIdx = new Map<string, number>();
  pages.forEach((p, idx) => {
    pageRefToIdx.set(p.ref.toString(), idx);
  });

  function resolveNamedDest(name: string): PDFArray | null {
    const catalog = doc.catalog;
    const dests = catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
    if (dests) {
      const destObj = dests.lookup(PDFName.of(name));
      if (destObj instanceof PDFArray) return destObj;
      if (destObj instanceof PDFDict) {
        const d = destObj.lookup(PDFName.of("D"));
        if (d instanceof PDFArray) return d;
      }
    }
    const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (names) {
      const destsTree = names.lookupMaybe(PDFName.of("Dests"), PDFDict);
      if (destsTree) {
        const destArray = searchNameTree(destsTree, name);
        if (destArray) return destArray;
      }
    }
    return null;
  }

  function searchNameTree(treeDict: PDFDict, targetName: string): PDFArray | null {
    const names = treeDict.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (names) {
      for (let i = 0; i < names.size(); i += 2) {
        const k = names.lookup(i);
        const nameStr =
          k instanceof PDFString || k instanceof PDFHexString
            ? k.asString()
            : "";
        if (nameStr === targetName) {
          const val = names.lookup(i + 1);
          if (val instanceof PDFArray) return val;
          if (val instanceof PDFDict) {
            const d = val.lookup(PDFName.of("D"));
            if (d instanceof PDFArray) return d;
          }
        }
      }
    }
    const kids = treeDict.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i, PDFDict);
        if (kid) {
          const res = searchNameTree(kid, targetName);
          if (res) return res;
        }
      }
    }
    return null;
  }

  function resolveTargetPageIndex(destObj: unknown): number | null {
    if (destObj instanceof PDFArray && destObj.size() > 0) {
      const first = destObj.get(0);
      if (first instanceof PDFRef) {
        return pageRefToIdx.get(first.toString()) ?? null;
      }
      if (
        typeof (first as unknown as { asNumber?: () => number }).asNumber === "function"
      ) {
        return (first as unknown as { asNumber: () => number }).asNumber();
      }
    }
    if (
      destObj instanceof PDFName ||
      destObj instanceof PDFString ||
      destObj instanceof PDFHexString
    ) {
      const name =
        destObj instanceof PDFName
          ? destObj.asString().replace(/^\//, "")
          : destObj.asString();
      const resolved = resolveNamedDest(name);
      if (resolved) {
        return resolveTargetPageIndex(resolved);
      }
    }
    return null;
  }

  let removedCount = 0;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    if (!keptPages.has(pageIdx)) continue;
    const page = pages[pageIdx];
    const annots = page.node.Annots();
    if (!annots || !(annots instanceof PDFArray)) continue;

    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookup(i, PDFDict);
      if (!annot) continue;
      const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName);
      if (subtype?.asString() !== "/Link") continue;

      let targetIdx: number | null = null;
      let isInternalPageLink = false;

      const dest = annot.lookup(PDFName.of("Dest"));
      if (dest) {
        targetIdx = resolveTargetPageIndex(dest);
        isInternalPageLink = true;
      }

      if (!isInternalPageLink) {
        const action = annot.lookupMaybe(PDFName.of("A"), PDFDict);
        if (action) {
          const s = action.lookupMaybe(PDFName.of("S"), PDFName);
          if (s?.asString() === "/GoTo") {
            const d = action.lookup(PDFName.of("D"));
            if (d) {
              targetIdx = resolveTargetPageIndex(d);
              isInternalPageLink = true;
            }
          }
        }
      }

      if (isInternalPageLink) {
        if (targetIdx === null || !keptPages.has(targetIdx)) {
          annots.remove(i);
          removedCount++;
        }
      }
    }

    if (annots.size() === 0) {
      page.node.delete(PDFName.of("Annots"));
    }
  }

  return removedCount;
}

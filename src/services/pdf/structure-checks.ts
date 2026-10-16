import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import type { AccessibilityCheck } from "./accessibility";

interface Element {
  dict: PDFDict;
  role: string;
  parent: Element | null;
  children: Element[];
}

function string(dict: PDFDict, key: string) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText().trim()
    : "";
}

/** Walk only structure children, never parent links; reject cycles and truncated trees. */
function structure(doc: PDFDocument) {
  const root = doc.catalog.lookup(PDFName.of("StructTreeRoot"));
  if (!(root instanceof PDFDict)) return null;
  const map = root.lookup(PDFName.of("RoleMap"));
  const elements: Element[] = [];
  const seen = new Set<PDFDict>();
  let incomplete = false;
  const pending: { dict: PDFDict; parent: Element | null; depth: number }[] = [
    { dict: root, parent: null, depth: 0 },
  ];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 128 || seen.has(item.dict) || elements.length >= 20000) {
      incomplete = true;
      if (elements.length >= 20000) break;
      continue;
    }
    seen.add(item.dict);
    const name = item.dict.lookup(PDFName.of("S"));
    let role = name instanceof PDFName ? name.decodeText() : "";
    if (item.dict !== root && !role) incomplete = true;
    const roles = new Set<string>();
    while (role && map instanceof PDFDict && map.has(PDFName.of(role))) {
      if (roles.has(role)) {
        incomplete = true;
        break;
      }
      roles.add(role);
      const mapped = map.lookup(PDFName.of(role));
      if (!(mapped instanceof PDFName)) {
        incomplete = true;
        break;
      }
      role = mapped.decodeText();
    }
    const element: Element = { dict: item.dict, role, parent: item.parent, children: [] };
    if (role) {
      elements.push(element);
      item.parent?.children.push(element);
    }
    const children = item.dict.lookup(PDFName.of("K"));
    const kids = children instanceof PDFArray ? children.asArray() : [children];
    for (const ref of kids.reverse()) {
      const kid = ref ? doc.context.lookup(ref) : undefined;
      if (kid instanceof PDFDict) {
        const type = kid.lookup(PDFName.of("Type"));
        if (type === PDFName.of("MCR") || type === PDFName.of("OBJR")) continue;
        pending.push({ dict: kid, parent: role ? element : item.parent, depth: item.depth + 1 });
      }
    }
  }
  return { elements, incomplete };
}

export function checkStructure(doc: PDFDocument): AccessibilityCheck[] {
  const tree = structure(doc);
  if (!tree) return [];
  const { elements, incomplete } = tree;
  const checks: AccessibilityCheck[] = [];
  const result = (id: string, label: string, bad: number, detail: string) =>
    checks.push({
      id,
      label,
      status: bad ? "failed" : incomplete ? "warning" : "passed",
      detail: bad
        ? `${bad} issue(s). ${detail}`
        : incomplete
          ? "The structure tree is incomplete or malformed; this check could not finish."
          : detail,
    });
  result(
    "structure-integrity",
    "Structure tree can be inspected",
    Number(incomplete),
    "Cycles, excessive depth or more than 20,000 elements prevent a complete inspection.",
  );
  let heading = 0;
  let skippedHeadings = 0;
  for (const element of elements) {
    if (/^H[1-6]$/.test(element.role)) {
      const level = Number(element.role[1]);
      if (level > heading + 1) skippedHeadings++;
      heading = level;
    }
  }
  result(
    "heading-nesting",
    "Heading levels do not skip",
    skippedHeadings,
    "Check that heading levels follow the document's logical outline.",
  );
  const lists = elements.filter((element) => element.role === "L");
  result(
    "list-items",
    "Lists contain list items",
    lists.filter(
      (list) => !list.children.length || list.children.some((child) => child.role !== "LI"),
    ).length,
    "Lists should contain LI elements.",
  );
  const items = elements.filter((element) => element.role === "LI");
  result(
    "list-bodies",
    "List items have bodies",
    items.filter(
      (item) =>
        item.children.filter((child) => child.role === "LBody").length !== 1 ||
        item.children.some((child) => !["Lbl", "LBody"].includes(child.role)),
    ).length,
    "Each LI needs one LBody and optional Lbl content.",
  );
  const tables = elements.filter((element) => element.role === "Table");
  const rows = elements.filter((element) => element.role === "TR");
  result(
    "table-rows",
    "Tables contain rows or row groups",
    tables.filter(
      (table) =>
        !table.children.length ||
        table.children.some(
          (child) => !["TR", "THead", "TBody", "TFoot", "Caption"].includes(child.role),
        ),
    ).length,
    "Tables need TR rows, optionally inside THead, TBody or TFoot groups.",
  );
  result(
    "table-cells",
    "Table rows contain cells",
    rows.filter(
      (row) =>
        !row.children.length || row.children.some((child) => !["TH", "TD"].includes(child.role)),
    ).length,
    "Every TR must contain TH or TD cells.",
  );
  const tablesWithHeaders = new Set<Element>();
  for (const element of elements) {
    if (element.role !== "TH") continue;
    let parent = element.parent;
    while (parent && parent.role !== "Table") parent = parent.parent;
    if (parent) tablesWithHeaders.add(parent);
  }
  result(
    "table-headers",
    "Tables have header cells",
    tables.filter((table) => !tablesWithHeaders.has(table)).length,
    "Confirm that header associations describe the data correctly.",
  );
  checks.push({
    id: "table-regularity",
    label: "Table grid and header associations",
    status: "manual",
    detail: "Check row and column spans, headers and reading order with assistive technology.",
  });
  const alt = elements.filter((element) => string(element.dict, "Alt"));
  result(
    "nested-alt",
    "Alternate text is not nested",
    alt.filter((element) => {
      let parent = element.parent;
      while (parent) {
        if (string(parent.dict, "Alt")) return true;
        parent = parent.parent;
      }
      return false;
    }).length,
    "Nested alternate text can hide content from assistive technology.",
  );
  result(
    "other-alt",
    "Formulas have alternate text",
    elements.filter(
      (element) =>
        element.role === "Formula" &&
        !string(element.dict, "Alt") &&
        !string(element.dict, "ActualText"),
    ).length,
    "Formula elements need a textual equivalent.",
  );
  return checks;
}

/** Escapes all PDF-supplied content; the report contains no scripts or remote resources. */
export function accessibilityReport(checks: AccessibilityCheck[], title: string) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Accessibility report</title><body><h1>${escape(title || "Accessibility report")}</h1><p>Automatic checks do not establish accessibility or PDF/UA compliance. Manual review is required.</p><table><caption>Accessibility checks</caption><thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody>${checks.map((check) => `<tr><th scope="row">${escape(check.label)}</th><td>${escape(check.status)}</td><td>${escape(check.detail)}</td></tr>`).join("")}</tbody></table></body></html>`;
}

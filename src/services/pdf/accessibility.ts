// An accessibility check modelled on common PDF/UA and WCAG requirements that can be verified
// from the file. Passing these checks does not make a document accessible: reading order,
// contrast, meaningful alternate text and heading structure still need human review.

import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";

export type CheckStatus = "passed" | "failed" | "warning" | "manual";

export interface AccessibilityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Present when NavPDF can fix the problem in this document. */
  fix?: "title" | "display-title" | "language" | "tab-order";
}

export interface PageFacts {
  /** Whether each page has text in its text layer, from PDF.js. */
  hasText: boolean[];
  /** PDF.js permission flags, or null when the document is not restricted. */
  permissions: number[] | null;
}

/** PDF.js PermissionFlag.COPY_FOR_ACCESSIBILITY. */
const ACCESSIBILITY_PERMISSION = 512;
const MAX_LISTED = 8;
/** Structure trees deeper than this are treated as malformed. */
const MAX_DEPTH = 256;

function textOf(dict: PDFDict, key: string) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText().trim()
    : "";
}

function listPages(pages: number[]) {
  const shown = pages.slice(0, MAX_LISTED).join(", ");
  return pages.length > MAX_LISTED ? `${shown} and ${pages.length - MAX_LISTED} more` : shown;
}

function isTagged(doc: PDFDocument) {
  const markInfo = doc.catalog.lookup(PDFName.of("MarkInfo"));
  const marked = markInfo instanceof PDFDict && markInfo.get(PDFName.of("Marked")) === PDFBool.True;
  return marked && doc.catalog.lookup(PDFName.of("StructTreeRoot")) instanceof PDFDict;
}

/** Counts Figure structure elements and those without alternate or actual text. */
function figures(doc: PDFDocument) {
  const result = { total: 0, missing: 0 };
  const root = doc.catalog.lookup(PDFName.of("StructTreeRoot"));
  if (!(root instanceof PDFDict)) return result;
  const seen = new Set<PDFDict>();
  const stack: { node: PDFDict; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (seen.has(node) || depth > MAX_DEPTH) continue;
    seen.add(node);
    if (node.get(PDFName.of("S")) === PDFName.of("Figure")) {
      result.total++;
      if (!textOf(node, "Alt") && !textOf(node, "ActualText")) result.missing++;
    }
    for (const child of childElements(doc, node)) stack.push({ node: child, depth: depth + 1 });
  }
  return result;
}

/** Structure elements below a node; marked-content and object references are skipped. */
function childElements(doc: PDFDocument, node: PDFDict): PDFDict[] {
  const kids = node.lookup(PDFName.of("K"));
  const children = kids instanceof PDFArray ? kids.asArray() : [kids];
  return children.flatMap((child) => {
    const resolved = child ? doc.context.lookup(child) : undefined;
    return resolved instanceof PDFDict ? [resolved] : [];
  });
}

function annotationsOf(doc: PDFDocument, pageIndex: number) {
  const annots = doc.getPage(pageIndex).node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return [];
  return annots
    .asArray()
    .map((ref) => doc.context.lookup(ref))
    .filter((item): item is PDFDict => item instanceof PDFDict);
}

const subtypeOf = (dict: PDFDict) => dict.get(PDFName.of("Subtype"));

function check(
  id: string,
  label: string,
  passed: boolean,
  detail: { pass: string; fail: string },
  extra: Partial<AccessibilityCheck> = {},
): AccessibilityCheck {
  return {
    id,
    label,
    status: passed ? "passed" : "failed",
    detail: passed ? detail.pass : detail.fail,
    ...(passed ? {} : extra),
  };
}

function structureChecks(doc: PDFDocument): AccessibilityCheck[] {
  const tagged = isTagged(doc);
  const figureCount = figures(doc);
  return [
    check("tagged", "Tagged PDF", tagged, {
      pass: "The document has a structure tree for assistive technology.",
      fail: "The document is not tagged. Export it again with tags from the authoring application; NavPDF cannot add tags.",
    }),
    {
      id: "figures",
      label: "Figures have alternate text",
      status: figureCount.missing ? "failed" : "passed",
      detail: tagged
        ? `${figureCount.total - figureCount.missing} of ${figureCount.total} tagged figure(s) have alternate text.`
        : "Figures can only carry alternate text in a tagged document.",
      ...(tagged ? {} : { status: "manual" as const }),
    },
  ];
}

function documentChecks(doc: PDFDocument): AccessibilityCheck[] {
  const title = doc.getTitle()?.trim() ?? "";
  const preferences = doc.catalog.lookup(PDFName.of("ViewerPreferences"));
  const displayTitle =
    preferences instanceof PDFDict &&
    preferences.get(PDFName.of("DisplayDocTitle")) === PDFBool.True;
  const language = textOf(doc.catalog, "Lang");
  return [
    check(
      "title",
      "Document title",
      Boolean(title),
      { pass: `The title is “${title}”.`, fail: "The document has no title." },
      { fix: "title" },
    ),
    check(
      "display-title",
      "Title shown instead of file name",
      displayTitle,
      {
        pass: "Readers show the title in the window title.",
        fail: "Readers show the file name instead of the title.",
      },
      { fix: "display-title" },
    ),
    check(
      "language",
      "Document language",
      Boolean(language),
      {
        pass: `The language is ${language}.`,
        fail: "No language is set, so screen readers may mispronounce the text.",
      },
      { fix: "language" },
    ),
  ];
}

function pageChecks(doc: PDFDocument, facts: PageFacts): AccessibilityCheck[] {
  const imageOnly = facts.hasText.flatMap((has, index) => (has ? [] : [index + 1]));
  const needsTabs = doc
    .getPages()
    .flatMap((page, index) =>
      annotationsOf(doc, index).length && page.node.get(PDFName.of("Tabs")) !== PDFName.of("S")
        ? [index + 1]
        : [],
    );
  const linkAnnotations = doc
    .getPageIndices()
    .flatMap((index) => annotationsOf(doc, index))
    .filter((annotation) => subtypeOf(annotation) === PDFName.of("Link"));
  const links = linkAnnotations.length;
  const undescribedLinks = linkAnnotations.filter((link) => !textOf(link, "Contents")).length;
  const untitledFields = doc
    .getForm()
    .getFields()
    .filter((field) => !textOf(field.acroField.dict, "TU"))
    .map((field) => field.getName());
  return [
    check("text", "Pages have real text", !imageOnly.length, {
      pass: "Every page has a text layer.",
      fail: `Page(s) ${listPages(imageOnly)} contain no text. Run Scan & OCR so they can be read aloud and searched.`,
    }),
    check(
      "tab-order",
      "Tab order follows structure",
      !needsTabs.length,
      {
        pass: "Pages with links, comments or fields use structure tab order.",
        fail: `Page(s) ${listPages(needsTabs)} do not specify a tab order.`,
      },
      { fix: "tab-order" },
    ),
    check("field-tooltips", "Form fields have descriptions", !untitledFields.length, {
      pass: "Every form field has a tooltip that screen readers announce.",
      fail: `${untitledFields.length} field(s), such as “${untitledFields[0] ?? ""}”, have no tooltip. Add one in the authoring application.`,
    }),
    {
      ...check("link-text", "Links have descriptions", !undescribedLinks, {
        pass: links ? "Every link has a description." : "The document has no links.",
        fail: `${undescribedLinks} of ${links} link(s) have no description.`,
      }),
      ...(undescribedLinks ? { status: "warning" as const } : {}),
    },
  ];
}

function securityChecks(doc: PDFDocument, facts: PageFacts): AccessibilityCheck[] {
  const restricted =
    facts.permissions !== null && !facts.permissions.includes(ACCESSIBILITY_PERMISSION);
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"));
  const long = doc.getPageCount() > 20;
  return [
    check("security", "Assistive technology allowed", !restricted, {
      pass: "Security settings let screen readers access the text.",
      fail: "Security settings block screen readers from reading the text.",
    }),
    {
      id: "bookmarks",
      label: "Bookmarks for long documents",
      status: !long || outlines instanceof PDFDict ? "passed" : "warning",
      detail: long
        ? "Documents over 20 pages should have bookmarks for navigation."
        : "Bookmarks are optional for documents of 20 pages or fewer.",
    },
    {
      id: "manual",
      label: "Reading order, contrast and headings",
      status: "manual",
      detail: "Check these by reading with a screen reader; they cannot be verified automatically.",
    },
  ];
}

export function checkAccessibility(doc: PDFDocument, facts: PageFacts): AccessibilityCheck[] {
  return [
    ...structureChecks(doc),
    ...documentChecks(doc),
    ...pageChecks(doc, facts),
    ...securityChecks(doc, facts),
  ];
}

export async function checkAccessibilityBytes(pdfBytes: Uint8Array, facts: PageFacts) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  return {
    checks: checkAccessibility(doc, facts),
    title: doc.getTitle() ?? "",
    language: textOf(doc.catalog, "Lang"),
  };
}

export interface AccessibilityFixes {
  title?: string;
  language?: string;
  displayTitle?: boolean;
  tabOrder?: boolean;
}

/** BCP 47 tags such as en, en-US or zh-Hant-TW. */
export const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z\d]{2,8})*$/;

/** Applies the fixes NavPDF can make: title, title display, language and tab order. */
export async function fixAccessibility(
  pdfBytes: Uint8Array,
  fixes: AccessibilityFixes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  if (fixes.title !== undefined) {
    const title = fixes.title.trim();
    if (!title) throw new Error("Enter a document title.");
    doc.setTitle(title, { showInWindowTitleBar: fixes.displayTitle ?? true });
  } else if (fixes.displayTitle) {
    doc.setTitle(doc.getTitle() ?? "", { showInWindowTitleBar: true });
  }
  if (fixes.language !== undefined) {
    const language = fixes.language.trim();
    if (!LANGUAGE_TAG.test(language))
      throw new Error("Enter a language code such as en, en-US or fr-CA.");
    doc.setLanguage(language);
  }
  if (fixes.tabOrder)
    for (const [index, page] of doc.getPages().entries())
      if (annotationsOf(doc, index).length) page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
  return doc.save();
}

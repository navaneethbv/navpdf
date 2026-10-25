// Pure helpers for the Tags dialog: filtering the listed tree and reading a tag's text.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TagNode } from "../../types/engine";

type TextItem = { str: string } | { type: string; id?: string | null };

/** How far an item moves the depth inside wanted marked content: in, out or not at all. */
function depthChange(item: TextItem, depth: number, wanted: string[]) {
  if ("str" in item) return 0;
  if (item.type === "endMarkedContent") return depth > 0 ? -1 : 0;
  if (item.type !== "beginMarkedContent" && item.type !== "beginMarkedContentProps") return 0;
  const id = item.type === "beginMarkedContentProps" ? (item.id ?? "") : "";
  return depth > 0 || wanted.some((suffix) => id.endsWith(suffix)) ? 1 : 0;
}

/** Text inside a tag's marked content on its page, read through PDF.js. */
export async function tagText(pdf: PDFDocumentProxy, node: TagNode) {
  if (!node.page || !node.mcids.length) return "";
  const page = await pdf.getPage(node.page);
  const content = await page.getTextContent({ includeMarkedContent: true });
  // PDF.js names marked content with an MCID "<page>_mc<MCID>".
  const wanted = node.mcids.map((mcid) => `_mc${mcid}`);
  const parts: string[] = [];
  let depth = 0;
  for (const item of content.items as TextItem[]) {
    if ("str" in item && depth > 0) parts.push(item.str);
    depth += depthChange(item, depth, wanted);
  }
  return parts.join(" ").replaceAll(/\s+/g, " ").trim();
}

/** Tags matching the filter with their ancestors, or every tag outside collapsed ones. */
export function visibleTags(nodes: TagNode[], filter: string, collapsed: Set<string>) {
  const query = filter.trim().toLowerCase();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (query) {
    const shown = new Set<string>();
    for (const node of nodes) {
      const matches =
        node.role.toLowerCase().includes(query) || node.title.toLowerCase().includes(query);
      if (!matches) continue;
      let current: TagNode | undefined = node;
      while (current && !shown.has(current.id)) {
        shown.add(current.id);
        current = current.parent ? byId.get(current.parent) : undefined;
      }
    }
    return nodes.filter((node) => shown.has(node.id));
  }
  return nodes.filter((node) => {
    let parent = node.parent ? byId.get(node.parent) : undefined;
    while (parent) {
      if (collapsed.has(parent.id)) return false;
      parent = parent.parent ? byId.get(parent.parent) : undefined;
    }
    return true;
  });
}

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

describe("external link addresses", () => {
  it("keeps the address of a disabled link so a click can ask before opening it", async () => {
    // The viewer module reads PDF.js from the page, as it does in the application bundle.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    (globalThis as { pdfjsLib?: unknown }).pdfjsLib ??= pdfjs;
    const { EventBus } = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
    const { HistoryLinkService } = await import("../../src/features/viewer/controller");

    const links = new HistoryLinkService({ eventBus: new EventBus() });
    links.externalLinkEnabled = false;
    const anchor = document.createElement("a");
    links.addLinkAttributes(anchor, "https://user:secret@example.org/report?page=2");

    // PDF.js blanks the href of a disabled link, so nothing navigates on its own.
    expect(anchor.getAttribute("href")).toBe("");
    expect(anchor.dataset.externalUrl).toBe("https://user:secret@example.org/report?page=2");
    // The tooltip shows the address without credentials or the "Disabled" prefix.
    expect(anchor.title).toBe("https://example.org/report?page=2");
  });
});

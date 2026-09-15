import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import {
  applyDocumentDecorations,
  removeDocumentDecorations,
  applyBatesNumbering,
} from "../../src/services/document-commands";

async function streamsOfFirstPage(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const refs =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : [contents];
  return refs.map((ref) => {
    const stream = doc.context.lookup(ref) as PDFRawStream;
    return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
  });
}

async function pageWithBody(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("ORIGINAL BODY", { x: 72, y: 700, size: 24, font });
  return doc.save();
}

describe("decorations content safety (DS-01)", () => {
  it("keeps original content across repeated decoration apply and removal", async () => {
    const base = await pageWithBody();
    const once = await applyDocumentDecorations(base, {
      footer: { center: "Page {page}" },
    });
    const twice = await applyDocumentDecorations(once, {
      footer: { center: "Changed {page}" },
    });
    const removed = await removeDocumentDecorations(twice);

    for (const bytes of [once, twice, removed]) {
      const streams = await streamsOfFirstPage(bytes);
      expect(streams.some((s) => s.includes("72 700"))).toBe(true);
    }
    const hasChanged = (s: string) => s.includes("Changed") || s.includes("4368616E676564");
    expect((await streamsOfFirstPage(twice)).filter(hasChanged).length).toBe(1);
    expect((await streamsOfFirstPage(removed)).some(hasChanged)).toBe(false);
  });

  it("keeps original content across Bates apply and removal", async () => {
    const base = await pageWithBody();
    const result = await applyBatesNumbering(base, {
      prefix: "ABC",
      startNumber: 1,
      padding: 6,
      position: "bottom-right",
    });
    const streamsAfterApply = await streamsOfFirstPage(result.bytes);
    expect(streamsAfterApply.some((s) => s.includes("72 700"))).toBe(true);

    const removed = await removeDocumentDecorations(result.bytes);
    const streamsAfterRemove = await streamsOfFirstPage(removed);
    expect(streamsAfterRemove.some((s) => s.includes("72 700"))).toBe(true);
  });

  it("handles header/footer token replacements with patterns like $&, $1, $$ safely", async () => {
    const base = await pageWithBody();
    const docWithMeta = await PDFDocument.load(base);
    docWithMeta.setTitle("Price $100 & $& Special");
    docWithMeta.setAuthor("User $1 and $$");
    const metaBytes = await docWithMeta.save();

    const decorated = await applyDocumentDecorations(metaBytes, {
      header: { left: "{title}" },
      footer: { right: "{author}" },
    });

    const streams = await streamsOfFirstPage(decorated);
    const hexToAscii = (str: string) =>
      str.replace(/<([0-9A-Fa-f]+)>/g, (_, hex) => Buffer.from(hex, "hex").toString("latin1"));
    const textCombined = streams.map(hexToAscii).join("\n");
    expect(textCombined).toContain("Price $100 & $& Special");
    expect(textCombined).toContain("User $1 and $$");
  });

  it("rejects non-WinAnsi characters in decorations", async () => {
    const base = await pageWithBody();
    await expect(
      applyDocumentDecorations(base, {
        watermark: { text: "Watermark 日本語" },
      }),
    ).rejects.toThrow("Unsupported characters for standard PDF fonts");

    await expect(
      applyDocumentDecorations(base, {
        header: { center: "Draft 🚀" },
      }),
    ).rejects.toThrow("Unsupported characters for standard PDF fonts");
  });

  it("rejects non-WinAnsi characters in Bates numbering prefix/suffix", async () => {
    const base = await pageWithBody();
    await expect(
      applyBatesNumbering(base, {
        prefix: "ケース-",
      }),
    ).rejects.toThrow("Unsupported characters for standard PDF fonts");

    await expect(
      applyBatesNumbering(base, {
        suffix: "-🔥",
      }),
    ).rejects.toThrow("Unsupported characters for standard PDF fonts");
  });
});

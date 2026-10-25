import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

// Native steps are replaced by recorders; the pdf-lib steps run for real.
const engine = vi.hoisted(() => ({
  compressDocument: vi.fn(),
  editStandards: vi.fn(),
  editTags: vi.fn(),
  readTags: vi.fn(),
  newJobId: () => "job",
}));
vi.mock("../../src/services/engine", () => engine);
const ocr = vi.hoisted(() => ({ ocrFile: vi.fn() }));
vi.mock("../../src/features/ocr/OcrBatchDialog", () => ocr);

import {
  BUILT_IN_ACTIONS,
  describeStep,
  newStep,
  runAction,
} from "../../src/features/actions/run-action";
import type { SavedAction } from "../../src/types/document";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function source() {
  const doc = await PDFDocument.create();
  doc.setTitle("Synthetic report");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ["First page", "Second page"]) {
    doc.addPage([400, 400]).drawText(text, { x: 40, y: 300, size: 14, font });
  }
  const form = doc.getForm();
  form.createTextField("name").addToPage(doc.getPage(0), { x: 40, y: 200, width: 120, height: 20 });
  form.getTextField("name").setText("Ada");
  return doc.save();
}

async function pageTexts(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  try {
    const pages = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    return await Promise.all(
      pages.map(async (page) => {
        const content = await (await pdf.getPage(page)).getTextContent();
        return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      }),
    );
  } finally {
    await task.destroy();
  }
}

const context = () => ({
  name: "report.pdf",
  cancelled: () => false,
  onProgress: vi.fn(),
  onStep: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guided actions", () => {
  it("chains real steps: watermark, header and footer, properties and flattening", async () => {
    const action: SavedAction = {
      id: "a",
      name: "Publish",
      steps: [
        { kind: "watermark", text: "CONFIDENTIAL", opacity: 0.3, fontSize: 40 },
        { kind: "headerFooter", header: "{title}", footer: "Page {page} of {total}" },
        {
          kind: "metadata",
          title: "",
          author: "Synthetic Author",
          subject: "",
          keywords: "alpha, beta",
        },
        { kind: "flatten" },
      ],
    };
    const run = context();
    const result = await runAction(await source(), action, run);
    expect(run.onStep.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3]);
    const texts = await pageTexts(result.bytes);
    expect(texts[0]).toContain("CONFIDENTIAL");
    expect(texts[0]).toContain("Synthetic report");
    expect(texts[1]).toContain("Page 2 of 2");
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getAuthor()).toBe("Synthetic Author");
    expect(doc.getTitle()).toBe("Synthetic report");
    expect(doc.getKeywords()).toBe("alpha beta");
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(texts[0]).toContain("Ada");
  });

  it("passes each native step the previous output and records notes", async () => {
    const marked = (tag: number) => new Uint8Array([37, 80, 68, 70, tag]);
    engine.compressDocument
      .mockResolvedValueOnce({ bytes: marked(1) })
      .mockResolvedValueOnce({ bytes: null });
    ocr.ocrFile.mockResolvedValue({ bytes: marked(2), pages: 1, skipped: 0, name: "x" });
    engine.readTags.mockResolvedValue({ tagged: true, nodes: [], truncated: false });
    engine.editStandards.mockResolvedValue({ bytes: marked(3), report: { message: "ok" } });
    const action: SavedAction = {
      id: "b",
      name: "Native",
      steps: [
        { kind: "removeHidden" },
        { kind: "ocr", language: "en-US", skipTextPages: true },
        { kind: "compress", preset: "small" },
        { kind: "autotag" },
        { kind: "pdfa", level: "3b" },
      ],
    };
    const result = await runAction(marked(0), action, context());
    expect(engine.compressDocument.mock.calls[0][0]).toEqual(marked(0));
    expect(engine.compressDocument.mock.calls[0][1]).toBe("lossless");
    expect(engine.compressDocument.mock.calls[0][3]).toMatchObject({
      javascript: true,
      comments: false,
    });
    const ocrInput = new Uint8Array(await (ocr.ocrFile.mock.calls[0][0] as File).arrayBuffer());
    expect(ocrInput).toEqual(marked(1));
    expect(engine.compressDocument.mock.calls[1][0]).toEqual(marked(2));
    expect(engine.editTags).not.toHaveBeenCalled();
    expect(engine.editStandards).toHaveBeenCalledWith(marked(2), {
      action: "convert",
      level: "3b",
    });
    expect(result.bytes).toEqual(marked(3));
    expect(result.notes).toEqual([
      "Reduce file size: Already compact; left as it was.",
      "Tag for accessibility: Already tagged; left as it was.",
    ]);
  });

  it("names the failing step and stops when cancelled", async () => {
    engine.editStandards.mockRejectedValue(new Error("Every font must be embedded."));
    const action: SavedAction = {
      id: "c",
      name: "Archive",
      steps: [{ kind: "flatten" }, { kind: "pdfa", level: "2b" }],
    };
    await expect(runAction(await source(), action, context())).rejects.toThrow(
      "Step 2, Convert to PDF/A: Every font must be embedded.",
    );
    await expect(
      runAction(await source(), action, { ...context(), cancelled: () => true }),
    ).rejects.toThrow("cancelled");
  });

  it("describes every built-in step and new steps start valid", () => {
    for (const action of BUILT_IN_ACTIONS)
      for (const step of action.steps) expect(describeStep(step).length).toBeGreaterThan(10);
    expect(newStep("ocr", "fr-FR")).toEqual({
      kind: "ocr",
      language: "fr-FR",
      skipTextPages: true,
    });
    expect(describeStep(newStep("metadata", "en"))).toBe(
      "Leaves the document properties as they are.",
    );
  });
});

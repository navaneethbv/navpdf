// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  ENGINE_UNAVAILABLE: "desktop only",
  newJobId: vi.fn(() => "job-1"),
  cancelEngineJob: vi.fn(async () => {}),
  redactDocument: vi.fn(),
  compressDocument: vi.fn(),
  inspectPage: vi.fn(),
  editPage: vi.fn(),
  saveProtectedCopy: vi.fn(),
  unlockDocument: vi.fn(),
}));

vi.mock("../../src/services/engine", () => engine);
vi.mock("../../src/services/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/native")>()),
  native: true,
  markDirty: vi.fn(async () => {}),
  discardRecovery: vi.fn(async () => {}),
}));

import { ProtectDialog, validateProtection } from "../../src/features/protect/ProtectDialog";
import { CompressDialog, formatBytes } from "../../src/features/compress/CompressDialog";
import { RedactionTool } from "../../src/features/redact/RedactionTool";
import { ObjectEditor, decodeImageFile } from "../../src/features/editor/ObjectEditor";
import {
  placePageBoxes,
  termRects,
  viewportToPdfRect,
} from "../../src/features/redact/redaction-marks";
import { useWorkspace } from "../../src/stores/workspace";
import { discardRecovery } from "../../src/services/native";

const ALL = {
  print: true,
  printHighQuality: true,
  copy: true,
  accessibility: true,
  modify: true,
  annotate: true,
  fillForms: true,
  assemble: true,
};

function seed(info: Partial<{ encrypted: boolean; protectedSource: boolean }> = {}) {
  act(() => {
    useWorkspace.getState().reset();
    useWorkspace.getState().set({
      document: { id: "doc", name: "synthetic.pdf", size: 10 },
      info: { pages: 2, encrypted: false, title: "", author: "", version: "1.7", ...info },
      page: 1,
    });
  });
}

function controller(texts: string[] = ["Invoice SYNTHETIC-CANARY total", "No match"]) {
  const div = document.createElement("div");
  return {
    pdf: {
      numPages: texts.length,
      saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
      getPage: vi.fn(async (page: number) => ({
        getTextContent: vi.fn(async () => ({
          items: [{ str: texts[page - 1], transform: [10, 0, 0, 10, 100, 700], width: 150, height: 10 }],
        })),
      })),
    },
    viewer: {
      getPageView: vi.fn(() => ({
        div,
        viewport: {
          convertToViewportPoint: (x: number, y: number) => [x, y],
          convertToPdfPoint: (x: number, y: number) => [x, 792 - y],
        },
      })),
    },
    replaceWithBytes: vi.fn(async () => {}),
    markSaved: vi.fn(),
  };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("password protection", () => {
  it("validates passwords and restrictions before saving", () => {
    expect(validateProtection("", "", "", "", ALL)).toMatch(/Enter a password/);
    expect(validateProtection("a", "b", "", "", ALL)).toMatch(/do not match/);
    expect(validateProtection("a", "a", "", "", { ...ALL, print: false })).toMatch(/permissions password/);
    expect(validateProtection("a", "a", "a", "a", { ...ALL, copy: false })).toMatch(/must differ/);
    expect(validateProtection("a", "a", "b", "c", { ...ALL, copy: false })).toMatch(/permissions passwords do not match/);
    expect(validateProtection("x".repeat(128), "x".repeat(128), "", "", ALL)).toMatch(/127 bytes/);
    expect(validateProtection("a", "a", "", "", ALL)).toBeNull();
  });

  it("saves a protected copy and clears the passwords", async () => {
    seed();
    const view = controller();
    const onClose = vi.fn();
    engine.saveProtectedCopy.mockResolvedValueOnce(null).mockResolvedValueOnce({
      name: "synthetic-protected.pdf",
      size: 99,
      replacedSource: false,
    });
    render(<ProtectDialog controller={view as never} onClose={onClose} />);
    type("Open password", "synthetic-open");
    type("Confirm open password", "different");
    fireEvent.click(screen.getByText("Save Protected Copy…"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The open passwords do not match.");
    type("Confirm open password", "synthetic-open");
    fireEvent.click(screen.getByLabelText("Print"));
    type("Permissions password", "synthetic-owner");
    type("Confirm permissions password", "synthetic-owner");
    fireEvent.click(screen.getByText("Save Protected Copy…"));
    await vi.waitFor(() => expect(useWorkspace.getState().status).toBe("Save cancelled"));
    expect((screen.getByLabelText("Open password") as HTMLInputElement).value).toBe("");
    type("Open password", "synthetic-open");
    type("Confirm open password", "synthetic-open");
    type("Permissions password", "synthetic-owner");
    type("Confirm permissions password", "synthetic-owner");
    fireEvent.click(screen.getByText("Save Protected Copy…"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(engine.saveProtectedCopy).toHaveBeenLastCalledWith("doc", expect.any(Uint8Array), 2, {
      userPassword: "synthetic-open",
      ownerPassword: "synthetic-owner",
      permissions: { ...ALL, print: false },
    });
    expect(useWorkspace.getState().status).toMatch(/not password protected/);
  });

  it("marks the document saved when the protected copy replaced its source", async () => {
    seed({ protectedSource: true });
    const view = controller();
    engine.saveProtectedCopy.mockResolvedValueOnce({ name: "synthetic.pdf", size: 5, replacedSource: true });
    const onSaveUnprotected = vi.fn(async () => true);
    render(<ProtectDialog controller={view as never} onClose={() => {}} onSaveUnprotected={onSaveUnprotected} />);
    expect(screen.getByText("Save Protected Document")).toBeTruthy();
    type("Open password", "synthetic-open");
    type("Confirm open password", "synthetic-open");
    fireEvent.click(screen.getByText("Save Protected Copy…"));
    await vi.waitFor(() => expect(view.markSaved).toHaveBeenCalled());
    expect(useWorkspace.getState().dirty).toBe(false);
    expect(useWorkspace.getState().info).toMatchObject({ protectedSource: true });
    expect(discardRecovery).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save Without Protection…"));
    await vi.waitFor(() => expect(onSaveUnprotected).toHaveBeenCalled());
  });

  it("unlocks encrypted documents into a sensitive working copy", async () => {
    seed({ encrypted: true });
    const view = controller();
    const onClose = vi.fn();
    engine.unlockDocument
      .mockRejectedValueOnce(new Error("That password did not unlock the document."))
      .mockResolvedValueOnce(new Uint8Array([1, 2]));
    render(<ProtectDialog controller={view as never} onClose={onClose} />);
    type("Document password", "wrong");
    fireEvent.click(screen.getByText("Unlock for Editing"));
    expect(await screen.findByText(/did not unlock/)).toBeTruthy();
    type("Document password", "synthetic-open");
    fireEvent.click(screen.getByText("Unlock for Editing"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(view.replaceWithBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "Unlocked for editing", {
      resetHistory: true,
    });
    expect(useWorkspace.getState().info).toMatchObject({ encrypted: false, protectedSource: true });
    expect(discardRecovery).toHaveBeenCalled();
  });

  it("keeps recovery when attaching an unlocked working copy fails", async () => {
    seed({ encrypted: true });
    const view = controller();
    view.replaceWithBytes.mockRejectedValueOnce(new Error("The candidate could not be loaded."));
    engine.unlockDocument.mockResolvedValueOnce(new Uint8Array([1, 2]));
    render(<ProtectDialog controller={view as never} onClose={() => {}} />);
    type("Document password", "synthetic-open");
    fireEvent.click(screen.getByText("Unlock for Editing"));

    expect(await screen.findByText("The candidate could not be loaded.")).toBeTruthy();
    expect(discardRecovery).not.toHaveBeenCalled();
  });
});

describe("measured compression", () => {
  const report = {
    preset: "small",
    beforeBytes: 4096,
    afterBytes: 1024,
    useful: true,
    unusedObjectsRemoved: 1,
    duplicateStreamsMerged: 2,
    imagesExamined: 3,
    imagesRecompressed: 1,
    imagesSkipped: 2,
    checks: [
      { name: "Page count", passed: true, detail: "2 pages" },
      { name: "Fonts", passed: false, detail: "changed" },
    ],
    message: "Saves 3072 bytes (75.0%).",
  };

  it("analyzes a preset, shows exact sizes and applies the result", async () => {
    seed();
    const view = controller();
    const onClose = vi.fn();
    engine.compressDocument.mockResolvedValueOnce({ bytes: new Uint8Array([1]), report });
    render(<CompressDialog controller={view as never} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/Smallest/));
    fireEvent.click(screen.getByText("Analyze Compression"));
    expect(await screen.findByText(/4,096 bytes/)).toBeTruthy();
    expect(engine.compressDocument).toHaveBeenCalledWith(expect.any(Uint8Array), "small", "job-1");
    expect(screen.getByText("Fonts: changed")).toBeTruthy();
    fireEvent.click(screen.getByText("Apply Compressed Version"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(view.replaceWithBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "Compressed (Smallest): saved 3.0 KB");
    expect(formatBytes(-2 * 1024 * 1024)).toBe("-2.00 MB");
  });

  it("keeps the original when there is no useful output and supports cancellation", async () => {
    seed();
    const view = controller();
    engine.compressDocument.mockResolvedValueOnce({
      bytes: null,
      report: { ...report, useful: false, message: "the original was kept" },
    });
    const { unmount } = render(<CompressDialog controller={view as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Analyze Compression"));
    expect(await screen.findByText("the original was kept")).toBeTruthy();
    expect(screen.queryByText("Apply Compressed Version")).toBeNull();
    unmount();

    engine.compressDocument.mockImplementationOnce(() => new Promise(() => {}));
    render(<CompressDialog controller={view as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Analyze Compression"));
    fireEvent.click(await screen.findByText("Cancel Analysis"));
    expect(engine.cancelEngineJob).toHaveBeenCalledWith("job-1");
    expect(useWorkspace.getState().status).toMatch(/cancelled/);
  });

  it("reports engine failures", async () => {
    seed();
    engine.compressDocument.mockRejectedValueOnce(new Error("engine failed"));
    render(<CompressDialog controller={controller() as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Analyze Compression"));
    await vi.waitFor(() => expect(useWorkspace.getState().error).toBe("engine failed"));
  });
});

describe("redaction workflow", () => {
  const result = {
    pages: [1],
    removedGlyphs: 16,
    pixelRedactedImages: 0,
    removedImages: 0,
    removedPaths: 0,
    removedAnnotations: 0,
    removedFormFields: 0,
    rewrittenForms: 0,
    sanitized: ["Document information, XMP metadata and private application data"],
    warnings: ["An image was removed entirely."],
    audit: { passed: true, regionsChecked: 2, residualRegionItems: 0, termsChecked: 1, residualTerms: 0, streamsScanned: 7 },
  };

  it("marks search matches and coordinates, then applies an audited redaction", async () => {
    seed();
    const view = controller();
    engine.redactDocument.mockRejectedValueOnce(new Error("Redaction was blocked")).mockResolvedValueOnce({
      bytes: new Uint8Array([5]),
      report: result,
    });
    render(<RedactionTool controller={view as never} onClose={() => {}} />);
    type("Find and mark text", "synthetic-canary");
    fireEvent.click(screen.getByText("Mark Matches"));
    expect(await screen.findByText(/Marked 1 match on 1 page/)).toBeTruthy();
    expect(screen.getByText("Audit terms (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Add Region"));
    expect(screen.getByText("Marked regions (2)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Bookmarks"));
    fireEvent.click(screen.getByText("Review and Apply…"));
    fireEvent.click(screen.getByText("Apply Redactions"));
    await vi.waitFor(() => expect(useWorkspace.getState().error).toBe("Redaction was blocked"));
    fireEvent.click(screen.getByText("Apply Redactions"));
    expect(await screen.findByText(/Audit passed: 2 regions and 1 term/)).toBeTruthy();
    const request = engine.redactDocument.mock.calls[1][2];
    expect(request.terms).toEqual(["synthetic-canary"]);
    expect(request.regions).toHaveLength(2);
    expect(request.options.removeBookmarks).toBe(true);
    expect(view.replaceWithBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "Redactions applied", {
      resetHistory: true,
    });
    expect(useWorkspace.getState().status).toMatch(/Save As/);
  });

  it("requires acknowledgement for signed documents and supports cancel and removal", async () => {
    seed();
    act(() => useWorkspace.getState().set({ hasDigitalSignature: true }));
    const view = controller();
    engine.redactDocument.mockImplementationOnce(() => new Promise(() => {}));
    render(<RedactionTool controller={view as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Add Region"));
    fireEvent.click(screen.getByTitle("Remove mark"));
    expect(screen.getByText("Marked regions (0)")).toBeTruthy();
    fireEvent.click(screen.getByText("Add Region"));
    fireEvent.click(screen.getByText("Review and Apply…"));
    const apply = screen.getByText("Apply Redactions").closest("button")!;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/digital signatures/));
    fireEvent.click(apply);
    fireEvent.click(await screen.findByText("Cancel"));
    expect(engine.cancelEngineJob).toHaveBeenCalledWith("job-1");
    expect(useWorkspace.getState().status).toMatch(/cancelled/);
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByText("Draw Regions on Pages"));
    expect(screen.getByText("Drawing Regions (click to stop)")).toBeTruthy();
  });

  it("computes padded term rectangles, overlay boxes and drawn regions", () => {
    const [rect] = termRects([{ str: "Hello SECRET world", transform: [10, 0, 0, 10, 100, 700], width: 180, height: 10 }], "secret");
    expect(rect[0]).toBeCloseTo(100 + 5.65 * 10);
    expect(rect[2]).toBeCloseTo(100 + 12.35 * 10);
    expect(rect[1]).toBeCloseTo(697);
    expect(rect[3]).toBeCloseTo(711);
    const [rotated] = termRects([{ str: "AB", transform: [0, 10, -10, 0, 50, 50], width: 20, height: 10 }], "b");
    expect(rotated[0]).toBeLessThan(50);
    expect(rotated[3]).toBeGreaterThan(60);
    expect(termRects([{ str: "x", transform: [1, 0, 0, 1, 0, 0], width: 0, height: 1 }], "x")).toEqual([]);
    expect(termRects([], " ")).toEqual([]);

    const view = controller();
    const page = view.viewer.getPageView().div;
    const cleanup = placePageBoxes(view.viewer as never, [{ page: 1, rect: [10, 20, 30, 50], className: "redaction-mark" }]);
    const box = page.querySelector(".redaction-mark") as HTMLElement;
    expect(box.style.width).toBe("20px");
    cleanup();
    expect(page.querySelector(".redaction-mark")).toBeNull();
    expect(viewportToPdfRect(view.viewer as never, 1, { x: 10, y: 92 }, { x: 40, y: 12 })).toEqual([10, 700, 40, 780]);
    expect(viewportToPdfRect(undefined, 1, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe("existing content editor", () => {
  const objects = {
    page: 1,
    mediaBox: [0, 0, 612, 792],
    objects: [
      { id: "abc:3", kind: "text", bbox: [72, 690, 200, 710], text: "Invoice 1001", font: "Helvetica", fontSize: 12, pixelWidth: null, pixelHeight: null, shared: false, replaceable: true, reason: null },
      { id: "abc:9", kind: "image", bbox: [0, 0, 50, 50], text: null, font: null, fontSize: null, pixelWidth: 2, pixelHeight: 2, shared: true, replaceable: true, reason: null },
      { id: "abc:11", kind: "text", bbox: [0, 0, 1, 1], text: "CID text", font: "CID", fontSize: 9, pixelWidth: null, pixelHeight: null, shared: false, replaceable: false, reason: "Text in composite (CID) fonts cannot be re-encoded safely." },
    ],
  };

  it("scans the page, previews and applies text replacement and deletes images", async () => {
    seed();
    const view = controller();
    engine.inspectPage.mockResolvedValue(objects);
    engine.editPage
      .mockResolvedValueOnce({ bytes: null, report: { applied: false, message: "The replacement is 60.0 pt wide", widthBefore: 60, widthAfter: 60, missingCharacters: [] } })
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), report: { applied: true, message: "Text replaced.", widthBefore: 60, widthAfter: 60, missingCharacters: [] } })
      .mockResolvedValueOnce({ bytes: new Uint8Array([2]), report: { applied: true, message: "Image deleted.", widthBefore: null, widthAfter: null, missingCharacters: [] } });
    render(<ObjectEditor controller={view as never} onClose={() => {}} />);
    expect(await screen.findByText("Page 1: 3 objects")).toBeTruthy();
    fireEvent.click(await screen.findByText("Invoice 1001"));
    type("Replacement text", "Invoice 1002");
    fireEvent.click(screen.getByText("Preview Width"));
    expect(await screen.findByText(/60.0 pt wide/)).toBeTruthy();
    fireEvent.click(screen.getByText("Replace Text"));
    await vi.waitFor(() => expect(view.replaceWithBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "Text replaced."));
    expect(engine.editPage.mock.calls[1][2]).toEqual({ type: "replaceText", objectId: "abc:3", text: "Invoice 1002" });
    fireEvent.click(await screen.findByText("Image 2×2 px (shared)"));
    expect(screen.getByText(/changes this page only/)).toBeTruthy();
    fireEvent.click(screen.getByText("Delete Image"));
    await vi.waitFor(() => expect(view.replaceWithBytes).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByText("CID text"));
    expect(screen.getByText(/composite \(CID\) fonts/)).toBeTruthy();
    expect((screen.getByText("Replace Text").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports scan failures and rejects unsupported image files", async () => {
    seed();
    engine.inspectPage.mockRejectedValueOnce(new Error("scan failed"));
    render(<ObjectEditor controller={controller() as never} onClose={() => {}} />);
    await vi.waitFor(() => expect(useWorkspace.getState().error).toBe("scan failed"));
    await expect(decodeImageFile(new File(["x"], "x.gif", { type: "image/gif" }))).rejects.toThrow(/PNG or JPEG/);
  });
});

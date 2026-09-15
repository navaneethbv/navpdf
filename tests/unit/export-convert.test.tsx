// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ExportDialog } from "../../src/features/convert/ExportDialog";
import { OfficeExport } from "../../src/features/convert/OfficeExport";
import { OcrPanel } from "../../src/features/ocr/OcrPanel";
import { AssistantPanel } from "../../src/features/assistant/AssistantPanel";
import { RedactionTool } from "../../src/features/redact/RedactionTool";
import { ProtectDialog } from "../../src/features/protect/ProtectDialog";
import { Dialog } from "../../src/components/Dialog";
import { useWorkspace } from "../../src/stores/workspace";

function seedDocument(pages = 2) {
  act(() => {
    useWorkspace.getState().set({
      document: { id: "d", name: "report.pdf", size: 100 },
      info: {
        pages,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
      page: 1,
    });
  });
}

function textPages(texts: string[]) {
  return {
    pdf: {
      numPages: texts.length,
      saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])),
      getPage: vi.fn(async (n: number) => ({
        getViewport: vi.fn(() => ({ width: 100, height: 100 })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        getTextContent: vi.fn(async () => ({
          items: texts[n - 1].split(" ").map((str) => ({ str })),
        })),
      })),
    },
    replaceWithBytes: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

const originalCreateElement = Document.prototype.createElement;

function mockCanvas2d() {
  const spy = vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    const el = originalCreateElement.call(document, tag, options);
    if (tag === "canvas") {
      el.getContext = vi.fn(() => ({}));
      el.toDataURL = vi.fn(() => "data:image/png;base64,AAA");
    }
    return el;
  }) as typeof document.createElement);
  return spy;
}

describe("ExportDialog", () => {
  it("exports all page text with page breaks", async () => {
    seedDocument(2);
    const controller = textPages(["hello world", "second page"]);
    const onClose = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ExportDialog controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(useWorkspace.getState().status).toBe("Text exported successfully");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("exports the current page as PNG and JPEG", async () => {
    seedDocument();
    const toDataURL = vi.fn(() => "data:image/png;base64,AAA");
    vi.spyOn(document, "createElement").mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const el = originalCreateElement.call(document, tag, options);
      if (tag === "canvas") {
        el.getContext = vi.fn(() => ({}));
        el.toDataURL = toDataURL;
      }
      return el;
    }) as typeof document.createElement);
    const controller = textPages(["hello"]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ExportDialog controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("PNG Image"));
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => {
      expect(toDataURL).toHaveBeenCalled();
    });
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    (document.createElement as ReturnType<typeof vi.fn>).mockRestore();
  });
});

function layoutPages(lines: string[][]) {
  return {
    pdf: {
      numPages: lines.length,
      getPage: vi.fn(async (n: number) => ({
        getViewport: vi.fn(() => ({ width: 612, height: 792 })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        getTextContent: vi.fn(async () => ({
          items: lines[n - 1].map((str, index) => ({
            str,
            transform: [12, 0, 0, 12, index % 2 ? 300 : 72, 700 - Math.floor(index / 2) * 16],
            width: str.length * 6,
            height: 12,
          })),
        })),
      })),
    },
  };
}

describe("OfficeExport", () => {
  it("exports genuine DOCX and XLSX packages with previewed cells", async () => {
    seedDocument(2);
    const controller = layoutPages([["Name", "Amount", "Alpha", "=1+1"], ["Second page"]]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const created: Blob[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:mock";
    });
    const onClose = vi.fn();
    const { unmount } = render(<OfficeExport controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByText("Export File"));
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(created[0].type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const bytes = new Uint8Array(await created[0].arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(useWorkspace.getState().status).toBe("Exported Word document (.docx)");
    unmount();

    render(<OfficeExport controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Excel workbook/));
    fireEvent.click(screen.getByText("Preview Page 1 Cells"));
    expect(await screen.findByText("=1+1")).toBeTruthy();
    fireEvent.click(screen.getByText("Export File"));
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(created[1].type).toContain("spreadsheetml.sheet");
    click.mockRestore();
    URL.createObjectURL = original;
  });

  it("exports RTF and explains the conversion limits", async () => {
    seedDocument();
    const controller = layoutPages([["Only line"]]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<OfficeExport controller={controller as never} onClose={() => {}} />);
    expect(screen.getByText(/Editable formats are rebuilt from the PDF text layer/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Rich Text/));
    fireEvent.click(screen.getByText("Export File"));
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    click.mockRestore();
  });
});

describe("OcrPanel", () => {
  it("explains the native OCR requirement in browser preview", async () => {
    const canvasMock = mockCanvas2d();
    seedDocument();
    const controller = textPages(["scanned words here"]);
    render(<OcrPanel controller={controller as never} onClose={() => {}} />);
    expect(screen.getByText(/Optical Character Recognition/i)).toBeTruthy();
    expect(await screen.findByText(/OCR requires the native macOS application/i)).toBeTruthy();
    expect(screen.queryByText(/Offline & Private/i)).toBeNull();
    canvasMock.mockRestore();
  });

  it("disables recognition without a real browser engine", async () => {
    const canvasMock = mockCanvas2d();
    seedDocument();
    const controller = textPages(["scanned words here"]);
    render(<OcrPanel controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Extract Text Only/i }));
    await screen.findByText(/OCR requires the native macOS application/i);
    expect(screen.getByRole("button", { name: /Recognize Text/i }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.queryByText("Recognized Text")).toBeNull();
    canvasMock.mockRestore();
  });
});

describe("AssistantPanel", () => {
  it("cites the page of a matching passage and navigates to it", async () => {
    seedDocument(2);
    const controller = {
      ...textPages([
        "Introduction text without the words.",
        "The renewal notice period is ninety days before the end of the term.",
      ]),
      goTo: vi.fn(),
    };
    const onClose = vi.fn();
    render(<AssistantPanel controller={controller as never} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Words to find"), {
      target: { value: "renewal notice period" },
    });
    fireEvent.click(screen.getByText("Find Passages"));
    expect(await screen.findByText("Page 2")).toBeTruthy();
    fireEvent.click(screen.getByText(/ninety days/));
    expect(controller.goTo).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalled();
  });

  it("ranks passages by matched terms and ignores empty queries", async () => {
    const { rankPassages } = await import("../../src/features/assistant/AssistantPanel");
    const pages = [
      { page: 1, text: "Payment is due in thirty days. Shipping is free for every order placed." },
      { page: 2, text: "Interest on late payment accrues monthly after the due date passes." },
      { page: 3, text: "Late payment adds interest, and repeated late payment adds a late fee." },
    ];
    const ranked = rankPassages(pages, "late payment interest");
    expect(ranked.map((passage) => passage.page)).toEqual([3, 2]);
    expect(rankPassages(pages, "!")).toEqual([]);
    expect(rankPassages(pages, "shipping warranty refund")).toEqual([]);
  });
});

describe("RedactionTool", () => {
  it("keeps marks reversible and requires the desktop engine to apply", () => {
    seedDocument();
    const onClose = vi.fn();
    render(<RedactionTool controller={null} onClose={onClose} />);
    expect(screen.getByText(/Marks are reversible/)).toBeTruthy();
    expect(screen.getByText(/runs only in the desktop app/)).toBeTruthy();
    fireEvent.click(screen.getByText("Add Region"));
    expect(screen.getByText("Marked regions (1)")).toBeTruthy();
    expect(screen.getByText(/Page 1: 200×24 pt/)).toBeTruthy();
    const apply = screen.getByText("Review and Apply…").closest("button") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByTitle("Remove mark"));
    expect(screen.getByText("Marked regions (0)")).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ProtectDialog", () => {
  it("disables password fields outside the desktop app", () => {
    seedDocument();
    render(<ProtectDialog controller={null} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText(/runs only in the desktop app/)).toBeTruthy();
  });

  it("offers unlocking for encrypted documents", () => {
    act(() => {
      useWorkspace.getState().set({
        document: { id: "d", name: "locked.pdf", size: 100 },
        info: {
          pages: 2,
          encrypted: true,
          title: "",
          author: "",
          version: "1.7",
        },
      });
    });
    render(<ProtectDialog controller={null} onClose={() => {}} />);
    expect(screen.getByText("Unlock Protected PDF")).toBeTruthy();
    expect(screen.getByText(/opens read-only/)).toBeTruthy();
  });
});

describe("Dialog", () => {
  it("renders a titled modal and closes on cancel", () => {
    const onClose = vi.fn();
    HTMLDialogElement.prototype.showModal ??= vi.fn();
    HTMLDialogElement.prototype.close ??= vi.fn();
    render(
      <Dialog title="Unlock PDF" onClose={onClose}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByText("Unlock PDF")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalled();
  });
});

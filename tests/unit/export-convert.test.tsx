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
          items: texts[n - 1].split(" ").map((str, index) => ({
            str,
            transform: [10, 0, 0, 10, 10 + index * 40, 80],
            width: str.length * 5,
            height: 10,
          })),
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

  it("explains that pages without a text layer need OCR instead of saving headers only", async () => {
    seedDocument(1);
    const controller = textPages([""]);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(<ExportDialog controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toMatch(/no text layer.*OCR/);
    });
    expect(click).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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

  it("exports only the selected Office page range", async () => {
    seedDocument(3);
    const controller = layoutPages([["first"], ["second"], ["third"]]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<OfficeExport controller={controller as never} onClose={() => {}} />);

    fireEvent.click(screen.getByText("Custom range"));
    fireEvent.change(screen.getByLabelText("Office export page range"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByText("Export File"));

    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(controller.pdf.getPage).toHaveBeenCalledWith(2);
    expect(controller.pdf.getPage).not.toHaveBeenCalledWith(1);
    expect(controller.pdf.getPage).not.toHaveBeenCalledWith(3);
    click.mockRestore();
  });
});

function captureDownloads() {
  const created: Blob[] = [];
  const names: string[] = [];
  const original = URL.createObjectURL;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return "blob:mock";
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return {
    created,
    names,
    restore: () => {
      URL.createObjectURL = original;
      click.mockRestore();
    },
  };
}

function mockRasterCanvas(dataUrl: string) {
  const getImageData = vi.fn((_x: number, _y: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  }));
  const canvases: HTMLCanvasElement[] = [];
  const spy = vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    const el = originalCreateElement.call(document, tag, options);
    if (tag === "canvas") {
      el.getContext = vi.fn(() => ({ fillStyle: "", fillRect: vi.fn(), getImageData }));
      el.toDataURL = vi.fn(() => dataUrl);
      canvases.push(el);
    }
    return el;
  }) as typeof document.createElement);
  return { canvases, getImageData, restore: () => spy.mockRestore() };
}

describe("additional export formats", () => {
  const JPEG_URL = "data:image/jpeg;base64,/9j/2Q==";

  it("exports all selected pages as one multipage TIFF and releases each canvas", async () => {
    seedDocument(2);
    const canvas = mockRasterCanvas(JPEG_URL);
    const downloads = captureDownloads();
    const onClose = vi.fn();
    render(<ExportDialog controller={textPages(["one", "two"]) as never} onClose={onClose} />);
    fireEvent.click(screen.getByText("TIFF Image"));
    expect(screen.queryByText(/JPEG Quality/)).toBeNull();
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloads.names).toEqual(["report.tiff"]);
    expect(downloads.created[0].type).toBe("image/tiff");
    const bytes = new Uint8Array(await downloads.created[0].arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0x49, 0x49, 42, 0]);
    expect(canvas.getImageData).toHaveBeenCalledTimes(2);
    expect(canvas.canvases.every((item) => item.width === 0)).toBe(true);
    expect(useWorkspace.getState().status).toBe("Exported 2 page(s) as TIFF (150 DPI).");
    downloads.restore();
    canvas.restore();
  });

  it("packages several page images into one ZIP so only one destination is requested", async () => {
    seedDocument(2);
    const canvas = mockRasterCanvas("data:image/png;base64,iVBORw0KGgo=");
    const downloads = captureDownloads();
    const onClose = vi.fn();
    render(<ExportDialog controller={textPages(["one", "two"]) as never} onClose={onClose} />);
    fireEvent.click(screen.getByText("PNG Image"));
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloads.names).toEqual(["report-png-pages.zip"]);
    const zip = new TextDecoder().decode(await downloads.created[0].arrayBuffer());
    expect(zip).toContain("report-page-1.png");
    expect(zip).toContain("report-page-2.png");
    downloads.restore();
    canvas.restore();
  });

  it("exports PostScript with one page per PDF page and EPS per page", async () => {
    seedDocument(2);
    const canvas = mockRasterCanvas(JPEG_URL);
    const downloads = captureDownloads();
    const onClose = vi.fn();
    const { unmount } = render(
      <ExportDialog controller={textPages(["one", "two"]) as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("PostScript (.ps)"));
    expect(screen.getByText(/JPEG Quality/)).toBeTruthy();
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloads.names).toEqual(["report.ps"]);
    expect(downloads.created[0].type).toBe("application/postscript");
    const ps = await downloads.created[0].text();
    expect(ps).toContain("%%Pages: 2");
    expect(ps).toContain("/DCTDecode filter");
    unmount();

    render(<ExportDialog controller={textPages(["one", "two"]) as never} onClose={onClose} />);
    fireEvent.click(screen.getByText("EPS (.eps)"));
    fireEvent.click(screen.getByText(/Current Page/));
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => expect(downloads.names).toHaveLength(2));
    expect(downloads.names[1]).toBe("report-page-1.eps");
    expect(await downloads.created[1].text()).toMatch(/^%!PS-Adobe-3\.0 EPSF-3\.0/);
    downloads.restore();
    canvas.restore();
  });

  it("refuses to embed non-JPEG data when the browser cannot encode JPEG", async () => {
    seedDocument(1);
    const canvas = mockRasterCanvas("data:image/png;base64,iVBORw0KGgo=");
    const downloads = captureDownloads();
    render(<ExportDialog controller={textPages(["one"]) as never} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("PostScript (.ps)"));
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() =>
      expect(useWorkspace.getState().error).toBe("The image could not be exported."),
    );
    expect(downloads.names).toEqual([]);
    downloads.restore();
    canvas.restore();
  });

  it("exports CSV, XML Spreadsheet 2003, HTML and XML from the text layer", async () => {
    seedDocument(1);
    const controller = layoutPages([["Name", "=1+1"]]);
    const downloads = captureDownloads();
    const expectations: [RegExp, string, string, RegExp][] = [
      [/Comma-separated/, "report.csv", "text/csv", /^\uFEFFName,'=1\+1\r\n$/],
      [/XML Spreadsheet 2003/, "report.xml", "application/xml", /urn:schemas-microsoft-com/],
      [/HTML web page/, "report.html", "text/html", /<p>Name =1\+1<\/p>/],
      [/XML document/, "report.xml", "application/xml", /<paragraph>Name =1\+1<\/paragraph>/],
    ];
    for (const [index, [label, name, type, content]] of expectations.entries()) {
      const { unmount } = render(
        <OfficeExport controller={controller as never} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(screen.getByText("Export File"));
      await vi.waitFor(() => expect(downloads.names).toHaveLength(index + 1));
      expect(downloads.names[index]).toBe(name);
      expect(downloads.created[index].type).toBe(type);
      expect(await downloads.created[index].text()).toMatch(content);
      unmount();
    }
    downloads.restore();
  });

  it("abandons an editable export when the dialog closes before it finishes", async () => {
    seedDocument(1);
    let finish!: (page: unknown) => void;
    const controller = layoutPages([["Name"]]);
    const realPage = controller.pdf.getPage;
    controller.pdf.getPage = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ) as never;
    const downloads = captureDownloads();
    const { unmount } = render(<OfficeExport controller={controller as never} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Export File"));
    expect(screen.getByLabelText("Close")).toHaveProperty("disabled", true);
    unmount();
    finish(await realPage(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(downloads.names).toEqual([]);
    downloads.restore();
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

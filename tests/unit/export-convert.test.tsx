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
      getPage: vi.fn(async (n: number) => ({
        getViewport: vi.fn(() => ({ width: 100, height: 100 })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        getTextContent: vi.fn(async () => ({
          items: texts[n - 1].split(" ").map((str) => ({ str })),
        })),
      })),
    },
  };
}

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

function mockCanvas2d() {
  const createElement = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation(
    ((tag: string, options?: ElementCreationOptions) => {
      const el = createElement(tag, options);
      if (tag === "canvas") {
        el.getContext = vi.fn(() => ({}));
        el.toDataURL = vi.fn(() => "data:image/png;base64,AAA");
      }
      return el;
    }) as typeof document.createElement,
  );
  return spy;
}

describe("ExportDialog", () => {
  it("exports all page text with page breaks", async () => {
    seedDocument(2);
    const controller = textPages(["hello world", "second page"]);
    const onClose = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    render(
      <ExportDialog controller={controller as never} onClose={onClose} />,
    );
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
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tag: string, options?: ElementCreationOptions) => {
        const el = createElement(tag, options);
        if (tag === "canvas") {
          el.getContext = vi.fn(() => ({}));
          el.toDataURL = toDataURL;
        }
        return el;
      }) as typeof document.createElement,
    );
    const controller = textPages(["hello"]);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    render(
      <ExportDialog controller={controller as never} onClose={() => {}} />,
    );
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

describe("OfficeExport", () => {
  it("exports honest HTML outlines and formula-safe CSV", async () => {
    seedDocument(2);
    const controller = textPages(["alpha =1+1", "beta"]);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const created: string[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob.type);
      return "blob:mock";
    });
    render(
      <OfficeExport controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Export File"));
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    expect(created[0]).toContain("msword");
    expect(screen.getByText(/Fidelity limits/)).toBeTruthy();
    click.mockRestore();
    URL.createObjectURL = original;
  });

  it("switches between office formats", () => {
    seedDocument();
    render(
      <OfficeExport controller={textPages(["x"]) as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText(/Table data/));
    fireEvent.click(screen.getByText(/Slides outline/));
    expect(screen.getByText(/Fidelity limits/)).toBeTruthy();
  });
});

describe("OcrPanel", () => {
  it("reads embedded page text without claiming OCR", async () => {
    const canvasMock = mockCanvas2d();
    seedDocument();
    const controller = textPages(["scanned words here"]);
    render(<OcrPanel controller={controller as never} onClose={() => {}} />);
    expect(screen.getByText(/M5 OCR engine/)).toBeTruthy();
    fireEvent.click(screen.getByText("Extract Page Text"));
    expect(await screen.findByText("Page Text")).toBeTruthy();
    expect(screen.getByText(/scanned words here/)).toBeTruthy();
    expect(useWorkspace.getState().status).toContain("Text extraction completed");
    canvasMock.mockRestore();
  });

  it("reports image-only pages honestly", async () => {
    const canvasMock = mockCanvas2d();
    seedDocument();
    const controller = textPages([""]);
    render(<OcrPanel controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Extract Page Text"));
    expect(await screen.findByText("Page Text")).toBeTruthy();
    expect(
      screen.getByText(/Scanned image-only pages need the M5 OCR engine/),
    ).toBeTruthy();
    canvasMock.mockRestore();
  });
});

describe("AssistantPanel", () => {
  it("builds a cited extractive page index", async () => {
    seedDocument(2);
    const controller = { ...textPages(["First claim here. More detail.", ""]), goTo: vi.fn() };
    const onClose = vi.fn();
    render(
      <AssistantPanel controller={controller as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Build Page Index"));
    expect(await screen.findByText("Page 1")).toBeTruthy();
    expect(screen.getByText("First claim here.")).toBeTruthy();
    fireEvent.click(screen.getByText("First claim here."));
    expect(controller.goTo).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Slide Outline"));
    expect(screen.getByText(/M7 decision/)).toBeTruthy();
  });
});

describe("RedactionTool", () => {
  it("marks regions without modifying the document", () => {
    seedDocument();
    const onClose = vi.fn();
    render(<RedactionTool onClose={onClose} />);
    expect(screen.getByText(/never claims the content is gone/)).toBeTruthy();
    fireEvent.click(screen.getByText("Mark Region"));
    expect(screen.getByText(/Marked regions \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Page 1: 200x30 pt/)).toBeTruthy();
    fireEvent.click(screen.getByTitle("Remove mark"));
    expect(screen.queryByText(/Marked regions \(\d+\)/)).toBeNull();
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ProtectDialog", () => {
  it("keeps password fields disabled pending the M6 engine", () => {
    seedDocument();
    render(<ProtectDialog onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText(/M6 protection engine/)).toBeTruthy();
  });

  it("explains read-only status for encrypted documents", () => {
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
    render(<ProtectDialog onClose={() => {}} />);
    expect(screen.getByText(/read-only in NavPDF/)).toBeTruthy();
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

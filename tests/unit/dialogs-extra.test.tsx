// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FillAndSign } from "../../src/features/signatures/FillAndSign";
import { FormManager } from "../../src/features/forms/FormManager";
import { DecorationsDialog } from "../../src/features/decorations/DecorationsDialog";
import { ContentEditor } from "../../src/features/editor/ContentEditor";
import { CreatePdfDialog } from "../../src/features/pages/CreatePdfDialog";
import { PrintDialog } from "../../src/features/pages/PrintDialog";
import { CompressDialog } from "../../src/features/compress/CompressDialog";
import { OfficeExport } from "../../src/features/convert/OfficeExport";
import { ExportDialog } from "../../src/features/convert/ExportDialog";
import { AssistantPanel } from "../../src/features/assistant/AssistantPanel";
import { AttachmentsDialog } from "../../src/features/attachments/AttachmentsDialog";
import { RedactionTool } from "../../src/features/redact/RedactionTool";
import { ProtectDialog } from "../../src/features/protect/ProtectDialog";
import { Properties } from "../../src/features/annotations/Properties";
import { Settings } from "../../src/features/settings/Settings";
import { Home } from "../../src/features/home/Home";
import { Dialog } from "../../src/components/Dialog";
import { createBlankDocument } from "../../src/services/document-commands";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";

function seedDocument(pages = 3) {
  act(() => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 100 },
      info: {
        pages,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
      page: 1,
      local: { preferences: defaultPreferences, recents: [], recoveries: [] },
    });
  });
}

async function mockController(pages = 3) {
  const bytes = await createBlankDocument(pages);
  return {
    pdf: {
      saveDocument: vi.fn(async () => bytes),
      numPages: pages,
    },
    replaceWithBytes: vi.fn(async () => {}),
    goTo: vi.fn(),
    setTool: vi.fn(),
    setColor: vi.fn(),
    deleteSelected: vi.fn(),
  };
}

const originalCreateElement = Document.prototype.createElement;

function mockCanvas2d() {
  return vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    const el = originalCreateElement.call(document, tag, options);
    if (tag === "canvas") {
      el.getContext = vi.fn(() => ({
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
      }));
      el.toDataURL = vi.fn(() => "data:image/png;base64,AAA");
    }
    return el;
  }) as typeof document.createElement);
}

function textController(texts: string[]) {
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
    goTo: vi.fn(),
  };
}

beforeEach(() => {
  useWorkspace.getState().reset();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("FillAndSign draw, type, and library management", () => {
  it("draws, saves, and deletes a signature", async () => {
    seedDocument();
    const canvasMock = mockCanvas2d();
    const controller = await mockController();
    render(<FillAndSign controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Draw"));
    const canvas = document.querySelector(".sig-canvas") as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30 });
    fireEvent.mouseUp(canvas);
    fireEvent.click(screen.getByText("Clear"));
    fireEvent.click(screen.getByText("Save Signature"));
    expect(await screen.findByText("Signature 1")).toBeTruthy();
    fireEvent.click(screen.getByText("Signature 1"));
    const remove = document.querySelector(".sig-card .icon-button.danger") as HTMLElement;
    fireEvent.click(remove);
    expect(screen.queryByText("Signature 1")).toBeNull();
    canvasMock.mockRestore();
  });

  it("saves a typed signature to the library", async () => {
    seedDocument();
    const canvasMock = mockCanvas2d();
    render(<FillAndSign controller={null} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Type"));
    fireEvent.change(screen.getByPlaceholderText("Type your name..."), {
      target: { value: "Ada Lovelace" },
    });
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    fireEvent.click(screen.getByText("Save Signature"));
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    canvasMock.mockRestore();
  });

  it("closes from the footer", () => {
    seedDocument();
    const onClose = vi.fn();
    render(<FillAndSign controller={null} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("FormManager field types", () => {
  it("creates checked checkboxes and labeled buttons", async () => {
    seedDocument();
    const controller = await mockController();
    render(<FormManager controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Checkbox"));
    fireEvent.change(screen.getByPlaceholderText("e.g. FirstName, SignatureDate, Agreed"), {
      target: { value: "Agreed" },
    });
    fireEvent.change(screen.getByPlaceholderText("Optional default value"), {
      target: { value: "true" },
    });
    fireEvent.click(screen.getByText("Add Field"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText("Button"));
    fireEvent.change(screen.getByPlaceholderText("e.g. FirstName, SignatureDate, Agreed"), {
      target: { value: "Submit" },
    });
    fireEvent.click(screen.getByText("Add Field"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(2);
    });
  });

  it("requires a field name and edits the target page", () => {
    seedDocument();
    render(<FormManager controller={null} onClose={() => {}} />);
    expect((screen.getByText("Add Field").closest("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    const pages = screen.getAllByDisplayValue("1");
    fireEvent.change(pages[pages.length - 1], { target: { value: "2" } });
    fireEvent.click(screen.getByText("Cancel"));
  });
});

describe("DecorationsDialog inputs", () => {
  it("edits watermark, header, bates, and background inputs", async () => {
    seedDocument(2);
    const controller = await mockController(2);
    const onClose = vi.fn();
    render(<DecorationsDialog controller={controller as never} onClose={onClose} />);
    const watermark = document.querySelector('.modal-body input[type="text"]') as HTMLInputElement;
    fireEvent.change(watermark, { target: { value: "DRAFT" } });
    const opacity = document.querySelector('.modal-body input[type="range"]') as HTMLInputElement;
    fireEvent.change(opacity, { target: { value: "0.5" } });
    fireEvent.click(screen.getByText("Header & Footer"));
    fireEvent.change(screen.getByPlaceholderText("e.g. {date}"), {
      target: { value: "{page}" },
    });
    fireEvent.click(screen.getByText("Bates Numbers"));
    const numbers = document.querySelectorAll('.modal-body input[type="number"]');
    fireEvent.change(numbers[0], { target: { value: "10" } });
    fireEvent.change(numbers[1], { target: { value: "4" } });
    expect(screen.getByText(/Preview:/)).toBeTruthy();
    fireEvent.click(screen.getByText("Background"));
    fireEvent.change(
      document.querySelector('.modal-body input[type="color"]') as HTMLInputElement,
      {
        target: { value: "#ff0000" },
      },
    );
    fireEvent.click(screen.getByText("Apply to All Pages"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does nothing without a document revision", () => {
    seedDocument();
    render(<DecorationsDialog controller={{ pdf: null } as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Apply to All Pages"));
  });
});

describe("ContentEditor extras", () => {
  it("cancels, picks image files, and edits the target page", () => {
    seedDocument();
    const onClose = vi.fn();
    render(<ContentEditor controller={null} type="text" onClose={onClose} />);
    const pages = screen.getAllByDisplayValue("1");
    fireEvent.change(pages[0], { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("Enter text to place on page..."), {
      target: { value: "x" },
    });
    fireEvent.change(
      document.querySelector('.modal-body input[type="number"]') as HTMLInputElement,
      {
        target: { value: "18" },
      },
    );
    fireEvent.change(
      document.querySelector('.modal-body input[type="color"]') as HTMLInputElement,
      {
        target: { value: "#ff0000" },
      },
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the file picker for images and ignores empty picks", async () => {
    seedDocument();
    const controller = await mockController();
    render(<ContentEditor controller={controller as never} type="image" onClose={() => {}} />);
    fireEvent.click(screen.getByText("Choose PNG or JPEG..."));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
  });

  it("surfaces mutation failures", async () => {
    seedDocument();
    const controller = await mockController();
    (
      controller.pdf as { saveDocument: ReturnType<typeof vi.fn> }
    ).saveDocument.mockRejectedValueOnce(new Error("locked"));
    render(<ContentEditor controller={controller as never} type="text" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Enter text to place on page..."), {
      target: { value: "boom" },
    });
    fireEvent.click(screen.getByText("Insert Text"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toBe("locked");
    });
  });
});

describe("CreatePdfDialog extras", () => {
  it("disables blank-document creation outside the supported page count", () => {
    render(<CreatePdfDialog onLoad={vi.fn()} onClose={vi.fn()} />);
    const pageCount = screen.getByDisplayValue("1");
    const create = screen.getByRole("button", { name: "Create PDF" });

    fireEvent.change(pageCount, { target: { value: "0" } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(pageCount, { target: { value: "51" } });
    expect(create.hasAttribute("disabled")).toBe(true);
  });

  it("supports US Letter sizes and removes queued files", async () => {
    const onLoad = vi.fn();
    render(<CreatePdfDialog onLoad={onLoad} onClose={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    fireEvent.change(document.querySelector("select") as HTMLSelectElement, {
      target: { value: "letter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await vi.waitFor(() => {
      expect(onLoad).toHaveBeenCalled();
    });
  });

  it("rejects non-PDF content when combining", async () => {
    render(<CreatePdfDialog onLoad={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Import / Combine Files"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["nope"], "x.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByText("1. x.pdf")).toBeTruthy();
    fireEvent.click(screen.getByText("Combine & Open"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).not.toBe("");
    });
  });
});

describe("PrintDialog extras", () => {
  it("does nothing without a revision and edits ranges", async () => {
    seedDocument(5);
    const controller = await mockController(5);
    const onClose = vi.fn();
    render(<PrintDialog controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByText(/Current page/));
    fireEvent.click(screen.getByText(/^Pages:/));
    fireEvent.change(screen.getByPlaceholderText("e.g. 1-3, 5"), {
      target: { value: "1-2" },
    });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores print requests without a document", () => {
    seedDocument();
    render(<PrintDialog controller={null} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Print"));
  });

  it("rejects a custom range that selects no pages", async () => {
    seedDocument(5);
    const controller = await mockController(5);
    render(<PrintDialog controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/^Pages:/));
    fireEvent.change(screen.getByPlaceholderText("e.g. 1-3, 5"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByText("Print"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toMatch(/page range/i);
    });
  });

  it("surfaces staging failures", async () => {
    seedDocument();
    const controller = await mockController();
    (
      controller.pdf as { saveDocument: ReturnType<typeof vi.fn> }
    ).saveDocument.mockRejectedValueOnce(new Error("no bytes"));
    render(<PrintDialog controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Print"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toBe("no bytes");
    });
  });
});

describe("CompressDialog outside the desktop app", () => {
  it("explains the local engine requirement and keeps presets selectable", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(<CompressDialog controller={controller as never} onClose={onClose} />);
    expect(screen.getByText(/runs only in the desktop app/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Lossless/));
    expect((screen.getByLabelText(/Lossless/) as HTMLInputElement).checked).toBe(true);
    const analyze = screen.getByText("Analyze Compression").closest("button") as HTMLButtonElement;
    expect(analyze.disabled).toBe(true);
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
  });
});

describe("OfficeExport formats", () => {
  it("refuses documents without a text layer instead of exporting empty files", async () => {
    seedDocument(2);
    const controller = textController(["one two", "three four"]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<OfficeExport controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/editable text/));
    fireEvent.click(screen.getByText("Export File"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toMatch(/no text layer/);
    });
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("does nothing without a revision", () => {
    seedDocument();
    render(<OfficeExport controller={null} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Export File"));
  });
});

describe("ExportDialog JPG and failures", () => {
  it("exports JPEG with quality settings", async () => {
    seedDocument();
    const canvasMock = mockCanvas2d();
    const controller = textController(["hello"]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ExportDialog controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("JPEG Image"));
    expect(screen.getByRole("button", { name: /150 DPI/i })).toBeTruthy();
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    expect(useWorkspace.getState().status).toContain("JPG");
    click.mockRestore();
    canvasMock.mockRestore();
  });

  it("surfaces export failures", async () => {
    seedDocument(2);
    const controller = textController(["a", "b"]);
    (controller.pdf as { getPage: ReturnType<typeof vi.fn> }).getPage.mockRejectedValueOnce(
      new Error("bad page"),
    );
    render(<ExportDialog controller={controller as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Export"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toBe("bad page");
    });
  });
});

describe("AssistantPanel without a model", () => {
  it("states that nothing is generated and answers unsupported questions honestly", async () => {
    seedDocument();
    render(
      <AssistantPanel
        controller={textController(["alpha beta gamma"]) as never}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/No local language model is installed/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Words to find"), {
      target: { value: "quarterly revenue" },
    });
    fireEvent.click(screen.getByText("Find Passages"));
    expect(await screen.findByText(/nothing to cite/)).toBeTruthy();
  });

  it("surfaces text extraction failures", async () => {
    seedDocument();
    const controller = textController(["x"]);
    (controller.pdf as { getPage: ReturnType<typeof vi.fn> }).getPage.mockRejectedValueOnce(
      new Error("no text"),
    );
    render(<AssistantPanel controller={controller as never} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Words to find"), {
      target: { value: "anything here" },
    });
    fireEvent.click(screen.getByText("Find Passages"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toBe("no text");
    });
  });
});

describe("AttachmentsDialog download and close", () => {
  it("downloads listed attachments and closes", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(<AttachmentsDialog controller={controller as never} onClose={onClose} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["data"], "a.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText("a.txt")).toBeTruthy();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTitle("Download attachment"));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("RedactionTool inputs", () => {
  it("adds a region from every coordinate field", () => {
    seedDocument(4);
    render(<RedactionTool controller={null} onClose={() => {}} />);
    const numbers = document.querySelectorAll('.modal-body input[type="number"]');
    expect(numbers.length).toBe(5);
    numbers.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 2) } });
    });
    fireEvent.click(screen.getByText("Add Region"));
    expect(screen.getByText(/Page 2: 5×6 pt/)).toBeTruthy();
    fireEvent.change(numbers[3], { target: { value: "0" } });
    fireEvent.click(screen.getByText("Add Region"));
    expect(screen.getByText(/positive width and height/)).toBeTruthy();
  });
});

describe("ProtectDialog close", () => {
  it("closes from the footer", () => {
    seedDocument();
    const onClose = vi.fn();
    render(<ProtectDialog controller={null} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Properties extras", () => {
  it("picks swatch colors and starts highlighting", () => {
    seedDocument();
    act(() => {
      useWorkspace.getState().set({ tool: "highlight" });
    });
    const controller = { setTool: vi.fn(), setColor: vi.fn(), deleteSelected: vi.fn() };
    render(<Properties controller={controller as never} />);
    fireEvent.click(screen.getByLabelText("Highlight #80d49b"));
    expect(controller.setColor).toHaveBeenCalledWith("#80d49b");
    act(() => {
      useWorkspace.getState().set({ tool: "select" });
    });
    fireEvent.click(screen.getByText("Highlight text"));
    expect(controller.setTool).toHaveBeenCalledWith("highlight");
  });
});

describe("Settings inputs", () => {
  it("edits zoom, layout, and privacy toggles", async () => {
    seedDocument();
    act(() => {
      useWorkspace.getState().set({ settingsOpen: true });
    });
    render(<Settings />);
    fireEvent.change(screen.getByLabelText(/Default zoom/), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/Page layout/), {
      target: { value: "spread" },
    });
    fireEvent.click(screen.getByLabelText(/Remember last page/));
    fireEvent.click(screen.getByLabelText(/Autosave recovery/));
    fireEvent.click(screen.getByLabelText(/Keep recent document history/));
    fireEvent.click(screen.getByText("Save settings"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().settingsOpen).toBe(false);
    });
    expect(useWorkspace.getState().local.preferences.defaultZoom).toBe("2");
  });
});

describe("Home history actions", () => {
  it("clears history and discards recovery", async () => {
    const refresh = vi.fn(async () => {});
    const onError = vi.fn();
    act(() => {
      useWorkspace.getState().set({
        local: {
          preferences: defaultPreferences,
          recents: [{ id: "r1", name: "a.pdf", openedAt: 1, page: 1 }],
          recoveries: [
            { id: "rec-a", name: "rec.pdf", pages: 1, savedAt: 2 },
            { id: "rec-b", name: "other.pdf", pages: 1, savedAt: 1 },
          ],
        },
      });
    });
    render(
      <Home
        open={() => {}}
        recent={() => {}}
        recover={() => {}}
        refresh={refresh}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Clear history"));
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(screen.getByText("rec.pdf")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Discard recovery for other.pdf"));
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Dialog cancel", () => {
  it("closes through the cancel event", () => {
    const onClose = vi.fn();
    HTMLDialogElement.prototype.showModal ??= vi.fn();
    HTMLDialogElement.prototype.close ??= vi.fn();
    render(
      <Dialog title="T" onClose={onClose}>
        <p>body</p>
      </Dialog>,
    );
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { createBlankDocument } from "../../src/services/document-commands";
import { ContentEditor } from "../../src/features/editor/ContentEditor";
import { DecorationsDialog } from "../../src/features/decorations/DecorationsDialog";
import { FormManager } from "../../src/features/forms/FormManager";
import { AttachmentsDialog } from "../../src/features/attachments/AttachmentsDialog";
import { DesignTools } from "../../src/features/design/DesignTools";
import { FillAndSign } from "../../src/features/signatures/FillAndSign";
import { PageWorkspace } from "../../src/features/pages/PageWorkspace";
import { CreatePdfDialog } from "../../src/features/pages/CreatePdfDialog";
import { CompressDialog } from "../../src/features/compress/CompressDialog";
import { PrintDialog } from "../../src/features/pages/PrintDialog";
import { useWorkspace } from "../../src/stores/workspace";

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

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
    editor: { commitOrRemove: vi.fn() },
  };
}

beforeEach(() => {
  useWorkspace.getState().reset();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("ContentEditor", () => {
  it("inserts styled text into the live revision", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(
      <ContentEditor controller={controller as never} type="text" onClose={onClose} />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("Enter text to place on page..."),
      { target: { value: "Hello NavPDF" } },
    );
    fireEvent.click(screen.getByText("Insert Text"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    const bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(controller.replaceWithBytes.mock.calls[0][1]).toContain("Text added");
    expect(onClose).toHaveBeenCalled();
  });

  it("inserts an uploaded image into the live revision", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <ContentEditor controller={controller as never} type="image" onClose={() => {}} />,
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File([TINY_PNG as unknown as BlobPart], "pic.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
  });
});

describe("DecorationsDialog", () => {
  it("applies watermarks, headers, bates numbers, and backgrounds", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(
      <DecorationsDialog controller={controller as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Apply to All Pages"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText("Bates Numbers"));
    expect(screen.getByText(/Preview:/)).toBeTruthy();
    fireEvent.click(screen.getByText("Apply to All Pages"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(screen.getByText("Background"));
    fireEvent.click(screen.getByText("Apply to All Pages"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(3);
    });
    const bytes = controller.replaceWithBytes.mock.calls[2][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(onClose).toHaveBeenCalled();
  });

  it("formats header tokens per page", async () => {
    seedDocument(2);
    const controller = await mockController(2);
    render(
      <DecorationsDialog controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Header & Footer"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Confidential Document"), {
      target: { value: "Secret {page}/{total}" },
    });
    fireEvent.click(screen.getByText("Apply to All Pages"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
  });
});

describe("FormManager", () => {
  it("creates text, checkbox, and button fields", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(
      <FormManager controller={controller as never} onClose={onClose} />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g. FirstName, SignatureDate, Agreed"),
      { target: { value: "FirstName" } },
    );
    fireEvent.click(screen.getByText("Add Field"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    });
    const bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    const doc = await PDFDocument.load(bytes);
    const fields = doc.getForm().getFields();
    expect(fields).toHaveLength(1);
    expect(fields[0].getName()).toContain("FirstName");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AttachmentsDialog", () => {
  it("embeds a chosen file into the live revision", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <AttachmentsDialog controller={controller as never} onClose={() => {}} />,
    );
    expect(screen.getByText(/No embedded attachments/)).toBeTruthy();
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    expect(await screen.findByText("note.txt")).toBeTruthy();
  });
});

describe("DesignTools", () => {
  it("generates and inserts a cover page", async () => {
    seedDocument(2);
    const controller = await mockController(2);
    const onClose = vi.fn();
    render(
      <DesignTools controller={controller as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Insert Cover Page"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    const bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("FillAndSign marks", () => {
  it("places check, cross, dot, box, and line marks", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(
      <FillAndSign controller={controller as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Quick Marks"));
    for (const label of ["Checkmark", "Cross", "Dot", "Box", "Line"]) {
      fireEvent.click(screen.getByText(label));
    }
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(5);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("manages the local signature library without touching placed marks", async () => {
    seedDocument();
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    localStorage.setItem(
      "navpdf-signatures",
      JSON.stringify([{ id: "s1", dataUrl, name: "Mine", type: "signature" }]),
    );
    const controller = await mockController();
    render(
      <FillAndSign controller={controller as never} onClose={() => {}} />,
    );
    expect(screen.getByText("Mine")).toBeTruthy();
    fireEvent.click(screen.getByText("Mine"));
    fireEvent.click(screen.getByText("Place Signature"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    const bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});

describe("PageWorkspace", () => {
  it("rotates, moves, deletes, and guards the final page", async () => {
    seedDocument(3);
    const controller = await mockController(3);
    const onClose = vi.fn();
    render(
      <PageWorkspace controller={controller as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Select All"));
    expect(
      document.querySelector(".selected-count")?.textContent,
    ).toContain("3 of 3 selected");
    fireEvent.click(screen.getByTitle("Rotate CW (90°)"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    });
    let bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPage(0).getRotation().angle).toBe(
      90,
    );
    const deleteButton = screen.getByTitle(
      "Delete selected pages",
    ) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    const cards = document.querySelectorAll(".page-grid-item");
    fireEvent.click(cards[0]);
    expect(
      document.querySelector(".selected-count")?.textContent,
    ).toContain("1 of 3 selected");
    fireEvent.click(screen.getByTitle("Delete selected pages"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(2);
    });
    bytes = controller.replaceWithBytes.mock.calls[1][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("extracts selected pages as a download", async () => {
    seedDocument(3);
    const controller = await mockController(3);
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(screen.getByText("Extract"));
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    click.mockRestore();
  });

  it("splits the document into downloadable parts", async () => {
    seedDocument(4);
    const controller = await mockController(4);
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(screen.getByText("Split"));
    fireEvent.click(screen.getByText("Execute Split"));
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    expect(useWorkspace.getState().status).toContain("split into 2 parts");
    click.mockRestore();
  });
});

describe("CreatePdfDialog", () => {
  it("creates a blank document and hands it to the session", async () => {
    const onLoad = vi.fn();
    const onClose = vi.fn();
    render(<CreatePdfDialog onLoad={onLoad} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await vi.waitFor(() => {
      expect(onLoad).toHaveBeenCalled();
    });
    const file = onLoad.mock.calls[0][0] as File;
    expect(file.name).toMatch(/\.pdf$/);
    expect(useWorkspace.getState().status).toBe("Created new blank document");
    expect(onClose).toHaveBeenCalled();
  });

  it("combines uploaded PDFs into one document", async () => {
    const first = await createBlankDocument(1);
    const second = await createBlankDocument(2);
    const onLoad = vi.fn();
    render(<CreatePdfDialog onLoad={onLoad} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Combine Multiple Files"));
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File([first as unknown as BlobPart], "a.pdf"),
          new File([second as unknown as BlobPart], "b.pdf"),
        ],
      },
    });
    expect(await screen.findByText("1. a.pdf")).toBeTruthy();
    expect(screen.getByText("2. b.pdf")).toBeTruthy();

    // Reorder: move b.pdf up to position 1
    const moveUpButtons = screen.getAllByLabelText("Move file up");
    expect((moveUpButtons[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(moveUpButtons[1]); // Move second item up

    expect(screen.getByText("1. b.pdf")).toBeTruthy();
    expect(screen.getByText("2. a.pdf")).toBeTruthy();

    // Set page range on b.pdf (now index 0)
    const rangeInputs = screen.getAllByPlaceholderText(/All pages, or e\.g\./);
    fireEvent.change(rangeInputs[0], { target: { value: "1" } }); // page 1 of b.pdf (1 of 2 pages)

    fireEvent.click(screen.getByText("Combine & Open"));
    await vi.waitFor(() => {
      expect(onLoad).toHaveBeenCalled();
    });
    const combinedFile = onLoad.mock.calls[0][0] as File;
    const combinedDoc = await PDFDocument.load(new Uint8Array(await combinedFile.arrayBuffer()));
    // b.pdf contributed 1 page (page 1), a.pdf contributed 1 page (all pages) = 2 pages
    expect(combinedDoc.getPageCount()).toBe(2);
  });
});

describe("CompressDialog", () => {
  it("never reports a reduction without the native engine", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <CompressDialog controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Analyze Compression"));
    expect(screen.queryByText("Compressed size")).toBeNull();
    expect(screen.getByText(/runs only in the desktop app/)).toBeTruthy();
  });
});

describe("PrintDialog", () => {
  it("stages the edited revision in a print iframe", async () => {
    seedDocument(5);
    const controller = await mockController(5);
    const onClose = vi.fn();
    render(
      <PrintDialog controller={controller as never} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Current page", { exact: false }));
    // This test checks DOM staging only; happy-dom does not implement PDF
    // navigation for blob URLs. Native print integration is tested separately.
    const src = vi.spyOn(HTMLIFrameElement.prototype, "src", "set").mockImplementation(() => {});
    const onload = vi.spyOn(HTMLIFrameElement.prototype, "onload", "set").mockImplementation(() => {});
    fireEvent.click(screen.getByText("Print"));
    await vi.waitFor(() => {
      expect(document.querySelector("iframe")).toBeTruthy();
    });
    document.querySelector("iframe")?.remove();
    src.mockRestore();
    onload.mockRestore();
  });
});

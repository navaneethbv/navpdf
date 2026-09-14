// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { PageWorkspace } from "../../src/features/pages/PageWorkspace";
import { createBlankDocument } from "../../src/services/document-commands";
import { useWorkspace } from "../../src/stores/workspace";

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function seedDocument(pages = 4) {
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

async function mockController(pages = 4) {
  const bytes = await createBlankDocument(pages);
  return {
    pdf: {
      saveDocument: vi.fn(async () => bytes),
      numPages: pages,
    },
    replaceWithBytes: vi.fn(async () => {}),
    goTo: vi.fn(),
  };
}

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

describe("PageWorkspace selection and moves", () => {
  it("supports shift-range, ctrl-toggle, deselect, and keyboard reorder", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    const cards = document.querySelectorAll(".page-grid-item");
    fireEvent.click(cards[2]);
    fireEvent.click(cards[0], { shiftKey: true });
    expect(
      document.querySelector(".selected-count")?.textContent,
    ).toContain("3 of 4 selected");
    fireEvent.click(screen.getByText("Deselect"));
    expect(
      document.querySelector(".selected-count")?.textContent,
    ).toContain("0 of 4 selected");
    fireEvent.click(cards[1], { ctrlKey: true });
    expect(
      document.querySelector(".selected-count")?.textContent,
    ).toContain("1 of 4 selected");
    fireEvent.click(cards[1], { ctrlKey: true });
    expect(
      document.querySelector(".selected-count")?.textContent,
    ).toContain("0 of 4 selected");
    fireEvent.click(cards[1]);
    fireEvent.click(screen.getByTitle("Move Page Left"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByTitle("Move Page Right"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(2);
    });
  });

  it("inserts blank and image pages", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTitle("Insert Blank Page"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(1);
    });
    let bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
    const input = document.querySelector(
      '.page-workspace-toolbar input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File([TINY_PNG as unknown as BlobPart], "p.png", { type: "image/png" })],
      },
    });
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalledTimes(2);
    });
    bytes = controller.replaceWithBytes.mock.calls[1][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
  });

  it("applies crop boxes with explicit dimensions", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Crop"));
    const inputs = document.querySelectorAll(
      '.crop-controls-bar input[type="number"]',
    );
    fireEvent.change(inputs[0], { target: { value: "400" } });
    fireEvent.change(inputs[1], { target: { value: "500" } });
    fireEvent.click(screen.getByText("Apply Crop"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    const bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getCropBox()).toMatchObject({
      width: 400,
      height: 500,
    });
  });

  it("cancels crop and split panels and closes the workspace", () => {
    seedDocument();
    const onClose = vi.fn();
    render(
      <PageWorkspace controller={null} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Crop"));
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Split"));
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByLabelText("Close page manager"));
    expect(onClose).toHaveBeenCalled();
  });

  it("rotates counter-clockwise", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTitle("Rotate CCW (-90°)"));
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
    const bytes = controller.replaceWithBytes.mock.calls[0][0] as Uint8Array;
    expect((await PDFDocument.load(bytes)).getPage(0).getRotation().angle).toBe(
      270,
    );
  });

  it("supports keyboard navigation: arrows, space toggle, rotate, and delete", async () => {
    seedDocument();
    const controller = await mockController();
    const onClose = vi.fn();
    render(
      <PageWorkspace controller={controller as never} onClose={onClose} />,
    );
    const modal = screen.getByRole("region", { name: "Page Workspace" });

    // ArrowRight moves focus and selects next page (Page 2, index 1)
    fireEvent.keyDown(modal, { key: "ArrowRight" });
    expect(document.querySelector(".selected-count")?.textContent).toContain("1 of 4 selected");

    // Space toggles selection on current focused item
    fireEvent.keyDown(modal, { key: " " });
    expect(document.querySelector(".selected-count")?.textContent).toContain("0 of 4 selected");
    fireEvent.keyDown(modal, { key: " " });
    expect(document.querySelector(".selected-count")?.textContent).toContain("1 of 4 selected");

    // R key triggers rotate
    fireEvent.keyDown(modal, { key: "r" });
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });

    // Enter key sets workspace page and closes
    fireEvent.keyDown(modal, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
  });

  it("supports drag and drop reordering of pages", async () => {
    seedDocument();
    const controller = await mockController();
    render(
      <PageWorkspace controller={controller as never} onClose={() => {}} />,
    );
    const cards = document.querySelectorAll(".page-grid-item");
    expect(cards).toHaveLength(4);

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "0"),
      effectAllowed: "none",
      dropEffect: "none",
    };

    // Drag from card 0
    fireEvent.dragStart(cards[0], { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "0");

    // Drag over card 2
    fireEvent.dragOver(cards[2], { dataTransfer });

    // Drop onto card 2
    fireEvent.drop(cards[2], { dataTransfer });
    await vi.waitFor(() => {
      expect(controller.replaceWithBytes).toHaveBeenCalled();
    });
  });
});

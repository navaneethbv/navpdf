// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PageWorkspace } from "../../src/features/pages/PageWorkspace";
import { PagePropertiesDialog } from "../../src/features/pages/PagePropertiesDialog";
import { PropertiesDialog } from "../../src/features/document/PropertiesDialog";
import {
  FileCommentDialog,
  TextEditProposalDialog,
} from "../../src/features/annotations/CommentDialogs";
import { clearPageClipboard, getPageClipboard } from "../../src/features/pages/page-clipboard";
import { createBlankDocument } from "../../src/services/document-commands";
import { readPageBoxes, readPageTransitions } from "../../src/services/pdf/page-properties";
import { readMetadata } from "../../src/services/pdf/metadata";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  clearPageClipboard();
  vi.restoreAllMocks();
});

function seed(pages: number) {
  act(() => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 100 },
      info: { pages, encrypted: false, title: "", author: "", version: "1.7" },
      page: 1,
    });
  });
}

async function controllerFor(bytes: Uint8Array, pages = 1) {
  return {
    pdf: {
      numPages: pages,
      saveDocument: vi.fn(async () => bytes),
      getPage: vi.fn(async () => ({ view: [0, 0, 400, 300] })),
    },
    replaceWithBytes: vi.fn(async () => {}),
    addTextEditProposal: vi.fn(async () => {}),
    addFileComment: vi.fn(async () => {}),
    goTo: vi.fn(),
  };
}

const lastBytes = (controller: { replaceWithBytes: ReturnType<typeof vi.fn> }) =>
  controller.replaceWithBytes.mock.calls.at(-1)?.[0] as unknown as Uint8Array;

it("copies, cuts and pastes pages with keyboard shortcuts and buttons", async () => {
  seed(3);
  const current = await controllerFor(await createBlankDocument(3), 3);
  render(<PageWorkspace controller={current as never} onClose={() => {}} />);
  expect(screen.getByTitle("Copy or cut pages first")).toHaveProperty("disabled", true);
  const cards = document.querySelectorAll(".page-grid-item");
  fireEvent.click(cards[1]);
  fireEvent.keyDown(cards[1], { key: "c", ctrlKey: true });
  await vi.waitFor(() => expect(getPageClipboard()?.pages).toBe(1));
  const paste = screen.getByTitle("Paste 1 page(s) after the selection (Cmd/Ctrl+V)");
  fireEvent.click(paste);
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalledTimes(1));
  expect((await PDFDocument.load(lastBytes(current))).getPageCount()).toBe(4);
  fireEvent.click(screen.getByTitle("Cut selected pages (Cmd/Ctrl+X)"));
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalledTimes(2));
  expect((await PDFDocument.load(lastBytes(current))).getPageCount()).toBe(2);
});

it("enlarges thumbnails with the size slider", async () => {
  seed(1);
  const current = await controllerFor(await createBlankDocument(1));
  render(<PageWorkspace controller={current as never} onClose={() => {}} />);
  const slider = screen.getByLabelText("Thumbnail size");
  fireEvent.change(slider, { target: { value: "3" } });
  const grid = screen.getByRole("grid", { name: "Pages grid" });
  expect(grid.style.getPropertyValue("--page-card-scale")).toBe("2");
  expect(slider.getAttribute("aria-valuetext")).toBe("200%");
});

it("sets a trim box and a transition from the page properties dialog", async () => {
  const current = await controllerFor(await createBlankDocument(2), 2);
  render(<PagePropertiesDialog controller={current as never} onClose={() => {}} />);
  const apply = await screen.findByRole("button", { name: "Apply" });
  await vi.waitFor(() => expect(apply).toHaveProperty("disabled", false));
  fireEvent.click(apply);
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalledTimes(1));
  const boxes = await readPageBoxes(lastBytes(current));
  expect(boxes.every((box) => box.trim !== null)).toBe(true);

  current.pdf.saveDocument.mockResolvedValue(lastBytes(current));
  fireEvent.change(screen.getByLabelText("Setting"), { target: { value: "transition" } });
  fireEvent.change(screen.getByLabelText("Pages"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Page range"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalledTimes(2));
  const transitions = await readPageTransitions(lastBytes(current));
  expect(transitions[0]).toBeNull();
  expect(transitions[1]?.style).toBe("Dissolve");

  fireEvent.change(screen.getByLabelText("Page range"), { target: { value: "9-x" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(current.replaceWithBytes).toHaveBeenCalledTimes(2);
});

it("edits custom properties and lists fonts", async () => {
  const doc = await PDFDocument.create();
  doc.addPage().drawText("x", { font: await doc.embedFont(StandardFonts.Helvetica) });
  const current = await controllerFor(await doc.save());
  const close = vi.fn();
  render(<PropertiesDialog controller={current as never} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: /Add Property/ }));
  fireEvent.change(screen.getByLabelText("Custom property 1 name"), {
    target: { value: "Project" },
  });
  fireEvent.change(screen.getByLabelText("Custom property 1 value"), {
    target: { value: "Atlas" },
  });
  expect(await screen.findByText("Fonts (1)")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Fonts used in this PDF" }).textContent).toContain(
    "Helvetica",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save properties" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect((await readMetadata(lastBytes(current))).custom).toEqual([
    { name: "Project", value: "Atlas" },
  ]);
});

it("proposes a replacement for the captured selection", async () => {
  const current = await controllerFor(await createBlankDocument(1));
  const close = vi.fn();
  render(<TextEditProposalDialog controller={current as never} onClose={close} />);
  expect(screen.getByRole("alert").textContent).toContain("Select text");
  const selection = [{ page: 1, quads: [{ x1: 1, y1: 1, x2: 20, y2: 10 }], text: "old" }];
  act(() => useWorkspace.getState().set({ textEditSelection: selection }));
  fireEvent.change(screen.getByLabelText(/Replacement text/), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Propose Replacement" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(current.addTextEditProposal).toHaveBeenCalledWith("replace", selection, "new");
  expect(useWorkspace.getState().textEditSelection).toEqual([]);
});

it("attaches a chosen file at the chosen corner", async () => {
  const current = await controllerFor(await createBlankDocument(1));
  render(<FileCommentDialog controller={current as never} onClose={() => {}} />);
  const attach = screen.getByRole("button", { name: "Attach File" });
  expect(attach).toHaveProperty("disabled", true);
  const file = new File(["data"], "notes.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText(/Position/), { target: { value: "bottom-left" } });
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Receipts" } });
  fireEvent.click(attach);
  await vi.waitFor(() => expect(current.addFileComment).toHaveBeenCalled());
  const [payload, description, page, at] = current.addFileComment.mock.calls[0] as unknown as [
    { name: string; data: Uint8Array },
    string,
    number,
    [number, number],
  ];
  expect(payload.name).toBe("notes.txt");
  expect(new TextDecoder().decode(payload.data)).toBe("data");
  expect([description, page, at]).toEqual(["Receipts", 1, [24, 24]]);
});

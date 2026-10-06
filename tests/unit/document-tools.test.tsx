// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { StampDialog } from "../../src/features/annotations/StampDialog";
import { FlattenDialog } from "../../src/features/document/FlattenDialog";
import { addStamp } from "../../src/services/pdf/stamps";
import { useWorkspace } from "../../src/stores/workspace";

async function blankPdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

/** A controller double that serializes real bytes and records the committed replacement. */
async function editableController(bytes?: Uint8Array) {
  const source = bytes ?? (await blankPdf());
  const pdf = { saveDocument: vi.fn(async () => source) };
  const replaceWithBytes = vi.fn(async () => undefined);
  return { controller: { pdf, replaceWithBytes }, pdf, replaceWithBytes };
}

function seed(pages = 2) {
  act(() =>
    useWorkspace.getState().set({
      document: { id: "doc", name: "report.pdf", size: 100 },
      info: { pages, encrypted: false, title: "", author: "", version: "1.7" },
      page: 1,
    }),
  );
}

async function committed(replaceWithBytes: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(replaceWithBytes).toHaveBeenCalled());
  const [bytes, status, options] = replaceWithBytes.mock.calls[0] as [
    Uint8Array,
    string,
    { preMutationBytes: Uint8Array },
  ];
  return { doc: await PDFDocument.load(bytes), status, options };
}

beforeEach(() => {
  useWorkspace.getState().reset();
});

describe("StampDialog", () => {
  it("adds a custom stamp to the chosen page with undo history", async () => {
    seed();
    const { controller, replaceWithBytes, pdf } = await editableController();
    const onClose = vi.fn();
    render(<StampDialog controller={controller as never} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Stamp"), { target: { value: "Custom" } });
    expect(screen.getByRole("button", { name: "Add Stamp" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Stamp text"), { target: { value: "Paid" } });
    fireEvent.change(screen.getByLabelText("Reviewer name (optional)"), {
      target: { value: "Sam" },
    });
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Stamp" }));

    const { doc, status, options } = await committed(replaceWithBytes);
    expect(status).toBe("Stamp added to page 2");
    expect(options.preMutationBytes).toBe(await pdf.saveDocument.mock.results[0].value);
    expect(doc.getPage(0).node.Annots()).toBeUndefined();
    const stamp = doc.context.lookup(doc.getPage(1).node.Annots()!.get(0), PDFDict);
    expect(stamp.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Stamp"));
    expect(stamp.get(PDFName.of("T"))?.toString()).toContain("Sam");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useWorkspace.getState().status).toBe("Stamp added to page 2");
  });

  it("keeps the dialog open with the error when the stamp cannot be drawn", async () => {
    seed();
    const { controller, replaceWithBytes } = await editableController();
    const onClose = vi.fn();
    render(<StampDialog controller={controller as never} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Stamp"), { target: { value: "Custom" } });
    fireEvent.change(screen.getByLabelText("Stamp text"), { target: { value: "済" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Stamp" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringMatching(/built-in fonts/),
    );
    expect(replaceWithBytes).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("FlattenDialog", () => {
  it("flattens comments and reports what changed", async () => {
    seed();
    const stamped = await addStamp(await blankPdf(1), {
      page: 1,
      stamp: "Draft",
      position: "center",
    });
    const { controller, replaceWithBytes } = await editableController(stamped);
    const onClose = vi.fn();
    render(<FlattenDialog controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Form fields and their current values"));
    fireEvent.click(screen.getByRole("button", { name: "Flatten" }));
    const { doc, status } = await committed(replaceWithBytes);
    expect(status).toBe("Flattened 1 comment(s) and markup.");
    expect(doc.getPage(0).node.Annots()).toBeUndefined();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("requires a choice and explains when nothing can be flattened", async () => {
    seed();
    const { controller, replaceWithBytes } = await editableController(await blankPdf(1));
    render(<FlattenDialog controller={controller as never} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Comments, markup and stamps"));
    fireEvent.click(screen.getByLabelText("Form fields and their current values"));
    expect(screen.getByRole("button", { name: "Flatten" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("Comments, markup and stamps"));
    fireEvent.click(screen.getByRole("button", { name: "Flatten" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing to flatten/);
    expect(replaceWithBytes).not.toHaveBeenCalled();
  });
});

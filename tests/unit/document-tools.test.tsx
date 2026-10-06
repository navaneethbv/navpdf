// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { StampDialog } from "../../src/features/annotations/StampDialog";
import { FlattenDialog } from "../../src/features/document/FlattenDialog";
import { addStamp } from "../../src/services/pdf/stamps";
import { PageLabelsDialog } from "../../src/features/pages/PageLabelsDialog";
import { ImposeDialog } from "../../src/features/pages/ImposeDialog";
import { CommentSummaryDialog } from "../../src/features/annotations/CommentSummaryDialog";
import { FieldLayoutDialog } from "../../src/features/forms/FieldLayoutDialog";
import { AccessibilityDialog } from "../../src/features/document/AccessibilityDialog";
import { readWidgets } from "../../src/services/pdf/field-geometry";
import { readPageLabels, setPageLabels } from "../../src/services/pdf/page-labels";
import { useWorkspace } from "../../src/stores/workspace";

async function blankPdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

/** A controller double that serializes real bytes and records the committed replacement. */
async function editableController(bytes?: Uint8Array) {
  const source = bytes ?? (await blankPdf());
  const pdf = {
    numPages: (await PDFDocument.load(source)).getPageCount(),
    saveDocument: vi.fn(async () => source),
    getPermissions: vi.fn(async () => null),
    getPage: vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({ items: [{ str: "Page text" }] })),
    })),
  };
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

/** Records browser-preview downloads: each saved blob and its file name. */
function captureSaves() {
  const saved: Blob[] = [];
  const names: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    saved.push(blob as Blob);
    return "blob:saved";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { saved, names };
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
  vi.restoreAllMocks();
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

describe("PageLabelsDialog", () => {
  it("loads existing ranges, previews edits and applies them", async () => {
    seed(4);
    const labeled = await setPageLabels(await blankPdf(4), [
      { startPage: 1, style: "roman-lower", prefix: "", firstNumber: 1 },
    ]);
    const { controller, replaceWithBytes } = await editableController(labeled);
    const onClose = vi.fn();
    render(<PageLabelsDialog controller={controller as never} onClose={onClose} />);
    expect(await screen.findByText("Preview: i, ii, iii, iv")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add Range/ }));
    const starts = screen.getAllByLabelText("Starts on page");
    fireEvent.change(starts[1], { target: { value: "3" } });
    fireEvent.change(screen.getAllByLabelText("Prefix")[1], { target: { value: "P-" } });
    expect(screen.getByText("Preview: i, ii, P-1, P-2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply Labels" }));
    const { doc, status } = await committed(replaceWithBytes);
    expect(status).toBe("Page labels updated");
    expect(readPageLabels(doc).map((range) => [range.startPage, range.prefix])).toEqual([
      [1, ""],
      [3, "P-"],
    ]);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("explains invalid ranges and can restore plain numbers", async () => {
    seed(3);
    const { controller, replaceWithBytes } = await editableController(await blankPdf(3));
    render(<PageLabelsDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText("Preview: 1, 2, 3");
    fireEvent.click(screen.getByRole("button", { name: /Add Range/ }));
    fireEvent.change(screen.getAllByLabelText("Starts on page")[1], { target: { value: "1" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Two label ranges start on page 1/);
    expect(screen.getByRole("button", { name: "Apply Labels" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Use Plain Numbers" }));
    const { doc, status } = await committed(replaceWithBytes);
    expect(status).toBe("Page labels removed");
    expect(readPageLabels(doc)).toEqual([]);
  });
});

describe("ImposeDialog", () => {
  it("saves a new booklet PDF without changing the open document", async () => {
    seed(3);
    const { controller, replaceWithBytes } = await editableController(await blankPdf(3));
    const { saved, names } = captureSaves();
    const onClose = vi.fn();
    render(<ImposeDialog controller={controller as never} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Layout"), { target: { value: "booklet" } });
    expect(screen.getByText(/flipping on the short edge/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(names).toEqual(["report-booklet.pdf"]);
    const booklet = await PDFDocument.load(new Uint8Array(await saved[0].arrayBuffer()));
    expect(booklet.getPageCount()).toBe(2);
    expect(replaceWithBytes).not.toHaveBeenCalled();
    expect(useWorkspace.getState().status).toBe("Saved a 2-sheet booklet PDF");
  });

  it("validates the page range before arranging", async () => {
    seed(3);
    const { controller } = await editableController(await blankPdf(3));
    render(<ImposeDialog controller={controller as never} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Pages (all when empty)"), { target: { value: "2-" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Incomplete range/);
    expect(screen.getByRole("button", { name: "Save PDF" })).toHaveProperty("disabled", true);
  });
});

describe("CommentSummaryDialog", () => {
  it("saves a CSV summary of the document's comments", async () => {
    seed(1);
    const stamped = await addStamp(await blankPdf(1), {
      page: 1,
      stamp: "Approved",
      position: "center",
      author: "Rae",
    });
    const { controller, replaceWithBytes } = await editableController(stamped);
    const { saved, names } = captureSaves();
    const onClose = vi.fn();
    render(<CommentSummaryDialog controller={controller as never} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "csv" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Summary" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(names).toEqual(["report-comments.csv"]);
    expect(await saved[0].text()).toContain(",Stamp,Rae,");
    expect(replaceWithBytes).not.toHaveBeenCalled();
    expect(useWorkspace.getState().status).toBe("Summarized 1 comment(s)");
  });

  it("explains when there is nothing to summarize", async () => {
    seed(1);
    const { controller } = await editableController(await blankPdf(1));
    const { names } = captureSaves();
    render(<CommentSummaryDialog controller={controller as never} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Summary" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no comments/);
    expect(names).toEqual([]);
  });
});

describe("FieldLayoutDialog", () => {
  async function formPdf() {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    form.createTextField("First").addToPage(page, { x: 72, y: 700, width: 200, height: 20 });
    form.createTextField("Second").addToPage(page, { x: 72, y: 650, width: 200, height: 20 });
    return doc.save();
  }

  it("moves the chosen field and stays open for more changes", async () => {
    seed(1);
    const { controller, replaceWithBytes } = await editableController(await formPdf());
    const onClose = vi.fn();
    render(<FieldLayoutDialog controller={controller as never} onClose={onClose} />);
    const field = await screen.findByLabelText("Field");
    fireEvent.change(field, { target: { value: "0:Second" } });
    expect((screen.getByLabelText("From left (points)") as HTMLInputElement).value).toBe("71.5");
    fireEvent.change(screen.getByLabelText("From left (points)"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("From top (points)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const { doc, status } = await committed(replaceWithBytes);
    expect(status).toBe('Form field "Second" moved');
    const second = (await readWidgets(await doc.save())).find((item) => item.field === "Second");
    expect(second).toMatchObject({ x: 300, y: 40 });
    expect(await screen.findByText("Field moved.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("explains documents without fields and invalid sizes", async () => {
    seed(1);
    const { controller } = await editableController(await blankPdf(1));
    const { unmount } = render(
      <FieldLayoutDialog controller={controller as never} onClose={vi.fn()} />,
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/no form fields/);
    unmount();

    const form = await editableController(await formPdf());
    render(<FieldLayoutDialog controller={form.controller as never} onClose={vi.fn()} />);
    await screen.findByLabelText("Field");
    fireEvent.change(screen.getByLabelText("Width (points)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 4 points/);
    expect(form.replaceWithBytes).not.toHaveBeenCalled();
  });
});

describe("AccessibilityDialog", () => {
  it("lists check results and applies title and language fixes", async () => {
    seed(1);
    const { controller, replaceWithBytes } = await editableController(await blankPdf(1));
    render(<AccessibilityDialog controller={controller as never} onClose={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Accessibility checks" });
    expect(list.textContent).toMatch(/Tagged PDF \(Failed\)/);
    expect(list.textContent).toMatch(/Pages have real text \(Passed\)/);
    expect(screen.getByRole("button", { name: "Fix Selected Issues" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Annual plan" } });
    fireEvent.change(screen.getByLabelText("Language (for example en-US)"), {
      target: { value: "de-DE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fix Selected Issues" }));
    const { doc, status } = await committed(replaceWithBytes);
    expect(status).toBe("Accessibility settings updated");
    expect(doc.getTitle()).toBe("Annual plan");
    expect(doc.catalog.lookup(PDFName.of("Lang"))?.toString()).toContain("de-DE");
  });

  it("disables fixing until the language code is valid", async () => {
    seed(1);
    const { controller } = await editableController(await blankPdf(1));
    render(<AccessibilityDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByRole("list", { name: "Accessibility checks" });
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Plan" } });
    fireEvent.change(screen.getByLabelText("Language (for example en-US)"), {
      target: { value: "not a language" },
    });
    expect(screen.getByRole("button", { name: "Fix Selected Issues" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

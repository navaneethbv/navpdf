// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, PDFName } from "pdf-lib";
import { LinkToolsDialog } from "../../src/features/editor/LinkToolsDialog";
import { HeadingBookmarksDialog } from "../../src/features/bookmarks/HeadingBookmarksDialog";
import { SpaceAuditDialog, spaceAuditCsv } from "../../src/features/document/SpaceAuditDialog";
import { FieldLayoutDialog } from "../../src/features/forms/FieldLayoutDialog";
import { MeasureDialog } from "../../src/features/annotations/MeasureDialog";
import { FormDataDialog } from "../../src/features/forms/FormDataDialog";
import { useWorkspace } from "../../src/stores/workspace";
import { inspectLinks } from "../../src/services/pdf/link-tools";
import { loadBookmarks } from "../../src/services/pdf/bookmarks";
import { readWidgets } from "../../src/services/pdf/field-geometry";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.restoreAllMocks();
});

function controllerFor(bytes: Uint8Array, pages: { items: unknown[]; rotate?: number }[] = []) {
  return {
    pdf: {
      numPages: Math.max(1, pages.length),
      saveDocument: vi.fn(async () => bytes),
      getPage: vi.fn(async (n: number) => ({
        rotate: pages[n - 1]?.rotate ?? 0,
        getTextContent: async () => ({ items: pages[n - 1]?.items ?? [] }),
      })),
    },
    replaceWithBytes: vi.fn(async () => {}),
  };
}

function savedBytes(controller: ReturnType<typeof controllerFor>) {
  return controller.replaceWithBytes.mock.calls[0]?.[0] as unknown as Uint8Array;
}

function captureDownloads() {
  const saved: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    saved.push(blob as Blob);
    return "blob:test";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return saved;
}

const textItem = (str: string, size: number, y: number) => ({
  str,
  transform: [size, 0, 0, size, 40, y],
  width: str.length * size * 0.5,
  height: size,
});

async function linkedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [0, 0, 10, 10],
        Dest: PDFName.of("x"),
      }),
    ),
  );
  return doc.save();
}

it("shows the link inventory and removes broken links with a source revision", async () => {
  const current = controllerFor(await linkedPdf());
  render(<LinkToolsDialog controller={current as never} onClose={() => {}} />);
  expect(await screen.findByText("1 broken page link")).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Remove broken links/));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalled());
  expect((await inspectLinks(savedBytes(current))).total).toBe(0);
  expect(current.replaceWithBytes.mock.calls[0][1]).toBe("Removed 1 link");
});

it("creates links from addresses in the text layer and reports when none exist", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const bytes = await doc.save();
  const current = controllerFor(bytes, [
    { items: [textItem("Go to https://example.com now", 10, 200)] },
  ]);
  render(<LinkToolsDialog controller={current as never} onClose={() => {}} />);
  await screen.findByText("0 links in total");
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalled());
  expect(await inspectLinks(savedBytes(current))).toMatchObject({ total: 1, web: 1 });

  const empty = controllerFor(bytes, [{ items: [] }]);
  render(<LinkToolsDialog controller={empty as never} onClose={() => {}} />);
  const buttons = await screen.findAllByRole("button", { name: "Apply" });
  fireEvent.click(buttons.at(-1)!);
  expect((await screen.findByRole("alert")).textContent).toContain("No web addresses");
  expect(empty.replaceWithBytes).not.toHaveBeenCalled();
});

it("previews headings and saves them as bookmarks", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const current = controllerFor(await doc.save(), [
    {
      items: [
        textItem("Chapter One", 24, 250),
        textItem("Plain body text on the page", 11, 200),
        textItem("More plain body text", 11, 180),
      ],
    },
  ]);
  const close = vi.fn();
  render(<HeadingBookmarksDialog controller={current as never} onClose={close} />);
  expect(await screen.findByText("Chapter One")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create Bookmarks" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect((await loadBookmarks(savedBytes(current))).map((entry) => entry.title)).toEqual([
    "Chapter One",
  ]);
});

it("does not apply headings found in a document that was replaced", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const current = controllerFor(await doc.save(), [
    { items: [textItem("Chapter One", 24, 250), textItem("Body text here", 11, 200)] },
  ]);
  render(<HeadingBookmarksDialog controller={current as never} onClose={() => {}} />);
  await screen.findByText("Chapter One");
  current.pdf = { ...current.pdf };
  fireEvent.click(screen.getByRole("button", { name: "Create Bookmarks" }));
  expect((await screen.findByRole("alert")).textContent).toContain("document changed");
  expect(current.replaceWithBytes).not.toHaveBeenCalled();
});

it("shows space usage and exports it as CSV", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText("Hello");
  const current = controllerFor(await doc.save());
  const saved = captureDownloads();
  const close = vi.fn();
  render(<SpaceAuditDialog controller={current as never} onClose={close} />);
  expect(await screen.findByRole("table", { name: "Space used by content type" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(await saved[0].text()).toContain("Category,Objects,Bytes,Share");
  expect(spaceAuditCsv({ fileBytes: 1, measuredBytes: 0, rows: [] }).startsWith("﻿Category")).toBe(
    true,
  );
});

it("arranges a chosen field with the anchor field", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  form.createTextField("anchor").addToPage(page, { x: 50, y: 300, width: 120, height: 24 });
  form.createTextField("other").addToPage(page, { x: 90, y: 200, width: 60, height: 20 });
  const current = controllerFor(await doc.save());
  render(<FieldLayoutDialog controller={current as never} onClose={() => {}} />);
  const arrange = await screen.findByRole("button", { name: "Arrange Fields" });
  expect(arrange).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText("other"));
  fireEvent.click(arrange);
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalled());
  const widgets = await readWidgets(savedBytes(current));
  expect(widgets[1].x).toBe(widgets[0].x);
  expect(await screen.findByText("Fields arranged.")).toBeTruthy();
});

it("exports saved measurements or explains that there are none", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const current = controllerFor(await doc.save());
  render(<MeasureDialog controller={current as never} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(await screen.findByText("This PDF has no saved measurements to export.")).toBeTruthy();
});

it("merges chosen filled forms into one CSV without changing the open document", async () => {
  const make = async (value: string) => {
    const doc = await PDFDocument.create();
    const field = doc.getForm().createTextField("name");
    field.addToPage(doc.addPage(), { x: 50, y: 600, width: 200, height: 20 });
    field.setText(value);
    return doc.save();
  };
  const current = controllerFor(await make("Open"));
  useWorkspace.setState({ document: { id: "doc", name: "open.pdf" } as never });
  const saved = captureDownloads();
  render(<FormDataDialog controller={current as never} onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Form data action"), {
    target: { value: "merge" },
  });
  const files = [new File([await make("Ada")], "a.pdf"), new File([await make("Lin")], "b.pdf")];
  fireEvent.change(screen.getByLabelText("Filled PDF forms"), { target: { files } });
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Merge to CSV" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Merge to CSV" }));
  expect(await screen.findByText("Merged 2 form(s) into one CSV.")).toBeTruthy();
  expect(await saved[0].text()).toBe('"File","name"\r\n"a.pdf","Ada"\r\n"b.pdf","Lin"\r\n');
  expect(current.replaceWithBytes).not.toHaveBeenCalled();
});

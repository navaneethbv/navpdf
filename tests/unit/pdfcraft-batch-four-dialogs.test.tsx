// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { FieldPropertiesDialog, FormAssistDialog } from "../../src/features/forms/FormToolsDialogs";
import { FormManager } from "../../src/features/forms/FormManager";
import { enhanceDateFields } from "../../src/features/viewer/date-fields";
import { readFieldProperties, readTabOrder } from "../../src/services/pdf/form-authoring";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.restoreAllMocks();
});

async function formBytes() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  doc.getForm().createTextField("first").addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  return doc.save();
}

/** Like the real controller, later reads return the bytes of the latest applied edit. */
function controllerFor(bytes: Uint8Array, items: unknown[] = []) {
  let current = bytes;
  return {
    pdf: {
      numPages: 2,
      saveDocument: vi.fn(async () => current),
      getPage: vi.fn(async () => ({ getTextContent: async () => ({ items }) })),
    },
    replaceWithBytes: vi.fn(async (next: Uint8Array) => {
      current = next;
    }),
    previewForm: vi.fn(),
  };
}

const saved = (controller: ReturnType<typeof controllerFor>) =>
  controller.replaceWithBytes.mock.calls.at(-1)?.[0] as unknown as Uint8Array;

it("saves field properties, duplicates fields and sets the tab order", async () => {
  const current = controllerFor(await formBytes());
  render(<FieldPropertiesDialog controller={current as never} onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Tooltip"), { target: { value: "Your name" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Name" } });
  fireEvent.click(screen.getByLabelText(/Lock the field/));
  fireEvent.click(screen.getByRole("button", { name: "Save Properties" }));
  expect(await screen.findByText("Field properties saved.")).toBeTruthy();
  const [field] = await readFieldProperties(saved(current));
  expect(field).toMatchObject({ name: "Name", tooltip: "Your name", locked: true });

  fireEvent.change(await screen.findByLabelText("Pages to add the field to"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalledTimes(2));
  const doc = await PDFDocument.load(saved(current));
  expect(doc.getForm().getTextField("Name").acroField.getWidgets()).toHaveLength(2);

  fireEvent.change(await screen.findByLabelText("Tab order"), { target: { value: "C" } });
  await vi.waitFor(() => expect(current.replaceWithBytes).toHaveBeenCalledTimes(3));
  expect(await readTabOrder(saved(current))).toBe("C");
});

it("reports invalid duplicate ranges without editing", async () => {
  const current = controllerFor(await formBytes());
  render(<FieldPropertiesDialog controller={current as never} onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Pages to add the field to"), {
    target: { value: "2-" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
  expect(await screen.findByText(/range/i)).toBeTruthy();
  expect(current.replaceWithBytes).not.toHaveBeenCalled();
});

it("creates detected fields and renames from labels", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText("x", { font });
  const bytes = await doc.save();
  const items = [
    { str: "City: __________", transform: [12, 0, 0, 12, 50, 700], width: 110, height: 12 },
  ];
  const current = controllerFor(bytes, items);
  current.pdf.numPages = 1;
  const close = vi.fn();
  render(<FormAssistDialog controller={current as never} onClose={close} />);
  expect(await screen.findByText("City (text, page 1)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create Fields" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect((await PDFDocument.load(saved(current))).getForm().getTextField("City")).toBeTruthy();
});

it("offers new field types and the preview in Prepare Form", async () => {
  useWorkspace.getState().set({ info: { pages: 2 } as never, page: 1 });
  const current = controllerFor(await formBytes());
  const close = vi.fn();
  render(<FormManager controller={current as never} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: /Date/ }));
  expect(screen.getByLabelText("Date Format")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Image/ }));
  fireEvent.change(screen.getByPlaceholderText(/FirstName/), { target: { value: "Photo" } });
  expect(screen.getByRole("button", { name: /Add Field/ })).toHaveProperty("disabled", true);
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: /Preview/ })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
  expect(close).toHaveBeenCalled();
  expect(current.previewForm).toHaveBeenCalled();
});

it("swaps date fields to a native picker and writes the field's format", () => {
  const layer = document.createElement("div");
  layer.innerHTML =
    '<input data-element-id="7R" value="04/03/2026"><input data-element-id="8R" value="soon">';
  enhanceDateFields(layer, [
    { id: "7R", datetimeFormat: "dd/mm/yyyy" },
    { id: "8R", datetimeFormat: "dd/mm/yyyy" },
    { id: "9R" },
  ]);
  const [date, text] = layer.querySelectorAll("input");
  const changes = vi.fn();
  date.addEventListener("input", changes);
  date.dispatchEvent(new Event("focus"));
  expect(date.type).toBe("date");
  expect(date.value).toBe("2026-03-04");
  date.value = "2026-12-25";
  date.dispatchEvent(new Event("blur"));
  expect(date.type).toBe("text");
  expect(date.value).toBe("25/12/2026");
  expect(changes).toHaveBeenCalledTimes(1);
  text.dispatchEvent(new Event("focus"));
  expect(text.type).toBe("text");
  text.dispatchEvent(new Event("blur"));
  expect(text.value).toBe("soon");
});

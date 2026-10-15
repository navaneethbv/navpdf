// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { FormDataDialog } from "../../src/features/forms/FormDataDialog";
import { useWorkspace } from "../../src/stores/workspace";

const download = vi.hoisted(() =>
  vi.fn<(blob: Blob, name: string) => Promise<boolean>>(async () => true),
);
vi.mock("../../src/utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/download")>()),
  downloadBlob: download,
}));

async function formController() {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const name = form.createTextField("Applicant");
  name.setText("Before");
  name.addToPage(page);
  const check = form.createCheckBox("Consent");
  check.enableRequired();
  check.addToPage(page);
  const locked = form.createTextField("Locked");
  locked.setText("Preserve");
  locked.enableReadOnly();
  locked.addToPage(page);
  const bytes = await doc.save();
  const pdf = { saveDocument: vi.fn(async () => bytes), numPages: 1 };
  const replaceWithBytes = vi.fn(async () => undefined);
  const controller = { pdf, replaceWithBytes };
  return { controller, pdf, bytes, replaceWithBytes };
}
const json = (fields: unknown[]) =>
  JSON.stringify({ format: "navpdf-form-data", version: 1, fields });
const update = { name: "Applicant", type: "text", value: "Imported" };

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    document: { id: "original", name: "application.pdf", size: 1234 },
    info: { pages: 1, encrypted: false, title: "", author: "", version: "1.7" },
    editingAllowed: true,
  });
  download.mockClear();
  download.mockResolvedValue(true);
});

function choose(action: string) {
  fireEvent.change(screen.getByLabelText("Form data action"), { target: { value: action } });
}
function upload(text: string) {
  fireEvent.change(screen.getByLabelText("JSON form data file"), {
    target: { files: [new File([text], "data.json", { type: "application/json" })] },
  });
}

describe("FormDataDialog", () => {
  it("exports editable values as versioned JSON and formula-safe CSV", async () => {
    const { controller, replaceWithBytes } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText(/2 editable fields/);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0][1]).toBe("application-form-data.json");
    expect(JSON.parse(await download.mock.calls[0][0].text())).toEqual({
      format: "navpdf-form-data",
      version: 1,
      fields: [
        { name: "Applicant", type: "text", value: "Before" },
        { name: "Consent", type: "checkbox", value: false },
      ],
    });
    await screen.findByText("Form JSON exported.");
    choose("export-csv");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls[1][1]).toBe("application-form-data.csv");
    expect(await download.mock.calls[1][0].text()).toContain('"Applicant","text","Before"');
    expect(replaceWithBytes).not.toHaveBeenCalled();
  });

  it("previews imports, then applies saved output with an undo snapshot", async () => {
    const { controller, pdf, bytes, replaceWithBytes } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText(/2 editable fields/);
    choose("import");
    expect(screen.getByRole("button", { name: "Import Values" })).toHaveProperty("disabled", true);
    upload(json([update]));
    const preview = await screen.findByRole("table", { name: "Import preview" });
    expect(preview.textContent).toContain("Before");
    expect(preview.textContent).toContain("Imported");
    expect(replaceWithBytes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import Values" }));
    await vi.waitFor(() => expect(replaceWithBytes).toHaveBeenCalledTimes(1));
    const [output, , options] = replaceWithBytes.mock.calls[0] as unknown as [
      Uint8Array,
      string,
      { expectedSource: unknown; preMutationBytes: Uint8Array },
    ];
    expect((await PDFDocument.load(output)).getForm().getTextField("Applicant").getText()).toBe(
      "Imported",
    );
    expect(options).toEqual({ expectedSource: pdf, preMutationBytes: bytes });
  });

  it("rejects invalid imports and disables stale previews", async () => {
    const { controller, replaceWithBytes } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText(/2 editable fields/);
    choose("import");
    upload(json([update]));
    await screen.findByRole("table", { name: "Import preview" });
    upload(json([update, { name: "Missing", type: "text", value: "bad" }]));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Unknown field/);
    expect(screen.queryByRole("table", { name: "Import preview" })).toBeNull();
    expect(screen.getByRole("button", { name: "Import Values" })).toHaveProperty("disabled", true);
    expect(replaceWithBytes).not.toHaveBeenCalled();
  });

  it("checks required fields and requires an explicit checkbox before clearing", async () => {
    const { controller, replaceWithBytes } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText(/2 editable fields/);
    choose("required");
    fireEvent.click(screen.getByRole("button", { name: "Check Required Fields" }));
    const missing = await screen.findByRole("list", { name: "Missing required fields" });
    expect(missing.textContent).toContain("Consent");
    choose("reset");
    const reset = screen.getByRole("button", { name: "Clear Editable Values" });
    expect(reset).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("I confirm clearing all editable form values."));
    fireEvent.click(reset);
    await vi.waitFor(() => expect(replaceWithBytes).toHaveBeenCalledTimes(1));
    const [bytes] = replaceWithBytes.mock.calls[0] as unknown as [Uint8Array];
    const form = (await PDFDocument.load(bytes)).getForm();
    expect(form.getTextField("Applicant").getText() ?? "").toBe("");
    expect(form.getTextField("Locked").getText()).toBe("Preserve");
    await screen.findByText("Editable form values cleared.");
    expect(screen.getByRole("button", { name: "Clear Editable Values" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("does not report an export when the save picker is cancelled", async () => {
    download.mockResolvedValue(false);
    const { controller } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText(/2 editable fields/);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Export JSON" })).toHaveProperty("disabled", false),
    );
    expect(screen.queryByText("Form JSON exported.")).toBeNull();
  });

  it.each(["restricted", "encrypted"])("blocks mutations for %s documents", async (restriction) => {
    if (restriction === "restricted") useWorkspace.getState().set({ editingAllowed: false });
    else
      useWorkspace
        .getState()
        .set({ info: { pages: 1, encrypted: true, title: "", author: "", version: "1.7" } });
    const { controller, pdf, replaceWithBytes } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    if (restriction === "restricted") await screen.findByText(/2 editable fields/);
    else expect(pdf.saveDocument).not.toHaveBeenCalled();
    choose("reset");
    expect(screen.getByRole("button", { name: "Clear Editable Values" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText(
        restriction === "restricted"
          ? /Document editing is not allowed/
          : /Encrypted PDFs are read-only/,
      ),
    ).toBeTruthy();
    expect(replaceWithBytes).not.toHaveBeenCalled();
  });

  it("ignores an export after the document changes during serialization", async () => {
    const { controller, pdf, bytes } = await formController();
    render(<FormDataDialog controller={controller as never} onClose={vi.fn()} />);
    await screen.findByText(/2 editable fields/);
    let resolve!: (bytes: Uint8Array) => void;
    pdf.saveDocument.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    act(() =>
      useWorkspace
        .getState()
        .set({ document: { id: "replacement", name: "other.pdf", size: 100 } }),
    );
    await act(async () => {
      resolve(bytes);
    });
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByText("Form JSON exported.")).toBeNull();
  });
});

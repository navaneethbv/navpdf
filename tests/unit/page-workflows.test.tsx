// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { degrees, PDFDocument } from "pdf-lib";
import { PageWorkspace } from "../../src/features/pages/PageWorkspace";
import { useWorkspace } from "../../src/stores/workspace";
import { downloadBytes } from "../../src/utils/download";

vi.mock("../../src/utils/download", async (original) => ({
  ...(await original<typeof import("../../src/utils/download")>()),
  downloadBytes: vi.fn(async () => true),
}));

async function setup(pages = 5, state = {}) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    document.addPage([300 + index, 400]).setRotation(degrees(index % 2 ? 90 : 0));
  }
  const bytes = await document.save();
  act(() => {
    useWorkspace.getState().set({
      document: { id: "original", name: "report.pdf", size: bytes.length },
      info: { pages, encrypted: false, title: "", author: "", version: "1.7" },
      page: 1,
      ...state,
    });
  });
  const controller = {
    pdf: { saveDocument: vi.fn(async () => bytes), numPages: pages },
    replaceWithBytes: vi.fn<(bytes: Uint8Array, status: string, options: unknown) => Promise<void>>(
      async () => {},
    ),
  };
  const view = render(<PageWorkspace controller={controller as never} onClose={() => {}} />);
  return { controller, bytes, view };
}

function selection() {
  return screen
    .getAllByRole("gridcell")
    .flatMap((cell, index) => (cell.getAttribute("aria-selected") === "true" ? [index] : []));
}

function selectRange(value: string) {
  fireEvent.change(screen.getByLabelText("Select page range"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Select range" }));
}

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
  vi.mocked(downloadBytes).mockResolvedValue(true);
});

describe("page workflow controls", () => {
  it("selects typed ranges and keeps selection when validation fails", async () => {
    await setup();
    selectRange("2-4, 2");
    expect(selection()).toEqual([1, 2, 3]);
    selectRange("1-9007199254740992");
    expect(screen.getByRole("alert").textContent).toContain("page");
    expect(selection()).toEqual([1, 2, 3]);
  });

  it("selects odd, even and inverse page sets", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Odd pages" }));
    expect(selection()).toEqual([0, 2, 4]);
    fireEvent.click(screen.getByRole("button", { name: "Even pages" }));
    expect(selection()).toEqual([1, 3]);
    fireEvent.click(screen.getByRole("button", { name: "Invert selection" }));
    expect(selection()).toEqual([0, 2, 4]);
  });

  it("reverses pages with mapping and preserves selection identity", async () => {
    const { controller, bytes } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Reverse pages" }));
    await vi.waitFor(() => expect(controller.replaceWithBytes).toHaveBeenCalledOnce());
    const [output, , options] = controller.replaceWithBytes.mock.calls[0];
    expect((await PDFDocument.load(output)).getPages().map((page) => page.getWidth())).toEqual([
      304, 303, 302, 301, 300,
    ]);
    expect(options).toMatchObject({
      pageMapping: [4, 3, 2, 1, 0],
      expectedSource: controller.pdf,
      preMutationBytes: bytes,
    });
    expect(selection()).toEqual([4]);
  });

  it("moves multiple pages before a destination while retaining document order", async () => {
    const { controller } = await setup();
    selectRange("2,4");
    fireEvent.change(screen.getByLabelText("Move before page"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Move selection" }));
    await vi.waitFor(() => expect(controller.replaceWithBytes).toHaveBeenCalledOnce());
    expect(controller.replaceWithBytes.mock.calls[0][2]).toMatchObject({
      pageMapping: [1, 3, 0, 2, 4],
    });
    expect(selection()).toEqual([0, 1]);
  });

  it("rejects destinations inside the selection and can move that selection to the end", async () => {
    const { controller } = await setup();
    selectRange("2-3");
    fireEvent.change(screen.getByLabelText("Move before page"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Move selection" }));
    expect(screen.getByRole("alert").textContent).toContain("outside the selection");
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Move to end" }));
    await vi.waitFor(() => expect(controller.replaceWithBytes).toHaveBeenCalledOnce());
    expect(controller.replaceWithBytes.mock.calls[0][2]).toMatchObject({
      pageMapping: [0, 3, 4, 1, 2],
    });
  });

  it("retains selection after an unsuccessful reorder", async () => {
    const { controller } = await setup();
    controller.replaceWithBytes.mockRejectedValueOnce(new Error("Could not replace document"));
    fireEvent.click(screen.getByRole("button", { name: "Reverse pages" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not replace"),
    );
    expect(selection()).toEqual([0]);
  });

  it("exports fixed-size groups as one ZIP download", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    fireEvent.change(screen.getByLabelText("Pages per file"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Split to ZIP" }));
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadBytes).mock.calls[0].slice(1)).toEqual([
      "report-split.zip",
      "application/zip",
    ]);
    expect(useWorkspace.getState().status).toBe("Exported 3 PDF files in a ZIP archive");
  });

  it("exports selected individual PDFs and honors a cancelled save", async () => {
    vi.mocked(downloadBytes).mockResolvedValue(false);
    await setup();
    selectRange("2,4");
    fireEvent.click(screen.getByRole("button", { name: "Export individual PDFs" }));
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadBytes).mock.calls[0].slice(1)).toEqual([
      "report-pages.zip",
      "application/zip",
    ]);
    expect(useWorkspace.getState().status).not.toContain("Exported");
  });

  it.each(["stop", "close", "replacement"])("ignores archive output after %s", async (reason) => {
    const { controller, bytes, view } = await setup();
    let release: (bytes: Uint8Array) => void = () => {};
    controller.pdf.saveDocument.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export individual PDFs" }));
    if (reason === "stop") fireEvent.click(screen.getByRole("button", { name: "Stop export" }));
    if (reason === "close") view.unmount();
    if (reason === "replacement")
      act(() =>
        useWorkspace.getState().set({
          document: { id: "replacement", name: "new.pdf", size: 1 },
          status: "Replacement ready",
          busy: false,
        }),
      );
    await act(async () => {
      release(bytes);
    });
    expect(downloadBytes).not.toHaveBeenCalled();
    expect(useWorkspace.getState().status).not.toContain("Exported");
    expect(useWorkspace.getState().busy).toBe(false);
  });

  it("does not report success after a document changes during the save dialog", async () => {
    let release: (saved: boolean) => void = () => {};
    vi.mocked(downloadBytes).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Export individual PDFs" }));
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledOnce());
    act(() =>
      useWorkspace.getState().set({
        document: { id: "replacement", name: "new.pdf", size: 1 },
        status: "Replacement ready",
        busy: true,
      }),
    );
    await act(async () => {
      release(true);
    });
    expect(useWorkspace.getState().status).toBe("Replacement ready");
    expect(useWorkspace.getState().busy).toBe(true);
  });

  it("keeps the bookmark and form structure warning visible for ZIP exports", async () => {
    const { controller, bytes, view } = await setup();
    view.unmount();
    const document = await PDFDocument.load(bytes);
    document.getForm().createTextField("name").addToPage(document.getPage(0));
    controller.pdf.saveDocument.mockResolvedValue(await document.save());
    render(<PageWorkspace controller={controller as never} onClose={() => {}} />);
    await vi.waitFor(() => expect(documentQueryWarning()).toContain("form"));
  });

  it("disables a single-page reverse and empty selected export", async () => {
    await setup(1);
    expect(screen.getByRole("button", { name: "Reverse pages" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
    expect(
      screen.getByRole("button", { name: "Export individual PDFs" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it.each([
    { editingAllowed: false },
    { info: { pages: 5, encrypted: true, title: "", author: "", version: "1.7" } },
  ])("blocks ordering and PDF archive creation for read-only documents: %j", async (state) => {
    await setup(5, state);
    expect(screen.getByRole("button", { name: "Reverse pages" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      screen.getByRole("button", { name: "Export individual PDFs" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(screen.getByRole("button", { name: "Split to ZIP" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});

function documentQueryWarning() {
  return document.querySelector(".structure-warning")?.textContent ?? "";
}

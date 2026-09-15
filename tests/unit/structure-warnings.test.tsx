// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { PageWorkspace } from "../../src/features/pages/PageWorkspace";
import { CreatePdfDialog } from "../../src/features/pages/CreatePdfDialog";
import { createBlankDocument } from "../../src/services/document-commands";
import { useWorkspace } from "../../src/stores/workspace";

async function formDocument(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  doc.getForm().createTextField("probe.field").addToPage(doc.getPage(0), {
    x: 10,
    y: 10,
    width: 50,
    height: 20,
  });
  return doc.save();
}

function seedDocument(pages = 3) {
  act(() => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 100 },
      info: { pages, encrypted: false, title: "", author: "", version: "1.7" },
      page: 1,
    });
  });
}

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

describe("structure-loss warnings", () => {
  it("warns in the page workspace when the document carries form fields", async () => {
    seedDocument();
    const bytes = await formDocument();
    const controller = {
      pdf: { saveDocument: vi.fn(async () => bytes), numPages: 3 },
      replaceWithBytes: vi.fn(async () => {}),
      goTo: vi.fn(),
    };
    render(<PageWorkspace controller={controller as never} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/form field/i);
    });
  });

  it("shows no warning for a plain document", async () => {
    seedDocument();
    const bytes = await createBlankDocument(3);
    const controller = {
      pdf: { saveDocument: vi.fn(async () => bytes), numPages: 3 },
      replaceWithBytes: vi.fn(async () => {}),
      goTo: vi.fn(),
    };
    render(<PageWorkspace controller={controller as never} onClose={() => {}} />);

    await waitFor(() => expect(controller.pdf.saveDocument).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns before combining files that carry form fields", async () => {
    const bytes = await formDocument();
    render(<CreatePdfDialog onLoad={() => {}} onClose={() => {}} />);

    fireEvent.click(screen.getByText(/Combine Multiple Files/i));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([bytes as unknown as BlobPart], "form.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer.slice(0),
    });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/form field/i);
    });
  });
});

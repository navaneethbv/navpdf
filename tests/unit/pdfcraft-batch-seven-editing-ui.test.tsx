// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { StampDialog } from "../../src/features/annotations/StampDialog";
import { DecorationsDialog } from "../../src/features/decorations/DecorationsDialog";
import { LinkDialog } from "../../src/features/editor/LinkDialog";
import { Properties } from "../../src/features/annotations/Properties";
import { EraserTool } from "../../src/features/annotations/EraserTool";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import { savePreferences } from "../../src/services/native";
import type { ViewerController } from "../../src/features/viewer/controller";

vi.mock("../../src/services/native", async (original) => ({
  ...(await original<typeof import("../../src/services/native")>()),
  savePreferences: vi.fn(async () => {}),
}));

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==",
  ),
  (char) => char.codePointAt(0) ?? 0,
);

async function blankPdf(withForm = false) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (withForm)
    doc
      .getForm()
      .createTextField("notes")
      .addToPage(page, { x: 50, y: 500, width: 200, height: 20 });
  return doc.save();
}

/** A controller double that serializes real bytes and records the committed replacement. */
async function editableController(bytes?: Uint8Array) {
  const source = bytes ?? (await blankPdf());
  const pdf = {
    numPages: 1,
    saveDocument: vi.fn(async () => source),
    getPermissions: vi.fn(async () => null),
    getFieldObjects: vi.fn(async () => ({ notes: [{ id: "9R" }] })),
  };
  const replaceWithBytes = vi.fn(() => Promise.resolve());
  return { controller: { pdf, replaceWithBytes } as unknown as ViewerController, replaceWithBytes };
}

async function committed(replaceWithBytes: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(replaceWithBytes).toHaveBeenCalled());
  return PDFDocument.load(replaceWithBytes.mock.calls[0][0] as Uint8Array);
}

function choose(label: RegExp | string, bytes: Uint8Array, name: string) {
  const file = new File([bytes], name);
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  act(() =>
    useWorkspace.getState().set({
      document: { id: "doc", name: "report.pdf", size: 100 },
      info: { pages: 1, encrypted: false, title: "", author: "", version: "1.7" },
      page: 1,
      local: { preferences: { ...defaultPreferences }, recents: [], recoveries: [] },
    }),
  );
});

describe("stamp choices", () => {
  it("adds a picture stamp named after its file", async () => {
    const { controller, replaceWithBytes } = await editableController();
    render(<StampDialog controller={controller} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Stamp"), { target: { value: "Image" } });
    expect(screen.queryByLabelText("Reviewer name (optional)")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Stamp" })).toHaveProperty("disabled", true);
    choose("Stamp picture", PNG, "Company seal.png");
    await screen.findByText("Company seal.png");
    fireEvent.click(screen.getByRole("button", { name: "Add Stamp" }));
    const doc = await committed(replaceWithBytes);
    const stamp = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
    expect(stamp.get(PDFName.of("Name"))).toEqual(PDFName.of("NavPDFImage"));
    expect(stamp.lookup(PDFName.of("Contents"))?.toString()).toContain("Company seal");
  });

  it("rejects a file that is not a picture or PDF", async () => {
    const { controller } = await editableController();
    render(<StampDialog controller={controller} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Stamp"), { target: { value: "Image" } });
    choose("Stamp picture", new TextEncoder().encode("GIF89a"), "anim.gif");
    expect((await screen.findByRole("alert")).textContent).toMatch(/PNG, JPEG or PDF/);
  });

  it("adds a sign-here tag without a reviewer line", async () => {
    const { controller, replaceWithBytes } = await editableController();
    render(<StampDialog controller={controller} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Stamp"), { target: { value: "InitialHere" } });
    expect(screen.queryByLabelText("Reviewer name (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Stamp" }));
    const doc = await committed(replaceWithBytes);
    const stamp = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
    expect(stamp.get(PDFName.of("Name"))).toEqual(PDFName.of("NavPDFInitialHere"));
  });
});

describe("watermark and background files", () => {
  it("applies a picture watermark behind the content", async () => {
    const { controller, replaceWithBytes } = await editableController();
    render(<DecorationsDialog controller={controller} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Picture or PDF page"));
    expect(screen.queryByLabelText("Watermark Text")).toBeNull();
    choose("Watermark file", PNG, "logo.png");
    await screen.findByText("logo.png");
    fireEvent.change(screen.getByLabelText(/Size \(50% of the page width\)/), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByLabelText("Behind the page content"));
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    const doc = await committed(replaceWithBytes);
    const resources = doc.getPage(0).node.Resources()!;
    const xObjects = resources.lookup(PDFName.of("XObject"), PDFDict);
    // pdf-lib gives each new resource name a unique suffix.
    expect(
      xObjects
        .keys()
        .map(String)
        .some((name) => name.startsWith("/NavPDF_WmPicture")),
    ).toBe(true);
  });

  it("asks for a file before applying a background picture", async () => {
    const { controller, replaceWithBytes } = await editableController();
    render(<DecorationsDialog controller={controller} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Background/ }));
    fireEvent.click(screen.getByLabelText("Picture or PDF page behind the content"));
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() =>
      expect(useWorkspace.getState().error).toMatch(/Choose a picture or PDF for the background/),
    );
    expect(replaceWithBytes).not.toHaveBeenCalled();
  });
});

describe("link actions", () => {
  it("adds a link that hides a chosen form field", async () => {
    const { controller, replaceWithBytes } = await editableController(await blankPdf(true));
    render(<LinkDialog controller={controller} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Form Fields/ }));
    expect(screen.getByRole("button", { name: "Add Link" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("notes"));
    fireEvent.change(screen.getByLabelText("Border"), { target: { value: "dashed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Link" }));
    const doc = await committed(replaceWithBytes);
    const annots = doc.getPage(0).node.Annots()!;
    const link = doc.context.lookup(annots.get(annots.size() - 1), PDFDict);
    const action = link.lookup(PDFName.of("A"), PDFDict);
    expect(action.get(PDFName.of("S"))).toEqual(PDFName.of("Hide"));
    expect(String(link.lookup(PDFName.of("BS"), PDFDict).get(PDFName.of("S")))).toBe("/D");
    expect(replaceWithBytes.mock.calls[0][1]).toBe("Added form field link on page 1");
  });
});

describe("annotation styles and defaults", () => {
  it("changes line endings and borders and saves a style for new shapes", async () => {
    const updateSelectedAnnotation = vi.fn(async () => {});
    act(() =>
      useWorkspace.getState().set({
        selectedAnnotationId: "line",
        comments: [
          {
            id: "line",
            page: 1,
            type: "Line",
            text: "",
            color: [0, 0, 1],
            width: 3,
            opacity: 0.5,
            lineEndings: ["None", "OpenArrow"],
          },
        ],
      }),
    );
    render(<Properties controller={{ updateSelectedAnnotation } as unknown as ViewerController} />);
    fireEvent.change(screen.getByLabelText("Line start ending"), { target: { value: "Diamond" } });
    expect(updateSelectedAnnotation).toHaveBeenCalledWith({
      lineEndings: ["Diamond", "OpenArrow"],
    });
    const border = screen.getByLabelText("Selected annotation border");
    expect([...border.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "solid",
      "dashed",
    ]);
    fireEvent.change(border, { target: { value: "dashed" } });
    expect(updateSelectedAnnotation).toHaveBeenCalledWith({ borderStyle: "dashed" });

    fireEvent.click(screen.getByRole("button", { name: /Use this style for new line/ }));
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          annotationDefaults: { Line: { color: "#0000ff", width: 3, opacity: 0.5 } },
        }),
      ),
    );
    expect(useWorkspace.getState().local.preferences.annotationDefaults.Line?.width).toBe(3);
  });
});

describe("ink eraser", () => {
  it("erases along the dragged path on the page under the pointer", () => {
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = "2";
    document.body.append(page);
    document.elementsFromPoint = () => [page];
    const eraseInk = vi.fn(async () => 1);
    const controller = {
      pdf: {},
      eraseInk,
      container: { scrollBy: vi.fn() },
    } as unknown as ViewerController;
    act(() => useWorkspace.getState().set({ tool: "eraser", eraserSize: 24 }));
    render(<EraserTool controller={controller} />);
    const overlay = screen.getByRole("application");
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { pointerId: 3, clientX: 20, clientY: 15 });
    fireEvent.pointerUp(overlay, { pointerId: 3, clientX: 30, clientY: 20 });
    expect(eraseInk).toHaveBeenCalledWith(
      2,
      [
        { x: 10, y: 10 },
        { x: 20, y: 15 },
        { x: 30, y: 20 },
      ],
      24,
    );
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(useWorkspace.getState().tool).toBe("select");
  });
});

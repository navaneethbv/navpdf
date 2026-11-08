// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { BookmarkEditor } from "../../src/features/bookmarks/BookmarkEditor";
import {
  loadBookmarks,
  saveBookmarks,
  type EditableBookmark,
} from "../../src/services/pdf/bookmarks";
import type { ViewerController } from "../../src/features/viewer/controller";

async function setup() {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  const bytes = await saveBookmarks(await doc.save(), [
    { id: "a", title: "First", page: 0, children: [] },
    { id: "b", title: "Second", page: 1, children: [] },
  ]);
  const controller = {
    pdf: { numPages: 2, saveDocument: vi.fn().mockResolvedValue(bytes) },
    replaceWithBytes: vi.fn(),
  } as unknown as ViewerController;
  const onClose = vi.fn();
  render(<BookmarkEditor controller={controller} onClose={onClose} />);
  await screen.findByDisplayValue("First");
  return { controller, onClose };
}
describe("bookmark editor", () => {
  it("rejects excessive nesting without losing draft edits and allows a valid retry", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    let children: EditableBookmark[] = [];
    for (let level = 32; level >= 1; level--)
      children = [{ id: `level-${level}`, title: `Level ${level}`, page: 0, children }];
    const bytes = await saveBookmarks(await doc.save(), [
      { id: "move", title: "Move me", page: 0, children: [] },
      ...children,
    ]);
    const controller = {
      pdf: { numPages: 1, saveDocument: vi.fn().mockResolvedValue(bytes) },
      replaceWithBytes: vi.fn(),
    } as unknown as ViewerController;
    const onClose = vi.fn();
    render(<BookmarkEditor controller={controller} onClose={onClose} />);
    fireEvent.change(await screen.findByDisplayValue("Move me"), {
      target: { value: "Draft title" },
    });
    fireEvent.change(screen.getAllByLabelText("Parent")[0], {
      target: { value: "bookmark-33" },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("32 levels");
    expect(screen.getByDisplayValue("Draft title")).toBeTruthy();
    expect((screen.getAllByLabelText("Parent")[0] as HTMLSelectElement).value).toBe("");
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByLabelText("Parent")[0], {
      target: { value: "bookmark-2" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save bookmarks" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const saved = await loadBookmarks(vi.mocked(controller.replaceWithBytes).mock.calls[0][0]);
    expect(saved[0].title).toBe("Level 1");
    expect(saved[0].children[0].title).toBe("Draft title");
  });
  it("renames, nests, adds and saves a real outline", async () => {
    const { controller, onClose } = await setup();
    fireEvent.change(screen.getByDisplayValue("Second"), { target: { value: "Details" } });
    fireEvent.change(screen.getAllByLabelText("Parent")[1], { target: { value: "bookmark-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add bookmark at current page" }));
    fireEvent.change(screen.getByDisplayValue("New bookmark"), { target: { value: "Summary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmarks" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const saved = await loadBookmarks(vi.mocked(controller.replaceWithBytes).mock.calls[0][0]);
    expect(saved.map((n) => n.title)).toEqual(["First", "Summary"]);
    expect(saved[0].children[0].title).toBe("Details");
    expect(controller.replaceWithBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "Updated bookmarks",
      { expectedSource: controller.pdf },
    );
  });
  it("reorders siblings and deletes a subtree before saving", async () => {
    const { controller } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));
    expect((screen.getAllByLabelText("Title")[0] as HTMLInputElement).value).toBe("Second");
    fireEvent.click(screen.getByRole("button", { name: "Move Second down" }));
    fireEvent.change(screen.getAllByLabelText("Parent")[1], { target: { value: "bookmark-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete First" }));
    expect(screen.queryByLabelText("Title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save bookmarks" }));
    await waitFor(() => expect(controller.replaceWithBytes).toHaveBeenCalled());
    expect(await loadBookmarks(vi.mocked(controller.replaceWithBytes).mock.calls[0][0])).toEqual(
      [],
    );
  });
  it("reports invalid destinations and leaves the document unchanged", async () => {
    const { controller } = await setup();
    fireEvent.change(screen.getAllByLabelText("Page")[0], { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmarks" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
  });
  it("cuts a bookmark, pastes it inside another and saves the nesting", async () => {
    const { controller } = await setup();
    fireEvent.click(screen.getByLabelText("Cut First"));
    expect(screen.queryByDisplayValue("First")).toBeNull();
    fireEvent.click(screen.getByLabelText("Paste inside Second"));
    expect(screen.getByDisplayValue("First")).toBeTruthy();
    fireEvent.click(screen.getByText("Save bookmarks"));
    await waitFor(() => expect(controller.replaceWithBytes).toHaveBeenCalled());
    const saved = await loadBookmarks(vi.mocked(controller.replaceWithBytes).mock.calls[0][0]);
    expect(saved.map((node) => node.title)).toEqual(["Second"]);
    expect(saved[0].children.map((node) => node.title)).toEqual(["First"]);
  });

  it("replaces the bookmarks with an imported JSON file", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("How to import bookmarks"), {
      target: { value: "replace" },
    });
    const json = JSON.stringify({
      format: "navpdf-bookmarks",
      version: 1,
      bookmarks: [{ title: "Imported", page: 9 }],
    });
    fireEvent.change(screen.getByLabelText("Bookmark JSON file"), {
      target: { files: [new File([json], "marks.json", { type: "application/json" })] },
    });
    expect(await screen.findByDisplayValue("Imported")).toBeTruthy();
    expect(screen.queryByDisplayValue("First")).toBeNull();
    // Page 9 is past the end of this two-page document, so it has no destination.
    expect(screen.getByText(/1 have no destination/)).toBeTruthy();
  });
});

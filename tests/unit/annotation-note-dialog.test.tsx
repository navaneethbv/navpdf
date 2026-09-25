// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnnotationNoteDialog } from "../../src/features/annotations/AnnotationNoteDialog";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

describe("AnnotationNoteDialog", () => {
  it("renders with current page and submits note", async () => {
    const controller = {
      currentPage: vi.fn(() => 3),
      addStickyNote: vi.fn(async () => {}),
    };
    const onClose = vi.fn();
    render(<AnnotationNoteDialog controller={controller as never} onClose={onClose} />);
    expect(screen.getByLabelText("Note on page 3")).toBeTruthy();
    const submitButton = screen.getByRole("button", { name: "Add Note" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    const textarea = screen.getByPlaceholderText("Write a comment about this page...");
    fireEvent.change(textarea, { target: { value: "Review this section" } });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submitButton);
    expect(screen.getByRole("button", { name: "Adding..." })).toBeTruthy();
    await vi.waitFor(() => {
      expect(controller.addStickyNote).toHaveBeenCalledWith("Review this section");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("handles cancel button and close request", () => {
    const controller = {
      currentPage: vi.fn(() => 1),
      addStickyNote: vi.fn(async () => {}),
    };
    const onClose = vi.fn();
    render(<AnnotationNoteDialog controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("displays error message if sticky note creation fails", async () => {
    const controller = {
      currentPage: vi.fn(() => 1),
      addStickyNote: vi.fn(async () => {
        throw new Error("Failed to save note");
      }),
    };
    const onClose = vi.fn();
    render(<AnnotationNoteDialog controller={controller as never} onClose={onClose} />);
    const textarea = screen.getByPlaceholderText("Write a comment about this page...");
    fireEvent.change(textarea, { target: { value: "Failing note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Failed to save note")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

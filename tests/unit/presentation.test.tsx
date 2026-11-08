// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { nextPage, Presentation } from "../../src/features/viewer/Presentation";
import { useWorkspace } from "../../src/stores/workspace";

function controller(pages = 3) {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  return {
    render,
    pdf: {
      numPages: pages,
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render,
      })),
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  useWorkspace.getState().reset();
});

describe("Present mode", () => {
  it("steps forward and back, loops when asked and stops at the end otherwise", () => {
    expect(nextPage(1, 3, 1, false)).toBe(2);
    expect(nextPage(3, 3, 1, false)).toBeNull();
    expect(nextPage(3, 3, 1, true)).toBe(1);
    expect(nextPage(1, 3, -1, true)).toBe(3);
    expect(nextPage(1, 3, -1, false)).toBeNull();
  });

  it("starts at the current page and moves with clicks and keys", async () => {
    useWorkspace.getState().set({ page: 2 });
    const view = controller();
    const onClose = vi.fn();
    render(<Presentation controller={view as never} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Presentation, page 2 of 3");
    fireEvent.click(screen.getByLabelText("Page 2"));
    expect(dialog.getAttribute("aria-label")).toBe("Presentation, page 3 of 3");
    fireEvent.click(screen.getByLabelText("Page 3"), { shiftKey: true });
    expect(dialog.getAttribute("aria-label")).toBe("Presentation, page 2 of 3");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(dialog.getAttribute("aria-label")).toBe("Presentation, page 1 of 3");
    fireEvent.keyDown(dialog, { key: "End" });
    // Going past the last page without looping ends the presentation.
    fireEvent.keyDown(dialog, { key: " " });
    expect(onClose).toHaveBeenCalled();
    await vi.waitFor(() => expect(view.pdf.getPage).toHaveBeenCalledWith(3));
  });

  it("advances on its own and loops", async () => {
    vi.useFakeTimers();
    useWorkspace.getState().set({ page: 3 });
    render(<Presentation controller={controller() as never} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Loop"));
    fireEvent.change(screen.getByLabelText("Advance automatically"), { target: { value: "5" } });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Presentation, page 1 of 3");
  });
});

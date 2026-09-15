// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Thumbnails } from "../../src/features/viewer/Thumbnails";
import { useWorkspace } from "../../src/stores/workspace";

function makePdf() {
  return {
    numPages: 1,
    getPage: vi.fn(async () => ({
      getViewport: vi.fn(() => ({ width: 100, height: 100 })),
      render: vi.fn(() => {
        const error = new Error("Worker was destroyed");
        return {
          promise: Promise.reject(error),
          cancel: vi.fn(),
        };
      }),
    })),
  };
}

describe("Thumbnails component", () => {
  beforeEach(() => {
    useWorkspace.getState().reset();
    vi.clearAllMocks();
  });

  it("leaves no 'Preview unavailable' text when worker is destroyed during render", async () => {
    const pdf = makePdf();
    const controller = {
      pdf,
      goTo: vi.fn(),
    };

    useWorkspace.getState().set({
      info: {
        pages: 1,
        title: "",
        author: "",
        version: "1.7",
        encrypted: false,
      },
    });

    render(<Thumbnails controller={controller as never} />);

    await waitFor(() => {
      expect(pdf.getPage).toHaveBeenCalledWith(1);
    });

    // Should NOT show "Preview unavailable" when error is worker destroyed
    expect(screen.queryByText("Preview unavailable")).toBeNull();
  });

  it("re-renders with new proxy when revision increments", async () => {
    const pdf1 = makePdf();
    const pdf2 = makePdf();
    let currentPdf = pdf1;

    const controller = {
      get pdf() {
        return currentPdf;
      },
      goTo: vi.fn(),
    };

    useWorkspace.getState().set({
      info: {
        pages: 1,
        title: "",
        author: "",
        version: "1.7",
        encrypted: false,
      },
      revision: 0,
    });

    const { rerender } = render(<Thumbnails controller={controller as never} />);
    expect(pdf1.getPage).toHaveBeenCalledWith(1);

    currentPdf = pdf2;
    useWorkspace.getState().set({ revision: 1 });
    rerender(<Thumbnails controller={controller as never} />);

    await waitFor(() => {
      expect(pdf2.getPage).toHaveBeenCalledWith(1);
    });
  });
});

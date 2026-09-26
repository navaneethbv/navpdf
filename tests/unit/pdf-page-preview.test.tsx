// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PdfPagePreview } from "../../src/features/viewer/PdfPagePreview";

afterEach(() => vi.restoreAllMocks());

function previewSource() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,cGFnZQ==",
  );
  const jobs: { resolve: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const renderPage = vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
    expect(Math.max(canvas.width, canvas.height)).toBe(1000);
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const cancel = vi.fn();
    jobs.push({ resolve, cancel });
    return { promise, cancel };
  });
  return {
    jobs,
    pdf: {
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: renderPage,
      })),
    },
  };
}

describe("independent PDF preview", () => {
  it("shows a labelled image only after rendering and clears stale page output", async () => {
    const { pdf, jobs } = previewSource();
    const { rerender, unmount } = render(
      <PdfPagePreview pdf={pdf as never} page={1} label="Original page" />,
    );
    await act(async () => {});
    expect(screen.queryByRole("img")).toBeNull();
    await act(async () => jobs[0].resolve());
    expect(screen.getByRole("img", { name: "Original page" }).getAttribute("src")).toBe(
      "data:image/png;base64,cGFnZQ==",
    );
    rerender(<PdfPagePreview pdf={pdf as never} page={2} label="Revised page" />);
    expect(screen.queryByRole("img")).toBeNull();
    await act(async () => {});
    expect(jobs[0].cancel).toHaveBeenCalledOnce();
    unmount();
    expect(jobs[1].cancel).toHaveBeenCalledOnce();
    await act(async () => jobs[1].resolve());
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("reports a failed page without presenting an old image", async () => {
    const { pdf } = previewSource();
    pdf.getPage.mockRejectedValueOnce(new Error("Page unavailable"));
    render(<PdfPagePreview pdf={pdf as never} page={1} label="Original page" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Page unavailable");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

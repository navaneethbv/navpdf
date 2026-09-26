// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImageCropEditor, useImageUrl } from "../../src/features/pages/ImageCropEditor";
import { processImageCrop } from "../../src/features/pages/image-crop";
vi.mock("../../src/features/pages/image-crop", () => ({ processImageCrop: vi.fn() }));
const file = new File(["source"], "source.png", { type: "image/png" });
beforeEach(() => {
  vi.mocked(processImageCrop)
    .mockReset()
    .mockImplementation(async (_, options) => ({
      file,
      beforeFile: file,
      originalWidth: 200,
      originalHeight: 100,
      bounds: options?.bounds ?? { x: 20, y: 10, width: 160, height: 80 },
    }));
});
describe("crop editor", () => {
  it("previews controls and allows keyboard rectangle adjustment before applying", async () => {
    const onApply = vi.fn();
    render(<ImageCropEditor file={file} onApply={onApply} onClose={vi.fn()} />);
    await screen.findByRole("img", { name: "After crop" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Crop left" }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    await waitFor(() =>
      expect((screen.getByLabelText("Crop x") as HTMLInputElement).value).toBe("30"),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Use this image" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use this image" }));
    expect(onApply.mock.calls[0][0].bounds).toEqual({ x: 30, y: 10, width: 150, height: 80 });
  });
  it("recalculates detection for sensitivity, padding and scan options and supports reset", async () => {
    render(<ImageCropEditor file={file} onApply={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("img", { name: "After crop" });
    fireEvent.change(screen.getByRole("slider", { name: /Sensitivity/ }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Padding (pixels)"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Straighten (degrees)"), { target: { value: "-2" } });
    fireEvent.change(screen.getByRole("slider", { name: /Background cleanup/ }), {
      target: { value: "20" },
    });
    await waitFor(() =>
      expect(processImageCrop).toHaveBeenLastCalledWith(
        file,
        expect.objectContaining({
          tolerance: 12,
          padding: 5,
          angle: -2,
          cleanup: 20,
          bounds: undefined,
        }),
        true,
      ),
    );
    expect(screen.getByAltText("Unmodified original")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset adjustments" }));
    await waitFor(() =>
      expect(processImageCrop).toHaveBeenLastCalledWith(
        file,
        { tolerance: 24, padding: 0, angle: 0, cleanup: 0 },
        true,
      ),
    );
  });
  it("blocks applying a failed preview and preserves cancellation", async () => {
    vi.mocked(processImageCrop).mockRejectedValueOnce(new Error("Invalid crop"));
    const onClose = vi.fn();
    render(<ImageCropEditor file={file} onApply={vi.fn()} onClose={onClose} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Use this image" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("local image preview URLs", () => {
  it("releases each browser-owned URL when replacing or closing the preview", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { result, rerender, unmount } = renderHook(
      ({ source }: { source?: File }) => useImageUrl(source),
      { initialProps: { source: file } },
    );
    expect(result.current).toBe("blob:first");
    rerender({ source: new File(["next"], "next.png") });
    expect(result.current).toBe("blob:second");
    expect(revoke).toHaveBeenCalledWith("blob:first");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:second");
    create.mockRestore();
    revoke.mockRestore();
  });

  it("encodes markup characters before a local URL reaches an image attribute", () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue('blob:test/<preview>"');
    const { result, unmount } = renderHook(() => useImageUrl(file));
    expect(result.current).toBe("blob:test/%3Cpreview%3E%22");
    unmount();
    create.mockRestore();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://example.com/image.png",
  ])("rejects a nonlocal preview source: %s", (url) => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue(url);
    const { result, unmount } = renderHook(() => useImageUrl(file));
    expect(result.current).toBe("");
    unmount();
    create.mockRestore();
  });
});

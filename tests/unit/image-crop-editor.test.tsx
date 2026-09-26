// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImageCropEditor } from "../../src/features/pages/ImageCropEditor";
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
    await screen.findByRole("img", { name: "Image after crop" });
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
    await screen.findByRole("img", { name: "Image after crop" });
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
    expect(screen.getByAltText("Unmodified original image")).toBeTruthy();
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

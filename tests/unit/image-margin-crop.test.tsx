// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { CreatePdfDialog } from "../../src/features/pages/CreatePdfDialog";
import { trimImageMargins } from "../../src/features/pages/image-crop";

vi.mock("../../src/features/pages/image-crop", () => ({ trimImageMargins: vi.fn() }));

async function sourceFile(width: number, height: number) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  return new File([new Uint8Array(bytes)], "border.png", { type: "image/png" });
}

function setup(file: File) {
  const onLoad = vi.fn(),
    onClose = vi.fn();
  render(<CreatePdfDialog initialTab="combine" onLoad={onLoad} onClose={onClose} />);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return { onLoad, onClose };
}

describe("image margin crop import controls", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([false, true])(
    "imports the selected crop, or restores original dimensions on reset (%s)",
    async (reset) => {
      const original = await sourceFile(120, 100),
        cropped = await sourceFile(80, 60);
      vi.mocked(trimImageMargins).mockResolvedValue({
        file: cropped,
        bounds: { x: 13, y: 17, width: 80, height: 60 },
        originalWidth: 120,
        originalHeight: 100,
      });
      const { onLoad } = setup(original);
      fireEvent.click(
        await screen.findByRole("button", { name: "Trim image margins for border.png" }),
      );
      expect(await screen.findByText(/120 × 100 → 80 × 60/)).toBeTruthy();
      expect(
        await screen.findByRole("img", { name: "Cropped preview of border.png" }),
      ).toBeTruthy();
      if (reset) {
        fireEvent.click(screen.getByRole("button", { name: "Reset crop for border.png" }));
        expect(screen.queryByRole("img")).toBeNull();
      }
      fireEvent.click(screen.getByRole("button", { name: "Combine & Open" }));
      await waitFor(() => expect(onLoad).toHaveBeenCalledOnce());
      const saved = await PDFDocument.load(await (onLoad.mock.calls[0][0] as File).arrayBuffer());
      expect(saved.getPage(0).getSize()).toEqual(
        reset ? { width: 90, height: 75 } : { width: 60, height: 45 },
      );
    },
  );

  it("blocks import, removal and dismissal until detection finishes", async () => {
    let finish!: (value: null) => void;
    vi.mocked(trimImageMargins).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { onClose } = setup(await sourceFile(120, 100));
    fireEvent.click(
      await screen.findByRole("button", { name: "Trim image margins for border.png" }),
    );
    for (const name of ["Combine & Open", "Remove file", "Cancel", "Close"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    finish(null);
    expect(await screen.findByText(/No consistent outer margin/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Combine & Open" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows crop failures and retains the original for import", async () => {
    vi.mocked(trimImageMargins).mockRejectedValue(new Error("Image decoding failed"));
    setup(await sourceFile(120, 100));
    fireEvent.click(
      await screen.findByRole("button", { name: "Trim image margins for border.png" }),
    );
    expect(await screen.findByText("Image decoding failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reset crop/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Combine & Open" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("batch margin trimming", () => {
  it("keeps successful results when another image fails", async () => {
    const first = await sourceFile(120, 100),
      second = new File([await first.arrayBuffer()], "second.png", { type: "image/png" });
    vi.mocked(trimImageMargins)
      .mockReset()
      .mockResolvedValueOnce({
        file: await sourceFile(80, 60),
        bounds: { x: 10, y: 10, width: 80, height: 60 },
        originalWidth: 120,
        originalHeight: 100,
      })
      .mockRejectedValueOnce(new Error("Second image failed"));
    const onLoad = vi.fn();
    render(<CreatePdfDialog initialTab="combine" onLoad={onLoad} onClose={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [first, second] },
    });
    await screen.findByRole("checkbox", { name: "Select second.png for batch trim" });
    fireEvent.click(screen.getByRole("button", { name: "Trim selected images" }));
    await screen.findByText(/2 of 2 images processed; 1 failed/);
    expect(screen.getByText("Second image failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Combine & Open" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    const doc = await PDFDocument.load(await (onLoad.mock.calls[0][0] as File).arrayBuffer());
    expect(doc.getPages().map((p) => p.getSize())).toEqual([
      { width: 60, height: 45 },
      { width: 90, height: 75 },
    ]);
  });
});

import { useId, useMemo, useRef, useState } from "react";
import { Images } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import { downloadBlob, safeFileName } from "../../utils/download";
import { errorMessage } from "../document/use-document-edit";
import { parsePageRange } from "../pages/page-range";
import { allPageNumbers, pagesInOrder } from "../../utils/pdf-pages";
import { createZip } from "./ooxml";
import { pageImages, type ExtractedImage } from "./embedded-images";

/** Matches the native export limit so a huge export fails before it is assembled. */
const MAX_TOTAL_BYTES = 1024 ** 3;

export function ExtractImagesDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const documentName = useWorkspace((state) => state.document?.name ?? "document.pdf");
  const pageCount = useWorkspace((state) => state.info?.pages ?? 1);
  const set = useWorkspace((state) => state.set);
  const [range, setRange] = useState("");
  const [minimum, setMinimum] = useState(16);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  const pages = useMemo(() => {
    if (!range.trim()) return { list: allPageNumbers(pageCount), error: "" };
    try {
      return { list: parsePageRange(range, pageCount).map((page) => page + 1), error: "" };
    } catch (cause) {
      return { list: [], error: errorMessage(cause) };
    }
  }, [pageCount, range]);

  const collect = async (pdf: NonNullable<ViewerController["pdf"]>) => {
    const seen = new Set<string>();
    const images: ExtractedImage[] = [];
    let total = 0;
    let position = 0;
    for await (const [number, page] of pagesInOrder(pdf, pages.list)) {
      if (cancelled.current) return null;
      position += 1;
      setProgress(`Reading page ${number} (${position} of ${pages.list.length})…`);
      const found = await pageImages(page, number, seen, minimum);
      images.push(...found);
      total += found.reduce((sum, image) => sum + image.png.length, 0);
      if (total > MAX_TOTAL_BYTES)
        throw new Error("The images exceed the 1 GB export limit. Choose fewer pages.");
    }
    return images;
  };

  const submit = async () => {
    if (!controller?.pdf) return;
    cancelled.current = false;
    setBusy(true);
    setError("");
    try {
      const images = await collect(controller.pdf);
      if (!images || cancelled.current) return;
      if (!images.length) throw new Error("No images were found on the chosen pages.");
      const base = safeFileName(documentName.replace(/\.pdf$/i, ""), "document");
      const named = images.map((image) => ({
        name: `${base}-page-${image.page}-image-${image.index}.png`,
        data: image.png,
      }));
      const [first] = named;
      const saved =
        named.length === 1
          ? await downloadBlob(
              new Blob([first.data as Uint8Array<ArrayBuffer>], { type: "image/png" }),
              first.name,
            )
          : await downloadBlob(
              new Blob([createZip(named)], { type: "application/zip" }),
              `${base}-images.zip`,
            );
      if (saved) {
        set({ status: `Exported ${images.length} image(s)` });
        onClose();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <ToolDialog
      title="Export All Images"
      icon={<Images size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || pages.error}
      primaryLabel="Export Images"
      busyLabel="Exporting…"
      primaryDisabled={Boolean(pages.error) || !controller?.pdf}
      onPrimary={() => void submit()}
      secondary={
        busy ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              cancelled.current = true;
            }}
          >
            Stop
          </button>
        ) : null
      }
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-range`}>
          Pages (all when empty)
        </label>
        <input
          id={`${ids}-range`}
          className="text-input"
          value={range}
          placeholder={`e.g. 1-${pageCount}`}
          onChange={(event) => setRange(event.target.value)}
        />
        <label className="setting-title" htmlFor={`${ids}-minimum`}>
          Skip images smaller than (pixels)
        </label>
        <input
          id={`${ids}-minimum`}
          className="text-input"
          type="number"
          min={1}
          max={2000}
          value={minimum}
          onChange={(event) => setMinimum(Math.max(1, Math.trunc(Number(event.target.value) || 1)))}
        />
      </div>
      {progress && (
        <output className="field-hint" aria-live="polite">
          {progress}
        </output>
      )}
      <p className="field-hint">
        Saves each embedded picture once, at its stored resolution, as a lossless PNG. Several
        images are saved together in a ZIP archive. Drawings and text are not images.
      </p>
    </ToolDialog>
  );
}

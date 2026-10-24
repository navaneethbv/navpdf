import { useState, useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { native, printDocument } from "../../services/native";
import { Printer, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { extractPages } from "../../services/document-commands";
import { parsePageRange, type RangeMode } from "./page-range";
import type { ViewerController } from "../viewer/controller";
import { FeatureDialog } from "../../components/FeatureDialog";
import { PdfPagePreview } from "../viewer/PdfPagePreview";
import { loadPdfFromBytes } from "../../services/pdf";
import {
  CONTENT_LABELS,
  preparePrintContent,
  rasterizeForPrint,
  selectPrintPages,
  type PageSubset,
  type PrintContent,
} from "./print-options";

export function PrintDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const s = useWorkspace();
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customRange, setCustomRange] = useState("");
  const [printing, setPrinting] = useState(false);
  const [subset, setSubset] = useState<PageSubset>("all");
  const [reverse, setReverse] = useState(false);
  const [content, setContent] = useState<PrintContent>("document-markups");
  const [asImage, setAsImage] = useState(false);
  const [grayscale, setGrayscale] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [preview, setPreview] = useState<PDFDocumentProxy | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const closed = useRef(false);
  const rasterize = asImage || grayscale;

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);
  const previewTask = useRef<ReturnType<typeof loadPdfFromBytes> | null>(null);
  const clearPreview = () => {
    void previewTask.current?.destroy();
    previewTask.current = null;
    setPreview(null);
  };
  useEffect(() => () => void previewTask.current?.destroy(), []);
  useEffect(
    () => clearPreview(),
    [rangeMode, customRange, subset, reverse, content, asImage, grayscale, dpi],
  );
  const [hasMixedDimensions, setHasMixedDimensions] = useState(false);
  const [mixedDimensionsNote, setMixedDimensionsNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    const pdf = controller?.pdf;
    if (!pdf) return;
    void (async () => {
      try {
        const total = pdf.numPages;
        if (total <= 1) return;
        let firstW = 0;
        let firstH = 0;
        let isMixed = false;
        for (let i = 1; i <= Math.min(total, 50); i++) {
          const p = await pdf.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          const w = Math.round(vp.width);
          const h = Math.round(vp.height);
          if (i === 1) {
            firstW = w;
            firstH = h;
          } else if (w !== firstW || h !== firstH) {
            isMixed = true;
            break;
          }
        }
        if (!cancelled && isMixed) {
          setHasMixedDimensions(true);
          setMixedDimensionsNote(
            "Document contains pages with mixed dimensions or orientations. Each page will print using its respective size.",
          );
        }
      } catch {
        // Non-fatal dimension check
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller]);

  /** The document as it will print: chosen pages and order, content and raster options. */
  const buildPayload = async () => {
    if (!controller?.pdf) throw new Error("No document is open.");
    // Print the current edited revision, including unsaved annotations.
    controller.editor?.commitOrRemove();
    const bytes = await controller.pdf.saveDocument();
    const totalPages = controller.pdf.numPages;
    const range = parsePageRange(rangeMode, customRange, s.page, totalPages);
    const pages = selectPrintPages(range, subset, reverse);
    // Only rebuild the document when a subset or new order was requested, so a
    // full-document print keeps the original structure intact.
    const unchanged = pages.length === totalPages && pages.every((page, index) => page === index);
    let payload: Uint8Array = unchanged ? bytes : await extractPages(bytes, pages);
    payload = await preparePrintContent(payload, content);
    if (rasterize)
      payload = await rasterizeForPrint(payload, { dpi, grayscale }, () => closed.current);
    return { payload, pages: pages.length };
  };

  const showPreview = async () => {
    setPrinting(true);
    try {
      s.set({ error: "" });
      const { payload } = await buildPayload();
      const task = loadPdfFromBytes(new Uint8Array(payload));
      const pdf = await task.promise;
      if (closed.current) {
        void task.destroy();
        return;
      }
      clearPreview();
      previewTask.current = task;
      setPreviewPage(1);
      setPreview(pdf);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPrinting(false);
    }
  };

  const handlePrint = async () => {
    if (!controller?.pdf) return;
    setPrinting(true);
    try {
      s.set({ error: "" });
      const { payload, pages: pageCount } = await buildPayload();
      const pages = { length: pageCount };
      if (native) {
        const printed = await printDocument(payload as Uint8Array<ArrayBuffer>, pages.length);
        s.set({ status: printed ? "Print operation completed" : "Print cancelled" });
        onClose();
        return;
      }
      const blob = new Blob([payload as unknown as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          iframe.remove();
          URL.revokeObjectURL(url);
          onClose();
        }, 60000);
      };
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <FeatureDialog title="Print document" onClose={onClose} busy={printing}>
      <div className="modal-dialog print-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Printer size={18} />
            <h3>Print Document</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <fieldset className="setting-group">
            <legend className="setting-title">Page Range</legend>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  name="range"
                  checked={rangeMode === "all"}
                  onChange={() => setRangeMode("all")}
                />{" "}
                All pages ({s.info?.pages || 1} pages)
              </label>
              <label>
                <input
                  type="radio"
                  name="range"
                  checked={rangeMode === "current"}
                  onChange={() => setRangeMode("current")}
                />{" "}
                Current page (Page {s.page})
              </label>
              <label>
                <input
                  type="radio"
                  name="range"
                  checked={rangeMode === "custom"}
                  onChange={() => setRangeMode("custom")}
                />{" "}
                Pages:
              </label>
              {rangeMode === "custom" && (
                <input
                  type="text"
                  placeholder="e.g. 1-3, 5"
                  aria-label="Custom page range"
                  value={customRange}
                  onChange={(e) => setCustomRange(e.target.value)}
                  className="text-input"
                />
              )}
            </div>
          </fieldset>

          <div className="form-columns">
            <label className="setting-group">
              <span className="setting-title">Subset</span>
              <select
                className="text-input"
                value={subset}
                onChange={(event) => setSubset(event.target.value as PageSubset)}
              >
                <option value="all">All pages in range</option>
                <option value="odd">Odd pages only</option>
                <option value="even">Even pages only</option>
              </select>
            </label>
            <label className="setting-group">
              <span className="setting-title">Comments and forms</span>
              <select
                className="text-input"
                value={content}
                onChange={(event) => setContent(event.target.value as PrintContent)}
              >
                {(Object.keys(CONTENT_LABELS) as PrintContent[]).map((key) => (
                  <option key={key} value={key}>
                    {CONTENT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={reverse}
              onChange={(event) => setReverse(event.target.checked)}
            />
            <span>Reverse page order</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={grayscale}
              onChange={(event) => setGrayscale(event.target.checked)}
            />
            <span>Print in grayscale</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={asImage}
              onChange={(event) => setAsImage(event.target.checked)}
            />
            <span>Print as image</span>
          </label>
          {rasterize && (
            <div className="setting-group">
              <label className="setting-title" htmlFor="print-resolution">
                Image resolution
              </label>
              <select
                id="print-resolution"
                className="text-input"
                value={dpi}
                onChange={(event) => setDpi(Number(event.target.value))}
              >
                <option value={150}>150 dpi</option>
                <option value={300}>300 dpi</option>
              </select>
              <span className="field-hint">
                Pages are rendered as images, so printed text is not selectable and very large pages
                use a lower resolution.
              </span>
            </div>
          )}

          <p className="field-hint">
            Orientation, scale, and destination are chosen in the system print dialog that opens
            next.
          </p>

          {preview && (
            <section aria-label="Print preview" className="print-preview">
              <label>
                Preview page{" "}
                <input
                  className="text-input"
                  type="number"
                  min={1}
                  max={preview.numPages}
                  value={previewPage}
                  onChange={(event) =>
                    setPreviewPage(
                      Math.min(preview.numPages, Math.max(1, Number(event.target.value) || 1)),
                    )
                  }
                />{" "}
                of {preview.numPages}
              </label>
              <PdfPagePreview pdf={preview} page={previewPage} label="Print preview" />
            </section>
          )}

          {hasMixedDimensions && (
            <output className="structure-warning" style={{ marginTop: 12 }}>
              {mixedDimensionsNote}
            </output>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void showPreview()}
            disabled={printing}
            className="button-secondary"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => {
              void handlePrint();
            }}
            disabled={printing}
            className="button-primary"
          >
            {printing ? "Preparing..." : "Print"}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

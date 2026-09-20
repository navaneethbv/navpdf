import { useState, useEffect } from "react";
import { native, printDocument } from "../../services/native";
import { Printer, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { extractPages } from "../../services/document-commands";
import { parsePageRange, type RangeMode } from "./page-range";
import type { ViewerController } from "../viewer/controller";
import { FeatureDialog } from "../../components/FeatureDialog";

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

  const handlePrint = async () => {
    if (!controller?.pdf) return;
    setPrinting(true);
    try {
      // Print the current edited revision, including unsaved annotations.
      controller.editor?.commitOrRemove();
      const bytes = await controller.pdf.saveDocument();
      const totalPages = controller.pdf.numPages;
      const pages = parsePageRange(rangeMode, customRange, s.page, totalPages);
      // Only rebuild the document when a subset was actually requested, so a
      // full-document print keeps the original structure intact.
      const payload = pages.length === totalPages ? bytes : await extractPages(bytes, pages);
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

          <p className="field-hint">
            Orientation, scale, and destination are chosen in the system print dialog that opens
            next.
          </p>

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
            onClick={handlePrint}
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

import { useState } from "react";
import { native, printDocument } from "../../services/native";
import { Printer, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { extractPages } from "../../services/document-commands";
import { parsePageRange, type RangeMode } from "./print-range";
import type { ViewerController } from "../viewer/controller";

export function PrintDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customRange, setCustomRange] = useState("");
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    if (!controller?.pdf) return;
    setPrinting(true);
    try {
      // Print the current edited revision, including unsaved annotations.
      controller.editor?.commitOrRemove();
      const bytes = await controller.pdf.saveDocument();
      const totalPages = controller.pdf.numPages;
      const pages = parsePageRange(
        rangeMode,
        customRange,
        s.page,
        totalPages,
      );
      // Only rebuild the document when a subset was actually requested, so a
      // full-document print keeps the original structure intact.
      const payload =
        pages.length === totalPages ? bytes : await extractPages(bytes, pages);
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
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Print document">
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
          <div className="setting-group">
            <label className="setting-title">Page Range</label>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  name="range"
                  checked={rangeMode === "all"}
                  onChange={() => setRangeMode("all")}
                />
                All pages ({s.info?.pages || 1} pages)
              </label>
              <label>
                <input
                  type="radio"
                  name="range"
                  checked={rangeMode === "current"}
                  onChange={() => setRangeMode("current")}
                />
                Current page (Page {s.page})
              </label>
              <label>
                <input
                  type="radio"
                  name="range"
                  checked={rangeMode === "custom"}
                  onChange={() => setRangeMode("custom")}
                />
                Pages:
              </label>
              {rangeMode === "custom" && (
                <input
                  type="text"
                  placeholder="e.g. 1-3, 5"
                  value={customRange}
                  onChange={(e) => setCustomRange(e.target.value)}
                  className="text-input"
                />
              )}
            </div>
          </div>

          <p className="field-hint">
            Orientation, scale, and destination are chosen in the system print
            dialog that opens next.
          </p>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="button-primary"
          >
            {printing ? "Preparing..." : "Print"}
          </button>
        </div>
      </div>
    </div>
  );
}

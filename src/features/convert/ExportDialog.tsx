import { useState } from "react";
import { Download, FileText, Image as ImageIcon, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob } from "../../utils/download";

export function ExportDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [format, setFormat] = useState<"txt" | "png" | "jpg">("txt");
  const [exporting, setExporting] = useState(false);

  const handleExportText = async () => {
    if (!controller?.pdf) return;
    setExporting(true);
    try {
      const total = controller.pdf.numPages;
      const textChunks: string[] = [];
      for (let i = 1; i <= total; i++) {
        const page = await controller.pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          // @ts-expect-error item has str property in TextItem
          .map((item) => item.str || "")
          .join(" ");
        textChunks.push(`--- Page ${i} ---\n\n${pageText}\n\n`);
      }
      const fullText = textChunks.join("\n");
      downloadBlob(
        new Blob([fullText], { type: "text/plain;charset=utf-8" }),
        (s.document?.name || "document").replace(/\.pdf$/i, ".txt"),
      );
      s.set({ status: "Text exported successfully" });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
    }
  };

  const handleExportImage = async () => {
    if (!controller?.pdf) return;
    setExporting(true);
    try {
      const page = await controller.pdf.getPage(s.page);
      const viewport = page.getViewport({ scale: 2.0 }); // 150 DPI scale
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // @ts-expect-error PDF.js render context
        await page.render({ canvasContext: ctx, viewport }).promise;
        const mime = format === "jpg" ? "image/jpeg" : "image/png";
        const dataUrl = canvas.toDataURL(mime, 0.92);
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${s.document?.name || "document"}-page-${s.page}.${format}`;
        a.click();
        s.set({ status: `Page ${s.page} exported as ${format.toUpperCase()}` });
        onClose();
      }
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Export Document">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Download size={18} />
            <h3>Export Document</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-title">Export Format</label>
            <div className="tab-buttons-bar">
              <button
                className={format === "txt" ? "active" : ""}
                onClick={() => setFormat("txt")}
              >
                <FileText size={15} /> Plain Text (.txt)
              </button>
              <button
                className={format === "png" ? "active" : ""}
                onClick={() => setFormat("png")}
              >
                <ImageIcon size={15} /> PNG Image
              </button>
              <button
                className={format === "jpg" ? "active" : ""}
                onClick={() => setFormat("jpg")}
              >
                <ImageIcon size={15} /> JPEG Image
              </button>
            </div>
          </div>

          {format === "txt" ? (
            <p className="field-hint">
              Exports all text across all {s.info?.pages || 1} pages with page breaks and reading order preserved.
            </p>
          ) : (
            <p className="field-hint">
              Exports page {s.page} as a high-resolution 150 DPI image.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={format === "txt" ? handleExportText : handleExportImage}
            disabled={exporting}
            className="button-primary"
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

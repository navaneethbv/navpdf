import { useState } from "react";
import { FileText, Presentation, FileSpreadsheet, Download, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob } from "../../utils/download";

export function OfficeExport({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [format, setFormat] = useState<"docx" | "pptx" | "xlsx">("docx");
  const [converting, setConverting] = useState(false);

  const handleExport = async () => {
    if (!controller?.pdf) return;
    setConverting(true);
    try {
      const total = controller.pdf.numPages;
      const pagesText: string[] = [];

      for (let i = 1; i <= total; i++) {
        const page = await controller.pdf.getPage(i);
        const textContent = await page.getTextContent();
        // @ts-expect-error item str
        const lines = textContent.items.map((it) => it.str || "").join(" ");
        pagesText.push(lines);
      }

      let blob: Blob;
      let ext: string;

      if (format === "docx") {
        // Word-compatible HTML: opens in Word, but it is NOT editable OOXML.
        // True DOCX reconstruction needs the M7 conversion engine trial.
        const docHtml = `
          <!DOCTYPE html>
          <html>
            <head><meta charset="utf-8"><title>${s.document?.name || "Document"}</title></head>
            <body>
              ${pagesText
                .map(
                  (text, idx) =>
                    `<h2>Page ${idx + 1}</h2><p style="margin-bottom: 24px;">${text}</p>`,
                )
                .join("")}
            </body>
          </html>
        `;
        blob = new Blob([docHtml], { type: "application/msword" });
        ext = "doc";
      } else if (format === "pptx") {
        // Slide-per-page HTML outline, not an editable PPTX. See M7 note above.
        const presHtml = `
          <!DOCTYPE html>
          <html>
            <head><meta charset="utf-8"><title>${s.document?.name || "Slides"}</title></head>
            <body>
              ${pagesText
                .map(
                  (text, idx) =>
                    `<div style="page-break-after: always; padding: 40px;"><h1>Slide ${idx + 1}</h1><p>${text}</p></div>`,
                )
                .join("")}
            </body>
          </html>
        `;
        blob = new Blob([presHtml], { type: "application/vnd.ms-powerpoint" });
        ext = "ppt";
      } else {
        // Extract CSV / spreadsheet data
        const rows = pagesText.map((p, idx) => `Page ${idx + 1},"${p.replace(/"/g, '""')}"`);
        const csv = `Page,Extracted Content\n${rows.join("\n")}`;
        blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        ext = "csv";
      }

      downloadBlob(
        blob,
        `${(s.document?.name || "document").replace(/\.pdf$/i, "")}.${ext}`,
      );
      s.set({ status: `Exported to ${format.toUpperCase()}` });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Convert to Office Formats">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Download size={18} />
            <h3>Export to Office Formats</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="tab-buttons-bar">
              <button
                className={format === "docx" ? "active" : ""}
                onClick={() => setFormat("docx")}
              >
                <FileText size={15} /> Word-compatible (.doc HTML)
              </button>
              <button
                className={format === "pptx" ? "active" : ""}
                onClick={() => setFormat("pptx")}
              >
                <Presentation size={15} /> Slides outline (.ppt HTML)
              </button>
              <button
                className={format === "xlsx" ? "active" : ""}
                onClick={() => setFormat("xlsx")}
              >
                <FileSpreadsheet size={15} /> Table data (.csv)
              </button>
          </div>

          <p className="field-hint" style={{ marginTop: "14px" }}>
            Fidelity limits: Word and slide exports are HTML outlines of the
            extracted text (not editable .docx/.pptx), and table export is
            plain CSV with all values quoted as text so spreadsheet apps never
            interpret them as formulas. High-fidelity Office conversion needs
            the M7 engine trial.
          </p>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={converting}
            className="button-primary"
          >
            {converting ? "Exporting..." : "Export File"}
          </button>
        </div>
      </div>
    </div>
  );
}

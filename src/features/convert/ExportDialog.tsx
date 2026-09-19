import { useId, useEffect, useRef, useState } from "react";
import { Download, FileText, Image as ImageIcon, X, Sliders } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob, safeFileName } from "../../utils/download";
import { parsePageRange } from "../pages/page-range";
import { FeatureDialog } from "../../components/FeatureDialog";

const MAX_EXPORT_PIXELS = 32 * 1024 * 1024;

export function ExportDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const s = useWorkspace();
  const [format, setFormat] = useState<"txt" | "png" | "jpg">("txt");
  const [scope, setScope] = useState<"current" | "all" | "range">("all");
  const [customRange, setCustomRange] = useState("");
  const [dpi, setDpi] = useState<72 | 150 | 300>(150);
  const [quality, setQuality] = useState(0.92);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const active = useRef<{ cancelled: boolean } | null>(null);
  useEffect(
    () => () => {
      if (active.current) active.current.cancelled = true;
    },
    [],
  );

  const totalPages = s.info?.pages || 1;
  const baseName = safeFileName((s.document?.name || "document").replace(/\.pdf$/i, ""));

  const getTargetPages = (): number[] => {
    if (scope === "current") {
      return [s.page - 1];
    }
    if (scope === "all") {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    return parsePageRange("custom", customRange, s.page, totalPages);
  };

  const handleExportText = async () => {
    if (!controller?.pdf || active.current) return;
    const source = controller.pdf;
    const documentId = s.document?.id;
    const run = { cancelled: false };
    active.current = run;
    const cancelled = () =>
      run.cancelled ||
      controller.pdf !== source ||
      useWorkspace.getState().document?.id !== documentId;
    setExporting(true);
    setProgress(10);
    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for export.");
      }

      const textChunks: string[] = [];
      for (let i = 0; i < targetIndices.length; i++) {
        if (cancelled()) return;
        const pageNum = targetIndices[i] + 1;
        setProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
        const page = await source.getPage(pageNum);
        if (cancelled()) return;
        const content = await page.getTextContent();

        // Sort items in top-to-bottom, left-to-right reading order
        const items = content.items
          // @ts-expect-error item coordinates and string
          .filter((item) => item.str && item.str.trim())
          .sort((a, b) => {
            // @ts-expect-error transform [4] is x, [5] is y in PDF.js
            const aY = a.transform ? a.transform[5] : 0;
            // @ts-expect-error transform
            const bY = b.transform ? b.transform[5] : 0;
            // PDF y is bottom-up; higher y comes first (higher on page)
            if (Math.abs(aY - bY) > 6) {
              return bY - aY;
            }
            // Same line: sort by x ascending
            // @ts-expect-error transform
            const aX = a.transform ? a.transform[4] : 0;
            // @ts-expect-error transform
            const bX = b.transform ? b.transform[4] : 0;
            return aX - bX;
          });

        // @ts-expect-error item str
        const pageText = items.map((item) => item.str).join(" ");
        textChunks.push(`--- Page ${pageNum} ---\n\n${pageText}\n\n`);
      }

      if (cancelled()) return;

      const fullText = textChunks.join("\n");
      if (
        !(await downloadBlob(
          new Blob([fullText], { type: "text/plain;charset=utf-8" }),
          `${baseName}.txt`,
        ))
      )
        return;
      if (cancelled()) return;
      s.set({
        status:
          targetIndices.length === totalPages
            ? "Text exported successfully"
            : `Text exported successfully for ${targetIndices.length} page(s).`,
      });
      onClose();
    } catch (err) {
      if (!cancelled()) s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (active.current === run) {
        active.current = null;
        setExporting(false);
      }
    }
  };

  const handleExportImage = async () => {
    if (!controller?.pdf || active.current) return;
    const source = controller.pdf;
    const documentId = s.document?.id;
    const run = { cancelled: false };
    active.current = run;
    const cancelled = () =>
      run.cancelled ||
      controller.pdf !== source ||
      useWorkspace.getState().document?.id !== documentId;
    setExporting(true);
    setProgress(10);
    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for export.");
      }

      // 72 DPI scale = 1.0; 150 DPI scale = 2.083; 300 DPI scale = 4.166
      const scale = { 72: 1, 150: 2.083, 300: 4.166 }[dpi];
      const mime = format === "jpg" ? "image/jpeg" : "image/png";

      for (let i = 0; i < targetIndices.length; i++) {
        if (cancelled()) return;
        const pageNum = targetIndices[i] + 1;
        setProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
        const page = await source.getPage(pageNum);
        if (cancelled()) return;
        const viewport = page.getViewport({ scale });

        const pixelArea = Math.ceil(viewport.width) * Math.ceil(viewport.height);
        if (pixelArea > MAX_EXPORT_PIXELS || viewport.width > 8192 || viewport.height > 8192) {
          throw new Error(
            `Export resolution too high: page ${pageNum} would exceed maximum dimensions.`,
          );
        }

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("The page could not be rendered for export.");
        // Draw white background for JPEGs to prevent black transparency
        if (format === "jpg") {
          ctx.fillStyle = "#ffffff";
          if (typeof ctx.fillRect === "function") {
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
        // @ts-expect-error PDF.js render
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (cancelled()) return;

        try {
          const dataUrl = canvas.toDataURL ? canvas.toDataURL(mime, quality) : "";
          if (!dataUrl) throw new Error("The image could not be exported.");
          const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const imageBytes = Uint8Array.from(atob(encoded), (char) => char.codePointAt(0)!);
          if (
            !(await downloadBlob(
              new Blob([imageBytes], { type: mime }),
              `${baseName}-page-${pageNum}.${format}`,
            ))
          )
            return;
        } catch (error) {
          if (error instanceof Error && error.message === "The image could not be exported.") {
            throw error;
          }
          throw new Error("The image could not be exported.", { cause: error });
        }
      }

      if (cancelled()) return;
      s.set({
        status: `Exported ${targetIndices.length} page(s) as ${format.toUpperCase()} (${dpi} DPI).`,
      });
      onClose();
    } catch (err) {
      if (!cancelled()) s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (active.current === run) {
        active.current = null;
        setExporting(false);
      }
    }
  };

  const cancelExport = () => {
    if (!exporting) return;
    if (active.current) active.current.cancelled = true;
    s.set({ status: "Export cancelled. No additional pages were downloaded." });
  };

  return (
    <FeatureDialog title="Export Document" onClose={onClose} busy={exporting}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Download size={18} />
            <h3>Export Document</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close" disabled={exporting}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <fieldset className="setting-group">
            <legend className="setting-title">Export Format</legend>
            <div className="tab-buttons-bar">
              <button
                className={format === "txt" ? "active" : ""}
                aria-pressed={format === "txt"}
                onClick={() => setFormat("txt")}
                disabled={exporting}
              >
                <FileText size={15} /> Plain Text (.txt)
              </button>
              <button
                className={format === "png" ? "active" : ""}
                aria-pressed={format === "png"}
                onClick={() => setFormat("png")}
                disabled={exporting}
              >
                <ImageIcon size={15} /> PNG Image
              </button>
              <button
                className={format === "jpg" ? "active" : ""}
                aria-pressed={format === "jpg"}
                onClick={() => setFormat("jpg")}
                disabled={exporting}
              >
                <ImageIcon size={15} /> JPEG Image
              </button>
            </div>
          </fieldset>

          <fieldset className="setting-group">
            <legend className="setting-title">Page Scope</legend>
            <div className="tab-buttons-bar">
              <button
                className={scope === "all" ? "active" : ""}
                aria-pressed={scope === "all"}
                onClick={() => setScope("all")}
                disabled={exporting}
              >
                All Pages ({totalPages})
              </button>
              <button
                className={scope === "current" ? "active" : ""}
                aria-pressed={scope === "current"}
                onClick={() => setScope("current")}
                disabled={exporting}
              >
                Current Page ({s.page})
              </button>
              <button
                className={scope === "range" ? "active" : ""}
                aria-pressed={scope === "range"}
                onClick={() => setScope("range")}
                disabled={exporting}
              >
                Custom Range
              </button>
            </div>
            {scope === "range" && (
              <input
                type="text"
                placeholder="e.g. 1-3, 5"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                style={{ marginTop: "8px" }}
                disabled={exporting}
              />
            )}
          </fieldset>

          {format !== "txt" && (
            <>
              <fieldset className="setting-group">
                <legend className="setting-title">
                  <Sliders size={14} style={{ display: "inline", marginRight: "4px" }} /> Resolution
                  (DPI)
                </legend>
                <div className="tab-buttons-bar">
                  <button
                    className={dpi === 72 ? "active" : ""}
                    onClick={() => setDpi(72)}
                    disabled={exporting}
                  >
                    72 DPI (Draft)
                  </button>
                  <button
                    className={dpi === 150 ? "active" : ""}
                    onClick={() => setDpi(150)}
                    disabled={exporting}
                  >
                    150 DPI (Standard)
                  </button>
                  <button
                    className={dpi === 300 ? "active" : ""}
                    onClick={() => setDpi(300)}
                    disabled={exporting}
                  >
                    300 DPI (High Print)
                  </button>
                </div>
              </fieldset>

              {format === "jpg" && (
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
                    JPEG Quality: {Math.round(quality * 100)}%
                  </label>
                  <input
                    id={`${fieldIds}-field-1`}
                    type="range"
                    min="0.6"
                    max="1.0"
                    step="0.05"
                    value={quality}
                    onChange={(e) => setQuality(Number.parseFloat(e.target.value))}
                    disabled={exporting}
                  />
                </div>
              )}
            </>
          )}

          {format === "txt" ? (
            <p className="field-hint">
              Exports UTF-8 plain text in top-to-bottom reading order with structured page headers.
            </p>
          ) : (
            <p className="field-hint">
              Exports each page as a {dpi} DPI {format.toUpperCase()} image with bounds protection.
            </p>
          )}

          {exporting && (
            <div style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "12px", marginBottom: "4px" }}>Exporting... {progress}%</div>
              <div
                style={{
                  height: "4px",
                  background: "var(--border-color, #e5e7eb)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: "var(--primary, #2563eb)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary" disabled={exporting}>
            Cancel
          </button>
          {exporting && (
            <button onClick={cancelExport} className="button-secondary">
              Cancel export
            </button>
          )}
          <button
            onClick={format === "txt" ? handleExportText : handleExportImage}
            disabled={exporting}
            className="button-primary"
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

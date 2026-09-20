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

  const beginExport = () => {
    if (!controller?.pdf || active.current) return null;
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
    return { run, source, cancelled };
  };
  const endExport = (run: { cancelled: boolean }) => {
    if (active.current === run) {
      active.current = null;
      setExporting(false);
    }
  };

  const handleExportText = async () => {
    const context = beginExport();
    if (!context) return;
    const { run, source, cancelled } = context;
    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for export.");
      }

      const textChunks = await collectPagesText(source, targetIndices, cancelled, setProgress);
      if (!textChunks || cancelled()) return;

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
      endExport(run);
    }
  };

  const handleExportImage = async () => {
    const context = beginExport();
    if (!context) return;
    const { run, source, cancelled } = context;
    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for export.");
      }

      const scale = dpi / 72;
      const imgFormat = format === "jpg" ? "jpg" : "png";

      for (let i = 0; i < targetIndices.length; i++) {
        if (cancelled()) return;
        const pageNum = targetIndices[i] + 1;
        setProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
        const page = await source.getPage(pageNum);
        if (cancelled()) return;
        const saved = await exportSinglePageImage({
          page,
          scale,
          format: imgFormat,
          quality,
          pageNum,
          baseName,
        });
        if (!saved || cancelled()) return;
      }

      if (cancelled()) return;
      s.set({
        status: `Exported ${targetIndices.length} page(s) as ${format.toUpperCase()} (${dpi} DPI).`,
      });
      onClose();
    } catch (err) {
      if (!cancelled()) s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      endExport(run);
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
                type="button"
                className={format === "txt" ? "active" : ""}
                aria-pressed={format === "txt"}
                onClick={() => {
                  setFormat("txt");
                }}
                disabled={exporting}
              >
                <FileText size={15} /> Plain Text (.txt)
              </button>
              <button
                type="button"
                className={format === "png" ? "active" : ""}
                aria-pressed={format === "png"}
                onClick={() => {
                  setFormat("png");
                }}
                disabled={exporting}
              >
                <ImageIcon size={15} /> PNG Image
              </button>
              <button
                type="button"
                className={format === "jpg" ? "active" : ""}
                aria-pressed={format === "jpg"}
                onClick={() => {
                  setFormat("jpg");
                }}
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
                type="button"
                className={scope === "all" ? "active" : ""}
                aria-pressed={scope === "all"}
                onClick={() => {
                  setScope("all");
                }}
                disabled={exporting}
              >
                All Pages ({totalPages})
              </button>
              <button
                type="button"
                className={scope === "current" ? "active" : ""}
                aria-pressed={scope === "current"}
                onClick={() => {
                  setScope("current");
                }}
                disabled={exporting}
              >
                Current Page ({s.page})
              </button>
              <button
                type="button"
                className={scope === "range" ? "active" : ""}
                aria-pressed={scope === "range"}
                onClick={() => {
                  setScope("range");
                }}
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
                onChange={(e) => {
                  setCustomRange(e.target.value);
                }}
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
                    type="button"
                    className={dpi === 72 ? "active" : ""}
                    onClick={() => {
                      setDpi(72);
                    }}
                    disabled={exporting}
                  >
                    72 DPI (Draft)
                  </button>
                  <button
                    type="button"
                    className={dpi === 150 ? "active" : ""}
                    onClick={() => {
                      setDpi(150);
                    }}
                    disabled={exporting}
                  >
                    150 DPI (Standard)
                  </button>
                  <button
                    type="button"
                    className={dpi === 300 ? "active" : ""}
                    onClick={() => {
                      setDpi(300);
                    }}
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
                    onChange={(e) => {
                      setQuality(Number.parseFloat(e.target.value));
                    }}
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
          <button type="button" onClick={onClose} className="button-secondary" disabled={exporting}>
            Cancel
          </button>
          {exporting && (
            <button type="button" onClick={cancelExport} className="button-secondary">
              Cancel export
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void (format === "txt" ? handleExportText() : handleExportImage());
            }}
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

async function collectPagesText(
  source: NonNullable<ViewerController["pdf"]>,
  targetIndices: number[],
  cancelled: () => boolean,
  onProgress: (percent: number) => void,
): Promise<string[] | null> {
  const textChunks: string[] = [];
  for (let i = 0; i < targetIndices.length; i++) {
    if (cancelled()) return null;
    const pageNum = targetIndices[i] + 1;
    onProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
    const page = await source.getPage(pageNum);
    if (cancelled()) return null;
    const content = await page.getTextContent();
    // @ts-expect-error PDF.js text items
    const pageText = extractPageTextContent(content.items);
    textChunks.push(`--- Page ${pageNum} ---\n\n${pageText}\n\n`);
  }
  return textChunks;
}

function extractPageTextContent(items: Array<{ str?: string; transform?: number[] }>): string {
  const filtered = items
    .filter((item) => item.str && item.str.trim())
    .sort((a, b) => {
      const aY = a.transform?.[5] ?? 0;
      const bY = b.transform?.[5] ?? 0;
      if (Math.abs(aY - bY) > 6) {
        return bY - aY;
      }
      const aX = a.transform?.[4] ?? 0;
      const bX = b.transform?.[4] ?? 0;
      return aX - bX;
    });
  return filtered.map((item) => item.str).join(" ");
}

interface RenderPageOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
  scale: number;
  format: "jpg" | "png";
  quality: number;
  pageNum: number;
  baseName: string;
}

async function exportSinglePageImage(options: RenderPageOptions): Promise<boolean> {
  const { page, scale, format, quality, pageNum, baseName } = options;
  const viewport = page.getViewport({ scale });
  const pixelArea = Math.ceil(viewport.width) * Math.ceil(viewport.height);
  if (pixelArea > MAX_EXPORT_PIXELS || viewport.width > 8192 || viewport.height > 8192) {
    throw new Error(`Export resolution too high: page ${pageNum} would exceed maximum dimensions.`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The page could not be rendered for export.");
  if (format === "jpg") {
    ctx.fillStyle = "#ffffff";
    if (typeof ctx.fillRect === "function") {
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  await page.render({ canvasContext: ctx, viewport }).promise;

  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  try {
    const dataUrl = canvas.toDataURL ? canvas.toDataURL(mime, quality) : "";
    if (!dataUrl) throw new Error("The image could not be exported.");
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const imageBytes = Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
    return await downloadBlob(
      new Blob([imageBytes], { type: mime }),
      `${baseName}-page-${pageNum}.${format}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "The image could not be exported.") {
      throw error;
    }
    throw new Error("The image could not be exported.", { cause: error });
  }
}

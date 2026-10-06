import { useId, useEffect, useRef, useState } from "react";
import { Download, FileText, Image as ImageIcon, Printer, X, Sliders } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob, safeFileName } from "../../utils/download";
import { parsePageRange } from "../pages/page-range";
import { FeatureDialog } from "../../components/FeatureDialog";
import { createZip, layoutPage, type PageLayout, type TextItem } from "./ooxml";
import { buildPlainText } from "./formats";
import {
  buildEps,
  buildPostScript,
  buildTiff,
  compressTiffPage,
  type JpegPage,
  type TiffPage,
} from "./raster";

const MAX_EXPORT_PIXELS = 32 * 1024 * 1024;
/** Matches the native export size limit so an oversized export fails before encoding. */
const MAX_EXPORT_BYTES = 1024 ** 3;

type ExportFormat = "txt" | "png" | "jpg" | "tiff" | "ps" | "eps";
type RasterFormat = Exclude<ExportFormat, "txt">;

const FORMATS: { id: ExportFormat; label: string; icon: LucideIcon }[] = [
  { id: "txt", label: "Plain Text (.txt)", icon: FileText },
  { id: "png", label: "PNG Image", icon: ImageIcon },
  { id: "jpg", label: "JPEG Image", icon: ImageIcon },
  { id: "tiff", label: "TIFF Image", icon: ImageIcon },
  { id: "ps", label: "PostScript (.ps)", icon: Printer },
  { id: "eps", label: "EPS (.eps)", icon: Printer },
];

const HINTS: Record<RasterFormat, string> = {
  png: "Exports each page as a lossless PNG image.",
  jpg: "Exports each page as a JPEG image on a white background.",
  tiff: "Exports the selected pages as one multipage TIFF with lossless PackBits compression.",
  ps: "Exports one PostScript file with a page image per page. Text and drawings become pixels.",
  eps: "Exports each page as an Encapsulated PostScript image for page layout applications.",
};

const usesJpeg = (format: ExportFormat) => format === "jpg" || format === "ps" || format === "eps";

interface PageProxy {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
    promise: Promise<void>;
  };
}

function isTextItem(item: unknown): item is TextItem {
  const candidate = item as Partial<TextItem>;
  return (
    typeof candidate?.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number"
  );
}

interface ExportImagePagesOptions {
  source: NonNullable<ViewerController["pdf"]>;
  targetIndices: number[];
  cancelled: () => boolean;
  setProgress: (value: number) => void;
  dpi: number;
  format: RasterFormat;
  quality: number;
  baseName: string;
}

interface ExportFile {
  name: string;
  data: Uint8Array;
}

const MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  tiff: "image/tiff",
  ps: "application/postscript",
  eps: "application/postscript",
};

/** Renders pages one at a time and returns the finished export, or null when cancelled. */
async function exportImagePages({
  source,
  targetIndices,
  cancelled,
  setProgress,
  dpi,
  format,
  quality,
  baseName,
}: ExportImagePagesOptions): Promise<{ blob: Blob; name: string } | null> {
  const scale = dpi / 72;
  const files: ExportFile[] = [];
  const tiffPages: TiffPage[] = [];
  const jpegPages: JpegPage[] = [];
  const encoder = new TextEncoder();
  let total = 0;
  for (let i = 0; i < targetIndices.length; i++) {
    if (cancelled()) return null;
    const pageNum = targetIndices[i] + 1;
    setProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
    const page = (await source.getPage(pageNum)) as unknown as PageProxy;
    if (cancelled()) return null;
    const rendered = await renderPage(page, scale, pageNum, format !== "png");
    try {
      if (format === "tiff") {
        const { canvas, context } = rendered;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const compressed = compressTiffPage({
          width: canvas.width,
          height: canvas.height,
          rgba: pixels.data,
          dpi,
        });
        tiffPages.push(compressed);
        total += compressed.byteLength;
      } else if (format === "png") {
        const data = canvasBytes(rendered.canvas, "image/png", quality);
        files.push({ name: `${baseName}-page-${pageNum}.png`, data });
        total += data.length;
      } else {
        const jpeg = canvasBytes(rendered.canvas, "image/jpeg", quality);
        const jpegPage: JpegPage = {
          jpeg,
          pixelWidth: rendered.canvas.width,
          pixelHeight: rendered.canvas.height,
          width: rendered.width,
          height: rendered.height,
        };
        if (format === "jpg") files.push({ name: `${baseName}-page-${pageNum}.jpg`, data: jpeg });
        else if (format === "eps")
          files.push({
            name: `${baseName}-page-${pageNum}.eps`,
            data: encoder.encode(buildEps(jpegPage, `${baseName} page ${pageNum}`)),
          });
        else jpegPages.push(jpegPage);
        // ASCII85 expands embedded image data by a quarter.
        total += format === "jpg" ? jpeg.length : Math.ceil(jpeg.length * 1.25);
      }
    } finally {
      // Release the backing store now; WebKit otherwise keeps it until collection.
      rendered.canvas.width = 0;
      rendered.canvas.height = 0;
    }
    if (total > MAX_EXPORT_BYTES) {
      throw new Error(
        "The export exceeds the 1 GB limit. Choose fewer pages or a lower resolution.",
      );
    }
  }
  if (cancelled()) return null;
  if (format === "tiff")
    return { blob: blobOf(buildTiff(tiffPages), MIME.tiff), name: `${baseName}.tiff` };
  if (format === "ps")
    return {
      blob: new Blob([buildPostScript(jpegPages, baseName)], { type: MIME.ps }),
      name: `${baseName}.ps`,
    };
  if (files.length === 1) return { blob: blobOf(files[0].data, MIME[format]), name: files[0].name };
  // Several pages are packaged together so the export asks for one destination, not one per page.
  return {
    blob: blobOf(createZip(files), "application/zip"),
    name: `${baseName}-${format}-pages.zip`,
  };
}

function blobOf(bytes: Uint8Array, type: string) {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
}

export function ExportDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const s = useWorkspace();
  const [format, setFormat] = useState<ExportFormat>("txt");
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

      const layouts = await collectPageLayouts(source, targetIndices, cancelled, setProgress);
      if (!layouts || cancelled()) return;
      if (!layouts.some((layout) => layout.lines.length)) {
        throw new Error("These pages have no text layer to export. Run OCR first.");
      }

      if (
        !(await downloadBlob(
          new Blob([buildPlainText(layouts)], { type: "text/plain;charset=utf-8" }),
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

  const handleExportImage = async (rasterFormat: RasterFormat) => {
    const context = beginExport();
    if (!context) return;
    const { run, source, cancelled } = context;
    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for export.");
      }

      const exported = await exportImagePages({
        source,
        targetIndices,
        cancelled,
        setProgress,
        dpi,
        format: rasterFormat,
        quality,
        baseName,
      });
      if (!exported || cancelled()) return;
      if (!(await downloadBlob(exported.blob, exported.name))) return;
      if (cancelled()) return;
      s.set({
        status: `Exported ${targetIndices.length} page(s) as ${rasterFormat.toUpperCase()} (${dpi} DPI).`,
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
    s.set({ status: "Export cancelled. No file was saved." });
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
              {FORMATS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={format === id ? "active" : ""}
                  aria-pressed={format === id}
                  onClick={() => {
                    setFormat(id);
                  }}
                  disabled={exporting}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
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
                aria-label="Export page range"
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
                  {(
                    [
                      [72, "72 DPI (Draft)"],
                      [150, "150 DPI (Standard)"],
                      [300, "300 DPI (High Print)"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={dpi === value ? "active" : ""}
                      aria-pressed={dpi === value}
                      onClick={() => {
                        setDpi(value);
                      }}
                      disabled={exporting}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {usesJpeg(format) && (
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
              Exports UTF-8 plain text line by line in reading order, with a header for each page.
            </p>
          ) : (
            <p className="field-hint">
              {HINTS[format]} Pages render at {dpi} DPI with bounds protection
              {format === "tiff" || format === "ps"
                ? "."
                : "; several pages are saved together as one ZIP archive."}
            </p>
          )}

          {exporting && (
            <div style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "12px", marginBottom: "4px" }}>Exporting... {progress}%</div>
              <div
                style={{
                  height: "4px",
                  background: "var(--line)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: "var(--accent)",
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
              void (format === "txt" ? handleExportText() : handleExportImage(format));
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

async function collectPageLayouts(
  source: NonNullable<ViewerController["pdf"]>,
  targetIndices: number[],
  cancelled: () => boolean,
  onProgress: (percent: number) => void,
): Promise<PageLayout[] | null> {
  const layouts: PageLayout[] = [];
  for (let i = 0; i < targetIndices.length; i++) {
    if (cancelled()) return null;
    const pageNum = targetIndices[i] + 1;
    onProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
    const page = (await source.getPage(pageNum)) as unknown as PageProxy;
    if (cancelled()) return null;
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    layouts.push(layoutPage(pageNum, content.items.filter(isTextItem), width, height));
  }
  return layouts;
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  /** Page size in points. */
  width: number;
  height: number;
}

async function renderPage(
  page: PageProxy,
  scale: number,
  pageNum: number,
  opaque: boolean,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (width * height > MAX_EXPORT_PIXELS || width > 8192 || height > 8192) {
    throw new Error(`Export resolution too high: page ${pageNum} would exceed maximum dimensions.`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The page could not be rendered for export.");
  if (opaque) {
    context.fillStyle = "#ffffff";
    if (typeof context.fillRect === "function") {
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  await page.render({ canvasContext: context, viewport }).promise;
  return { canvas, context, width: viewport.width / scale, height: viewport.height / scale };
}

function canvasBytes(canvas: HTMLCanvasElement, mime: string, quality: number): Uint8Array {
  try {
    const dataUrl = canvas.toDataURL ? canvas.toDataURL(mime, quality) : "";
    if (!dataUrl.startsWith(`data:${mime}`)) throw new Error("The image could not be exported.");
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
  } catch (error) {
    if (error instanceof Error && error.message === "The image could not be exported.") {
      throw error;
    }
    throw new Error("The image could not be exported.", { cause: error });
  }
}

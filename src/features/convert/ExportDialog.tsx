import { useId, useEffect, useRef, useState } from "react";
import { Download, FileText, Image as ImageIcon, Printer, X, Sliders } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob, safeFileName } from "../../utils/download";
import { parsePageRange } from "../pages/page-range";
import { FeatureDialog } from "../../components/FeatureDialog";
import { createZip, type PageLayout } from "./ooxml";
import { readPageLayout, type PageProxy } from "./pdf-page";
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
const IMAGE_EXPORT_FAILED = "The image could not be exported.";
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
  png: "Exports each page as a lossless PNG image; several pages are saved as one ZIP archive.",
  jpg: "Exports each page as a JPEG image on a white background; several pages are saved as one ZIP archive.",
  tiff: "Exports the selected pages as one multipage TIFF with lossless PackBits compression.",
  ps: "Exports one PostScript file with a page image per page. Text and drawings become pixels.",
  eps: "Exports each page as an Encapsulated PostScript image; several pages are saved as one ZIP archive.",
};

const usesJpeg = (format: ExportFormat) => format === "jpg" || format === "ps" || format === "eps";

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

interface ExportParts {
  files: ExportFile[];
  tiffPages: TiffPage[];
  jpegPages: JpegPage[];
  bytes: number;
}

const encoder = new TextEncoder();

/** Encodes one rendered page into the parts of the export being assembled. */
function addRenderedPage(
  parts: ExportParts,
  rendered: RenderedPage,
  options: { format: RasterFormat; dpi: number; quality: number; name: string; title: string },
) {
  const { canvas, context } = rendered;
  const { format, quality, name } = options;
  if (format === "tiff") {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const page = compressTiffPage({
      width: canvas.width,
      height: canvas.height,
      rgba: pixels.data,
      dpi: options.dpi,
    });
    parts.tiffPages.push(page);
    parts.bytes += page.byteLength;
    return;
  }
  if (format === "png") {
    const data = canvasBytes(canvas, "image/png", quality);
    parts.files.push({ name: `${name}.png`, data });
    parts.bytes += data.length;
    return;
  }
  const jpeg = canvasBytes(canvas, "image/jpeg", quality);
  if (format === "jpg") {
    parts.files.push({ name: `${name}.jpg`, data: jpeg });
    parts.bytes += jpeg.length;
    return;
  }
  const page: JpegPage = {
    jpeg,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    width: rendered.width,
    height: rendered.height,
  };
  if (format === "eps")
    parts.files.push({ name: `${name}.eps`, data: encoder.encode(buildEps(page, options.title)) });
  else parts.jpegPages.push(page);
  // ASCII85 expands embedded image data by a quarter.
  parts.bytes += Math.ceil(jpeg.length * 1.25);
}

function assembleExport(parts: ExportParts, format: RasterFormat, baseName: string) {
  if (format === "tiff")
    return { blob: blobOf(buildTiff(parts.tiffPages), MIME.tiff), name: `${baseName}.tiff` };
  if (format === "ps")
    return {
      blob: new Blob([buildPostScript(parts.jpegPages, baseName)], { type: MIME.ps }),
      name: `${baseName}.ps`,
    };
  const [only] = parts.files;
  if (parts.files.length === 1) return { blob: blobOf(only.data, MIME[format]), name: only.name };
  // Several pages are packaged together so the export asks for one destination, not one per page.
  return {
    blob: blobOf(createZip(parts.files), "application/zip"),
    name: `${baseName}-${format}-pages.zip`,
  };
}

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
  const parts: ExportParts = { files: [], tiffPages: [], jpegPages: [], bytes: 0 };
  for (let i = 0; i < targetIndices.length; i++) {
    if (cancelled()) return null;
    const pageNum = targetIndices[i] + 1;
    setProgress(Math.round(((i + 1) / targetIndices.length) * 80) + 10);
    const page = (await source.getPage(pageNum)) as unknown as PageProxy;
    if (cancelled()) return null;
    const rendered = await renderPage(page, scale, pageNum, format !== "png");
    try {
      addRenderedPage(parts, rendered, {
        format,
        dpi,
        quality,
        name: `${baseName}-page-${pageNum}`,
        title: `${baseName} page ${pageNum}`,
      });
    } finally {
      // Release the backing store now; WebKit otherwise keeps it until collection.
      rendered.canvas.width = 0;
      rendered.canvas.height = 0;
    }
    if (parts.bytes > MAX_EXPORT_BYTES) {
      throw new Error(
        "The export exceeds the 1 GB limit. Choose fewer pages or a lower resolution.",
      );
    }
  }
  if (cancelled()) return null;
  return assembleExport(parts, format, baseName);
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

  type Produce = (
    source: NonNullable<ViewerController["pdf"]>,
    targetIndices: number[],
    cancelled: () => boolean,
  ) => Promise<{ blob: Blob; name: string; status: string } | null>;

  /** Runs one export: selects pages, builds the file, saves it and reports the outcome. */
  const runExport = async (produce: Produce) => {
    const context = beginExport();
    if (!context) return;
    const { run, source, cancelled } = context;
    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for export.");
      }
      const exported = await produce(source, targetIndices, cancelled);
      if (!exported || cancelled()) return;
      if (!(await downloadBlob(exported.blob, exported.name)) || cancelled()) return;
      s.set({ status: exported.status });
      onClose();
    } catch (err) {
      if (!cancelled()) s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      endExport(run);
    }
  };

  const produceText: Produce = async (source, targetIndices, cancelled) => {
    const layouts = await collectPageLayouts(source, targetIndices, cancelled, setProgress);
    if (!layouts) return null;
    if (!layouts.some((layout) => layout.lines.length)) {
      throw new Error("These pages have no text layer to export. Run OCR first.");
    }
    return {
      blob: new Blob([buildPlainText(layouts)], { type: "text/plain;charset=utf-8" }),
      name: `${baseName}.txt`,
      status:
        targetIndices.length === totalPages
          ? "Text exported successfully"
          : `Text exported successfully for ${targetIndices.length} page(s).`,
    };
  };

  const produceImages =
    (rasterFormat: RasterFormat): Produce =>
    async (source, targetIndices, cancelled) => {
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
      if (!exported) return null;
      const label = rasterFormat.toUpperCase();
      return {
        ...exported,
        status: `Exported ${targetIndices.length} page(s) as ${label} (${dpi} DPI).`,
      };
    };

  const startExport = () => {
    const task = runExport(format === "txt" ? produceText : produceImages(format));
    // The runner reports its own failures; this only guards against an unexpected rejection.
    task.catch(() => s.set({ error: "The export could not be completed." }));
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
              {HINTS[format]} Pages render at {dpi} DPI with bounds protection.
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
            onClick={startExport}
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
    layouts.push(await readPageLayout(page, pageNum));
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
    if (!dataUrl.startsWith(`data:${mime}`)) throw new Error(IMAGE_EXPORT_FAILED);
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
  } catch (error) {
    if (error instanceof Error && error.message === IMAGE_EXPORT_FAILED) {
      throw error;
    }
    throw new Error(IMAGE_EXPORT_FAILED, { cause: error });
  }
}

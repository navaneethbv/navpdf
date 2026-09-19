import { useMemo, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob, safeFileName } from "../../utils/download";
import {
  buildDocx,
  buildPptx,
  buildRtf,
  buildXlsx,
  layoutPage,
  tableRows,
  type PageLayout,
  type Slide,
  type TextItem,
} from "./ooxml";
import { parsePageRange } from "../pages/page-range";
import { FeatureDialog } from "../../components/FeatureDialog";

type Format = "docx" | "xlsx" | "pptx-text" | "pptx-images" | "rtf";

const PRESENTATION = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FORMATS: {
  id: Format;
  label: string;
  extension: string;
  mime: string;
  description: string;
}[] = [
  {
    id: "docx",
    label: "Word document (.docx)",
    extension: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    description:
      "Editable paragraphs and headings rebuilt from the PDF text layer, with a page break per page.",
  },
  {
    id: "xlsx",
    label: "Excel workbook (.xlsx)",
    extension: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    description:
      "One sheet per page with text aligned into columns. Numbers and ISO dates become typed cells; formulas are never created.",
  },
  {
    id: "pptx-text",
    label: "PowerPoint, editable text (.pptx)",
    extension: "pptx",
    mime: PRESENTATION,
    description:
      "One slide per page with each text line as an editable text box. Images and drawings are not carried over.",
  },
  {
    id: "pptx-images",
    label: "PowerPoint, page pictures (.pptx)",
    extension: "pptx",
    mime: PRESENTATION,
    description:
      "One slide per page showing a 150 dpi picture of the page. Appearance is kept; text is not editable.",
  },
  {
    id: "rtf",
    label: "Rich Text (.rtf)",
    extension: "rtf",
    mime: "application/rtf",
    description: "Paragraphs and headings for any word processor.",
  },
];

const MAX_PICTURE_SLIDES = 200;
const PICTURE_DPI = 150;
const MAX_PICTURE_EDGE = 4096;

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

async function pagePicture(
  page: PageProxy,
): Promise<{ width: number; height: number; image: Uint8Array }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(PICTURE_DPI / 72, MAX_PICTURE_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A page picture could not be rendered.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("A page picture could not be encoded.");
  return {
    width: base.width,
    height: base.height,
    image: new Uint8Array(await blob.arrayBuffer()),
  };
}

function textExport(format: Format, pages: PageLayout[], baseName: string) {
  if (format === "docx") return buildDocx(pages, baseName);
  if (format === "xlsx")
    return buildXlsx(pages.map((page) => ({ name: `Page ${page.page}`, rows: tableRows(page) })));
  if (format === "pptx-text")
    return buildPptx(
      pages.map((page) => ({
        width: page.width,
        height: page.height,
        boxes: page.lines.map((line) => ({
          x: line.x,
          y: line.y,
          size: line.size,
          text: line.text,
        })),
      })),
      baseName,
    );
  return buildRtf(pages);
}

export function OfficeExport({
  controller,
  onClose,
  initialFormat = "docx",
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
  initialFormat?: Format;
}>) {
  const s = useWorkspace();
  const [format, setFormat] = useState<Format>(initialFormat);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [pageScope, setPageScope] = useState<"all" | "custom">("all");
  const [customRange, setCustomRange] = useState("");
  const cancelled = useRef(false);
  const totalPages = controller?.pdf?.numPages ?? s.info?.pages ?? 1;
  const pageRange = useMemo<{ pages?: number[]; error?: string }>(() => {
    if (pageScope === "all") return { pages: Array.from({ length: totalPages }, (_, i) => i) };
    try {
      return { pages: parsePageRange(customRange, totalPages) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [customRange, pageScope, totalPages]);
  const selected = FORMATS.find((item) => item.id === format) ?? FORMATS[0];
  const baseName = safeFileName(
    (s.document?.name ?? "document").replace(/\.pdf$/i, ""),
    "document",
  );

  const layouts = async (pageNumbers?: number[]): Promise<PageLayout[] | null> => {
    const pdf = controller?.pdf;
    if (!pdf) return null;
    const numbers = pageNumbers ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const result: PageLayout[] = [];
    for (let index = 0; index < numbers.length; index++) {
      const number = numbers[index];
      if (cancelled.current) return null;
      setProgress(`Reading page ${number} of ${numbers.length}…`);
      const page = (await pdf.getPage(number)) as unknown as PageProxy;
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      result.push(layoutPage(number, content.items.filter(isTextItem), width, height));
    }
    return result;
  };

  const run = async (work: () => Promise<void>) => {
    cancelled.current = false;
    setRunning(true);
    try {
      await work();
    } catch (error) {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const exportFile = () =>
    run(async () => {
      const pdf = controller?.pdf;
      if (!pdf) return;
      if (pageRange.error || !pageRange.pages?.length) return;
      const pageNumbers = pageRange.pages.map((page) => page + 1);
      let bytes: Uint8Array<ArrayBuffer> | string;
      if (format === "pptx-images") {
        if (pageNumbers.length > MAX_PICTURE_SLIDES)
          throw new Error(
            `Picture slides are limited to ${MAX_PICTURE_SLIDES} pages. Export a page range first.`,
          );
        const slides: Slide[] = [];
        for (const number of pageNumbers) {
          if (cancelled.current) return;
          setProgress(`Rendering page ${number} of ${pageNumbers.length}…`);
          slides.push(await pagePicture((await pdf.getPage(number)) as unknown as PageProxy));
        }
        bytes = buildPptx(slides, baseName);
      } else {
        const pages = await layouts(pageNumbers);
        if (!pages) return;
        if (!pages.some((page) => page.lines.length))
          throw new Error(
            "This PDF has no text layer to convert. Run OCR first, or export page pictures.",
          );
        bytes = textExport(format, pages, baseName);
      }
      if (cancelled.current) return;
      if (
        !(await downloadBlob(
          new Blob([bytes], { type: selected.mime }),
          `${baseName}.${selected.extension}`,
        ))
      )
        return;
      s.set({ status: `Exported ${selected.label}` });
      onClose();
    });

  const previewCells = () =>
    run(async () => {
      const pages = await layouts([1]);
      if (pages) setPreview(tableRows(pages[0]).slice(0, 8));
    });

  return (
    <FeatureDialog title="Export to Office Formats" onClose={onClose} busy={running}>
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
          <fieldset className="preset-list" disabled={running}>
            <legend className="setting-title">Format</legend>
            {FORMATS.map((item) => (
              <label key={item.id} className="preset-option">
                <input
                  type="radio"
                  name="office-format"
                  checked={format === item.id}
                  onChange={() => {
                    setFormat(item.id);
                    setPreview(null);
                  }}
                />
                <span>
                  {item.label}
                  <span className="field-hint">{item.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="field-hint">
            Editable formats are rebuilt from the PDF text layer: fonts, images, vector drawings and
            exact positions are not carried over, and scanned pages need OCR first. Files are
            created on this device.
          </p>
          <fieldset className="preset-list" disabled={running}>
            <legend className="setting-title">Page range</legend>
            <label className="preset-option">
              <input
                type="radio"
                name="office-page-scope"
                checked={pageScope === "all"}
                onChange={() => setPageScope("all")}
              />
              <span>All pages ({totalPages})</span>
            </label>
            <label className="preset-option">
              <input
                type="radio"
                name="office-page-scope"
                checked={pageScope === "custom"}
                onChange={() => setPageScope("custom")}
              />
              <span>Custom range</span>
            </label>
            {pageScope === "custom" && (
              <>
                <input
                  type="text"
                  placeholder="e.g. 1-3, 5"
                  value={customRange}
                  onChange={(event) => setCustomRange(event.target.value)}
                  className="text-input"
                  aria-label="Office export page range"
                />
                {pageRange.error && (
                  <p className="field-error" role="alert">
                    {pageRange.error}
                  </p>
                )}
              </>
            )}
          </fieldset>
          {format === "xlsx" && (
            <button
              className="button-secondary"
              onClick={() => void previewCells()}
              disabled={running}
            >
              <FileText size={15} /> Preview Page 1 Cells
            </button>
          )}
          {preview && (
            <section className="table-preview" aria-label="Cell preview">
              <table>
                <tbody>
                  {preview.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {progress && (
            <p className="field-hint" aria-live="polite">
              {progress}
            </p>
          )}
        </div>

        <div className="modal-footer">
          {running ? (
            <button
              onClick={() => {
                cancelled.current = true;
                s.set({ status: "Export cancelled" });
              }}
              className="button-secondary"
            >
              Cancel Export
            </button>
          ) : (
            <button onClick={onClose} className="button-secondary">
              Close
            </button>
          )}
          <button
            onClick={() => void exportFile()}
            disabled={running || !controller?.pdf}
            className="button-primary"
          >
            {running ? "Exporting…" : "Export File"}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { FileChartColumn, X } from "lucide-react";
import { FeatureDialog } from "../../components/FeatureDialog";
import { useWorkspace } from "../../stores/workspace";
import { downloadBlob } from "../../utils/download";
import { parsePageRange } from "../pages/page-range";
import type { ViewerController } from "../viewer/controller";
import {
  inspectDocument,
  insightsCsv,
  TEXT_STATUS_LABELS,
  type DocumentInsights,
} from "./document-insights";

const ROWS_PER_PAGE = 100;
const dimension = (value: number | null) =>
  value === null ? "Unavailable" : `${Number(value.toFixed(2))}`;

export function DocumentInsightsDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const ids = useId();
  const documentId = useWorkspace((state) => state.document?.id);
  const fileName = useWorkspace((state) => state.document?.name ?? "document.pdf");
  const pdf = controller?.pdf;
  const [range, setRange] = useState(() => (pdf ? `1-${pdf.numPages}` : ""));
  const [report, setReport] = useState<DocumentInsights | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tablePage, setTablePage] = useState(0);
  const job = useRef<AbortController | null>(null);

  useEffect(() => {
    setRange(pdf ? `1-${pdf.numPages}` : "");
    setReport(null);
    setBusy(false);
    setExporting(false);
    setCompleted(0);
    setMessage("");
    setError("");
    setTablePage(0);
    return () => {
      job.current?.abort();
    };
  }, [pdf, documentId]);

  let selection: number[] = [];
  let rangeError = "";
  if (pdf) {
    try {
      selection = parsePageRange(range, pdf.numPages);
    } catch (cause) {
      rangeError = cause instanceof Error ? cause.message : "Invalid page range.";
    }
  }

  const cancel = () => {
    job.current?.abort();
    setBusy(false);
    setMessage("Inspection cancelled.");
  };
  const close = () => {
    job.current?.abort();
    onClose();
  };

  const inspect = async () => {
    if (!pdf || busy || selection.length === 0) return;
    job.current?.abort();
    const active = new AbortController();
    job.current = active;
    const isCurrent = () =>
      !active.signal.aborted &&
      controller?.pdf === pdf &&
      useWorkspace.getState().document?.id === documentId;
    setBusy(true);
    setReport(null);
    setCompleted(0);
    setMessage("");
    setError("");
    setTablePage(0);
    try {
      const result = await inspectDocument(pdf, selection, {
        signal: active.signal,
        isCancelled: () => !isCurrent(),
        onProgress: (count) => {
          if (isCurrent()) setCompleted(count);
        },
      });
      if (isCurrent()) setReport(result);
    } catch {
      if (isCurrent()) setError("The pages could not be inspected. Try again.");
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  };

  const exportReport = async () => {
    if (!report || !pdf || exporting) return;
    if (controller?.pdf !== pdf || useWorkspace.getState().document?.id !== documentId) {
      setReport(null);
      return;
    }
    const active = new AbortController();
    job.current?.abort();
    job.current = active;
    setExporting(true);
    setError("");
    setMessage("");
    try {
      const saved = await downloadBlob(
        new Blob([insightsCsv(report)], { type: "text/csv;charset=utf-8" }),
        `${fileName.replace(/\.pdf$/i, "")}-page-report.csv`,
      );
      if (
        !active.signal.aborted &&
        controller?.pdf === pdf &&
        useWorkspace.getState().document?.id === documentId
      )
        setMessage(saved ? "CSV report exported." : "Export cancelled.");
    } catch {
      if (!active.signal.aborted) setError("The report could not be exported. Try again.");
    } finally {
      if (!active.signal.aborted) setExporting(false);
    }
  };

  return (
    <FeatureDialog title="Document insights" onClose={close} busy={exporting}>
      <form
        className="modal-dialog wide document-insights-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <FileChartColumn size={18} />
            <h3>Document Insights</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close document insights"
            disabled={exporting}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {!pdf && <p className="field-hint">Open a PDF to inspect its pages.</p>}
          <div className="setting-group">
            <label className="setting-title" htmlFor={`${ids}-range`}>
              Page range
            </label>
            <input
              id={`${ids}-range`}
              className="text-input"
              value={range}
              disabled={busy || exporting || !pdf}
              aria-describedby={`${ids}-range-hint`}
              aria-invalid={!!rangeError}
              onChange={(event) => {
                setRange(event.target.value);
                setReport(null);
                setError("");
                setMessage("");
              }}
            />
            <p className="field-hint" id={`${ids}-range-hint`}>
              Enter pages such as 1-3, 5. Ranges are limited to the open document.
            </p>
          </div>
          {busy && (
            <div className="document-insights-progress">
              <progress
                aria-label="Page inspection progress"
                value={completed}
                max={selection.length}
              />
              <output aria-live="polite">
                Inspected {completed} of {selection.length} pages.
              </output>
            </div>
          )}
          {(rangeError || error) && (
            <p className="error-text" role="alert">
              {rangeError || error}
            </p>
          )}
          {message && (
            <output className="field-hint" aria-live="polite">
              {message}
            </output>
          )}
          {report && (
            <>
              <section className="document-insights-summary" aria-label="Text statistics">
                <h4>Text statistics</h4>
                <p>
                  {report.pages.length} pages inspected. <strong>{report.words} words</strong> ·{" "}
                  <strong>{report.characters} characters</strong>
                </p>
                <p>Textless pages: {report.textlessPages.join(", ") || "None"}</p>
                {report.failedPages.length > 0 && (
                  <output>
                    Unreadable pages: {report.failedPages.join(", ")}. Counts exclude these pages.
                  </output>
                )}
              </section>
              <section aria-label="Page dimensions and rotation">
                <h4>Page inventory</h4>
                <p className="field-hint">
                  Displayed crop dimensions in points (72 pt = 1 inch), including page rotation and
                  document units.
                </p>
                <div className="document-insights-table-wrap">
                  <table className="document-insights-table" aria-label="Page inventory">
                    <thead>
                      <tr>
                        {[
                          "Page",
                          "Words",
                          "Characters",
                          "Text layer",
                          "Width (pt)",
                          "Height (pt)",
                          "Rotation",
                          "Orientation",
                        ].map((heading) => (
                          <th scope="col" key={heading}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.pages
                        .slice(tablePage * ROWS_PER_PAGE, (tablePage + 1) * ROWS_PER_PAGE)
                        .map((page) => (
                          <tr key={page.page}>
                            <th scope="row">{page.page}</th>
                            <td>{page.words ?? "Unavailable"}</td>
                            <td>{page.characters ?? "Unavailable"}</td>
                            <td>{TEXT_STATUS_LABELS[page.textStatus]}</td>
                            <td>{dimension(page.width)}</td>
                            <td>{dimension(page.height)}</td>
                            <td>{page.rotation === null ? "Unavailable" : `${page.rotation}°`}</td>
                            <td>{page.orientation ?? "Unavailable"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {report.pages.length > ROWS_PER_PAGE && (
                  <div className="document-insights-pagination">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={tablePage === 0}
                      onClick={() => setTablePage((page) => page - 1)}
                    >
                      Previous rows
                    </button>
                    <span>
                      Rows {tablePage * ROWS_PER_PAGE + 1}-
                      {Math.min((tablePage + 1) * ROWS_PER_PAGE, report.pages.length)} of{" "}
                      {report.pages.length}
                    </span>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={(tablePage + 1) * ROWS_PER_PAGE >= report.pages.length}
                      onClick={() => setTablePage((page) => page + 1)}
                    >
                      Next rows
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          <p className="field-hint">
            Word counts are approximate whitespace-separated tokens within PDF text items.
            Characters count Unicode code points excluding whitespace. Only the existing text layer
            is inspected; this does not run OCR. A textless result does not prove a page is blank.
            Extracted text is not retained or included in reports.
          </p>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button-secondary"
            disabled={!report || busy || exporting}
            onClick={() => void exportReport()}
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
          {busy ? (
            <button type="button" className="button-secondary" onClick={cancel}>
              Cancel inspection
            </button>
          ) : (
            <button type="button" className="button-secondary" onClick={close} disabled={exporting}>
              Close
            </button>
          )}
          <button
            type="submit"
            className="button-primary"
            disabled={!pdf || busy || exporting || !!rangeError}
          >
            {busy ? "Inspecting..." : "Inspect pages"}
          </button>
        </div>
      </form>
    </FeatureDialog>
  );
}

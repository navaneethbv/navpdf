import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import { FeatureDialog } from "../../components/FeatureDialog";
import { loadPdfFromBytes } from "../../services/pdf";
import type { ViewerController } from "../viewer/controller";
import { PdfPagePreview } from "../viewer/PdfPagePreview";
import {
  alignPages,
  changedText,
  pageSignatures,
  renderComparisonPage,
  visualDifference,
  type ComparedPage,
  type PageSignature,
} from "./compare-pdf";

export function CompareDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [documents, setDocuments] = useState<[PDFDocumentProxy, PDFDocumentProxy] | null>(null);
  const [signatures, setSignatures] = useState<[PageSignature[], PageSignature[]]>([[], []]);
  const [rows, setRows] = useState<ComparedPage[]>([]),
    [selected, setSelected] = useState(0),
    [onlyChanges, setOnlyChanges] = useState(false);
  const [difference, setDifference] = useState("");
  const tasks = useRef<PDFDocumentLoadingTask[]>([]),
    generation = useRef(0);
  const destroy = () => {
    generation.current++;
    for (const task of tasks.current) void task.destroy();
    tasks.current = [];
  };
  useEffect(
    () => () => {
      generation.current++;
      for (const task of tasks.current) void task.destroy();
    },
    [],
  );
  const compare = async (file: File) => {
    const pdf = controller?.pdf;
    if (!pdf) return;
    destroy();
    const id = generation.current;
    setBusy(true);
    setError("");
    setDocuments(null);
    setRows([]);
    setDifference("");
    try {
      if (pdf.numPages > 500) throw new Error("Compare supports up to 500 pages per document.");
      if (file.size > 100 * 1024 * 1024) throw new Error("Comparison files must be under 100 MB.");
      const originalBytes = new Uint8Array(await pdf.saveDocument());
      if (originalBytes.length > 100 * 1024 * 1024)
        throw new Error("Comparison files must be under 100 MB.");
      const revisedBytes = new Uint8Array(await file.arrayBuffer());
      if (id !== generation.current) return;
      const before = loadPdfFromBytes(originalBytes);
      const after = loadPdfFromBytes(revisedBytes);
      tasks.current = [before, after];
      for (const task of tasks.current)
        task.onPassword = () => {
          setError("Unlock password-protected documents before comparing.");
          void task.destroy();
        };
      const pair = await Promise.all([before.promise, after.promise]);
      const left = await pageSignatures(
        pair[0],
        () => id !== generation.current,
        (n) => setStatus(`Reading original page ${n} of ${pair[0].numPages}`),
      );
      const right = await pageSignatures(
        pair[1],
        () => id !== generation.current,
        (n) => setStatus(`Reading revision page ${n} of ${pair[1].numPages}`),
      );
      if (id !== generation.current) return;
      setSignatures([left, right]);
      setRows(alignPages(left, right));
      setDocuments(pair);
      setSelected(0);
      setStatus(`Compared with ${file.name}`);
    } catch (cause) {
      if (id === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  const visible = onlyChanges ? rows.filter((row) => row.status !== "unchanged") : rows;
  const row = visible[Math.min(selected, visible.length - 1)];
  useEffect(() => {
    let alive = true;
    setDifference("");
    if (!documents || !row?.before || !row.after || row.status === "unchanged") return;
    void (async () => {
      const canvases: HTMLCanvasElement[] = [];
      try {
        canvases.push(await renderComparisonPage(documents[0], row.before!));
        canvases.push(await renderComparisonPage(documents[1], row.after!));
        if (alive) setDifference(visualDifference(canvases[0], canvases[1]));
      } catch (cause) {
        if (alive) setError(String(cause));
      } finally {
        for (const canvas of canvases) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [documents, row]);
  const text = row
    ? changedText(
        row.before ? signatures[0][row.before - 1].text : "",
        row.after ? signatures[1][row.after - 1].text : "",
      )
    : null;
  return (
    <FeatureDialog title="Compare PDF versions" onClose={onClose} busy={busy}>
      <div className="modal-dialog wide-tool-dialog">
        <div className="modal-header">
          <h3>Compare PDF versions</h3>
        </div>
        <div className="modal-body">
          <p>
            Compare the open document with a revised PDF locally. Matching pages align
            automatically. Highlights show rendered changes, including images and layout. Visual
            detection uses reduced-resolution previews and does not certify that documents are
            identical.
          </p>
          <label>
            Choose revised PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void compare(file);
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <p role="status">{status}</p>
          {!!rows.length && (
            <>
              <p>
                {rows.filter((r) => r.status === "changed").length} changed,{" "}
                {rows.filter((r) => r.status === "added").length} added,{" "}
                {rows.filter((r) => r.status === "removed").length} removed,{" "}
                {rows.filter((r) => r.status === "unchanged").length} unchanged pages.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={onlyChanges}
                  onChange={(event) => {
                    setOnlyChanges(event.target.checked);
                    setSelected(0);
                  }}
                />
                Only changes
              </label>
              <label>
                Page pair
                <select
                  value={selected}
                  onChange={(event) => setSelected(Number(event.target.value))}
                >
                  {visible.map((r, i) => (
                    <option key={`${r.before}:${r.after}`} value={i}>
                      {r.before ?? "None"} → {r.after ?? "None"}: {r.status}
                    </option>
                  ))}
                </select>
              </label>
              {row && documents && (
                <>
                  <div className="pdf-comparison">
                    {row.before ? (
                      <PdfPagePreview
                        pdf={documents[0]}
                        page={row.before}
                        label={`Original page ${row.before}`}
                      />
                    ) : (
                      <p>Added page</p>
                    )}
                    {row.after ? (
                      <PdfPagePreview
                        pdf={documents[1]}
                        page={row.after}
                        label={`Revised page ${row.after}`}
                      />
                    ) : (
                      <p>Removed page</p>
                    )}
                  </div>
                  {difference && (
                    <figure className="pdf-page-preview">
                      <figcaption>Changed regions highlighted in red</figcaption>
                      <img src={difference} alt="Revised page with changed regions highlighted" />
                    </figure>
                  )}
                  {text && (text.before || text.after) && (
                    <details open>
                      <summary>Changed text span</summary>
                      <p className="comparison-text">
                        {text.prefix}
                        <del>{text.before}</del>
                        {text.suffix}
                      </p>
                      <p className="comparison-text">
                        {text.prefix}
                        <ins>{text.after}</ins>
                        {text.suffix}
                      </p>
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {busy ? (
            <button
              onClick={() => {
                destroy();
                setBusy(false);
                setStatus("Comparison cancelled.");
              }}
            >
              Cancel comparison
            </button>
          ) : (
            <button className="button-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </FeatureDialog>
  );
}

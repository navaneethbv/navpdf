import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  EyeOff,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { discardRecovery, native } from "../../services/native";
import {
  cancelEngineJob,
  ENGINE_UNAVAILABLE,
  newJobId,
  redactDocument,
} from "../../services/engine";
import type {
  PdfRect,
  RedactionReport,
  SanitizeOptions,
} from "../../types/engine";
import {
  findTermMarks,
  placePageBoxes,
  viewportToPdfRect,
  type ViewerLike,
} from "./redaction-marks";

interface Mark {
  id: string;
  page: number;
  rect: PdfRect;
  source: "drawn" | "search" | "coordinates";
}

export const DEFAULT_SANITIZE_OPTIONS: SanitizeOptions = {
  removeMetadata: true,
  removeAttachments: true,
  removeScripts: true,
  removeHiddenContent: true,
  removeComments: false,
  removeBookmarks: false,
};

const OPTION_LABELS: [keyof SanitizeOptions, string][] = [
  ["removeMetadata", "Document information and XMP metadata"],
  ["removeAttachments", "Embedded files and attachment annotations"],
  ["removeScripts", "JavaScript, launch and form submission actions"],
  ["removeHiddenContent", "Hidden layers and invisible text (removes OCR search layers)"],
  ["removeComments", "All comments and markup annotations"],
  ["removeBookmarks", "Bookmarks"],
];

const MIN_DRAWN_SIZE = 2;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function RedactionTool({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const ids = useId();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState(DEFAULT_SANITIZE_OPTIONS);
  const [drawing, setDrawing] = useState(false);
  const [region, setRegion] = useState({ page: s.page, x: 72, y: 700, width: 200, height: 24 });
  const [stage, setStage] = useState<"mark" | "confirm" | "running" | "done">("mark");
  const [acknowledged, setAcknowledged] = useState(false);
  const [report, setReport] = useState<RedactionReport | null>(null);
  const [notice, setNotice] = useState("");
  const job = useRef<string | null>(null);
  const viewer = controller?.viewer as unknown as ViewerLike | undefined;
  const pageCount = s.info?.pages ?? 1;

  useEffect(
    () =>
      placePageBoxes(
        viewer,
        marks.map((mark) => ({ page: mark.page, rect: mark.rect, className: "redaction-mark" })),
      ),
    [viewer, marks, s.zoom, s.renderedPages],
  );

  useEffect(() => {
    if (!drawing) return;
    let start: { page: HTMLElement; x: number; y: number } | null = null;
    let preview: HTMLDivElement | null = null;
    const local = (page: HTMLElement, event: MouseEvent) => {
      const bounds = page.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const down = (event: MouseEvent) => {
      const page = (event.target as Element | null)?.closest?.<HTMLElement>(".page");
      if (!page || event.button !== 0) return;
      event.preventDefault();
      start = { page, ...local(page, event) };
      preview = document.createElement("div");
      preview.className = "redaction-mark drawing";
      page.appendChild(preview);
    };
    const move = (event: MouseEvent) => {
      if (!start || !preview) return;
      const point = local(start.page, event);
      Object.assign(preview.style, {
        left: `${Math.min(start.x, point.x)}px`,
        top: `${Math.min(start.y, point.y)}px`,
        width: `${Math.abs(point.x - start.x)}px`,
        height: `${Math.abs(point.y - start.y)}px`,
      });
    };
    const up = (event: MouseEvent) => {
      if (!start) return;
      const end = local(start.page, event);
      const page = Number(start.page.dataset.pageNumber);
      preview?.remove();
      preview = null;
      const rect = viewportToPdfRect(viewer, page, start, end);
      start = null;
      if (rect && rect[2] - rect[0] >= MIN_DRAWN_SIZE && rect[3] - rect[1] >= MIN_DRAWN_SIZE) {
        setMarks((current) => [...current, { id: crypto.randomUUID(), page, rect, source: "drawn" }]);
      }
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      preview?.remove();
    };
  }, [drawing, viewer]);

  const markTerm = async () => {
    const value = term.trim();
    if (!value || !controller?.pdf) return;
    try {
      const found = await findTermMarks(controller.pdf, value);
      setMarks((current) => [
        ...current,
        ...found.map((match) => ({ id: crypto.randomUUID(), ...match, source: "search" as const })),
      ]);
      setTerms((current) =>
        current.some((existing) => existing.toLowerCase() === value.toLowerCase())
          ? current
          : [...current, value],
      );
      const pages = new Set(found.map((match) => match.page)).size;
      setNotice(
        found.length
          ? `Marked ${found.length} match${found.length === 1 ? "" : "es"} on ${pages} page${pages === 1 ? "" : "s"}. The term is also audited after redaction.`
          : "No text matches were found. The term will still be audited in the redacted output.",
      );
      setTerm("");
    } catch (error) {
      s.set({ error: errorText(error) });
    }
  };

  const addRegion = () => {
    const page = Math.max(1, Math.min(Math.round(region.page), pageCount));
    const { x, y, width, height } = region;
    if (!(width > 0 && height > 0)) {
      setNotice("Enter a region with a positive width and height.");
      return;
    }
    setMarks((current) => [
      ...current,
      { id: crypto.randomUUID(), page, rect: [x, y, x + width, y + height], source: "coordinates" },
    ]);
  };

  const apply = async () => {
    const pdf = controller?.pdf;
    const doc = s.document;
    if (!controller || !pdf || !doc) return;
    const jobId = newJobId();
    job.current = jobId;
    setStage("running");
    setDrawing(false);
    try {
      controller.editor?.commitOrRemove();
      const bytes = await pdf.saveDocument();
      const result = await redactDocument(
        doc.id,
        bytes,
        {
          regions: marks.map(({ page, rect }) => ({ page, rect })),
          terms,
          options,
          acknowledgeSignatures: acknowledged,
        },
        jobId,
      );
      if (job.current !== jobId) return;
      if (!result.bytes) throw new Error("The redaction engine returned no document.");
      await controller.replaceWithBytes(result.bytes, "Redactions applied", { resetHistory: true });
      await discardRecovery(doc.id).catch(() => {});
      setReport(result.report);
      setMarks([]);
      setTerms([]);
      setStage("done");
      s.set({
        hasDigitalSignature: false,
        status:
          "Redactions applied. Use Save As to write the redacted copy; the original file is unchanged until you save.",
      });
    } catch (error) {
      if (job.current === jobId) {
        setStage("confirm");
        s.set({ error: errorText(error) });
      }
    } finally {
      if (job.current === jobId) job.current = null;
    }
  };

  const cancel = () => {
    if (job.current) void cancelEngineJob(job.current);
    job.current = null;
    setStage("confirm");
    s.set({ status: "Redaction cancelled. The document is unchanged." });
  };

  const numberField = (key: keyof typeof region, label: string) => (
    <div className="setting-group">
      <label className="setting-title" htmlFor={`${ids}-${key}`}>
        {label}
      </label>
      <input
        id={`${ids}-${key}`}
        type="number"
        className="text-input"
        value={region[key]}
        onChange={(event) => setRegion((current) => ({ ...current, [key]: Number(event.target.value) }))}
      />
    </div>
  );

  return (
    <aside className="redaction-panel" role="dialog" aria-modal="false" aria-label="Redact Sensitive Content">
      <div className="modal-header">
        <div className="modal-title">
          <EyeOff size={18} />
          <h3>Redact Sensitive Content</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="modal-body">
        {!native && (
          <div className="warning-banner">
            <AlertTriangle size={18} />
            <span>{ENGINE_UNAVAILABLE}</span>
          </div>
        )}

        {stage === "mark" && (
          <>
            <p className="field-hint">
              Marks are reversible. Applying them rewrites a fresh copy that
              removes the marked text, image pixels and hidden data, then audits
              the result before it replaces your working document.
            </p>
            <form
              className="setting-group"
              onSubmit={(event) => {
                event.preventDefault();
                void markTerm();
              }}
            >
              <label className="setting-title" htmlFor={`${ids}-term`}>
                Find and mark text
              </label>
              <div className="inline-field">
                <input
                  id={`${ids}-term`}
                  className="text-input"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Name, account number or phrase"
                />
                <button type="submit" className="button-secondary" disabled={!term.trim()}>
                  <Search size={15} /> Mark Matches
                </button>
              </div>
            </form>
            <button
              type="button"
              className={drawing ? "button-primary" : "button-secondary"}
              aria-pressed={drawing}
              onClick={() => setDrawing((value) => !value)}
            >
              <Square size={15} /> {drawing ? "Drawing Regions (click to stop)" : "Draw Regions on Pages"}
            </button>
            <details>
              <summary>Add a region by coordinates (PDF points)</summary>
              <div className="settings-row">
                {numberField("page", "Page")}
                {numberField("x", "X")}
                {numberField("y", "Y")}
              </div>
              <div className="settings-row">
                {numberField("width", "Width")}
                {numberField("height", "Height")}
              </div>
              <button type="button" className="button-secondary" onClick={addRegion}>
                Add Region
              </button>
            </details>
            {notice && (
              <p className="field-hint" role="status">
                {notice}
              </p>
            )}

            <div className="setting-group">
              <span className="setting-title">Marked regions ({marks.length})</span>
              {marks.map((mark) => (
                <div key={mark.id} className="attachment-row">
                  <span>
                    Page {mark.page}: {Math.round(mark.rect[2] - mark.rect[0])}×
                    {Math.round(mark.rect[3] - mark.rect[1])} pt ({mark.source})
                  </span>
                  <button
                    className="icon-button"
                    title="Remove mark"
                    aria-label={`Remove mark on page ${mark.page}`}
                    onClick={() => setMarks((current) => current.filter((item) => item.id !== mark.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            {terms.length > 0 && (
              <div className="setting-group">
                <span className="setting-title">Audit terms ({terms.length})</span>
                {terms.map((value) => (
                  <div key={value} className="attachment-row">
                    <span>{value}</span>
                    <button
                      className="icon-button"
                      title="Stop auditing term"
                      aria-label={`Stop auditing ${value}`}
                      onClick={() => setTerms((current) => current.filter((item) => item !== value))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <fieldset className="setting-group">
              <legend className="setting-title">Also remove from the whole document</legend>
              {OPTION_LABELS.map(([key, label]) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {stage === "confirm" && (
          <>
            <div className="warning-banner">
              <AlertTriangle size={18} />
              <span>
                Apply {marks.length} region{marks.length === 1 ? "" : "s"} and audit{" "}
                {terms.length} term{terms.length === 1 ? "" : "s"} permanently? Marked
                content and the selected hidden data are removed, undo history is
                cleared and recovery copies are discarded. The original file on disk
                is unchanged until you use Save As.
              </span>
            </div>
            {s.hasDigitalSignature && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I understand this removes the document's digital signatures, which
                redaction invalidates.
              </label>
            )}
          </>
        )}

        {stage === "running" && (
          <p className="field-hint" aria-live="polite">
            Applying redactions and auditing the sanitized copy…
          </p>
        )}

        {stage === "done" && report && (
          <div className="compress-results-card" aria-live="polite">
            <p>
              <Check size={14} /> Audit passed: {report.audit.regionsChecked} region
              {report.audit.regionsChecked === 1 ? "" : "s"} and {report.audit.termsChecked} term
              {report.audit.termsChecked === 1 ? "" : "s"} checked across {report.audit.streamsScanned}{" "}
              streams.
            </p>
            <p className="field-hint">
              Removed {report.removedGlyphs} glyphs, {report.removedAnnotations} annotations
              {report.hiddenAnnotationsRemoved > 0
                ? ` (${report.hiddenAnnotationsRemoved} hidden by layers)`
                : ""},{" "}
              {report.removedFormFields} form fields and {report.removedPaths} vector shapes.
              Redacted pixels in {report.pixelRedactedImages} images and removed{" "}
              {report.removedImages} images that could not be redacted pixel by pixel.
            </p>
            <ul className="check-list" aria-label="Sanitized data">
              {report.sanitized.map((entry) => (
                <li key={entry} className="passed">
                  <Check size={14} />
                  <span>{entry}</span>
                </li>
              ))}
            </ul>
            {report.warnings.map((warning) => (
              <p key={warning} className="field-hint">
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="modal-footer">
        {stage === "mark" && (
          <>
            <button onClick={onClose} className="button-secondary">
              Close
            </button>
            <button
              className="button-primary"
              disabled={!native || (marks.length === 0 && terms.length === 0)}
              onClick={() => setStage("confirm")}
            >
              Review and Apply…
            </button>
          </>
        )}
        {stage === "confirm" && (
          <>
            <button onClick={() => setStage("mark")} className="button-secondary">
              Back
            </button>
            <button
              className="button-primary"
              disabled={s.hasDigitalSignature && !acknowledged}
              onClick={() => void apply()}
            >
              <EyeOff size={16} /> Apply Redactions
            </button>
          </>
        )}
        {stage === "running" && (
          <button onClick={cancel} className="button-secondary">
            Cancel
          </button>
        )}
        {stage === "done" && (
          <button onClick={onClose} className="button-primary">
            Done
          </button>
        )}
      </div>
    </aside>
  );
}

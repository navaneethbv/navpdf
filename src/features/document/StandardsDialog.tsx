import { useEffect, useId, useState } from "react";
import { CheckCircle2, FileCheck2, Wrench, XCircle } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { errorMessage, useDocumentEdit } from "./use-document-edit";
import { editStandards, readStandards, validatePdfa } from "../../services/engine";
import type { DocumentStandards, PdfaLevel, PdfaReport, StandardsEdit } from "../../types/engine";

const LEVELS: [PdfaLevel, string][] = [
  ["2b", "PDF/A-2b (visual appearance)"],
  ["2u", "PDF/A-2u (appearance and Unicode text)"],
  ["2a", "PDF/A-2a (accessible: tagged)"],
  ["3b", "PDF/A-3b (allows any attachment)"],
  ["3u", "PDF/A-3u"],
  ["3a", "PDF/A-3a"],
];

function intentLabel(components: number | null) {
  if (components === 3) return "RGB";
  if (components === 4) return "CMYK";
  if (components === 1) return "Gray";
  return "no profile";
}

export function StandardsDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const [standards, setStandards] = useState<DocumentStandards | null>(null);
  const [loadError, setLoadError] = useState("");
  const [level, setLevel] = useState<PdfaLevel>("2b");
  const [report, setReport] = useState<PdfaReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [revision, setRevision] = useState(0);
  const { apply, busy, error, setError } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const pdf = controller?.pdf;
    if (!pdf) return undefined;
    pdf
      .saveDocument()
      .then(readStandards)
      .then((result) => current && setStandards(result))
      .catch((cause) => current && setLoadError(errorMessage(cause)));
    return () => {
      current = false;
    };
  }, [controller, revision]);

  const check = async () => {
    const pdf = controller?.pdf;
    if (!pdf) return;
    setChecking(true);
    setError("");
    try {
      setReport(await validatePdfa(await pdf.saveDocument(), level));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setChecking(false);
    }
  };

  const run = async (edit: StandardsEdit, status: string) => {
    const changed = await apply(status, async (bytes) => {
      const result = await editStandards(bytes, edit);
      if (!result.bytes) throw new Error("The document was not changed.");
      return { bytes: result.bytes, status: result.report.message };
    });
    if (changed) {
      setReport(null);
      setRevision((value) => value + 1);
    }
  };

  const blocked = report?.findings.some((finding) => !finding.fixable) ?? false;
  const working = busy || checking;

  return (
    <ToolDialog
      title="PDF/A and Standards"
      icon={<FileCheck2 size={18} />}
      onClose={onClose}
      busy={working}
      error={error || loadError}
      primaryLabel={report && !report.passed ? `Convert to ${report.level}` : "Check"}
      busyLabel={checking ? "Checking…" : "Converting…"}
      primaryDisabled={!controller?.pdf || (!!report && (report.passed || blocked))}
      onPrimary={() => {
        if (report && !report.passed && !blocked)
          void run({ action: "convert", level }, "Converted");
        else void check();
      }}
      secondary={
        report && (
          <button
            type="button"
            className="button-secondary"
            disabled={working}
            onClick={() => void check()}
          >
            Check Again
          </button>
        )
      }
    >
      <section className="setting-group" aria-labelledby={`${ids}-declared`}>
        <h4 id={`${ids}-declared`} className="setting-title">
          Standards this document declares
        </h4>
        {!standards && !loadError && <p className="field-hint">Reading…</p>}
        {standards && (
          <ul className="standards-list">
            <li>PDF/A: {standards.pdfa ?? "not declared"}</li>
            <li>PDF/UA: {standards.pdfua ?? "not declared"}</li>
            <li>PDF/X: {standards.pdfx ?? "not declared"}</li>
            <li>
              Output intents:{" "}
              {standards.outputIntents.length
                ? standards.outputIntents
                    .map(
                      (intent) =>
                        `${intent.condition || intent.info || "unnamed"} (${intent.subtype}, ${intentLabel(intent.components)})`,
                    )
                    .join("; ")
                : "none"}
            </li>
          </ul>
        )}
        <p className="field-hint">
          A declaration is the document&apos;s own claim. NavPDF checks it only when you run a check
          below.
        </p>
        <div className="tag-actions">
          <button
            type="button"
            className="button-secondary"
            disabled={
              working ||
              !standards ||
              standards.outputIntents.some((intent) => intent.subtype === "GTS_PDFA1")
            }
            onClick={() => void run({ action: "addOutputIntent" }, "Output intent added")}
          >
            Add sRGB Output Intent
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={
              working || !standards || !(standards.pdfa || standards.pdfua || standards.pdfx)
            }
            onClick={() =>
              void run({ action: "removeIdentification" }, "Standards identification removed")
            }
          >
            Remove Standards Identification
          </button>
        </div>
      </section>

      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-level`}>
          Check against
        </label>
        <select
          id={`${ids}-level`}
          className="text-input"
          value={level}
          disabled={working}
          onChange={(event) => {
            setLevel(event.target.value as PdfaLevel);
            setReport(null);
          }}
        >
          {LEVELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {report && (
        <section className="setting-group" aria-label="PDF/A check results">
          <p className={report.passed ? "pdfa-passed" : "pdfa-failed"}>
            {report.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{" "}
            {report.passed
              ? `No problems found for ${report.level} in the rules NavPDF checks.`
              : `${report.findings.length} problem(s) found for ${report.level}.`}
          </p>
          <ul className="signature-list">
            {report.findings.map((finding) => (
              <li key={finding.rule} className="signature-row">
                <span>
                  {finding.fixable && <Wrench size={14} aria-label="Fixed by conversion" />}{" "}
                  {finding.message}
                </span>
                {finding.examples.length > 0 && (
                  <span className="field-hint">
                    {finding.count} found, such as {finding.examples.join(", ")}.
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!report.passed && (
            <p className="field-hint">
              {blocked
                ? "Problems without the wrench cannot be fixed by NavPDF, so conversion is not offered."
                : "Conversion fixes every problem listed, without changing what pages look like, and checks again before keeping the result."}
            </p>
          )}
          <details>
            <summary>Not checked</summary>
            <ul>
              {report.notChecked.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
          <p className="field-hint">
            These checks are not a certified validator such as veraPDF; confirm conformance with one
            before relying on it.
          </p>
        </section>
      )}
    </ToolDialog>
  );
}

import { useEffect, useState } from "react";
import { ScanEye } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { useWorkspace } from "../../stores/workspace";
import { ENGINE_UNAVAILABLE, findCoverUps } from "../../services/engine";
import { native } from "../../services/native";
import type { CoverUp, CoverUpReport } from "../../types/engine";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage } from "../document/use-document-edit";

const KIND_LABELS: Record<CoverUp["kind"], string> = {
  coveredText: "Text under a shape",
  unappliedRedaction: "Redaction mark not applied",
  coveringAnnotation: "Filled comment over text",
};

/**
 * Finds redactions that only look applied. Every finding can be sent to Redact PDF as a mark,
 * which removes the content for real.
 */
function sampleText(finding: CoverUp) {
  if (!finding.characters) return "None found";
  const more = finding.characters > finding.sample.length ? "…" : "";
  return finding.sample + more;
}

export function CoverUpDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const [report, setReport] = useState<CoverUpReport | null>(null);
  const [error, setError] = useState(native ? "" : ENGINE_UNAVAILABLE);

  useEffect(() => {
    let current = true;
    const source = controller?.pdf;
    if (native && source)
      void source
        .saveDocument()
        .then(findCoverUps)
        .then((found) => {
          if (current && source === controller?.pdf) setReport(found);
        })
        .catch((cause: unknown) => {
          if (current) setError(errorMessage(cause));
        });
    return () => {
      current = false;
    };
  }, [controller]);

  const markAll = () => {
    if (!report) return;
    useWorkspace.getState().set({
      redactionSelection: report.findings.map((finding) => ({
        page: finding.page,
        text: "",
        quads: [
          { x1: finding.rect[0], y1: finding.rect[1], x2: finding.rect[2], y2: finding.rect[3] },
        ],
      })),
      activeModal: "redact",
    });
  };

  return (
    <ToolDialog
      title="Find Fake Redactions"
      icon={<ScanEye size={18} />}
      onClose={onClose}
      error={error}
      primaryLabel="Mark All for Redaction"
      primaryDisabled={!report?.findings.length}
      onPrimary={markAll}
    >
      {!report && !error && <output className="field-hint">Checking every page…</output>}
      {report && !report.findings.length && (
        <p>
          No covered text or unapplied redaction marks were found on {report.pagesChecked} page
          {report.pagesChecked === 1 ? "" : "s"}.
        </p>
      )}
      {report && report.findings.length > 0 && (
        <>
          <p>
            {report.findings.length} possible fake redaction
            {report.findings.length === 1 ? "" : "s"}
            {report.truncated ? " (showing the first 1,000)" : ""}. The text listed can still be
            selected, copied or extracted.
          </p>
          <table className="workflow-table" aria-label="Possible fake redactions">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Finding</th>
                <th scope="col">Text underneath</th>
              </tr>
            </thead>
            <tbody>
              {report.findings.map((finding) => (
                <tr key={`${finding.page}-${finding.kind}-${finding.rect.join(",")}`}>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => controller?.goTo(finding.page)}
                    >
                      {finding.page}
                    </button>
                  </td>
                  <td>{KIND_LABELS[finding.kind]}</td>
                  <td>{sampleText(finding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="field-hint">
        Shapes drawn over text and filled comments hide text only visually. Marking them for
        redaction removes the content underneath and audits the result. Transparent shapes may also
        be listed; review each finding.
      </p>
    </ToolDialog>
  );
}

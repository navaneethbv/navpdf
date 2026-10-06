import { useState } from "react";
import { Layers } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { flattenDocument, type FlattenReport } from "../../services/pdf/flatten";
import { useDocumentEdit } from "./use-document-edit";

function summary(report: FlattenReport) {
  const parts = [
    report.annotations ? `${report.annotations} comment(s) and markup` : "",
    report.widgets ? `${report.widgets} form field widget(s)` : "",
  ].filter(Boolean);
  const skipped = report.skipped ? ` ${report.skipped} item(s) were left unchanged.` : "";
  return `Flattened ${parts.join(" and ")}.${skipped}`;
}

export function FlattenDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const [annotations, setAnnotations] = useState(true);
  const [forms, setForms] = useState(true);
  const { apply, busy, error } = useDocumentEdit(controller);

  const submit = async () => {
    const applied = await apply("Document flattened", async (bytes) => {
      const result = await flattenDocument(bytes, { annotations, forms });
      return { bytes: result.bytes, status: summary(result.report) };
    });
    if (applied) onClose();
  };

  return (
    <ToolDialog
      title="Flatten Document"
      icon={<Layers size={18} />}
      onClose={onClose}
      busy={busy}
      error={error}
      primaryLabel="Flatten"
      busyLabel="Flattening…"
      primaryDisabled={!annotations && !forms}
      onPrimary={() => void submit()}
    >
      <fieldset className="preset-list">
        <legend className="setting-title">Flatten</legend>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={annotations}
            onChange={(event) => setAnnotations(event.target.checked)}
          />
          <span>Comments, markup and stamps</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={forms}
            onChange={(event) => setForms(event.target.checked)}
          />
          <span>Form fields and their current values</span>
        </label>
      </fieldset>
      <p className="field-hint">
        Flattened items become part of the page: they print and display the same in every reader but
        can no longer be edited, moved or filled. Links are kept. Undo is available until you close
        the document.
      </p>
      <p className="field-hint">
        Flattening does not remove content. Use Redact PDF to permanently remove sensitive text.
      </p>
    </ToolDialog>
  );
}

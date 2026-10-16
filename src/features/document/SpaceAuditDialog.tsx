import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { auditSpace, type SpaceAudit } from "../../services/pdf/space-audit";
import { downloadBlob } from "../../utils/download";
import { csvField } from "../convert/formats";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage } from "./use-document-edit";

const size = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
};

const share = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : "0%";

export function spaceAuditCsv(audit: SpaceAudit) {
  const rows = [["Category", "Objects", "Bytes", "Share"]];
  for (const row of audit.rows)
    rows.push([
      row.category,
      String(row.objects),
      String(row.bytes),
      share(row.bytes, audit.measuredBytes),
    ]);
  return `\uFEFF${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

export function SpaceAuditDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const [audit, setAudit] = useState<SpaceAudit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    const source = controller?.pdf;
    if (source)
      void source
        .saveDocument()
        .then(auditSpace)
        .then((result) => {
          if (current && source === controller?.pdf) setAudit(result);
        })
        .catch((cause: unknown) => {
          if (current) setError(errorMessage(cause));
        });
    return () => {
      current = false;
    };
  }, [controller]);

  const exportCsv = async () => {
    if (!audit) return;
    setBusy(true);
    try {
      const blob = new Blob([spaceAuditCsv(audit)], { type: "text/csv;charset=utf-8" });
      if (await downloadBlob(blob, "space-usage.csv")) onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolDialog
      title="Space Usage"
      icon={<HardDrive size={18} />}
      onClose={onClose}
      busy={busy}
      error={error}
      primaryLabel="Export CSV"
      busyLabel="Exporting…"
      primaryDisabled={!audit}
      onPrimary={() => void exportCsv()}
    >
      {!audit && !error && <output>Measuring the document…</output>}
      {audit && (
        <>
          <p>
            Current document: {size(audit.fileBytes)}. Measured content: {size(audit.measuredBytes)}
            .
          </p>
          <table className="workflow-table" aria-label="Space used by content type">
            <thead>
              <tr>
                <th scope="col">Content</th>
                <th scope="col">Objects</th>
                <th scope="col">Size</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {audit.rows.map((row) => (
                <tr key={row.category}>
                  <th scope="row">{row.category}</th>
                  <td>{row.objects.toLocaleString()}</td>
                  <td>{size(row.bytes)}</td>
                  <td>{share(row.bytes, audit.measuredBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="field-hint">
        Each object is measured as it would be written, with object streams unpacked, so the total
        can differ from the file size. Shares show which kinds of content take the most space.
      </p>
    </ToolDialog>
  );
}

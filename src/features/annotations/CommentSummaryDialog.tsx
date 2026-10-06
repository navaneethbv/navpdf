import { useId, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import { downloadBlob, safeFileName } from "../../utils/download";
import { errorMessage } from "../document/use-document-edit";
import {
  commentSummaryCsv,
  commentSummaryHtml,
  readCommentSummary,
  type CommentSort,
} from "./comment-summary";

type SummaryFormat = "html" | "csv";

export function CommentSummaryDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const documentName = useWorkspace((state) => state.document?.name ?? "document.pdf");
  const set = useWorkspace((state) => state.set);
  const [format, setFormat] = useState<SummaryFormat>("html");
  const [sort, setSort] = useState<CommentSort>("page");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!controller?.pdf) return;
    setBusy(true);
    setError("");
    try {
      const entries = await readCommentSummary(await controller.pdf.saveDocument(), sort);
      if (!entries.length) throw new Error("This PDF has no comments to summarize.");
      const base = safeFileName(documentName.replace(/\.pdf$/i, ""), "document");
      const file =
        format === "html"
          ? new Blob([commentSummaryHtml(entries, base)], { type: "text/html" })
          : new Blob([commentSummaryCsv(entries)], { type: "text/csv" });
      if (await downloadBlob(file, `${base}-comments.${format}`)) {
        set({ status: `Summarized ${entries.length} comment(s)` });
        onClose();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolDialog
      title="Summarize Comments"
      icon={<MessageSquareText size={18} />}
      onClose={onClose}
      busy={busy}
      error={error}
      primaryLabel="Save Summary"
      busyLabel="Summarizing…"
      primaryDisabled={!controller?.pdf}
      onPrimary={() => void submit()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-format`}>
          Format
        </label>
        <select
          id={`${ids}-format`}
          className="text-input"
          value={format}
          onChange={(event) => setFormat(event.target.value as SummaryFormat)}
        >
          <option value="html">Printable report (.html)</option>
          <option value="csv">Spreadsheet (.csv)</option>
        </select>
        <label className="setting-title" htmlFor={`${ids}-sort`}>
          Sort by
        </label>
        <select
          id={`${ids}-sort`}
          className="text-input"
          value={sort}
          onChange={(event) => setSort(event.target.value as CommentSort)}
        >
          <option value="page">Page</option>
          <option value="author">Author</option>
          <option value="date">Date</option>
        </select>
      </div>
      <p className="field-hint">
        Lists each comment with its page, type, author, date, review status and replies. The summary
        is created on this device and the PDF is not changed.
      </p>
    </ToolDialog>
  );
}

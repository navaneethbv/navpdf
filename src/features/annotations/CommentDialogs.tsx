import { useId, useState } from "react";
import { Paperclip, TextCursorInput } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { useWorkspace } from "../../stores/workspace";
import { MAX_ATTACHMENT_SIZE_BYTES } from "../../services/document-commands";
import { STAMP_POSITIONS } from "../../services/pdf/stamps";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage } from "../document/use-document-edit";

/** Proposes inserting text after, or replacing, the text selected before the dialog opened. */
export function TextEditProposalDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const selection = useWorkspace((state) => state.textEditSelection);
  const [kind, setKind] = useState<"insert" | "replace">("replace");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = selection.map((item) => item.text).join(" ");

  const submit = async () => {
    if (!controller) return;
    setBusy(true);
    setError("");
    try {
      await controller.addTextEditProposal(kind, selection, text);
      useWorkspace.getState().set({ textEditSelection: [] });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolDialog
      title="Propose Text Edit"
      icon={<TextCursorInput size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || (selection.length ? "" : "Select text on the page, then open this tool.")}
      primaryLabel={kind === "insert" ? "Propose Insertion" : "Propose Replacement"}
      primaryDisabled={!selection.length || (kind === "insert" && !text.trim())}
      onPrimary={() => void submit()}
    >
      {selected && (
        <p className="field-hint">
          Selected text: <q>{selected.length > 200 ? `${selected.slice(0, 200)}…` : selected}</q>
        </p>
      )}
      <fieldset className="preset-list">
        <legend className="setting-title">Proposal</legend>
        <label className="preset-option">
          <input
            type="radio"
            name={`${id}-kind`}
            checked={kind === "replace"}
            onChange={() => setKind("replace")}
          />
          <span>Replace the selected text</span>
        </label>
        <label className="preset-option">
          <input
            type="radio"
            name={`${id}-kind`}
            checked={kind === "insert"}
            onChange={() => setKind("insert")}
          />
          <span>Insert text after the selection</span>
        </label>
      </fieldset>
      <label className="setting-title" htmlFor={`${id}-text`}>
        {kind === "insert" ? "Text to insert" : "Replacement text (blank to propose deleting)"}
      </label>
      <textarea
        id={`${id}-text`}
        className="text-input"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="field-hint">
        The page text is not changed. The proposal is saved as review markup that the author can
        accept or reject. A selection that spans pages uses its first page.
      </p>
    </ToolDialog>
  );
}

const POSITION_LABELS: Record<(typeof STAMP_POSITIONS)[number], string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  center: "Centre",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};

/** Places a paperclip comment that carries an embedded file. */
export function FileCommentDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const current = useWorkspace((state) => state.page);
  const total = controller?.pdf?.numPages ?? 1;
  const [page, setPage] = useState(current);
  const [position, setPosition] = useState<(typeof STAMP_POSITIONS)[number]>("top-right");
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const pdf = controller?.pdf;
    if (!controller || !pdf || !file) return;
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      setError("Attachment exceeds maximum allowed size of 50 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const view = (await pdf.getPage(page)).view;
      const [x1, y1, x2, y2] = view;
      const margin = 24;
      const horizontal = position.endsWith("left")
        ? x1 + margin
        : position.endsWith("right")
          ? x2 - margin - 20
          : (x1 + x2) / 2 - 10;
      const vertical = position.startsWith("top")
        ? y2 - margin - 20
        : position.startsWith("bottom")
          ? y1 + margin
          : (y1 + y2) / 2 - 10;
      const data = new Uint8Array(await file.arrayBuffer());
      await controller.addFileComment(
        { name: file.name, type: file.type, data },
        description,
        page,
        [horizontal, vertical],
      );
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolDialog
      title="Attach File as Comment"
      icon={<Paperclip size={18} />}
      onClose={onClose}
      busy={busy}
      error={error}
      primaryLabel="Attach File"
      busyLabel="Attaching…"
      primaryDisabled={!file || page < 1 || page > total}
      onPrimary={() => void submit()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${id}-file`}>
          File
        </label>
        <input
          id={`${id}-file`}
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <label className="setting-title" htmlFor={`${id}-page`}>
          Page
        </label>
        <input
          id={`${id}-page`}
          className="text-input"
          type="number"
          min={1}
          max={total}
          value={page}
          onChange={(event) => setPage(event.target.valueAsNumber)}
        />
        <label className="setting-title" htmlFor={`${id}-position`}>
          Position (from the unrotated page)
        </label>
        <select
          id={`${id}-position`}
          className="text-input"
          value={position}
          onChange={(event) => setPosition(event.target.value as typeof position)}
        >
          {STAMP_POSITIONS.map((value) => (
            <option key={value} value={value}>
              {POSITION_LABELS[value]}
            </option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${id}-description`}>
          Comment
        </label>
        <input
          id={`${id}-description`}
          className="text-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What the file is"
        />
      </div>
      <p className="field-hint">
        The file is embedded in the PDF, up to 50 MB. NavPDF never opens it automatically; save it
        from File Attachments to inspect it.
      </p>
    </ToolDialog>
  );
}

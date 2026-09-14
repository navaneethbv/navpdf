import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import type { ViewerController } from "../viewer/controller";

export function AnnotationNoteDialog({
  controller,
  onClose,
}: {
  controller: ViewerController;
  onClose: () => void;
}) {
  const [contents, setContents] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!contents.trim()) return;
    setSaving(true);
    setError("");
    try {
      await controller.addStickyNote(contents);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title="Add Sticky Note" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="modal-title">
          <MessageSquarePlus size={18} />
          <span>Page {controller.currentPage()}</span>
        </div>
        <label>
          Note
          <textarea
            autoFocus
            rows={5}
            value={contents}
            onChange={(event) => setContents(event.target.value)}
            placeholder="Write a comment about this page..."
          />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={saving || !contents.trim()}
          >
            {saving ? "Adding..." : "Add Note"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

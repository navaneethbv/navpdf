import { useState, useRef, useEffect } from "react";
import { Paperclip, Pencil, Plus, Download, Trash2, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob } from "../../utils/download";
import { native } from "../../services/native";
import { pruneDocument } from "../../services/engine";
import {
  listEmbeddedAttachments,
  addEmbeddedAttachment,
  extractEmbeddedAttachment,
  deleteEmbeddedAttachment,
  setEmbeddedAttachmentDescription,
  MAX_ATTACHMENT_DESCRIPTION_LENGTH,
  MAX_ATTACHMENT_SIZE_BYTES,
  type EmbeddedAttachmentSummary,
} from "../../services/document-commands";
import { FeatureDialog } from "../../components/FeatureDialog";

interface AttachmentItem extends EmbeddedAttachmentSummary {
  data?: Uint8Array;
}

export function AttachmentsDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const sourcePdf = controller?.pdf;
  const s = useWorkspace();
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null);

  useEffect(() => {
    if (!controller?.pdf) return;
    let active = true;
    setLoadError(null);
    controller.pdf
      .saveDocument()
      .then((bytes) => listEmbeddedAttachments(bytes))
      .then((items) => {
        if (active) setAttachments(items);
      })
      .catch(() => {
        if (active) setLoadError("Attachments could not be read.");
      });
    return () => {
      active = false;
    };
  }, [controller]);

  const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !controller?.pdf) return;

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      s.set({ error: "Attachment exceeds maximum allowed size of 50 MB." });
      return;
    }

    setSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const currentBytes = await controller.pdf.saveDocument();
      const description = `Attached by NavPDF on ${new Date().toLocaleDateString()}`;
      const newBytes = await addEmbeddedAttachment(currentBytes, file.name, bytes, description);
      await controller.replaceWithBytes(newBytes, `File "${file.name}" attached to PDF`, {
        expectedSource: sourcePdf,
      });
      setAttachments((prev) => [
        ...prev.filter((a) => a.name !== file.name),
        { name: file.name, size: file.size, data: bytes, description },
      ]);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadAttachment = async (item: AttachmentItem) => {
    setSaving(true);
    try {
      const data =
        item.data ??
        (controller?.pdf
          ? await extractEmbeddedAttachment(await controller.pdf.saveDocument(), item.name)
          : undefined);
      if (!data) throw new Error(`Could not extract attachment "${item.name}".`);
      await downloadBlob(new Blob([data as unknown as BlobPart]), item.name);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAttachment = async (item: EmbeddedAttachmentSummary) => {
    if (!controller?.pdf) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      let newBytes = await deleteEmbeddedAttachment(currentBytes, item.name);
      if (native) {
        try {
          newBytes = await pruneDocument(newBytes);
        } catch {
          // The attachment is unlisted either way; say that its data is still in the file.
          s.set({
            status:
              "The attachment was removed from the list, but its data could not be cleared from the file.",
          });
        }
      } else {
        s.set({
          status: "Deleted objects remain in the file until saved from the desktop app.",
        });
      }
      await controller.replaceWithBytes(newBytes, `Attachment "${item.name}" removed from PDF`, {
        expectedSource: sourcePdf,
      });
      setAttachments((prev) => prev.filter((a) => a.name !== item.name));
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDescription = async () => {
    if (!controller?.pdf || !editing) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const newBytes = await setEmbeddedAttachmentDescription(
        currentBytes,
        editing.name,
        editing.text,
      );
      await controller.replaceWithBytes(
        newBytes,
        `Description of "${editing.name}" ${editing.text.trim() ? "changed" : "cleared"}`,
        { expectedSource: sourcePdf },
      );
      const description = editing.text.trim() || undefined;
      setAttachments((prev) =>
        prev.map((a) => (a.name === editing.name ? { ...a, description } : a)),
      );
      setEditing(null);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const renderDescription = (att: AttachmentItem) => {
    if (editing?.name !== att.name)
      return att.description ? <p className="field-hint">{att.description}</p> : null;
    return (
      <form
        className="attachment-description"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSaveDescription();
        }}
      >
        <input
          type="text"
          className="text-input"
          aria-label={`Description of ${att.name}`}
          placeholder="Leave empty to clear the description"
          maxLength={MAX_ATTACHMENT_DESCRIPTION_LENGTH}
          value={editing.text}
          disabled={saving}
          onChange={(event) => {
            setEditing({ name: att.name, text: event.target.value });
          }}
        />
        <button type="submit" className="button-primary" disabled={saving}>
          Save
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={saving}
          onClick={() => {
            setEditing(null);
          }}
        >
          Cancel
        </button>
      </form>
    );
  };

  const renderAttachments = () => {
    if (loadError)
      return (
        <p className="error-text" role="alert">
          {loadError}
        </p>
      );
    if (attachments.length === 0)
      return <p className="empty-message">No embedded attachments in this document.</p>;
    return attachments.map((att, idx) => (
      <div key={`${att.name}-${idx}`} className="attachment-row">
        <div className="attachment-info">
          <Paperclip size={16} />
          <span className="attachment-name">{att.name}</span>
          <span className="attachment-size">
            ({att.size !== undefined ? `${Math.round(att.size / 1024)} KB` : "unknown size"})
          </span>
          {renderDescription(att)}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="icon-button"
            title="Edit description"
            onClick={() => {
              setEditing({ name: att.name, text: att.description ?? "" });
            }}
            disabled={saving}
            aria-label={`Edit description of ${att.name}`}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Download attachment"
            onClick={() => {
              void handleDownloadAttachment(att);
            }}
            disabled={saving}
            aria-label={`Download ${att.name}`}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Delete attachment"
            onClick={() => {
              void handleDeleteAttachment(att);
            }}
            disabled={saving}
            aria-label={`Delete ${att.name}`}
            style={{ color: "var(--danger-ink)" }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    ));
  };
  return (
    <FeatureDialog title="PDF Attachments" onClose={onClose} busy={saving}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Paperclip size={18} />
            <h3>File Attachments</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="attachments-action-bar">
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              disabled={saving}
            >
              <Plus size={16} /> Attach New File...
            </button>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                void handleAddFile(e);
              }}
            />
          </div>

          <div className="attachments-list">{renderAttachments()}</div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Close
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

import { useState, useRef, useEffect } from "react";
import { Paperclip, Plus, Download, Trash2, X } from "lucide-react";
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
  MAX_ATTACHMENT_SIZE_BYTES,
  type EmbeddedAttachmentSummary,
} from "../../services/document-commands";

interface AttachmentItem extends EmbeddedAttachmentSummary {
  data?: Uint8Array;
}

export function AttachmentsDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!controller?.pdf) return;
    let active = true;
    controller.pdf
      .saveDocument()
      .then((bytes) => listEmbeddedAttachments(bytes))
      .then((items) => {
        if (active) setAttachments(items);
      })
      .catch(() => {});
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
      const newBytes = await addEmbeddedAttachment(
        currentBytes,
        file.name,
        bytes,
        `Attached by NavPDF on ${new Date().toLocaleDateString()}`,
      );
      await controller.replaceWithBytes(newBytes, `File "${file.name}" attached to PDF`);
      setAttachments((prev) => [
        ...prev.filter((a) => a.name !== file.name),
        { name: file.name, size: file.size, data: bytes },
      ]);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadAttachment = (item: AttachmentItem) => {
    if (item.data) {
      downloadBlob(new Blob([item.data as unknown as BlobPart]), item.name);
      return;
    }
    if (!controller?.pdf) return;
    controller.pdf
      .saveDocument()
      .then(async (currentBytes) => {
        const data = await extractEmbeddedAttachment(currentBytes, item.name);
        if (data) {
          downloadBlob(new Blob([data as unknown as BlobPart]), item.name);
        } else {
          s.set({ error: `Could not extract attachment "${item.name}".` });
        }
      })
      .catch((err) => {
        s.set({ error: err instanceof Error ? err.message : String(err) });
      });
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
          // ignore or fall back
        }
      } else {
        s.set({
          status: "Deleted objects remain in the file until saved from the desktop app.",
        });
      }
      await controller.replaceWithBytes(newBytes, `Attachment "${item.name}" removed from PDF`);
      setAttachments((prev) => prev.filter((a) => a.name !== item.name));
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="PDF Attachments">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Paperclip size={18} />
            <h3>File Attachments</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="attachments-action-bar">
            <button
              className="button-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
            >
              <Plus size={16} /> Attach New File...
            </button>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleAddFile}
            />
          </div>

          <div className="attachments-list">
            {attachments.length === 0 ? (
              <p className="empty-message">No embedded attachments in this document.</p>
            ) : (
              attachments.map((att, idx) => (
                <div key={idx} className="attachment-row">
                  <div className="attachment-info">
                    <Paperclip size={16} />
                    <span className="attachment-name">{att.name}</span>
                    <span className="attachment-size">
                      (
                      {att.size !== undefined
                        ? `${Math.round(att.size / 1024)} KB`
                        : "unknown size"}
                      )
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      className="icon-button"
                      title="Download attachment"
                      onClick={() => handleDownloadAttachment(att)}
                      disabled={saving}
                      aria-label={`Download ${att.name}`}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title="Delete attachment"
                      onClick={() => handleDeleteAttachment(att)}
                      disabled={saving}
                      aria-label={`Delete ${att.name}`}
                      style={{ color: "var(--accent-red, #d32f2f)" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

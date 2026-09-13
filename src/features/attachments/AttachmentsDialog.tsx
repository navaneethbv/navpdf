import { useState, useRef } from "react";
import { Paperclip, Plus, Download, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBlob } from "../../utils/download";

interface AttachmentItem {
  name: string;
  size: number;
  data: Uint8Array;
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

  const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !controller?.pdf) return;
    setSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      await doc.attach(bytes, file.name, {
        mimeType: file.type || "application/octet-stream",
        description: `Attached by NavPDF on ${new Date().toLocaleDateString()}`,
        creationDate: new Date(),
        modificationDate: new Date(),
      });
      const newBytes = await doc.save();
      await controller.replaceWithBytes(
        newBytes,
        `File "${file.name}" attached to PDF`,
      );
      setAttachments((prev) => [
        ...prev,
        { name: file.name, size: file.size, data: bytes },
      ]);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadAttachment = (item: AttachmentItem) => {
    downloadBlob(new Blob([item.data as unknown as BlobPart]), item.name);
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
                      ({Math.round(att.size / 1024)} KB)
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    title="Download attachment"
                    onClick={() => handleDownloadAttachment(att)}
                  >
                    <Download size={16} />
                  </button>
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

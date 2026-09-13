import { useState } from "react";
import { EyeOff, AlertTriangle, Check, X, Trash2 } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";

interface RedactionMark {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function RedactionTool({ onClose }: { onClose: () => void }) {
  const s = useWorkspace();
  const [targetPage, setTargetPage] = useState(s.page);
  const [x, setX] = useState(50);
  const [y, setY] = useState(100);
  const [width, setWidth] = useState(200);
  const [height, setHeight] = useState(30);
  const [marks, setMarks] = useState<RedactionMark[]>([]);

  const handleAddMark = () => {
    const maxPage = s.info?.pages || 1;
    setMarks((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        page: Math.max(1, Math.min(targetPage, maxPage)),
        x,
        y,
        width,
        height,
      },
    ]);
    s.set({ status: "Redaction region marked for later permanent removal" });
  };

  const handleRemoveMark = (id: string) => {
    setMarks((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Redact Content">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <EyeOff size={18} />
            <h3>Redact Sensitive Content</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="warning-banner">
            <AlertTriangle size={18} />
            <span>
              Secure redaction is a two-step workflow: mark regions here, then
              apply permanent removal with a vetted engine. Painting a black
              rectangle alone does not remove the underlying text or images, so
              this tool marks regions only and never claims the content is gone.
            </span>
          </div>

          <div className="setting-group" style={{ marginTop: "14px" }}>
            <label className="setting-title">Page</label>
            <input
              type="number"
              min={1}
              max={s.info?.pages || 1}
              value={targetPage}
              onChange={(e) => setTargetPage(Number(e.target.value))}
              className="text-input"
            />
          </div>

          <div className="settings-row">
            <div className="setting-group">
              <label className="setting-title">X Offset (pt)</label>
              <input
                type="number"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label className="setting-title">Y Offset (pt)</label>
              <input
                type="number"
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
                className="text-input"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="setting-group">
              <label className="setting-title">Width (pt)</label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label className="setting-title">Height (pt)</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="text-input"
              />
            </div>
          </div>

          {marks.length > 0 && (
            <div className="setting-group" style={{ marginTop: "12px" }}>
              <label className="setting-title">
                Marked regions ({marks.length})
              </label>
              {marks.map((m) => (
                <div key={m.id} className="attachment-row">
                  <span>
                    Page {m.page}: {m.width}x{m.height} pt at ({m.x}, {m.y})
                  </span>
                  <button
                    className="icon-button"
                    title="Remove mark"
                    onClick={() => handleRemoveMark(m.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="field-hint" style={{ marginTop: "12px" }}>
            Permanent apply (content removal, metadata sanitization, and an
            independent removal audit) requires the M6 redaction engine, which
            is not yet integrated. Marked regions are kept for this session
            only and the document is left unchanged.
          </p>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Done
          </button>
          <button onClick={handleAddMark} className="button-primary">
            <Check size={16} /> Mark Region
          </button>
        </div>
      </div>
    </div>
  );
}

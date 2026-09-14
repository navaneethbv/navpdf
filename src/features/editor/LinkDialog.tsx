import { useState, useMemo } from "react";
import { Link as LinkIcon, X, AlertTriangle, ExternalLink, Bookmark } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  addLinkAnnotation,
  validateSafeUrl,
  type LinkAnnotationOptions,
} from "../../services/document-commands";

export function LinkDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [linkType, setLinkType] = useState<"url" | "page">("url");
  const [url, setUrl] = useState("https://");
  const [targetPage, setTargetPage] = useState<number>(1);
  const [placementPage, setPlacementPage] = useState<number>(s.page);
  const [rectX, setRectX] = useState<number>(50);
  const [rectY, setRectY] = useState<number>(500);
  const [rectWidth, setRectWidth] = useState<number>(200);
  const [rectHeight, setRectHeight] = useState<number>(30);
  const [saving, setSaving] = useState(false);

  const urlValidation = useMemo(() => {
    if (linkType !== "url") return { valid: true };
    return validateSafeUrl(url);
  }, [linkType, url]);

  const handleAddLink = async () => {
    if (!controller?.pdf) return;
    if (linkType === "url" && !urlValidation.valid) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const rect: [number, number, number, number] = [
        rectX,
        rectY,
        rectX + rectWidth,
        rectY + rectHeight,
      ];

      const options: LinkAnnotationOptions = {
        page: placementPage,
        rect,
        target:
          linkType === "url"
            ? { type: "url", url }
            : { type: "page", targetPage },
      };

      const newBytes = await addLinkAnnotation(currentBytes, options);
      await controller.replaceWithBytes(
        newBytes,
        linkType === "url" ? `Added URL link to page ${placementPage}` : `Added page jump to page ${targetPage}`,
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add Link Annotation"
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <LinkIcon size={18} />
            <h3>Add Link Annotation</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="tab-buttons-bar">
          <button
            className={linkType === "url" ? "active" : ""}
            onClick={() => setLinkType("url")}
          >
            <ExternalLink size={15} /> External URL
          </button>
          <button
            className={linkType === "page" ? "active" : ""}
            onClick={() => setLinkType("page")}
          >
            <Bookmark size={15} /> Page Jump
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-title">Placement Page</label>
            <input
              type="number"
              min={1}
              max={s.info?.pages || 1}
              value={placementPage}
              onChange={(e) => setPlacementPage(Number(e.target.value))}
              className="text-input"
            />
          </div>

          {linkType === "url" ? (
            <div className="setting-group">
              <label className="setting-title">Destination URL</label>
              <input
                type="text"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="text-input"
              />
              {!urlValidation.valid && (
                <div
                  style={{
                    backgroundColor: "var(--accent-red-subtle, #ffebee)",
                    border: "1px solid var(--accent-red, #d32f2f)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--accent-red, #d32f2f)",
                    fontSize: "0.85rem",
                  }}
                  role="alert"
                >
                  <AlertTriangle size={16} />
                  <span>{urlValidation.reason}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="setting-group">
              <label className="setting-title">Jump to Page Number</label>
              <input
                type="number"
                min={1}
                max={s.info?.pages || 1}
                value={targetPage}
                onChange={(e) => setTargetPage(Number(e.target.value))}
                className="text-input"
              />
            </div>
          )}

          <div className="settings-row">
            <div className="setting-group">
              <label className="setting-title">Position X (pt)</label>
              <input
                type="number"
                value={rectX}
                onChange={(e) => setRectX(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label className="setting-title">Position Y (pt)</label>
              <input
                type="number"
                value={rectY}
                onChange={(e) => setRectY(Number(e.target.value))}
                className="text-input"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="setting-group">
              <label className="setting-title">Width (pt)</label>
              <input
                type="number"
                min={10}
                value={rectWidth}
                onChange={(e) => setRectWidth(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label className="setting-title">Height (pt)</label>
              <input
                type="number"
                min={10}
                value={rectHeight}
                onChange={(e) => setRectHeight(Number(e.target.value))}
                className="text-input"
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={handleAddLink}
            disabled={saving || (linkType === "url" && !urlValidation.valid)}
            className="button-primary"
          >
            {saving ? "Adding..." : "Add Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

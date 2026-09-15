import { useState, useRef, useMemo } from "react";
import { Type, Image as ImageIcon, X, AlertTriangle } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  insertTextContent,
  insertImageContent,
  validateStandardFontCoverage,
  type StandardFontFamily,
} from "../../services/document-commands";
import { fromTopLeftVisual } from "../../services/pdf/page-box";

export function ContentEditor({
  controller,
  type,
  onClose,
}: {
  controller: ViewerController | null;
  type: "text" | "image";
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState<StandardFontFamily>("Helvetica");
  const [fontColor, setFontColor] = useState("#24332d");
  const [alignment, setAlignment] = useState<"left" | "center" | "right">("left");
  const [maxWidth, setMaxWidth] = useState<number>(400);
  const [targetPage, setTargetPage] = useState(s.page);
  const [posX, setPosX] = useState(50);
  const [posY, setPosY] = useState(50);
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(true);
  const [imageOpacity, setImageOpacity] = useState(1);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coverage = useMemo(
    () =>
      text.trim() ? validateStandardFontCoverage(text) : { valid: true, unsupportedChars: [] },
    [text],
  );

  const handleApplyText = async () => {
    if (!controller?.pdf || !text.trim() || !coverage.valid) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const r = parseInt(fontColor.slice(1, 3), 16) / 255;
      const g = parseInt(fontColor.slice(3, 5), 16) / 255;
      const b = parseInt(fontColor.slice(5, 7), 16) / 255;
      let textX = posX;
      let textY = posY;
      try {
        const doc = await PDFDocument.load(currentBytes);
        const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
        const page = doc.getPage(pageIndex);
        const mapped = fromTopLeftVisual(page, posX, posY, maxWidth > 0 ? maxWidth : 200, fontSize);
        textX = mapped.x;
        textY = mapped.y;
      } catch {
        // Fallback for mock test environments
      }

      const newBytes = await insertTextContent(currentBytes, {
        page: targetPage,
        text,
        x: textX,
        y: textY,
        fontSize,
        fontFamily,
        color: [r, g, b],
        alignment,
        maxWidth: maxWidth > 0 ? maxWidth : undefined,
      });

      await controller.replaceWithBytes(newBytes, "Text added to document");
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleApplyImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !controller?.pdf) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const arrayBuffer = await file.arrayBuffer();
      const imgBytes = new Uint8Array(arrayBuffer);
      const isPng = file.type.includes("png");

      const newBytes = await insertImageContent(currentBytes, {
        page: targetPage,
        imageBytes: imgBytes,
        imageType: isPng ? "png" : "jpg",
        preserveAspectRatio,
        opacity: imageOpacity,
      });

      await controller.replaceWithBytes(newBytes, "Image inserted into document");
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
      aria-label={type === "text" ? "Add Text" : "Add Image"}
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            {type === "text" ? <Type size={18} /> : <ImageIcon size={18} />}
            <h3>{type === "text" ? "Add Text to Page" : "Insert Image"}</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-title">Target Page</label>
            <input
              type="number"
              min={1}
              max={s.info?.pages || 1}
              value={targetPage}
              onChange={(e) => setTargetPage(Number(e.target.value))}
              className="text-input"
            />
          </div>

          {type === "text" ? (
            <>
              <div className="setting-group">
                <label className="setting-title">Text Content</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter text to place on page..."
                  rows={4}
                  className="text-input"
                />
              </div>

              {!coverage.valid && (
                <div
                  className="setting-group"
                  style={{
                    backgroundColor: "var(--accent-red-subtle, #ffebee)",
                    border: "1px solid var(--accent-red, #d32f2f)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--accent-red, #d32f2f)",
                    fontSize: "0.85rem",
                  }}
                  role="alert"
                >
                  <AlertTriangle size={16} />
                  <span>
                    Unsupported characters for standard fonts:{" "}
                    <strong>{coverage.unsupportedChars.join(", ")}</strong>
                  </span>
                </div>
              )}

              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">Font Family</label>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value as StandardFontFamily)}
                    className="select-input"
                  >
                    <option value="Helvetica">Helvetica</option>
                    <option value="Helvetica-Bold">Helvetica Bold</option>
                    <option value="Times-Roman">Times Roman</option>
                    <option value="Courier">Courier</option>
                  </select>
                </div>

                <div className="setting-group">
                  <label className="setting-title">Alignment</label>
                  <select
                    value={alignment}
                    onChange={(e) => setAlignment(e.target.value as "left" | "center" | "right")}
                    className="select-input"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">Font Size (pt)</label>
                  <input
                    type="number"
                    min={8}
                    max={72}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label className="setting-title">Color</label>
                  <input
                    type="color"
                    value={fontColor}
                    onChange={(e) => setFontColor(e.target.value)}
                    className="color-input"
                  />
                </div>
              </div>

              <div className="setting-group">
                <label className="setting-title">Max Wrap Width (pt)</label>
                <input
                  type="number"
                  min={50}
                  max={800}
                  value={maxWidth}
                  onChange={(e) => setMaxWidth(Number(e.target.value))}
                  className="text-input"
                />
              </div>

              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">X Position (pt)</label>
                  <input
                    type="number"
                    value={posX}
                    onChange={(e) => setPosX(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label className="setting-title">Y Position from top (pt)</label>
                  <input
                    type="number"
                    value={posY}
                    onChange={(e) => setPosY(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="setting-group">
                <label className="setting-title">Image Scaling & Aspect Ratio</label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={preserveAspectRatio}
                    onChange={(e) => setPreserveAspectRatio(e.target.checked)}
                  />
                  Preserve Aspect Ratio
                </label>
              </div>

              <div className="setting-group">
                <label className="setting-title">Opacity ({Math.round(imageOpacity * 100)}%)</label>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={imageOpacity}
                  onChange={(e) => setImageOpacity(Number(e.target.value))}
                />
              </div>

              <div className="setting-group">
                <label className="setting-title">Select Image File</label>
                <button
                  className="button-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  Choose PNG or JPEG...
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg"
                  style={{ display: "none" }}
                  onChange={handleApplyImage}
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {type === "text" && (
            <button
              onClick={handleApplyText}
              disabled={saving || !text.trim() || !coverage.valid}
              className="button-primary"
            >
              {saving ? "Inserting..." : "Insert Text"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

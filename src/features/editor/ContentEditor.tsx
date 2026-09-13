import { useState, useRef } from "react";
import { Type, Image as ImageIcon, X } from "lucide-react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

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
  const [fontColor, setFontColor] = useState("#24332d");
  const [targetPage, setTargetPage] = useState(s.page);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApplyText = async () => {
    if (!controller?.pdf || !text.trim()) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
      const page = doc.getPage(pageIndex);
      const { height } = page.getSize();

      // Convert hex to rgb
      const r = parseInt(fontColor.slice(1, 3), 16) / 255;
      const g = parseInt(fontColor.slice(3, 5), 16) / 255;
      const b = parseInt(fontColor.slice(5, 7), 16) / 255;

      page.drawText(text, {
        x: 50,
        y: height - 100,
        size: fontSize,
        font,
        color: rgb(r, g, b),
      });

      const newBytes = await doc.save();
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
      const doc = await PDFDocument.load(currentBytes);
      const arrayBuffer = await file.arrayBuffer();
      const imgBytes = new Uint8Array(arrayBuffer);
      const img = file.type.includes("png")
        ? await doc.embedPng(imgBytes)
        : await doc.embedJpg(imgBytes);

      const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
      const page = doc.getPage(pageIndex);
      const { width, height } = page.getSize();

      // Scale to fit nicely (max 50% of page width)
      const scale = Math.min((width * 0.5) / img.width, (height * 0.5) / img.height, 1);
      const imgWidth = img.width * scale;
      const imgHeight = img.height * scale;

      page.drawImage(img, {
        x: (width - imgWidth) / 2,
        y: (height - imgHeight) / 2,
        width: imgWidth,
        height: imgHeight,
      });

      const newBytes = await doc.save();
      await controller.replaceWithBytes(newBytes, "Image inserted into document");
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={type === "text" ? "Add Text" : "Add Image"}>
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
                  rows={3}
                  className="text-input"
                />
              </div>

              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">Font Size</label>
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
            </>
          ) : (
            <div className="setting-group">
              <label className="setting-title">Select Image File</label>
              <button
                className="button-secondary"
                onClick={() => fileInputRef.current?.click()}
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
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {type === "text" && (
            <button
              onClick={handleApplyText}
              disabled={saving || !text.trim()}
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

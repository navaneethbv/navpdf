import { useState } from "react";
import { Sparkles, Layout, X } from "lucide-react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

export function DesignTools({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [template, setTemplate] = useState<"modern" | "minimal" | "corporate">("modern");
  const [title, setTitle] = useState(s.document?.name.replace(/\.pdf$/i, "") || "Document Title");
  const [subtitle, setSubtitle] = useState("Official Report and Overview");
  const [author, setAuthor] = useState("NavPDF Author");
  const [generating, setGenerating] = useState(false);

  const handleGenerateCover = async () => {
    if (!controller?.pdf) return;
    setGenerating(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
      const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

      // Insert cover page at index 0 (standard A4: 595.28 x 841.89)
      const page = doc.insertPage(0, [595.28, 841.89]);
      const { width, height } = page.getSize();

      if (template === "modern") {
        // Top accent band
        page.drawRectangle({
          x: 0,
          y: height - 180,
          width,
          height: 180,
          color: rgb(0.14, 0.38, 0.29),
        });

        page.drawText(title, {
          x: 50,
          y: height - 110,
          size: 28,
          font: fontBold,
          color: rgb(1, 1, 1),
        });

        page.drawText(subtitle, {
          x: 50,
          y: height - 150,
          size: 16,
          font: fontRegular,
          color: rgb(0.8, 0.9, 0.85),
        });

        page.drawText(`Prepared by: ${author}`, {
          x: 50,
          y: 80,
          size: 12,
          font: fontRegular,
          color: rgb(0.3, 0.3, 0.3),
        });

        page.drawText(`Date: ${new Date().toLocaleDateString()}`, {
          x: 50,
          y: 60,
          size: 11,
          font: fontRegular,
          color: rgb(0.5, 0.5, 0.5),
        });
      } else if (template === "corporate") {
        // Left vertical border stripe
        page.drawRectangle({
          x: 0,
          y: 0,
          width: 24,
          height,
          color: rgb(0.14, 0.38, 0.29),
        });

        page.drawText(title, {
          x: 60,
          y: height - 250,
          size: 32,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });

        page.drawText(subtitle, {
          x: 60,
          y: height - 290,
          size: 16,
          font: fontRegular,
          color: rgb(0.4, 0.4, 0.4),
        });

        page.drawText(`${author} · ${new Date().toLocaleDateString()}`, {
          x: 60,
          y: 100,
          size: 12,
          font: fontRegular,
          color: rgb(0.4, 0.4, 0.4),
        });
      } else {
        // Minimalist template
        page.drawText(title, {
          x: 60,
          y: height / 2 + 30,
          size: 34,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });

        page.drawText(subtitle, {
          x: 60,
          y: height / 2 - 10,
          size: 15,
          font: fontRegular,
          color: rgb(0.4, 0.4, 0.4),
        });

        page.drawText(`${author} · ${new Date().toLocaleDateString()}`, {
          x: 60,
          y: 60,
          size: 11,
          font: fontRegular,
          color: rgb(0.6, 0.6, 0.6),
        });
      }

      const newBytes = await doc.save();
      await controller.replaceWithBytes(
        newBytes,
        "Cover page generated and inserted",
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Generate Cover Page">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Layout size={18} />
            <h3>Generate Cover Page</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-title">Template Style</label>
            <div className="tab-buttons-bar">
              <button
                className={template === "modern" ? "active" : ""}
                onClick={() => setTemplate("modern")}
              >
                Modern Accent
              </button>
              <button
                className={template === "corporate" ? "active" : ""}
                onClick={() => setTemplate("corporate")}
              >
                Corporate
              </button>
              <button
                className={template === "minimal" ? "active" : ""}
                onClick={() => setTemplate("minimal")}
              >
                Minimal
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label className="setting-title">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-input"
            />
          </div>

          <div className="setting-group">
            <label className="setting-title">Subtitle</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="text-input"
            />
          </div>

          <div className="setting-group">
            <label className="setting-title">Author / Organization</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="text-input"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={handleGenerateCover}
            disabled={generating || !title.trim()}
            className="button-primary"
          >
            <Sparkles size={16} /> {generating ? "Generating..." : "Insert Cover Page"}
          </button>
        </div>
      </div>
    </div>
  );
}

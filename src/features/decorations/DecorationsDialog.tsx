import { useState } from "react";
import { Heading, Droplets, Hash, Layers, X } from "lucide-react";
import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

export function DecorationsDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [tab, setTab] = useState<"watermark" | "header-footer" | "bates" | "background">("watermark");
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.2);
  const [headerLeft, setHeaderLeft] = useState("");
  const [headerRight, setHeaderRight] = useState("Page {page} of {total}");
  const [footerCenter, setFooterCenter] = useState("{date}");
  const [batesPrefix, setBatesPrefix] = useState("DOC-");
  const [batesStart, setBatesStart] = useState(1);
  const [batesPadding, setBatesPadding] = useState(6);
  const [bgColor, setBgColor] = useState("#f7f9f8");
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    if (!controller?.pdf) return;
    setApplying(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
      const total = doc.getPageCount();

      for (let i = 0; i < total; i++) {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        const pageNum = i + 1;
        const today = new Date().toLocaleDateString();

        if (tab === "watermark" && watermarkText.trim()) {
          const textWidth = fontBold.widthOfTextAtSize(watermarkText, 50);
          page.drawText(watermarkText, {
            x: (width - textWidth) / 2,
            y: height / 2,
            size: 50,
            font: fontBold,
            color: rgb(0.7, 0.2, 0.2),
            opacity: watermarkOpacity,
            rotate: degrees(45),
          });
        } else if (tab === "header-footer") {
          const format = (template: string) =>
            template
              .replace(/\{page\}/g, String(pageNum))
              .replace(/\{total\}/g, String(total))
              .replace(/\{date\}/g, today);

          if (headerLeft) {
            page.drawText(format(headerLeft), {
              x: 40,
              y: height - 30,
              size: 10,
              font,
              color: rgb(0.4, 0.4, 0.4),
            });
          }
          if (headerRight) {
            const formatted = format(headerRight);
            const w = font.widthOfTextAtSize(formatted, 10);
            page.drawText(formatted, {
              x: width - w - 40,
              y: height - 30,
              size: 10,
              font,
              color: rgb(0.4, 0.4, 0.4),
            });
          }
          if (footerCenter) {
            const formatted = format(footerCenter);
            const w = font.widthOfTextAtSize(formatted, 10);
            page.drawText(formatted, {
              x: (width - w) / 2,
              y: 25,
              size: 10,
              font,
              color: rgb(0.4, 0.4, 0.4),
            });
          }
        } else if (tab === "bates") {
          const numStr = String(batesStart + i).padStart(batesPadding, "0");
          const batesText = `${batesPrefix}${numStr}`;
          const w = fontBold.widthOfTextAtSize(batesText, 10);
          page.drawText(batesText, {
            x: width - w - 40,
            y: 25,
            size: 10,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.2),
          });
        } else if (tab === "background") {
          const r = parseInt(bgColor.slice(1, 3), 16) / 255;
          const g = parseInt(bgColor.slice(3, 5), 16) / 255;
          const b = parseInt(bgColor.slice(5, 7), 16) / 255;
          page.drawRectangle({
            x: 0,
            y: 0,
            width,
            height,
            color: rgb(r, g, b),
            opacity: 0.2,
          });
        }
      }

      const newBytes = await doc.save();
      await controller.replaceWithBytes(newBytes, `Decorations applied (${tab})`);
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Document Decorations">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Layers size={18} />
            <h3>Document Decorations</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="tab-buttons-bar">
          <button
            className={tab === "watermark" ? "active" : ""}
            onClick={() => setTab("watermark")}
          >
            <Droplets size={15} /> Watermark
          </button>
          <button
            className={tab === "header-footer" ? "active" : ""}
            onClick={() => setTab("header-footer")}
          >
            <Heading size={15} /> Header & Footer
          </button>
          <button
            className={tab === "bates" ? "active" : ""}
            onClick={() => setTab("bates")}
          >
            <Hash size={15} /> Bates Numbers
          </button>
          <button
            className={tab === "background" ? "active" : ""}
            onClick={() => setTab("background")}
          >
            <Layers size={15} /> Background
          </button>
        </div>

        <div className="modal-body">
          {tab === "watermark" && (
            <>
              <div className="setting-group">
                <label className="setting-title">Watermark Text</label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  className="text-input"
                />
              </div>
              <div className="setting-group">
                <label className="setting-title">Opacity ({Math.round(watermarkOpacity * 100)}%)</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.8"
                  step="0.05"
                  value={watermarkOpacity}
                  onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                />
              </div>
            </>
          )}

          {tab === "header-footer" && (
            <>
              <div className="setting-group">
                <label className="setting-title">Header Left Slot</label>
                <input
                  type="text"
                  placeholder="e.g. Confidential Document"
                  value={headerLeft}
                  onChange={(e) => setHeaderLeft(e.target.value)}
                  className="text-input"
                />
              </div>
              <div className="setting-group">
                <label className="setting-title">Header Right Slot</label>
                <input
                  type="text"
                  placeholder="e.g. Page {page} of {total}"
                  value={headerRight}
                  onChange={(e) => setHeaderRight(e.target.value)}
                  className="text-input"
                />
              </div>
              <div className="setting-group">
                <label className="setting-title">Footer Center Slot</label>
                <input
                  type="text"
                  placeholder="e.g. {date}"
                  value={footerCenter}
                  onChange={(e) => setFooterCenter(e.target.value)}
                  className="text-input"
                />
              </div>
              <p className="field-hint">Use tokens: &#123;page&#125;, &#123;total&#125;, &#123;date&#125;</p>
            </>
          )}

          {tab === "bates" && (
            <>
              <div className="setting-group">
                <label className="setting-title">Prefix</label>
                <input
                  type="text"
                  value={batesPrefix}
                  onChange={(e) => setBatesPrefix(e.target.value)}
                  className="text-input"
                />
              </div>
              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">Start Number</label>
                  <input
                    type="number"
                    min={1}
                    value={batesStart}
                    onChange={(e) => setBatesStart(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label className="setting-title">Digits Padding</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={batesPadding}
                    onChange={(e) => setBatesPadding(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              </div>
              <p className="field-hint">
                Preview: {batesPrefix}{String(batesStart).padStart(batesPadding, "0")}
              </p>
            </>
          )}

          {tab === "background" && (
            <div className="setting-group">
              <label className="setting-title">Background Tint Color</label>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="color-input"
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="button-primary"
          >
            {applying ? "Applying..." : "Apply to All Pages"}
          </button>
        </div>
      </div>
    </div>
  );
}

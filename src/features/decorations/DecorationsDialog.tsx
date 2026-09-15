import { useState, useMemo } from "react";
import { Heading, Droplets, Hash, Layers, Trash2, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  applyDocumentDecorations,
  applyBatesNumbering,
  removeDocumentDecorations,
  type DocumentDecorationsOptions,
  type BatesNumberingOptions,
} from "../../services/document-commands";
import { native } from "../../services/native";
import { pruneDocument } from "../../services/engine";

export function DecorationsDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [tab, setTab] = useState<"watermark" | "header-footer" | "bates" | "background">(
    "watermark",
  );

  // Watermark
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.2);
  const [watermarkRotation, setWatermarkRotation] = useState(45);
  const [watermarkFontSize, setWatermarkFontSize] = useState(50);
  const [watermarkColor, setWatermarkColor] = useState("#b33333");

  // Header & Footer (6 slots)
  const [headerLeft, setHeaderLeft] = useState("");
  const [headerCenter, setHeaderCenter] = useState("");
  const [headerRight, setHeaderRight] = useState("Page {page} of {total}");
  const [footerLeft, setFooterLeft] = useState("");
  const [footerCenter, setFooterCenter] = useState("{date}");
  const [footerRight, setFooterRight] = useState("");

  // Bates Numbering
  const [batesPrefix, setBatesPrefix] = useState("DOC-");
  const [batesSuffix, setBatesSuffix] = useState("");
  const [batesStart, setBatesStart] = useState(1);
  const [batesPadding, setBatesPadding] = useState(6);
  const [batesPosition, setBatesPosition] = useState<
    "bottom-right" | "bottom-center" | "bottom-left" | "top-right" | "top-left"
  >("bottom-right");

  // Background
  const [bgColor, setBgColor] = useState("#f0f4f2");
  const [bgOpacity, setBgOpacity] = useState(0.2);

  // Scope
  const [pageScope, setPageScope] = useState<"all" | "custom">("all");
  const [customRange, setCustomRange] = useState("");

  const [applying, setApplying] = useState(false);

  const parsedPageRange = useMemo(() => {
    if (pageScope === "all" || !customRange.trim()) return undefined;
    const pages: number[] = [];
    const total = s.info?.pages || 1;
    const parts = customRange.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes("-")) {
        const [start, end] = trimmed.split("-").map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let p = Math.min(start, end); p <= Math.max(start, end); p++) {
            if (p >= 1 && p <= total) pages.push(p);
          }
        }
      } else {
        const p = Number(trimmed);
        if (!isNaN(p) && p >= 1 && p <= total) pages.push(p);
      }
    }
    return pages.length > 0 ? Array.from(new Set(pages)) : undefined;
  }, [pageScope, customRange, s.info?.pages]);

  const hexToRgb = (hex: string): [number, number, number] => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

  const handleApply = async () => {
    if (!controller?.pdf) return;
    setApplying(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();

      if (tab === "bates") {
        const options: BatesNumberingOptions = {
          prefix: batesPrefix,
          suffix: batesSuffix,
          startNumber: batesStart,
          padding: batesPadding,
          position: batesPosition,
          pageIndices: parsedPageRange ? parsedPageRange.map((p) => p - 1) : undefined,
        };
        const result = await applyBatesNumbering(currentBytes, options);
        await controller.replaceWithBytes(
          result.bytes,
          `Applied Bates numbering (${result.manifest.items.length} pages indexed)`,
        );
      } else {
        const options: DocumentDecorationsOptions = {
          pageRange: parsedPageRange,
          metadata: {
            title: s.info?.title || s.document?.name.replace(/\.pdf$/i, "") || "",
            author: s.info?.author || "",
            date: new Date().toLocaleDateString(),
          },
        };

        if (tab === "watermark" && watermarkText.trim()) {
          options.watermark = {
            text: watermarkText.trim(),
            opacity: watermarkOpacity,
            rotationDegrees: watermarkRotation,
            fontSize: watermarkFontSize,
            color: hexToRgb(watermarkColor),
          };
        } else if (tab === "header-footer") {
          options.header = {
            left: headerLeft.trim() || undefined,
            center: headerCenter.trim() || undefined,
            right: headerRight.trim() || undefined,
          };
          options.footer = {
            left: footerLeft.trim() || undefined,
            center: footerCenter.trim() || undefined,
            right: footerRight.trim() || undefined,
          };
        } else if (tab === "background") {
          options.background = {
            color: hexToRgb(bgColor),
            opacity: bgOpacity,
          };
        }

        const newBytes = await applyDocumentDecorations(currentBytes, options);
        await controller.replaceWithBytes(newBytes, `Decorations applied (${tab})`);
      }

      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveDecorations = async () => {
    if (!controller?.pdf) return;
    setApplying(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      let cleanedBytes = await removeDocumentDecorations(currentBytes, parsedPageRange);
      if (native) {
        try {
          cleanedBytes = await pruneDocument(cleanedBytes);
        } catch {
          // ignore
        }
      } else {
        s.set({
          status: "Deleted objects remain in the file until saved from the desktop app.",
        });
      }
      await controller.replaceWithBytes(
        cleanedBytes,
        "Removed app-owned decorations from document",
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Document Decorations"
    >
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
          <button className={tab === "bates" ? "active" : ""} onClick={() => setTab("bates")}>
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
              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">Font Size (pt)</label>
                  <input
                    type="number"
                    min={12}
                    max={120}
                    value={watermarkFontSize}
                    onChange={(e) => setWatermarkFontSize(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label className="setting-title">Rotation (degrees)</label>
                  <select
                    value={watermarkRotation}
                    onChange={(e) => setWatermarkRotation(Number(e.target.value))}
                    className="select-input"
                  >
                    <option value={0}>0° (Horizontal)</option>
                    <option value={45}>45° (Diagonal Up)</option>
                    <option value={-45}>-45° (Diagonal Down)</option>
                    <option value={90}>90° (Vertical)</option>
                  </select>
                </div>
              </div>
              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">
                    Opacity ({Math.round(watermarkOpacity * 100)}%)
                  </label>
                  <input
                    type="range"
                    min="0.05"
                    max="0.8"
                    step="0.05"
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                  />
                </div>
                <div className="setting-group">
                  <label className="setting-title">Color</label>
                  <input
                    type="color"
                    value={watermarkColor}
                    onChange={(e) => setWatermarkColor(e.target.value)}
                    className="color-input"
                  />
                </div>
              </div>
            </>
          )}

          {tab === "header-footer" && (
            <>
              <div className="setting-group">
                <label className="setting-title">Header (Top)</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="e.g. Confidential Document"
                    value={headerLeft}
                    onChange={(e) => setHeaderLeft(e.target.value)}
                    className="text-input"
                  />
                  <input
                    type="text"
                    placeholder="e.g. Center header"
                    value={headerCenter}
                    onChange={(e) => setHeaderCenter(e.target.value)}
                    className="text-input"
                  />
                  <input
                    type="text"
                    placeholder="e.g. Page {page} of {total}"
                    value={headerRight}
                    onChange={(e) => setHeaderRight(e.target.value)}
                    className="text-input"
                  />
                </div>
              </div>

              <div className="setting-group">
                <label className="setting-title">Footer (Bottom)</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Left footer"
                    value={footerLeft}
                    onChange={(e) => setFooterLeft(e.target.value)}
                    className="text-input"
                  />
                  <input
                    type="text"
                    placeholder="e.g. {date}"
                    value={footerCenter}
                    onChange={(e) => setFooterCenter(e.target.value)}
                    className="text-input"
                  />
                  <input
                    type="text"
                    placeholder="Right footer"
                    value={footerRight}
                    onChange={(e) => setFooterRight(e.target.value)}
                    className="text-input"
                  />
                </div>
              </div>

              <p className="field-hint">
                Available tokens: &#123;page&#125;, &#123;total&#125;, &#123;date&#125;,
                &#123;title&#125;, &#123;author&#125;
              </p>
            </>
          )}

          {tab === "bates" && (
            <>
              <div className="settings-row">
                <div className="setting-group">
                  <label className="setting-title">Prefix</label>
                  <input
                    type="text"
                    value={batesPrefix}
                    onChange={(e) => setBatesPrefix(e.target.value)}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label className="setting-title">Suffix</label>
                  <input
                    type="text"
                    value={batesSuffix}
                    onChange={(e) => setBatesSuffix(e.target.value)}
                    className="text-input"
                  />
                </div>
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
                    max={12}
                    value={batesPadding}
                    onChange={(e) => setBatesPadding(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              </div>

              <div className="setting-group">
                <label className="setting-title">Position on Page</label>
                <select
                  value={batesPosition}
                  onChange={(e) => setBatesPosition(e.target.value as typeof batesPosition)}
                  className="select-input"
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-center">Bottom Center</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="top-left">Top Left</option>
                </select>
              </div>

              <p className="field-hint">
                Preview: {batesPrefix}
                {String(batesStart).padStart(batesPadding, "0")}
                {batesSuffix}
              </p>
            </>
          )}

          {tab === "background" && (
            <>
              <div className="setting-group">
                <label className="setting-title">Background Tint Color</label>
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="color-input"
                />
              </div>
              <div className="setting-group">
                <label className="setting-title">
                  Tint Opacity ({Math.round(bgOpacity * 100)}%)
                </label>
                <input
                  type="range"
                  min="0.05"
                  max="0.8"
                  step="0.05"
                  value={bgOpacity}
                  onChange={(e) => setBgOpacity(Number(e.target.value))}
                />
              </div>
            </>
          )}

          <div
            className="setting-group"
            style={{
              marginTop: "16px",
              borderTop: "1px solid var(--border-subtle, #e0e0e0)",
              paddingTop: "12px",
            }}
          >
            <label className="setting-title">Page Scope</label>
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="radio"
                  name="pageScope"
                  checked={pageScope === "all"}
                  onChange={() => setPageScope("all")}
                />
                All Pages ({s.info?.pages || 1})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="radio"
                  name="pageScope"
                  checked={pageScope === "custom"}
                  onChange={() => setPageScope("custom")}
                />
                Custom Range
              </label>
            </div>
            {pageScope === "custom" && (
              <input
                type="text"
                placeholder="e.g. 1-3, 5"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                className="text-input"
                style={{ marginTop: "8px" }}
              />
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between" }}>
          <button
            onClick={handleRemoveDecorations}
            disabled={applying}
            className="button-secondary"
            style={{ color: "var(--accent-red, #d32f2f)" }}
            title="Remove existing decorations from document"
          >
            <Trash2 size={15} style={{ marginRight: "4px" }} />
            Remove Decorations
          </button>

          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onClose} className="button-secondary">
              Cancel
            </button>
            <button onClick={handleApply} disabled={applying} className="button-primary">
              {applying ? "Applying..." : "Apply to All Pages"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

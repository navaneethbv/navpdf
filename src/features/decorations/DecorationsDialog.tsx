import { useId, useState, useMemo } from "react";
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
import { parsePageRange } from "../pages/page-range";
import { FeatureDialog } from "../../components/FeatureDialog";

export function DecorationsDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const sourcePdf = controller?.pdf;
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

  const pageRange = useMemo(() => {
    if (pageScope === "all") return { pages: undefined, error: undefined };
    try {
      return {
        pages: parsePageRange(customRange, s.info?.pages || 1).map((page) => page + 1),
        error: undefined,
      };
    } catch (error) {
      return {
        pages: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [pageScope, customRange, s.info?.pages]);
  const parsedPageRange = pageRange.pages;
  const pageRangeError = pageRange.error;

  const hexToRgb = (hex: string): [number, number, number] => {
    const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

  const handleApply = async () => {
    if (!controller?.pdf || pageRangeError) return;
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
          { expectedSource: sourcePdf },
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
        await controller.replaceWithBytes(newBytes, `Decorations applied (${tab})`, {
          expectedSource: sourcePdf,
        });
      }

      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveDecorations = async () => {
    if (!controller?.pdf || pageRangeError) return;
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
        { expectedSource: sourcePdf },
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  };

  return (
    <FeatureDialog title="Document Decorations" onClose={onClose} busy={applying}>
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
            aria-pressed={tab === "watermark"}
            onClick={() => setTab("watermark")}
          >
            <Droplets size={15} /> Watermark
          </button>
          <button
            className={tab === "header-footer" ? "active" : ""}
            aria-pressed={tab === "header-footer"}
            onClick={() => setTab("header-footer")}
          >
            <Heading size={15} /> Header & Footer
          </button>
          <button
            className={tab === "bates" ? "active" : ""}
            aria-pressed={tab === "bates"}
            onClick={() => setTab("bates")}
          >
            <Hash size={15} /> Bates Numbers
          </button>
          <button
            className={tab === "background" ? "active" : ""}
            aria-pressed={tab === "background"}
            onClick={() => setTab("background")}
          >
            <Layers size={15} /> Background
          </button>
        </div>

        <div className="modal-body">
          {tab === "watermark" && (
            <>
              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
                  Watermark Text
                </label>
                <input
                  id={`${fieldIds}-field-1`}
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  className="text-input"
                />
              </div>
              <div className="settings-row">
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-2`} className="setting-title">
                    Font Size (pt)
                  </label>
                  <input
                    id={`${fieldIds}-field-2`}
                    type="number"
                    min={12}
                    max={120}
                    value={watermarkFontSize}
                    onChange={(e) => setWatermarkFontSize(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-3`} className="setting-title">
                    Rotation (degrees)
                  </label>
                  <select
                    id={`${fieldIds}-field-3`}
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
                  <label htmlFor={`${fieldIds}-field-4`} className="setting-title">
                    Opacity ({Math.round(watermarkOpacity * 100)}%)
                  </label>
                  <input
                    id={`${fieldIds}-field-4`}
                    type="range"
                    min="0.05"
                    max="0.8"
                    step="0.05"
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                  />
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-5`} className="setting-title">
                    Color
                  </label>
                  <input
                    id={`${fieldIds}-field-5`}
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
              <fieldset className="setting-group">
                <legend className="setting-title">Header (Top)</legend>
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
              </fieldset>

              <fieldset className="setting-group">
                <legend className="setting-title">Footer (Bottom)</legend>
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
              </fieldset>

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
                  <label htmlFor={`${fieldIds}-field-6`} className="setting-title">
                    Prefix
                  </label>
                  <input
                    id={`${fieldIds}-field-6`}
                    type="text"
                    value={batesPrefix}
                    onChange={(e) => setBatesPrefix(e.target.value)}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-7`} className="setting-title">
                    Suffix
                  </label>
                  <input
                    id={`${fieldIds}-field-7`}
                    type="text"
                    value={batesSuffix}
                    onChange={(e) => setBatesSuffix(e.target.value)}
                    className="text-input"
                  />
                </div>
              </div>

              <div className="settings-row">
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-8`} className="setting-title">
                    Start Number
                  </label>
                  <input
                    id={`${fieldIds}-field-8`}
                    type="number"
                    min={1}
                    value={batesStart}
                    onChange={(e) => setBatesStart(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-9`} className="setting-title">
                    Digits Padding
                  </label>
                  <input
                    id={`${fieldIds}-field-9`}
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
                <label htmlFor={`${fieldIds}-field-10`} className="setting-title">
                  Position on Page
                </label>
                <select
                  id={`${fieldIds}-field-10`}
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
                <label htmlFor={`${fieldIds}-field-11`} className="setting-title">
                  Background Tint Color
                </label>
                <input
                  id={`${fieldIds}-field-11`}
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="color-input"
                />
              </div>
              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-12`} className="setting-title">
                  Tint Opacity ({Math.round(bgOpacity * 100)}%)
                </label>
                <input
                  id={`${fieldIds}-field-12`}
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

          <fieldset
            className="setting-group"
            style={{
              marginTop: "16px",
              borderTop: "1px solid var(--border-subtle, #e0e0e0)",
              paddingTop: "12px",
            }}
          >
            <legend className="setting-title">Page Scope</legend>
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="radio"
                  name="pageScope"
                  checked={pageScope === "all"}
                  onChange={() => setPageScope("all")}
                />{" "}
                All Pages ({s.info?.pages || 1})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="radio"
                  name="pageScope"
                  checked={pageScope === "custom"}
                  onChange={() => setPageScope("custom")}
                />{" "}
                Custom Range
              </label>
            </div>
            {pageScope === "custom" && (
              <>
                <input
                  type="text"
                  placeholder="e.g. 1-3, 5"
                  aria-label="Custom page range"
                  value={customRange}
                  onChange={(e) => setCustomRange(e.target.value)}
                  className="text-input"
                  style={{ marginTop: "8px" }}
                />
                {pageRangeError && (
                  <p className="field-error" role="alert">
                    {pageRangeError}
                  </p>
                )}
              </>
            )}
          </fieldset>
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between" }}>
          <button
            onClick={handleRemoveDecorations}
            disabled={applying}
            className="button-secondary"
            style={{ color: "var(--accent-red, #d32f2f)" }}
            title="Remove existing decorations from document"
          >
            <Trash2 size={15} style={{ marginRight: "4px" }} /> Remove Decorations
          </button>

          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={onClose} className="button-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="button-primary"
            >
              {getApplyButtonLabel(applying, pageScope, parsedPageRange?.length ?? 0)}
            </button>
          </div>
        </div>
      </div>
    </FeatureDialog>
  );
}

function getApplyButtonLabel(
  applying: boolean,
  pageScope: "all" | "custom",
  pageCount: number,
): string {
  if (applying) return "Applying...";
  if (pageScope === "all") return "Apply to All Pages";
  return `Apply to ${pageCount} Pages`;
}

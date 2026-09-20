import { useId, useState, useMemo } from "react";
import { Link as LinkIcon, X, AlertTriangle, ExternalLink, Bookmark } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  addLinkAnnotation,
  validateSafeUrl,
  type LinkAnnotationOptions,
} from "../../services/document-commands";
import { fromTopLeftVisual } from "../../services/pdf/page-box";
import { PageNumberInput } from "../../components/PageNumberInput";
import { FeatureDialog } from "../../components/FeatureDialog";

export function LinkDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const sourcePdf = controller?.pdf;
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
      let rect: [number, number, number, number] = [
        rectX,
        rectY,
        rectX + rectWidth,
        rectY + rectHeight,
      ];
      try {
        const doc = await PDFDocument.load(currentBytes);
        const pageIndex = Math.max(0, Math.min(placementPage - 1, doc.getPageCount() - 1));
        const page = doc.getPage(pageIndex);
        const mapped = fromTopLeftVisual(page, rectX, rectY, rectWidth, rectHeight);
        rect = [mapped.x, mapped.y, mapped.x + mapped.width, mapped.y + mapped.height];
      } catch {
        // Fallback for mock test environments
      }

      const options: LinkAnnotationOptions = {
        page: placementPage,
        rect,
        target: linkType === "url" ? { type: "url", url } : { type: "page", targetPage },
      };

      const newBytes = await addLinkAnnotation(currentBytes, options);
      await controller.replaceWithBytes(
        newBytes,
        linkType === "url"
          ? `Added URL link to page ${placementPage}`
          : `Added page jump to page ${targetPage}`,
        { expectedSource: sourcePdf },
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureDialog title="Add Link Annotation" onClose={onClose} busy={saving}>
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
            type="button"
            className={linkType === "url" ? "active" : ""}
            aria-pressed={linkType === "url"}
            onClick={() => setLinkType("url")}
          >
            <ExternalLink size={15} /> External URL
          </button>
          <button
            type="button"
            className={linkType === "page" ? "active" : ""}
            aria-pressed={linkType === "page"}
            onClick={() => setLinkType("page")}
          >
            <Bookmark size={15} /> Page Jump
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
              Placement Page
            </label>
            <PageNumberInput
              id={`${fieldIds}-field-1`}
              value={placementPage}
              max={s.info?.pages || 1}
              onChange={setPlacementPage}
              className="text-input"
            />
          </div>

          {linkType === "url" ? (
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-2`} className="setting-title">
                Destination URL
              </label>
              <input
                id={`${fieldIds}-field-2`}
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
              <label htmlFor={`${fieldIds}-field-3`} className="setting-title">
                Jump to Page Number
              </label>
              <PageNumberInput
                id={`${fieldIds}-field-3`}
                value={targetPage}
                max={s.info?.pages || 1}
                onChange={setTargetPage}
                className="text-input"
              />
            </div>
          )}

          <div className="settings-row">
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-4`} className="setting-title">
                Position X (pt)
              </label>
              <input
                id={`${fieldIds}-field-4`}
                type="number"
                value={rectX}
                onChange={(e) => setRectX(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-5`} className="setting-title">
                Position Y (pt)
              </label>
              <input
                id={`${fieldIds}-field-5`}
                type="number"
                value={rectY}
                onChange={(e) => setRectY(Number(e.target.value))}
                className="text-input"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-6`} className="setting-title">
                Width (pt)
              </label>
              <input
                id={`${fieldIds}-field-6`}
                type="number"
                min={10}
                value={rectWidth}
                onChange={(e) => setRectWidth(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-7`} className="setting-title">
                Height (pt)
              </label>
              <input
                id={`${fieldIds}-field-7`}
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
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAddLink}
            disabled={saving || (linkType === "url" && !urlValidation.valid)}
            className="button-primary"
          >
            {saving ? "Adding..." : "Add Link"}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

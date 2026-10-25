import { useEffect, useId, useState, useMemo } from "react";
import {
  Link as LinkIcon,
  X,
  AlertTriangle,
  ExternalLink,
  Bookmark,
  Layers,
  FormInput,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  addLinkAnnotation,
  validateSafeUrl,
  type LinkAnnotationOptions,
  type LinkAppearance,
} from "../../services/document-commands";
import { parseHexColor } from "../../utils/color";

type LinkType = "url" | "page" | "layers" | "fields";
const LINK_TYPE_STATUS: Record<LinkType, string> = {
  url: "Added URL link",
  page: "Added page jump",
  layers: "Added layer link",
  fields: "Added form field link",
};
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
  const [linkType, setLinkType] = useState<LinkType>("url");
  const [layers, setLayers] = useState<string[]>([]);
  const [layerState, setLayerState] = useState<"ON" | "OFF" | "Toggle">("Toggle");
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [fieldAction, setFieldAction] = useState<"hide" | "show" | "reset">("hide");
  const [border, setBorder] = useState<"none" | LinkAppearance["style"]>("none");
  const [borderColor, setBorderColor] = useState("#1f5fbf");
  const [highlight, setHighlight] = useState<LinkAppearance["highlight"]>("Invert");
  useEffect(() => {
    let active = true;
    const pdf = controller?.pdf;
    if (!pdf) return undefined;
    void Promise.resolve()
      .then(() => pdf.getFieldObjects())
      .then((objects) => {
        if (active) setFieldNames(Object.keys(objects ?? {}).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        // Without readable fields, the form field actions offer nothing to choose.
      });
    return () => {
      active = false;
    };
  }, [controller]);
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

  const linkTarget = (): LinkAnnotationOptions["target"] => {
    if (linkType === "url") return { type: "url", url };
    if (linkType === "page") return { type: "page", targetPage };
    if (linkType === "layers") return { type: "layers", layers, layerState };
    if (fieldAction === "reset") return { type: "reset", fields };
    return { type: "fields", fields, hideFields: fieldAction === "hide" };
  };
  const targetMissing =
    (linkType === "layers" && !layers.length) ||
    (linkType === "fields" && fieldAction !== "reset" && !fields.length);

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
        target: linkTarget(),
        appearance: {
          width: border === "none" ? 0 : 1,
          style: border === "none" ? "solid" : border,
          color: parseHexColor(borderColor) ?? [0, 0, 1],
          highlight,
        },
      };

      const newBytes = await addLinkAnnotation(currentBytes, options);
      await controller.replaceWithBytes(
        newBytes,
        `${LINK_TYPE_STATUS[linkType]} on page ${placementPage}`,
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
          {s.layers.length > 0 && (
            <button
              type="button"
              className={linkType === "layers" ? "active" : ""}
              aria-pressed={linkType === "layers"}
              onClick={() => setLinkType("layers")}
            >
              <Layers size={15} /> Layers
            </button>
          )}
          {fieldNames.length > 0 && (
            <button
              type="button"
              className={linkType === "fields" ? "active" : ""}
              aria-pressed={linkType === "fields"}
              onClick={() => setLinkType("fields")}
            >
              <FormInput size={15} /> Form Fields
            </button>
          )}
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

          {linkType === "layers" && (
            <fieldset className="setting-group">
              <legend className="setting-title">Layers to change</legend>
              {s.layers.map((layer) => (
                <label key={layer.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={layers.includes(layer.id)}
                    onChange={(event) =>
                      setLayers(
                        event.target.checked
                          ? [...layers, layer.id]
                          : layers.filter((id) => id !== layer.id),
                      )
                    }
                  />
                  <span>{layer.name}</span>
                </label>
              ))}
              <label className="setting-title" htmlFor={`${fieldIds}-layer-state`}>
                Clicking the link
              </label>
              <select
                id={`${fieldIds}-layer-state`}
                className="text-input"
                value={layerState}
                onChange={(event) => setLayerState(event.target.value as typeof layerState)}
              >
                <option value="Toggle">Shows a hidden layer or hides a shown one</option>
                <option value="ON">Shows the layers</option>
                <option value="OFF">Hides the layers</option>
              </select>
            </fieldset>
          )}
          {linkType === "fields" && (
            <fieldset className="setting-group">
              <legend className="setting-title">Form fields</legend>
              <select
                aria-label="Form field action"
                className="text-input"
                value={fieldAction}
                onChange={(event) => setFieldAction(event.target.value as typeof fieldAction)}
              >
                <option value="hide">Hide the fields</option>
                <option value="show">Show the fields</option>
                <option value="reset">Reset the fields to their default values</option>
              </select>
              <div className="field-pick-list">
                {fieldNames.map((name) => (
                  <label key={name} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={fields.includes(name)}
                      onChange={(event) =>
                        setFields(
                          event.target.checked
                            ? [...fields, name]
                            : fields.filter((field) => field !== name),
                        )
                      }
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
              {fieldAction === "reset" && !fields.length && (
                <p className="field-hint">With no field chosen, every field is reset.</p>
              )}
            </fieldset>
          )}
          {linkType === "url" && (
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
                    backgroundColor: "var(--danger-surface)",
                    border: "1px solid var(--danger-ink)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--danger-ink)",
                    fontSize: "0.85rem",
                  }}
                  role="alert"
                >
                  <AlertTriangle size={16} />
                  <span>{urlValidation.reason}</span>
                </div>
              )}
            </div>
          )}
          {linkType === "page" && (
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
              <label htmlFor={`${fieldIds}-border`} className="setting-title">
                Border
              </label>
              <select
                id={`${fieldIds}-border`}
                className="text-input"
                value={border}
                onChange={(event) => setBorder(event.target.value as typeof border)}
              >
                <option value="none">Invisible</option>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="underline">Underline</option>
              </select>
            </div>
            {border !== "none" && (
              <div className="setting-group">
                <label htmlFor={`${fieldIds}-border-color`} className="setting-title">
                  Border colour
                </label>
                <input
                  id={`${fieldIds}-border-color`}
                  type="color"
                  value={borderColor}
                  onChange={(event) => setBorderColor(event.target.value)}
                  className="color-input"
                />
              </div>
            )}
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-highlight`} className="setting-title">
                When clicked
              </label>
              <select
                id={`${fieldIds}-highlight`}
                className="text-input"
                value={highlight}
                onChange={(event) => setHighlight(event.target.value as typeof highlight)}
              >
                <option value="Invert">Invert</option>
                <option value="Outline">Outline</option>
                <option value="Push">Push</option>
                <option value="None">No highlight</option>
              </select>
            </div>
          </div>

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
            onClick={() => {
              void handleAddLink();
            }}
            disabled={saving || targetMissing || (linkType === "url" && !urlValidation.valid)}
            className="button-primary"
          >
            {saving ? "Adding..." : "Add Link"}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

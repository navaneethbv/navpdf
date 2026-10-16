import { useEffect, useId, useState } from "react";
import { BookOpen } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import {
  readInitialView,
  writeInitialView,
  INITIAL_LAYOUTS,
  INITIAL_PANELS,
  type InitialView,
} from "../../services/pdf/initial-view";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "./use-document-edit";

const LAYOUT_LABELS = [
  "Single page",
  "Continuous pages",
  "Continuous facing pages (left)",
  "Continuous facing pages (right)",
  "Facing pages (left)",
  "Facing pages (right)",
];
const PANEL_LABELS = ["Page only", "Bookmarks", "Thumbnails", "Layers", "Attachments"];

export function InitialViewDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const [view, setView] = useState<InitialView | null>(null);
  const [loadError, setLoadError] = useState("");
  const { apply, busy, error } = useDocumentEdit(controller);
  const id = useId();
  useEffect(() => {
    let current = true;
    const source = controller?.pdf;
    if (source)
      void source
        .saveDocument()
        .then(readInitialView)
        .then((result) => {
          if (current && source === controller?.pdf) setView(result);
        })
        .catch((cause: unknown) => {
          if (current) setLoadError(errorMessage(cause));
        });
    return () => {
      current = false;
    };
  }, [controller]);
  const update = (patch: Partial<InitialView>) =>
    setView((old) => (old ? { ...old, ...patch } : old));
  const save = async () => {
    if (view && (await apply("Initial view updated", (bytes) => writeInitialView(bytes, view))))
      onClose();
  };
  return (
    <ToolDialog
      title="Initial Document View"
      icon={<BookOpen size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel="Apply View"
      onPrimary={() => void save()}
      primaryDisabled={!view}
    >
      {!view && !loadError && <output>Reading initial view...</output>}
      {view && (
        <div className="setting-group">
          <label htmlFor={`${id}-layout`}>Opening layout</label>
          <select
            id={`${id}-layout`}
            className="text-input"
            value={view.layout}
            onChange={(event) => update({ layout: event.target.value as InitialView["layout"] })}
          >
            {INITIAL_LAYOUTS.map((value, index) => (
              <option key={value} value={value}>
                {LAYOUT_LABELS[index]}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-panel`}>Opening panel</label>
          <select
            id={`${id}-panel`}
            className="text-input"
            value={view.panel}
            onChange={(event) => update({ panel: event.target.value as InitialView["panel"] })}
          >
            {INITIAL_PANELS.map((value, index) => (
              <option key={value} value={value}>
                {PANEL_LABELS[index]}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-page`}>Opening page</label>
          <input
            id={`${id}-page`}
            className="text-input"
            type="number"
            min="1"
            max={controller?.pdf?.numPages}
            value={view.page}
            onChange={(event) => update({ page: event.target.valueAsNumber })}
          />
          <label htmlFor={`${id}-fit`}>Opening magnification</label>
          <select
            id={`${id}-fit`}
            className="text-input"
            value={view.fit}
            onChange={(event) => update({ fit: event.target.value as InitialView["fit"] })}
          >
            <option value="Fit">Fit page</option>
            <option value="FitH">Fit width</option>
            <option value="XYZ">Custom zoom</option>
          </select>
          {view.fit === "XYZ" && (
            <label>
              Opening zoom (%){" "}
              <input
                className="text-input"
                type="number"
                min="10"
                max="1000"
                step="any"
                value={view.zoom}
                onChange={(event) => update({ zoom: event.target.valueAsNumber })}
              />
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={view.displayTitle}
              onChange={(event) => update({ displayTitle: event.target.checked })}
            />{" "}
            Show document title
          </label>
          <label>
            <input
              type="checkbox"
              checked={view.rightToLeft}
              onChange={(event) => update({ rightToLeft: event.target.checked })}
            />{" "}
            Right-to-left binding
          </label>
        </div>
      )}
      <p className="field-hint">
        These preferences are saved in the PDF. Readers may override them with their own settings.
        Applying replaces any existing opening action with a safe page destination.
      </p>
    </ToolDialog>
  );
}

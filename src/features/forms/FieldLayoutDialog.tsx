import { useEffect, useId, useState } from "react";
import { Move } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import {
  readWidgets,
  setWidgetGeometry,
  type WidgetGeometry,
} from "../../services/pdf/field-geometry";

/** The widget number comes first, so any field name keeps the key unambiguous. */
const keyOf = (widget: Pick<WidgetGeometry, "field" | "widget">) =>
  `${widget.widget}:${widget.field}`;

const DIMENSIONS = [
  ["x", "From left"],
  ["y", "From top"],
  ["width", "Width"],
  ["height", "Height"],
] as const;

type Draft = Record<(typeof DIMENSIONS)[number][0], string>;

const draftOf = (widget: WidgetGeometry): Draft => ({
  x: String(widget.x),
  y: String(widget.y),
  width: String(widget.width),
  height: String(widget.height),
});

export function FieldLayoutDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const [widgets, setWidgets] = useState<WidgetGeometry[] | null>(null);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Draft>({ x: "", y: "", width: "", height: "" });
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const { apply, busy, error } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const load = async () => {
      if (!controller?.pdf) return;
      const found = await readWidgets(await controller.pdf.saveDocument());
      if (!current) return;
      setWidgets(found);
      const chosen = found.find((item) => keyOf(item) === selected) ?? found[0];
      if (chosen) {
        setSelected(keyOf(chosen));
        setDraft(draftOf(chosen));
      }
    };
    load().catch((cause: unknown) => {
      if (current) setLoadError(errorMessage(cause));
    });
    return () => {
      current = false;
    };
    // Reloads only when a change is applied; choosing a field does not reread the PDF.
  }, [controller, revision]);

  const widget = widgets?.find((item) => keyOf(item) === selected);

  const choose = (key: string) => {
    setSelected(key);
    const next = widgets?.find((item) => keyOf(item) === key);
    if (next) setDraft(draftOf(next));
    setNotice("");
  };

  const submit = async () => {
    if (!widget) return;
    let scaled = false;
    const applied = await apply(`Form field "${widget.field}" moved`, async (bytes) => {
      const result = await setWidgetGeometry(bytes, {
        field: widget.field,
        widget: widget.widget,
        x: Number(draft.x),
        y: Number(draft.y),
        width: Number(draft.width),
        height: Number(draft.height),
      });
      scaled = result.scaledAppearance;
      return result.bytes;
    });
    if (!applied) return;
    setNotice(
      scaled
        ? "Field moved. Its current look is stretched to the new size until a reader redraws it."
        : "Field moved.",
    );
    setRevision((value) => value + 1);
  };

  const nothing = widgets !== null && widgets.length === 0;

  return (
    <ToolDialog
      title="Move & Resize Form Fields"
      icon={<Move size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError || (nothing ? "This PDF has no form fields." : "")}
      primaryLabel="Apply"
      busyLabel="Applying…"
      primaryDisabled={!widget}
      onPrimary={() => void submit()}
    >
      {widgets === null && !loadError && <output className="field-hint">Reading fields…</output>}
      {widgets && widgets.length > 0 && (
        <div className="setting-group">
          <label className="setting-title" htmlFor={`${ids}-field`}>
            Field
          </label>
          <select
            id={`${ids}-field`}
            className="text-input"
            value={selected}
            onChange={(event) => choose(event.target.value)}
          >
            {widgets.map((item) => (
              <option key={keyOf(item)} value={keyOf(item)}>
                {item.field}
                {item.widget > 0 ? ` (widget ${item.widget + 1})` : ""}, page {item.page}
              </option>
            ))}
          </select>
          {DIMENSIONS.map(([key, label]) => (
            <div key={key}>
              <label className="setting-title" htmlFor={`${ids}-${key}`}>
                {label} (points)
              </label>
              <input
                id={`${ids}-${key}`}
                className="text-input"
                type="number"
                step="any"
                value={draft[key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
      )}
      {notice && (
        <output className="field-hint" aria-live="polite">
          {notice}
        </output>
      )}
      <p className="field-hint">
        Positions are measured from the top-left corner of the page as displayed; 72 points make an
        inch. Field names, values and settings are unchanged.
      </p>
    </ToolDialog>
  );
}

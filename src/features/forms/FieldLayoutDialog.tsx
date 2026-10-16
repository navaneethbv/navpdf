import { Fragment, useEffect, useId, useState } from "react";
import { Move } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import {
  arrangeWidgets,
  readWidgets,
  setWidgetGeometry,
  type ArrangeOperation,
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

const ARRANGEMENTS: [ArrangeOperation, string][] = [
  ["left", "Align left edges"],
  ["right", "Align right edges"],
  ["top", "Align top edges"],
  ["bottom", "Align bottom edges"],
  ["center-horizontal", "Center horizontally"],
  ["center-vertical", "Center vertically"],
  ["distribute-horizontal", "Distribute horizontally"],
  ["distribute-vertical", "Distribute vertically"],
  ["match-width", "Match width"],
  ["match-height", "Match height"],
  ["match-size", "Match width and height"],
];

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
  const [others, setOthers] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<ArrangeOperation>("left");
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
    setOthers(new Set());
    setNotice("");
  };

  const samePage = widgets?.filter(
    (item) => widget && item.page === widget.page && keyOf(item) !== selected,
  );

  const arrange = async () => {
    if (!widget || !widgets) return;
    const chosen = [widget, ...widgets.filter((item) => others.has(keyOf(item)))];
    let scaled = false;
    const label = ARRANGEMENTS.find(([value]) => value === operation)?.[1] ?? "Arranged";
    const applied = await apply(`${label}: ${chosen.length} form fields`, async (bytes) => {
      const result = await arrangeWidgets(bytes, chosen, operation);
      scaled = result.scaledAppearance;
      return result.bytes;
    });
    if (!applied) return;
    setNotice(
      scaled
        ? "Fields arranged. Some resized fields keep a stretched look until a reader redraws them."
        : "Fields arranged.",
    );
    setRevision((value) => value + 1);
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
            <Fragment key={key}>
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
            </Fragment>
          ))}
        </div>
      )}
      {samePage && samePage.length > 0 && (
        <fieldset className="preset-list">
          <legend className="setting-title">
            Arrange with other fields on page {widget?.page}
          </legend>
          <p className="field-hint">
            The field chosen above is the anchor. Distributing needs at least three fields.
          </p>
          {samePage.map((item) => (
            <label key={keyOf(item)} className="checkbox-row">
              <input
                type="checkbox"
                checked={others.has(keyOf(item))}
                onChange={(event) =>
                  setOthers((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(keyOf(item));
                    else next.delete(keyOf(item));
                    return next;
                  })
                }
              />
              <span>
                {item.field}
                {item.widget > 0 ? ` (widget ${item.widget + 1})` : ""}
              </span>
            </label>
          ))}
          <label className="setting-title" htmlFor={`${ids}-arrange`}>
            Arrangement
          </label>
          <select
            id={`${ids}-arrange`}
            className="text-input"
            value={operation}
            onChange={(event) => setOperation(event.target.value as ArrangeOperation)}
          >
            {ARRANGEMENTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button-secondary"
            disabled={busy || others.size < (operation.startsWith("distribute") ? 2 : 1)}
            onClick={() => void arrange()}
          >
            Arrange Fields
          </button>
        </fieldset>
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

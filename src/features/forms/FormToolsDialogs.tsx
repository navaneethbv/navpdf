import { useEffect, useId, useState } from "react";
import { ScanSearch, SlidersHorizontal } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { addFormFields } from "../../services/document-commands";
import {
  colorFromHex,
  duplicateFieldToPages,
  hexFromColor,
  readFieldProperties,
  readTabOrder,
  renameFields,
  setTabOrder,
  updateFieldProperties,
  type FieldProperties,
  type TabOrder,
} from "../../services/pdf/form-authoring";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import { parsePageRange } from "../pages/page-range";
import {
  candidateDefinitions,
  detectFieldCandidates,
  suggestFieldNames,
  type FieldCandidate,
  type NameSuggestion,
} from "./field-detection";

interface Draft {
  newName: string;
  tooltip: string;
  fontSize: string;
  alignment: "left" | "center" | "right";
  maxLength: string;
  comb: boolean;
  border: string;
  fill: string;
  locked: boolean;
  hidden: boolean;
}

const draftOf = (field: FieldProperties): Draft => ({
  newName: field.name,
  tooltip: field.tooltip,
  fontSize: field.fontSize === null ? "" : String(field.fontSize),
  alignment: field.alignment ?? "left",
  maxLength: field.maxLength === null ? "" : String(field.maxLength),
  comb: field.comb,
  border: hexFromColor(field.borderColor),
  fill: hexFromColor(field.fillColor),
  locked: field.locked,
  hidden: field.hidden,
});

const TAB_ORDERS: [TabOrder, string][] = [
  [null, "Unspecified (reader default)"],
  ["R", "Row order"],
  ["C", "Column order"],
  ["S", "Document structure"],
];

/** Name, tooltip, appearance, locking, duplication and page tab order for form fields. */
/** A number from a text box, or null when it is blank. */
const optionalNumber = (text: string) => (text.trim() ? Number(text) : null);

export function FieldPropertiesDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const [fields, setFields] = useState<FieldProperties[] | null>(null);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tabOrderValue, setTabOrderValue] = useState<TabOrder | "mixed">(null);
  const [duplicatePages, setDuplicatePages] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const { apply, busy, error } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const source = controller?.pdf;
    if (source)
      void source
        .saveDocument()
        .then(
          async (bytes) => [await readFieldProperties(bytes), await readTabOrder(bytes)] as const,
        )
        .then(([found, order]) => {
          if (!current || source !== controller?.pdf) return;
          setFields(found);
          setTabOrderValue(order);
          const chosen = found.find((field) => field.name === selected) ?? found[0];
          if (chosen) {
            setSelected(chosen.name);
            setDraft(draftOf(chosen));
          }
        })
        .catch((cause: unknown) => {
          if (current) setLoadError(errorMessage(cause));
        });
    return () => {
      current = false;
    };
    // Reloads after an applied change; choosing another field does not reread the PDF.
  }, [controller, revision]);

  const field = fields?.find((item) => item.name === selected);
  const update = (patch: Partial<Draft>) => setDraft((old) => (old ? { ...old, ...patch } : old));
  const changed = (message: string) => {
    setNotice(message);
    setRevision((value) => value + 1);
  };

  const save = async () => {
    if (!field || !draft) return;
    let rebuilt = true;
    const applied = await apply(`Form field "${field.name}" properties updated`, async (bytes) => {
      const result = await updateFieldProperties(bytes, field.name, {
        newName: draft.newName.trim(),
        tooltip: draft.tooltip,
        fontSize: optionalNumber(draft.fontSize),
        alignment: field.kind === "text" ? draft.alignment : undefined,
        maxLength: field.kind === "text" ? optionalNumber(draft.maxLength) : undefined,
        comb: field.kind === "text" ? draft.comb : undefined,
        borderColor: draft.border ? colorFromHex(draft.border) : null,
        fillColor: draft.fill ? colorFromHex(draft.fill) : null,
        locked: draft.locked,
        hidden: draft.hidden,
      });
      rebuilt = result.appearanceRebuilt;
      return result.bytes;
    });
    if (!applied) return;
    setSelected(draft.newName.trim().split(".").pop() ?? field.name);
    changed(
      rebuilt
        ? "Field properties saved."
        : "Field properties saved. Readers will redraw values the built-in font cannot show.",
    );
  };

  const duplicate = async () => {
    if (!field) return;
    let pages: number[];
    try {
      pages = parsePageRange(duplicatePages, controller?.pdf?.numPages ?? 0);
    } catch (cause) {
      setNotice(errorMessage(cause));
      return;
    }
    if (
      await apply(`Form field "${field.name}" duplicated`, (bytes) =>
        duplicateFieldToPages(bytes, field.name, pages),
      )
    )
      changed(`Added "${field.name}" to ${pages.length} page(s); all copies share one value.`);
  };

  const saveTabOrder = async (order: TabOrder) => {
    if (await apply("Tab order updated", (bytes) => setTabOrder(bytes, order)))
      changed("Tab order saved for every page.");
  };

  return (
    <ToolDialog
      title="Form Field Properties"
      icon={<SlidersHorizontal size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError || (fields && !fields.length ? "This PDF has no form fields." : "")}
      primaryLabel="Save Properties"
      busyLabel="Saving…"
      primaryDisabled={!field || !draft}
      onPrimary={() => void save()}
    >
      {!fields && !loadError && <output className="field-hint">Reading fields…</output>}
      {fields && fields.length > 0 && draft && field && (
        <>
          <div className="setting-group">
            <label className="setting-title" htmlFor={`${id}-field`}>
              Field
            </label>
            <select
              id={`${id}-field`}
              className="text-input"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                const next = fields.find((item) => item.name === event.target.value);
                if (next) setDraft(draftOf(next));
                setNotice("");
              }}
            >
              {fields.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} ({item.kind})
                </option>
              ))}
            </select>
            <label className="setting-title" htmlFor={`${id}-name`}>
              Name
            </label>
            <input
              id={`${id}-name`}
              className="text-input"
              value={draft.newName}
              onChange={(event) => update({ newName: event.target.value })}
            />
            <label className="setting-title" htmlFor={`${id}-tooltip`}>
              Tooltip
            </label>
            <input
              id={`${id}-tooltip`}
              className="text-input"
              value={draft.tooltip}
              onChange={(event) => update({ tooltip: event.target.value })}
            />
          </div>
          <div className="form-columns">
            <label className="setting-title">
              <span>Font size (blank keeps it, 0 is automatic)</span>
              <input
                className="text-input"
                type="number"
                min="0"
                max="144"
                step="any"
                value={draft.fontSize}
                onChange={(event) => update({ fontSize: event.target.value })}
              />
            </label>
            {field.kind === "text" && (
              <label className="setting-title">
                <span>Alignment</span>
                <select
                  className="text-input"
                  value={draft.alignment}
                  onChange={(event) =>
                    update({ alignment: event.target.value as Draft["alignment"] })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </select>
              </label>
            )}
            {field.kind === "text" && (
              <label className="setting-title">
                <span>Maximum characters (blank for no limit)</span>
                <input
                  className="text-input"
                  type="number"
                  min="1"
                  step="1"
                  value={draft.maxLength}
                  onChange={(event) => update({ maxLength: event.target.value })}
                />
              </label>
            )}
            <label className="setting-title">
              <span>Border colour</span>
              <span className="inline-field">
                <input
                  type="color"
                  aria-label="Border colour"
                  value={draft.border || "#000000"}
                  onChange={(event) => update({ border: event.target.value })}
                />
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => update({ border: "" })}
                >
                  None
                </button>
              </span>
            </label>
            <label className="setting-title">
              <span>Fill colour</span>
              <span className="inline-field">
                <input
                  type="color"
                  aria-label="Fill colour"
                  value={draft.fill || "#ffffff"}
                  onChange={(event) => update({ fill: event.target.value })}
                />
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => update({ fill: "" })}
                >
                  None
                </button>
              </span>
            </label>
          </div>
          {field.kind === "text" && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.comb}
                onChange={(event) => update({ comb: event.target.checked })}
              />
              <span>Space characters evenly into boxes (comb)</span>
            </label>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.locked}
              onChange={(event) => update({ locked: event.target.checked })}
            />
            <span>Lock the field against moving and editing its properties</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.hidden}
              onChange={(event) => update({ hidden: event.target.checked })}
            />
            <span>Hidden (not shown or printed)</span>
          </label>
          <fieldset className="preset-list">
            <legend className="setting-title">Duplicate across pages</legend>
            <div className="inline-field">
              <input
                aria-label="Pages to add the field to"
                className="text-input"
                placeholder="2-5"
                value={duplicatePages}
                onChange={(event) => setDuplicatePages(event.target.value)}
              />
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !duplicatePages.trim()}
                onClick={() => void duplicate()}
              >
                Duplicate
              </button>
            </div>
          </fieldset>
          <fieldset className="preset-list">
            <legend className="setting-title">Tab order on every page</legend>
            <select
              aria-label="Tab order"
              className="text-input"
              value={tabOrderValue ?? ""}
              disabled={busy}
              onChange={(event) => void saveTabOrder((event.target.value || null) as TabOrder)}
            >
              {tabOrderValue === "mixed" && <option value="mixed">Mixed (pages differ)</option>}
              {TAB_ORDERS.map(([value, label]) => (
                <option key={label} value={value ?? ""}>
                  {label}
                </option>
              ))}
            </select>
          </fieldset>
        </>
      )}
      {notice && (
        <output className="field-hint" aria-live="polite">
          {notice}
        </output>
      )}
    </ToolDialog>
  );
}

/** Detects blank lines and boxes as new fields, or names existing fields from nearby labels. */
export function FormAssistDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const [mode, setMode] = useState<"detect" | "name">("detect");
  const [candidates, setCandidates] = useState<FieldCandidate[] | null>(null);
  const [suggestions, setSuggestions] = useState<NameSuggestion[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState("");
  const { apply, busy, error } = useDocumentEdit(controller);

  const scan = async () => {
    const source = controller?.pdf;
    if (!source) return;
    setWorking(true);
    setLoadError("");
    try {
      const bytes = await source.saveDocument();
      if (mode === "detect") {
        const found = await detectFieldCandidates(source, bytes);
        setCandidates(found);
        setChosen(new Set(found.map((_, index) => index)));
      } else {
        const found = await suggestFieldNames(source, bytes);
        setSuggestions(found);
        setChosen(new Set(found.map((_, index) => index)));
      }
    } catch (cause) {
      setLoadError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    setCandidates(null);
    setSuggestions(null);
    void scan();
  }, [controller, mode]);

  const toggle = (index: number, on: boolean) =>
    setChosen((old) => {
      const next = new Set(old);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  const applyChosen = async () => {
    if (mode === "detect" && candidates) {
      const picked = candidates.filter((_, index) => chosen.has(index));
      if (
        await apply(`Created ${picked.length} form field(s)`, (bytes) =>
          addFormFields(bytes, candidateDefinitions(picked)),
        )
      )
        onClose();
    } else if (suggestions) {
      const picked = suggestions.filter((_, index) => chosen.has(index));
      if (
        await apply(`Renamed ${picked.length} form field(s)`, (bytes) =>
          renameFields(
            bytes,
            picked.map(({ field, suggested }) => ({ from: field, to: suggested })),
          ),
        )
      )
        onClose();
    }
  };

  const rows =
    mode === "detect"
      ? (candidates ?? []).map(
          (item) =>
            `${item.name} (${item.kind === "text" ? "text" : "check box"}, page ${item.page})`,
        )
      : (suggestions ?? []).map((item) => `${item.field} → ${item.suggested}`);

  return (
    <ToolDialog
      title="Detect & Name Fields"
      icon={<ScanSearch size={18} />}
      onClose={onClose}
      busy={busy || working}
      error={error || loadError}
      primaryLabel={mode === "detect" ? "Create Fields" : "Rename Fields"}
      busyLabel={working ? "Reading…" : "Applying…"}
      primaryDisabled={chosen.size === 0}
      onPrimary={() => void applyChosen()}
    >
      <fieldset className="preset-list">
        <legend className="setting-title">Task</legend>
        <label className="preset-option">
          <input
            type="radio"
            name={`${id}-mode`}
            checked={mode === "detect"}
            onChange={() => setMode("detect")}
          />
          <span>Find fields from blank lines (_____) and boxes (☐)</span>
        </label>
        <label className="preset-option">
          <input
            type="radio"
            name={`${id}-mode`}
            checked={mode === "name"}
            onChange={() => setMode("name")}
          />
          <span>Name existing fields from the labels beside or above them</span>
        </label>
      </fieldset>
      {working && <output className="field-hint">Reading the text layer…</output>}
      {!working && rows.length === 0 && (candidates ?? suggestions) && (
        <p className="field-hint">
          {mode === "detect" ? "No new fields were found." : "No better names were found."}
        </p>
      )}
      {rows.length > 0 && (
        <ul
          className="check-list"
          aria-label={mode === "detect" ? "Fields found" : "Suggested names"}
        >
          {rows.map((label, index) => (
            <li key={label}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={chosen.has(index)}
                  onChange={(event) => toggle(index, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint">
        Suggestions come from the text layer, so scanned forms need OCR first. Review each one;
        created fields can be moved and resized afterwards.
      </p>
    </ToolDialog>
  );
}

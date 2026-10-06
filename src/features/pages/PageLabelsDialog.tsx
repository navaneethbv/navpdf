import { useEffect, useId, useMemo, useState } from "react";
import { ListOrdered, Plus, Trash2 } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import {
  previewLabels,
  readPageLabelsFromBytes,
  setPageLabels,
  validateRanges,
  type LabelStyle,
  type PageLabelRange,
} from "../../services/pdf/page-labels";

const STYLE_OPTIONS: [LabelStyle, string][] = [
  ["decimal", "1, 2, 3"],
  ["roman-lower", "i, ii, iii"],
  ["roman-upper", "I, II, III"],
  ["letters-lower", "a, b, c"],
  ["letters-upper", "A, B, C"],
  ["none", "Prefix only"],
];

const DEFAULT_RANGE: PageLabelRange = {
  startPage: 1,
  style: "decimal",
  prefix: "",
  firstNumber: 1,
};

interface Row {
  key: string;
  range: PageLabelRange;
}

const row = (range: PageLabelRange): Row => ({ key: crypto.randomUUID(), range });

function RangeRow({
  range,
  index,
  pageCount,
  onChange,
  onRemove,
}: Readonly<{
  range: PageLabelRange;
  index: number;
  pageCount: number;
  onChange: (range: PageLabelRange) => void;
  onRemove: () => void;
}>) {
  const ids = useId();
  const whole = (value: string, fallback: number) => Math.trunc(Number(value) || fallback);
  return (
    <fieldset className="preset-list">
      <legend className="setting-title">Range {index + 1}</legend>
      <label className="setting-title" htmlFor={`${ids}-start`}>
        Starts on page
      </label>
      <input
        id={`${ids}-start`}
        className="text-input"
        type="number"
        min={1}
        max={pageCount}
        value={range.startPage}
        disabled={index === 0}
        onChange={(event) => onChange({ ...range, startPage: whole(event.target.value, 1) })}
      />
      <label className="setting-title" htmlFor={`${ids}-style`}>
        Style
      </label>
      <select
        id={`${ids}-style`}
        className="text-input"
        value={range.style}
        onChange={(event) => onChange({ ...range, style: event.target.value as LabelStyle })}
      >
        {STYLE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label className="setting-title" htmlFor={`${ids}-prefix`}>
        Prefix
      </label>
      <input
        id={`${ids}-prefix`}
        className="text-input"
        value={range.prefix}
        maxLength={40}
        placeholder="e.g. A-"
        onChange={(event) => onChange({ ...range, prefix: event.target.value })}
      />
      <label className="setting-title" htmlFor={`${ids}-first`}>
        Start numbering at
      </label>
      <input
        id={`${ids}-first`}
        className="text-input"
        type="number"
        min={1}
        value={range.firstNumber}
        disabled={range.style === "none"}
        onChange={(event) => onChange({ ...range, firstNumber: whole(event.target.value, 1) })}
      />
      {index > 0 && (
        <button type="button" className="button-secondary" onClick={onRemove}>
          <Trash2 size={14} /> Remove range {index + 1}
        </button>
      )}
    </fieldset>
  );
}

export function PageLabelsDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const [rows, setRows] = useState<Row[]>(() => [row(DEFAULT_RANGE)]);
  const ranges = useMemo(() => rows.map((item) => item.range), [rows]);
  const [pageCount, setPageCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const { apply, busy, error } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const load = async () => {
      if (!controller?.pdf) return;
      try {
        const existing = await readPageLabelsFromBytes(await controller.pdf.saveDocument());
        if (!current) return;
        setPageCount(existing.pageCount);
        if (existing.ranges.length) setRows(existing.ranges.map(row));
      } catch (cause) {
        if (current) setLoadError(errorMessage(cause));
      }
    };
    load().catch(() => setLoadError("The current page labels could not be read."));
    return () => {
      current = false;
    };
  }, [controller]);

  const check = useMemo(() => {
    if (!pageCount) return { error: "" };
    try {
      validateRanges(ranges, pageCount);
      return { error: "", preview: previewLabels(ranges, pageCount) };
    } catch (cause) {
      return { error: errorMessage(cause) };
    }
  }, [pageCount, ranges]);

  const update = (key: string, range: PageLabelRange) =>
    setRows((current) => current.map((item) => (item.key === key ? { key, range } : item)));
  const addRange = () =>
    setRows((current) => {
      const last = Math.max(...current.map((item) => item.range.startPage));
      return [...current, row({ ...DEFAULT_RANGE, startPage: Math.min(pageCount, last + 1) })];
    });

  const submit = async (next: PageLabelRange[]) => {
    const status = next.length ? "Page labels updated" : "Page labels removed";
    if (await apply(status, (bytes) => setPageLabels(bytes, next))) onClose();
  };

  const preview = check.preview ?? [];
  const shown = preview.slice(0, 12).join(", ");

  return (
    <ToolDialog
      title="Page Labels"
      icon={<ListOrdered size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError || check.error}
      primaryLabel="Apply Labels"
      busyLabel="Applying…"
      primaryDisabled={!pageCount || Boolean(check.error)}
      onPrimary={() => void submit(ranges)}
      secondary={
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !pageCount}
          onClick={() => void submit([])}
        >
          Use Plain Numbers
        </button>
      }
    >
      <p className="field-hint">
        Labels change the page numbers readers display, such as roman numerals for front matter.
        Pages keep their order.
      </p>
      {rows.map((item, index) => (
        <RangeRow
          key={item.key}
          range={item.range}
          index={index}
          pageCount={pageCount}
          onChange={(next) => update(item.key, next)}
          onRemove={() => setRows((current) => current.filter((other) => other.key !== item.key))}
        />
      ))}
      <button
        type="button"
        className="button-secondary"
        onClick={addRange}
        disabled={!pageCount || rows.length >= pageCount}
      >
        <Plus size={14} /> Add Range
      </button>
      {shown && (
        <output className="field-hint" aria-live="polite">
          Preview: {shown}
          {preview.length > 12 ? ", …" : ""}
        </output>
      )}
    </ToolDialog>
  );
}

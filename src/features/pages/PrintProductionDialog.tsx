import { useId, useState } from "react";
import { Printer } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { ENGINE_UNAVAILABLE, prepressDocument } from "../../services/engine";
import { native } from "../../services/native";
import { useWorkspace } from "../../stores/workspace";
import type { ColorTarget, PrepressEdit, PrepressReport } from "../../types/engine";
import type { DocumentToolProps } from "../tools/document-tools";
import { useDocumentEdit } from "../document/use-document-edit";
import { parsePageRange } from "./page-range";

type Task = "marks" | "hairlines" | "colors";

const TASKS: [Task, string][] = [
  ["marks", "Printer marks"],
  ["hairlines", "Fix hairlines"],
  ["colors", "Convert colours"],
];

const MARKS = [
  ["trimMarks", "Trim marks at the corners of the trim box"],
  ["bleedMarks", "Bleed marks (dashed) at the bleed box"],
  ["registrationMarks", "Registration targets on each side"],
  ["colorBars", "Colour bar (cyan, magenta, yellow, black and three greys)"],
  ["pageInformation", "Page information (file name, page number and date)"],
] as const;
type MarkKey = (typeof MARKS)[number][0];

/** The 1-based pages a range names, or none for a blank range, which means every page. */
function pagesOf(range: string, total: number) {
  return range.trim() ? parsePageRange(range, total).map((index) => index + 1) : [];
}

class NothingChanged extends Error {}

/** Printer marks, hairline widening and device colour conversion, run by the local engine. */
export function PrintProductionDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const name = useWorkspace((state) => state.document?.name ?? "");
  const [task, setTask] = useState<Task>("marks");
  const [range, setRange] = useState("");
  const [marks, setMarks] = useState<Record<MarkKey, boolean>>({
    trimMarks: true,
    bleedMarks: false,
    registrationMarks: true,
    colorBars: false,
    pageInformation: false,
  });
  const [weight, setWeight] = useState("0.25");
  const [threshold, setThreshold] = useState("0.216");
  const [width, setWidth] = useState("0.72");
  const [target, setTarget] = useState<ColorTarget>("gray");
  const [images, setImages] = useState(true);
  const [report, setReport] = useState<PrepressReport | null>(null);
  const { apply, busy, error, setError } = useDocumentEdit(controller);
  const total = controller?.pdf?.numPages ?? 0;

  const run = async (build: () => PrepressEdit, status: string) => {
    setReport(null);
    let outcome: PrepressReport | null = null;
    const applied = await apply(status, async (bytes) => {
      const result = await prepressDocument(bytes, build());
      outcome = result.report;
      // Nothing to record in the undo history when the engine changed nothing.
      if (!result.bytes) throw new NothingChanged(result.report.message);
      return { bytes: result.bytes, status: result.report.message };
    });
    if (applied || outcome) {
      setError("");
      setReport(outcome);
    }
  };

  const edit = (): PrepressEdit => {
    const pages = pagesOf(range, total);
    if (task === "hairlines")
      return { kind: "fixHairlines", threshold: Number(threshold), width: Number(width), pages };
    if (task === "colors") return { kind: "convertColors", target, images, pages };
    return {
      kind: "addPrinterMarks",
      options: {
        ...marks,
        weight: Number(weight),
        fileName: name,
        date: new Date().toISOString().slice(0, 10),
      },
      pages,
    };
  };

  const labels: Record<Task, [string, string]> = {
    marks: ["Add Marks", "Printer marks added"],
    hairlines: ["Fix Hairlines", "Hairlines widened"],
    colors: ["Convert Colours", "Colours converted"],
  };

  return (
    <ToolDialog
      title="Print Production"
      icon={<Printer size={18} />}
      onClose={onClose}
      busy={busy}
      error={error}
      primaryLabel={labels[task][0]}
      primaryDisabled={!native || (task === "marks" && !Object.values(marks).some(Boolean))}
      onPrimary={() => void run(edit, labels[task][1])}
      secondary={
        task === "marks" ? (
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !native}
            onClick={() =>
              void run(() => ({ kind: "removePrinterMarks" }), "Printer marks removed")
            }
          >
            Remove Marks
          </button>
        ) : undefined
      }
    >
      <fieldset className="preset-list">
        <legend className="setting-title">Task</legend>
        {TASKS.map(([value, label]) => (
          <label key={value} className="checkbox-row">
            <input
              type="radio"
              name={`${id}-task`}
              checked={task === value}
              onChange={() => {
                setTask(value);
                setReport(null);
                setError("");
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {task === "marks" && (
        <fieldset className="preset-list">
          <legend className="setting-title">Marks</legend>
          {MARKS.map(([key, label]) => (
            <label key={key} className="checkbox-row">
              <input
                type="checkbox"
                checked={marks[key]}
                onChange={(event) => setMarks({ ...marks, [key]: event.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="setting-title" htmlFor={`${id}-weight`}>
            Line weight
          </label>
          <select
            id={`${id}-weight`}
            className="select-input"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          >
            <option value="0.25">0.25 pt</option>
            <option value="0.5">0.5 pt</option>
            <option value="1">1 pt</option>
          </select>
          <p className="field-hint">
            Marks are drawn outside the trim box in the registration colour, which prints on every
            plate. A page without 36 points of room around its trim box grows to hold them, and its
            trim box keeps the finished size. Adding marks again replaces them; Remove Marks puts
            each page back as it was.
          </p>
        </fieldset>
      )}

      {task === "hairlines" && (
        <fieldset className="preset-list">
          <legend className="setting-title">Hairlines</legend>
          <label className="setting-title" htmlFor={`${id}-threshold`}>
            Widen strokes thinner than (points)
          </label>
          <input
            id={`${id}-threshold`}
            className="text-input"
            type="number"
            min="0.01"
            max="72"
            step="any"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <label className="setting-title" htmlFor={`${id}-width`}>
            New width (points)
          </label>
          <input
            id={`${id}-width`}
            className="text-input"
            type="number"
            min="0.01"
            max="72"
            step="any"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
          />
          <p className="field-hint">
            Widths are measured on the page, after scaling; zero-width lines are always widened. The
            defaults are 0.003 and 0.01 inch. Strokes in comments, form fields, patterns and Type 3
            fonts are not changed, and a drawing reused at several sizes is measured at the first
            size it is drawn at.
          </p>
        </fieldset>
      )}

      {task === "colors" && (
        <fieldset className="preset-list">
          <legend className="setting-title">Convert to</legend>
          <select
            aria-label="Convert to"
            className="select-input"
            value={target}
            onChange={(event) => setTarget(event.target.value as ColorTarget)}
          >
            <option value="gray">Greyscale</option>
            <option value="rgb">RGB</option>
            <option value="cmyk">CMYK</option>
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={images}
              onChange={(event) => setImages(event.target.checked)}
            />
            <span>Also convert pictures</span>
          </label>
          <p className="field-hint">
            Colours are converted with the standard device formulas; no ICC profile is applied, so
            this is not a colour-managed conversion. Grey and black go to black ink alone in CMYK.
            Spot, indexed, Lab and pattern colours, shadings, inline images and the colours of
            comments and form fields are left as they are and counted below.
          </p>
        </fieldset>
      )}

      <label className="setting-title" htmlFor={`${id}-pages`}>
        Pages (leave empty for every page)
      </label>
      <input
        id={`${id}-pages`}
        className="text-input"
        type="text"
        placeholder={total ? `For example: 1-${total}` : "For example: 1-3, 5"}
        value={range}
        onChange={(event) => setRange(event.target.value)}
      />

      {!native && <p className="field-hint">{ENGINE_UNAVAILABLE}</p>}
      {report && (
        <output className="field-hint" aria-live="polite">
          {report.message}
          {report.leftAlone.length > 0 && (
            <>
              {" "}
              Left as they were:
              <ul aria-label="Left unchanged">
                {report.leftAlone.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </output>
      )}
    </ToolDialog>
  );
}

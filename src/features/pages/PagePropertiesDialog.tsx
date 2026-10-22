import { useEffect, useId, useState } from "react";
import { Frame } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { useWorkspace } from "../../stores/workspace";
import {
  PRINT_BOXES,
  TRANSITION_STYLES,
  readPageBoxes,
  readPageTransitions,
  setPageTransition,
  setPrintBox,
  type BoxMargins,
  type PageBoxInfo,
  type PageTransition,
  type PrintBox,
} from "../../services/pdf/page-properties";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import { parsePageRange } from "./page-range";

type Setting = PrintBox | "transition";

const SETTING_LABELS: Record<Setting, string> = {
  TrimBox: "Trim box (finished page size)",
  BleedBox: "Bleed box (printing area beyond the trim)",
  ArtBox: "Art box (meaningful content)",
  transition: "Full-screen page transition",
};

const SIDES = ["top", "right", "bottom", "left"] as const;

const DEFAULT_TRANSITION: PageTransition = {
  style: "Dissolve",
  duration: 1,
  direction: 0,
  dimension: "H",
  motion: "I",
  advanceAfter: null,
};

const describe = (value: number[] | null | undefined) =>
  value ? `${value[0]}, ${value[1]} to ${value[2]}, ${value[3]}` : "not set";

export function PagePropertiesDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const page = useWorkspace((state) => state.page);
  const total = controller?.pdf?.numPages ?? 0;
  const [setting, setSetting] = useState<Setting>("TrimBox");
  const [scope, setScope] = useState<"all" | "current" | "custom">("all");
  const [range, setRange] = useState("");
  const [margins, setMargins] = useState<Record<keyof BoxMargins, string>>({
    top: "9",
    right: "9",
    bottom: "9",
    left: "9",
  });
  const [transition, setTransition] = useState<PageTransition>(DEFAULT_TRANSITION);
  const [advance, setAdvance] = useState("");
  const [remove, setRemove] = useState(false);
  const [boxes, setBoxes] = useState<PageBoxInfo[] | null>(null);
  const [transitions, setTransitions] = useState<(PageTransition | null)[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const { apply, busy, error, setError } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const source = controller?.pdf;
    if (source)
      void source
        .saveDocument()
        .then(
          async (bytes) => [await readPageBoxes(bytes), await readPageTransitions(bytes)] as const,
        )
        .then(([foundBoxes, foundTransitions]) => {
          if (!current || source !== controller?.pdf) return;
          setBoxes(foundBoxes);
          setTransitions(foundTransitions);
        })
        .catch((cause: unknown) => {
          if (current) setLoadError(errorMessage(cause));
        });
    return () => {
      current = false;
    };
  }, [controller, revision]);

  const pages = (): number[] => parsePageRange(scope, range, page, total);

  const save = async () => {
    let chosen: number[];
    try {
      chosen = pages();
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    const count = `${chosen.length} page${chosen.length === 1 ? "" : "s"}`;
    let applied: boolean;
    if (setting === "transition") {
      const advanceAfter = advance.trim() === "" ? null : Number(advance);
      applied = await apply(
        remove
          ? `Removed transitions from ${count}`
          : `Set ${transition.style} transition on ${count}`,
        (bytes) =>
          setPageTransition(bytes, chosen, remove ? null : { ...transition, advanceAfter }),
      );
    } else {
      const values = Object.fromEntries(
        SIDES.map((side) => [side, Number(margins[side])]),
      ) as unknown as BoxMargins;
      applied = await apply(
        remove ? `Removed ${setting} from ${count}` : `Set ${setting} on ${count}`,
        (bytes) => setPrintBox(bytes, chosen, setting, remove ? null : values),
      );
    }
    if (applied) setRevision((value) => value + 1);
  };

  const current = boxes?.[page - 1];
  const currentTransition = transitions?.[page - 1];
  return (
    <ToolDialog
      title="Page Boxes & Transitions"
      icon={<Frame size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel={remove ? "Remove" : "Apply"}
      busyLabel="Applying…"
      primaryDisabled={!boxes || (scope === "custom" && !range.trim())}
      onPrimary={() => void save()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${id}-setting`}>
          Setting
        </label>
        <select
          id={`${id}-setting`}
          className="text-input"
          value={setting}
          onChange={(event) => setSetting(event.target.value as Setting)}
        >
          {[...PRINT_BOXES, "transition" as const].map((value) => (
            <option key={value} value={value}>
              {SETTING_LABELS[value]}
            </option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${id}-scope`}>
          Pages
        </label>
        <select
          id={`${id}-scope`}
          className="text-input"
          value={scope}
          onChange={(event) => setScope(event.target.value as typeof scope)}
        >
          <option value="all">All pages</option>
          <option value="current">Current page ({page})</option>
          <option value="custom">Page range</option>
        </select>
        {scope === "custom" && (
          <input
            aria-label="Page range"
            className="text-input"
            placeholder="1-3, 5"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          />
        )}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={remove}
            onChange={(event) => setRemove(event.target.checked)}
          />
          <span>Remove this setting from the pages</span>
        </label>
      </div>
      {!remove && setting !== "transition" && (
        <fieldset className="preset-list">
          <legend className="setting-title">Margins inside the media box (points)</legend>
          <div className="form-columns">
            {SIDES.map((side) => (
              <label key={side} className="setting-title">
                {side[0].toUpperCase() + side.slice(1)}
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="any"
                  value={margins[side]}
                  onChange={(event) =>
                    setMargins((old) => ({ ...old, [side]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!remove && setting === "transition" && (
        <fieldset className="preset-list">
          <legend className="setting-title">Transition</legend>
          <label className="setting-title">
            Effect{" "}
            <select
              className="text-input"
              value={transition.style}
              onChange={(event) =>
                setTransition((old) => ({
                  ...old,
                  style: event.target.value as PageTransition["style"],
                }))
              }
            >
              {TRANSITION_STYLES.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-title">
            Effect length (seconds){" "}
            <input
              className="text-input"
              type="number"
              min="0.1"
              max="10"
              step="any"
              value={transition.duration}
              onChange={(event) =>
                setTransition((old) => ({ ...old, duration: event.target.valueAsNumber }))
              }
            />
          </label>
          <label className="setting-title">
            Direction{" "}
            <select
              className="text-input"
              value={transition.direction}
              onChange={(event) =>
                setTransition((old) => ({
                  ...old,
                  direction: Number(event.target.value) as PageTransition["direction"],
                }))
              }
            >
              <option value={0}>Left to right</option>
              <option value={90}>Bottom to top</option>
              <option value={180}>Right to left</option>
              <option value={270}>Top to bottom</option>
            </select>
          </label>
          <label className="setting-title">
            Advance to the next page after (seconds, blank to wait){" "}
            <input
              className="text-input"
              type="number"
              min="0"
              step="any"
              value={advance}
              onChange={(event) => setAdvance(event.target.value)}
            />
          </label>
        </fieldset>
      )}
      {current && (
        <p className="field-hint">
          Page {page}: trim {describe(current.trim)}; bleed {describe(current.bleed)}; art{" "}
          {describe(current.art)}; transition {currentTransition?.style ?? "none"}.
        </p>
      )}
      <p className="field-hint">
        Margins apply to the page as displayed. Print boxes describe the page for print production
        and do not hide content; use Crop Page Boxes to change what is shown. Transitions play in
        readers that support full-screen presentation; NavPDF stores them but does not animate them.
      </p>
    </ToolDialog>
  );
}

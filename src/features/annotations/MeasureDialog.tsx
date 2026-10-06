import { useId, useState } from "react";
import { Ruler } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import {
  UNIT_NAMES,
  scaleLabel,
  type MeasureKind,
  type MeasureScale,
  type MeasureUnit,
} from "../../services/pdf/measure";

const KINDS: [MeasureKind, string][] = [
  ["distance", "Distance"],
  ["perimeter", "Perimeter"],
  ["area", "Area"],
];

export function MeasureDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const saved = useWorkspace((state) => state.measureScale);
  const [kind, setKind] = useState<MeasureKind>(useWorkspace.getState().measureKind);
  const [pageInches, setPageInches] = useState(String(saved.pageInches));
  const [realValue, setRealValue] = useState(String(saved.realValue));
  const [unit, setUnit] = useState<MeasureUnit>(saved.unit);

  const scale: MeasureScale = {
    pageInches: Number(pageInches),
    realValue: Number(realValue),
    unit,
  };
  const valid = scale.pageInches > 0 && scale.realValue > 0;

  const start = () => {
    useWorkspace.getState().set({ measureKind: kind, measureScale: scale, activeModal: null });
    controller?.setTool("measure");
    onClose();
  };

  return (
    <ToolDialog
      title="Measure"
      icon={<Ruler size={18} />}
      onClose={onClose}
      error={valid ? "" : "Enter positive numbers on both sides of the scale."}
      primaryLabel="Start Measuring"
      primaryDisabled={!valid || !controller?.pdf}
      onPrimary={start}
    >
      <fieldset className="preset-list">
        <legend className="setting-title">Measure</legend>
        {KINDS.map(([value, label]) => (
          <label key={value} className="preset-option">
            <input
              type="radio"
              name={`${ids}-kind`}
              checked={kind === value}
              onChange={() => setKind(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="preset-list">
        <legend className="setting-title">Scale</legend>
        <label className="setting-title" htmlFor={`${ids}-page`}>
          Inches on the page
        </label>
        <input
          id={`${ids}-page`}
          className="text-input"
          type="number"
          min="0"
          step="any"
          value={pageInches}
          onChange={(event) => setPageInches(event.target.value)}
        />
        <label className="setting-title" htmlFor={`${ids}-real`}>
          Equal this many
        </label>
        <input
          id={`${ids}-real`}
          className="text-input"
          type="number"
          min="0"
          step="any"
          value={realValue}
          onChange={(event) => setRealValue(event.target.value)}
        />
        <label className="setting-title" htmlFor={`${ids}-unit`}>
          Unit
        </label>
        <select
          id={`${ids}-unit`}
          className="text-input"
          value={unit}
          onChange={(event) => setUnit(event.target.value as MeasureUnit)}
        >
          {Object.entries(UNIT_NAMES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {valid && <p className="field-hint">Scale: {scaleLabel(scale)}</p>}
      </fieldset>
      <p className="field-hint">
        Measurements are saved as annotations with their scale, so other PDF readers show the same
        values. Use 1 inch = 1 inch for actual size.
      </p>
    </ToolDialog>
  );
}

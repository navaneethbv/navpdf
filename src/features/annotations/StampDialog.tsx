import { useId, useState } from "react";
import { Stamp } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { useDocumentEdit } from "../document/use-document-edit";
import {
  STAMP_POSITIONS,
  STANDARD_STAMPS,
  addStamp,
  type StampPosition,
  type StampTone,
  type StandardStampName,
} from "../../services/pdf/stamps";

const POSITION_LABELS: Record<StampPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  center: "Center",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

const SIZES = { Small: 140, Medium: 190, Large: 260 } as const;

export function StampDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const page = useWorkspace((state) => state.page);
  const pages = useWorkspace((state) => state.info?.pages ?? 1);
  const [stamp, setStamp] = useState<StandardStampName | "Custom">("Approved");
  const [label, setLabel] = useState("");
  const [tone, setTone] = useState<StampTone>("blue");
  const [reviewer, setReviewer] = useState("");
  const [includeDate, setIncludeDate] = useState(true);
  const [position, setPosition] = useState<StampPosition>("top-right");
  const [size, setSize] = useState<keyof typeof SIZES>("Medium");
  const [target, setTarget] = useState(page);
  const { apply, busy, error } = useDocumentEdit(controller);

  const detail = [reviewer.trim(), includeDate ? new Date().toLocaleDateString("en-CA") : ""]
    .filter(Boolean)
    .join(", ");
  const customMissing = stamp === "Custom" && !label.trim();

  const submit = async () => {
    const applied = await apply(`Stamp added to page ${target}`, (bytes) =>
      addStamp(bytes, {
        page: target,
        stamp,
        label,
        tone: stamp === "Custom" ? tone : undefined,
        detail,
        position,
        width: SIZES[size],
        author: reviewer,
      }),
    );
    if (applied) onClose();
  };

  return (
    <ToolDialog
      title="Add Stamp"
      icon={<Stamp size={18} />}
      onClose={onClose}
      busy={busy}
      error={error}
      primaryLabel="Add Stamp"
      busyLabel="Adding…"
      primaryDisabled={customMissing || !controller?.pdf}
      onPrimary={() => void submit()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-stamp`}>
          Stamp
        </label>
        <select
          id={`${ids}-stamp`}
          className="text-input"
          value={stamp}
          onChange={(event) => setStamp(event.target.value as StandardStampName | "Custom")}
        >
          {Object.entries(STANDARD_STAMPS).map(([name, { label: text }]) => (
            <option key={name} value={name}>
              {text}
            </option>
          ))}
          <option value="Custom">Custom text…</option>
        </select>
      </div>
      {stamp === "Custom" && (
        <div className="setting-group">
          <label className="setting-title" htmlFor={`${ids}-label`}>
            Stamp text
          </label>
          <input
            id={`${ids}-label`}
            className="text-input"
            value={label}
            maxLength={40}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Paid"
          />
          <label className="setting-title" htmlFor={`${ids}-tone`}>
            Color
          </label>
          <select
            id={`${ids}-tone`}
            className="text-input"
            value={tone}
            onChange={(event) => setTone(event.target.value as StampTone)}
          >
            <option value="blue">Blue</option>
            <option value="green">Green</option>
            <option value="red">Red</option>
          </select>
        </div>
      )}
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-reviewer`}>
          Reviewer name (optional)
        </label>
        <input
          id={`${ids}-reviewer`}
          className="text-input"
          value={reviewer}
          maxLength={60}
          onChange={(event) => setReviewer(event.target.value)}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeDate}
            onChange={(event) => setIncludeDate(event.target.checked)}
          />
          <span>Add today&apos;s date</span>
        </label>
        {detail && <p className="field-hint">Second line: {detail}</p>}
      </div>
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-position`}>
          Position
        </label>
        <select
          id={`${ids}-position`}
          className="text-input"
          value={position}
          onChange={(event) => setPosition(event.target.value as StampPosition)}
        >
          {STAMP_POSITIONS.map((value) => (
            <option key={value} value={value}>
              {POSITION_LABELS[value]}
            </option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${ids}-size`}>
          Size
        </label>
        <select
          id={`${ids}-size`}
          className="text-input"
          value={size}
          onChange={(event) => setSize(event.target.value as keyof typeof SIZES)}
        >
          {Object.keys(SIZES).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${ids}-page`}>
          Page
        </label>
        <input
          id={`${ids}-page`}
          className="text-input"
          type="number"
          min={1}
          max={pages}
          value={target}
          onChange={(event) =>
            setTarget(Math.min(pages, Math.max(1, Math.trunc(Number(event.target.value) || 1))))
          }
        />
      </div>
      <p className="field-hint">
        Stamps are review markup that any PDF reader shows. They are not signatures.
      </p>
    </ToolDialog>
  );
}

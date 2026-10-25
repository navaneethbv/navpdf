import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { ActionStep, SavedAction } from "../../types/document";
import { STEP_LABELS, newStep } from "./run-action";

const MAX_STEPS = 20;
const PDFA_LEVELS = ["2b", "2u", "2a", "3b", "3u", "3a"] as const;

function TextOption({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  const id = useId();
  return (
    <div className="action-option">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="text-input"
        value={value}
        maxLength={256}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function NumberOption({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}>) {
  const id = useId();
  return (
    <div className="action-option">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        className="text-input"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) =>
          onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))
        }
      />
    </div>
  );
}

function SelectOption<T extends string>({
  label,
  value,
  options,
  onChange,
}: Readonly<{ label: string; value: T; options: readonly T[]; onChange: (value: T) => void }>) {
  const id = useId();
  return (
    <div className="action-option">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="text-input"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The options a step offers, if any. */
function StepOptions({
  step,
  onChange,
}: Readonly<{ step: ActionStep; onChange: (step: ActionStep) => void }>) {
  switch (step.kind) {
    case "watermark":
      return (
        <>
          <TextOption
            label="Text"
            value={step.text}
            onChange={(text) => onChange({ ...step, text })}
          />
          <NumberOption
            label="Opacity (%)"
            value={Math.round(step.opacity * 100)}
            min={5}
            max={100}
            onChange={(value) => onChange({ ...step, opacity: value / 100 })}
          />
          <NumberOption
            label="Font size"
            value={step.fontSize}
            min={6}
            max={200}
            onChange={(fontSize) => onChange({ ...step, fontSize })}
          />
        </>
      );
    case "headerFooter":
      return (
        <>
          <TextOption
            label="Header"
            value={step.header}
            onChange={(header) => onChange({ ...step, header })}
          />
          <TextOption
            label="Footer"
            value={step.footer}
            onChange={(footer) => onChange({ ...step, footer })}
          />
          <p className="field-hint">
            Use {"{page}"}, {"{total}"}, {"{date}"}, {"{title}"} and {"{author}"}.
          </p>
        </>
      );
    case "metadata":
      return (
        <>
          <TextOption
            label="Title"
            value={step.title}
            onChange={(title) => onChange({ ...step, title })}
          />
          <TextOption
            label="Author"
            value={step.author}
            onChange={(author) => onChange({ ...step, author })}
          />
          <TextOption
            label="Subject"
            value={step.subject}
            onChange={(subject) => onChange({ ...step, subject })}
          />
          <TextOption
            label="Keywords"
            value={step.keywords}
            onChange={(keywords) => onChange({ ...step, keywords })}
          />
          <p className="field-hint">Empty fields keep each document&apos;s own value.</p>
        </>
      );
    case "compress":
      return (
        <SelectOption
          label="Preset"
          value={step.preset}
          options={["lossless", "balanced", "small"] as const}
          onChange={(preset) => onChange({ ...step, preset })}
        />
      );
    case "ocr":
      return (
        <>
          <TextOption
            label="Language"
            value={step.language}
            onChange={(language) => onChange({ ...step, language })}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={step.skipTextPages}
              onChange={(event) => onChange({ ...step, skipTextPages: event.target.checked })}
            />
            <span>Skip pages that already have text</span>
          </label>
        </>
      );
    case "pdfa":
      return (
        <SelectOption
          label="Level"
          value={step.level}
          options={PDFA_LEVELS}
          onChange={(level) => onChange({ ...step, level })}
        />
      );
    default:
      return null;
  }
}

/** Edits an action's name and steps; nothing is saved until Save Action. */
export function ActionEditor({
  initial,
  language,
  busy,
  onSave,
  onCancel,
}: Readonly<{
  initial: SavedAction;
  language: string;
  busy: boolean;
  onSave: (action: SavedAction) => void;
  onCancel: () => void;
}>) {
  const ids = useId();
  const [name, setName] = useState(initial.name);
  const [steps, setSteps] = useState<{ key: string; step: ActionStep }[]>(() =>
    initial.steps.map((step) => ({ key: crypto.randomUUID(), step })),
  );
  const [adding, setAdding] = useState<ActionStep["kind"]>("removeHidden");

  const removeStep = (key: string) =>
    setSteps((current) => current.filter((item) => item.key !== key));
  const changeStep = (key: string, step: ActionStep) =>
    setSteps((current) => current.map((item) => (item.key === key ? { key, step } : item)));
  const move = (index: number, offset: number) =>
    setSteps((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + offset, 0, item);
      return next;
    });

  return (
    <section className="action-editor" aria-label="Edit action">
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-name`}>
          Action name
        </label>
        <input
          id={`${ids}-name`}
          className="text-input"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <ol className="action-steps">
        {steps.map(({ key, step }, index) => (
          <li key={key} className="action-step">
            <div className="action-step-header">
              <strong>
                {index + 1}. {STEP_LABELS[step.kind]}
              </strong>
              <span className="action-step-buttons">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move step ${index + 1} earlier`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move step ${index + 1} later`}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => removeStep(key)}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
            <StepOptions step={step} onChange={(changed) => changeStep(key, changed)} />
          </li>
        ))}
      </ol>
      <div className="action-add">
        <label htmlFor={`${ids}-add`}>Add a step</label>
        <select
          id={`${ids}-add`}
          className="text-input"
          value={adding}
          onChange={(event) => setAdding(event.target.value as ActionStep["kind"])}
        >
          {(Object.keys(STEP_LABELS) as ActionStep["kind"][]).map((kind) => (
            <option key={kind} value={kind}>
              {STEP_LABELS[kind]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button-secondary"
          disabled={steps.length >= MAX_STEPS}
          onClick={() =>
            setSteps((current) => [
              ...current,
              { key: crypto.randomUUID(), step: newStep(adding, language) },
            ])
          }
        >
          Add Step
        </button>
      </div>
      <div className="tag-actions">
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel Editing
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={busy || !name.trim() || !steps.length}
          onClick={() =>
            onSave({ id: initial.id, name: name.trim(), steps: steps.map((item) => item.step) })
          }
        >
          Save Action
        </button>
      </div>
    </section>
  );
}

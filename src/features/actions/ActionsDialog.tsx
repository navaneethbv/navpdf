import { useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import { native, savePreferences } from "../../services/native";
import { useDocumentEdit } from "../document/use-document-edit";
import { createZip } from "../convert/ooxml";
import { downloadBlob } from "../../utils/download";
import { mapInOrder } from "../../utils/async-sequence";
import { uniqueName } from "../../utils/unique-name";
import type { SavedAction } from "../../types/document";
import { ActionEditor } from "./ActionEditor";
import { BUILT_IN_ACTIONS, STEP_LABELS, describeStep, runAction } from "./run-action";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

interface FileOutcome {
  id: string;
  name: string;
  bytes: Uint8Array | null;
  notes: string[];
  error?: string;
}

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function outputName(name: string, action: string, used: Set<string>) {
  const base = `${name.replace(/\.pdf$/i, "") || "Document"} (${action})`;
  return uniqueName((copy) => (copy === 1 ? `${base}.pdf` : `${base} ${copy}.pdf`), used);
}

/** Saves the processed files as one ZIP archive and returns the status to show. */
async function saveOutcomes(done: FileOutcome[], action: string) {
  const used = new Set<string>();
  const entries = done.flatMap((outcome) =>
    outcome.bytes ? [{ name: outputName(outcome.name, action, used), data: outcome.bytes }] : [],
  );
  if (!entries.length) throw new Error("No file was processed successfully.");
  const saved = await downloadBlob(
    new Blob([createZip(entries)], { type: "application/zip" }),
    `${action}-${Date.now()}.zip`,
  );
  return saved ? `Saved ${entries.length} processed PDF(s) in a ZIP archive` : "Save cancelled";
}

/** Stable keys for an action's steps: a step and how many identical steps come before it. */
function stepKeys(steps: SavedAction["steps"]) {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const text = JSON.stringify(step);
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return [`${text}#${count}`, step] as const;
  });
}

export function ActionsDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const s = useWorkspace();
  const saved = s.local.preferences.actions;
  const actions = [...BUILT_IN_ACTIONS, ...saved];
  const [selectedId, setSelectedId] = useState(actions[0].id);
  const [editing, setEditing] = useState<SavedAction | null>(null);
  const [target, setTarget] = useState<"document" | "files">(
    controller?.pdf ? "document" : "files",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [problem, setProblem] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const cancelled = useRef(false);
  const { apply, busy, error } = useDocumentEdit(controller);
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0];
  const builtIn = BUILT_IN_ACTIONS.some((action) => action.id === selected.id);
  const language = s.local.preferences.ocrLanguage;

  const storeActions = async (next: SavedAction[], status: string) => {
    setSavingAction(true);
    setProblem("");
    try {
      const preferences = { ...useWorkspace.getState().local.preferences, actions: next };
      await savePreferences(preferences);
      useWorkspace.getState().set({
        local: { ...useWorkspace.getState().local, preferences },
        status,
      });
      return true;
    } catch (cause) {
      setProblem(errorText(cause));
      return false;
    } finally {
      setSavingAction(false);
    }
  };

  const saveEdited = async (action: SavedAction) => {
    const exists = saved.some((item) => item.id === action.id);
    const next = exists
      ? saved.map((item) => (item.id === action.id ? action : item))
      : [...saved, action];
    if (await storeActions(next, `Saved the action "${action.name}"`)) {
      setEditing(null);
      setSelectedId(action.id);
    }
  };

  const remove = async () => {
    if (builtIn) return;
    if (
      await storeActions(
        saved.filter((item) => item.id !== selected.id),
        `Deleted "${selected.name}"`,
      )
    )
      setSelectedId(BUILT_IN_ACTIONS[0].id);
  };

  const stepProgress = (file: string) => ({
    name: file,
    cancelled: () => cancelled.current,
    onStep: (index: number) =>
      setProgress(
        `${file}: step ${index + 1} of ${selected.steps.length}, ${STEP_LABELS[selected.steps[index].kind]}`,
      ),
    onProgress: (detail: string) =>
      setProgress((current) => `${current.split(" (")[0]} (${detail})`),
  });

  const runOnDocument = async () => {
    cancelled.current = false;
    setRunning(true);
    setOutcomes([]);
    try {
      let notes: string[] = [];
      await apply(`Ran "${selected.name}"`, async (bytes) => {
        const result = await runAction(
          bytes,
          selected,
          stepProgress(s.document?.name ?? "Document"),
        );
        notes = result.notes;
        const detail = notes.length ? `. ${notes.join(" ")}` : "";
        return { bytes: result.bytes, status: `Ran "${selected.name}"${detail}` };
      });
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const processFile = async (file: File): Promise<FileOutcome> => {
    const id = crypto.randomUUID();
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("Files are limited to 200 MB.");
      const result = await runAction(
        new Uint8Array(await file.arrayBuffer()),
        selected,
        stepProgress(file.name),
      );
      return { id, name: file.name, bytes: result.bytes, notes: result.notes };
    } catch (cause) {
      return { id, name: file.name, bytes: null, notes: [], error: errorText(cause) };
    }
  };

  const runOnFiles = async () => {
    cancelled.current = false;
    setRunning(true);
    setProblem("");
    setOutcomes([]);
    const done: FileOutcome[] = [];
    try {
      for await (const outcome of mapInOrder(files, processFile)) {
        if (cancelled.current) break;
        done.push(outcome);
        setOutcomes([...done]);
      }
      if (cancelled.current) s.set({ status: "The action was cancelled. Nothing was saved." });
      else s.set({ status: await saveOutcomes(done, selected.name) });
    } catch (cause) {
      setProblem(errorText(cause));
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const working = running || busy || savingAction;
  const canRun = target === "document" ? !!controller?.pdf : files.length > 0;

  return (
    <ToolDialog
      title="Guided Actions"
      icon={<ListChecks size={18} />}
      onClose={onClose}
      busy={working}
      error={problem || error}
      primaryLabel={target === "document" ? "Run on This Document" : "Run & Save ZIP"}
      busyLabel="Running…"
      primaryDisabled={!native || !canRun || !!editing}
      onPrimary={() => void (target === "document" ? runOnDocument() : runOnFiles())}
      secondary={
        running && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              cancelled.current = true;
              setProgress("Cancelling after the current step…");
            }}
          >
            Cancel Action
          </button>
        )
      }
    >
      <p className="field-hint">
        An action runs its steps in order on this device. Run it on the open document as one
        undoable change, or on several files, which are saved as copies in a ZIP archive and left
        unchanged.
      </p>
      {!native && <p className="error-text">Guided actions require the desktop app.</p>}

      {editing ? (
        <ActionEditor
          initial={editing}
          language={language}
          busy={savingAction}
          onSave={(action) => void saveEdited(action)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="setting-group">
            <label className="setting-title" htmlFor="guided-action">
              Action
            </label>
            <select
              id="guided-action"
              className="text-input"
              value={selected.id}
              disabled={working}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setOutcomes([]);
              }}
            >
              <optgroup label="Built in">
                {BUILT_IN_ACTIONS.map((action) => (
                  <option key={action.id} value={action.id}>
                    {action.name}
                  </option>
                ))}
              </optgroup>
              {saved.length > 0 && (
                <optgroup label="Saved">
                  {saved.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <ol className="action-guide" aria-label="Steps">
            {stepKeys(selected.steps).map(([key, step]) => (
              <li key={key}>
                <strong>{STEP_LABELS[step.kind]}</strong>
                <span className="field-hint"> {describeStep(step)}</span>
              </li>
            ))}
          </ol>
          <div className="tag-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={working}
              onClick={() => setEditing({ id: crypto.randomUUID(), name: "New action", steps: [] })}
            >
              New Action
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={working}
              onClick={() =>
                setEditing(
                  builtIn
                    ? { ...selected, id: crypto.randomUUID(), name: `${selected.name} (copy)` }
                    : selected,
                )
              }
            >
              {builtIn ? "Copy and Edit" : "Edit"}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={working || builtIn}
              onClick={() => void remove()}
            >
              Delete
            </button>
          </div>

          <fieldset className="setting-group" disabled={working}>
            <legend className="setting-title">Run on</legend>
            <label className="checkbox-row">
              <input
                type="radio"
                name="action-target"
                checked={target === "document"}
                disabled={!controller?.pdf}
                onChange={() => setTarget("document")}
              />
              <span>This document</span>
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                name="action-target"
                checked={target === "files"}
                onChange={() => setTarget("files")}
              />
              <span>Several files (up to {MAX_FILES})</span>
            </label>
            {target === "files" && (
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                aria-label="PDF files"
                onChange={(event) => {
                  const chosen = [...(event.target.files ?? [])];
                  event.target.value = "";
                  setProblem(chosen.length > MAX_FILES ? `Choose at most ${MAX_FILES} files.` : "");
                  setFiles(chosen.slice(0, MAX_FILES));
                  setOutcomes([]);
                }}
              />
            )}
            {target === "files" && files.length > 0 && (
              <p className="field-hint">{files.length} file(s) selected.</p>
            )}
          </fieldset>
        </>
      )}
      {progress && <output className="field-hint">{progress}</output>}
      {outcomes.length > 0 && (
        <ul className="check-list" aria-label="Action results">
          {outcomes.map((outcome) => (
            <li key={outcome.id} className={outcome.error ? "failed" : "passed"}>
              {outcome.name}: {outcome.error ?? (outcome.notes.join(" ") || "Done")}
            </li>
          ))}
        </ul>
      )}
    </ToolDialog>
  );
}

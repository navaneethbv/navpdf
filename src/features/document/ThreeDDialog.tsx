import { useEffect, useId, useState } from "react";
import { Box } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "./use-document-edit";
import { useWorkspace } from "../../stores/workspace";
import {
  add3dModel,
  extract3dModel,
  list3dModels,
  type ModelEntry,
} from "../../services/pdf/three-d";
import { downloadBytes, safeFileName } from "../../utils/download";
import { formatBytes } from "../compress/CompressDialog";

function viewPlural(count: number) {
  return count === 1 ? "" : "s";
}

/** 3D models: those the document has, saved as files, and new ones added with a poster. */
export function ThreeDDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const page = useWorkspace((s) => s.page);
  const revision = useWorkspace((s) => s.revision);
  const { apply, busy, error } = useDocumentEdit(controller);
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [model, setModel] = useState<File | null>(null);
  const [poster, setPoster] = useState<File | null>(null);
  const [box, setBox] = useState({ x: "72", y: "200", width: "320", height: "240" });
  const [activation, setActivation] = useState<"click" | "page-open">("click");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const pdf = controller?.pdf;
    if (!pdf) return;
    let alive = true;
    void pdf
      .saveDocument()
      .then(list3dModels)
      .then((found) => alive && setModels(found))
      .catch((cause: unknown) => alive && setLoadError(errorMessage(cause)));
    return () => {
      alive = false;
    };
  }, [controller, revision]);

  const save = async (index: number) => {
    try {
      const pdf = controller?.pdf;
      if (!pdf) return;
      const extracted = await extract3dModel(await pdf.saveDocument(), index);
      if (!extracted) {
        setLoadError("That 3D model no longer exists.");
        return;
      }
      const { bytes, extension } = extracted;
      const name = useWorkspace.getState().document?.name ?? "document.pdf";
      await downloadBytes(
        bytes,
        safeFileName(`${name.replace(/\.pdf$/i, "")}-3d-${index + 1}.${extension}`),
      );
    } catch (cause) {
      setLoadError(errorMessage(cause));
    }
  };

  const add = async () => {
    if (!model) return;
    const modelBytes = new Uint8Array(await model.arrayBuffer());
    const posterType: "png" | "jpg" = poster?.type === "image/png" ? "png" : "jpg";
    const posterInput = poster
      ? { bytes: new Uint8Array(await poster.arrayBuffer()), type: posterType }
      : null;
    const x = Number(box.x);
    const y = Number(box.y);
    const saved = await apply("3D model added", (bytes) =>
      add3dModel(bytes, {
        page,
        rect: [x, y, x + Number(box.width), y + Number(box.height)],
        model: modelBytes,
        poster: posterInput,
        activation,
        description,
      }),
    );
    if (saved) {
      setModel(null);
      setPoster(null);
    }
  };

  return (
    <ToolDialog
      title="3D Models"
      icon={<Box size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel="Add 3D Model"
      busyLabel="Adding…"
      primaryDisabled={!model}
      onPrimary={() => void add()}
    >
      <section aria-label="3D models in this document">
        <h4>In this document</h4>
        {!models && !loadError && <output>Reading 3D content…</output>}
        {models && !models.length && <p className="field-hint">This document has no 3D models.</p>}
        {models && models.length > 0 && (
          <ul className="check-list">
            {models.map((entry, index) => (
              <li key={`${entry.page}-${entry.name}`}>
                Page {entry.page}: {entry.format} model, {formatBytes(entry.storedBytes)} stored
                {entry.views ? `, ${entry.views} named view${viewPlural(entry.views)}` : ""}
                {entry.description ? `. ${entry.description}` : ""}
                {entry.script && (
                  <strong> It asks readers to run JavaScript; NavPDF never runs it.</strong>
                )}{" "}
                <button type="button" className="button-secondary" onClick={() => void save(index)}>
                  Save model
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint">
          NavPDF shows a 3D model&apos;s poster but does not display or rotate the model itself. A
          saved model opens in a 3D viewer of your choice; NavPDF never opens it.
        </p>
      </section>
      <section aria-label="Add a 3D model">
        <h4>Add to page {page}</h4>
        <label className="setting-title" htmlFor={`${id}-model`}>
          U3D or PRC model
        </label>
        <input
          id={`${id}-model`}
          type="file"
          accept=".u3d,.prc,model/u3d,model/prc"
          disabled={busy}
          onChange={(event) => setModel(event.target.files?.[0] ?? null)}
        />
        <label className="setting-title" htmlFor={`${id}-poster`}>
          Poster picture (optional)
        </label>
        <input
          id={`${id}-poster`}
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(event) => setPoster(event.target.files?.[0] ?? null)}
        />
        <div className="inline-field">
          {(
            [
              ["x", "From left (pt)"],
              ["y", "From bottom (pt)"],
              ["width", "Width (pt)"],
              ["height", "Height (pt)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}{" "}
              <input
                className="text-input"
                type="number"
                min={key === "width" || key === "height" ? 10 : 0}
                value={box[key]}
                disabled={busy}
                onChange={(event) => setBox({ ...box, [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <label>
          Activate{" "}
          <select
            value={activation}
            disabled={busy}
            onChange={(event) => setActivation(event.target.value as "click" | "page-open")}
          >
            <option value="click">When clicked</option>
            <option value="page-open">When the page opens</option>
          </select>
        </label>
        <label>
          Description{" "}
          <input
            className="text-input"
            value={description}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p className="field-hint">
          The file is checked to be U3D or PRC from its contents and stored as is, up to 100 MB.
          Without a poster, a labelled frame shows where the model is.
        </p>
      </section>
    </ToolDialog>
  );
}

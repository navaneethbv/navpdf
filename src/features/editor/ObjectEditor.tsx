import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Image as ImageIcon,
  RefreshCw,
  Replace,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { native } from "../../services/native";
import { editPage, ENGINE_UNAVAILABLE, inspectPage } from "../../services/engine";
import type { EditReport, EditRequest, PageObjects } from "../../types/engine";
import { placePageBoxes, type ViewerLike } from "../redact/redaction-marks";

/** Largest replacement image edge; larger images are scaled down before embedding. */
const MAX_IMAGE_EDGE = 4096;

export async function decodeImageFile(file: File, maxEdge = MAX_IMAGE_EDGE) {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Choose a PNG or JPEG image.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be decoded.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const data = context.getImageData(0, 0, width, height).data;
  return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ObjectEditor({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const ids = useId();
  const [scan, setScan] = useState<PageObjects | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [report, setReport] = useState<EditReport | null>(null);
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = scan?.objects.find((object) => object.id === selectedId) ?? null;
  const viewer = controller?.viewer as unknown as ViewerLike | undefined;
  const pdf = controller?.pdf;
  const page = s.page;

  const scanPage = useCallback(async () => {
    if (!pdf || !native) return;
    setWorking(true);
    try {
      const result = await inspectPage(await pdf.saveDocument(), page);
      setScan(result);
      setSelectedId(null);
    } catch (error) {
      s.set({ error: errorText(error) });
    } finally {
      setWorking(false);
    }
    // The store setter is stable; the scan depends on the active revision and page.
  }, [pdf, page]);

  useEffect(() => {
    void scanPage();
  }, [scanPage]);

  useEffect(
    () =>
      placePageBoxes(
        viewer,
        selected && scan
          ? [{ page: scan.page, rect: selected.bbox, className: "object-edit-box" }]
          : [],
      ),
    [viewer, selected, scan, s.zoom, s.renderedPages],
  );

  const run = async (request: EditRequest, rgba?: Uint8Array) => {
    if (!controller?.pdf || !scan) return;
    setWorking(true);
    setReport(null);
    try {
      controller.editor?.commitOrRemove();
      const result = await editPage(await controller.pdf.saveDocument(), scan.page, request, rgba);
      setReport(result.report);
      if (result.bytes) {
        await controller.replaceWithBytes(result.bytes, result.report.message);
        const rescanned = await inspectPage(await controller.pdf.saveDocument(), scan.page);
        setScan(rescanned);
        setSelectedId(null);
      }
    } catch (error) {
      s.set({ error: errorText(error) });
    } finally {
      setWorking(false);
    }
  };

  const replaceImage = async (file: File) => {
    if (!selected) return;
    try {
      const { width, height, rgba } = await decodeImageFile(file);
      await run({ type: "replaceImage", objectId: selected.id, width, height }, rgba);
    } catch (error) {
      s.set({ error: errorText(error) });
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Existing Content"
    >
      <div className="modal-dialog wide">
        <div className="modal-header">
          <div className="modal-title">
            <Replace size={18} />
            <h3>Edit Existing Content</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {!native && (
            <div className="warning-banner">
              <AlertTriangle size={18} />
              <span>{ENGINE_UNAVAILABLE}</span>
            </div>
          )}
          <p className="field-hint">
            Replace text in its existing font without reflowing the paragraph, delete text or
            images, or replace an image on this page only. Text in composite or Type 3 fonts, and
            characters missing from an embedded font subset, are refused instead of substituted.
          </p>
          <div className="object-editor-layout">
            <div className="object-list" role="listbox" aria-label={`Objects on page ${page}`}>
              <div className="inline-field">
                <span className="setting-title">
                  Page {page}: {scan?.objects.length ?? 0}{" "}
                  {scan?.objects.length === 1 ? "object" : "objects"}
                </span>
                <button
                  className="icon-button"
                  onClick={() => void scanPage()}
                  aria-label="Scan page again"
                  disabled={working}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              {scan?.objects.map((object) => (
                <button
                  key={object.id}
                  role="option"
                  aria-selected={object.id === selectedId}
                  className={`object-row ${object.id === selectedId ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedId(object.id);
                    setText(object.text ?? "");
                    setReport(null);
                  }}
                >
                  {object.kind === "text" ? <Type size={14} /> : <ImageIcon size={14} />}
                  <span>
                    {object.kind === "text"
                      ? object.text
                      : `Image ${object.pixelWidth ?? "?"}×${object.pixelHeight ?? "?"} px${object.shared ? " (shared)" : ""}`}
                  </span>
                </button>
              ))}
            </div>
            <div className="object-details">
              {!selected && <p className="field-hint">Select an object to edit it.</p>}
              {selected?.kind === "text" && (
                <>
                  <p className="field-hint">
                    {selected.font ?? "Unknown font"}, {selected.fontSize?.toFixed(1)} pt
                  </p>
                  {selected.reason && <p className="error-text">{selected.reason}</p>}
                  <label className="setting-title" htmlFor={`${ids}-text`}>
                    Replacement text
                  </label>
                  <input
                    id={`${ids}-text`}
                    className="text-input"
                    value={text}
                    disabled={!selected.replaceable || working}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <div className="inline-field">
                    <button
                      className="button-secondary"
                      disabled={!selected.replaceable || working || !text}
                      onClick={() =>
                        void run({
                          type: "replaceText",
                          objectId: selected.id,
                          text,
                          preview: true,
                        })
                      }
                    >
                      Preview Width
                    </button>
                    <button
                      className="button-primary"
                      disabled={!selected.replaceable || working || !text}
                      onClick={() => void run({ type: "replaceText", objectId: selected.id, text })}
                    >
                      Replace Text
                    </button>
                  </div>
                </>
              )}
              {selected?.kind === "image" && (
                <>
                  {selected.shared && (
                    <p className="field-hint">
                      This image is also used elsewhere; replacing it changes this page only.
                    </p>
                  )}
                  {selected.reason && <p className="error-text">{selected.reason}</p>}
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void replaceImage(file);
                    }}
                  />
                  <button
                    className="button-primary"
                    disabled={!selected.replaceable || working}
                    onClick={() => fileInput.current?.click()}
                  >
                    <ImageIcon size={15} /> Replace Image…
                  </button>
                </>
              )}
              {selected && (
                <button
                  className="button-secondary"
                  disabled={working}
                  onClick={() => void run({ type: "deleteObject", objectId: selected.id })}
                >
                  <Trash2 size={15} /> Delete {selected.kind === "text" ? "Text" : "Image"}
                </button>
              )}
              {report && (
                <p
                  className={
                    report.applied || report.missingCharacters.length === 0
                      ? "field-hint"
                      : "error-text"
                  }
                  role="status"
                >
                  {report.message}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

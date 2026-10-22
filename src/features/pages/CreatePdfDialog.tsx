import { mapInOrder } from "../../utils/async-sequence";
import { expandImageInput } from "./extended-image-import";
import { useId, useState, useRef, useEffect } from "react";
import { FilePlus, Combine, Check, X, ArrowUp, ArrowDown, ClipboardPaste } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import {
  createBlankDocument,
  extractPages,
  mergeDocuments,
} from "../../services/document-commands";
import { textToPdf } from "./text-to-pdf";
import { createZip } from "../convert/ooxml";
import { downloadBlob } from "../../utils/download";
import { uniqueName } from "../../utils/unique-name";
import { parsePageRange } from "./page-range";
import type { MergeInputItem } from "../../types/operations";
import { imageFileToPdf, isImageFile } from "./image-import";
import { FeatureDialog } from "../../components/FeatureDialog";
import { ImageMarginCrop } from "./ImageMarginCrop";
import { trimImageMargins } from "./image-crop";

export interface CombineEntry {
  id: string;
  file: File;
  range: string;
  croppedFile?: File;
  cropSelected?: boolean;
  cropStatus?: string;
}

const isPastedImage = (type: string) => type === "image/png" || type === "image/jpeg";

export function CreatePdfDialog({
  onLoad,
  onClose,
  initialTab = "blank",
}: Readonly<{
  initialTab?: "blank" | "combine" | "text";
  onLoad: (file: File) => void;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const s = useWorkspace();
  const [tab, setTab] = useState<"blank" | "combine" | "text">(initialTab);
  const [text, setText] = useState("");
  const [monospace, setMonospace] = useState(false);
  const [fontSize, setFontSize] = useState(11);
  const [separately, setSeparately] = useState(false);
  const textFileRef = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageSize, setPageSize] = useState<"a4" | "letter">("a4");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [cropping, setCropping] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const batchCancelled = useRef(false);
  const busy = creating || cropping || batchRunning;
  const [items, setItems] = useState<CombineEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      batchCancelled.current = true;
    },
    [],
  );

  const trimSelected = async () => {
    const selected = items.filter((item) => isImageFile(item.file) && item.cropSelected !== false);
    if (!selected.length || busy) return;
    batchCancelled.current = false;
    setBatchRunning(true);
    let completed = 0,
      failed = 0;
    for (const item of selected) {
      if (batchCancelled.current) break;
      setBatchStatus(`Trimming ${completed + 1} of ${selected.length} images...`);
      try {
        const result = await trimImageMargins(item.file);
        if (batchCancelled.current) break;
        setItems((previous) =>
          previous.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  croppedFile: result?.file ?? entry.croppedFile,
                  cropStatus: result
                    ? `Trimmed to ${result.bounds.width} × ${result.bounds.height} pixels.`
                    : "No consistent margin found; current image retained.",
                }
              : entry,
          ),
        );
      } catch (error) {
        if (batchCancelled.current) break;
        failed++;
        setItems((previous) =>
          previous.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  cropStatus:
                    error instanceof Error
                      ? error.message
                      : "Cropping failed; current image retained.",
                }
              : entry,
          ),
        );
      }
      completed++;
    }
    setBatchStatus(
      `${batchCancelled.current ? "Cancelled. " : ""}${completed} of ${selected.length} images processed; ${failed} failed. Completed previews retained.`,
    );
    setBatchRunning(false);
  };

  const handleCreateBlank = async () => {
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 50) return;
    setError("");
    setCreating(true);
    try {
      const width = pageSize === "a4" ? 595.28 : 612;
      const height = pageSize === "a4" ? 841.89 : 792;
      const bytes = await createBlankDocument(pageCount, width, height);
      const file = new File([bytes as unknown as BlobPart], `Untitled-${Date.now()}.pdf`, {
        type: "application/pdf",
      });
      onLoad(file);
      s.set({ status: "Created new blank document" });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const pageDimensions = (): [number, number] =>
    pageSize === "a4" ? [595.28, 841.89] : [612, 792];

  const openCreated = (bytes: Uint8Array, prefix: string, status: string) => {
    onLoad(
      new File([bytes as unknown as BlobPart], `${prefix}-${Date.now()}.pdf`, {
        type: "application/pdf",
      }),
    );
    s.set({ status });
    onClose();
  };

  const handleCreateFromText = async () => {
    setError("");
    setCreating(true);
    try {
      const [width, height] = pageDimensions();
      const bytes = await textToPdf(text, { width, height, fontSize, monospace });
      openCreated(bytes, "Text", "Created a PDF from text");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const createFromImage = async (blob: Blob, type: string) => {
    const extension = type === "image/png" ? "png" : "jpg";
    const bytes = await imageFileToPdf(new File([blob], `Clipboard.${extension}`, { type }));
    openCreated(bytes, "Clipboard", "Created a PDF from the clipboard image");
  };

  const pasteFromClipboard = async () => {
    setError("");
    setCreating(true);
    try {
      const clipboard = navigator.clipboard;
      if (clipboard?.read) {
        const items = await clipboard.read();
        const image = items.find((item) => item.types.some(isPastedImage));
        const type = image?.types.find(isPastedImage);
        if (image && type) {
          await createFromImage(await image.getType(type), type);
          return;
        }
        const plain = items.find((item) => item.types.includes("text/plain"));
        if (!plain) throw new Error("The clipboard has no text or PNG or JPEG image.");
        const blob = await plain.getType("text/plain");
        setText(await blob.text());
        return;
      }
      if (!clipboard?.readText) throw new Error("Clipboard reading is unavailable.");
      setText(await clipboard.readText());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`${message} You can also paste into the text box with Cmd+V or Ctrl+V.`);
    } finally {
      setCreating(false);
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const image = [...event.clipboardData.files].find((file) => isPastedImage(file.type));
    if (!image) return;
    event.preventDefault();
    setError("");
    setCreating(true);
    void createFromImage(image, image.type)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false));
  };

  const loadTextFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Text files are limited to 5 MB.");
      return;
    }
    setError("");
    setText(await file.text());
  };

  /** Converts each listed file to its own PDF and saves them together as a ZIP archive. */
  const handleConvertSeparately = async () => {
    if (items.length === 0) return;
    setError("");
    setCreating(true);
    try {
      const used = new Set<string>();
      const entries: { name: string; data: Uint8Array }[] = [];
      const toPdf = async (item: (typeof items)[number]) => {
        if (isImageFile(item.file)) return imageFileToPdf(item.croppedFile ?? item.file);
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const range = item.range.trim();
        if (!range) return bytes;
        const source = await PDFDocument.load(bytes);
        return extractPages(bytes, parsePageRange("custom", range, 1, source.getPageCount()));
      };
      const convert = async (item: (typeof items)[number]) => ({ item, data: await toPdf(item) });
      for await (const { item, data } of mapInOrder(items, convert)) {
        const base = item.file.name.replace(/\.[^.]+$/, "") || "Document";
        const name = uniqueName(
          (copy) => (copy === 1 ? `${base}.pdf` : `${base} (${copy}).pdf`),
          used,
        );
        entries.push({ name, data });
      }
      const saved = await downloadBlob(
        new Blob([createZip(entries)], { type: "application/zip" }),
        `Converted-${Date.now()}.zip`,
      );
      s.set({
        status: saved
          ? `Converted ${entries.length} file(s) to separate PDFs in a ZIP archive`
          : "Save cancelled",
      });
      if (saved) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCombineFiles = async () => {
    if (items.length === 0) return;
    setError("");
    setCreating(true);
    try {
      const mergeInputs: MergeInputItem[] = [];
      const manifestSummary: string[] = [];

      const prepareInput = async (item: (typeof items)[number]) => {
        const buffer = isImageFile(item.file)
          ? await imageFileToPdf(item.croppedFile ?? item.file)
          : new Uint8Array(await item.file.arrayBuffer());
        const rawRange = isImageFile(item.file) ? "" : item.range.trim();
        if (rawRange) {
          const doc = await PDFDocument.load(buffer);
          const totalPages = doc.getPageCount();
          const parsed = parsePageRange("custom", rawRange, 1, totalPages);
          return {
            input: { name: item.file.name, bytes: buffer, ranges: parsed },
            summary: `${item.file.name} (${parsed.length} of ${totalPages} pages)`,
          };
        } else {
          return {
            input: { name: item.file.name, bytes: buffer },
            summary: `${item.file.name} (all pages)`,
          };
        }
      };
      for await (const { input, summary } of mapInOrder(items, prepareInput)) {
        mergeInputs.push(input);
        manifestSummary.push(summary);
      }

      const mergedBytes = await mergeDocuments(mergeInputs);
      const file = new File([mergedBytes as unknown as BlobPart], `Combined-${Date.now()}.pdf`, {
        type: "application/pdf",
      });
      onLoad(file);
      s.set({ status: `Combined ${items.length} file(s): ${manifestSummary.join(", ")}` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError("");
    setCreating(true);
    const failures: string[] = [];
    try {
      const expandFile = async (file: File) => {
        try {
          return { expanded: await expandImageInput(file), error: "" };
        } catch (error) {
          return {
            expanded: [],
            error: `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      };
      for await (const { expanded, error } of mapInOrder(files, expandFile)) {
        if (error) failures.push(error);
        else
          setItems((previous) => [
            ...previous,
            ...expanded.map((image) => ({ id: crypto.randomUUID(), file: image, range: "" })),
          ]);
      }
      if (failures.length) setError(failures.join("\n"));
    } finally {
      setCreating(false);
    }
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRange = (index: number, range: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], range };
      return next;
    });
  };

  let createLabel = "Combine & Open";
  if (tab === "blank" || tab === "text") createLabel = "Create PDF";
  else if (separately && items.length > 1) createLabel = "Convert & Save ZIP";
  return (
    <FeatureDialog title="Create PDF" onClose={onClose} busy={busy}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <FilePlus size={18} />
            <h3>Create PDF</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="tab-buttons-bar">
          <button
            className={`tab-button ${tab === "blank" ? "active" : ""}`}
            aria-pressed={tab === "blank"}
            disabled={busy}
            onClick={() => setTab("blank")}
          >
            <FilePlus size={15} /> Blank Document
          </button>
          <button
            className={`tab-button ${tab === "combine" ? "active" : ""}`}
            aria-pressed={tab === "combine"}
            disabled={busy}
            onClick={() => setTab("combine")}
          >
            <Combine size={15} /> Import / Combine Files
          </button>
          <button
            className={`tab-button ${tab === "text" ? "active" : ""}`}
            aria-pressed={tab === "text"}
            disabled={busy}
            onClick={() => setTab("text")}
          >
            <ClipboardPaste size={15} /> Text & Paste
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {tab === "blank" && (
            <div key="blank-section">
              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
                  Page Count
                </label>
                <input
                  id={`${fieldIds}-field-1`}
                  key="blank-page-count"
                  type="number"
                  min={1}
                  max={50}
                  value={pageCount}
                  onChange={(e) => setPageCount(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="text-input"
                />
              </div>

              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-2`} className="setting-title">
                  Page Size
                </label>
                <select
                  id={`${fieldIds}-field-2`}
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value as "a4" | "letter")}
                  className="select-input"
                >
                  <option value="a4">A4 (210 × 297 mm)</option>
                  <option value="letter">US Letter (8.5 × 11 in)</option>
                </select>
              </div>
            </div>
          )}
          {tab === "text" && (
            <div key="text-section" onPaste={handlePaste}>
              <p className="field-hint">
                Type or paste text, open a plain text file, or paste a PNG or JPEG image to create a
                one-page PDF from it. Text uses the built-in Latin fonts.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void pasteFromClipboard()}
                >
                  <ClipboardPaste size={15} /> Paste from Clipboard
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => textFileRef.current?.click()}
                >
                  Open Text File...
                </button>
                <input
                  ref={textFileRef}
                  type="file"
                  accept=".txt,text/plain"
                  style={{ display: "none" }}
                  aria-label="Text file"
                  onChange={(event) => void loadTextFile(event)}
                />
              </div>
              <div className="setting-group">
                <label htmlFor={`${fieldIds}-text`} className="setting-title">
                  Text
                </label>
                <textarea
                  id={`${fieldIds}-text`}
                  className="text-input"
                  rows={10}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </div>
              <div className="form-columns">
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-text-size`} className="setting-title">
                    Font size
                  </label>
                  <input
                    id={`${fieldIds}-text-size`}
                    type="number"
                    min={6}
                    max={36}
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-text-page`} className="setting-title">
                    Page size
                  </label>
                  <select
                    id={`${fieldIds}-text-page`}
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value as "a4" | "letter")}
                    className="select-input"
                  >
                    <option value="a4">A4</option>
                    <option value="letter">US Letter</option>
                  </select>
                </div>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={monospace}
                  onChange={(event) => setMonospace(event.target.checked)}
                />
                <span>Monospaced font</span>
              </label>
            </div>
          )}
          {tab === "combine" && (
            <div key="combine-section" className="combine-files-section">
              <p>
                Import PDFs and PNG, JPEG, GIF, BMP, WebP, HEIC, TIFF or JPEG 2000 images in the
                order shown. Each image becomes one page; animated images use their first frame.
                Office documents must first be saved as PDF in their original app.
              </p>
              <button
                className="button-secondary"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                Select PDFs or Images...
              </button>
              <input
                key="combine-file-input"
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg,.gif,.bmp,.webp,.heic,.heif,.tif,.tiff,.jp2,.j2k,.jpf,.jpx"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              {items.length > 0 && (
                <>
                  {items.some((item) => isImageFile(item.file)) && (
                    <div className="batch-image-controls">
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={
                          busy ||
                          !items.some(
                            (item) => isImageFile(item.file) && item.cropSelected !== false,
                          )
                        }
                        onClick={() => void trimSelected()}
                      >
                        Trim selected images
                      </button>
                      <small>
                        Uses default sensitivity and zero padding, replacing selected image
                        adjustments. Review every result.
                      </small>
                      <output aria-live="polite">{batchStatus}</output>
                    </div>
                  )}
                  <div className="combine-file-list">
                    {items.map((item, i) => (
                      <div key={item.id} className="combine-file-item">
                        <div className="combine-file-info">
                          {isImageFile(item.file) && (
                            <label>
                              <input
                                type="checkbox"
                                checked={item.cropSelected !== false}
                                disabled={busy}
                                onChange={(event) =>
                                  setItems((previous) =>
                                    previous.map((entry) =>
                                      entry.id === item.id
                                        ? { ...entry, cropSelected: event.target.checked }
                                        : entry,
                                    ),
                                  )
                                }
                              />{" "}
                              Select {item.file.name} for batch trim
                            </label>
                          )}
                          <span className="combine-file-name">
                            {i + 1}. {item.file.name}
                          </span>
                          <input
                            type="text"
                            disabled={busy || isImageFile(item.file)}
                            placeholder={
                              isImageFile(item.file)
                                ? "One image per page"
                                : "All pages, or e.g. 1-3, 5"
                            }
                            value={item.range ?? ""}
                            onChange={(e) => updateRange(i, e.target.value)}
                            className="combine-range-input"
                            aria-label={`Page range for ${item.file.name}`}
                          />
                          {isImageFile(item.file) && (
                            <ImageMarginCrop
                              file={item.file}
                              croppedFile={item.croppedFile}
                              disabled={busy}
                              onBusy={setCropping}
                              onChange={(croppedFile) =>
                                setItems((previous) =>
                                  previous.map((entry) =>
                                    entry.id === item.id
                                      ? { ...entry, croppedFile, cropStatus: undefined }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          )}
                          {item.cropStatus && <output>{item.cropStatus}</output>}
                        </div>
                        <div className="combine-file-actions">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => moveItem(i, -1)}
                            disabled={busy || i === 0}
                            title="Move file up"
                            aria-label="Move file up"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => moveItem(i, 1)}
                            disabled={busy || i === items.length - 1}
                            title="Move file down"
                            aria-label="Move file down"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            onClick={() => removeItem(i)}
                            title="Remove file"
                            aria-label="Remove file"
                            disabled={busy}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {items.length > 1 && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={separately}
                    disabled={busy}
                    onChange={(event) => setSeparately(event.target.checked)}
                  />
                  <span>Convert each file to its own PDF and save them as a ZIP archive</span>
                </label>
              )}
              {items.some((item) => !isImageFile(item.file)) && (
                <output className="structure-warning">
                  Supported form fields and bookmarks are preserved. Conflicting field names are
                  renamed. Signed, XFA and scripted forms require an unsigned, static copy.
                </output>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {batchRunning && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                batchCancelled.current = true;
                setBatchStatus("Cancelling after the current image...");
              }}
            >
              Cancel batch
            </button>
          )}
          <button type="button" onClick={onClose} className="button-secondary" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (tab === "blank") void handleCreateBlank();
              else if (tab === "text") void handleCreateFromText();
              else if (separately && items.length > 1) void handleConvertSeparately();
              else void handleCombineFiles();
            }}
            disabled={
              busy ||
              (tab === "blank" &&
                (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 50)) ||
              (tab === "combine" && items.length === 0) ||
              (tab === "text" && !text.trim())
            }
            className="button-primary"
          >
            <Check size={16} /> {creating ? "Creating..." : createLabel}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

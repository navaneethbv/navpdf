import { expandImageInput } from "./extended-image-import";
import { useId, useState, useRef, useEffect } from "react";
import { FilePlus, Combine, Check, X, ArrowUp, ArrowDown } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import { createBlankDocument, mergeDocuments } from "../../services/document-commands";
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

export function CreatePdfDialog({
  onLoad,
  onClose,
  initialTab = "blank",
}: Readonly<{
  initialTab?: "blank" | "combine";
  onLoad: (file: File) => void;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const s = useWorkspace();
  const [tab, setTab] = useState<"blank" | "combine">(initialTab);
  const [pageCount, setPageCount] = useState(1);
  const [pageSize, setPageSize] = useState<"a4" | "letter">("a4");
  const [creating, setCreating] = useState(false);
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
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  };

  const handleCombineFiles = async () => {
    if (items.length === 0) return;
    setCreating(true);
    try {
      const mergeInputs: MergeInputItem[] = [];
      const manifestSummary: string[] = [];

      for (const item of items) {
        const buffer = isImageFile(item.file)
          ? await imageFileToPdf(item.croppedFile ?? item.file)
          : new Uint8Array(await item.file.arrayBuffer());
        const rawRange = isImageFile(item.file) ? "" : item.range.trim();
        if (rawRange) {
          const doc = await PDFDocument.load(buffer);
          const totalPages = doc.getPageCount();
          const parsed = parsePageRange("custom", rawRange, 1, totalPages);
          mergeInputs.push({ name: item.file.name, bytes: buffer, ranges: parsed });
          manifestSummary.push(`${item.file.name} (${parsed.length} of ${totalPages} pages)`);
        } else {
          mergeInputs.push({ name: item.file.name, bytes: buffer });
          manifestSummary.push(`${item.file.name} (all pages)`);
        }
      }

      const mergedBytes = await mergeDocuments(mergeInputs);
      const file = new File([mergedBytes as unknown as BlobPart], `Combined-${Date.now()}.pdf`, {
        type: "application/pdf",
      });
      onLoad(file);
      s.set({ status: `Combined ${items.length} file(s): ${manifestSummary.join(", ")}` });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setCreating(true);
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          const expanded = await expandImageInput(file);
          setItems((previous) => [
            ...previous,
            ...expanded.map((image) => ({ id: crypto.randomUUID(), file: image, range: "" })),
          ]);
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failures.length) s.set({ error: failures.join("\n") });
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

  const createLabel = tab === "blank" ? "Create PDF" : "Combine & Open";
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
        </div>

        <div className="modal-body">
          {tab === "blank" ? (
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
          ) : (
            <div key="combine-section" className="combine-files-section">
              <p>
                Import PDFs, PNG, JPEG, HEIC or TIFF images in the order shown. Each image becomes
                one page. Office documents must first be saved as PDF in their original app.
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
                accept="application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg,.heic,.heif,.tif,.tiff"
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
              void (tab === "blank" ? handleCreateBlank() : handleCombineFiles());
            }}
            disabled={
              busy ||
              (tab === "blank" &&
                (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 50)) ||
              (tab === "combine" && items.length === 0)
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

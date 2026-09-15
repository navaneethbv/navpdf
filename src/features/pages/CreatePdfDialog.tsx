import { useState, useRef, useEffect } from "react";
import { FilePlus, Combine, Check, X, ArrowUp, ArrowDown } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import {
  createBlankDocument,
  describeStructureLoss,
  mergeDocuments,
} from "../../services/document-commands";
import { parsePageRange } from "./page-range";
import type { MergeInputItem } from "../../types/operations";
import { FeatureDialog } from "../../components/FeatureDialog";

export interface CombineEntry {
  id: string;
  file: File;
  range: string;
}

export function CreatePdfDialog({
  onLoad,
  onClose,
}: {
  onLoad: (file: File) => void;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [tab, setTab] = useState<"blank" | "combine">("blank");
  const [pageCount, setPageCount] = useState(1);
  const [pageSize, setPageSize] = useState<"a4" | "letter">("a4");
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<CombineEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [structureLoss, setStructureLoss] = useState("");

  // Combining composes a new document, so the inputs' bookmarks and form
  // fields cannot carry over. Report that before the user commits.
  useEffect(() => {
    let cancelled = false;
    if (items.length === 0) {
      setStructureLoss("");
      return;
    }
    void (async () => {
      try {
        const buffers = await Promise.all(
          items.map(async (item) => new Uint8Array(await item.file.arrayBuffer())),
        );
        const warning = await describeStructureLoss(buffers);
        if (!cancelled) setStructureLoss(warning);
      } catch {
        if (!cancelled) setStructureLoss("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

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

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const buffer = new Uint8Array(await item.file.arrayBuffer());
        const rawRange = item.range.trim();
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newItems: CombineEntry[] = Array.from(e.target.files).map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        range: "",
      }));
      setItems((prev) => [...prev, ...newItems]);
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

  return (
    <FeatureDialog title="Create PDF" onClose={onClose} busy={creating}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <FilePlus size={18} />
            <h3>Create PDF</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="tab-buttons-bar">
          <button
            className={`tab-button ${tab === "blank" ? "active" : ""}`}
            aria-pressed={tab === "blank"}
            onClick={() => setTab("blank")}
          >
            <FilePlus size={15} /> Blank Document
          </button>
          <button
            className={`tab-button ${tab === "combine" ? "active" : ""}`}
            aria-pressed={tab === "combine"}
            onClick={() => setTab("combine")}
          >
            <Combine size={15} /> Combine Multiple Files
          </button>
        </div>

        <div className="modal-body">
          {tab === "blank" ? (
            <div key="blank-section">
              <div className="setting-group">
                <label className="setting-title">Page Count</label>
                <input
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
                <label className="setting-title">Page Size</label>
                <select
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
              <button className="button-secondary" onClick={() => fileInputRef.current?.click()}>
                Select Files to Combine...
              </button>
              <input
                key="combine-file-input"
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              {items.length > 0 && (
                <div className="combine-file-list">
                  {items.map((item, i) => (
                    <div key={item.id} className="combine-file-item">
                      <div className="combine-file-info">
                        <span className="combine-file-name">
                          {i + 1}. {item.file.name}
                        </span>
                        <input
                          type="text"
                          placeholder="All pages, or e.g. 1-3, 5"
                          value={item.range ?? ""}
                          onChange={(e) => updateRange(i, e.target.value)}
                          className="combine-range-input"
                          aria-label={`Page range for ${item.file.name}`}
                        />
                      </div>
                      <div className="combine-file-actions">
                        <button
                          className="icon-button"
                          onClick={() => moveItem(i, -1)}
                          disabled={i === 0}
                          title="Move file up"
                          aria-label="Move file up"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => moveItem(i, 1)}
                          disabled={i === items.length - 1}
                          title="Move file down"
                          aria-label="Move file down"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          className="icon-button danger"
                          onClick={() => removeItem(i)}
                          title="Remove file"
                          aria-label="Remove file"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {structureLoss && (
                <p className="structure-warning" role="status">
                  {structureLoss}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={tab === "blank" ? handleCreateBlank : handleCombineFiles}
            disabled={
              creating ||
              (tab === "blank" &&
                (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 50)) ||
              (tab === "combine" && items.length === 0)
            }
            className="button-primary"
          >
            <Check size={16} />{" "}
            {creating ? "Creating..." : tab === "blank" ? "Create PDF" : "Combine & Open"}
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

import { useState, useRef, useEffect } from "react";
import { FilePlus, Combine, Check, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import {
  createBlankDocument,
  describeStructureLoss,
  mergeDocuments,
} from "../../services/document-commands";

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
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [structureLoss, setStructureLoss] = useState("");

  // Combining composes a new document, so the inputs' bookmarks and form
  // fields cannot carry over. Report that before the user commits.
  useEffect(() => {
    let cancelled = false;
    if (files.length === 0) {
      setStructureLoss("");
      return;
    }
    void (async () => {
      try {
        const buffers = await Promise.all(
          files.map(async (f) => new Uint8Array(await f.arrayBuffer())),
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
  }, [files]);

  const handleCreateBlank = async () => {
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
    if (files.length === 0) return;
    setCreating(true);
    try {
      const buffers = await Promise.all(
        files.map(async (f) => new Uint8Array(await f.arrayBuffer())),
      );
      const mergedBytes = await mergeDocuments(buffers);
      const file = new File([mergedBytes as unknown as BlobPart], `Combined-${Date.now()}.pdf`, {
        type: "application/pdf",
      });
      onLoad(file);
      s.set({ status: `Combined ${files.length} files into new document` });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Create PDF">
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
            className={tab === "blank" ? "active" : ""}
            onClick={() => setTab("blank")}
          >
            <FilePlus size={15} /> Blank Document
          </button>
          <button
            className={tab === "combine" ? "active" : ""}
            onClick={() => setTab("combine")}
          >
            <Combine size={15} /> Combine Multiple Files
          </button>
        </div>

        <div className="modal-body">
          {tab === "blank" ? (
            <>
              <div className="setting-group">
                <label className="setting-title">Page Count</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={pageCount}
                  onChange={(e) => setPageCount(Number(e.target.value))}
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
            </>
          ) : (
            <div className="combine-files-section">
              <button
                className="button-secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                Select Files to Combine...
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              {files.length > 0 && (
                <div className="combine-file-list">
                  {files.map((f, i) => (
                    <div key={i} className="combine-file-item">
                      <span>{i + 1}. {f.name}</span>
                      <button
                        className="icon-button danger"
                        onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      >
                        <X size={14} />
                      </button>
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
            disabled={creating || (tab === "combine" && files.length === 0)}
            className="button-primary"
          >
            <Check size={16} /> {creating ? "Creating..." : tab === "blank" ? "Create PDF" : "Combine & Open"}
          </button>
        </div>
      </div>
    </div>
  );
}

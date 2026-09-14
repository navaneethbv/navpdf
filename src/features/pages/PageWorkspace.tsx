import { useState, useRef, useEffect } from "react";
import {
  RotateCw,
  RotateCcw,
  Trash2,
  Download,
  Plus,
  Image as ImageIcon,
  ArrowLeft,
  ArrowRight,
  Split,
  Crop,
  Check,
  X,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import {
  rotatePages,
  deletePages,
  reorderPages,
  extractPages,
  insertBlankPage,
  insertImagePage,
  cropPages,
  splitDocument,
  describeStructureLoss,
  computeDeleteMapping,
  computeInsertMapping,
  computeReorderMapping,
} from "../../services/document-commands";
import { downloadBytes } from "../../utils/download";
import type { ViewerController } from "../viewer/controller";

export function PageWorkspace({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [selected, setSelected] = useState<number[]>([s.page - 1]);
  const [focusedIndex, setFocusedIndex] = useState(Math.max(0, Math.min(s.page - 1, (s.info?.pages || 1) - 1)));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropWidth, setCropWidth] = useState(500);
  const [cropHeight, setCropHeight] = useState(700);
  const [showCrop, setShowCrop] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [splitRange, setSplitRange] = useState("1-2, 3-4");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [structureLoss, setStructureLoss] = useState("");

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Extraction and splitting compose a new document, so the source catalog
  // (bookmarks, form fields) cannot carry over. Say so before the action.
  useEffect(() => {
    let cancelled = false;
    const pdf = controller?.pdf;
    if (!pdf) return;
    void (async () => {
      try {
        const bytes = await pdf.saveDocument();
        const warning = await describeStructureLoss([bytes]);
        if (!cancelled) setStructureLoss(warning);
      } catch {
        if (!cancelled) setStructureLoss("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller]);

  const totalPages = s.info?.pages || 1;
  const pagesList = Array.from({ length: totalPages }, (_, i) => i);

  const toggleSelect = (index: number, e: React.MouseEvent) => {
    if (e.shiftKey && selected.length > 0) {
      const last = selected[selected.length - 1];
      const start = Math.min(last, index);
      const end = Math.max(last, index);
      const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      setSelected(Array.from(new Set([...selected, ...range])));
    } else if (e.metaKey || e.ctrlKey) {
      if (selected.includes(index)) {
        setSelected(selected.filter((i) => i !== index));
      } else {
        setSelected([...selected, index]);
      }
    } else {
      setSelected([index]);
    }
  };

  const selectAll = () => setSelected(pagesList);
  const selectNone = () => setSelected([]);

  const mutate = async (
    operation: (bytes: Uint8Array) => Promise<Uint8Array>,
    status: string,
    options?: { pageMapping?: number[]; warnings?: string[] },
  ) => {
    if (!controller?.pdf) return;
    setBusy(true);
    s.set({ busy: true, status: "Updating pages..." });
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const newBytes = await operation(currentBytes);
      await controller.replaceWithBytes(newBytes, status, options);
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      s.set({ busy: false });
    }
  };

  const handleRotate = async (degrees: number) => {
    if (selected.length === 0) return;
    await mutate(
      (bytes) => rotatePages(bytes, selected, degrees),
      `Rotated ${selected.length} page(s)`,
    );
  };

  const handleDelete = async () => {
    if (selected.length === 0) return;
    if (selected.length >= totalPages) {
      s.set({ error: "Cannot delete all pages. At least one page must remain." });
      return;
    }
    const delSet = new Set(selected);
    const surviving = pagesList.filter((p) => !delSet.has(p));
    const nextSelectedIndex = surviving.length > 0
      ? Math.min(Math.max(0, selected[0]), surviving.length - 1)
      : 0;

    await mutate(
      (bytes) => deletePages(bytes, selected),
      `Deleted ${selected.length} page(s)`,
      { pageMapping: computeDeleteMapping(totalPages, selected) },
    );
    setSelected([nextSelectedIndex]);
    setFocusedIndex(nextSelectedIndex);
    s.set({ page: nextSelectedIndex + 1 });
  };

  const handleDropReorder = async (from: number, to: number) => {
    if (from === to || from < 0 || from >= totalPages || to < 0 || to >= totalPages) return;
    const newOrder = [...pagesList];
    const [moved] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, moved);
    await mutate(
      (bytes) => reorderPages(bytes, newOrder),
      `Page ${from + 1} moved to position ${to + 1}`,
      { pageMapping: computeReorderMapping(newOrder) },
    );
    setSelected([to]);
    setFocusedIndex(to);
    s.set({ page: to + 1 });
  };

  const handleMove = async (direction: -1 | 1) => {
    if (selected.length !== 1) return;
    const cur = selected[0];
    const target = cur + direction;
    if (target < 0 || target >= totalPages) return;
    await handleDropReorder(cur, target);
  };

  const handleExtract = async () => {
    if (!controller?.pdf || selected.length === 0) return;
    setBusy(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const extractedBytes = await extractPages(currentBytes, selected);
      downloadBytes(extractedBytes, "extracted-pages.pdf");
      s.set({ status: "Pages extracted" });
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleInsertBlank = async () => {
    const at = selected.length > 0 ? selected[0] + 1 : totalPages;
    await mutate(
      (bytes) => insertBlankPage(bytes, at),
      "Blank page inserted",
      { pageMapping: computeInsertMapping(totalPages, at, 1) },
    );
    setSelected([at]);
    setFocusedIndex(at);
    s.set({ page: at + 1 });
  };

  const handleInsertImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const type = file.type.includes("png") ? "png" : "jpg";
    const at = selected.length > 0 ? selected[0] + 1 : totalPages;
    await mutate(
      (docBytes) => insertImagePage(docBytes, at, bytes, type),
      "Image page inserted",
      { pageMapping: computeInsertMapping(totalPages, at, 1) },
    );
    setSelected([at]);
    setFocusedIndex(at);
    s.set({ page: at + 1 });
  };

  const handleCrop = async () => {
    if (selected.length === 0) return;
    await mutate(
      (bytes) =>
        cropPages(bytes, selected, {
          x: 0,
          y: 0,
          width: cropWidth,
          height: cropHeight,
        }),
      `Cropped ${selected.length} page(s) to visible box`,
    );
    setShowCrop(false);
  };

  const handleSplit = async () => {
    if (!controller?.pdf) return;
    try {
      const ranges = splitRange.split(",").map((r) => {
        const parts = r.trim().split("-").map((n) => parseInt(n, 10) - 1);
        if (parts.length === 1) return [parts[0]];
        const start = Math.max(0, parts[0]);
        const end = Math.min(totalPages - 1, parts[1]);
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      });
      const currentBytes = await controller.pdf.saveDocument();
      const files = await splitDocument(currentBytes, ranges);
      files.forEach((fileBytes, i) =>
        downloadBytes(fileBytes, `split-part-${i + 1}.pdf`),
      );
      setShowSplit(false);
      s.set({ status: `Document split into ${files.length} parts` });
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (busy) return;
    if (e.key === "Escape") {
      if (showCrop) setShowCrop(false);
      else if (showSplit) setShowSplit(false);
      else onClose();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAll();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, focusedIndex - 1);
      setFocusedIndex(next);
      if (e.shiftKey) {
        const start = Math.min(focusedIndex, next);
        const end = Math.max(focusedIndex, next);
        const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        setSelected(Array.from(new Set([...selected, ...range])));
      } else {
        setSelected([next]);
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(totalPages - 1, focusedIndex + 1);
      setFocusedIndex(next);
      if (e.shiftKey) {
        const start = Math.min(focusedIndex, next);
        const end = Math.max(focusedIndex, next);
        const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        setSelected(Array.from(new Set([...selected, ...range])));
      } else {
        setSelected([next]);
      }
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (selected.includes(focusedIndex)) {
        setSelected(selected.filter((i) => i !== focusedIndex));
      } else {
        setSelected([...selected, focusedIndex]);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      s.set({ page: focusedIndex + 1 });
      onClose();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selected.length > 0 && selected.length < totalPages) {
        e.preventDefault();
        void handleDelete();
      }
      return;
    }
    if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      if (e.shiftKey) void handleRotate(-90);
      else void handleRotate(90);
      return;
    }
  };

  return (
    <div
      className="page-workspace-modal"
      role="region"
      aria-label="Page Workspace"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <div className="page-workspace-header">
        <div className="page-workspace-actions">
          <h2>Organize Pages</h2>
          <span className="selected-count">
            {selected.length} of {totalPages} selected
          </span>
          <button onClick={selectAll}>Select All</button>
          <button onClick={selectNone}>Deselect</button>
        </div>

        {structureLoss && (
          <p className="structure-warning" role="status">
            {structureLoss} Extracting or splitting produces a new file.
          </p>
        )}

        <div className="page-workspace-toolbar">
          <button
            title="Rotate CW (90°)"
            onClick={() => handleRotate(90)}
            disabled={selected.length === 0 || busy}
          >
            <RotateCw size={17} />
            <span>Rotate CW</span>
          </button>
          <button
            title="Rotate CCW (-90°)"
            onClick={() => handleRotate(-90)}
            disabled={selected.length === 0 || busy}
          >
            <RotateCcw size={17} />
            <span>Rotate CCW</span>
          </button>
          <button
            title="Move Page Left"
            onClick={() => handleMove(-1)}
            disabled={selected.length !== 1 || selected[0] === 0 || busy}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            title="Move Page Right"
            onClick={() => handleMove(1)}
            disabled={
              selected.length !== 1 || selected[0] === totalPages - 1 || busy
            }
          >
            <ArrowRight size={17} />
          </button>
          <button
            title="Delete selected pages"
            className="danger"
            onClick={handleDelete}
            disabled={selected.length === 0 || selected.length >= totalPages || busy}
          >
            <Trash2 size={17} />
            <span>Delete</span>
          </button>
          <button
            title="Extract selected pages as new PDF"
            onClick={handleExtract}
            disabled={selected.length === 0 || busy}
          >
            <Download size={17} />
            <span>Extract</span>
          </button>
          <button title="Insert Blank Page" onClick={handleInsertBlank} disabled={busy}>
            <Plus size={17} />
            <span>Blank</span>
          </button>
          <button
            title="Insert Image as Page"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <ImageIcon size={17} />
            <span>Image</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg"
            style={{ display: "none" }}
            onChange={handleInsertImage}
          />
          <button title="Crop Page" onClick={() => setShowCrop(!showCrop)}>
            <Crop size={17} />
            <span>Crop</span>
          </button>
          <button title="Split PDF" onClick={() => setShowSplit(!showSplit)}>
            <Split size={17} />
            <span>Split</span>
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close page manager">
            <X size={20} />
          </button>
        </div>
      </div>

      {showCrop && (
        <div className="crop-controls-bar">
          <label>
            Width (pt):
            <input
              type="number"
              value={cropWidth}
              onChange={(e) => setCropWidth(Number(e.target.value))}
            />
          </label>
          <label>
            Height (pt):
            <input
              type="number"
              value={cropHeight}
              onChange={(e) => setCropHeight(Number(e.target.value))}
            />
          </label>
          <button onClick={handleCrop}>Apply Crop</button>
          <button onClick={() => setShowCrop(false)}>Cancel</button>
        </div>
      )}

      {showSplit && (
        <div className="split-controls-bar">
          <label>
            Page ranges (e.g. 1-2, 3-5):
            <input
              type="text"
              value={splitRange}
              onChange={(e) => setSplitRange(e.target.value)}
            />
          </label>
          <button onClick={handleSplit}>Execute Split</button>
          <button onClick={() => setShowSplit(false)}>Cancel</button>
        </div>
      )}

      <div className="page-workspace-grid" role="grid" aria-label="Pages grid">
        {pagesList.map((pageNum) => {
          const isSelected = selected.includes(pageNum);
          const isFocused = focusedIndex === pageNum;
          const isDragOver = dragOverIndex === pageNum;
          return (
            <div
              key={pageNum}
              role="gridcell"
              aria-selected={isSelected}
              tabIndex={isFocused ? 0 : -1}
              draggable={!busy}
              onDragStart={(e) => {
                setDraggedIndex(pageNum);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(pageNum));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverIndex !== pageNum) setDragOverIndex(pageNum);
              }}
              onDragLeave={() => {
                if (dragOverIndex === pageNum) setDragOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverIndex(null);
                const fromStr = e.dataTransfer.getData("text/plain");
                const from = fromStr ? parseInt(fromStr, 10) : draggedIndex;
                if (from !== null && from !== undefined && !isNaN(from)) {
                  void handleDropReorder(from, pageNum);
                }
                setDraggedIndex(null);
              }}
              className={`page-grid-item ${isSelected ? "selected" : ""} ${isFocused ? "focused" : ""} ${isDragOver ? "drag-over" : ""}`}
              onClick={(e) => {
                setFocusedIndex(pageNum);
                toggleSelect(pageNum, e);
              }}
            >
              <div className="page-card-preview">
                <div className="page-card-placeholder">
                  <span>Page {pageNum + 1}</span>
                </div>
                {isSelected && (
                  <div className="page-selected-badge">
                    <Check size={14} />
                  </div>
                )}
              </div>
              <span className="page-card-num">{pageNum + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

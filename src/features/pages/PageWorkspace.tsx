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
  duplicatePages,
  insertDocumentPages,
  replacePage,
  cropPages,
  splitDocument,
  describeStructureLoss,
  computeDeleteMapping,
  computeInsertMapping,
  computeReorderMapping,
} from "../../services/document-commands";
import { downloadBytes } from "../../utils/download";
import { native } from "../../services/native";
import { pruneDocument } from "../../services/engine";
import type { ViewerController } from "../viewer/controller";
import { parsePageRange } from "./page-range";
import { ThumbCanvas } from "../viewer/Thumbnails";

function isPageWorkspaceInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function handlePageArrowKey(
  event: React.KeyboardEvent,
  focusedIndex: number,
  totalPages: number,
  selected: number[],
  setFocusedIndex: (index: number) => void,
  setSelected: (indices: number[]) => void,
): boolean {
  const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return false;
  event.preventDefault();
  const next = Math.max(0, Math.min(totalPages - 1, focusedIndex + delta));
  setFocusedIndex(next);
  if (!event.shiftKey) {
    setSelected([next]);
    return true;
  }
  const start = Math.min(focusedIndex, next);
  const end = Math.max(focusedIndex, next);
  const range = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  setSelected(Array.from(new Set([...selected, ...range])));
  return true;
}

function handleEscapeKey(
  event: React.KeyboardEvent,
  showCrop: boolean,
  showSplit: boolean,
  setShowCrop: (value: boolean) => void,
  setShowSplit: (value: boolean) => void,
  onClose: () => void,
): boolean {
  if (event.key !== "Escape") return false;
  if (showCrop) setShowCrop(false);
  else if (showSplit) setShowSplit(false);
  else onClose();
  return true;
}

function handleSelectAllKey(event: React.KeyboardEvent, selectAll: () => void): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return false;
  event.preventDefault();
  selectAll();
  return true;
}

function handleSpaceKey(
  event: React.KeyboardEvent,
  focusedIndex: number,
  selected: number[],
  setSelected: (indices: number[]) => void,
): boolean {
  if (event.key !== " " && event.key !== "Spacebar") return false;
  event.preventDefault();
  setSelected(
    selected.includes(focusedIndex)
      ? selected.filter((index) => index !== focusedIndex)
      : [...selected, focusedIndex],
  );
  return true;
}

function handleEnterKey(
  event: React.KeyboardEvent,
  focusedIndex: number,
  setPage: (page: number) => void,
  onClose: () => void,
): boolean {
  if (event.key !== "Enter") return false;
  event.preventDefault();
  setPage(focusedIndex + 1);
  onClose();
  return true;
}

function handleDeleteKey(
  event: React.KeyboardEvent,
  selected: number[],
  totalPages: number,
  handleDelete: () => void,
): boolean {
  if (event.key !== "Delete" && event.key !== "Backspace") return false;
  if (selected.length > 0 && selected.length < totalPages) {
    event.preventDefault();
    void handleDelete();
  }
  return true;
}

function handleRotateKey(
  event: React.KeyboardEvent,
  handleRotate: (degrees: number) => void,
): boolean {
  if (event.key.toLowerCase() !== "r") return false;
  event.preventDefault();
  void handleRotate(event.shiftKey ? -90 : 90);
  return true;
}

export function PageWorkspace({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const sourcePdf = controller?.pdf;
  const s = useWorkspace();
  const [selected, setSelected] = useState<number[]>([s.page - 1]);
  const [focusedIndex, setFocusedIndex] = useState(
    Math.max(0, Math.min(s.page - 1, (s.info?.pages || 1) - 1)),
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropWidth, setCropWidth] = useState(500);
  const [cropHeight, setCropHeight] = useState(700);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [showCrop, setShowCrop] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [splitRange, setSplitRange] = useState("1-2, 3-4");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const replacePdfInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDialogElement>(null);
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
      const last = selected.at(-1) ?? index;
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
      await controller.replaceWithBytes(newBytes, status, {
        ...options,
        expectedSource: sourcePdf,
      });
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
    const nextSelectedIndex =
      surviving.length > 0 ? Math.min(Math.max(0, selected[0]), surviving.length - 1) : 0;

    await mutate(
      async (bytes) => {
        let res = await deletePages(bytes, selected);
        if (native) {
          try {
            res = await pruneDocument(res);
          } catch {
            // ignore
          }
        } else {
          s.set({
            status: "Deleted objects remain in the file until saved from the desktop app.",
          });
        }
        return res;
      },
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
      if (!(await downloadBytes(extractedBytes, "extracted-pages.pdf"))) return;
      s.set({ status: "Pages extracted" });
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleInsertBlank = async () => {
    const at = selected.length > 0 ? selected[0] + 1 : totalPages;
    await mutate((bytes) => insertBlankPage(bytes, at), "Blank page inserted", {
      pageMapping: computeInsertMapping(totalPages, at, 1),
    });
    setSelected([at]);
    setFocusedIndex(at);
    s.set({ page: at + 1 });
  };

  const handleDuplicate = async () => {
    if (selected.length === 0) return;
    await mutate(
      (bytes) => duplicatePages(bytes, selected),
      `Duplicated ${selected.length} page(s)`,
      {
        pageMapping: computeInsertMapping(totalPages, (selected.at(-1) ?? 0) + 1, selected.length),
      },
    );
  };

  const handleImportPdf = async (
    event: React.ChangeEvent<HTMLInputElement>,
    action: "insert" | "replace",
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !controller?.pdf) return;
    try {
      const other = new Uint8Array(await file.arrayBuffer());
      const current = await controller.pdf.saveDocument();
      const insertAt = selected.length ? selected[0] + 1 : totalPages;
      const output =
        action === "insert"
          ? await insertDocumentPages(current, other, insertAt)
          : await replacePage(current, selected[0] ?? 0, other);
      await controller.replaceWithBytes(
        output,
        action === "insert" ? "PDF pages inserted" : "Page replaced",
        { expectedSource: sourcePdf, preMutationBytes: current },
      );
      s.set({ status: action === "insert" ? "PDF pages inserted" : "Page replaced" });
    } catch (error) {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleInsertImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const type = file.type.includes("png") ? "png" : "jpg";
    const at = selected.length > 0 ? selected[0] + 1 : totalPages;
    await mutate((docBytes) => insertImagePage(docBytes, at, bytes, type), "Image page inserted", {
      pageMapping: computeInsertMapping(totalPages, at, 1),
    });
    setSelected([at]);
    setFocusedIndex(at);
    s.set({ page: at + 1 });
  };

  const handleCrop = async () => {
    if (selected.length === 0) return;
    await mutate(
      (bytes) =>
        cropPages(bytes, selected, {
          x: cropX,
          y: cropY,
          width: cropWidth,
          height: cropHeight,
        }),
      `Cropped ${selected.length} page(s) to visible box`,
    );
    setShowCrop(false);
  };

  const handleSplit = async () => {
    if (!controller?.pdf || busy) return;
    setBusy(true);
    s.set({ busy: true, status: "Splitting document..." });
    try {
      const ranges = splitRange.split(",").map((range) => parsePageRange(range, totalPages));
      const currentBytes = await controller.pdf.saveDocument();
      const files = await splitDocument(currentBytes, ranges);
      for (const [i, fileBytes] of files.entries()) {
        if (!(await downloadBytes(fileBytes, `split-part-${i + 1}.pdf`))) return;
      }
      setShowSplit(false);
      s.set({ status: `Document split into ${files.length} parts` });
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      s.set({ busy: false });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (busy) return;
    if (handleEscapeKey(e, showCrop, showSplit, setShowCrop, setShowSplit, onClose)) return;
    if (isPageWorkspaceInput(e.target)) return;
    if (handleSelectAllKey(e, selectAll)) return;
    if (handlePageArrowKey(e, focusedIndex, totalPages, selected, setFocusedIndex, setSelected))
      return;
    if (handleSpaceKey(e, focusedIndex, selected, setSelected)) return;
    if (handleEnterKey(e, focusedIndex, (page) => s.set({ page }), onClose)) return;
    if (handleDeleteKey(e, selected, totalPages, handleDelete)) return;
    handleRotateKey(e, handleRotate);
  };

  return (
    <dialog
      className="page-workspace-modal"
      open
      aria-label="Page Workspace"
      autoFocus
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <div className="page-workspace-header">
        <div className="page-workspace-actions">
          <h2>Organize Pages</h2>
          <span className="selected-count">
            {selected.length} of {totalPages} selected
          </span>
          <button type="button" onClick={selectAll}>
            Select All
          </button>
          <button type="button" onClick={selectNone}>
            Deselect
          </button>
        </div>

        {structureLoss && (
          <output className="structure-warning">
            {structureLoss} Extracting or splitting produces a new file.
          </output>
        )}

        <div className="page-workspace-toolbar">
          <button
            type="button"
            title="Rotate CW (90°)"
            onClick={() => {
              void handleRotate(90);
            }}
            disabled={selected.length === 0 || busy}
          >
            <RotateCw size={17} />
            <span>Rotate CW</span>
          </button>
          <button
            type="button"
            title="Rotate CCW (-90°)"
            onClick={() => {
              void handleRotate(-90);
            }}
            disabled={selected.length === 0 || busy}
          >
            <RotateCcw size={17} />
            <span>Rotate CCW</span>
          </button>
          <button
            type="button"
            title="Move Page Left"
            onClick={() => {
              void handleMove(-1);
            }}
            disabled={selected.length !== 1 || selected[0] === 0 || busy}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            title="Move Page Right"
            onClick={() => {
              void handleMove(1);
            }}
            disabled={selected.length !== 1 || selected[0] === totalPages - 1 || busy}
          >
            <ArrowRight size={17} />
          </button>
          <button
            type="button"
            title="Delete selected pages"
            className="danger"
            onClick={() => {
              void handleDelete();
            }}
            disabled={selected.length === 0 || selected.length >= totalPages || busy}
          >
            <Trash2 size={17} />
            <span>Delete</span>
          </button>
          <button
            type="button"
            title="Extract selected pages as new PDF"
            onClick={() => {
              void handleExtract();
            }}
            disabled={selected.length === 0 || busy}
          >
            <Download size={17} />
            <span>Extract</span>
          </button>
          <button
            type="button"
            title="Insert Blank Page"
            onClick={() => {
              void handleInsertBlank();
            }}
            disabled={busy}
          >
            <Plus size={17} />
            <span>Blank</span>
          </button>
          <button
            type="button"
            title="Duplicate selected pages"
            onClick={() => {
              void handleDuplicate();
            }}
            disabled={selected.length === 0 || busy}
          >
            <Plus size={17} />
            <span>Duplicate</span>
          </button>
          <button
            type="button"
            title="Insert pages from a PDF"
            onClick={() => {
              pdfInputRef.current?.click();
            }}
            disabled={busy}
          >
            <Plus size={17} />
            <span>Insert PDF</span>
          </button>
          <button
            type="button"
            title="Replace the selected page"
            onClick={() => {
              replacePdfInputRef.current?.click();
            }}
            disabled={selected.length !== 1 || busy}
          >
            <ImageIcon size={17} />
            <span>Replace</span>
          </button>
          <button
            type="button"
            title="Insert Image as Page"
            onClick={() => {
              fileInputRef.current?.click();
            }}
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
            onChange={(event) => {
              void handleInsertImage(event);
            }}
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              void handleImportPdf(event, "insert");
            }}
          />
          <input
            ref={replacePdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              void handleImportPdf(event, "replace");
            }}
          />
          <button
            type="button"
            title="Crop Page"
            onClick={() => {
              void (async () => {
                if (!showCrop && controller?.pdf && selected.length > 0) {
                  try {
                    const pdfPage = await controller.pdf.getPage(selected[0] + 1);
                    const vp = pdfPage.getViewport({ scale: 1 });
                    setCropWidth(Math.round(vp.width));
                    setCropHeight(Math.round(vp.height));
                  } catch {
                    // ignore
                  }
                }
                setShowCrop(!showCrop);
              })();
            }}
          >
            <Crop size={17} />
            <span>Crop</span>
          </button>
          <button
            type="button"
            title="Split PDF"
            onClick={() => {
              setShowSplit(!showSplit);
            }}
          >
            <Split size={17} />
            <span>Split</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close page manager"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {showCrop && (
        <div className="crop-controls-bar">
          <label>
            Width (pt):{" "}
            <input
              type="number"
              value={cropWidth}
              onChange={(e) => setCropWidth(Number(e.target.value))}
            />
          </label>
          <label>
            Height (pt):{" "}
            <input
              type="number"
              value={cropHeight}
              onChange={(e) => setCropHeight(Number(e.target.value))}
            />
          </label>
          <label>
            X (pt):{" "}
            <input type="number" value={cropX} onChange={(e) => setCropX(Number(e.target.value))} />
          </label>
          <label>
            Y (pt):{" "}
            <input type="number" value={cropY} onChange={(e) => setCropY(Number(e.target.value))} />
          </label>
          <button
            type="button"
            onClick={() => {
              void handleCrop();
            }}
          >
            Apply Crop
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCrop(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {showSplit && (
        <div className="split-controls-bar">
          <label>
            Page ranges (e.g. 1-2, 3-5):{" "}
            <input type="text" value={splitRange} onChange={(e) => setSplitRange(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              void handleSplit();
            }}
            disabled={busy}
          >
            {busy ? "Splitting..." : "Execute Split"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSplit(false);
            }}
          >
            Cancel
          </button>
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
                const from = fromStr ? Number.parseInt(fromStr, 10) : draggedIndex;
                if (typeof from === "number" && !Number.isNaN(from)) {
                  void handleDropReorder(from, pageNum);
                }
                setDraggedIndex(null);
              }}
              className={`page-grid-item ${isSelected ? "selected" : ""} ${isFocused ? "focused" : ""} ${isDragOver ? "drag-over" : ""}`}
              onClick={(e) => {
                setFocusedIndex(pageNum);
                toggleSelect(pageNum, e);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFocusedIndex(pageNum);
                  toggleSelect(pageNum, e as unknown as React.MouseEvent);
                }
              }}
            >
              <div className="page-card-preview">
                <ThumbCanvas pdf={controller?.pdf} page={pageNum + 1} revision={s.revision} />
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
    </dialog>
  );
}

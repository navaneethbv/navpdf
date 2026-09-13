import { useState, useRef, useEffect } from "react";
import {
  PenLine,
  Check,
  X as XIcon,
  Circle,
  Square,
  Minus,
  Trash2,
  Plus,
} from "lucide-react";
import { PDFDocument, rgb } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

interface SavedSignature {
  id: string;
  dataUrl: string;
  name: string;
  type: "signature" | "initials";
}

export function FillAndSign({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [tab, setTab] = useState<"library" | "draw" | "type" | "marks">("library");
  const [signatures, setSignatures] = useState<SavedSignature[]>([]);
  const [typedName, setTypedName] = useState("");
  const [targetPage, setTargetPage] = useState(s.page);
  const [selectedSig, setSelectedSig] = useState<SavedSignature | null>(null);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("navpdf-signatures");
      if (stored) setSignatures(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const saveToStorage = (sigs: SavedSignature[]) => {
    setSignatures(sigs);
    try {
      localStorage.setItem("navpdf-signatures", JSON.stringify(sigs));
    } catch {
      // ignore
    }
  };

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    isDrawing.current = true;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#152a22";
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSaveDrawn = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const newSig: SavedSignature = {
      id: crypto.randomUUID(),
      dataUrl,
      name: `Signature ${signatures.length + 1}`,
      type: "signature",
    };
    saveToStorage([...signatures, newSig]);
    setSelectedSig(newSig);
    setTab("library");
  };

  const handleSaveTyped = () => {
    if (!typedName.trim()) return;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "italic 36px 'Brush Script MT', cursive, sans-serif";
      ctx.fillStyle = "#152a22";
      ctx.fillText(typedName, 20, 75);
    }
    const dataUrl = canvas.toDataURL("image/png");
    const newSig: SavedSignature = {
      id: crypto.randomUUID(),
      dataUrl,
      name: typedName,
      type: "signature",
    };
    saveToStorage([...signatures, newSig]);
    setSelectedSig(newSig);
    setTab("library");
  };

  const handleDelete = (id: string) => {
    const next = signatures.filter((s) => s.id !== id);
    saveToStorage(next);
    if (selectedSig?.id === id) setSelectedSig(null);
  };

  const handlePlaceSignature = async () => {
    if (!selectedSig || !controller?.pdf) return;
    setSaving(true);
    try {
      const res = await fetch(selectedSig.dataUrl);
      const imgBytes = new Uint8Array(await res.arrayBuffer());

      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      const img = await doc.embedPng(imgBytes);

      const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
      const page = doc.getPage(pageIndex);
      const { height } = page.getSize();

      const width = 160;
      const aspect = img.height / img.width;
      const sigHeight = width * aspect;

      page.drawImage(img, {
        x: 60,
        y: height - 200,
        width,
        height: sigHeight,
      });

      const newBytes = await doc.save();
      await controller.replaceWithBytes(newBytes, "Signature placed on page");
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handlePlaceMark = async (symbol: string) => {
    if (!controller?.pdf) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
      const page = doc.getPage(pageIndex);
      const { height } = page.getSize();

      if (symbol === "check") {
        // Vector checkmark (text glyphs outside WinAnsi would throw).
        const y = height - 120;
        page.drawLine({
          start: { x: 60, y: y - 6 },
          end: { x: 68, y: y - 14 },
          thickness: 2.5,
          color: rgb(0.1, 0.5, 0.2),
        });
        page.drawLine({
          start: { x: 68, y: y - 14 },
          end: { x: 84, y },
          thickness: 2.5,
          color: rgb(0.1, 0.5, 0.2),
        });
      } else if (symbol === "cross") {
        const y = height - 120;
        page.drawLine({
          start: { x: 60, y },
          end: { x: 76, y: y - 16 },
          thickness: 2.5,
          color: rgb(0.8, 0.1, 0.1),
        });
        page.drawLine({
          start: { x: 60, y: y - 16 },
          end: { x: 76, y },
          thickness: 2.5,
          color: rgb(0.8, 0.1, 0.1),
        });
      } else if (symbol === "dot") {
        page.drawCircle({ x: 60, y: height - 120, size: 5, color: rgb(0.1, 0.1, 0.1) });
      } else if (symbol === "box") {
        page.drawRectangle({ x: 60, y: height - 120, width: 20, height: 20, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1.5 });
      } else if (symbol === "line") {
        page.drawLine({ start: { x: 60, y: height - 120 }, end: { x: 180, y: height - 120 }, thickness: 1.5, color: rgb(0.1, 0.1, 0.1) });
      }

      const newBytes = await doc.save();
      await controller.replaceWithBytes(
        newBytes,
        `Mark (${symbol}) placed on document`,
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Fill and Sign">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <PenLine size={18} />
            <h3>Fill & Sign</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="tab-buttons-bar">
          <button
            className={tab === "library" ? "active" : ""}
            onClick={() => setTab("library")}
          >
            Saved Signatures
          </button>
          <button
            className={tab === "draw" ? "active" : ""}
            onClick={() => setTab("draw")}
          >
            Draw
          </button>
          <button
            className={tab === "type" ? "active" : ""}
            onClick={() => setTab("type")}
          >
            Type
          </button>
          <button
            className={tab === "marks" ? "active" : ""}
            onClick={() => setTab("marks")}
          >
            Quick Marks
          </button>
        </div>

        <div className="modal-body">
          {tab === "library" && (
            <div className="signature-library">
              {signatures.length === 0 ? (
                <div className="empty-message-box">
                  <p>No signatures saved yet.</p>
                  <button className="button-secondary" onClick={() => setTab("draw")}>
                    <Plus size={16} /> Create Signature
                  </button>
                </div>
              ) : (
                <div className="sig-list">
                  {signatures.map((sig) => (
                    <div
                      key={sig.id}
                      className={`sig-card ${selectedSig?.id === sig.id ? "selected" : ""}`}
                      onClick={() => setSelectedSig(sig)}
                    >
                      <img src={sig.dataUrl} alt={sig.name} />
                      <div className="sig-meta">
                        <span>{sig.name}</span>
                        <button
                          className="icon-button danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(sig.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "draw" && (
            <div className="signature-draw-pad">
              <canvas
                ref={canvasRef}
                width={460}
                height={160}
                className="sig-canvas"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
              />
              <div className="pad-toolbar">
                <button className="button-secondary" onClick={clearCanvas}>
                  Clear
                </button>
                <button className="button-primary" onClick={handleSaveDrawn}>
                  Save Signature
                </button>
              </div>
            </div>
          )}

          {tab === "type" && (
            <div className="signature-type-pad">
              <input
                type="text"
                placeholder="Type your name..."
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="text-input"
              />
              {typedName && (
                <div className="type-preview">
                  <span style={{ fontFamily: "'Brush Script MT', cursive, sans-serif", fontSize: "36px" }}>
                    {typedName}
                  </span>
                </div>
              )}
              <button
                className="button-primary"
                onClick={handleSaveTyped}
                disabled={!typedName.trim()}
              >
                Save Signature
              </button>
            </div>
          )}

          {tab === "marks" && (
            <div className="quick-marks-grid">
              <button className="mark-card" onClick={() => handlePlaceMark("check")}>
                <Check size={24} />
                <span>Checkmark</span>
              </button>
              <button className="mark-card" onClick={() => handlePlaceMark("cross")}>
                <XIcon size={24} />
                <span>Cross</span>
              </button>
              <button className="mark-card" onClick={() => handlePlaceMark("dot")}>
                <Circle size={20} />
                <span>Dot</span>
              </button>
              <button className="mark-card" onClick={() => handlePlaceMark("box")}>
                <Square size={20} />
                <span>Box</span>
              </button>
              <button className="mark-card" onClick={() => handlePlaceMark("line")}>
                <Minus size={24} />
                <span>Line</span>
              </button>
            </div>
          )}

          {tab === "library" && selectedSig && (
            <div className="setting-group" style={{ marginTop: "16px" }}>
              <label className="setting-title">Place on Page</label>
              <input
                type="number"
                min={1}
                max={s.info?.pages || 1}
                value={targetPage}
                onChange={(e) => setTargetPage(Number(e.target.value))}
                className="text-input"
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {tab === "library" && selectedSig && (
            <button
              onClick={handlePlaceSignature}
              disabled={saving}
              className="button-primary"
            >
              {saving ? "Placing..." : "Place Signature"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

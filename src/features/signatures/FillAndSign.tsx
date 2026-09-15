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
  Upload,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Clock,
} from "lucide-react";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import { FeatureDialog } from "../../components/FeatureDialog";
import type { ViewerController } from "../viewer/controller";
import {
  fetchSignatureLibrary,
  persistOrStageSignature,
  removeSignature,
  hasLegacyPlaintextSignatures,
  migrateLegacySignatures,
  getSessionSignatures,
  getLegacyPlaintextSignatures,
} from "../../services/signature-store";
import { fromTopLeftVisual } from "../../services/pdf/page-box";
import type { SavedSignature } from "../../services/native";
import { PageNumberInput } from "../../components/PageNumberInput";

export function FillAndSign({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [tab, setTab] = useState<"library" | "draw" | "type" | "import" | "marks">("library");
  const [signatures, setSignatures] = useState<SavedSignature[]>(() => {
    const sessionList = getSessionSignatures();
    const legacy = getLegacyPlaintextSignatures();
    return [...sessionList, ...legacy];
  });
  const [typedName, setTypedName] = useState("");
  const [targetPage, setTargetPage] = useState(s.page);
  const [selectedSig, setSelectedSig] = useState<SavedSignature | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [sigType, setSigType] = useState<"signature" | "initials">("signature");
  const [legacyMigrationPrompt, setLegacyMigrationPrompt] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeWarnings, setStoreWarnings] = useState<string[]>([]);
  const [posX, setPosX] = useState(60);
  const [posY, setPosY] = useState(150);
  const [sigWidth, setSigWidth] = useState(160);
  const [sigRotation, setSigRotation] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDrawing = useRef(false);

  const refreshLibrary = async () => {
    const { signatures: list, error, warnings } = await fetchSignatureLibrary();
    setSignatures(list);
    setStoreError(error);
    setStoreWarnings(warnings);
  };

  useEffect(() => {
    void refreshLibrary();
    if (hasLegacyPlaintextSignatures()) {
      setLegacyMigrationPrompt(true);
    }
  }, []);

  const handleMigrate = async (confirmed: boolean) => {
    const result = await migrateLegacySignatures(confirmed);
    setLegacyMigrationPrompt(false);
    if (result.error) {
      s.set({ error: result.error });
    }
    await refreshLibrary();
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

  const handleSaveDrawn = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const name = `${sigType === "initials" ? "Initials" : "Signature"} ${signatures.length + 1}`;
    const { signature, error } = await persistOrStageSignature(name, sigType, dataUrl, sessionOnly);
    if (error) {
      s.set({ error });
      return;
    }
    await refreshLibrary();
    setSelectedSig(signature);
    setTab("library");
  };

  const handleSaveTyped = async () => {
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
    const { signature, error } = await persistOrStageSignature(
      typedName,
      sigType,
      dataUrl,
      sessionOnly,
    );
    if (error) {
      s.set({ error });
      return;
    }
    await refreshLibrary();
    setSelectedSig(signature);
    setTab("library");
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => s.set({ error: "The image could not be read." });
    reader.onload = async () => {
      const img = new Image();
      img.onerror = () => s.set({ error: "The image could not be read." });
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 4096 / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } else {
          s.set({ error: "The image could not be read." });
          return;
        }
        const dataUrl = canvas.toDataURL("image/png");
        const name = file.name.replace(/\.[^.]+$/, "");
        const { signature, error } = await persistOrStageSignature(
          name,
          sigType,
          dataUrl,
          sessionOnly,
        );
        if (error) {
          s.set({ error });
          return;
        }
        await refreshLibrary();
        setSelectedSig(signature);
        setTab("library");
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async (sig: SavedSignature) => {
    setSignatures((prev) => prev.filter((s) => s.id !== sig.id));
    if (selectedSig?.id === sig.id) setSelectedSig(null);
    await removeSignature(sig.id, sig.sessionOnly);
    await refreshLibrary();
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

      const width = sigWidth;
      const aspect = img.height / img.width;
      const sigHeight = width * aspect;

      const rect = fromTopLeftVisual(page, posX, posY, width, sigHeight);

      page.drawImage(img, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        rotate: degrees(sigRotation),
      });

      const newBytes = await doc.save();
      await controller.replaceWithBytes(newBytes, "Signature appearance placed on page");
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
      const rect = fromTopLeftVisual(page, posX, posY, 24, 24);
      const x = rect.x;
      const y = rect.y + rect.height;

      if (symbol === "check") {
        page.drawLine({
          start: { x, y: y - 6 },
          end: { x: x + 8, y: y - 14 },
          thickness: 2.5,
          color: rgb(0.1, 0.5, 0.2),
        });
        page.drawLine({
          start: { x: x + 8, y: y - 14 },
          end: { x: x + 24, y },
          thickness: 2.5,
          color: rgb(0.1, 0.5, 0.2),
        });
      } else if (symbol === "cross") {
        page.drawLine({
          start: { x, y },
          end: { x: x + 16, y: y - 16 },
          thickness: 2.5,
          color: rgb(0.8, 0.1, 0.1),
        });
        page.drawLine({
          start: { x, y: y - 16 },
          end: { x: x + 16, y },
          thickness: 2.5,
          color: rgb(0.8, 0.1, 0.1),
        });
      } else if (symbol === "dot") {
        page.drawCircle({ x: x + 5, y: y - 5, size: 5, color: rgb(0.1, 0.1, 0.1) });
      } else if (symbol === "box") {
        page.drawRectangle({
          x,
          y: y - 20,
          width: 20,
          height: 20,
          borderColor: rgb(0.1, 0.1, 0.1),
          borderWidth: 1.5,
        });
      } else if (symbol === "line") {
        page.drawLine({
          start: { x, y },
          end: { x: x + 120, y },
          thickness: 1.5,
          color: rgb(0.1, 0.1, 0.1),
        });
      }

      const newBytes = await doc.save();
      await controller.replaceWithBytes(newBytes, `Mark (${symbol}) placed on document`);
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureDialog title="Fill and Sign" onClose={onClose} busy={saving}>
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

        {s.hasDigitalSignature && (
          <div
            style={{
              padding: "10px 16px",
              background: "rgba(220, 100, 30, 0.12)",
              borderBottom: "1px solid rgba(220, 100, 30, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "var(--text-color)",
            }}
          >
            <AlertTriangle size={18} color="#dc641e" />
            <span>
              This document contains an existing digital signature. Placing appearances or edits
              will invalidate it.
            </span>
          </div>
        )}

        {legacyMigrationPrompt && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(37, 96, 75, 0.1)",
              borderBottom: "1px solid rgba(37, 96, 75, 0.2)",
              fontSize: "13px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <ShieldCheck size={18} color="#25604b" />
              <strong>Plaintext signatures detected</strong>
            </div>
            <p style={{ margin: "0 0 10px 0" }}>
              Previous versions stored reusable signatures unencrypted in local storage. Would you
              like to migrate them to OS-protected encrypted storage?
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="button-primary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => handleMigrate(true)}
              >
                Migrate to Secure Storage
              </button>
              <button
                type="button"
                className="button-secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => handleMigrate(false)}
              >
                Discard Plaintext
              </button>
            </div>
          </div>
        )}

        {storeError && (
          <div
            style={{
              padding: "8px 16px",
              background: "rgba(200, 40, 40, 0.1)",
              color: "var(--color-danger, #d32f2f)",
              fontSize: "12px",
            }}
          >
            {storeError}
          </div>
        )}
        {storeWarnings.length > 0 && (
          <div className="signature-warnings" data-testid="signature-warnings">
            {storeWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        <div className="tab-buttons-bar">
          <button
            type="button"
            className={tab === "library" ? "active" : ""}
            aria-pressed={tab === "library"}
            onClick={() => setTab("library")}
          >
            Saved Signatures
          </button>
          <button
            type="button"
            className={tab === "draw" ? "active" : ""}
            aria-pressed={tab === "draw"}
            onClick={() => setTab("draw")}
          >
            Draw
          </button>
          <button
            type="button"
            className={tab === "type" ? "active" : ""}
            aria-pressed={tab === "type"}
            onClick={() => setTab("type")}
          >
            Type
          </button>
          <button
            type="button"
            className={tab === "import" ? "active" : ""}
            aria-pressed={tab === "import"}
            onClick={() => setTab("import")}
          >
            Import
          </button>
          <button
            type="button"
            className={tab === "marks" ? "active" : ""}
            aria-pressed={tab === "marks"}
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
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setTab("draw")}
                    >
                      <Plus size={16} /> Draw Signature
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setTab("type")}
                    >
                      <Plus size={16} /> Type Signature
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sig-list">
                  {signatures.map((sig) => (
                    <button
                      type="button"
                      key={sig.id}
                      className={`sig-card ${selectedSig?.id === sig.id ? "selected" : ""}`}
                      aria-pressed={selectedSig?.id === sig.id}
                      onClick={() => setSelectedSig(sig)}
                    >
                      <img src={sig.dataUrl} alt={sig.name} />
                      <div className="sig-meta">
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>{sig.name}</span>
                          {sig.storage === "session" ? (
                            <span
                              title="Session-only (in memory)"
                              style={{
                                fontSize: "10px",
                                padding: "1px 4px",
                                borderRadius: "3px",
                                background: "rgba(100, 100, 100, 0.15)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "2px",
                              }}
                            >
                              <Clock size={10} /> Session
                            </span>
                          ) : sig.storage === "legacy" ? (
                            <span
                              title="Unprotected legacy storage (not encrypted by OS)"
                              data-testid="unprotected-badge"
                              style={{
                                fontSize: "10px",
                                padding: "1px 4px",
                                borderRadius: "3px",
                                background: "rgba(220, 38, 38, 0.15)",
                                color: "var(--color-danger, #dc2626)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "2px",
                              }}
                            >
                              <AlertTriangle size={10} /> Unprotected
                            </span>
                          ) : (
                            <span
                              title="Encrypted in OS storage"
                              style={{
                                fontSize: "10px",
                                padding: "1px 4px",
                                borderRadius: "3px",
                                background: "rgba(37, 96, 75, 0.15)",
                                color: "var(--color-primary, #25604b)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "2px",
                              }}
                            >
                              <Lock size={10} /> Protected
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(sig);
                          }}
                          aria-label={`Delete ${sig.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(tab === "draw" || tab === "type" || tab === "import") && (
            <div style={{ marginBottom: "12px", display: "flex", gap: "20px" }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
              >
                <input
                  type="radio"
                  name="sigType"
                  checked={sigType === "signature"}
                  onChange={() => setSigType("signature")}
                />
                Signature
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
              >
                <input
                  type="radio"
                  name="sigType"
                  checked={sigType === "initials"}
                  onChange={() => setSigType("initials")}
                />
                Initials
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "13px",
                  marginLeft: "auto",
                }}
              >
                <input
                  type="checkbox"
                  checked={sessionOnly}
                  onChange={(e) => setSessionOnly(e.target.checked)}
                />
                Session only (do not persist)
              </label>
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
                <button type="button" className="button-secondary" onClick={clearCanvas}>
                  Clear
                </button>
                <button type="button" className="button-primary" onClick={handleSaveDrawn}>
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
                  <span
                    style={{
                      fontFamily: "'Brush Script MT', cursive, sans-serif",
                      fontSize: "36px",
                    }}
                  >
                    {typedName}
                  </span>
                </div>
              )}
              <button
                type="button"
                className="button-primary"
                onClick={handleSaveTyped}
                disabled={!typedName.trim()}
              >
                Save Signature
              </button>
            </div>
          )}

          {tab === "import" && (
            <div style={{ textAlign: "center", padding: "24px 16px" }}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/svg+xml"
                style={{ display: "none" }}
                onChange={handleFileImport}
              />
              <button
                type="button"
                className="button-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} /> Choose Image File...
              </button>
              <p style={{ marginTop: "10px", fontSize: "12px", opacity: 0.7 }}>
                Supported formats: PNG, JPEG, SVG.
              </p>
            </div>
          )}

          {tab === "marks" && (
            <div className="quick-marks-grid">
              <button type="button" className="mark-card" onClick={() => handlePlaceMark("check")}>
                <Check size={24} />
                <span>Checkmark</span>
              </button>
              <button type="button" className="mark-card" onClick={() => handlePlaceMark("cross")}>
                <XIcon size={24} />
                <span>Cross</span>
              </button>
              <button type="button" className="mark-card" onClick={() => handlePlaceMark("dot")}>
                <Circle size={20} />
                <span>Dot</span>
              </button>
              <button type="button" className="mark-card" onClick={() => handlePlaceMark("box")}>
                <Square size={20} />
                <span>Box</span>
              </button>
              <button type="button" className="mark-card" onClick={() => handlePlaceMark("line")}>
                <Minus size={24} />
                <span>Line</span>
              </button>
            </div>
          )}

          {((tab === "library" && selectedSig) || tab === "marks") && (
            <div
              style={{
                marginTop: "16px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: "12px",
                padding: "12px",
                background: "rgba(0,0,0,0.03)",
                borderRadius: "6px",
              }}
            >
              <div>
                <label className="setting-title">Page</label>
                <PageNumberInput
                  value={targetPage}
                  max={s.info?.pages || 1}
                  onChange={setTargetPage}
                  className="text-input"
                />
              </div>
              <div>
                <label className="setting-title">X (pt)</label>
                <input
                  type="number"
                  value={posX}
                  onChange={(e) => setPosX(Number(e.target.value))}
                  className="text-input"
                />
              </div>
              <div>
                <label className="setting-title">Y From Top (pt)</label>
                <input
                  type="number"
                  value={posY}
                  onChange={(e) => setPosY(Number(e.target.value))}
                  className="text-input"
                />
              </div>
              {tab === "library" && (
                <div>
                  <label className="setting-title">Width (pt)</label>
                  <input
                    type="number"
                    min={40}
                    max={400}
                    value={sigWidth}
                    onChange={(e) => setSigWidth(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              )}
              {tab === "library" && (
                <div>
                  <label className="setting-title" htmlFor="signature-rotation">
                    Rotation (degrees)
                  </label>
                  <input
                    id="signature-rotation"
                    type="number"
                    min={-180}
                    max={180}
                    step={1}
                    value={sigRotation}
                    onChange={(e) => setSigRotation(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              )}
            </div>
          )}

          <div
            style={{
              marginTop: "12px",
              fontSize: "11px",
              opacity: 0.65,
              lineHeight: 1.4,
            }}
          >
            Notice: Signature appearances placed on the document are graphical representations, not
            cryptographic X.509 digital certificate signatures.
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {tab === "library" && selectedSig && (
            <button
              type="button"
              onClick={handlePlaceSignature}
              disabled={saving}
              className="button-primary"
            >
              {saving ? "Placing..." : "Place Signature"}
            </button>
          )}
        </div>
      </div>
    </FeatureDialog>
  );
}

import { useState, useEffect, useRef } from "react";
import {
  Scan,
  Check,
  Loader2,
  X,
  ShieldCheck,
  Copy,
  AlertTriangle,
  Layers,
  FileText,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  ocrGetEngineInfo,
  ocrRecognizePage,
} from "../../services/native";
import {
  applyOcrSearchableLayer,
  detectExistingText,
} from "../../services/document-commands";
import type { OcrEngineInfo, OcrPageResult } from "../../types/operations";
import { parsePageRange } from "../pages/print-range";

export function OcrPanel({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [engineInfo, setEngineInfo] = useState<OcrEngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [targetScope, setTargetScope] = useState<"current" | "all" | "range">("current");
  const [customRange, setCustomRange] = useState("");
  const [selectedLang, setSelectedLang] = useState("en-US");
  const [mode, setMode] = useState<"searchable" | "extract">("searchable");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [hasExistingWarning, setHasExistingWarning] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelledRef = useRef(false);

  const totalPages = s.info?.pages || 1;

  useEffect(() => {
    ocrGetEngineInfo().then((info) => {
      setEngineInfo(info);
      if (info.supportedLanguages.length > 0) {
        setSelectedLang(info.supportedLanguages[0]);
      }
    }).catch((err: unknown) => setEngineError(err instanceof Error ? err.message : String(err)));
    return () => { cancelledRef.current = true; };
  }, []);

  const getTargetPages = (): number[] => {
    if (targetScope === "current") {
      return [s.page - 1];
    }
    if (targetScope === "all") {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    return parsePageRange("custom", customRange, s.page, totalPages);
  };

  const handleStartOcr = async () => {
    if (!controller?.pdf || !engineInfo || s.info?.encrypted) return;
    const sourcePdf = controller.pdf;
    const sourceId = useWorkspace.getState().document?.id;
    const ensureCurrent = () => {
      if (cancelledRef.current) throw new Error("OCR cancelled. Document unchanged.");
      if (controller.pdf !== sourcePdf || useWorkspace.getState().document?.id !== sourceId) {
        throw new Error("Document changed during OCR. Result discarded.");
      }
    };
    cancelledRef.current = false;
    setRunning(true);
    setProgress(5);
    setStatusText("Preparing document pages...");
    setRecognizedText(null);
    setHasExistingWarning(false);

    try {
      const targetIndices = getTargetPages();
      if (targetIndices.length === 0) {
        throw new Error("No valid pages selected for OCR.");
      }

      const pdfBytes = await sourcePdf.saveDocument();
      ensureCurrent();

      // Check for existing text if not already confirmed
      if (!replaceExisting && mode === "searchable") {
        for (const idx of targetIndices) {
          const hasText = await detectExistingText(pdfBytes, idx);
          if (hasText) {
            setHasExistingWarning(true);
            setRunning(false);
            return;
          }
        }
      }

      const results: OcrPageResult[] = [];
      const textAccumulator: string[] = [];

      for (let i = 0; i < targetIndices.length; i++) {
        if (cancelledRef.current) {
          s.set({ status: "OCR processing cancelled by user." });
          return;
        }

        const pageIndex = targetIndices[i];
        const pageNum = pageIndex + 1;
        const pct = Math.round(((i) / targetIndices.length) * 85) + 5;
        setProgress(pct);
        setStatusText(`Recognizing page ${pageNum} of ${totalPages}...`);

        const page = await sourcePdf.getPage(pageNum);
        // Use unrotated crop coordinates so OCR boxes map back into PDF space.
        const viewport = page.getViewport({ scale: 2.0, rotation: 0 });
        if (viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(viewport.width * viewport.height) || viewport.width > 8192 || viewport.height > 8192 || viewport.width * viewport.height > 16_000_000) {
          throw new Error("This page exceeds the OCR image size limit.");
        }
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");

        let imageBytes: Uint8Array;
        try {
          if (!ctx) throw new Error("Unable to render the OCR page.");
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          ensureCurrent();
          const dataUrl = canvas.toDataURL("image/png");
          const encoded = dataUrl.split(",")[1];
          if (!encoded) throw new Error("Unable to encode the OCR page.");
          imageBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }

        const pageResult = await ocrRecognizePage(imageBytes, {
          pageIndex,
          language: selectedLang,
        });
        ensureCurrent();

        results.push(pageResult);
        textAccumulator.push(`--- Page ${pageNum} ---\n${pageResult.fullText}`);
      }

      setProgress(90);
      ensureCurrent();
      setStatusText("Applying searchable text layer...");

      if (mode === "searchable") {
        const updatedBytes = await applyOcrSearchableLayer(pdfBytes, results);
        ensureCurrent();
        await controller.replaceWithBytes(
          updatedBytes,
          `OCR Searchable Layer (${results.length} pages)`,
        );
        s.set({
          status: `OCR searchable layer successfully applied to ${results.length} page(s).`,
        });
        onClose();
      } else {
        const fullExtracted = textAccumulator.join("\n\n");
        setRecognizedText(fullExtracted);
        setProgress(100);
        setStatusText("Recognition complete.");
      }
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  const handleCopyText = async () => {
    if (!recognizedText) return;
    await navigator.clipboard.writeText(recognizedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Scan & OCR"
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Scan size={18} />
            <h3>Optical Character Recognition (OCR)</h3>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={running}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {engineError && <p role="alert">{engineError}</p>}
          {engineInfo && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                background: "var(--bg-secondary, #f4f5f7)",
                borderRadius: "6px",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            >
              <ShieldCheck size={16} color="#16a34a" />
              <span>
                <strong>{engineInfo.engineName}</strong> &bull; 100% Offline & Private
              </span>
            </div>
          )}

          {s.info?.encrypted && (
            <div
              role="alert"
              style={{
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                color: "#92400e",
                padding: "10px",
                borderRadius: "6px",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
                <AlertTriangle size={16} />
                <span>Encrypted Document</span>
              </div>
              <p style={{ marginTop: "4px" }}>
                OCR is disabled for password-protected and encrypted documents.
              </p>
            </div>
          )}

          {hasExistingWarning && (
            <div
              role="alert"
              style={{
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                color: "#92400e",
                padding: "10px",
                borderRadius: "6px",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
                <AlertTriangle size={16} />
                <span>Existing digital text detected</span>
              </div>
              <p style={{ marginTop: "4px" }}>
                Target pages already contain digital text. Original text stays in the PDF and may
                appear twice in search results. Only a previous NavPDF OCR layer is replaced.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                />
                <span>Add OCR alongside original text</span>
              </label>
            </div>
          )}

          <div className="setting-group">
            <label className="setting-title">Target Pages</label>
            <div className="tab-buttons-bar">
              <button
                className={targetScope === "current" ? "active" : ""}
                onClick={() => setTargetScope("current")}
                disabled={running}
              >
                Current Page ({s.page})
              </button>
              <button
                className={targetScope === "all" ? "active" : ""}
                onClick={() => setTargetScope("all")}
                disabled={running}
              >
                All Pages ({totalPages})
              </button>
              <button
                className={targetScope === "range" ? "active" : ""}
                onClick={() => setTargetScope("range")}
                disabled={running}
              >
                Custom Range
              </button>
            </div>
            {targetScope === "range" && (
              <input
                type="text"
                placeholder="e.g. 1-3, 5"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                style={{ marginTop: "8px" }}
                disabled={running}
              />
            )}
          </div>

          <div className="setting-group">
            <label className="setting-title">Recognition Language</label>
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value)}
              disabled={running}
            >
              {(engineInfo?.supportedLanguages || ["en-US"]).map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-group">
            <label className="setting-title">OCR Action</label>
            <div className="tab-buttons-bar">
              <button
                className={mode === "searchable" ? "active" : ""}
                onClick={() => setMode("searchable")}
                disabled={running}
              >
                <Layers size={14} /> Searchable PDF Layer
              </button>
              <button
                className={mode === "extract" ? "active" : ""}
                onClick={() => setMode("extract")}
                disabled={running}
              >
                <FileText size={14} /> Extract Text Only
              </button>
            </div>
            <p className="field-hint" style={{ marginTop: "6px" }}>
              {mode === "searchable"
                ? "Aligns invisible text over scanned images so words can be selected, copied, and searched without changing appearance."
                : "Extracts recognized text directly into plain text without modifying the PDF document."}
            </p>
          </div>

          {running && (
            <div className="ocr-progress-box" style={{ marginTop: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Loader2 size={18} className="spin" />
                <span>{statusText} ({progress}%)</span>
              </div>
              <div
                style={{
                  height: "4px",
                  background: "var(--border-color, #e5e7eb)",
                  borderRadius: "2px",
                  marginTop: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: "var(--primary, #2563eb)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            </div>
          )}

          {recognizedText && (
            <div className="ocr-result-box" style={{ marginTop: "12px" }}>
              <div className="result-header" style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Check size={16} /> <span>Recognized Text</span>
                </div>
                <button
                  onClick={handleCopyText}
                  className="button-secondary"
                  style={{ padding: "4px 8px", fontSize: "12px" }}
                >
                  <Copy size={13} /> {copied ? "Copied!" : "Copy Text"}
                </button>
              </div>
              <textarea
                readOnly
                value={recognizedText}
                rows={6}
                style={{ width: "100%", marginTop: "8px", fontSize: "12px", fontFamily: "monospace" }}
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          {running ? (
            <button
              onClick={() => {
                cancelledRef.current = true;
                setStatusText("Cancelling...");
              }}
              className="button-secondary"
            >
              Cancel OCR
            </button>
          ) : (
            <>
              <button onClick={onClose} className="button-secondary">
                {recognizedText ? "Done" : "Cancel"}
              </button>
              {!recognizedText && (
                <button
                  onClick={handleStartOcr}
                  disabled={
                    running ||
                    !engineInfo ||
                    (hasExistingWarning && !replaceExisting) ||
                    !!s.info?.encrypted
                  }
                  className="button-primary"
                >
                  {hasExistingWarning && replaceExisting
                    ? "Continue & Start OCR"
                    : mode === "searchable"
                      ? "Apply Searchable Layer"
                      : "Recognize Text"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

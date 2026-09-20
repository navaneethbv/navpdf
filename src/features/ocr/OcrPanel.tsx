import { useId, useState, useEffect, useRef } from "react";
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
import { ocrGetEngineInfo, ocrRecognizePage } from "../../services/native";
import { applyOcrSearchableLayer, detectExistingText } from "../../services/document-commands";
import type { OcrEngineInfo, OcrPageResult } from "../../types/operations";
import { parsePageRange } from "../pages/page-range";
import { FeatureDialog } from "../../components/FeatureDialog";

type PdfDocument = NonNullable<ViewerController["pdf"]>;

function pageWithinOcrLimit(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    Number.isFinite(width * height) &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 16_000_000
  );
}

async function pageImage(
  sourcePdf: PdfDocument,
  pageNumber: number,
  ensureCurrent: () => void,
): Promise<Uint8Array> {
  const page = await sourcePdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2.0, rotation: 0 });
  if (!pageWithinOcrLimit(viewport.width, viewport.height)) {
    throw new Error("This page exceeds the OCR image size limit.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to render the OCR page.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    ensureCurrent();
    const encoded = canvas.toDataURL("image/png").split(",")[1];
    if (!encoded) throw new Error("Unable to encode the OCR page.");
    return Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

interface RecognizeOcrPagesOptions {
  sourcePdf: PdfDocument;
  targetIndices: number[];
  totalPages: number;
  language: string;
  cancelled: () => boolean;
  ensureCurrent: () => void;
  onProgress: (value: number) => void;
  onStatus: (value: string) => void;
  onCancel: () => void;
}

async function recognizeOcrPages({
  sourcePdf,
  targetIndices,
  totalPages,
  language,
  cancelled,
  ensureCurrent,
  onProgress,
  onStatus,
  onCancel,
}: RecognizeOcrPagesOptions): Promise<{ results: OcrPageResult[]; text: string[] }> {
  const results: OcrPageResult[] = [];
  const text: string[] = [];
  for (let index = 0; index < targetIndices.length; index++) {
    if (cancelled()) {
      onCancel();
      return { results, text };
    }
    const pageIndex = targetIndices[index];
    const pageNumber = pageIndex + 1;
    onProgress(Math.round((index / targetIndices.length) * 85) + 5);
    onStatus(`Recognizing page ${pageNumber} of ${totalPages}...`);
    const imageBytes = await pageImage(sourcePdf, pageNumber, ensureCurrent);
    const result = await ocrRecognizePage(imageBytes, { pageIndex, language });
    ensureCurrent();
    results.push(result);
    text.push(`--- Page ${pageNumber} ---\n${result.fullText}`);
  }
  return { results, text };
}

function languageName(code: string): string {
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

type OcrTargetScope = "current" | "all" | "range";
type OcrMode = "searchable" | "extract";

function OcrErrorMessage({ error }: Readonly<{ error: string | null }>) {
  return error ? <p role="alert">{error}</p> : null;
}

function OcrEngineStatus({ info }: Readonly<{ info: OcrEngineInfo | null }>) {
  if (!info) return null;
  return (
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
        <strong>{info.engineName}</strong> &bull; {info.isOffline ? "100% Offline" : "Local"} &amp;
        Private
      </span>
    </div>
  );
}

function EncryptedDocumentNotice({ encrypted }: Readonly<{ encrypted: boolean }>) {
  if (!encrypted) return null;
  return (
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
  );
}

function ExistingTextWarning({
  visible,
  replaceExisting,
  onReplaceExistingChange,
}: Readonly<{
  visible: boolean;
  replaceExisting: boolean;
  onReplaceExistingChange: (value: boolean) => void;
}>) {
  if (!visible) return null;
  return (
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
        Target pages already contain digital text. Original text stays in the PDF and may appear
        twice in search results. Only a previous NavPDF OCR layer is replaced.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(event) => onReplaceExistingChange(event.target.checked)}
        />
        <span>Add OCR alongside original text</span>
      </label>
    </div>
  );
}

function TargetPageSettings({
  targetScope,
  customRange,
  currentPage,
  totalPages,
  running,
  onScopeChange,
  onCustomRangeChange,
}: Readonly<{
  targetScope: OcrTargetScope;
  customRange: string;
  currentPage: number;
  totalPages: number;
  running: boolean;
  onScopeChange: (scope: OcrTargetScope) => void;
  onCustomRangeChange: (value: string) => void;
}>) {
  return (
    <fieldset className="setting-group">
      <legend className="setting-title">Target Pages</legend>
      <div className="tab-buttons-bar">
        <button
          type="button"
          className={targetScope === "current" ? "active" : ""}
          aria-pressed={targetScope === "current"}
          onClick={() => onScopeChange("current")}
          disabled={running}
        >
          Current Page ({currentPage})
        </button>
        <button
          type="button"
          className={targetScope === "all" ? "active" : ""}
          aria-pressed={targetScope === "all"}
          onClick={() => onScopeChange("all")}
          disabled={running}
        >
          All Pages ({totalPages})
        </button>
        <button
          type="button"
          className={targetScope === "range" ? "active" : ""}
          aria-pressed={targetScope === "range"}
          onClick={() => onScopeChange("range")}
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
          onChange={(event) => onCustomRangeChange(event.target.value)}
          style={{ marginTop: "8px" }}
          disabled={running}
        />
      )}
    </fieldset>
  );
}

function OcrActionSettings({
  mode,
  running,
  onModeChange,
}: Readonly<{
  mode: OcrMode;
  running: boolean;
  onModeChange: (mode: OcrMode) => void;
}>) {
  return (
    <fieldset className="setting-group">
      <legend className="setting-title">OCR Action</legend>
      <div className="tab-buttons-bar">
        <button
          type="button"
          className={mode === "searchable" ? "active" : ""}
          aria-pressed={mode === "searchable"}
          onClick={() => onModeChange("searchable")}
          disabled={running}
        >
          <Layers size={14} /> Searchable PDF Layer
        </button>
        <button
          type="button"
          className={mode === "extract" ? "active" : ""}
          aria-pressed={mode === "extract"}
          onClick={() => onModeChange("extract")}
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
    </fieldset>
  );
}

function OcrProgress({
  running,
  statusText,
  progress,
}: Readonly<{ running: boolean; statusText: string; progress: number }>) {
  if (!running) return null;
  return (
    <div className="ocr-progress-box" style={{ marginTop: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Loader2 size={18} className="spin" />
        <span>
          {statusText} ({progress}%)
        </span>
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
  );
}

function OcrResult({
  recognizedText,
  copied,
  onCopy,
}: Readonly<{
  recognizedText: string | null;
  copied: boolean;
  onCopy: () => void;
}>) {
  if (!recognizedText) return null;
  return (
    <div className="ocr-result-box" style={{ marginTop: "12px" }}>
      <div className="result-header" style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Check size={16} /> <span>Recognized Text</span>
        </div>
        <button
          type="button"
          onClick={onCopy}
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
  );
}

function OcrFooter({
  running,
  recognizedText,
  replaceExisting,
  hasExistingWarning,
  actionLabel,
  canStart,
  onCancel,
  onClose,
  onStart,
}: Readonly<{
  running: boolean;
  recognizedText: string | null;
  replaceExisting: boolean;
  hasExistingWarning: boolean;
  actionLabel: string;
  canStart: boolean;
  onCancel: () => void;
  onClose: () => void;
  onStart: () => void;
}>) {
  if (running) {
    return (
      <button type="button" onClick={onCancel} className="button-secondary">
        Cancel OCR
      </button>
    );
  }
  return (
    <>
      <button type="button" onClick={onClose} className="button-secondary">
        {recognizedText ? "Done" : "Cancel"}
      </button>
      {!recognizedText && (
        <button type="button" onClick={onStart} disabled={!canStart} className="button-primary">
          {hasExistingWarning && replaceExisting ? "Continue & Start OCR" : actionLabel}
        </button>
      )}
    </>
  );
}

export function OcrPanel({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const s = useWorkspace();
  const [engineInfo, setEngineInfo] = useState<OcrEngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [targetScope, setTargetScope] = useState<"current" | "all" | "range">("current");
  const [customRange, setCustomRange] = useState("");
  const [selectedLang, setSelectedLang] = useState(s.local.preferences.ocrLanguage);
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
    ocrGetEngineInfo()
      .then((info) => {
        setEngineInfo(info);
        const preferred = s.local.preferences.ocrLanguage;
        setSelectedLang(
          info.supportedLanguages.includes(preferred)
            ? preferred
            : (info.supportedLanguages[0] ?? preferred),
        );
      })
      .catch((err: unknown) => setEngineError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelledRef.current = true;
    };
  }, [s.local.preferences.ocrLanguage]);

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

      const recognized = await recognizeOcrPages({
        sourcePdf,
        targetIndices,
        totalPages,
        language: selectedLang,
        cancelled: () => cancelledRef.current,
        ensureCurrent,
        onProgress: setProgress,
        onStatus: setStatusText,
        onCancel: () => s.set({ status: "OCR processing cancelled by user." }),
      });
      if (cancelledRef.current) return;
      const { results, text: textAccumulator } = recognized;

      setProgress(90);
      ensureCurrent();
      setStatusText("Applying searchable text layer...");

      if (mode === "searchable") {
        const updatedBytes = await applyOcrSearchableLayer(pdfBytes, results);
        ensureCurrent();
        await controller.replaceWithBytes(
          updatedBytes,
          `OCR Searchable Layer (${results.length} pages)`,
          { expectedSource: sourcePdf },
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

  const ocrActionLabel = mode === "searchable" ? "Apply Searchable Layer" : "Recognize Text";
  return (
    <FeatureDialog title="Scan & OCR" onClose={onClose} busy={running}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Scan size={18} />
            <h3>Optical Character Recognition (OCR)</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={running}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <OcrErrorMessage error={engineError} />
          <OcrEngineStatus info={engineInfo} />
          <EncryptedDocumentNotice encrypted={!!s.info?.encrypted} />
          <ExistingTextWarning
            visible={hasExistingWarning}
            replaceExisting={replaceExisting}
            onReplaceExistingChange={setReplaceExisting}
          />

          <TargetPageSettings
            targetScope={targetScope}
            customRange={customRange}
            currentPage={s.page}
            totalPages={totalPages}
            running={running}
            onScopeChange={setTargetScope}
            onCustomRangeChange={setCustomRange}
          />

          <div className="setting-group">
            <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
              Recognition Language
            </label>
            <select
              id={`${fieldIds}-field-1`}
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value)}
              disabled={running}
            >
              {(engineInfo?.supportedLanguages || ["en-US"]).map((lang) => (
                <option key={lang} value={lang}>
                  {languageName(lang)}
                </option>
              ))}
            </select>
          </div>

          <OcrActionSettings mode={mode} running={running} onModeChange={setMode} />
          <OcrProgress running={running} statusText={statusText} progress={progress} />
          <OcrResult
            recognizedText={recognizedText}
            copied={copied}
            onCopy={() => {
              void handleCopyText();
            }}
          />
        </div>

        <div className="modal-footer">
          <OcrFooter
            running={running}
            recognizedText={recognizedText}
            replaceExisting={replaceExisting}
            hasExistingWarning={hasExistingWarning}
            actionLabel={ocrActionLabel}
            canStart={
              !!engineInfo && !(hasExistingWarning && !replaceExisting) && !s.info?.encrypted
            }
            onCancel={() => {
              cancelledRef.current = true;
              setStatusText("Cancelling...");
            }}
            onClose={onClose}
            onStart={() => {
              void handleStartOcr();
            }}
          />
        </div>
      </div>
    </FeatureDialog>
  );
}

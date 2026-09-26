import { compressToTarget } from "./target-size";
import { loadPdfFromBytes } from "../../services/pdf";
import { PdfPagePreview } from "../viewer/PdfPagePreview";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Minimize2, X, XCircle } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { native } from "../../services/native";
import {
  cancelEngineJob,
  compressDocument,
  ENGINE_UNAVAILABLE,
  newJobId,
} from "../../services/engine";
import type { CompressionPreset, CompressionReport, EngineResult } from "../../types/engine";
import { FeatureDialog } from "../../components/FeatureDialog";

const PRESETS: { id: CompressionPreset; label: string; description: string }[] = [
  {
    id: "lossless",
    label: "Lossless",
    description:
      "Removes unused and duplicate objects and compresses streams. Images are untouched.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Also downsamples images stored above 150 dpi and re-encodes them when smaller.",
  },
  {
    id: "small",
    label: "Smallest",
    description:
      "Downsamples images above 96 dpi with lower JPEG quality. Image detail is reduced.",
  },
];

export function formatBytes(bytes: number) {
  const size = Math.abs(bytes);
  const sign = bytes < 0 ? "-" : "";
  if (size < 1024) return `${sign}${size} B`;
  if (size < 1024 * 1024) return `${sign}${(size / 1024).toFixed(1)} KB`;
  return `${sign}${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function CompressDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const s = useWorkspace();
  const [preset, setPreset] = useState<CompressionPreset>("balanced");
  const [targetMode, setTargetMode] = useState(false);
  const [targetMb, setTargetMb] = useState(2);
  const [measuredTarget, setMeasuredTarget] = useState<number | null>(null);
  const [preview, setPreview] = useState<PDFDocumentProxy | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const [result, setResult] = useState<EngineResult<CompressionReport> | null>(null);
  const job = useRef<string | null>(null);
  const resultSource = useRef(controller?.pdf);
  const report = result?.report;
  const retainedSize = result?.bytes?.length ?? report?.beforeBytes ?? 0;

  useEffect(() => {
    if (!result?.bytes) {
      setPreview(null);
      return;
    }
    let alive = true;
    const task = loadPdfFromBytes(new Uint8Array(result.bytes));
    void task.promise
      .then((pdf) => {
        if (alive) {
          setPreview(pdf);
          setPreviewError("");
        }
      })
      .catch((error) => {
        if (alive) setPreviewError(String(error));
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [result]);
  useEffect(
    () => () => {
      if (job.current) void cancelEngineJob(job.current);
      job.current = null;
    },
    [],
  );

  const analyze = async () => {
    const pdf = controller?.pdf;
    if (!controller || !pdf) return;
    const jobId = newJobId();
    job.current = jobId;
    setRunning(true);
    setResult(null);
    try {
      controller.editor?.commitOrRemove();
      const bytes = await pdf.saveDocument();
      const target = Math.round(targetMb * 1_000_000);
      if (targetMode && (!Number.isFinite(targetMb) || targetMb < 0.001024 || targetMb > 1000))
        throw new Error("Enter a target between 0.001024 and 1,000 MB.");
      const outcome = targetMode
        ? await compressToTarget(
            bytes,
            target,
            (original, candidate) => compressDocument(original, candidate, jobId),
            () => job.current !== jobId,
          )
        : await compressDocument(bytes, preset, jobId);
      if (job.current === jobId) {
        resultSource.current = pdf;
        setMeasuredTarget(targetMode ? target : null);
        setPreviewPage(1);
        setResult(outcome);
      }
    } catch (error) {
      if (job.current === jobId)
        s.set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (job.current === jobId) {
        job.current = null;
        setRunning(false);
      }
    }
  };

  const cancel = () => {
    if (job.current) void cancelEngineJob(job.current);
    job.current = null;
    setRunning(false);
    s.set({ status: "Compression cancelled. The document is unchanged." });
  };

  const apply = async () => {
    if (applyingRef.current || !controller || !result?.bytes || !report) return;
    applyingRef.current = true;
    setApplying(true);
    try {
      const saved = report.beforeBytes - report.afterBytes;
      const label = PRESETS.find((item) => item.id === report.preset)?.label ?? "";
      await controller.replaceWithBytes(
        result.bytes,
        `Compressed (${label}): saved ${formatBytes(saved)}`,
        { expectedSource: resultSource.current },
      );
      onClose();
    } catch (error) {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  const change = report ? report.afterBytes - report.beforeBytes : 0;

  const renderAction = () => {
    if (running)
      return (
        <button type="button" onClick={cancel} className="button-secondary">
          Cancel Analysis
        </button>
      );
    if (result?.bytes)
      return (
        <button
          type="button"
          onClick={() => void apply()}
          disabled={applying}
          className="button-primary"
        >
          <Check size={16} /> Apply Compressed Version
        </button>
      );
    return (
      <button
        type="button"
        onClick={() => void analyze()}
        disabled={!native || !controller?.pdf}
        className="button-primary"
      >
        <Minimize2 size={16} /> Analyze Compression
      </button>
    );
  };
  let targetStatus = "Target met.";
  if (measuredTarget !== null && retainedSize >= measuredTarget) {
    targetStatus = result?.bytes
      ? "Target could not be met with the available presets. The smallest safe result is shown."
      : "Target could not be met. No smaller safe copy is available; the original is retained.";
  }
  return (
    <FeatureDialog title="Compress PDF" onClose={onClose} busy={running || applying}>
      <div className="modal-dialog wide-tool-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Minimize2 size={18} />
            <h3>Compress PDF</h3>
          </div>
          <button
            className="icon-button"
            disabled={running || applying}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {!native && (
            <div className="warning-banner">
              <AlertTriangle size={18} />
              <span>{ENGINE_UNAVAILABLE}</span>
            </div>
          )}
          <fieldset disabled={running || applying}>
            <label>
              <input
                type="checkbox"
                checked={targetMode}
                onChange={(event) => {
                  setTargetMode(event.target.checked);
                  setResult(null);
                }}
              />{" "}
              Compress to a target size
            </label>
            {targetMode && (
              <div className="target-compression-options">
                <label>
                  Under (MB, 1 MB = 1,000,000 bytes){" "}
                  <input
                    className="text-input"
                    type="number"
                    min={0.001024}
                    max={1000}
                    step={0.1}
                    value={targetMb}
                    onChange={(event) => {
                      setTargetMb(Number(event.target.value));
                      setResult(null);
                    }}
                  />
                </label>
                <span className="field-hint">
                  Tries lossless, balanced, then smallest. Uses the clearest measured result under
                  the limit.
                </span>
                {[2, 5, 10].map((size) => (
                  <button
                    type="button"
                    className="button-secondary"
                    key={size}
                    onClick={() => {
                      setTargetMb(size);
                      setResult(null);
                    }}
                  >
                    Under {size} MB
                  </button>
                ))}
              </div>
            )}
          </fieldset>
          {!targetMode && (
            <fieldset className="preset-list" disabled={running || applying}>
              <legend className="setting-title">Compression preset</legend>
              {PRESETS.map((item) => (
                <label key={item.id} className="preset-option">
                  <input
                    type="radio"
                    name="compression-preset"
                    checked={preset === item.id}
                    onChange={() => {
                      setPreset(item.id);
                      setResult(null);
                    }}
                  />
                  <span>
                    {item.label}
                    <span className="field-hint">{item.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {running && (
            <p className="field-hint" aria-live="polite">
              Measuring a compressed copy and checking text, forms, fonts, links and images…
            </p>
          )}

          {report && measuredTarget !== null && (
            <output className={retainedSize < measuredTarget ? "field-hint" : "warning-banner"}>
              {targetStatus} Limit: {measuredTarget.toLocaleString()} bytes.
            </output>
          )}
          {previewError && <p role="alert">Preview unavailable: {previewError}</p>}
          {preview && resultSource.current && (
            <section aria-label="Compression quality preview">
              <label>
                Preview page{" "}
                <input
                  className="text-input"
                  type="number"
                  min={1}
                  max={preview.numPages}
                  value={previewPage}
                  onChange={(event) =>
                    setPreviewPage(
                      Math.min(preview.numPages, Math.max(1, Number(event.target.value))),
                    )
                  }
                />
              </label>
              <div className="pdf-comparison">
                <PdfPagePreview pdf={resultSource.current} page={previewPage} label="Original" />
                <PdfPagePreview pdf={preview} page={previewPage} label="Compressed" />
              </div>
            </section>
          )}
          {report && (
            <div className="compress-results-card" aria-live="polite">
              <p>Measured preset: {PRESETS.find((item) => item.id === report.preset)?.label}</p>
              <div className="result-row">
                <span>Current size</span>
                <strong>
                  {formatBytes(report.beforeBytes)} ({report.beforeBytes.toLocaleString()} bytes)
                </strong>
              </div>
              <div className="result-row">
                <span>Compressed size</span>
                <strong>
                  {formatBytes(report.afterBytes)} ({report.afterBytes.toLocaleString()} bytes)
                </strong>
              </div>
              <div className="result-row">
                <span>Change</span>
                <strong>
                  {formatBytes(change)} (
                  {report.beforeBytes ? ((change / report.beforeBytes) * 100).toFixed(1) : "0.0"}
                  %)
                </strong>
              </div>
              <p className="field-hint">
                Images examined: {report.imagesExamined}, recompressed: {report.imagesRecompressed},
                left unchanged: {report.imagesSkipped}. Duplicate streams merged:{" "}
                {report.duplicateStreamsMerged}. Unused objects removed:{" "}
                {report.unusedObjectsRemoved}.
              </p>
              <ul className="check-list" aria-label="Fidelity checks">
                {report.checks.map((check) => (
                  <li key={check.name} className={check.passed ? "passed" : "failed"}>
                    {check.passed ? <Check size={14} /> : <XCircle size={14} />}
                    <span>
                      {check.name}: {check.detail}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={result?.bytes ? "field-hint" : "error-text"}>{report.message}</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="button-secondary"
            disabled={running || applying}
          >
            {report ? "Done" : "Close"}
          </button>
          {renderAction()}
        </div>
      </div>
    </FeatureDialog>
  );
}

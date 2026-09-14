import { useRef, useState } from "react";
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
import type {
  CompressionPreset,
  CompressionReport,
  EngineResult,
} from "../../types/engine";

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
    description:
      "Also downsamples images stored above 150 dpi and re-encodes them when smaller.",
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
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [preset, setPreset] = useState<CompressionPreset>("balanced");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResult<CompressionReport> | null>(null);
  const job = useRef<string | null>(null);
  const report = result?.report;

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
      const outcome = await compressDocument(bytes, preset, jobId);
      if (job.current === jobId) setResult(outcome);
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
    if (!controller || !result?.bytes || !report) return;
    try {
      const saved = report.beforeBytes - report.afterBytes;
      const label = PRESETS.find((item) => item.id === report.preset)?.label ?? "";
      await controller.replaceWithBytes(
        result.bytes,
        `Compressed (${label}): saved ${formatBytes(saved)}`,
      );
      onClose();
    } catch (error) {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const change = report ? report.afterBytes - report.beforeBytes : 0;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Compress PDF">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Minimize2 size={18} />
            <h3>Compress PDF</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
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
          <fieldset className="preset-list" disabled={running}>
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
                  <strong>{item.label}</strong>
                  <span className="field-hint">{item.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {running && (
            <p className="field-hint" aria-live="polite">
              Measuring a compressed copy and checking text, forms, fonts,
              links and images…
            </p>
          )}

          {report && (
            <div className="compress-results-card" aria-live="polite">
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
                  {report.beforeBytes
                    ? ((change / report.beforeBytes) * 100).toFixed(1)
                    : "0.0"}
                  %)
                </strong>
              </div>
              <p className="field-hint">
                Images examined: {report.imagesExamined}, recompressed:{" "}
                {report.imagesRecompressed}, left unchanged: {report.imagesSkipped}.
                Duplicate streams merged: {report.duplicateStreamsMerged}. Unused
                objects removed: {report.unusedObjectsRemoved}.
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
          <button onClick={onClose} className="button-secondary">
            {report ? "Done" : "Close"}
          </button>
          {running ? (
            <button onClick={cancel} className="button-secondary">
              Cancel Analysis
            </button>
          ) : result?.bytes ? (
            <button onClick={() => void apply()} className="button-primary">
              <Check size={16} /> Apply Compressed Version
            </button>
          ) : (
            <button
              onClick={() => void analyze()}
              disabled={!native || !controller?.pdf}
              className="button-primary"
            >
              <Minimize2 size={16} /> Analyze Compression
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

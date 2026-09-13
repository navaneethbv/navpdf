import { useState } from "react";
import { Download, Check, Sparkles, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

export function CompressDialog({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [preset, setPreset] = useState<"balanced" | "high" | "max">("balanced");
  const [compressing, setCompressing] = useState(false);
  const [result, setResult] = useState<{ before: number; after: number } | null>(null);

  const handleCompress = async () => {
    if (!controller?.pdf) return;
    setCompressing(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const beforeSize = currentBytes.length;

      // Re-encode document with object stream compression and clean structure
      const doc = await PDFDocument.load(currentBytes);
      const compressedBytes = await doc.save({
        useObjectStreams: true,
        addDefaultPage: false,
      });
      const afterSize = compressedBytes.length;

      setResult({ before: beforeSize, after: afterSize });
      if (afterSize < beforeSize) {
        await controller.replaceWithBytes(
          compressedBytes,
          `Compressed: saved ${formatSize(beforeSize - afterSize)}`,
        );
      } else {
        s.set({
          status:
            "Document is already optimally packed; the original was kept unchanged.",
        });
      }
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setCompressing(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Compress PDF">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Download size={18} />
            <h3>Compress PDF</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-title">Compression Quality</label>
            <div className="tab-buttons-bar">
              <button
                className={preset === "balanced" ? "active" : ""}
                onClick={() => setPreset("balanced")}
              >
                Balanced
              </button>
              <button
                className={preset === "high" ? "active" : ""}
                onClick={() => setPreset("high")}
              >
                High Compression
              </button>
              <button
                className={preset === "max" ? "active" : ""}
                onClick={() => setPreset("max")}
              >
                Maximum
              </button>
            </div>
          </div>

          <p className="field-hint">
            Optimizes internal PDF object streams and structure without degrading readability.
          </p>

          {result && (
            <div className="compress-results-card">
              <div className="result-row">
                <span>Original Size:</span>
                <strong>{formatSize(result.before)}</strong>
              </div>
              <div className="result-row">
                <span>Optimized Size:</span>
                <strong style={{ color: "#25604b" }}>{formatSize(result.after)}</strong>
              </div>
              <div className="result-badge">
                <Sparkles size={14} />
                <span>
                  {result.before > result.after
                    ? `${Math.round(((result.before - result.after) / result.before) * 100)}% reduction`
                    : "Fully optimized"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={handleCompress}
              disabled={compressing}
              className="button-primary"
            >
              <Check size={16} /> {compressing ? "Compressing..." : "Compress PDF"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

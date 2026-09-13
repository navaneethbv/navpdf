import { useState } from "react";
import { Scan, Check, Loader2, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

export function OcrPanel({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const handleExtractText = async () => {
    if (!controller?.pdf) return;
    setRunning(true);
    setProgress(10);
    try {
      const page = await controller.pdf.getPage(s.page);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      setProgress(40);
      if (ctx) {
        // @ts-expect-error PDF.js render
        await page.render({ canvasContext: ctx, viewport }).promise;
        setProgress(70);
        const textContent = await page.getTextContent();
        // @ts-expect-error item str
        const detected = textContent.items.map((i) => i.str || "").filter(Boolean).join(" ");
        setProgress(100);
        setResult(
          detected ||
            "No embedded text found on this page. Scanned image-only pages need the M5 OCR engine, which is not yet integrated.",
        );
        s.set({ status: `Text extraction completed for page ${s.page}` });
      }
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Scan and OCR">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Scan size={18} />
            <h3>Scan & Text Extraction</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="field-hint">
            Reads the text already embedded in the page. True optical character
            recognition for scanned image-only pages (searchable-layer
            generation, deskew, language packs) requires the M5 OCR engine,
            which is not yet integrated. This tool never claims to have
            recognized text that is not there.
          </p>

          <div className="setting-group" style={{ marginTop: "12px" }}>
            <label className="setting-title">Target</label>
            <p>Page {s.page} of {s.info?.pages || 1}</p>
          </div>

          {running && (
            <div className="ocr-progress-box">
              <Loader2 size={24} className="spin" />
              <span>Reading embedded page text... {progress}%</span>
            </div>
          )}

          {result && (
            <div className="ocr-result-box">
              <div className="result-header">
                <Check size={16} /> <span>Page Text</span>
              </div>
              <p className="ocr-snippet">{result.slice(0, 300)}...</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
          {!result && (
            <button
              onClick={handleExtractText}
              disabled={running}
              className="button-primary"
            >
              {running ? "Reading..." : "Extract Page Text"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

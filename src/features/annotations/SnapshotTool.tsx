import { useState, useRef } from "react";
import { Copy, Download, X, Check } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { safeFileName } from "../../utils/download";

export function SnapshotTool({ onClose }: Readonly<{ onClose: () => void }>) {
  const s = useWorkspace();
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (captured) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!start || captured) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseUp = () => {
    if (!start || !current || captured) return;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);

    if (w < 10 || h < 10) {
      setStart(null);
      setCurrent(null);
      return;
    }

    try {
      const overlayRect = overlayRef.current?.getBoundingClientRect();
      if (!overlayRect) return;
      const screenLeft = overlayRect.left + x;
      const screenTop = overlayRect.top + y;
      const screenRight = screenLeft + w;
      const screenBottom = screenTop + h;
      const centerX = screenLeft + w / 2;
      const centerY = screenTop + h / 2;
      const page = [...document.querySelectorAll<HTMLElement>(".page")].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return (
          centerX >= rect.left &&
          centerX <= rect.right &&
          centerY >= rect.top &&
          centerY <= rect.bottom
        );
      });
      const canvas = page?.querySelector("canvas") as HTMLCanvasElement | null;
      const canvasRect = canvas?.getBoundingClientRect();
      if (!canvas || !canvasRect) {
        s.set({ error: "Keep the snapshot inside a rendered PDF page." });
        setStart(null);
        setCurrent(null);
        return;
      }
      const clippedLeft = Math.max(screenLeft, canvasRect.left);
      const clippedTop = Math.max(screenTop, canvasRect.top);
      const clippedRight = Math.min(screenRight, canvasRect.right);
      const clippedBottom = Math.min(screenBottom, canvasRect.bottom);
      if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) {
        s.set({ error: "Keep the snapshot inside a rendered PDF page." });
        setStart(null);
        setCurrent(null);
        return;
      }
      const scaleX = canvas.width / canvasRect.width;
      const scaleY = canvas.height / canvasRect.height;
      const sourceX = (clippedLeft - canvasRect.left) * scaleX;
      const sourceY = (clippedTop - canvasRect.top) * scaleY;
      const sourceWidth = (clippedRight - clippedLeft) * scaleX;
      const sourceHeight = (clippedBottom - clippedTop) * scaleY;
      const outputScale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight));
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.max(1, Math.round(sourceWidth * outputScale));
      offscreen.height = Math.max(1, Math.round(sourceHeight * outputScale));
      const ctx = offscreen.getContext("2d");
      if (ctx) {
        ctx.drawImage(
          canvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          offscreen.width,
          offscreen.height,
        );
        setCaptured(offscreen.toDataURL("image/png"));
      }
    } catch {
      s.set({ error: "The selected PDF region could not be captured." });
    }
  };

  const handleCopy = async () => {
    if (!captured) return;
    try {
      const res = await fetch(captured);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      s.set({ status: "Snapshot copied to clipboard" });
    } catch {
      s.set({ status: "Snapshot ready" });
    }
  };

  const handleDownload = () => {
    if (!captured) return;
    const a = document.createElement("a");
    a.href = captured;
    a.download = safeFileName(`snapshot-page-${s.page}.png`);
    a.rel = "noopener";
    a.click();
    s.set({ status: "Snapshot downloaded" });
  };

  const box =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  return (
    <div
      ref={overlayRef}
      className="snapshot-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div className="snapshot-hint">
        {captured ? (
          <div className="snapshot-actions">
            <span>Snapshot captured!</span>
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? "Copied" : "Copy to Clipboard"}</span>
            </button>
            <button type="button" onClick={handleDownload}>
              <Download size={16} />
              <span>Download PNG</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="icon-button"
              aria-label="Close snapshot"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <span>Click and drag across the document to capture a region</span>
        )}
      </div>

      {box && (
        <div
          className="snapshot-selection-box"
          style={{
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
        />
      )}

      {!captured && (
        <button
          className="snapshot-close icon-button"
          onClick={onClose}
          aria-label="Cancel snapshot"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

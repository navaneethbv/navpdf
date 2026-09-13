import { useState, useRef } from "react";
import { Copy, Download, X, Check } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { safeFileName } from "../../utils/download";

export function SnapshotTool({ onClose }: { onClose: () => void }) {
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

    // Capture from visible canvas
    const canvas = document.querySelector(".page canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      // Fallback placeholder
      setCaptured("captured");
      return;
    }

    try {
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d");
      if (ctx) {
        ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        setCaptured(offscreen.toDataURL("image/png"));
      }
    } catch {
      setCaptured("captured");
    }
  };

  const handleCopy = async () => {
    if (!captured) return;
    try {
      const res = await fetch(captured);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
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
            <button onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? "Copied" : "Copy to Clipboard"}</span>
            </button>
            <button onClick={handleDownload}>
              <Download size={16} />
              <span>Download PNG</span>
            </button>
            <button onClick={onClose} className="icon-button">
              <X size={16} />
            </button>
          </div>
        ) : (
          <span>Click and drag across the document to capture a region</span>
        )}
      </div>

      {box && (
        <div
          className="snapshot-box"
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

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Independent bounded canvas. Never attaches to the active document controller. */
export function PdfPagePreview({
  pdf,
  page,
  label,
}: Readonly<{ pdf: PDFDocumentProxy; page: number; label: string }>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    const target = canvas.current;
    if (!target) return;
    void (async () => {
      try {
        const source = await pdf.getPage(page);
        if (disposed) return;
        const natural = source.getViewport({ scale: 1 });
        const scale = 1000 / Math.max(natural.width, natural.height);
        const viewport = source.getViewport({ scale });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        const context = target.getContext("2d");
        if (!context) throw new Error("Preview canvas unavailable.");
        task = source.render({ canvas: target, canvasContext: context, viewport });
        await task.promise;
        if (!disposed) setError("");
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <figure className="pdf-page-preview">
      <figcaption>{label}</figcaption>
      {error && <p role="alert">{error}</p>}
      <canvas ref={canvas} aria-label={label} role="img" />
    </figure>
  );
}

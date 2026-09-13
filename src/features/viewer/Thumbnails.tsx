import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "./controller";
const ROW = 187;
export function Thumbnails({ controller }: { controller: ViewerController }) {
  const page = useWorkspace((s) => s.page),
    count = useWorkspace((s) => s.info?.pages || 0);
  const [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(650);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const resize = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && (page - 1) * ROW < el.scrollTop) el.scrollTop = (page - 1) * ROW;
    else if (el && page * ROW > el.scrollTop + el.clientHeight)
      el.scrollTop = page * ROW - el.clientHeight;
  }, [page]);
  const start = Math.max(0, Math.floor(scroll / ROW) - 2),
    end = Math.min(count, Math.ceil((scroll + height) / ROW) + 2);
  return (
    <div
      className="thumbnail-list"
      ref={ref}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      aria-label="Page thumbnails"
    >
      <div style={{ height: count * ROW, position: "relative" }}>
        {Array.from({ length: end - start }, (_, i) => start + i).map((i) => (
          <button
            key={i}
            className={`thumbnail ${page === i + 1 ? "selected" : ""}`}
            style={{ position: "absolute", top: i * ROW, height: ROW }}
            aria-label={`Go to page ${i + 1}`}
            aria-current={page === i + 1 ? "page" : undefined}
            onClick={() => controller.goTo(i + 1)}
          >
            <ThumbCanvas pdf={controller.pdf!} page={i + 1} />
            <span>{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
function ThumbCanvas({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false,
      render: RenderTask | undefined;
    const canvas = ref.current!;
    void pdf
      .getPage(page)
      .then((p) => {
        if (cancelled) return;
        const original = p.getViewport({ scale: 1 }),
          viewport = p.getViewport({
            scale: Math.min(128 / original.width, 151 / original.height) * 1.5,
          });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        render = p.render({ canvas, viewport, annotationMode: 1 });
        return render.promise;
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "RenderingCancelledException")
          setFailed(true);
      });
    return () => {
      cancelled = true;
      render?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, page]);
  return (
    <div className="thumb-paper">
      {failed ? (
        <span>Preview unavailable</span>
      ) : (
        <canvas ref={ref} aria-hidden="true" />
      )}
    </div>
  );
}

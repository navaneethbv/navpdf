import { useEffect, useRef } from "react";
import { ViewerController } from "./controller";
import { useWorkspace } from "../../stores/workspace";
import { ShapeTool } from "../annotations/ShapeTool";
import { AnnotationSelectionLayer } from "../annotations/AnnotationSelectionLayer";
export function ViewerHost({
  onReady,
  controller,
}: {
  onReady: (controller: ViewerController) => void;
  controller?: ViewerController | null;
}) {
  const container = useRef<HTMLDivElement>(null),
    pages = useRef<HTMLDivElement>(null);
  const tool = useWorkspace((s) => s.tool),
    busy = useWorkspace((s) => s.busy),
    hasDocument = useWorkspace((s) => !!s.document);
  useEffect(() => {
    const el = container.current!,
      controller = new ViewerController(el, pages.current!);
    onReady(controller);
    let needsFit = true;
    const resize = new ResizeObserver(() => {
      if (el.clientWidth <= 0 || el.clientHeight <= 0) {
        needsFit = true;
        return;
      }
      if (!controller.pdf) return;
      // The first document is attached while this frame is hidden. Fit only
      // once it has real dimensions, then preserve the user's zoom on resize.
      if (needsFit || controller.viewer.currentScale <= 0) {
        controller.zoom(useWorkspace.getState().local.preferences.defaultZoom);
      }
      needsFit = false;
      controller.viewer.update();
    });
    resize.observe(el);
    const abort = new AbortController();
    let pan: { x: number; y: number; left: number; top: number } | null = null;
    el.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (!useWorkspace.getState().busy)
            controller.zoom(controller.viewer.currentScale * Math.exp(-event.deltaY * 0.008));
        }
      },
      { passive: false, signal: abort.signal },
    );
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (useWorkspace.getState().tool !== "hand" || useWorkspace.getState().busy) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        pan = {
          x: e.clientX,
          y: e.clientY,
          left: el.scrollLeft,
          top: el.scrollTop,
        };
      },
      { signal: abort.signal },
    );
    el.addEventListener(
      "pointermove",
      (e) => {
        if (pan) {
          el.scrollLeft = pan.left - (e.clientX - pan.x);
          el.scrollTop = pan.top - (e.clientY - pan.y);
        }
      },
      { signal: abort.signal },
    );
    el.addEventListener(
      "pointerup",
      () => {
        pan = null;
      },
      { signal: abort.signal },
    );
    el.addEventListener(
      "pointercancel",
      () => {
        pan = null;
      },
      { signal: abort.signal },
    );
    return () => {
      resize.disconnect();
      abort.abort();
      controller.destroy();
    };
  }, [onReady]);
  return (
    <div className={`viewer-frame ${hasDocument ? "" : "hidden"}`}>
      <div
        className={`pdf-container ${tool === "hand" ? "hand-tool" : ""}`}
        ref={container}
        tabIndex={0}
        aria-label="PDF document"
        inert={busy}
      >
        <div ref={pages} className="pdfViewer" />
      </div>
      {hasDocument && tool === "shape" && controller && <ShapeTool controller={controller} />}
      {hasDocument && tool === "select" && controller && (
        <AnnotationSelectionLayer controller={controller} />
      )}
    </div>
  );
}

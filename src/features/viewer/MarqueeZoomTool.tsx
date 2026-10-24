import { useEffect, useRef, useState } from "react";
import type { ViewerController } from "./controller";
import { useWorkspace } from "../../stores/workspace";
import { pageAt } from "../annotations/page-pointer";

interface Drag {
  pointerId: number;
  page: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

/**
 * Marquee zoom: drag a rectangle to fill the window with it, click to zoom in one step, or
 * Alt-click (Option-click) to zoom out. Escape returns to the Select tool.
 */
export function MarqueeZoomTool({ controller }: Readonly<{ controller: ViewerController }>) {
  const overlay = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    overlay.current?.focus();
  }, []);

  const frame = overlay.current?.getBoundingClientRect();
  const box =
    drag && frame
      ? {
          left: Math.min(drag.start.x, drag.current.x) - frame.left,
          top: Math.min(drag.start.y, drag.current.y) - frame.top,
          width: Math.abs(drag.current.x - drag.start.x),
          height: Math.abs(drag.current.y - drag.start.y),
        }
      : null;

  return (
    <div
      ref={overlay}
      className="shape-tool-overlay marquee-zoom-overlay"
      role="application"
      aria-label="Marquee zoom: drag an area to fill the window, click to zoom in, Option-click to zoom out, Escape to stop"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          useWorkspace.getState().set({ tool: "select" });
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !controller.pdf) return;
        const page = pageAt(event.clientX, event.clientY);
        if (!page) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = { x: event.clientX, y: event.clientY };
        setDrag({
          pointerId: event.pointerId,
          page: Number(page.dataset.pageNumber),
          start: point,
          current: point,
        });
      }}
      onPointerMove={(event) => {
        if (drag?.pointerId === event.pointerId)
          setDrag({ ...drag, current: { x: event.clientX, y: event.clientY } });
      }}
      onPointerUp={(event) => {
        if (drag?.pointerId !== event.pointerId) return;
        setDrag(null);
        controller.zoomToArea(
          drag.page,
          drag.start,
          { x: event.clientX, y: event.clientY },
          event.altKey,
        );
      }}
      onPointerCancel={() => setDrag(null)}
      onWheel={(event) => {
        controller.container.scrollBy(event.deltaX, event.deltaY);
      }}
    >
      {box && <div className="shape-preview" style={box} />}
    </div>
  );
}

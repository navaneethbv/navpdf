import { useEffect, useRef, useState } from "react";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import { pageAt } from "./page-pointer";
import { useOverlayEvents } from "./overlay-events";

interface Stroke {
  pointerId: number;
  page: number;
  points: { x: number; y: number }[];
}

/**
 * Ink eraser: drag over freehand drawings to cut them where the eraser passes. Each drag is one
 * undoable change. Escape returns to the Select tool.
 */
export function EraserTool({ controller }: Readonly<{ controller: ViewerController }>) {
  const overlay = useRef<HTMLDivElement>(null);
  const size = useWorkspace((s) => s.eraserSize);
  const [stroke, setStroke] = useState<Stroke | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    overlay.current?.focus();
  }, []);

  const frame = overlay.current?.getBoundingClientRect();
  const local = (point: { x: number; y: number }) => ({
    x: point.x - (frame?.left ?? 0),
    y: point.y - (frame?.top ?? 0),
  });

  useOverlayEvents(overlay, {
    keydown: (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        useWorkspace.getState().set({ tool: "select" });
      }
    },
    pointerdown: (event) => {
      if (event.button !== 0 || !controller.pdf || useWorkspace.getState().busy) return;
      const page = pageAt(event.clientX, event.clientY);
      if (!page) return;
      event.preventDefault();
      overlay.current?.setPointerCapture?.(event.pointerId);
      setStroke({
        pointerId: event.pointerId,
        page: Number(page.dataset.pageNumber),
        points: [{ x: event.clientX, y: event.clientY }],
      });
    },
    pointermove: (event) => {
      const point = { x: event.clientX, y: event.clientY };
      setCursor(point);
      if (stroke?.pointerId === event.pointerId)
        setStroke({ ...stroke, points: [...stroke.points, point] });
    },
    pointerup: (event) => {
      if (stroke?.pointerId !== event.pointerId) return;
      setStroke(null);
      void controller
        .eraseInk(stroke.page, [...stroke.points, { x: event.clientX, y: event.clientY }], size)
        .catch(() => {
          // The controller reports the failure; the document is unchanged.
        });
    },
    pointercancel: () => setStroke(null),
    pointerleave: () => setCursor(null),
    wheel: (event) => controller.container.scrollBy(event.deltaX, event.deltaY),
  });

  return (
    <div
      ref={overlay}
      className="shape-tool-overlay eraser-overlay"
      role="application"
      aria-label="Ink eraser: drag over drawings to erase them, Escape to stop"
      tabIndex={-1}
    >
      {stroke && (
        <svg className="shape-preview-svg" aria-hidden="true">
          <polyline
            points={stroke.points.map((point) => `${local(point).x},${local(point).y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={size}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor && (
        <div
          className="eraser-cursor"
          style={{
            left: local(cursor).x - size / 2,
            top: local(cursor).y - size / 2,
            width: size,
            height: size,
          }}
        />
      )}
    </div>
  );
}

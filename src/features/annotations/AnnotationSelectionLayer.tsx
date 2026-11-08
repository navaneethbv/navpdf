import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ViewerController } from "../viewer/controller";
import type { Comment } from "../../types/document";
import { selectedCommentIds, useWorkspace } from "../../stores/workspace";
import { pdfPoint } from "./page-pointer";
import { renderCommentPreview, type CommentPreview } from "./move-preview";
import { orthoPoint } from "./ortho";

interface SelectionBox {
  comment: Comment;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Comments that can be picked on the page. Text markup is picked from the comments list. */
const SELECTABLE = new Set([
  "Square",
  "Circle",
  "Line",
  "Arrow",
  "Polygon",
  "PolyLine",
  "Ink",
  "FreeText",
  "Text",
  "Stamp",
  "FileAttachment",
  "Caret",
]);
const RESHAPABLE = new Set(["Line", "Arrow", "Polygon", "PolyLine"]);
/** Pointer travel, in screen pixels, before a press on a comment becomes a drag. */
const DRAG_THRESHOLD = 3;

interface PageGeometry {
  /** The page element's offset in the selection layer and its size. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Converts a PDF point to a point in the layer. */
  toLayer: (x: number, y: number) => [number, number];
}

/** The points a reshape can move: a line's ends or a polygon's corners. */
function reshapePoints(comment: Comment): number[][] | null {
  if (!RESHAPABLE.has(comment.type)) return null;
  if (comment.line && (comment.type === "Line" || comment.type === "Arrow"))
    return [
      [comment.line[0], comment.line[1]],
      [comment.line[2], comment.line[3]],
    ];
  return comment.vertices && comment.vertices.length >= 2 ? comment.vertices : null;
}

interface Drag {
  kind: "move" | "reshape";
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
  /** For a reshape, which point moves and the point it is level or plumb with under Shift. */
  index?: number;
  anchor?: number[];
  shift?: boolean;
}

function selectionMode(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
  return event.metaKey || event.ctrlKey || event.shiftKey ? "toggle" : "replace";
}

export function AnnotationSelectionLayer({
  controller,
}: Readonly<{ controller: ViewerController }>) {
  const tool = useWorkspace((s) => s.tool);
  const comments = useWorkspace((s) => s.comments);
  const selectedId = useWorkspace((s) => s.selectedAnnotationId);
  const selectedIds = useWorkspace((s) => s.selectedAnnotationIds);
  const [boxes, setBoxes] = useState<SelectionBox[]>([]);
  const [pages, setPages] = useState<Map<number, PageGeometry>>(new Map());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ page: number; image: CommentPreview } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const selection = selectedCommentIds({
    selectedAnnotationId: selectedId,
    selectedAnnotationIds: selectedIds,
  });

  useEffect(() => {
    if (tool !== "select" || !controller.pdf) {
      setBoxes([]);
      return;
    }
    let cancelled = false;
    let frameRequest = 0;
    const update = async () => {
      const frame = controller.container.closest<HTMLElement>(".viewer-frame");
      if (!frame || !controller.pdf) return;
      const frameRect = frame.getBoundingClientRect();
      const next: SelectionBox[] = [];
      const geometry = new Map<number, PageGeometry>();
      for (const comment of comments) {
        if (!SELECTABLE.has(comment.type) || !comment.rect) continue;
        const pageElement = document.querySelector<HTMLElement>(
          `.page[data-page-number="${comment.page}"]`,
        );
        if (!pageElement) continue;
        const pdfPage = await controller.pdf.getPage(comment.page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({
          scale: 1,
          rotation: pdfPage.rotate,
        });
        const pageRect = pageElement.getBoundingClientRect();
        const scaleX = pageRect.width / viewport.width;
        const scaleY = pageRect.height / viewport.height;
        const toLayer = (x: number, y: number): [number, number] => {
          const [vx, vy] = viewport.convertToViewportPoint(x, y);
          return [
            pageRect.left - frameRect.left + vx * scaleX,
            pageRect.top - frameRect.top + vy * scaleY,
          ];
        };
        geometry.set(comment.page, {
          left: pageRect.left - frameRect.left,
          top: pageRect.top - frameRect.top,
          width: pageRect.width,
          height: pageRect.height,
          toLayer,
        });
        const [x1, y1] = toLayer(comment.rect[0], comment.rect[1]);
        const [x2, y2] = toLayer(comment.rect[2], comment.rect[3]);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        next.push({
          comment,
          left: Math.min(x1, x2) - (width < 16 ? 8 : 3),
          top: Math.min(y1, y2) - (height < 16 ? 8 : 3),
          width: Math.max(16, width + 6),
          height: Math.max(16, height + 6),
        });
      }
      if (!cancelled) {
        setBoxes(next);
        setPages(geometry);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frameRequest);
      frameRequest = requestAnimationFrame(() => void update());
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(controller.container);
    controller.container.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    const retry = window.setTimeout(schedule, 100);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRequest);
      window.clearTimeout(retry);
      resize.disconnect();
      controller.container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [comments, controller, tool]);

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    start: Omit<Drag, "dx" | "dy" | "active" | "pointerId" | "startX" | "startY">,
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateDrag({
      ...start,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      active: false,
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (current?.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const active = current.active || Math.hypot(dx, dy) >= DRAG_THRESHOLD;
    if (active && !current.active && current.kind === "move") void startPreview();
    updateDrag({ ...current, dx, dy, active, shift: event.shiftKey });
  };

  const startPreview = async () => {
    const primary = boxes.find((box) => box.comment.id === selectedId);
    const geometry = primary && pages.get(primary.comment.page);
    if (!controller.pdf || !primary || !geometry) return;
    const pdfPage = await controller.pdf.getPage(primary.comment.page);
    const unit = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate });
    const image = await renderCommentPreview(
      await controller.pdf.saveDocument(),
      selection,
      (geometry.width / unit.width) * (window.devicePixelRatio || 1),
    );
    if (image && dragRef.current?.active) setPreview({ page: primary.comment.page, image });
  };

  const endDrag = async (event: ReactPointerEvent<HTMLElement>, comment: Comment) => {
    const current = dragRef.current;
    if (current?.pointerId !== event.pointerId) return;
    updateDrag(null);
    setPreview(null);
    if (!current.active) {
      if (current.kind === "move") {
        const mode = selectionMode(event);
        if (mode === "replace") controller.selectAnnotation(comment.id);
        else controller.selectAnnotation(comment.id, mode);
      }
      return;
    }
    const pageElement = document.querySelector<HTMLElement>(
      `.page[data-page-number="${comment.page}"]`,
    );
    if (!pageElement || !controller.pdf) return;
    const end = await pdfPoint(controller, pageElement, event.clientX, event.clientY);
    try {
      if (current.kind === "move") {
        const start = await pdfPoint(controller, pageElement, current.startX, current.startY);
        await controller.moveSelectedAnnotation(end[0] - start[0], end[1] - start[1]);
      } else if (current.index !== undefined) {
        const point =
          event.shiftKey && current.anchor
            ? orthoPoint(current.anchor as [number, number], end)
            : end;
        await controller.reshapeSelectedAnnotation(current.index, point);
      }
    } catch (error) {
      useWorkspace
        .getState()
        .set({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  if (tool !== "select") return null;
  const selected = boxes.find((box) => box.comment.id === selectedId);
  const reshape = selection.length === 1 && selected ? reshapePoints(selected.comment) : null;
  const reshapeGeometry = selected && pages.get(selected.comment.page);
  const dragging = drag?.active ? drag : null;
  const moving = dragging?.kind === "move";
  return (
    <div className="annotation-selection-layer" aria-label="Annotation selection">
      {boxes.map((box) => {
        const isSelected = selection.includes(box.comment.id);
        return (
          <button
            key={box.comment.id}
            type="button"
            className={`annotation-selection-box ${isSelected ? "selected" : ""}`}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              cursor: isSelected ? "move" : undefined,
            }}
            aria-label={`Select ${box.comment.type.toLowerCase()} on page ${box.comment.page}`}
            aria-pressed={isSelected}
            title={`Select ${box.comment.type.toLowerCase()}. Command-click or Shift-click adds to the selection; drag to move.`}
            onPointerDown={(event) => {
              if (isSelected && !event.metaKey && !event.ctrlKey && !event.shiftKey)
                beginDrag(event, { kind: "move" });
            }}
            onPointerMove={moveDrag}
            onPointerUp={(event) => void endDrag(event, box.comment)}
            onPointerCancel={() => {
              updateDrag(null);
              setPreview(null);
            }}
            onClick={(event) => {
              // A press on a selected comment is handled when the pointer is released.
              if (isSelected && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.detail)
                return;
              const mode = selectionMode(event);
              if (mode === "replace") controller.selectAnnotation(box.comment.id);
              else controller.selectAnnotation(box.comment.id, mode);
            }}
          />
        );
      })}
      {moving &&
        boxes
          .filter((box) => selection.includes(box.comment.id))
          .map((box) => (
            <div
              key={`ghost-${box.comment.id}`}
              className="annotation-move-ghost"
              aria-hidden="true"
              style={{
                left: box.left + dragging.dx,
                top: box.top + dragging.dy,
                width: box.width,
                height: box.height,
              }}
            />
          ))}
      {moving &&
        preview &&
        (() => {
          const geometry = pages.get(preview.page);
          if (!geometry) return null;
          return (
            <img
              className="annotation-move-preview"
              alt=""
              aria-hidden="true"
              src={preview.image.url}
              style={{
                left: geometry.left + dragging.dx,
                top: geometry.top + dragging.dy,
                width: geometry.width,
                height: geometry.height,
              }}
            />
          );
        })()}
      {reshape && reshapeGeometry && selected && (
        <>
          {dragging?.kind === "reshape" && dragging.index !== undefined && (
            <svg className="annotation-reshape-preview" aria-hidden="true">
              <polyline
                points={reshape
                  .map((point, index) => {
                    const [x, y] = reshapeGeometry.toLayer(point[0], point[1]);
                    return index === dragging.index
                      ? `${x + dragging.dx},${y + dragging.dy}`
                      : `${x},${y}`;
                  })
                  .join(" ")}
                fill="none"
              />
            </svg>
          )}
          {reshape.map((point, index) => {
            const [x, y] = reshapeGeometry.toLayer(point[0], point[1]);
            const offset = dragging?.kind === "reshape" && dragging.index === index;
            const neighbour = reshape[index === 0 ? 1 : index - 1];
            return (
              <button
                key={`handle-${index}`}
                type="button"
                className="annotation-reshape-handle"
                style={{
                  left: x - 6 + (offset ? dragging.dx : 0),
                  top: y - 6 + (offset ? dragging.dy : 0),
                }}
                aria-label={`Move ${RESHAPE_LABEL[selected.comment.type] ?? "point"} ${index + 1}`}
                title="Drag to reshape. Shift keeps the side level or plumb."
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginDrag(event, { kind: "reshape", index, anchor: neighbour });
                }}
                onPointerMove={moveDrag}
                onPointerUp={(event) => void endDrag(event, selected.comment)}
                onPointerCancel={() => updateDrag(null)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

const RESHAPE_LABEL: Record<string, string> = {
  Line: "line end",
  Arrow: "arrow end",
  Polygon: "corner",
  PolyLine: "corner",
};

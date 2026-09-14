import { useEffect, useState } from "react";
import type { ViewerController } from "../viewer/controller";
import type { Comment } from "../../types/document";
import { useWorkspace } from "../../stores/workspace";

interface SelectionBox {
  comment: Comment;
  left: number;
  top: number;
  width: number;
  height: number;
}

const shapeTypes = new Set(["Square", "Circle", "Line"]);

export function AnnotationSelectionLayer({
  controller,
}: {
  controller: ViewerController;
}) {
  const tool = useWorkspace((s) => s.tool);
  const comments = useWorkspace((s) => s.comments);
  const selectedId = useWorkspace((s) => s.selectedAnnotationId);
  const [boxes, setBoxes] = useState<SelectionBox[]>([]);

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
      for (const comment of comments) {
        if (!shapeTypes.has(comment.type) || !comment.rect) continue;
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
        const [vx1, vy1] = viewport.convertToViewportPoint(
          comment.rect[0],
          comment.rect[1],
        );
        const [vx2, vy2] = viewport.convertToViewportPoint(
          comment.rect[2],
          comment.rect[3],
        );
        const pageRect = pageElement.getBoundingClientRect();
        const scaleX = pageRect.width / viewport.width;
        const scaleY = pageRect.height / viewport.height;
        const left = pageRect.left - frameRect.left + Math.min(vx1, vx2) * scaleX;
        const top = pageRect.top - frameRect.top + Math.min(vy1, vy2) * scaleY;
        const width = Math.abs(vx2 - vx1) * scaleX;
        const height = Math.abs(vy2 - vy1) * scaleY;
        next.push({
          comment,
          left: left - (width < 16 ? 8 : 3),
          top: top - (height < 16 ? 8 : 3),
          width: Math.max(16, width + 6),
          height: Math.max(16, height + 6),
        });
      }
      if (!cancelled) setBoxes(next);
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

  if (tool !== "select") return null;
  return (
    <div className="annotation-selection-layer" aria-label="Annotation selection">
      {boxes.map((box) => (
        <button
          key={box.comment.id}
          type="button"
          className={`annotation-selection-box ${
            selectedId === box.comment.id ? "selected" : ""
          }`}
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          }}
          aria-label={`Select ${box.comment.type.toLowerCase()} on page ${box.comment.page}`}
          aria-pressed={selectedId === box.comment.id}
          title={`Select ${box.comment.type.toLowerCase()}`}
          onClick={() => controller.selectAnnotation(box.comment.id)}
        />
      ))}
    </div>
  );
}

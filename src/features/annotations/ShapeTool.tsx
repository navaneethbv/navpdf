import { useEffect, useRef, useState } from "react";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";

interface Point {
  x: number;
  y: number;
}

interface Draft {
  page: number;
  startClient: Point;
  currentClient: Point;
  startPdf: [number, number];
}

function pageAt(clientX: number, clientY: number) {
  const fromPoint =
    typeof document.elementsFromPoint === "function"
      ? document
          .elementsFromPoint(clientX, clientY)
          .map((element) => element.closest<HTMLElement>(".page"))
          .find((element): element is HTMLElement => !!element)
      : null;
  if (fromPoint) return fromPoint;
  const pages = [...document.querySelectorAll<HTMLElement>(".page")];
  const matchingPage = pages.find((page) => {
    const rect = page.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  });
  return matchingPage ?? pages[0];
}

async function pdfPoint(
  controller: ViewerController,
  pageElement: HTMLElement,
  clientX: number,
  clientY: number,
): Promise<[number, number]> {
  const pageNumber = Number(pageElement.dataset.pageNumber);
  const page = await controller.pdf!.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const rect = pageElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * viewport.width;
  const y = ((clientY - rect.top) / rect.height) * viewport.height;
  const point = viewport.convertToPdfPoint(x, y);
  return [point[0], point[1]];
}

function previewStyle(draft: Draft, overlay: HTMLElement) {
  const rect = overlay.getBoundingClientRect();
  const x1 = draft.startClient.x - rect.left;
  const y1 = draft.startClient.y - rect.top;
  const x2 = draft.currentClient.x - rect.left;
  const y2 = draft.currentClient.y - rect.top;
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function ShapeTool({ controller }: Readonly<{ controller: ViewerController }>) {
  const overlay = useRef<HTMLDivElement>(null);
  const active = useRef<{
    pointerId: number;
    page: HTMLElement;
    startClient: Point;
    startPdf: Promise<[number, number]>;
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const kind = useWorkspace((s) => s.shapeKind);

  useEffect(() => {
    overlay.current?.focus();
  }, []);

  const cancel = () => {
    active.current = null;
    setDraft(null);
    useWorkspace.getState().set({ tool: "select" });
    controller.setTool("select");
  };

  const pointFor = async (page: HTMLElement, event: PointerEvent) =>
    pdfPoint(controller, page, event.clientX, event.clientY);

  const handleDown = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || useWorkspace.getState().busy || !controller.pdf) return;
    const page = pageAt(event.clientX, event.clientY);
    if (!page) return;
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const startClient = { x: event.clientX, y: event.clientY };
    const startPdf = pointFor(page, event.nativeEvent);
    active.current = { pointerId: event.pointerId, page, startClient, startPdf };
    const resolvedStartPdf = await startPdf;
    if (active.current?.pointerId !== event.pointerId) return;
    setDraft({
      page: Number(page.dataset.pageNumber),
      startClient,
      currentClient: { x: event.clientX, y: event.clientY },
      startPdf: resolvedStartPdf,
    });
  };

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId || !draft) return;
    setDraft({
      ...draft,
      currentClient: { x: event.clientX, y: event.clientY },
    });
  };

  const handleUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const startPdf = draft?.startPdf ?? (await current.startPdf);
    const endPdf = await pointFor(current.page, event.nativeEvent);
    active.current = null;
    setDraft(null);
    if (
      Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y) < 4
    )
      return;
    try {
      await controller.addShape(kind, startPdf, endPdf);
      useWorkspace.getState().set({ tool: "select" });
      controller.setTool("select");
    } catch (error) {
      useWorkspace.getState().set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const shapePreview = draft && overlay.current ? previewStyle(draft, overlay.current) : null;
  const line =
    draft && overlay.current
      ? {
          x1: draft.startClient.x - overlay.current.getBoundingClientRect().left,
          y1: draft.startClient.y - overlay.current.getBoundingClientRect().top,
          x2: draft.currentClient.x - overlay.current.getBoundingClientRect().left,
          y2: draft.currentClient.y - overlay.current.getBoundingClientRect().top,
        }
      : null;

  return (
    <div
      ref={overlay}
      className="shape-tool-overlay"
      role="application"
      aria-label={`Draw ${kind.toLowerCase()} shape`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      onPointerDown={(event) => void handleDown(event)}
      onPointerMove={(event) => void handleMove(event)}
      onPointerUp={(event) => void handleUp(event)}
      onPointerCancel={cancel}
    >
      {shapePreview && kind !== "Line" && kind !== "Arrow" && (
        <div className={`shape-preview shape-preview-${kind.toLowerCase()}`} style={shapePreview} />
      )}
      {line && (kind === "Line" || kind === "Arrow") && (
        <svg className="shape-preview-svg" aria-hidden="true">
          <defs>
            <marker
              id="shape-preview-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8" fill="none" stroke="currentColor" />
            </marker>
          </defs>
          <line
            {...line}
            stroke="currentColor"
            strokeWidth="2"
            markerEnd={kind === "Arrow" ? "url(#shape-preview-arrow)" : undefined}
          />
        </svg>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import { pageAt, pdfPoint } from "./page-pointer";
import { measurementText, type MeasureKind, type Point } from "../../services/pdf/measure";

interface Mark {
  client: Point;
  pdf: Point;
}

const MINIMUM: Record<MeasureKind, number> = { distance: 2, perimeter: 2, area: 3 };
const INSTRUCTIONS: Record<MeasureKind, string> = {
  distance: "Click the start and end points.",
  perimeter: "Click each point, then double-click or press Enter to finish.",
  area: "Click each corner, then double-click or press Enter to finish.",
};
/** Pointer movement below this many pixels between clicks is treated as one point. */
const SAME_POINT_PX = 4;

function liveLabel(kind: MeasureKind, marks: Mark[], hover: Mark | null) {
  const scale = useWorkspace.getState().measureScale;
  const points = [...marks, ...(hover ? [hover] : [])].map((mark) => mark.pdf);
  if (points.length < MINIMUM[kind]) return "";
  return measurementText(kind, points, scale);
}

export function MeasureTool({ controller }: Readonly<{ controller: ViewerController }>) {
  const kind = useWorkspace((state) => state.measureKind);
  const overlay = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  // Clicks can arrive while an earlier point is still being converted, so the latest points
  // live in a ref that every handler reads; state only drives rendering.
  const latest = useRef<Mark[]>([]);
  const store = (next: Mark[]) => {
    latest.current = next;
    setMarks(next);
  };
  const [hover, setHover] = useState<Mark | null>(null);
  const [message, setMessage] = useState(INSTRUCTIONS[kind]);

  useEffect(() => {
    target.current?.focus();
  }, []);

  const reset = () => {
    page.current = null;
    store([]);
    setHover(null);
  };

  const exit = () => {
    reset();
    useWorkspace.getState().set({ tool: "select" });
    controller.setTool("select");
  };

  const finish = async (points: Mark[]) => {
    const pageElement = page.current;
    reset();
    if (!pageElement || points.length < MINIMUM[kind]) {
      setMessage(INSTRUCTIONS[kind]);
      return;
    }
    try {
      const label = await controller.addMeasurement({
        page: Number(pageElement.dataset.pageNumber),
        kind,
        points: points.map((mark) => mark.pdf),
        scale: useWorkspace.getState().measureScale,
      });
      setMessage(`Measured ${label}. ${INSTRUCTIONS[kind]}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The measurement could not be saved.");
    }
  };

  const markAt = async (event: { clientX: number; clientY: number }, element: HTMLElement) => ({
    client: [event.clientX, event.clientY] as Point,
    pdf: await pdfPoint(controller, element, event.clientX, event.clientY),
  });

  const addPoint = async (event: PointerEvent) => {
    if (event.button !== 0 || useWorkspace.getState().busy || !controller.pdf) return;
    const element = pageAt(event.clientX, event.clientY);
    // A measurement stays on the page where it started.
    if (!element || (page.current && element !== page.current)) return;
    event.preventDefault();
    page.current = element;
    const mark = await markAt(event, element);
    if (page.current !== element) return;
    const last = latest.current.at(-1);
    const gap = last
      ? Math.hypot(mark.client[0] - last.client[0], mark.client[1] - last.client[1])
      : Infinity;
    if (gap < SAME_POINT_PX) return;
    const next = [...latest.current, mark];
    store(next);
    if (kind === "distance" && next.length === 2) await finish(next);
  };

  const track = async (event: PointerEvent) => {
    if (!page.current || !latest.current.length) return;
    setHover(await markAt(event, page.current));
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish(latest.current);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      store(latest.current.slice(0, -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (page.current) reset();
      else exit();
    }
  };

  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const down = (event: PointerEvent) => void addPoint(event);
    const move = (event: PointerEvent) => void track(event);
    const double = () => void finish(latest.current);
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("dblclick", double);
    element.addEventListener("keydown", onKey);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("dblclick", double);
      element.removeEventListener("keydown", onKey);
    };
  });

  const origin = overlay.current?.getBoundingClientRect();
  const local = (point: Point) =>
    `${point[0] - (origin?.left ?? 0)},${point[1] - (origin?.top ?? 0)}`;
  const path = [...marks, ...(hover ? [hover] : [])].map((mark) => local(mark.client)).join(" ");
  const label = liveLabel(kind, marks, hover);

  return (
    <div
      ref={overlay}
      className="shape-tool-overlay measure-tool-overlay"
      role="application"
      aria-label={`Measure ${kind}`}
    >
      <button
        ref={target}
        type="button"
        className="shape-tool-keyboard-target"
        aria-label={`Measuring ${kind}. Press Escape to stop.`}
      />
      {path && (
        <svg className="shape-preview-svg" aria-hidden="true">
          {kind === "area" && marks.length > 1 ? (
            <polygon points={path} fill="currentColor" fillOpacity="0.08" stroke="currentColor" />
          ) : (
            <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" />
          )}
        </svg>
      )}
      <output className="measure-tool-status" aria-live="polite">
        {label ? `${label} · ` : ""}
        {message} Press Esc to stop.
      </output>
    </div>
  );
}

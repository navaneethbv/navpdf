import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ViewerController } from "./controller";
import { useWorkspace } from "../../stores/workspace";

/** Auto-advance choices in seconds; 0 waits for a click or key. */
export const ADVANCE_SECONDS = [0, 3, 5, 10, 20, 30, 60] as const;
/** The largest canvas drawn for one page, in pixels. */
const MAX_PIXELS = 16_000_000;

/** The page after `page`, or null at the end without looping. */
export function nextPage(page: number, pages: number, step: 1 | -1, loop: boolean) {
  const next = page + step;
  if (next >= 1 && next <= pages) return next;
  if (!loop) return null;
  return next < 1 ? pages : 1;
}

function usesControlKeys(event: KeyboardEvent): boolean {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest("select, input")) return true;
  return (
    (event.key === " " || event.key === "Enter") &&
    event.target.closest(".presentation-controls button") !== null
  );
}

/**
 * Present mode: one page at a time on a black screen. Click, Space, Page Down or the right arrow
 * goes forward; Shift-click, Backspace, Page Up or the left arrow goes back; Escape ends it.
 * Pages can advance on their own and loop. Page transitions stored in the PDF are not animated.
 */
export function Presentation({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController; onClose: () => void }>) {
  const pdf = controller.pdf;
  const pages = pdf?.numPages ?? 0;
  const [page, setPage] = useState(() =>
    Math.min(Math.max(1, useWorkspace.getState().page), pages),
  );
  const [seconds, setSeconds] = useState<number>(0);
  const [loop, setLoop] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = nextPage(page, pages, direction, loop);
      if (next === null) {
        if (direction === 1) onClose();
        return;
      }
      setPage(next);
    },
    [loop, onClose, page, pages],
  );

  useEffect(() => {
    const dialog = root.current;
    const content = stage.current;
    content?.setAttribute("autofocus", "");
    dialog?.showModal();
    content?.focus();
    // A dialog cannot request full screen, so request it on its content.
    void content?.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement === content) void document.exitFullscreen?.().catch(() => {});
      dialog?.close();
    };
  }, []);

  useEffect(() => {
    const content = stage.current;
    let wasFullscreen = document.fullscreenElement === content;
    const leave = () => {
      const fullscreen = document.fullscreenElement === content;
      if (wasFullscreen && !fullscreen) onClose();
      wasFullscreen = fullscreen;
    };
    document.addEventListener("fullscreenchange", leave);
    return () => document.removeEventListener("fullscreenchange", leave);
  }, [onClose]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    void (async () => {
      try {
        const proxy = await pdf.getPage(page);
        if (cancelled || !canvas.current) return;
        const unit = proxy.getViewport({ scale: 1, rotation: proxy.rotate });
        const ratio = window.devicePixelRatio || 1;
        const width = (stage.current?.clientWidth || window.innerWidth) * ratio;
        const height = (stage.current?.clientHeight || window.innerHeight) * ratio;
        const fit = Math.min(width / unit.width, height / unit.height);
        const scale = Math.min(fit, Math.sqrt(MAX_PIXELS / (unit.width * unit.height)));
        const viewport = proxy.getViewport({ scale, rotation: proxy.rotate });
        const target = canvas.current;
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        target.style.width = `${viewport.width / ratio}px`;
        target.style.height = `${viewport.height / ratio}px`;
        const context = target.getContext("2d");
        if (!context) throw new Error("The page could not be drawn.");
        task = proxy.render({ canvas: target, canvasContext: context, viewport });
        await task.promise;
        if (!cancelled) setError("");
      } catch (cause) {
        if (!cancelled && (cause as { name?: string })?.name !== "RenderingCancelledException")
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page, pdf]);

  useEffect(() => {
    if (!seconds) return;
    const timer = window.setTimeout(() => step(1), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [page, seconds, step]);

  useEffect(() => {
    const dialog = root.current;
    const onKeyDown = (event: KeyboardEvent) => {
      const forward = [" ", "ArrowRight", "ArrowDown", "PageDown", "Enter"];
      const back = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"];
      if (event.key === "Escape") onClose();
      else if (usesControlKeys(event)) return;
      else if (event.key === "Home") setPage(1);
      else if (event.key === "End") setPage(pages);
      else if (forward.includes(event.key)) step(event.shiftKey && event.key === " " ? -1 : 1);
      else if (back.includes(event.key)) step(-1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    dialog?.addEventListener("keydown", onKeyDown);
    return () => dialog?.removeEventListener("keydown", onKeyDown);
  }, [onClose, pages, step]);

  return (
    <dialog
      ref={root}
      className="presentation"
      aria-label={`Presentation, page ${page} of ${pages}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="presentation-stage" ref={stage} tabIndex={-1}>
        <button
          type="button"
          className="presentation-page"
          aria-label={`Page ${page}`}
          onClick={(event) => step(event.shiftKey ? -1 : 1)}
        >
          <canvas ref={canvas} aria-hidden="true" />
        </button>
        {error && (
          <p role="alert" className="presentation-error">
            {error}
          </p>
        )}
        <div className="presentation-controls" role="toolbar" aria-label="Presentation controls">
          <button type="button" aria-label="Previous page" onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <output>
            {page} / {pages}
          </output>
          <button type="button" aria-label="Next page" onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
          <label>
            Advance{" "}
            <select
              aria-label="Advance automatically"
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
            >
              {ADVANCE_SECONDS.map((value) => (
                <option key={value} value={value}>
                  {value ? `every ${value} s` : "on click"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={loop}
              onChange={(event) => setLoop(event.target.checked)}
            />{" "}
            Loop
          </label>
          <button type="button" aria-label="End presentation" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
    </dialog>
  );
}

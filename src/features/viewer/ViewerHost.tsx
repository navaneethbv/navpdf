import { useCallback, useEffect, useRef, useState } from "react";
import { ViewerController } from "./controller";
import { useWorkspace } from "../../stores/workspace";
import { ShapeTool } from "../annotations/ShapeTool";
import { MeasureTool } from "../annotations/MeasureTool";
import { AnnotationSelectionLayer } from "../annotations/AnnotationSelectionLayer";
import { ContextMenu } from "../../components/ContextMenu";
import { ExternalLinkDialog } from "../../components/ExternalLinkDialog";
import { validateSafeUrl } from "../../services/document-commands";
import * as desktop from "../../services/native";
import { MarqueeZoomTool } from "./MarqueeZoomTool";
import { EraserTool } from "../annotations/EraserTool";
import { pageAt } from "../annotations/page-pointer";
import { columnText, pageSizeLabel, type Box } from "./view-geometry";
import { downloadBlob } from "../../utils/download";

interface Point {
  x: number;
  y: number;
}

type MenuState =
  | { kind: "text"; x: number; y: number }
  | { kind: "column"; x: number; y: number }
  | { kind: "image"; x: number; y: number; image: Blob; page: number };

/** Text spans of a rendered page's text layer, in window coordinates. */
function textLayerSpans(page: Element) {
  return [...page.querySelectorAll<HTMLElement>(".textLayer span:not(.markedContent)")].flatMap(
    (span) => {
      const text = span.textContent ?? "";
      if (!text || span.childElementCount > 0) return [];
      const rect = span.getBoundingClientRect();
      return [{ text, left: rect.left, top: rect.top, width: rect.width, height: rect.height }];
    },
  );
}

const boxBetween = (from: Point, to: Point): Box => ({
  left: Math.min(from.x, to.x),
  top: Math.min(from.y, to.y),
  right: Math.max(from.x, to.x),
  bottom: Math.max(from.y, to.y),
});
export function ViewerHost({
  onReady,
  controller,
}: Readonly<{
  onReady: (controller: ViewerController) => void;
  controller?: ViewerController | null;
}>) {
  const container = useRef<HTMLDivElement>(null),
    pages = useRef<HTMLDivElement>(null);
  const tool = useWorkspace((s) => s.tool),
    busy = useWorkspace((s) => s.busy),
    hasDocument = useWorkspace((s) => !!s.document),
    pointShape = useWorkspace((s) =>
      s.shapeKind === "Polygon" || s.shapeKind === "PolyLine" ? s.shapeKind : null,
    );
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** An Alt-drag column selection: its rectangle in window coordinates and the text inside. */
  const [column, setColumn] = useState<{ box: Box; text: string; dragging: boolean } | null>(null);
  const selectedColumn = useRef("");
  const [pageSize, setPageSize] = useState<string | null>(null);
  const [hoverCorner, setHoverCorner] = useState(false);
  const page = useWorkspace((s) => s.page);
  const [externalLink, setExternalLink] = useState<{ url: string; reason?: string } | null>(null);
  const allowedHosts = useRef(new Set<string>());
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    const el = container.current!;
    const controller = new ViewerController(el, pages.current!, (url) => {
      const checked = validateSafeUrl(url);
      if (!checked.valid || !checked.normalizedUrl) {
        setExternalLink({ url, reason: checked.reason ?? "This link cannot be opened." });
        return;
      }
      const parsed = new URL(checked.normalizedUrl);
      if (parsed.host && allowedHosts.current.has(parsed.host)) {
        void desktop
          .openExternalUrl(checked.normalizedUrl)
          .catch((error: unknown) =>
            useWorkspace
              .getState()
              .set({ error: error instanceof Error ? error.message : String(error) }),
          );
        return;
      }
      setExternalLink({ url: checked.normalizedUrl });
    });
    onReady(controller);
    let needsFit = true;
    const resize = new ResizeObserver(() => {
      if (el.clientWidth <= 0 || el.clientHeight <= 0) {
        needsFit = true;
        return;
      }
      if (!controller.pdf) return;
      // The first document is attached while this frame is hidden. Fit only
      // once it has real dimensions. Keep fit modes responsive to docked panels
      // while preserving an explicitly chosen numeric zoom.
      if (needsFit || controller.viewer.currentScale <= 0) {
        controller.zoom(useWorkspace.getState().local.preferences.defaultZoom);
      } else if (
        ["auto", "page-fit", "page-width", "page-height"].includes(
          controller.viewer.currentScaleValue,
        )
      ) {
        controller.zoom(controller.viewer.currentScaleValue);
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
    let columnDrag: { pointerId: number; page: Element; start: Point } | null = null;
    el.addEventListener(
      "pointerdown",
      (event) => {
        const state = useWorkspace.getState();
        if (!event.altKey || event.button !== 0 || state.tool !== "select" || state.busy) return;
        const target = event.target instanceof Element ? event.target.closest(".page") : null;
        if (!target) return;
        // Alt-drag selects a rectangle of text instead of a run of lines.
        event.preventDefault();
        event.stopPropagation();
        globalThis.getSelection()?.removeAllRanges();
        el.setPointerCapture?.(event.pointerId);
        const start = { x: event.clientX, y: event.clientY };
        columnDrag = { pointerId: event.pointerId, page: target, start };
        selectedColumn.current = "";
        setColumn({ box: boxBetween(start, start), text: "", dragging: true });
      },
      { capture: true, signal: abort.signal },
    );
    el.addEventListener(
      "pointermove",
      (event) => {
        setHoverCorner(() => {
          const frame = el.getBoundingClientRect();
          return (
            event.clientX < frame.left + frame.width / 2 &&
            event.clientY > frame.top + frame.height / 2
          );
        });
        if (columnDrag?.pointerId !== event.pointerId) return;
        const box = boxBetween(columnDrag.start, { x: event.clientX, y: event.clientY });
        setColumn({ box, text: "", dragging: true });
      },
      { signal: abort.signal },
    );
    el.addEventListener("pointerleave", () => setHoverCorner(false), { signal: abort.signal });
    el.addEventListener(
      "pointerup",
      (event) => {
        if (columnDrag?.pointerId !== event.pointerId) return;
        const box = boxBetween(columnDrag.start, { x: event.clientX, y: event.clientY });
        const text = columnText(textLayerSpans(columnDrag.page), box);
        columnDrag = null;
        selectedColumn.current = text;
        setColumn(text ? { box, text, dragging: false } : null);
        useWorkspace.getState().set({
          status: text ? "Column selected; use Copy to copy its text" : "No text in that area",
        });
      },
      { signal: abort.signal },
    );
    const clearColumn = () => {
      if (columnDrag) return;
      selectedColumn.current = "";
      setColumn(null);
    };
    el.addEventListener("scroll", clearColumn, { signal: abort.signal });
    el.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.altKey && event.button === 0) clearColumn();
      },
      { signal: abort.signal },
    );
    document.addEventListener(
      "copy",
      (event) => {
        const text = selectedColumn.current;
        if (!text || globalThis.getSelection()?.toString()) return;
        event.preventDefault();
        event.clipboardData?.setData("text/plain", text);
        useWorkspace.getState().set({ status: "Column text copied" });
      },
      { signal: abort.signal },
    );
    return () => {
      resize.disconnect();
      abort.abort();
      controller.suspendView();
    };
  }, [onReady]);
  useEffect(() => {
    if (!hasDocument || !controller) return;
    // The native WebKit view becomes measurable one frame after the session
    // publishes its document. PDF.js can otherwise leave the first page in
    // its loading state after it was attached while the frame was hidden.
    const frame = requestAnimationFrame(() => {
      if (typeof controller.viewer.update === "function") controller.viewer.update();
    });
    return () => cancelAnimationFrame(frame);
  }, [controller, hasDocument]);
  useEffect(() => {
    const shown = controller?.viewer.pdfDocument;
    if (!hasDocument || !shown || page < 1 || page > shown.numPages) {
      setPageSize(null);
      return undefined;
    }
    let active = true;
    void shown
      .getPage(page)
      .then((proxy) => {
        if (active) setPageSize(pageSizeLabel(proxy.view, proxy.rotate, proxy.userUnit));
      })
      .catch(() => {
        if (active) setPageSize(null);
      });
    return () => {
      active = false;
    };
  }, [controller, hasDocument, page]);
  return (
    <div className={`viewer-frame ${hasDocument ? "" : "hidden"}`}>
      <div
        className={`pdf-container ${tool === "hand" ? "hand-tool" : ""}`}
        ref={container}
        aria-label="PDF document"
        inert={busy}
        onContextMenu={(event) => {
          const x = event.clientX;
          const y = event.clientY;
          if (globalThis.getSelection()?.toString().trim()) {
            event.preventDefault();
            setMenu({ kind: "text", x, y });
            return;
          }
          if (selectedColumn.current) {
            event.preventDefault();
            setMenu({ kind: "column", x, y });
            return;
          }
          const pageElement = pageAt(x, y);
          if (!controller || !pageElement) return;
          event.preventDefault();
          const pageNumber = Number(pageElement.dataset.pageNumber);
          void controller
            .imageAt(pageNumber, x, y)
            .then((image) => {
              if (image) setMenu({ kind: "image", x, y, image, page: pageNumber });
            })
            .catch((error: unknown) =>
              useWorkspace.getState().set({
                error: `The image could not be read: ${error instanceof Error ? error.message : String(error)}`,
              }),
            );
        }}
      >
        <div ref={pages} className="pdfViewer" />
      </div>
      {column && (
        <div
          className={`column-selection ${column.dragging ? "dragging" : ""}`}
          aria-hidden="true"
          style={{
            left: column.box.left - (container.current?.getBoundingClientRect().left ?? 0),
            top: column.box.top - (container.current?.getBoundingClientRect().top ?? 0),
            width: column.box.right - column.box.left,
            height: column.box.bottom - column.box.top,
          }}
        />
      )}
      {hasDocument && hoverCorner && pageSize && (
        <output className="page-size-label" aria-label="Page size">
          {pageSize}
        </output>
      )}
      {menu?.kind === "column" && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          actions={[{ id: "copy", label: "Copy column text" }]}
          onAction={() => {
            void navigator.clipboard
              ?.writeText(selectedColumn.current)
              .then(() => useWorkspace.getState().set({ status: "Column text copied" }));
          }}
        />
      )}
      {menu?.kind === "image" && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          actions={[
            { id: "copy-image", label: "Copy image" },
            { id: "save-image", label: "Save image as PNG..." },
          ]}
          onAction={(id) => {
            const image = menu.image;
            if (id === "copy-image")
              void navigator.clipboard
                ?.write([new ClipboardItem({ [image.type]: image })])
                .then(() => useWorkspace.getState().set({ status: "Image copied" }))
                .catch(() =>
                  useWorkspace.getState().set({ error: "The image could not be copied." }),
                );
            else
              void downloadBlob(image, `Page ${menu.page} image.png`).then((saved) =>
                useWorkspace.getState().set({ status: saved ? "Image saved" : "Save cancelled" }),
              );
          }}
        />
      )}
      {menu?.kind === "text" && controller && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          actions={[
            { id: "copy", label: "Copy" },
            { id: "highlight", label: "Highlight" },
            { id: "underline", label: "Underline" },
            { id: "strike", label: "Strike through" },
            { id: "note", label: "Add note" },
            { id: "redact", label: "Redact selection" },
            { id: "search", label: "Search for selection" },
          ]}
          onAction={(id) => {
            if (id === "copy")
              void navigator.clipboard?.writeText(globalThis.getSelection()?.toString() ?? "");
            if (id === "highlight" || id === "underline" || id === "strike")
              void controller
                .addTextMarkup(markupType(id))
                .catch((error: unknown) => useWorkspace.getState().set({ error: String(error) }));
            if (id === "note") useWorkspace.getState().set({ activeModal: "sticky-note" });
            if (id === "redact")
              void controller
                .readSelectedTextGeometry()
                .then((selection) =>
                  useWorkspace
                    .getState()
                    .set({ redactionSelection: selection, activeModal: "redact" }),
                );
            if (id === "search")
              useWorkspace.getState().set({
                sidebar: "search",
                searchQuery: globalThis.getSelection()?.toString().trim() ?? "",
              });
          }}
        />
      )}
      {externalLink && (
        <ExternalLinkDialog
          url={externalLink.url}
          reason={externalLink.reason}
          onClose={() => setExternalLink(null)}
          onOpen={(allowHost) => {
            const parsed = new URL(externalLink.url);
            if (allowHost && parsed.host) allowedHosts.current.add(parsed.host);
            const url = externalLink.url;
            setExternalLink(null);
            void desktop
              .openExternalUrl(url)
              .catch((error: unknown) =>
                useWorkspace
                  .getState()
                  .set({ error: error instanceof Error ? error.message : String(error) }),
              );
          }}
        />
      )}
      {hasDocument && tool === "shape" && controller && pointShape === null && (
        <ShapeTool controller={controller} />
      )}
      {hasDocument && tool === "shape" && controller && pointShape !== null && (
        <MeasureTool controller={controller} shape={pointShape} />
      )}
      {hasDocument && tool === "measure" && controller && <MeasureTool controller={controller} />}
      {hasDocument && tool === "marquee" && controller && (
        <MarqueeZoomTool controller={controller} />
      )}
      {hasDocument && tool === "eraser" && controller && <EraserTool controller={controller} />}
      {hasDocument && tool === "select" && controller && (
        <AnnotationSelectionLayer controller={controller} />
      )}
    </div>
  );
}

function markupType(id: string): "Highlight" | "Underline" | "StrikeOut" {
  if (id === "underline") return "Underline";
  if (id === "strike") return "StrikeOut";
  return "Highlight";
}

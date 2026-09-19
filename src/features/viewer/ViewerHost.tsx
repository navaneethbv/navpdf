import { useCallback, useEffect, useRef, useState } from "react";
import { ViewerController } from "./controller";
import { useWorkspace } from "../../stores/workspace";
import { ShapeTool } from "../annotations/ShapeTool";
import { AnnotationSelectionLayer } from "../annotations/AnnotationSelectionLayer";
import { ContextMenu } from "../../components/ContextMenu";
import { ExternalLinkDialog } from "../../components/ExternalLinkDialog";
import { validateSafeUrl } from "../../services/document-commands";
import * as desktop from "../../services/native";
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
    hasDocument = useWorkspace((s) => !!s.document);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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
  return (
    <div className={`viewer-frame ${hasDocument ? "" : "hidden"}`}>
      <div
        className={`pdf-container ${tool === "hand" ? "hand-tool" : ""}`}
        ref={container}
        tabIndex={0}
        aria-label="PDF document"
        inert={busy}
        onContextMenu={(event) => {
          if (!window.getSelection()?.toString().trim()) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div ref={pages} className="pdfViewer" />
      </div>
      {menu && controller && (
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
              void navigator.clipboard?.writeText(window.getSelection()?.toString() ?? "");
            if (id === "highlight" || id === "underline" || id === "strike")
              void controller
                .addTextMarkup(
                  (
                    { highlight: "Highlight", underline: "Underline", strike: "StrikeOut" } as const
                  )[id],
                )
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
                searchQuery: window.getSelection()?.toString().trim() ?? "",
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
      {hasDocument && tool === "shape" && controller && <ShapeTool controller={controller} />}
      {hasDocument && tool === "select" && controller && (
        <AnnotationSelectionLayer controller={controller} />
      )}
    </div>
  );
}

import {
  AnnotationEditorType,
  AnnotationMode,
  AnnotationEditorParamsType,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { AnnotationEditorUIManager } from "pdfjs-dist/types/src/display/editor/tools";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import type {
  Layout,
  Tool,
  SearchResult,
  Bookmark,
  Comment,
} from "../../types/document";
import { useWorkspace } from "../../stores/workspace";
import { positionSearchCursor } from "../search/select-result";
import { boundedZoom, snippet } from "../../utils/search";
import { markDirty, rememberPage } from "../../services/native";
import { loadPdfFromBytes } from "../../services/pdf";
import { installHighlightInterop } from "./highlight-interop";

export class ViewerController {
  readonly bus = new EventBus();
  readonly links = new PDFLinkService({
    eventBus: this.bus,
    ignoreDestinationZoom: true,
  });
  readonly find = new PDFFindController({
    eventBus: this.bus,
    linkService: this.links,
    updateMatchesCountOnProgress: true,
  });
  readonly viewer: PDFViewer;
  pdf: PDFDocumentProxy | null = null;
  editor: AnnotationEditorUIManager | null = null;
  private revisionTask: PDFDocumentLoadingTask | null = null;
  private generation = 0;
  private started = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private pageTimer: ReturnType<typeof setTimeout> | undefined;
  private contexts = new Map<number, string>();
  private abort = new AbortController();
  private searchGeneration = 0;
  constructor(
    readonly container: HTMLDivElement,
    element: HTMLDivElement,
  ) {
    this.links.externalLinkEnabled = false;
    this.viewer = new PDFViewer({
      container,
      viewer: element,
      eventBus: this.bus,
      linkService: this.links,
      findController: this.find,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationMode: AnnotationMode.ENABLE,
      imageResourcesPath: "/pdfjs/web/images/",
      maxCanvasPixels: 8_000_000,
      maxCanvasDim: 8192,
      capCanvasAreaFactor: 150,
      enableDetailCanvas: true,
      enablePermissions: true,
      enableAutoLinking: false,
      imagesRightClickMinSize: -1,
      annotationEditorHighlightColors:
        "yellow=#f5cf58,green=#80d49b,blue=#8cc9f7,pink=#f3a1c0",
      supportsPinchToZoom: true,
    });
    this.links.setViewer(this.viewer);
    const on = (name: string, handler: (event: never) => void) =>
      this.bus.on(name, handler, { signal: this.abort.signal });
    on("pagesinit", () => {
      this.setLayout(useWorkspace.getState().layout);
      if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.viewer.currentScaleValue =
          useWorkspace.getState().local.preferences.defaultZoom;
      }
    });
    on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      useWorkspace.getState().set({ page: pageNumber });
      clearTimeout(this.pageTimer);
      this.pageTimer = setTimeout(() => {
        const id = useWorkspace.getState().document?.id;
        if (id)
          void rememberPage(id, pageNumber).catch(() =>
            useWorkspace
              .getState()
              .set({ error: "The last viewed page could not be remembered." }),
          );
      }, 500);
    });
    on("scalechanging", ({ scale }: { scale: number }) =>
      useWorkspace.getState().set({ zoom: Math.round(scale * 100) }),
    );
    on("textlayerrendered", ({ error }: { error?: unknown }) => {
      if (error)
        useWorkspace.getState().set({
          error: `Text selection could not be prepared: ${String(error)}`,
        });
    });
    on("pagerendered", () => {
      const state = useWorkspace.getState();
      state.set({
        renderedPages: this.container.querySelectorAll("canvas").length,
        ...(state.firstRenderMs === null
          ? { firstRenderMs: Math.round(performance.now() - this.started) }
          : {}),
      });
    });
    on(
      "annotationeditoruimanager",
      ({ uiManager }: { uiManager: AnnotationEditorUIManager }) => {
        this.editor = uiManager;
      },
    );
    on(
      "editingstateschanged",
      ({
        details,
      }: {
        details: {
          hasSomethingToUndo: boolean;
          hasSomethingToRedo: boolean;
          hasSelectedEditor: boolean;
        };
      }) =>
        useWorkspace.getState().set({
          canUndo: details.hasSomethingToUndo,
          canRedo: details.hasSomethingToRedo,
          hasSelection: details.hasSelectedEditor,
        }),
    );
    on("switchannotationeditormode", ({ mode }: { mode: number }) => {
      if (
        mode === AnnotationEditorType.NONE ||
        mode === AnnotationEditorType.HIGHLIGHT ||
        mode === AnnotationEditorType.INK ||
        mode === AnnotationEditorType.FREETEXT
      )
        this.viewer.annotationEditorMode = { mode };
    });
    on(
      "switchannotationeditorparams",
      ({ type, value }: { type: number; value: unknown }) => {
        this.editor?.updateParams(type, value);
      },
    );
    on(
      "updatefindmatchescount",
      ({ matchesCount }: { matchesCount: { total: number } }) => {
        useWorkspace.getState().set({ searchCount: matchesCount.total });
        this.queueResults();
      },
    );
    on("updatefindcontrolstate", ({ state }: { state: number }) => {
      useWorkspace.getState().set({ searchPending: state === 3 });
      this.queueResults();
    });
    container.addEventListener(
      "click",
      (event) => {
        const anchor = (event.target as Element).closest("a");
        if (anchor && !anchor.classList.contains("internalLink"))
          event.preventDefault();
      },
      { capture: true, signal: this.abort.signal },
    );
  }
  async attach(pdf: PDFDocumentProxy) {
    this.started = performance.now();
    this.generation++;
    const generation = this.generation;
    this.contexts.clear();
    this.pdf = pdf;
    this.links.setDocument(pdf);
    this.find.setDocument(pdf);
    this.viewer.setDocument(pdf);
    (
      pdf.annotationStorage as unknown as { onSetModified: () => void }
    ).onSetModified = () => {
      useWorkspace.getState().set({ dirty: true, status: "Unsaved changes" });
      void markDirty(true).catch(() =>
        useWorkspace
          .getState()
          .set({
            error:
              "Native change tracking is unavailable. Save a copy before closing.",
          }),
      );
    };
    installHighlightInterop(pdf.annotationStorage);
    try {
      await (
        await pdf.getPage(1)
      ).getTextContent({ disableNormalization: true });
    } catch (error) {
      useWorkspace
        .getState()
        .set({ error: `Text extraction failed: ${String(error)}` });
    }
    const outline = await pdf.getOutline();
    if (generation !== this.generation) return;
    type OutlineItem = NonNullable<
      Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>
    >[number];
    const map = (nodes: OutlineItem[]): Bookmark[] =>
      nodes
        .filter((n) => n.dest || (n.items && n.items.length > 0))
        .map((n) => ({
          title: n.title,
          destination: (n.dest as string | unknown[]) ?? null,
          children: n.items ? map(n.items) : [],
        }));
    useWorkspace.getState().set({ bookmarks: outline ? map(outline) : [] });
  }
  async detach() {
    this.generation++;
    this.searchGeneration++;
    clearTimeout(this.searchTimer);
    clearTimeout(this.pageTimer);
    await this.releaseRevision();
    this.viewer.setDocument(null as unknown as PDFDocumentProxy);
    this.links.setDocument(null);
    this.find.setDocument(null as unknown as PDFDocumentProxy);
    this.editor = null;
    this.pdf = null;
    this.contexts.clear();
  }
  /**
   * Commit an in-memory revision produced by a local mutation.
   * Loads the new bytes, attaches them to the viewer, and retires the
   * previous proxy so `controller.pdf` stays the single canonical revision.
   * Callers must derive `bytes` from `controller.pdf.saveDocument()` so
   * pending annotation edits are serialized into the new revision.
   */
  async replaceWithBytes(bytes: Uint8Array, status: string) {
    this.editor?.commitOrRemove();
    const task = loadPdfFromBytes(bytes as Uint8Array<ArrayBuffer>);
    const previousPdf = this.pdf;
    const previousState = useWorkspace.getState();
    const previousTask = this.revisionTask;
    let loaded: PDFDocumentProxy;
    try {
      loaded = await task.promise;
      await this.attach(loaded);
      await this.viewer.firstPagePromise;
    } catch (error) {
      await task.destroy().catch(() => {});
      if (previousPdf && this.pdf !== previousPdf) {
        await this.attach(previousPdf);
        this.goTo(previousState.page);
      }
      useWorkspace.getState().set(previousState);
      throw error;
    }
    this.revisionTask = task;
    if (previousTask) await previousTask.destroy().catch(() => {});
    const state = useWorkspace.getState();
    state.set({
      dirty: true,
      status,
      info: state.info ? { ...state.info, pages: loaded.numPages } : state.info,
      page: Math.max(1, Math.min(state.page, loaded.numPages)),
    });
    this.goTo(useWorkspace.getState().page);
    await markDirty(true).catch(() =>
      state.set({
        error:
          "Native change tracking is unavailable. Save a copy before closing.",
      }),
    );
  }
  /** Retire the in-memory mutated revision without detaching the viewer. */
  async releaseRevision() {
    const revision = this.revisionTask;
    this.revisionTask = null;
    if (revision) await revision.destroy().catch(() => {});
  }
  destroy() {
    void this.detach();
    this.abort.abort();
  }
  setLayout(layout: Layout) {
    this.viewer.scrollMode =
      layout === "single" ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    this.viewer.spreadMode =
      layout === "spread" ? SpreadMode.ODD : SpreadMode.NONE;
    useWorkspace.getState().set({ layout });
  }
  setTool(tool: Tool) {
    if (!this.pdf) return;
    this.viewer.annotationEditorMode = {
      mode:
        tool === "highlight"
          ? AnnotationEditorType.HIGHLIGHT
          : tool === "ink" || tool === "draw"
            ? AnnotationEditorType.INK
            : tool === "text"
              ? AnnotationEditorType.FREETEXT
              : AnnotationEditorType.NONE,
    };
    useWorkspace.getState().set({ tool });
  }
  setColor(value: string) {
    this.editor?.updateParams(
      AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      value,
    );
    useWorkspace.getState().set({ highlightColor: value });
  }
  undo() {
    this.editor?.undo();
  }
  redo() {
    this.editor?.redo();
  }
  deleteSelected() {
    this.editor?.delete();
  }
  zoom(value: number | string) {
    if (typeof value === "string") this.viewer.currentScaleValue = value;
    else this.viewer.currentScale = boundedZoom(value);
  }
  goTo(page: number) {
    if (this.pdf)
      this.viewer.currentPageNumber = Math.max(
        1,
        Math.min(this.pdf.numPages, page),
      );
  }
  search(again = false, backward = false) {
    const s = useWorkspace.getState();
    this.searchGeneration++;
    if (!again)
      s.set({ searchPending: !!s.searchQuery, results: [], searchCount: 0 });
    this.bus.dispatch("find", {
      source: this,
      type: again ? "again" : "",
      query: s.searchQuery,
      caseSensitive: s.matchCase,
      entireWord: s.wholeWord,
      highlightAll: true,
      findPrevious: backward,
      matchDiacritics: false,
    });
  }
  selectResult(page: number, index: number) {
    // Keep the existing selected page visible to avoid a full search reset.
    const selected = this.find.selected;
    if (selected && selected.pageIdx >= 0) this.goTo(selected.pageIdx + 1);
    if (positionSearchCursor(this.find, page, index)) this.search(true);
  }
  closeSearch() {
    this.bus.dispatch("findbarclose", { source: this });
  }
  private queueResults() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      void this.buildResults().catch(() =>
        useWorkspace
          .getState()
          .set({ error: "Search context could not be read from this PDF." }),
      );
    }, 120);
  }
  private async buildResults() {
    if (!this.pdf) return;
    const generation = this.generation,
      search = this.searchGeneration;
    const pdf = this.pdf;
    const matches = this.find.pageMatches as number[][] | undefined,
      lengths = this.find.pageMatchesLength as number[][] | undefined;
    const results: SearchResult[] = [];
    for (let p = 0; p < (matches?.length ?? 0) && results.length < 250; p++) {
      const pageMatches = matches?.[p];
      if (!pageMatches?.length) continue;
      let text = this.contexts.get(p);
      if (text === undefined) {
        const page = await pdf.getPage(p + 1);
        const content = await page.getTextContent({
          disableNormalization: true,
        });
        text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
          )
          .join("");
        this.contexts.set(p, text);
        if (this.contexts.size > 40)
          this.contexts.delete(this.contexts.keys().next().value!);
      }
      if (generation !== this.generation || search !== this.searchGeneration)
        return;
      for (let i = 0; i < pageMatches.length && results.length < 250; i++) {
        const start = pageMatches[i],
          len = lengths?.[p]?.[i] ?? 0;
        results.push({
          page: p + 1,
          index: i,
          context: snippet(text, start, len),
          match: text.slice(start, start + len),
        });
      }
    }
    if (generation === this.generation && search === this.searchGeneration)
      useWorkspace.getState().set({ results });
  }
  async readComments() {
    if (!this.pdf) return;
    const generation = this.generation;
    const comments: Comment[] = [];
    for (let p = 1; p <= this.pdf.numPages; p++) {
      const page = await this.pdf.getPage(p);
      const annotations: unknown[] = await page.getAnnotations();
      if (generation !== this.generation) return;
      for (const raw of annotations) {
        const a = raw as {
          id: string;
          subtype?: string;
          contentsObj?: { str: string };
        };
        if (a.subtype === "Text" || a.subtype === "Highlight")
          comments.push({
            id: a.id,
            page: p,
            type: a.subtype,
            text: a.contentsObj?.str || "Highlight annotation",
          });
      }
      if (p % 20 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    useWorkspace.getState().set({ comments });
  }
}

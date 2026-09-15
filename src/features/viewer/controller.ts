import {
  AnnotationEditorType,
  AnnotationMode,
  AnnotationEditorParamsType,
  PermissionFlag,
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
  ShapeKind,
  SelectedTextGeometry,
} from "../../types/document";
import type { DocumentRevision } from "../../types/operations";
import { useWorkspace } from "../../stores/workspace";
import { positionSearchCursor } from "../search/select-result";
import { boundedZoom, snippet } from "../../utils/search";
import { commitWorkingRevision, markDirty, native, rememberPage } from "../../services/native";
import { pruneDocument } from "../../services/engine";
import { loadPdfFromBytes } from "../../services/pdf";
import { RevisionHistory } from "../../services/revision-history";
import { MutationQueue } from "../../services/mutation-queue";
import {
  addStickyNote as addStickyNoteToPdf,
  addShapeAnnotation,
  addTextMarkupAnnotations,
  deleteAnnotation,
  updateAnnotation,
  annotationIdentifier,
  type TextMarkupKind,
} from "../../services/document-commands";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import { installHighlightInterop } from "./highlight-interop";
import { readTextSelectionGeometry } from "./selection-geometry";
import { createCommentExchange, parseCommentExchange } from "../../services/comment-exchange";
import { contentIdentity } from "../../services/document-identity";

const finite = (value: number) => Number.isFinite(value);

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
  readonly history = new RevisionHistory();
  private nativeCanUndo = false;
  private nativeCanRedo = false;
  private committedRevisionId: string | undefined;
  private storageModified = false;
  private mutationQueue = new MutationQueue();
  private identity: string | null = null;

  async mutate<T>(label: string, fn: () => Promise<T>): Promise<T> {
    useWorkspace.getState().set({ busy: true, status: label });
    try {
      return await this.mutationQueue.run(label, fn);
    } catch (error) {
      useWorkspace.getState().set({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (this.mutationQueue.pending === 0) {
        useWorkspace.getState().set({ busy: false });
      }
    }
  }
  constructor(
    readonly container: HTMLDivElement,
    element: HTMLDivElement,
    private readonly onExternalLink?: (url: string) => void,
  ) {
    this.links.externalLinkEnabled = false;
    this.viewer = new PDFViewer({
      container,
      viewer: element,
      eventBus: this.bus,
      linkService: this.links,
      findController: this.find,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationMode: AnnotationMode.ENABLE_FORMS ?? 2,
      imageResourcesPath: "/pdfjs/web/images/",
      maxCanvasPixels: 8_000_000,
      maxCanvasDim: 8192,
      capCanvasAreaFactor: 150,
      // WKWebView does not reliably complete PDF.js detail-canvas rendering.
      // The regular page canvas is sufficient at the bounded zoom levels used
      // by NavPDF and avoids leaving the loading icon over a finished page.
      enableDetailCanvas: false,
      enablePermissions: true,
      enableAutoLinking: false,
      imagesRightClickMinSize: -1,
      annotationEditorHighlightColors: "yellow=#f5cf58,green=#80d49b,blue=#8cc9f7,pink=#f3a1c0",
      supportsPinchToZoom: true,
    });
    this.links.setViewer(this.viewer);
    const on = (name: string, handler: (event: never) => void) =>
      this.bus.on(name, handler, { signal: this.abort.signal });
    on("pagesinit", () => {
      this.setLayout(useWorkspace.getState().layout);
      if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.viewer.currentScaleValue = useWorkspace.getState().local.preferences.defaultZoom;
      }
      // PDF.js can receive pagesinit while the native WebKit view is still
      // completing its first layout pass. Re-run visibility and render
      // prioritization after that pass so the initial page is not left with a
      // loading icon indefinitely.
      requestAnimationFrame(() => {
        if (typeof this.viewer.update === "function") this.viewer.update();
      });
    });
    on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      useWorkspace.getState().set({ page: pageNumber });
      clearTimeout(this.pageTimer);
      this.pageTimer = setTimeout(() => {
        const id = useWorkspace.getState().document?.id;
        if (id)
          void rememberPage(id, pageNumber).catch(() =>
            useWorkspace.getState().set({ error: "The last viewed page could not be remembered." }),
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
    on("pagerendered", ({ error }: { error?: unknown } = {}) => {
      const state = useWorkspace.getState();
      state.set({
        renderedPages: this.container.querySelectorAll("canvas").length,
        ...(state.firstRenderMs === null
          ? { firstRenderMs: Math.round(performance.now() - this.started) }
          : {}),
      });
      if (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.set({
          error: `Page ${this.viewer.currentPageNumber} could not be rendered: ${message}`,
        });
      }
    });
    on("annotationeditoruimanager", ({ uiManager }: { uiManager: AnnotationEditorUIManager }) => {
      this.editor = uiManager;
    });
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
      }) => {
        this.nativeCanUndo = details.hasSomethingToUndo;
        this.nativeCanRedo = details.hasSomethingToRedo;
        const state = useWorkspace.getState();
        state.set({
          canUndo: this.nativeCanUndo || this.history.canUndo(),
          canRedo: this.nativeCanRedo || this.history.canRedo(),
          hasSelection: details.hasSelectedEditor,
        });
        if (!this.isDirty()) {
          state.set({ dirty: false, status: "Ready" });
          void markDirty(false).catch(() => {});
        }
      },
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
    on("switchannotationeditorparams", ({ type, value }: { type: number; value: unknown }) => {
      this.editor?.updateParams(type, value);
    });
    on("updatefindmatchescount", ({ matchesCount }: { matchesCount: { total: number } }) => {
      useWorkspace.getState().set({ searchCount: matchesCount.total });
      this.queueResults();
    });
    on("updatefindcontrolstate", ({ state }: { state: number }) => {
      useWorkspace.getState().set({ searchPending: state === 3 });
      this.queueResults();
    });
    container.addEventListener(
      "click",
      (event) => {
        const anchor = (event.target as Element).closest("a");
        if (anchor && !anchor.classList.contains("internalLink")) {
          event.preventDefault();
          const url = anchor.getAttribute("href") ?? anchor.href;
          if (url) this.onExternalLink?.(url);
        }
      },
      { capture: true, signal: this.abort.signal },
    );
  }
  async attach(pdf: PDFDocumentProxy) {
    this.started = performance.now();
    this.generation++;
    const generation = this.generation;
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.contexts.clear();
    this.storageModified = false;
    this.pdf = pdf;
    const pageLabels =
      typeof pdf.getPageLabels === "function" ? await pdf.getPageLabels().catch(() => null) : null;
    useWorkspace.getState().set({ pageLabels });
    this.links.setDocument(pdf);
    this.find.setDocument(pdf);
    this.viewer.setDocument(pdf);
    (pdf.annotationStorage as unknown as { onSetModified: () => void }).onSetModified = () => {
      this.storageModified = true;
      useWorkspace.getState().set({ dirty: true, status: "Unsaved changes" });
      void markDirty(true).catch(() =>
        useWorkspace.getState().set({
          error: "Native change tracking is unavailable. Save a copy before closing.",
        }),
      );
    };
    installHighlightInterop(pdf.annotationStorage);
    try {
      await (await pdf.getPage(1)).getTextContent({ disableNormalization: true });
    } catch (error) {
      useWorkspace.getState().set({ error: `Text extraction failed: ${String(error)}` });
    }
    const outline = await pdf.getOutline();
    if (generation !== this.generation) return;
    type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
    const map = (nodes: OutlineItem[]): Bookmark[] =>
      nodes
        .filter((n) => n.dest || (n.items && n.items.length > 0))
        .map((n) => ({
          title: n.title,
          destination: (n.dest as string | unknown[]) ?? null,
          children: n.items ? map(n.items) : [],
        }));
    useWorkspace.getState().set({ bookmarks: outline ? map(outline) : [] });

    // Inspect forms, XFA, scripts, and digital signatures. Clear the previous document's
    // findings first so the session can carry these values across its store reset.
    useWorkspace.getState().set({ formNotice: null, hasDigitalSignature: false });
    if (pdf.isPureXfa || Boolean(pdf.allXfaHtml)) {
      useWorkspace.getState().set({
        formNotice: "XFA forms are not supported. Form elements are read-only or unavailable.",
      });
    }
    try {
      const js = await pdf.getJSActions();
      if (js && js.size > 0) {
        useWorkspace.getState().set({
          formNotice: "Script-based calculations and actions are disabled for document safety.",
        });
      }
    } catch {
      // ignore
    }
    try {
      const fieldObjects = await pdf.getFieldObjects();
      if (fieldObjects) {
        let hasSig = false;
        for (const fields of fieldObjects.values()) {
          for (const f of fields) {
            const fieldObj = f as { type?: string; subtype?: string };
            if (fieldObj.type === "signature" || fieldObj.subtype === "Sig") {
              hasSig = true;
              break;
            }
          }
          if (hasSig) break;
        }
        if (hasSig) {
          useWorkspace.getState().set({ hasDigitalSignature: true });
        }
      }
    } catch {
      // ignore
    }
    try {
      if (typeof pdf.getPermissions === "function") {
        // PDF.js resolves null when the document sets no restrictions.
        const perms = await pdf.getPermissions();
        useWorkspace
          .getState()
          .set({ editingAllowed: !perms || perms.has(PermissionFlag.MODIFY_CONTENTS) });
      }
    } catch {
      // ignore
    }

    this.identity = await contentIdentity(pdf).catch(() => null);
    await this.readComments().catch(() => {});
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
    this.identity = null;
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.history.seed({
      bytes: new Uint8Array(),
      numPages: 0,
      description: "Empty document",
    });
    this.contexts.clear();
  }
  /**
   * Commit an in-memory revision produced by a local mutation.
   * Loads the new bytes, attaches them to the viewer, and retires the
   * previous proxy so `controller.pdf` stays the single canonical revision.
   * Callers must derive `bytes` from `controller.pdf.saveDocument()` so
   * pending annotation edits are serialized into the new revision.
   */
  async replaceWithBytes(
    bytes: Uint8Array,
    status: string,
    options?: {
      pageMapping?: number[];
      warnings?: string[];
      /** Drop earlier revisions, e.g. after redaction or unlocking, so undo cannot restore them. */
      resetHistory?: boolean;
      /** Pre-mutation document bytes to record in undo history without re-serializing. */
      preMutationBytes?: Uint8Array;
    },
  ) {
    this.editor?.commitOrRemove();
    // PDF.js transfers the candidate buffer to its worker while loading it.
    // Keep an owned copy for history and later rollback bookkeeping.
    const candidateBytes = new Uint8Array(bytes);
    const historyBytes = new Uint8Array(candidateBytes);
    const previousBytes = !options?.resetHistory
      ? (options?.preMutationBytes ??
        (this.pdf && typeof this.pdf.saveDocument === "function"
          ? await this.pdf.saveDocument()
          : null))
      : null;
    if (previousBytes) {
      this.history.adopt({
        bytes: previousBytes,
        numPages: this.pdf?.numPages ?? 0,
        description: "Native annotation edit",
      });
    }
    const task = loadPdfFromBytes(candidateBytes as Uint8Array<ArrayBuffer>);
    const previousPdf = this.pdf;
    const previousState = useWorkspace.getState();
    const previousTask = this.revisionTask;
    let loaded: PDFDocumentProxy;
    let nativeRevisionId: string | undefined;
    try {
      loaded = await task.promise;
      await this.attach(loaded);
      await this.viewer.firstPagePromise;
      nativeRevisionId = await this.commitNativeRevision(
        historyBytes,
        loaded.numPages,
        previousState.document,
      );
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
    if (options?.resetHistory) {
      this.history.seed({
        bytes: historyBytes,
        numPages: loaded.numPages,
        description: status,
        revisionId: nativeRevisionId,
      });
      this.history.markUnsaved();
      this.nativeCanUndo = false;
      this.nativeCanRedo = false;
    } else {
      this.history.record({
        bytes: historyBytes,
        numPages: loaded.numPages,
        description: status,
        revisionId: nativeRevisionId,
        pageMapping: options?.pageMapping,
        warnings: options?.warnings,
      });
    }
    this.updateHistoryControls();
    const info = await this.refreshedInfo(loaded, state.info);
    state.set({
      dirty: true,
      status,
      info,
      page: Math.max(1, Math.min(state.page, loaded.numPages)),
      revision: (state.revision ?? 0) + 1,
    });
    this.goTo(useWorkspace.getState().page);
    await markDirty(true).catch(() =>
      state.set({
        error: "Native change tracking is unavailable. Save a copy before closing.",
      }),
    );
  }
  /** Page count, title and author of a new revision, so removed metadata does not stay on screen. */
  private async refreshedInfo(
    loaded: PDFDocumentProxy,
    previous: ReturnType<typeof useWorkspace.getState>["info"],
  ) {
    if (!previous) return previous;
    const next = { ...previous, pages: loaded.numPages };
    try {
      const metadata = await loaded.getMetadata();
      const values = metadata.info as { Title?: string; Author?: string };
      return { ...next, title: values.Title || "", author: values.Author || "" };
    } catch {
      return next;
    }
  }
  private updateHistoryControls() {
    useWorkspace.getState().set({
      canUndo: this.nativeCanUndo || this.history.canUndo(),
      canRedo: this.nativeCanRedo || this.history.canRedo(),
    });
  }
  private async applyRevision(revision: DocumentRevision, status: string) {
    const task = loadPdfFromBytes(new Uint8Array(revision.bytes));
    const previousPdf = this.pdf;
    const previousState = useWorkspace.getState();
    const previousTask = this.revisionTask;
    let loaded: PDFDocumentProxy;
    try {
      loaded = await task.promise;
      await this.attach(loaded);
      await this.viewer.firstPagePromise;
      await this.commitNativeRevision(revision.bytes, loaded.numPages, previousState.document);
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
    const dirty = !this.history.isAtSavedRevision();
    const info = await this.refreshedInfo(loaded, state.info);
    state.set({
      dirty,
      status,
      info,
      page: Math.max(1, Math.min(state.page, loaded.numPages)),
    });
    this.goTo(state.page);
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.updateHistoryControls();
    await markDirty(dirty).catch(() =>
      state.set({
        error: "Native change tracking is unavailable. Save a copy before closing.",
      }),
    );
  }
  private async commitNativeRevision(
    bytes: Uint8Array,
    pages: number,
    document: import("../../types/document").DocumentDescriptor | null,
  ) {
    if (!native || !document) return undefined;
    const result = await commitWorkingRevision(
      document.id,
      this.committedRevisionId ?? document.revisionId ?? "",
      new Uint8Array(bytes),
      pages,
    );
    this.committedRevisionId = result.revisionId;
    return result.revisionId;
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
    this.viewer.scrollMode = layout === "single" ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    const configured = useWorkspace.getState().spread;
    const spread = layout === "spread" && configured === "none" ? "odd" : configured;
    this.viewer.spreadMode = layout === "spread" ? this.spreadMode(spread) : SpreadMode.NONE;
    useWorkspace.getState().set({ layout, spread });
  }
  private spreadMode(spread: "none" | "odd" | "even") {
    if (spread === "even") return SpreadMode.EVEN;
    if (spread === "odd") return SpreadMode.ODD;
    return SpreadMode.NONE;
  }
  setSpread(spread: "none" | "odd" | "even") {
    this.viewer.spreadMode = this.spreadMode(spread);
    useWorkspace.getState().set({ spread });
  }
  rotateView(delta: 90 | -90) {
    const current = useWorkspace.getState().viewRotation;
    const next = ((current + delta + 360) % 360) as 0 | 90 | 180 | 270;
    this.viewer.pagesRotation = next;
    useWorkspace.getState().set({ viewRotation: next });
  }
  goToFirst() {
    this.goTo(1);
  }
  goToLast() {
    if (this.pdf) this.goTo(this.pdf.numPages);
  }
  goToPage(labelOrNumber: string | number) {
    if (typeof labelOrNumber === "string") {
      const label = labelOrNumber.trim();
      const labelIndex =
        useWorkspace.getState().pageLabels?.findIndex((item) => item === label) ?? -1;
      if (labelIndex >= 0) {
        this.goTo(labelIndex + 1);
        return;
      }
      const parsed = Number(label);
      if (!Number.isFinite(parsed)) return;
      this.goTo(parsed);
      return;
    }
    this.goTo(labelOrNumber);
  }
  setTool(tool: Tool) {
    if (!this.pdf) return;
    try {
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
    } catch {
      // Suppress throw if PDF.js refuses annotation mode due to permissions
    }
    useWorkspace.getState().set({ tool });
  }
  setColor(value: string) {
    const currentTool = useWorkspace.getState().tool;
    if (currentTool === "draw" || currentTool === "ink") {
      this.editor?.updateParams(AnnotationEditorParamsType.INK_COLOR, value);
    } else {
      this.editor?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, value);
    }
    useWorkspace.getState().set({ highlightColor: value, inkColor: value });
  }
  setWidth(value: number) {
    this.editor?.updateParams(AnnotationEditorParamsType.INK_THICKNESS, value);
  }
  setOpacity(value: number) {
    this.editor?.updateParams(AnnotationEditorParamsType.INK_OPACITY, value);
  }
  currentPage() {
    return this.viewer.currentPageNumber;
  }
  async addStickyNote(contents: string) {
    if (!this.pdf) throw new Error("Open a PDF before adding an annotation.");
    return this.mutate("Sticky note added to document", async () => {
      const pageNumber = this.currentPage();
      const page = await this.pdf!.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const hex = useWorkspace.getState().highlightColor;
      const color: [number, number, number] = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      ];
      const bytes = await this.pdf!.saveDocument();
      const [ptX, ptY] =
        typeof viewport.convertToPdfPoint === "function"
          ? viewport.convertToPdfPoint(48, 48)
          : [48, (viewport.height || 792) - 48];
      const noted = await addStickyNoteToPdf(bytes, {
        page: pageNumber,
        x: ptX,
        y: ptY,
        contents,
        color,
      });
      await this.replaceWithBytes(noted, "Sticky note added to document", {
        preMutationBytes: bytes,
      });
    });
  }
  async addShape(kind: ShapeKind, start: [number, number], end: [number, number]) {
    if (!this.pdf) throw new Error("Open a PDF before adding a shape.");
    const status = `${kind === "Arrow" ? "Arrow" : kind} added to document`;
    return this.mutate(status, async () => {
      const state = useWorkspace.getState();
      const hex = state.inkColor;
      const color: [number, number, number] = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      ];
      const bytes = await this.pdf!.saveDocument();
      const shaped = await addShapeAnnotation(bytes, {
        page: this.currentPage(),
        kind,
        start,
        end,
        color,
        width: state.inkWidth,
        opacity: state.inkOpacity,
      });
      await this.replaceWithBytes(shaped, status, { preMutationBytes: bytes });
    });
  }
  async readSelectedTextGeometry(): Promise<SelectedTextGeometry[]> {
    if (!this.pdf) throw new Error("Open a PDF before adding an annotation.");
    return readTextSelectionGeometry(this.container, async (pageNumber) => {
      const viewport = (await this.pdf!.getPage(pageNumber)).getViewport({
        scale: 1,
      });
      return {
        width: viewport.width,
        height: viewport.height,
        convertToPdfPoint: (x: number, y: number): [number, number] => {
          const point = viewport.convertToPdfPoint(x, y);
          return [point[0], point[1]];
        },
      };
    });
  }
  async addTextMarkup(kind: TextMarkupKind) {
    if (!this.pdf) throw new Error("Open a PDF before adding an annotation.");
    const selection = await this.readSelectedTextGeometry();
    if (selection.length === 0)
      throw new Error("Select text on the page before adding this annotation.");
    const status =
      kind === "Underline" ? "Underline added to document" : "Strike-through added to document";
    return this.mutate(status, async () => {
      const hex = useWorkspace.getState().highlightColor;
      const color: [number, number, number] = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      ];
      const bytes = await this.pdf!.saveDocument();
      const marked = await addTextMarkupAnnotations(
        bytes,
        kind,
        selection.map((item) => ({
          page: item.page,
          quads: item.quads,
          contents: item.text,
          color,
        })),
      );
      await this.replaceWithBytes(marked, status, { preMutationBytes: bytes });
      window.getSelection()?.removeAllRanges();
      this.setTool("select");
    });
  }
  exportComments() {
    const state = useWorkspace.getState();
    if (!state.document || !this.pdf) throw new Error("Open a PDF before exporting comments.");
    return JSON.stringify(
      createCommentExchange(
        state.document.id,
        this.pdf.numPages,
        state.comments,
        this.identity ?? `${state.document.id}:${this.pdf.numPages}`,
      ),
      null,
      2,
    );
  }
  async importComments(source: string) {
    if (!this.pdf) throw new Error("Open a PDF before importing comments.");
    const state = useWorkspace.getState();
    if (!state.document) throw new Error("Open a PDF before importing comments.");
    if (!this.identity) {
      this.identity = await contentIdentity(this.pdf).catch(() => null);
    }
    const exchange = parseCommentExchange(source, this.pdf.numPages, this.identity ?? undefined);
    if (
      exchange.version === 2 &&
      exchange.identity &&
      this.identity &&
      exchange.identity !== this.identity
    )
      throw new Error("These comments belong to a different document.");
    if (exchange.version === 1 && exchange.documentId && exchange.documentId !== state.document.id)
      throw new Error("These comments belong to a different document.");
    const existing = new Set(state.comments.map((comment) => comment.id));
    const pending = exchange.comments.filter((comment) => !existing.has(comment.id));
    if (pending.length === 0) throw new Error("Every imported comment is already present.");
    state.set({ busy: true, status: "Importing comments" });
    try {
      let bytes = await this.pdf.saveDocument();
      let added = 0;
      for (const comment of pending) {
        if (!comment.rect) continue;
        if (comment.type === "Text") {
          bytes = (await addStickyNoteToPdf(bytes, {
            page: comment.page,
            x: comment.rect[0],
            y: comment.rect[3],
            size: Math.max(
              12,
              Math.min(
                64,
                Math.min(
                  Math.abs(comment.rect[2] - comment.rect[0]),
                  Math.abs(comment.rect[3] - comment.rect[1]),
                ),
              ),
            ),
            contents: comment.text,
            color: comment.color,
            id: comment.id,
          })) as Uint8Array<ArrayBuffer>;
          added++;
        } else if (
          comment.type === "Highlight" ||
          comment.type === "Underline" ||
          comment.type === "StrikeOut"
        ) {
          const quads =
            comment.quads && comment.quads.length > 0
              ? comment.quads.map((q) => ({
                  x1: q.length === 4 ? q[0] : Math.min(q[0], q[2], q[4], q[6]),
                  y1: q.length === 4 ? q[1] : Math.min(q[1], q[3], q[5], q[7]),
                  x2: q.length === 4 ? q[2] : Math.max(q[0], q[2], q[4], q[6]),
                  y2: q.length === 4 ? q[3] : Math.max(q[1], q[3], q[5], q[7]),
                }))
              : [
                  {
                    x1: Math.min(comment.rect[0], comment.rect[2]),
                    y1: Math.min(comment.rect[1], comment.rect[3]),
                    x2: Math.max(comment.rect[0], comment.rect[2]),
                    y2: Math.max(comment.rect[1], comment.rect[3]),
                  },
                ];
          bytes = (await addTextMarkupAnnotations(bytes, comment.type, [
            {
              page: comment.page,
              quads,
              contents: comment.text,
              color: comment.color,
              opacity: comment.opacity,
              id: comment.id,
            },
          ])) as Uint8Array<ArrayBuffer>;
          added++;
        } else if (
          comment.type === "Square" ||
          comment.type === "Circle" ||
          comment.type === "Line" ||
          comment.type === "Arrow"
        ) {
          const start: [number, number] = comment.line
            ? [comment.line[0], comment.line[1]]
            : [comment.rect[0], comment.rect[1]];
          const end: [number, number] = comment.line
            ? [comment.line[2], comment.line[3]]
            : [comment.rect[2], comment.rect[3]];
          bytes = (await addShapeAnnotation(bytes, {
            page: comment.page,
            kind: comment.type,
            start,
            end,
            color: comment.color,
            width: comment.width,
            opacity: comment.opacity,
            id: comment.id,
          })) as Uint8Array<ArrayBuffer>;
          added++;
        }
      }
      if (added === 0) throw new Error("The comment file has no importable geometry.");
      await this.replaceWithBytes(bytes, `${added} comment${added === 1 ? "" : "s"} imported`, {
        preMutationBytes: await this.pdf.saveDocument(),
      });
      return added;
    } finally {
      useWorkspace.getState().set({ busy: false });
    }
  }
  selectAnnotation(id: string) {
    const comment = useWorkspace.getState().comments.find((item) => item.id === id);
    if (!comment) return;
    useWorkspace.getState().set({
      selectedAnnotationId: id,
      hasSelection: true,
      sidebar: "comments",
      page: comment.page,
      tool: "select",
    });
    this.setTool("select");
    this.goTo(comment.page);
  }
  private async applyAnnotationEdit(input: Parameters<typeof updateAnnotation>[1], status: string) {
    if (!this.pdf) throw new Error("Open a PDF before editing an annotation.");
    return this.mutate(status, async () => {
      const bytes = await this.pdf!.saveDocument();
      const updated = await updateAnnotation(bytes, input);
      await this.replaceWithBytes(updated, status, { preMutationBytes: bytes });
      useWorkspace.getState().set({
        selectedAnnotationId: input.id,
        hasSelection: true,
      });
    });
  }
  async updateSelectedAnnotation(patch: Omit<Parameters<typeof updateAnnotation>[1], "id">) {
    const id = useWorkspace.getState().selectedAnnotationId;
    if (!id) return;
    await this.applyAnnotationEdit({ id, ...patch }, "Annotation properties updated");
  }
  async moveSelectedAnnotation(dx: number, dy: number) {
    const selected = useWorkspace
      .getState()
      .comments.find((item) => item.id === useWorkspace.getState().selectedAnnotationId);
    if (!selected?.rect) return;
    const [x1, y1, x2, y2] = selected.rect;
    if (selected.line) {
      const [sx, sy, ex, ey] = selected.line;
      await this.updateSelectedAnnotation({
        rect: [x1 + dx, y1 + dy, x2 + dx, y2 + dy],
        line: [sx + dx, sy + dy, ex + dx, ey + dy],
      });
    } else {
      await this.updateSelectedAnnotation({
        rect: [x1 + dx, y1 + dy, x2 + dx, y2 + dy],
      });
    }
  }
  async resizeSelectedAnnotation(dw: number, dh: number) {
    const selected = useWorkspace
      .getState()
      .comments.find((item) => item.id === useWorkspace.getState().selectedAnnotationId);
    if (!selected?.rect) return;
    const [x1, y1, x2, y2] = selected.rect;
    const nextRect: [number, number, number, number] = [x1, y1, x2 + dw, y2 + dh];
    if (selected.line) {
      const [sx, sy, ex, ey] = selected.line;
      const scaleX = x2 === x1 ? 1 : (nextRect[2] - nextRect[0]) / (x2 - x1);
      const scaleY = y2 === y1 ? 1 : (nextRect[3] - nextRect[1]) / (y2 - y1);
      await this.updateSelectedAnnotation({
        rect: nextRect,
        line: [
          nextRect[0] + (sx - x1) * scaleX,
          nextRect[1] + (sy - y1) * scaleY,
          nextRect[0] + (ex - x1) * scaleX,
          nextRect[1] + (ey - y1) * scaleY,
        ],
      });
    } else {
      await this.updateSelectedAnnotation({ rect: nextRect });
    }
  }
  async deleteSelectedAnnotation() {
    const id = useWorkspace.getState().selectedAnnotationId;
    if (!id || !this.pdf) return;
    return this.mutate("Annotation deleted", async () => {
      const bytes = await this.pdf!.saveDocument();
      let deleted = await deleteAnnotation(bytes, id);
      if (native) {
        try {
          deleted = await pruneDocument(deleted);
        } catch {
          // ignore or fall back
        }
      } else {
        useWorkspace.getState().set({
          status: "Deleted objects remain in the file until saved from the desktop app.",
        });
      }
      await this.replaceWithBytes(deleted, "Annotation deleted", {
        preMutationBytes: bytes,
      });
      useWorkspace.getState().set({
        selectedAnnotationId: null,
        hasSelection: false,
      });
    });
  }
  undo() {
    if (this.nativeCanUndo || (!this.history.canUndo() && this.editor)) {
      this.editor?.undo();
      return;
    }
    const revision = this.history.undo();
    if (!revision) return;
    this.updateHistoryControls();
    void this.applyRevision(revision, "Undo").catch(() => {
      this.history.restoreAfterFailedMove("undo");
      this.updateHistoryControls();
    });
  }
  redo() {
    if (this.nativeCanRedo || (!this.history.canRedo() && this.editor)) {
      this.editor?.redo();
      return;
    }
    const revision = this.history.redo();
    if (!revision) return;
    this.updateHistoryControls();
    void this.applyRevision(revision, "Redo").catch(() => {
      this.history.restoreAfterFailedMove("redo");
      this.updateHistoryControls();
    });
  }
  seedRevision(
    bytes: Uint8Array,
    numPages: number,
    description = "Opened PDF",
    revisionId?: string,
  ) {
    this.history.seed({ bytes, numPages, description, revisionId });
    this.committedRevisionId = revisionId;
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.updateHistoryControls();
  }
  clearRevisionHistory() {
    this.history.clear();
    this.committedRevisionId = undefined;
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.updateHistoryControls();
  }
  isDirty(): boolean {
    return (
      this.storageModified ||
      !this.history.isAtSavedRevision() ||
      this.nativeCanUndo ||
      this.nativeCanRedo
    );
  }
  markSaved(bytes: Uint8Array, numPages: number) {
    this.history.adopt({ bytes, numPages, description: "Saved PDF" });
    this.history.markSaved();
    this.storageModified = false;
    const dirty = this.isDirty();
    useWorkspace.getState().set({ dirty });
    void markDirty(dirty).catch(() => {});
    this.updateHistoryControls();
  }
  markUnsavedRevision() {
    this.history.markUnsaved();
  }
  deleteSelected() {
    if (useWorkspace.getState().selectedAnnotationId) {
      void this.deleteSelectedAnnotation();
      return;
    }
    this.editor?.delete();
  }
  zoom(value: number | string) {
    if (typeof value === "string") this.viewer.currentScaleValue = value;
    else this.viewer.currentScale = boundedZoom(value);
  }
  goTo(page: number) {
    if (this.pdf) this.viewer.currentPageNumber = Math.max(1, Math.min(this.pdf.numPages, page));
  }
  search(again = false, backward = false) {
    const s = useWorkspace.getState();
    this.searchGeneration++;
    if (!again) s.set({ searchPending: !!s.searchQuery, results: [], searchCount: 0 });
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
        useWorkspace.getState().set({ error: "Search context could not be read from this PDF." }),
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
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
          .join("");
        this.contexts.set(p, text);
        if (this.contexts.size > 40) this.contexts.delete(this.contexts.keys().next().value!);
      }
      if (generation !== this.generation || search !== this.searchGeneration) return;
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
    let pdfLibDoc: PDFDocument | null = null;
    try {
      const bytes = await this.pdf.saveDocument();
      pdfLibDoc = await PDFDocument.load(bytes);
    } catch {
      // Fallback to PDF.js data only in mock environments
    }

    for (let p = 1; p <= this.pdf.numPages; p++) {
      const page = await this.pdf.getPage(p);
      const annotations: unknown[] = await page.getAnnotations();
      if (generation !== this.generation) return;

      const pagePdfLib =
        pdfLibDoc && p - 1 < pdfLibDoc.getPageCount() ? pdfLibDoc.getPage(p - 1) : null;
      const annotsPdfLib = pagePdfLib?.node.Annots();

      for (const raw of annotations) {
        const a = raw as {
          id: string;
          annotationName?: string;
          subtype?: string;
          contentsObj?: { str: string };
          rect?: number[];
          lineCoordinates?: number[];
          lineEndings?: string[];
          name?: string;
          inReplyTo?: string;
          state?: string;
          quadPoints?: number[];
          color?: ArrayLike<number>;
          opacity?: number;
          borderStyle?: { width?: number };
        };
        if (
          a.subtype === "Text" ||
          a.subtype === "Highlight" ||
          a.subtype === "Underline" ||
          a.subtype === "StrikeOut" ||
          a.subtype === "Square" ||
          a.subtype === "Circle" ||
          a.subtype === "Line" ||
          a.subtype === "Stamp"
        ) {
          const id = a.annotationName || a.id;
          let isArrow = false;
          let lineEndings: [string, string] | undefined =
            a.lineEndings && a.lineEndings.length === 2
              ? [a.lineEndings[0], a.lineEndings[1]]
              : undefined;
          if (lineEndings && lineEndings.some((le) => le && le.toLowerCase().includes("arrow"))) {
            isArrow = true;
          }

          let pdfLibLine: [number, number, number, number] | undefined;
          let pdfLibQuads: number[][] | undefined;

          if (annotsPdfLib) {
            for (let i = 0; i < annotsPdfLib.size(); i++) {
              const d = annotsPdfLib.lookup(i, PDFDict);
              const nm = d.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.asString();
              const entry = annotsPdfLib.get(i);
              if (nm === id || annotationIdentifier(entry) === id || id === `annot_${i}`) {
                const rawL = d.lookupMaybe(PDFName.of("L"), PDFArray);
                if (rawL && rawL.size() === 4) {
                  pdfLibLine = [
                    (rawL.get(0) as PDFNumber).asNumber(),
                    (rawL.get(1) as PDFNumber).asNumber(),
                    (rawL.get(2) as PDFNumber).asNumber(),
                    (rawL.get(3) as PDFNumber).asNumber(),
                  ];
                }
                const rawLE = d.lookupMaybe(PDFName.of("LE"), PDFArray);
                if (rawLE && rawLE.size() === 2) {
                  const s0 = rawLE.lookupMaybe(0, PDFName)?.decodeText() ?? "None";
                  const s1 = rawLE.lookupMaybe(1, PDFName)?.decodeText() ?? "None";
                  lineEndings = [s0, s1];
                  if (s0.toLowerCase().includes("arrow") || s1.toLowerCase().includes("arrow")) {
                    isArrow = true;
                  }
                }
                const rawQP = d.lookupMaybe(PDFName.of("QuadPoints"), PDFArray);
                if (rawQP && rawQP.size() >= 8) {
                  const qList: number[][] = [];
                  for (let k = 0; k + 7 < rawQP.size(); k += 8) {
                    const qx1 = Math.min(
                      (rawQP.get(k) as PDFNumber).asNumber(),
                      (rawQP.get(k + 2) as PDFNumber).asNumber(),
                      (rawQP.get(k + 4) as PDFNumber).asNumber(),
                      (rawQP.get(k + 6) as PDFNumber).asNumber(),
                    );
                    const qy1 = Math.min(
                      (rawQP.get(k + 1) as PDFNumber).asNumber(),
                      (rawQP.get(k + 3) as PDFNumber).asNumber(),
                      (rawQP.get(k + 5) as PDFNumber).asNumber(),
                      (rawQP.get(k + 7) as PDFNumber).asNumber(),
                    );
                    const qx2 = Math.max(
                      (rawQP.get(k) as PDFNumber).asNumber(),
                      (rawQP.get(k + 2) as PDFNumber).asNumber(),
                      (rawQP.get(k + 4) as PDFNumber).asNumber(),
                      (rawQP.get(k + 6) as PDFNumber).asNumber(),
                    );
                    const qy2 = Math.max(
                      (rawQP.get(k + 1) as PDFNumber).asNumber(),
                      (rawQP.get(k + 3) as PDFNumber).asNumber(),
                      (rawQP.get(k + 5) as PDFNumber).asNumber(),
                      (rawQP.get(k + 7) as PDFNumber).asNumber(),
                    );
                    qList.push([qx1, qy1, qx2, qy2]);
                  }
                  if (qList.length > 0) pdfLibQuads = qList;
                }
                break;
              }
            }
          }

          const commentType = isArrow ? "Arrow" : a.subtype;
          const comment: Comment = {
            id,
            page: p,
            type: commentType,
            text: a.contentsObj?.str || `${commentType} annotation`,
          };
          if (a.subtype === "Stamp") comment.stampName = a.name;
          if (a.inReplyTo) comment.replyTo = a.inReplyTo;
          if (
            a.state === "Accepted" ||
            a.state === "Rejected" ||
            a.state === "Cancelled" ||
            a.state === "Completed"
          )
            comment.reviewState = a.state;
          if (a.rect?.length === 4 && a.rect.every(finite))
            comment.rect = [a.rect[0], a.rect[1], a.rect[2], a.rect[3]];
          if (pdfLibLine) {
            comment.line = pdfLibLine;
          } else if (a.lineCoordinates?.length === 4 && a.lineCoordinates.every(finite)) {
            comment.line = [
              a.lineCoordinates[0],
              a.lineCoordinates[1],
              a.lineCoordinates[2],
              a.lineCoordinates[3],
            ];
          }
          if (lineEndings) comment.lineEndings = lineEndings;
          if (pdfLibQuads) {
            comment.quads = pdfLibQuads;
          } else if (a.quadPoints && a.quadPoints.length >= 8) {
            const qList: number[][] = [];
            for (let k = 0; k + 7 < a.quadPoints.length; k += 8) {
              const qx1 = Math.min(
                a.quadPoints[k],
                a.quadPoints[k + 2],
                a.quadPoints[k + 4],
                a.quadPoints[k + 6],
              );
              const qy1 = Math.min(
                a.quadPoints[k + 1],
                a.quadPoints[k + 3],
                a.quadPoints[k + 5],
                a.quadPoints[k + 7],
              );
              const qx2 = Math.max(
                a.quadPoints[k],
                a.quadPoints[k + 2],
                a.quadPoints[k + 4],
                a.quadPoints[k + 6],
              );
              const qy2 = Math.max(
                a.quadPoints[k + 1],
                a.quadPoints[k + 3],
                a.quadPoints[k + 5],
                a.quadPoints[k + 7],
              );
              qList.push([qx1, qy1, qx2, qy2]);
            }
            if (qList.length > 0) comment.quads = qList;
          }
          if (a.color?.length === 3)
            comment.color = [a.color[0] / 255, a.color[1] / 255, a.color[2] / 255];
          if (a.opacity !== undefined && finite(a.opacity)) comment.opacity = a.opacity;
          if (a.borderStyle?.width !== undefined && finite(a.borderStyle.width))
            comment.width = a.borderStyle.width;
          comments.push(comment);
        }
      }
      if (p % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const state = useWorkspace.getState();
    state.set({
      comments,
      ...(state.selectedAnnotationId &&
      comments.some((item) => item.id === state.selectedAnnotationId)
        ? {}
        : { selectedAnnotationId: null, hasSelection: false }),
    });
  }
}

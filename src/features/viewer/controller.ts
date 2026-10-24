import { mapInOrder } from "../../utils/async-sequence";
import { allPageNumbers } from "../../utils/pdf-pages";
import {
  AnnotationEditorType,
  AnnotationMode,
  AnnotationEditorParamsType,
  PermissionFlag,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
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
  DocumentLayer,
} from "../../types/document";
import type { DocumentRevision } from "../../types/operations";
import { useWorkspace } from "../../stores/workspace";
import { positionSearchCursor } from "../search/select-result";
import { boundedZoom, snippet, searchCriteriaKey } from "../../utils/search";
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
  type TextMarkupKind,
} from "../../services/document-commands";
import { enhanceDateFields } from "./date-fields";
import {
  addCallout,
  addCloud,
  addFileAttachmentComment,
  addPolyShape,
  addTextEditProposal,
} from "../../services/pdf/comment-types";
import { addMeasurement, type MeasurementInput } from "../../services/pdf/measure";
import { PDFDocument } from "pdf-lib";
import { readComment } from "../../services/pdf/read-comment";
import { installHighlightInterop } from "./highlight-interop";
import { readTextSelectionGeometry } from "./selection-geometry";
import { createCommentExchange, parseCommentExchange } from "../../services/comment-exchange";
import { contentIdentity } from "../../services/document-identity";
import { ViewHistory } from "./view-history";
import { ReadAloud } from "./read-aloud";
import { AutoScroll } from "./auto-scroll";
import type { PageColors } from "./page-colors";
import { preparePrintContent } from "../pages/print-options";
import { inkedBounds } from "./view-geometry";
import { imagePngAt } from "./page-images";
import { eraseInk } from "../../services/pdf/ink-eraser";
import { readHideActions, type HideAction } from "../../services/pdf/hide-actions";

/** A document kept open in a background tab while another tab is shown. */
export interface ParkedDocument {
  pdf: PDFDocumentProxy;
  revisionTask: PDFDocumentLoadingTask | null;
  history: RevisionHistory;
  views: ViewHistory;
  committedRevisionId: string | undefined;
  scale: string;
  page: number;
  rotation: number;
  /** The PDF point at the top left of the window, which stays valid when the zoom is reapplied. */
  location: { pageNumber: number; left: number; top: number } | null;
  layers: DocumentLayer[];
}

/** Reports the page left by link and bookmark jumps so Previous View can return to it. */
class HistoryLinkService extends PDFLinkService {
  onJump: ((from: number) => void) | null = null;
  override async goToDestination(dest: string | unknown[]) {
    const from = this.page;
    await super.goToDestination(dest);
    this.jumped(from);
  }
  override goToPage(value: number | string) {
    const from = this.page;
    super.goToPage(value);
    this.jumped(from);
  }
  private jumped(from: number) {
    if (this.page !== from) this.onJump?.(from);
  }
}

type OptionalContentOrder = Array<string | { name: string | null; order: OptionalContentOrder }>;

function orderedLayerIds(order: OptionalContentOrder | null | undefined, ids: string[] = []) {
  for (const item of order ?? []) {
    if (typeof item === "string") ids.push(item);
    else orderedLayerIds(item.order, ids);
  }
  return ids;
}

type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];

function mapBookmarks(nodes: OutlineItem[]): Bookmark[] {
  return nodes
    .filter((node) => node.dest || (node.items && node.items.length > 0))
    .map((node) => ({
      title: node.title,
      destination: (node.dest as string | unknown[]) ?? null,
      children: node.items ? mapBookmarks(node.items) : [],
    }));
}

function searchTextItem(item: unknown): string {
  if (!item || typeof item !== "object" || !("str" in item)) return "";
  const textItem = item as { str: string; hasEOL?: boolean };
  return textItem.str + (textItem.hasEOL ? "\n" : "");
}

async function inspectDocumentCapabilities(pdf: PDFDocumentProxy) {
  const result: {
    formNotice: string | null;
    hasDigitalSignature: boolean;
    editingAllowed?: boolean;
  } = {
    formNotice: null,
    hasDigitalSignature: false,
  };
  if (pdf.isPureXfa || Boolean(pdf.allXfaHtml)) {
    result.formNotice = "XFA forms are not supported. Form elements are read-only or unavailable.";
  }
  try {
    const actions = await pdf.getJSActions();
    if (actions && actions.size > 0) {
      result.formNotice = "Script-based calculations and actions are disabled for document safety.";
    }
  } catch {
    // Some PDF.js versions do not expose JavaScript actions.
  }
  try {
    const fieldObjects = await pdf.getFieldObjects();
    result.hasDigitalSignature = Boolean(
      fieldObjects &&
      [...fieldObjects.values()].some((fields) =>
        fields.some((field) => {
          const value = field as { type?: string; subtype?: string };
          return value.type === "signature" || value.subtype === "Sig";
        }),
      ),
    );
  } catch {
    // Field inspection is best effort for malformed forms.
  }
  try {
    if (typeof pdf.getPermissions === "function") {
      const permissions = await pdf.getPermissions();
      result.editingAllowed = !permissions || permissions.has(PermissionFlag.MODIFY_CONTENTS);
    }
  } catch {
    // Keep the default editing policy when permissions cannot be read.
  }
  return result;
}

function commentQuads(comment: Comment) {
  if (comment.quads && comment.quads.length > 0) {
    return comment.quads.map((quad) => ({
      x1: quad.length === 4 ? quad[0] : Math.min(quad[0], quad[2], quad[4], quad[6]),
      y1: quad.length === 4 ? quad[1] : Math.min(quad[1], quad[3], quad[5], quad[7]),
      x2: quad.length === 4 ? quad[2] : Math.max(quad[0], quad[2], quad[4], quad[6]),
      y2: quad.length === 4 ? quad[3] : Math.max(quad[1], quad[3], quad[5], quad[7]),
    }));
  }
  return [
    {
      x1: Math.min(comment.rect![0], comment.rect![2]),
      y1: Math.min(comment.rect![1], comment.rect![3]),
      x2: Math.max(comment.rect![0], comment.rect![2]),
      y2: Math.max(comment.rect![1], comment.rect![3]),
    },
  ];
}

async function importCommentGeometry(
  bytes: Uint8Array,
  comment: Comment,
): Promise<Uint8Array | null> {
  if (!comment.rect) return null;
  if (comment.type === "Text") {
    return addStickyNoteToPdf(bytes, {
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
    });
  }
  if (["Highlight", "Underline", "StrikeOut"].includes(comment.type)) {
    return addTextMarkupAnnotations(bytes, comment.type as TextMarkupKind, [
      {
        page: comment.page,
        quads: commentQuads(comment),
        contents: comment.text,
        color: comment.color,
        opacity: comment.opacity,
        id: comment.id,
      },
    ]);
  }
  if (["Square", "Circle", "Line", "Arrow"].includes(comment.type)) {
    const start: [number, number] = comment.line
      ? [comment.line[0], comment.line[1]]
      : [comment.rect[0], comment.rect[1]];
    const end: [number, number] = comment.line
      ? [comment.line[2], comment.line[3]]
      : [comment.rect[2], comment.rect[3]];
    return addShapeAnnotation(bytes, {
      page: comment.page,
      kind: comment.type as ShapeKind,
      start,
      end,
      color: comment.color,
      width: comment.width,
      opacity: comment.opacity,
      id: comment.id,
    });
  }
  return null;
}

async function readPageComments(
  pdf: PDFDocumentProxy,
  pdfLibDoc: PDFDocument | null,
  pageNumber: number,
  generation: number,
  currentGeneration: () => number,
): Promise<Comment[] | null> {
  const page = await pdf.getPage(pageNumber);
  const annotations: unknown[] = await page.getAnnotations();
  if (generation !== currentGeneration()) return null;
  const pagePdfLib =
    pdfLibDoc && pageNumber - 1 < pdfLibDoc.getPageCount()
      ? pdfLibDoc.getPage(pageNumber - 1)
      : null;
  const annotsPdfLib = pagePdfLib?.node.Annots();
  return annotations
    .map((raw) => readComment(raw, pageNumber, annotsPdfLib))
    .filter((comment): comment is Comment => comment !== null);
}

/** A "#rrggbb" color as PDF RGB components from 0 to 1. */
function rgbFromHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

export class ViewerController {
  readonly bus = new EventBus();
  readonly links = new HistoryLinkService({
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
  private readonly contexts = new Map<number, string>();
  private readonly abort = new AbortController();
  private searchGeneration = 0;
  private findPending = false;
  private searchClosed = false;
  private activeSearchKey = "";
  /** Replaced, with the view history, when another tab's document is shown. */
  history = new RevisionHistory();
  private nativeCanUndo = false;
  private nativeCanRedo = false;
  private committedRevisionId: string | undefined;
  private storageModified = false;
  private readonly mutationQueue = new MutationQueue();
  private identity: string | null = null;
  private replacing = false;
  /** The zoom to restore when a revision of the open document is attached. */
  private keptScale: string | null = null;
  /** Show or hide field actions of each shown document, read once when a page needs them. */
  private readonly hideActions = new WeakMap<PDFDocumentProxy, Promise<Map<string, HideAction>>>();
  /** Field widgets hidden on screen by a show or hide action; this is not saved. */
  private readonly hiddenFields = new Set<string>();
  /** A background tab's document being shown again, whose zoom and view history are kept. */
  private resuming: ParkedDocument | null = null;
  /** A copy of the document without comments, shown in place of it while comments are hidden. */
  private commentFreeCopy: PDFDocumentLoadingTask | null = null;
  views = new ViewHistory();
  readonly readAloud = new ReadAloud({
    pageText: (page) => this.pageText(page),
    showPage: (page) => {
      if (this.pdf && this.viewer.currentPageNumber !== page) this.viewer.currentPageNumber = page;
    },
    onState: (readAloud, page) => {
      useWorkspace
        .getState()
        .set({ readAloud, ...(page === null ? {} : { status: `Reading page ${page} aloud` }) });
    },
  });
  readonly autoScroll: AutoScroll;

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
    this.links.onJump = (from) => {
      this.recordView(from);
    };
    this.autoScroll = new AutoScroll({
      container,
      nextPage: () => {
        if (!this.pdf || useWorkspace.getState().layout !== "single") return false;
        if (this.viewer.currentPageNumber >= this.pdf.numPages) return false;
        this.viewer.currentPageNumber++;
        return true;
      },
      onChange: (autoScroll) => {
        useWorkspace.getState().set({ autoScroll });
      },
    });
    const on = (name: string, handler: (event: never) => void) =>
      this.bus.on(name, handler, { signal: this.abort.signal });
    on("pagesinit", () => {
      this.setLayout(useWorkspace.getState().layout);
      const scale = this.keptScale ?? useWorkspace.getState().local.preferences.defaultZoom;
      this.keptScale = null;
      if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.viewer.currentScaleValue = scale;
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
    on(
      "annotationlayerrendered",
      ({ source }: { source: { div: HTMLElement; pdfPage?: PDFPageProxy | null } }) => {
        // Fields in the comment-free copy are drawn but cannot be filled, so no entry is lost.
        if (this.commentFreeCopy)
          for (const field of source.div.querySelectorAll<HTMLElement>(
            '[class*="WidgetAnnotation"]',
          ))
            field.inert = true;
        this.applyHiddenFields(source.div);
        void source.pdfPage
          ?.getAnnotations()
          .then(async (annotations) => {
            enhanceDateFields(source.div, annotations);
            await this.bindHideActions(source.div, annotations);
          })
          .catch(() => {
            // Fields stay usable as plain text when annotations cannot be read again.
          });
      },
    );
    on("textlayerrendered", ({ error }: { error?: unknown }) => {
      if (error)
        useWorkspace.getState().set({
          error: `Text selection could not be prepared: ${error instanceof Error ? error.message : "Unknown rendering error"}`,
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
        const message = error instanceof Error ? error.message : "Unknown rendering error";
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
      this.findPending = state === 3;
      useWorkspace.getState().set({
        searchPending: this.findPending,
        ...(this.findPending ? { searchResultsKey: "" } : {}),
      });
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
  /** Shows a document; `keepScale` keeps the current zoom for a revision of the open document. */
  async attach(pdf: PDFDocumentProxy, keepScale = this.replacing) {
    this.started = performance.now();
    this.generation++;
    const generation = this.generation;
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.contexts.clear();
    this.storageModified = false;
    // An edit reloads the document; keep the reader's zoom instead of the default.
    this.keptScale = keepScale ? String(this.viewer.currentScaleValue) : null;
    if (this.resuming) {
      this.keptScale = this.resuming.scale;
      this.readAloud.stop();
      this.autoScroll.stop();
    } else if (!this.replacing) {
      this.hiddenFields.clear();
      this.views.clear();
      this.readAloud.stop();
      this.autoScroll.stop();
    }
    this.pdf = pdf;
    const pageLabels =
      typeof pdf.getPageLabels === "function" ? await pdf.getPageLabels().catch(() => null) : null;
    useWorkspace.getState().set({ pageLabels });
    this.links.setDocument(pdf);
    this.find.setDocument(pdf);
    this.viewer.setDocument(pdf);
    this.releaseCommentFreeCopy();
    this.updateViewControls();
    await this.refreshLayers(generation);
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
      useWorkspace.getState().set({
        error: `Text extraction failed: ${error instanceof Error ? error.message : "Unknown rendering error"}`,
      });
    }
    const outline = await pdf.getOutline();
    if (generation !== this.generation) return;
    useWorkspace.getState().set({ bookmarks: outline ? mapBookmarks(outline) : [] });

    // Inspect forms, XFA, scripts, and digital signatures. Clear the previous document's
    // findings first so the session can carry these values across its store reset.
    useWorkspace.getState().set(await inspectDocumentCapabilities(pdf));

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
    this.releaseCommentFreeCopy();
    this.links.setDocument(null);
    this.find.setDocument(null as unknown as PDFDocumentProxy);
    this.readAloud.stop();
    this.autoScroll.stop();
    this.views.clear();
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
      expectedSource?: PDFDocumentProxy | null;
      pageMapping?: number[];
      warnings?: string[];
      /** Drop earlier revisions, e.g. after redaction or unlocking, so undo cannot restore them. */
      resetHistory?: boolean;
      /** Pre-mutation document bytes to record in undo history without re-serializing. */
      preMutationBytes?: Uint8Array;
    },
  ) {
    if (this.replacing) throw new Error("Another document replacement is in progress.");
    const wasBusy = useWorkspace.getState().busy;
    this.replacing = true;
    useWorkspace.getState().set({ busy: true });
    try {
      await this.commitReplacement(bytes, status, options);
    } finally {
      this.replacing = false;
      useWorkspace.getState().set({ busy: wasBusy });
    }
  }
  private async commitReplacement(
    bytes: Uint8Array,
    status: string,
    options?: {
      expectedSource?: PDFDocumentProxy | null;
      pageMapping?: number[];
      warnings?: string[];
      /** Drop earlier revisions, e.g. after redaction or unlocking, so undo cannot restore them. */
      resetHistory?: boolean;
      /** Pre-mutation document bytes to record in undo history without re-serializing. */
      preMutationBytes?: Uint8Array;
    },
  ) {
    const source = options?.expectedSource === undefined ? this.pdf : options.expectedSource;
    const documentId = useWorkspace.getState().document?.id;
    const generation = this.generation;
    const ensureSource = () => {
      if (
        options?.expectedSource === null ||
        this.pdf !== source ||
        this.generation !== generation ||
        useWorkspace.getState().document?.id !== documentId
      ) {
        throw new Error(
          "The document changed while this operation was running. Run the tool again on the current document.",
        );
      }
    };
    ensureSource();
    this.editor?.commitOrRemove();
    // PDF.js transfers the candidate buffer to its worker while loading it.
    // Keep an owned copy for history and later rollback bookkeeping.
    const candidateBytes = new Uint8Array(bytes);
    const historyBytes = new Uint8Array(candidateBytes);
    let previousBytes: Uint8Array | null = null;
    if (!options?.resetHistory) {
      previousBytes = options?.preMutationBytes ?? null;
      if (!previousBytes && this.pdf && typeof this.pdf.saveDocument === "function") {
        previousBytes = await this.pdf.saveDocument();
      }
    }
    ensureSource();
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
    let loaded: PDFDocumentProxy | undefined;
    let nativeRevisionId: string | undefined;
    try {
      loaded = await task.promise;
      ensureSource();
      await this.attach(loaded);
      await this.viewer.firstPagePromise;
      if (
        this.pdf !== loaded ||
        this.generation !== generation + 1 ||
        useWorkspace.getState().document?.id !== documentId
      ) {
        throw new Error("The document changed before the operation could be committed.");
      }
      nativeRevisionId = await this.commitNativeRevision(
        historyBytes,
        loaded.numPages,
        previousState.document,
      );
    } catch (error) {
      await task.destroy().catch(() => {});
      if (
        previousPdf &&
        loaded &&
        this.pdf === loaded &&
        useWorkspace.getState().document?.id === documentId
      ) {
        await this.attach(previousPdf);
        this.goTo(previousState.page);
        useWorkspace.getState().set(previousState);
      }
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
      await this.attach(loaded, true);
      await this.viewer.firstPagePromise;
      await this.commitNativeRevision(revision.bytes, loaded.numPages, previousState.document);
    } catch (error) {
      await task.destroy().catch(() => {});
      if (previousPdf && this.pdf !== previousPdf) {
        await this.attach(previousPdf, true);
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
  /** Release DOM listeners while the app owner retains the PDF for emergency saving. */
  suspendView() {
    this.abort.abort();
    this.readAloud.stop();
    this.autoScroll.stop();
    this.searchGeneration++;
    clearTimeout(this.searchTimer);
    clearTimeout(this.pageTimer);
  }
  destroy() {
    this.suspendView();
    void this.detach();
  }
  /**
   * Draws the open document's pages again, for example with other page colours, keeping the
   * page, zoom, view rotation and layer visibility. `shown` is the open document or its
   * comment-free copy.
   */
  private async redisplay(shown: PDFDocumentProxy) {
    const page = this.viewer.currentPageNumber;
    const rotation = this.viewer.pagesRotation;
    const { scrollLeft, scrollTop } = this.container;
    this.keptScale = String(this.viewer.currentScaleValue);
    this.editor?.commitOrRemove();
    const ready = new Promise<void>((resolve) => {
      this.bus.on("pagesinit", () => resolve(), { once: true, signal: this.abort.signal });
    });
    this.viewer.setDocument(shown);
    await ready;
    if (this.viewer.pdfDocument !== shown) return;
    if (rotation) this.viewer.pagesRotation = rotation;
    this.viewer.currentPageNumber = Math.min(page, shown.numPages);
    // The pages keep their sizes, so the exact scroll position stays valid.
    this.container.scrollLeft = scrollLeft;
    this.container.scrollTop = scrollTop;
    await this.applyLayerVisibility(shown, useWorkspace.getState().layers);
  }
  /** Shows and hides optional content in the drawn pages as `layers` records. */
  private async applyLayerVisibility(shown: PDFDocumentProxy, layers: DocumentLayer[]) {
    const config = await this.viewer.optionalContentConfigPromise;
    if (!config || this.viewer.pdfDocument !== shown) return;
    for (const layer of layers) config.setVisibility(layer.id, layer.visible);
    this.viewer.optionalContentConfigPromise = Promise.resolve(config);
  }
  /** Replaces page colours on screen; null shows the document's own colours. */
  setPageColors(colors: PageColors | null) {
    const current = this.viewer.pageColors as PageColors | null;
    if (current?.foreground === colors?.foreground && current?.background === colors?.background)
      return;
    this.viewer.pageColors = colors;
    const shown = this.viewer.pdfDocument;
    if (shown)
      void this.foldViewEdits()
        .then((folded) => (folded ? undefined : this.redisplay(shown)))
        .catch((error: unknown) =>
          useWorkspace.getState().set({
            error: `Pages could not be redrawn: ${error instanceof Error ? error.message : String(error)}`,
          }),
        );
  }
  /**
   * Hides or shows every comment and pop-up. Form fields and links still draw. While comments are
   * hidden the pages show a copy without them, so fields cannot be filled until they are shown.
   */
  async setCommentsHidden(hidden: boolean) {
    let pdf = this.pdf;
    if (!pdf || hidden === !!this.commentFreeCopy) return;
    if (!hidden) {
      const copy = this.commentFreeCopy;
      this.commentFreeCopy = null;
      useWorkspace.getState().set({ commentsHidden: false, status: "Comments shown" });
      await this.redisplay(pdf);
      await copy?.destroy();
      return;
    }
    if (useWorkspace.getState().info?.encrypted)
      throw new Error("Comments cannot be hidden in a password-protected PDF opened read-only.");
    this.setTool("select");
    this.editor?.commitOrRemove();
    // Committing page-view edits attaches a new revision, which is the one to copy.
    if (await this.foldViewEdits()) pdf = this.pdf;
    if (!pdf) return;
    const generation = this.generation;
    const task = loadPdfFromBytes(
      (await preparePrintContent(await pdf.saveDocument(), "document")) as Uint8Array<ArrayBuffer>,
    );
    const copy = await task.promise.catch(async (error: unknown) => {
      await task.destroy();
      throw error;
    });
    if (generation !== this.generation || this.pdf !== pdf || this.commentFreeCopy) {
      await task.destroy();
      return;
    }
    this.commentFreeCopy = task;
    useWorkspace
      .getState()
      .set({ commentsHidden: true, selectedAnnotationId: null, status: "Comments hidden" });
    await this.redisplay(copy);
  }
  /**
   * Moves the open document to a background tab with its undo history, view history and view
   * position, leaving the viewer empty for another document. Edits the page view holds are
   * committed first so they are drawn when the tab returns.
   */
  async park(): Promise<ParkedDocument | null> {
    if (!this.pdf) return null;
    this.editor?.commitOrRemove();
    await this.foldViewEdits();
    const pdf = this.pdf;
    if (!pdf) return null;
    const parked: ParkedDocument = {
      pdf,
      revisionTask: this.revisionTask,
      history: this.history,
      views: this.views,
      committedRevisionId: this.committedRevisionId,
      scale: String(this.viewer.currentScaleValue),
      page: this.viewer.currentPageNumber,
      rotation: this.viewer.pagesRotation,
      location:
        (this.viewer as unknown as { _location?: ParkedDocument["location"] })._location ?? null,
      layers: useWorkspace.getState().layers,
    };
    this.readAloud.stop();
    this.autoScroll.stop();
    this.generation++;
    this.searchGeneration++;
    clearTimeout(this.searchTimer);
    clearTimeout(this.pageTimer);
    this.viewer.setDocument(null as unknown as PDFDocumentProxy);
    // The next document starts at the top; a hidden viewer would otherwise keep this offset.
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
    this.releaseCommentFreeCopy();
    this.links.setDocument(null);
    this.find.setDocument(null as unknown as PDFDocumentProxy);
    this.revisionTask = null;
    this.history = new RevisionHistory();
    this.views = new ViewHistory();
    this.committedRevisionId = undefined;
    this.editor = null;
    this.pdf = null;
    this.identity = null;
    this.nativeCanUndo = false;
    this.nativeCanRedo = false;
    this.storageModified = false;
    this.contexts.clear();
    return parked;
  }
  /** Shows a parked document again at the page, zoom, rotation and scroll it had. */
  async resume(parked: ParkedDocument) {
    this.history = parked.history;
    this.views = parked.views;
    this.revisionTask = parked.revisionTask;
    this.committedRevisionId = parked.committedRevisionId;
    // PDF.js can apply the zoom only while the viewer has a size, as it lacks one while hidden.
    for (let frame = 0; frame < 30 && this.container.clientWidth <= 0; frame++)
      await new Promise((resolve) => requestAnimationFrame(resolve));
    const shown = new Promise<void>((resolve) => {
      this.bus.on("pagesinit", () => resolve(), { once: true, signal: this.abort.signal });
    });
    this.resuming = parked;
    try {
      await this.attach(parked.pdf);
    } finally {
      this.resuming = null;
    }
    await shown;
    if (this.pdf !== parked.pdf) return;
    if (parked.rotation) {
      this.viewer.pagesRotation = parked.rotation;
      useWorkspace.getState().set({ viewRotation: parked.rotation as 0 | 90 | 180 | 270 });
    }
    const { location } = parked;
    if (location && location.pageNumber <= parked.pdf.numPages)
      this.viewer.scrollPageIntoView({
        pageNumber: location.pageNumber,
        destArray: [null, { name: "XYZ" }, location.left, location.top, null],
        allowNegativeOffset: true,
      });
    else this.viewer.currentPageNumber = Math.min(parked.page, parked.pdf.numPages);
    await this.applyLayerVisibility(parked.pdf, parked.layers);
    useWorkspace.getState().set({ layers: parked.layers });
    this.updateHistoryControls();
    this.updateViewControls();
  }
  /**
   * Commits edits the page view still holds, such as drawings and filled fields, as a revision.
   * Drawing the pages again would otherwise leave those edits saved but no longer on screen.
   * Returns true when the pages were drawn again by the commit.
   */
  private async foldViewEdits() {
    const pdf = this.pdf;
    if (!pdf || !this.storageModified || this.viewer.pdfDocument !== pdf) return false;
    await this.mutate("Keeping page edits", async () => {
      await this.replaceWithBytes(await pdf.saveDocument(), "Page edits kept");
    });
    return true;
  }
  private releaseCommentFreeCopy() {
    const copy = this.commentFreeCopy;
    if (!copy) return;
    this.commentFreeCopy = null;
    useWorkspace.getState().set({ commentsHidden: false });
    void copy.destroy();
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
      const labelIndex = useWorkspace.getState().pageLabels?.indexOf(label) ?? -1;
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
    // Page-view editors work on the pages on screen, so they need the document itself.
    if (this.commentFreeCopy && annotationEditorTypeForTool(tool) !== AnnotationEditorType.NONE) {
      void this.setCommentsHidden(false)
        .then(() => this.setTool(tool))
        .catch((error: unknown) =>
          useWorkspace
            .getState()
            .set({ error: error instanceof Error ? error.message : String(error) }),
        );
      return;
    }
    try {
      this.viewer.annotationEditorMode = {
        mode: annotationEditorTypeForTool(tool),
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
        Number.parseInt(hex.slice(1, 3), 16) / 255,
        Number.parseInt(hex.slice(3, 5), 16) / 255,
        Number.parseInt(hex.slice(5, 7), 16) / 255,
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
  /** Adds a shape to `page`, the page it was drawn on, which need not be the current page. */
  async addShape(
    kind: ShapeKind,
    start: [number, number],
    end: [number, number],
    page = this.currentPage(),
  ) {
    if (!this.pdf) throw new Error("Open a PDF before adding a shape.");
    const status = `${kind === "Arrow" ? "Arrow" : kind} added to document`;
    return this.mutate(status, async () => {
      const state = useWorkspace.getState();
      const color = rgbFromHex(state.inkColor);
      const bytes = await this.pdf!.saveDocument();
      const shaped = await addShapeAnnotation(bytes, {
        page,
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
  /** Applies one comment edit to the current revision with the current markup style. */
  private async addComment(
    status: string,
    edit: (
      bytes: Uint8Array,
      style: { color: [number, number, number]; width: number; opacity: number },
    ) => Promise<Uint8Array>,
  ) {
    if (!this.pdf) throw new Error("Open a PDF before adding a comment.");
    return this.mutate(status, async () => {
      const state = useWorkspace.getState();
      const bytes = await this.pdf!.saveDocument();
      const changed = await edit(bytes, {
        color: rgbFromHex(state.inkColor),
        width: state.inkWidth,
        opacity: state.inkOpacity,
      });
      await this.replaceWithBytes(changed, status, { preMutationBytes: bytes });
    });
  }
  addPolyShape(kind: "Polygon" | "PolyLine", vertices: [number, number][], page: number) {
    return this.addComment(
      kind === "Polygon" ? "Polygon added to document" : "Connected lines added to document",
      (bytes, style) => addPolyShape(bytes, { ...style, page, kind, vertices }),
    );
  }
  addCloud(start: [number, number], end: [number, number], page: number) {
    return this.addComment("Cloud added to document", (bytes, style) =>
      addCloud(bytes, { ...style, page, start, end }),
    );
  }
  addCallout(tip: [number, number], box: [number, number], text: string, page: number) {
    return this.addComment("Callout added to document", (bytes, style) =>
      addCallout(bytes, { ...style, page, tip, box, text }),
    );
  }
  async addTextEditProposal(
    kind: "insert" | "replace",
    selection: SelectedTextGeometry[],
    text: string,
  ) {
    if (!selection.length) throw new Error("Select text on the page first.");
    const [first] = selection;
    const hex = useWorkspace.getState().highlightColor;
    await this.addComment(
      kind === "insert" ? "Insertion proposed" : "Replacement proposed",
      (bytes, style) =>
        addTextEditProposal(bytes, {
          ...style,
          color: rgbFromHex(hex),
          page: first.page,
          kind,
          quads: first.quads,
          text,
          selected: first.text,
        }),
    );
    globalThis.getSelection()?.removeAllRanges();
  }
  addFileComment(
    file: { name: string; type: string; data: Uint8Array },
    description: string,
    page: number,
    at: [number, number],
  ) {
    return this.addComment("File attachment comment added", (bytes, style) =>
      addFileAttachmentComment(bytes, {
        ...style,
        color: undefined,
        page,
        at,
        fileName: file.name,
        mimeType: file.type,
        data: file.data,
        description,
      }),
    );
  }
  /** Saves a measurement drawn on `input.page` with the current markup color. */
  async addMeasurement(input: Omit<MeasurementInput, "color">) {
    if (!this.pdf) throw new Error("Open a PDF before measuring.");
    return this.mutate("Measurement added to document", async () => {
      const color = rgbFromHex(useWorkspace.getState().inkColor);
      const bytes = await this.pdf!.saveDocument();
      const result = await addMeasurement(bytes, { ...input, color });
      await this.replaceWithBytes(result.bytes, `Measured ${result.label}`, {
        preMutationBytes: bytes,
      });
      return result.label;
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
        Number.parseInt(hex.slice(1, 3), 16) / 255,
        Number.parseInt(hex.slice(3, 5), 16) / 255,
        Number.parseInt(hex.slice(5, 7), 16) / 255,
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
      for await (const updated of mapInOrder(pending, (comment) =>
        importCommentGeometry(bytes, comment),
      )) {
        if (!updated) continue;
        bytes = updated as Uint8Array<ArrayBuffer>;
        added++;
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
  /** The PDF user-space point under a window position on a displayed page. */
  pagePoint(pageNumber: number, clientX: number, clientY: number): [number, number] | null {
    const view = this.viewer.getPageView(pageNumber - 1) as
      | { div: HTMLElement; viewport: { convertToPdfPoint(x: number, y: number): number[] } }
      | undefined;
    if (!view) return null;
    const rect = view.div.getBoundingClientRect();
    const [x, y] = view.viewport.convertToPdfPoint(
      clientX - rect.left - view.div.clientLeft,
      clientY - rect.top - view.div.clientTop,
    );
    return [x, y];
  }
  /** Zooms so a PDF point on a page stays under the same window position. */
  private zoomAround(
    pageNumber: number,
    point: [number, number],
    scale: number,
    clientX: number,
    clientY: number,
  ) {
    this.zoom(scale);
    const view = this.viewer.getPageView(pageNumber - 1) as
      | { div: HTMLElement; viewport: { convertToViewportPoint(x: number, y: number): number[] } }
      | undefined;
    if (!view) return;
    const rect = view.div.getBoundingClientRect();
    const [x, y] = view.viewport.convertToViewportPoint(...point);
    this.container.scrollLeft += rect.left + view.div.clientLeft + x - clientX;
    this.container.scrollTop += rect.top + view.div.clientTop + y - clientY;
  }
  /**
   * Marquee zoom: fills the window with the area dragged between two window positions on a
   * page, or zooms in one step around a click (out with `zoomOut`).
   */
  zoomToArea(
    pageNumber: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    zoomOut = false,
  ) {
    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    const scale = this.viewer.currentScale;
    if (width < 4 && height < 4) {
      const point = this.pagePoint(pageNumber, to.x, to.y);
      if (point)
        this.zoomAround(pageNumber, point, zoomOut ? scale / 1.25 : scale * 1.25, to.x, to.y);
      return;
    }
    const centre = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const point = this.pagePoint(pageNumber, centre.x, centre.y);
    if (!point) return;
    const fill = Math.min(
      (this.container.clientWidth - 40) / Math.max(width, 1),
      (this.container.clientHeight - 40) / Math.max(height, 1),
    );
    const frame = this.container.getBoundingClientRect();
    this.zoomAround(
      pageNumber,
      point,
      scale * fill,
      frame.left + this.container.clientWidth / 2,
      frame.top + this.container.clientHeight / 2,
    );
  }
  /**
   * Fit Visible: the current page's inked area, found by a low-resolution render, spans the
   * window width. A blank page fits its full width.
   */
  async fitVisible() {
    const shown = this.viewer.pdfDocument;
    if (!shown) return;
    const pageNumber = this.viewer.currentPageNumber;
    const page = await shown.getPage(pageNumber);
    const rotation = (page.rotate + this.viewer.pagesRotation) % 360;
    const natural = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({
      scale: Math.min(1, 480 / Math.max(natural.width, natural.height)),
      rotation,
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    let bounds: ReturnType<typeof inkedBounds>;
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("The page could not be measured.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      bounds = inkedBounds(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      );
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (this.viewer.pdfDocument !== shown || this.viewer.currentPageNumber !== pageNumber) return;
    if (!bounds) {
      this.zoom("page-width");
      return;
    }
    const view = this.viewer.getPageView(pageNumber - 1) as { width: number } | undefined;
    if (!view) return;
    const unscaledWidth = view.width / this.viewer.currentScale;
    const fraction = (bounds.right - bounds.left) / Math.ceil(viewport.width);
    this.zoom((this.container.clientWidth - 40) / (unscaledWidth * fraction));
    // A few points of margin keep the first inked column off the window edge.
    const margin = 4 * viewport.scale;
    const [x, y] = viewport.convertToPdfPoint(bounds.left - margin, bounds.top - margin);
    this.viewer.scrollPageIntoView({
      pageNumber,
      destArray: [null, { name: "XYZ" }, x, y, null],
      allowNegativeOffset: true,
    });
    useWorkspace.getState().set({ status: "Fit visible content" });
  }
  /**
   * Erases freehand ink along a path of window positions on one page, `size` pixels across on
   * screen. The strokes are cut where the eraser passed, in one undoable step.
   */
  async eraseInk(pageNumber: number, points: { x: number; y: number }[], size: number) {
    const pdf = this.pdf;
    if (!pdf || !points.length) return 0;
    const view = this.viewer.getPageView(pageNumber - 1) as
      { viewport: { scale: number } } | undefined;
    const path = points.flatMap(({ x, y }) => {
      const point = this.pagePoint(pageNumber, x, y);
      return point ? [point] : [];
    });
    const radius = size / 2 / (view?.viewport.scale || 1);
    return this.mutate("Erasing ink", async () => {
      const bytes = await pdf.saveDocument();
      const result = await eraseInk(bytes, pageNumber, path, radius);
      if (!result.changed) {
        useWorkspace.getState().set({ status: "No ink to erase there" });
        return 0;
      }
      await this.replaceWithBytes(result.bytes, "Ink erased", { preMutationBytes: bytes });
      return result.changed;
    });
  }
  private applyHiddenFields(root: ParentNode) {
    for (const element of root.querySelectorAll<HTMLElement>("[data-annotation-id]"))
      element.hidden = this.hiddenFields.has(element.dataset.annotationId ?? "");
  }
  /**
   * Makes links with a show or hide field action, which PDF.js draws but does not run, work as
   * buttons. The document is read only for pages with such links.
   */
  private async bindHideActions(div: HTMLElement, annotations: unknown[]) {
    const pdf = this.viewer.pdfDocument;
    const unbound = (annotations as Record<string, unknown>[]).filter(
      (annotation) =>
        annotation.subtype === "Link" &&
        !["url", "unsafeUrl", "dest", "action", "setOCGState", "resetForm", "attachment"].some(
          (key) => annotation[key],
        ),
    );
    if (!pdf || !unbound.length) return;
    let actions = this.hideActions.get(pdf);
    if (!actions) {
      actions = pdf.getData().then((bytes) => readHideActions(bytes));
      this.hideActions.set(pdf, actions);
    }
    const byId = await actions;
    for (const annotation of unbound) {
      const id = String(annotation.id);
      const action = byId.get(id);
      const section = div.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(id)}"]`);
      if (!action || !section || section.dataset.navpdfAction) continue;
      section.dataset.navpdfAction = "hide";
      section.tabIndex = 0;
      section.setAttribute("role", "button");
      section.setAttribute(
        "aria-label",
        `${action.hide ? "Hide" : "Show"} ${action.fields.join(", ")}`,
      );
      const run = () => void this.runHideAction(pdf, action);
      section.addEventListener("click", run);
      section.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          run();
        }
      });
    }
  }
  private async runHideAction(pdf: PDFDocumentProxy, action: HideAction) {
    const objects = ((await pdf.getFieldObjects()) ?? {}) as Record<string, { id?: string }[]>;
    // A named field covers its widgets and the fields below it, as "name.child".
    const ids = Object.entries(objects)
      .filter(([name]) =>
        action.fields.some((field) => name === field || name.startsWith(`${field}.`)),
      )
      .flatMap(([, widgets]) => widgets.flatMap((widget) => (widget.id ? [widget.id] : [])));
    for (const id of ids) {
      if (action.hide) this.hiddenFields.add(id);
      else this.hiddenFields.delete(id);
    }
    this.applyHiddenFields(this.container);
  }
  /** The image under a window position on a displayed page as PNG, or null. */
  async imageAt(pageNumber: number, clientX: number, clientY: number) {
    const shown = this.viewer.pdfDocument;
    const point = this.pagePoint(pageNumber, clientX, clientY);
    if (!shown || !point) return null;
    return imagePngAt(await shown.getPage(pageNumber), ...point);
  }
  /**
   * Moves to the first page with a form field and focuses that field, so the form can be tried
   * out with Tab as a person filling it would.
   */
  async previewForm() {
    const pdf = this.pdf;
    if (!pdf) return;
    const hasField = async (page: number) => {
      const proxy = await pdf.getPage(page);
      const annotations = await proxy.getAnnotations();
      return { page, found: annotations.some((annotation) => annotation.subtype === "Widget") };
    };
    const pages = Array.from({ length: Math.min(pdf.numPages, 500) }, (_, index) => index + 1);
    for await (const { page, found } of mapInOrder(pages, hasField)) {
      if (pdf !== this.pdf) return;
      if (!found) continue;
      this.goTo(page);
      useWorkspace.getState().set({
        status: "Form preview: fill the fields and press Tab to move between them",
      });
      const focus = (attempt: number) => {
        const field = this.container.querySelector<HTMLElement>(
          `.page[data-page-number="${page}"] .annotationLayer :is(input, select, textarea, button)`,
        );
        if (field) field.focus();
        else if (attempt < 20) setTimeout(() => focus(attempt + 1), 100);
      };
      focus(0);
      return;
    }
    useWorkspace.getState().set({ status: "This PDF has no form fields to preview" });
  }
  goTo(page: number) {
    if (!this.pdf) return;
    const from = this.viewer.currentPageNumber;
    const target = Math.max(1, Math.min(this.pdf.numPages, page));
    this.viewer.currentPageNumber = target;
    if (target !== from) this.recordView(from);
  }
  /** Previous View: returns to the page shown before the latest jump. */
  goBack() {
    this.stepView(this.views.previous.bind(this.views));
  }
  /** Next View: repeats a jump undone by Previous View. */
  goForward() {
    this.stepView(this.views.next.bind(this.views));
  }
  private stepView(step: (current: number, pageCount: number) => number | null) {
    if (!this.pdf) return;
    const page = step(this.viewer.currentPageNumber, this.pdf.numPages);
    if (page !== null) this.viewer.currentPageNumber = page;
    this.updateViewControls();
  }
  private recordView(from: number) {
    this.views.record(from);
    this.updateViewControls();
  }
  private updateViewControls() {
    useWorkspace
      .getState()
      .set({ canGoBack: this.views.canGoBack, canGoForward: this.views.canGoForward });
  }
  /** Plain text of one page, for Read Out Loud. */
  async pageText(page: number): Promise<string> {
    if (!this.pdf || page < 1 || page > this.pdf.numPages) return "";
    const content = await (await this.pdf.getPage(page)).getTextContent();
    return content.items.map(searchTextItem).join(" ");
  }
  /** Reads the current page, or from the current page to the end of the document. */
  async readOutLoud(toEnd: boolean) {
    if (!this.pdf) return;
    const first = this.viewer.currentPageNumber;
    try {
      await this.readAloud.read(first, toEnd ? this.pdf.numPages : first);
    } catch (error) {
      useWorkspace
        .getState()
        .set({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  toggleReadAloudPause() {
    if (this.readAloud.current === "paused") this.readAloud.resume();
    else this.readAloud.pause();
  }
  /** Shows or hides one optional content group; this changes the view only, not the PDF. */
  async setLayerVisibility(id: string, visible: boolean) {
    const config = await this.viewer.optionalContentConfigPromise;
    if (!config) return;
    config.setVisibility(id, visible);
    this.viewer.optionalContentConfigPromise = Promise.resolve(config);
    await this.refreshLayers(this.generation);
  }
  private async refreshLayers(generation: number) {
    let layers: Array<{ id: string; name: string; visible: boolean }> = [];
    try {
      const config = await this.viewer.optionalContentConfigPromise;
      if (config) {
        const groups = new Map<string, { name: string | null; visible: boolean }>(config);
        const order = orderedLayerIds(config.getOrder() as OptionalContentOrder | null);
        const ids = order.length > 0 ? order : [...groups.keys()];
        layers = [...new Set(ids)].flatMap((id) => {
          const group = groups.get(id);
          if (!group) return [];
          // Groups with a missing or blank name still need a visible label.
          const name = group.name?.trim() ? group.name : "Unnamed layer";
          return [{ id, name, visible: group.visible }];
        });
      }
    } catch {
      // Malformed optional content leaves every layer at its default visibility.
    }
    if (generation === this.generation) useWorkspace.getState().set({ layers });
  }
  search(again = false, backward = false) {
    const s = useWorkspace.getState();
    this.searchClosed = false;
    this.searchGeneration++;
    this.activeSearchKey = searchCriteriaKey(s.searchQuery, s.matchCase, s.wholeWord);
    if (!again)
      s.set({ searchPending: !!s.searchQuery, results: [], searchCount: 0, searchResultsKey: "" });
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
    this.searchClosed = true;
    this.searchGeneration++;
    this.activeSearchKey = "";
    clearTimeout(this.searchTimer);
    useWorkspace.getState().set({
      results: [],
      searchResultsKey: "",
      searchPending: false,
      searchCount: 0,
    });
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
    // PDF.js keeps previous pageMatches during its debounce. Never label those with new criteria.
    if (!this.pdf || this.findPending || this.searchClosed) return;
    const generation = this.generation,
      search = this.searchGeneration;
    const pdf = this.pdf;
    const matches = this.find.pageMatches as number[][] | undefined,
      lengths = this.find.pageMatchesLength as number[][] | undefined;
    const searchResultsKey = this.activeSearchKey;
    const results: SearchResult[] = [];
    for (let p = 0; p < (matches?.length ?? 0) && results.length < 250; p++) {
      const pageMatches = matches?.[p];
      if (!pageMatches?.length) continue;
      const pageResults = await this.buildPageResults(
        pdf,
        p,
        pageMatches,
        lengths?.[p],
        generation,
        search,
      );
      if (!pageResults) return;
      results.push(...pageResults.slice(0, 250 - results.length));
    }
    if (generation === this.generation && search === this.searchGeneration && !this.findPending)
      useWorkspace.getState().set({ results, searchResultsKey });
  }

  private async buildPageResults(
    pdf: PDFDocumentProxy,
    pageIndex: number,
    pageMatches: number[],
    matchLengths: number[] | undefined,
    generation: number,
    searchGeneration: number,
  ): Promise<SearchResult[] | null> {
    let text = this.contexts.get(pageIndex);
    if (text === undefined) {
      const page = await pdf.getPage(pageIndex + 1);
      const content = await page.getTextContent({ disableNormalization: true });
      text = content.items.map(searchTextItem).join("");
      this.contexts.set(pageIndex, text);
      if (this.contexts.size > 40) this.contexts.delete(this.contexts.keys().next().value!);
    }
    if (generation !== this.generation || searchGeneration !== this.searchGeneration) return null;
    return pageMatches.map((start, index) => {
      const length = matchLengths?.[index] ?? 0;
      return {
        page: pageIndex + 1,
        index,
        context: snippet(text, start, length),
        match: text.slice(start, start + length),
      };
    });
  }
  async readComments() {
    if (!this.pdf) return;
    const generation = this.generation;
    const pdf = this.pdf;
    const comments: Comment[] = [];
    let pdfLibDoc: PDFDocument | null = null;
    try {
      const bytes = await pdf.saveDocument();
      pdfLibDoc = await PDFDocument.load(bytes);
    } catch {
      // Fallback to PDF.js data only in mock environments
    }

    const readCommentsOnPage = async (p: number) => {
      const pageComments = await readPageComments(
        pdf,
        pdfLibDoc,
        p,
        generation,
        () => this.generation,
      );
      if (pageComments && p % 20 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return pageComments;
    };
    for await (const pageComments of mapInOrder(allPageNumbers(pdf.numPages), readCommentsOnPage)) {
      if (!pageComments) return;
      comments.push(...pageComments);
    }
    if (generation !== this.generation) return;
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

function annotationEditorTypeForTool(tool: Tool): number {
  switch (tool) {
    case "highlight":
      return AnnotationEditorType.HIGHLIGHT;
    case "ink":
    case "draw":
      return AnnotationEditorType.INK;
    case "text":
      return AnnotationEditorType.FREETEXT;
    default:
      return AnnotationEditorType.NONE;
  }
}

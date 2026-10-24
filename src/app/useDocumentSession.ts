import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkspace } from "../stores/workspace";
import * as desktop from "../services/native";
import { loadPdf } from "../services/pdf";
import type { DocumentDescriptor } from "../types/document";
import { useNativeOpenRequests } from "./useNativeOpenRequests";
import { mapInOrder } from "../utils/async-sequence";
import type { ParkedDocument, ViewerController } from "../features/viewer/controller";
import type { DocumentState } from "../stores/workspace";
import { documentState, neighborTab, placeTab, stepTab } from "./document-tabs";
/** A document open in a tab other than the shown one. */
interface BackgroundTab {
  task: PDFDocumentLoadingTask | null;
  parked: ParkedDocument;
  state: DocumentState;
}
type PasswordPrompt = {
  name: string;
  reason: number;
  submit: (password: string) => void;
};

interface CommitLoadedCandidateOptions {
  controller: ViewerController;
  candidate: PDFDocumentLoadingTask;
  descriptor: DocumentDescriptor;
  initialPage: number;
  recovering: boolean;
  previous: DocumentDescriptor | null;
  previousTask: PDFDocumentLoadingTask | null;
  commitTask: () => void;
  setPassword: (value: PasswordPrompt | null) => void;
  refreshLocal: () => Promise<void>;
  report: (error: unknown) => void;
}

interface LoadFailureOptions {
  candidate: PDFDocumentLoadingTask | null;
  activeTask: PDFDocumentLoadingTask | null;
  descriptor: DocumentDescriptor;
  controller: ViewerController;
  previousPdf: NonNullable<ViewerController["pdf"]> | null;
  previousState: ReturnType<typeof useWorkspace.getState>;
  openingCancelled: boolean;
  failedDuringLoad: boolean;
  error: unknown;
  setPassword: (value: PasswordPrompt | null) => void;
  report: (error: unknown) => void;
}

async function restoreAfterLoadFailure(options: LoadFailureOptions): Promise<void> {
  const {
    candidate,
    activeTask,
    descriptor,
    controller,
    previousPdf,
    previousState,
    openingCancelled,
    failedDuringLoad,
    error,
    setPassword,
    report,
  } = options;
  // A document that never became the shown one is released, including when PDF.js could not
  // start loading it, unless it is the shown document itself.
  const committed = candidate !== null && candidate === activeTask;
  if (!committed && descriptor.id !== previousState.document?.id) {
    await candidate?.destroy().catch(report);
    await desktop.releaseDocument(descriptor.id).catch(report);
  }
  if (previousPdf && controller.pdf !== previousPdf) {
    try {
      await controller.attach(previousPdf);
    } catch {
      // Ignore rollback failure and preserve the original load error.
    }
  }
  useWorkspace.getState().set(previousState);
  if (previousPdf) controller.goTo(previousState.page);
  setPassword(null);
  if (!openingCancelled && !failedDuringLoad) report(error);
  useWorkspace.getState().set({
    status: openingCancelled ? "Opening cancelled" : "Unable to open PDF",
  });
}

async function commitLoadedCandidate(options: CommitLoadedCandidateOptions): Promise<void> {
  const {
    controller,
    candidate,
    descriptor,
    initialPage,
    recovering,
    previous,
    previousTask,
    commitTask,
    setPassword,
    refreshLocal,
    report,
  } = options;
  const loaded = await candidate.promise;
  setPassword(null);
  const metadata = await loaded.getMetadata();
  const info = metadata.info as {
    Title?: string;
    Author?: string;
    PDFFormatVersion?: string;
    EncryptFilterName?: string;
  };
  const encrypted = !!info.EncryptFilterName;
  await controller.attach(loaded);
  await controller.viewer.firstPagePromise;
  if (encrypted) {
    controller.clearRevisionHistory?.();
  } else {
    try {
      controller.seedRevision?.(
        await loaded.saveDocument(),
        loaded.numPages,
        "Opened PDF",
        descriptor.revisionId,
      );
    } catch {
      controller.clearRevisionHistory?.();
    }
  }
  if (recovering || descriptor.unsaved) controller.markUnsavedRevision?.();

  const {
    bookmarks,
    comments,
    formNotice,
    hasDigitalSignature,
    pageLabels,
    editingAllowed,
    layers,
    canGoBack,
    canGoForward,
  } = useWorkspace.getState();
  commitTask();
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    document: descriptor,
    toolMode: "all",
    navigationVisible: false,
    propertiesVisible: false,
    bookmarks,
    comments,
    formNotice,
    hasDigitalSignature,
    pageLabels,
    editingAllowed,
    layers,
    canGoBack,
    canGoForward,
    dirty: recovering || !!descriptor.unsaved,
    info: {
      pages: loaded.numPages,
      encrypted,
      title: info.Title || "",
      author: info.Author || "",
      version: info.PDFFormatVersion || "",
    },
    status: "Ready",
    busy: false,
  });
  controller.goTo(initialPage);
  await desktop.markDirty(recovering || !!descriptor.unsaved).catch(report);
  await refreshLocal().catch(report);
  if (previous && previous.id !== descriptor.id) {
    await desktop.discardRecovery(previous.id).catch(report);
    await desktop.releaseDocument(previous.id).catch(report);
  }
  await controller.releaseRevision().catch(report);
  if (previousTask && previousTask !== candidate) await previousTask.destroy().catch(report);
}

export function useDocumentSession(controller: ViewerController | null) {
  const [password, setPassword] = useState<PasswordPrompt | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const confirmationPending = useRef(false);
  const confirmationCancelled = useRef<(() => void) | null>(null);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const [revertPending, setRevertPending] = useState(false);
  /** A document whose file changed on disk while it had unsaved edits. */
  const [externalChange, setExternalChange] = useState<string | null>(null);
  /** Documents already reported as changed or missing, so each is reported once. */
  const reportedSources = useRef(new Set<string>());
  const sessionRestored = useRef(false);
  const background = useRef(new Map<string, BackgroundTab>());
  /** Names of background tabs with unsaved changes, shown when closing the window. */
  const [unsavedTabs, setUnsavedTabs] = useState<string[] | null>(null);
  const task = useRef<PDFDocumentLoadingTask | null>(null),
    loading = useRef<PDFDocumentLoadingTask | null>(null),
    lock = useRef(false),
    pendingOpen = useRef(false),
    openingCancelled = useRef(false),
    autosave = useRef<Promise<void> | null>(null);
  // Save, open, close and home wait for an in-flight recovery write instead of being dropped,
  // and a closed document's recovery copy is never rewritten after it was discarded.
  const afterAutosave = useCallback(function waitForAutosave(): Promise<void> {
    const pending = autosave.current;
    return pending ? pending.then(waitForAutosave) : Promise.resolve();
  }, []);
  const report = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    useWorkspace.getState().set({
      error: /InvalidPDF|Invalid PDF|Invalid XRef|PDF header/i.test(message)
        ? "This PDF appears to be damaged. The current document is unchanged."
        : message,
    });
  }, []);
  useEffect(() => {
    void desktop
      .localState()
      .then((local) => {
        useWorkspace.getState().set({
          local,
          layout: local.preferences.layout,
          highlightColor: local.preferences.annotationColor,
          inkColor: local.preferences.annotationColor,
          inkWidth: local.preferences.annotationStrokeWidth,
        });
        setPreferencesReady(true);
      })
      .catch(report);
  }, [report]);
  useEffect(() => {
    if (!controller || controller.pdf || !task.current) return;
    let active = true;
    // Opening another document resets the render boundary and mounts a fresh
    // viewer. Reattach the successfully committed session task to that view.
    void task.current.promise
      .then(async (pdf) => {
        if (active && !controller.pdf) await controller.attach(pdf);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [controller, report]);
  const refreshLocal = useCallback(async () => {
    useWorkspace.getState().set({ local: await desktop.localState() });
  }, []);
  const load = useCallback(
    async (descriptor: DocumentDescriptor, initialPage = 1, recovering = false) => {
      if (!controller) return false;
      await afterAutosave();
      if (lock.current) {
        await desktop.releaseDocument(descriptor.id);
        useWorkspace.getState().set({
          error: "Open is already in progress.",
          status: "Open is already in progress.",
        });
        return false;
      }
      const previousState = useWorkspace.getState();
      const previousId = previousState.document?.id ?? null;
      lock.current = true;
      openingCancelled.current = false;
      useWorkspace.getState().set({ busy: true, error: "", status: "Opening PDF..." });
      let candidate: PDFDocumentLoadingTask | null = null;
      let failedDuringLoad = false;
      const previousPdf = controller.pdf;
      try {
        candidate = await loadPdf(
          descriptor,
          (submit, reason) => setPassword({ name: descriptor.name, reason, submit }),
          (error) => {
            failedDuringLoad = true;
            report(error);
            void loading.current?.destroy();
          },
        );
        loading.current = candidate;
        candidate.onProgress = ({ percent }: { percent: number }) => {
          if (loading.current === candidate && Number.isFinite(percent))
            useWorkspace.getState().set({ status: `Opening PDF... ${percent}%` });
        };
        const previous = useWorkspace.getState().document;
        const previousTask = task.current;
        await commitLoadedCandidate({
          controller,
          candidate,
          descriptor,
          initialPage,
          recovering,
          previous,
          previousTask,
          commitTask: () => {
            task.current = candidate;
          },
          setPassword,
          refreshLocal,
          report,
        });
        // Loading resets the workspace; the tabs open before it are kept.
        const shown = useWorkspace.getState();
        shown.set({ tabs: placeTab(previousState.tabs, previousId, descriptor, shown.dirty) });
        return true;
      } catch (error) {
        await restoreAfterLoadFailure({
          candidate,
          activeTask: task.current,
          descriptor,
          controller,
          previousPdf,
          previousState,
          openingCancelled: openingCancelled.current,
          failedDuringLoad,
          error,
          setPassword,
          report,
        });
        return false;
      } finally {
        loading.current = null;
        lock.current = false;
        useWorkspace.getState().set({ busy: false });
      }
    },
    [afterAutosave, controller, refreshLocal, report],
  );
  const save = useCallback(
    async (saveAs = false, unprotected = false) => {
      await afterAutosave();
      const state = useWorkspace.getState();
      const pdf = controller?.pdf ?? null;
      if (!controller || !pdf || !state.document || lock.current) return false;
      if (state.info?.encrypted) {
        report(
          "This password-protected PDF opens read-only. Unlock it from Password Protect before editing or saving. Your original is unchanged.",
        );
        return false;
      }
      if (state.info?.protectedSource && !unprotected) {
        // An unlocked working copy is never written back without an explicit protection choice.
        state.set({
          activeModal: "protect",
          status: "Choose how to save this password-protected document.",
        });
        return false;
      }
      lock.current = true;
      state.set({
        busy: true,
        error: "",
        status: "Validating and saving PDF...",
      });
      let dirtyBeforeSave = state.dirty;
      try {
        controller.editor?.commitOrRemove();
        // Committing a pending editor can itself mark the document dirty.
        dirtyBeforeSave = useWorkspace.getState().dirty;
        const bytes = await pdf.saveDocument();
        const result = await desktop.saveDocument(state.document, bytes, pdf.numPages, saveAs);
        if (!result) {
          state.set({ status: "Save cancelled" });
          return false;
        }
        state.set({
          dirty: false,
          status: "PDF saved",
          document: {
            ...state.document,
            unsaved: false,
            name: result.name,
            size: result.size,
          },
          ...(unprotected && state.info ? { info: { ...state.info, protectedSource: false } } : {}),
        });
        controller.markSaved?.(bytes, pdf.numPages);
        await desktop.markDirty(false);
        await refreshLocal();
        return true;
      } catch (error) {
        report(error);
        state.set({
          dirty: dirtyBeforeSave,
          status: dirtyBeforeSave
            ? "Save failed; changes are still in this workspace"
            : "Save failed. The document is unchanged.",
        });
        void desktop.markDirty(dirtyBeforeSave).catch(report);
        return false;
      } finally {
        lock.current = false;
        useWorkspace.getState().set({ busy: false });
      }
    },
    [afterAutosave, controller, report, refreshLocal],
  );
  const guard = useCallback((action: () => void) => {
    if (useWorkspace.getState().busy || lock.current || confirmationPending.current) return;
    if (useWorkspace.getState().dirty) {
      confirmationPending.current = true;
      setConfirm(() => action);
    } else action();
  }, []);
  const syncBackgroundDirty = useCallback(() => {
    desktop.setBackgroundDirty([...background.current.values()].some((tab) => tab.state.dirty));
  }, []);
  /** Keeps a recovery copy of a document with unsaved changes as it moves to the background. */
  const keepRecovery = useCallback(async (state: DocumentState, parked: ParkedDocument) => {
    const { document: descriptor, dirty, info } = state;
    if (
      !descriptor ||
      !dirty ||
      info?.encrypted ||
      info?.protectedSource ||
      !useWorkspace.getState().local.preferences.autosave
    )
      return;
    const bytes = await parked.pdf.saveDocument();
    await desktop.writeRecovery(descriptor, bytes, parked.pdf.numPages);
  }, []);
  /**
   * Moves the shown document to a background tab. The workspace is emptied for a new document,
   * or kept, so the viewer stays visible, when another tab is shown next.
   */
  const parkShown = useCallback(
    async (empty = true) => {
      if (!controller) return false;
      await afterAutosave();
      const descriptor = useWorkspace.getState().document;
      if (!descriptor) return true;
      const parked = await controller.park();
      if (!parked) return false;
      const state = documentState(useWorkspace.getState());
      background.current.set(descriptor.id, { task: task.current, parked, state });
      task.current = null;
      const current = useWorkspace.getState();
      current.set({ tabs: placeTab(current.tabs, descriptor.id, descriptor, state.dirty) });
      syncBackgroundDirty();
      await keepRecovery(state, parked).catch(() => {
        // The tab keeps its changes in memory; the next autosave retries once it is shown.
      });
      if (empty) {
        const { tabs } = useWorkspace.getState();
        useWorkspace.getState().reset();
        useWorkspace.getState().set({ tabs });
      }
      return true;
    },
    [afterAutosave, controller, keepRecovery, syncBackgroundDirty],
  );
  /** Shows a background tab's document again with its own state. */
  const showBackground = useCallback(
    async (id: string) => {
      const tab = background.current.get(id);
      if (!tab || !controller) return false;
      background.current.delete(id);
      syncBackgroundDirty();
      task.current = tab.task;
      useWorkspace.getState().set({ ...tab.state, busy: false, status: "Ready" });
      await controller.resume(tab.parked);
      // Restores what attaching the document recomputed, such as layer visibility.
      useWorkspace.getState().set({ ...tab.state, busy: false, status: "Ready" });
      await desktop.markDirty(tab.state.dirty).catch(report);
      return true;
    },
    [controller, report, syncBackgroundDirty],
  );
  const switchTab = useCallback(
    async (id: string) => {
      const state = useWorkspace.getState();
      if (state.document?.id === id || state.busy || lock.current) return;
      if (!background.current.has(id)) return;
      lock.current = true;
      try {
        if (await parkShown(false)) await showBackground(id);
      } catch (error) {
        report(error);
      } finally {
        lock.current = false;
      }
    },
    [parkShown, report, showBackground],
  );
  const stepTabs = useCallback(
    (step: number) => {
      const state = useWorkspace.getState();
      const next = state.document ? stepTab(state.tabs, state.document.id, step) : null;
      if (next) void switchTab(next);
    },
    [switchTab],
  );
  /**
   * Opens a document in a new tab, keeping the shown one open in the background. When the new
   * document cannot be opened, the previous one is shown again.
   */
  const openInTab = useCallback(
    async (descriptor: DocumentDescriptor, initialPage = 1, recovering = false) => {
      const shown = useWorkspace.getState().document;
      if (!shown) return load(descriptor, initialPage, recovering);
      if (lock.current || !controller) {
        await desktop.releaseDocument(descriptor.id).catch(report);
        useWorkspace.getState().set({ error: "Open is already in progress." });
        return false;
      }
      lock.current = true;
      let parked: boolean;
      try {
        parked = await parkShown();
      } finally {
        lock.current = false;
      }
      if (!parked) {
        await desktop.releaseDocument(descriptor.id).catch(report);
        return false;
      }
      const opened = await load(descriptor, initialPage, recovering);
      if (!opened) await showBackground(shown.id).catch(report);
      return opened;
    },
    [controller, load, parkShown, report, showBackground],
  );
  /** Closes a background tab, or shows it first when it has unsaved changes so Close can ask. */
  const closeBackground = useCallback(
    async (id: string) => {
      const tab = background.current.get(id);
      if (!tab) return false;
      if (tab.state.dirty) {
        await switchTab(id);
        return false;
      }
      background.current.delete(id);
      syncBackgroundDirty();
      const state = useWorkspace.getState();
      state.set({ tabs: state.tabs.filter((entry) => entry.id !== id) });
      await tab.parked.revisionTask?.destroy().catch(() => {});
      await tab.task?.destroy().catch(() => {});
      await desktop.releaseDocument(id).catch(report);
      await desktop.discardRecovery(id).catch(report);
      return true;
    },
    [report, switchTab, syncBackgroundDirty],
  );
  const open = useCallback(
    (file?: File) => {
      if (useWorkspace.getState().busy || lock.current || confirmationPending.current) return;
      {
        if (pendingOpen.current) {
          useWorkspace.getState().set({
            error: "Open is already in progress.",
            status: "Open is already in progress.",
          });
          return;
        }
        pendingOpen.current = true;
        void desktop
          .openDocument(file)
          .then((descriptor) => {
            if (descriptor) return openInTab(descriptor);
          })
          .catch(report)
          .finally(() => {
            pendingOpen.current = false;
          });
      }
    },
    [openInTab, report],
  );
  const canOpenToken = useCallback(() => {
    const state = useWorkspace.getState();
    return (
      !state.busy &&
      !state.settingsOpen &&
      !state.activeModal &&
      !lock.current &&
      !pendingOpen.current &&
      !confirmationPending.current
    );
  }, []);
  const openToken = useCallback(
    (token: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const finish = () => {
          confirmationCancelled.current = null;
          void invoke("dismiss_open_request", { token }).then(() => {
            resolve();
          }, reject);
        };
        pendingOpen.current = true;
        void desktop
          .openDocumentFromToken(token)
          .then((descriptor) => openInTab(descriptor))
          .catch(report)
          .finally(() => {
            pendingOpen.current = false;
            finish();
          });
      }),
    [openInTab, report],
  );
  useNativeOpenRequests(!!controller && preferencesReady, canOpenToken, openToken, report);
  const recent = useCallback(
    (id: string, page: number) => {
      if (useWorkspace.getState().busy || lock.current || confirmationPending.current) return;
      void desktop
        .openRecent(id)
        .then((descriptor) =>
          openInTab(descriptor, useWorkspace.getState().local.preferences.rememberPage ? page : 1),
        )
        .catch(report);
    },
    [openInTab, report],
  );
  const home = useCallback(
    () =>
      guard(() => {
        void (async () => {
          await afterAutosave();
          const doc = useWorkspace.getState().document;
          const next = doc ? neighborTab(useWorkspace.getState().tabs, doc.id) : null;
          await controller?.detach();
          await task.current?.destroy().catch(() => {});
          task.current = null;
          if (doc) await desktop.releaseDocument(doc.id);
          const tabs = useWorkspace.getState().tabs.filter((tab) => tab.id !== doc?.id);
          useWorkspace.getState().reset();
          useWorkspace.getState().set({ tabs });
          await desktop.markDirty(false);
          if (doc) await desktop.discardRecovery(doc.id);
          // Closing a tab shows its neighbour; closing the last one shows Home.
          if (next) await showBackground(next);
          await refreshLocal();
        })().catch(report);
      }),
    [afterAutosave, controller, guard, report, refreshLocal, showBackground],
  );
  const recover = useCallback(
    (id: string) =>
      guard(() => {
        void desktop
          .openRecovery(id)
          .then((descriptor) => openInTab(descriptor, 1, true))
          .then((opened) => {
            if (!opened) return;
            useWorkspace.getState().set({
              dirty: true,
              status: "Recovery opened. Use Save As to keep this copy.",
            });
            controller?.markUnsavedRevision?.();
            void desktop.markDirty(true);
          })
          .catch(report);
      }),
    [controller, guard, openInTab, report],
  );
  useEffect(() => {
    if (!desktop.native) return;
    const interval = setInterval(() => {
      const state = useWorkspace.getState();
      if (
        !state.dirty ||
        !state.local.preferences.autosave ||
        state.info?.encrypted ||
        state.info?.protectedSource ||
        !state.document ||
        state.busy ||
        !controller?.pdf ||
        lock.current ||
        autosave.current
      )
        return;
      const descriptor = state.document;
      const active = controller.pdf;
      // Autosave never sets busy, so typing and open dialogs keep focus while it runs.
      const previousStatus = state.status;
      const autosaveStatus = "Saving recovery copy...";
      state.set({ status: autosaveStatus });
      autosave.current = active
        .saveDocument()
        .then((bytes) => desktop.writeRecovery(descriptor, bytes, active.numPages))
        .catch((err) => {
          console.warn("Autosave recovery write failed:", err);
        })
        .finally(() => {
          autosave.current = null;
          if (useWorkspace.getState().status === autosaveStatus)
            useWorkspace.getState().set({ status: previousStatus });
        });
    }, 10000);
    return () => clearInterval(interval);
  }, [controller]);
  /** Replaces the open document with its saved file, keeping the current page. */
  const reloadFromDisk = useCallback(
    async (status: string) => {
      const state = useWorkspace.getState();
      const descriptor = state.document;
      if (!descriptor) return false;
      const page = state.page;
      const reopened = await desktop.reopenDocument(descriptor.id);
      // Loading starts a fresh undo history, so earlier edits cannot be restored by Undo.
      const loaded = await load(reopened, page);
      if (loaded) useWorkspace.getState().set({ status });
      return loaded;
    },
    [load],
  );
  /** Revert asks first: it discards unsaved edits and undo history. */
  const revert = useCallback(() => {
    const state = useWorkspace.getState();
    if (!state.document || state.busy || lock.current) return;
    setRevertPending(true);
  }, []);
  const cancelRevert = useCallback(() => setRevertPending(false), []);
  const confirmRevert = useCallback(async () => {
    setRevertPending(false);
    await reloadFromDisk("Reverted to the last saved version").catch(report);
  }, [reloadFromDisk, report]);
  const reloadExternalChange = useCallback(async () => {
    setExternalChange(null);
    await reloadFromDisk("Reloaded the version on disk").catch(report);
  }, [reloadFromDisk, report]);
  const keepExternalChange = useCallback(() => {
    setExternalChange(null);
    useWorkspace.getState().set({
      status: "Kept your version. Saving will ask before replacing the changed file.",
    });
  }, []);
  // Watches the open document's file for changes made by other applications.
  useEffect(() => {
    if (!desktop.native || !controller) return;
    const interval = setInterval(() => {
      const state = useWorkspace.getState();
      const descriptor = state.document;
      if (
        !descriptor ||
        !state.local.preferences.reloadChangedFiles ||
        state.busy ||
        lock.current ||
        reportedSources.current.has(descriptor.id)
      )
        return;
      void desktop
        .sourceStatus(descriptor.id)
        .then((source) => {
          const current = useWorkspace.getState();
          if (current.document?.id !== descriptor.id || reportedSources.current.has(descriptor.id))
            return;
          if (source.missing) {
            reportedSources.current.add(descriptor.id);
            current.set({
              error: `${descriptor.name} was moved or deleted. Use Save As to keep this document.`,
            });
          } else if (source.changed) {
            reportedSources.current.add(descriptor.id);
            if (current.dirty || current.activeModal || current.settingsOpen)
              setExternalChange(descriptor.name);
            else
              void reloadFromDisk(`Reloaded ${descriptor.name} because it changed on disk`).catch(
                report,
              );
          }
        })
        .catch(() => {
          // A failed check is retried at the next interval.
        });
    }, 2000);
    return () => clearInterval(interval);
  }, [controller, reloadFromDisk, report]);
  // Reopens the last session's documents once, after preferences and the viewer are ready.
  useEffect(() => {
    if (!desktop.native || !controller || !preferencesReady || sessionRestored.current) return;
    sessionRestored.current = true;
    if (!useWorkspace.getState().local.preferences.reopenSession) return;
    void desktop
      .reopenSession()
      .then(async ({ documents, skipped }) => {
        // Each document opens in its own tab, one at a time, then the first is shown.
        const opened: string[] = [];
        for await (const id of mapInOrder(documents, async ({ descriptor, page }) =>
          (await openInTab(descriptor, page)) ? descriptor.id : null,
        ))
          if (id) opened.push(id);
        if (opened.length > 1) await switchTab(opened[0]);
        if (skipped)
          useWorkspace.getState().set({
            status: `${skipped} document(s) from the last session could not be reopened`,
          });
      })
      .catch(report);
  }, [controller, openInTab, preferencesReady, report, switchTab]);
  const closeWindow = useCallback(async () => {
    await afterAutosave();
    const shown = useWorkspace.getState().document?.id;
    const ids = [...(shown ? [shown] : []), ...background.current.keys()];
    // Closing proceeds even when a recovery copy cannot be removed.
    await Promise.all(ids.map((id) => desktop.discardRecovery(id).catch(() => {})));
    await invoke("close_window").catch(report);
  }, [afterAutosave, report]);
  /** Closing the window first asks about background tabs with unsaved changes. */
  const requestClose = useCallback(() => {
    if (useWorkspace.getState().busy) return;
    const unsaved = [...background.current.values()]
      .filter((tab) => tab.state.dirty)
      .map((tab) => tab.state.document?.name ?? "Document");
    if (unsaved.length) setUnsavedTabs(unsaved);
    else guard(() => void closeWindow());
  }, [closeWindow, guard]);
  const cancelClose = useCallback(() => setUnsavedTabs(null), []);
  const reviewUnsaved = useCallback(() => {
    setUnsavedTabs(null);
    const first = [...background.current.entries()].find(([, tab]) => tab.state.dirty)?.[0];
    if (first) void switchTab(first);
  }, [switchTab]);
  const discardUnsavedAndClose = useCallback(() => {
    setUnsavedTabs(null);
    guard(() => void closeWindow());
  }, [closeWindow, guard]);
  useEffect(() => {
    if (!desktop.native) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("close-requested", requestClose).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [requestClose]);
  const cancelPassword = useCallback(() => {
    openingCancelled.current = true;
    setPassword(null);
    void loading.current?.destroy();
  }, []);
  const cancelConfirm = useCallback(() => {
    setConfirm(null);
    confirmationPending.current = false;
    confirmationCancelled.current?.();
    confirmationCancelled.current = null;
  }, []);
  const discardAndContinue = useCallback(() => {
    const action = confirm;
    setConfirm(null);
    confirmationPending.current = false;
    action?.();
  }, [confirm]);
  const saveAndContinue = useCallback(async () => {
    const action = confirm;
    setConfirm(null);
    // Keep incoming requests waiting while the save decision completes.
    if (await save()) action?.();
    else confirmationCancelled.current?.();
    confirmationPending.current = false;
  }, [confirm, save]);

  return useMemo(
    () => ({
      open,
      recent,
      save,
      home,
      recover,
      load,
      report,
      refreshLocal,
      preferencesReady,
      password,
      cancelPassword,
      confirm,
      cancelConfirm,
      discardAndContinue,
      saveAndContinue,
      revert,
      revertPending,
      cancelRevert,
      confirmRevert,
      externalChange,
      reloadExternalChange,
      keepExternalChange,
      switchTab,
      stepTabs,
      closeBackground,
      unsavedTabs,
      cancelClose,
      reviewUnsaved,
      discardUnsavedAndClose,
    }),
    [
      switchTab,
      stepTabs,
      closeBackground,
      unsavedTabs,
      cancelClose,
      reviewUnsaved,
      discardUnsavedAndClose,
      revert,
      revertPending,
      cancelRevert,
      confirmRevert,
      externalChange,
      reloadExternalChange,
      keepExternalChange,
      open,
      recent,
      save,
      home,
      recover,
      load,
      report,
      refreshLocal,
      preferencesReady,
      password,
      cancelPassword,
      confirm,
      cancelConfirm,
      discardAndContinue,
      saveAndContinue,
    ],
  );
}

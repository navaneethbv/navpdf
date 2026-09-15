import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkspace } from "../stores/workspace";
import * as desktop from "../services/native";
import { loadPdf } from "../services/pdf";
import type { DocumentDescriptor } from "../types/document";
import type { ViewerController } from "../features/viewer/controller";
export function useDocumentSession(controller: ViewerController | null) {
  const [password, setPassword] = useState<{
    name: string;
    reason: number;
    submit: (password: string) => void;
  } | null>(null);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const task = useRef<PDFDocumentLoadingTask | null>(null),
    loading = useRef<PDFDocumentLoadingTask | null>(null),
    lock = useRef(false),
    pendingOpen = useRef(false),
    openingCancelled = useRef(false);
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
      .then((local) =>
        useWorkspace.getState().set({
          local,
          layout: local.preferences.layout,
          highlightColor: local.preferences.annotationColor,
          inkColor: local.preferences.annotationColor,
          inkWidth: local.preferences.annotationStrokeWidth,
        }),
      )
      .catch(report);
  }, [report]);
  const refreshLocal = useCallback(async () => {
    useWorkspace.getState().set({ local: await desktop.localState() });
  }, []);
  const load = useCallback(
    async (descriptor: DocumentDescriptor, initialPage = 1, recovering = false) => {
      if (!controller) return false;
      if (lock.current) {
        await desktop.releaseDocument(descriptor.id);
        useWorkspace.getState().set({
          error: "Open is already in progress.",
          status: "Open is already in progress.",
        });
        return false;
      }
      const previousState = useWorkspace.getState();
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
        const previous = useWorkspace.getState().document;
        const previousTask = task.current;

        // Stage and validate candidate attachment BEFORE destroying previous document
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

        // Commit before retiring any previous resource. Cleanup errors cannot
        // roll back to a proxy that has already been destroyed.
        // attach() read these from the candidate; reset() must not discard them.
        const { bookmarks, comments, formNotice, hasDigitalSignature } = useWorkspace.getState();
        task.current = candidate;
        useWorkspace.getState().reset();
        useWorkspace.getState().set({
          document: descriptor,
          bookmarks,
          comments,
          formNotice,
          hasDigitalSignature,
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
          // The dirty guard already saved or discarded the previous document's changes.
          await desktop.discardRecovery(previous.id).catch(report);
          await desktop.releaseDocument(previous.id).catch(report);
        }
        await controller.releaseRevision().catch(report);
        if (previousTask && previousTask !== candidate) {
          await previousTask.destroy().catch(report);
        }
        return true;
      } catch (error) {
        if (candidate !== task.current) {
          await candidate?.destroy().catch(report);
          await desktop.releaseDocument(descriptor.id).catch(report);
        }
        // Rollback viewer to previous PDF if available
        if (previousPdf && controller.pdf !== previousPdf) {
          try {
            await controller.attach(previousPdf);
          } catch {
            // ignore rollback failure
          }
        }
        useWorkspace.getState().set(previousState);
        if (previousPdf) controller.goTo(previousState.page);
        setPassword(null);
        if (!openingCancelled.current && !failedDuringLoad) report(error);
        useWorkspace.getState().set({
          status: openingCancelled.current ? "Opening cancelled" : "Unable to open PDF",
        });
        return false;
      } finally {
        loading.current = null;
        lock.current = false;
        useWorkspace.getState().set({ busy: false });
      }
    },
    [controller, refreshLocal, report],
  );
  const save = useCallback(
    async (saveAs = false, unprotected = false) => {
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
    [controller, report, refreshLocal],
  );
  const guard = useCallback((action: () => void) => {
    if (useWorkspace.getState().busy || lock.current) return;
    if (useWorkspace.getState().dirty) setConfirm(() => action);
    else action();
  }, []);
  const open = useCallback(
    (file?: File) =>
      guard(() => {
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
            if (descriptor) return load(descriptor);
          })
          .catch(report)
          .finally(() => {
            pendingOpen.current = false;
          });
      }),
    [guard, load, report],
  );
  const openToken = useCallback(
    (token: string) =>
      guard(() => {
        if (pendingOpen.current) {
          useWorkspace.getState().set({
            error: "Open is already in progress.",
            status: "Open is already in progress.",
          });
          return;
        }
        pendingOpen.current = true;
        void desktop
          .openDocumentFromToken(token)
          .then((descriptor) => load(descriptor))
          .catch(report)
          .finally(() => {
            pendingOpen.current = false;
          });
      }),
    [guard, load, report],
  );
  const recent = useCallback(
    (id: string, page: number) =>
      guard(() => {
        void desktop
          .openRecent(id)
          .then((descriptor) =>
            load(descriptor, useWorkspace.getState().local.preferences.rememberPage ? page : 1),
          )
          .catch(report);
      }),
    [guard, load, report],
  );
  const home = useCallback(
    () =>
      guard(() => {
        void (async () => {
          const doc = useWorkspace.getState().document;
          await controller?.detach();
          await task.current?.destroy().catch(() => {});
          task.current = null;
          if (doc) await desktop.releaseDocument(doc.id);
          useWorkspace.getState().reset();
          await desktop.markDirty(false);
          if (doc) await desktop.discardRecovery(doc.id);
          await refreshLocal();
        })().catch(report);
      }),
    [controller, guard, report, refreshLocal],
  );
  const recover = useCallback(
    (id: string) =>
      guard(() => {
        void desktop
          .openRecovery(id)
          .then((descriptor) => load(descriptor, 1, true))
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
    [controller, guard, load, report],
  );
  useEffect(() => {
    if (!desktop.native) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<{ token?: string; error?: string }>("open-token", ({ payload }) => {
      if (payload.error) report(payload.error);
      else if (payload.token) openToken(payload.token);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openToken, report]);
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
        lock.current
      )
        return;
      lock.current = true;
      const descriptor = state.document;
      const active = controller.pdf;
      // Autosave never sets busy, so typing and open dialogs keep focus while it runs.
      const previousStatus = state.status;
      const autosaveStatus = "Saving recovery copy...";
      state.set({ status: autosaveStatus });
      void active
        .saveDocument()
        .then((bytes) => desktop.writeRecovery(descriptor, bytes, active.numPages))
        .catch((err) => {
          console.warn("Autosave recovery write failed:", err);
        })
        .finally(() => {
          lock.current = false;
          if (useWorkspace.getState().status === autosaveStatus)
            useWorkspace.getState().set({ status: previousStatus });
        });
    }, 10000);
    return () => clearInterval(interval);
  }, [controller]);
  useEffect(() => {
    if (!desktop.native) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("close-requested", () => {
      if (!useWorkspace.getState().busy)
        guard(() => {
          const id = useWorkspace.getState().document?.id;
          if (id) void desktop.discardRecovery(id).catch(() => {});
          void invoke("close_window").catch(report);
        });
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [guard, report]);
  const cancelPassword = useCallback(() => {
    openingCancelled.current = true;
    setPassword(null);
    void loading.current?.destroy();
  }, []);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const discardAndContinue = useCallback(() => {
    const action = confirm;
    setConfirm(null);
    action?.();
  }, [confirm]);
  const saveAndContinue = useCallback(async () => {
    const action = confirm;
    setConfirm(null);
    if (await save()) action?.();
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
      password,
      cancelPassword,
      confirm,
      cancelConfirm,
      discardAndContinue,
      saveAndContinue,
    }),
    [
      open,
      recent,
      save,
      home,
      recover,
      load,
      report,
      refreshLocal,
      password,
      cancelPassword,
      confirm,
      cancelConfirm,
      discardAndContinue,
      saveAndContinue,
    ],
  );
}

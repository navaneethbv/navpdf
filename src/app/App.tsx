import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { useWorkspace } from "../stores/workspace";
import { ViewerController } from "../features/viewer/controller";
import { ViewerHost } from "../features/viewer/ViewerHost";
import { Sidebar } from "../features/viewer/Sidebar";
import { Properties } from "../features/annotations/Properties";
import { Home } from "../features/home/Home";
import { Settings } from "../features/settings/Settings";
import { Dialog } from "../components/Dialog";
import { ToolErrorBoundary } from "../components/ToolErrorBoundary";
import { native } from "../services/native";
import { Toolbar, Statusbar } from "./Toolbar";
import { useDocumentSession } from "./useDocumentSession";
import { ToolPanel } from "../features/tools/ToolPanel";
import { PageWorkspace } from "../features/pages/PageWorkspace";
import { PrintDialog } from "../features/pages/PrintDialog";
import { CreatePdfDialog } from "../features/pages/CreatePdfDialog";
import { AnnotationToolbar } from "../features/annotations/AnnotationToolbar";
import { AnnotationNoteDialog } from "../features/annotations/AnnotationNoteDialog";
import { SnapshotTool } from "../features/annotations/SnapshotTool";
import { ContentEditor } from "../features/editor/ContentEditor";
import { LinkDialog } from "../features/editor/LinkDialog";
import { ObjectEditor } from "../features/editor/ObjectEditor";
import { DecorationsDialog } from "../features/decorations/DecorationsDialog";
import { AttachmentsDialog } from "../features/attachments/AttachmentsDialog";
import { FormManager } from "../features/forms/FormManager";
import { FillAndSign } from "../features/signatures/FillAndSign";
import { OcrPanel } from "../features/ocr/OcrPanel";
import { ExportDialog } from "../features/convert/ExportDialog";
import { OfficeExport } from "../features/convert/OfficeExport";
import { RedactionTool } from "../features/redact/RedactionTool";
import { CompressDialog } from "../features/compress/CompressDialog";
import { ProtectDialog } from "../features/protect/ProtectDialog";
import { CertificateSignature } from "../features/signatures/CertificateSignature";
import { DesignTools } from "../features/design/DesignTools";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { applyTheme } from "../services/theme";
export default function App() {
  const [controller, setController] = useState<ViewerController | null>(null),
    [passwordValue, setPasswordValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const s = useWorkspace();
  const session = useDocumentSession(controller);
  const ready = useCallback(
    (value: ViewerController) => setController(value),
    [],
  );
  const open = useCallback(() => {
    if (native) session.open();
    else input.current?.click();
  }, [session]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      applyTheme(s.local.preferences.theme, media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [s.local.preferences.theme]);
  useEffect(() => {
    if (controller?.pdf) controller.setLayout(s.layout);
  }, [controller, s.layout]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (s.settingsOpen || session.password || session.confirm) return;
      if (s.busy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const editable =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && !editable) {
        const action = event.key.toLowerCase();
        if (["o", "s", "f", "0", "+", "=", "-"].includes(action)) {
          event.preventDefault();
          if (action === "o") open();
          if (action === "s") void session.save(event.shiftKey);
          if (action === "f" && s.document) s.set({ sidebar: "search" });
          if (action === "0") controller?.zoom("page-fit");
          if (action === "+" || action === "=")
            controller?.zoom((s.zoom / 100) * 1.15);
          if (action === "-") controller?.zoom(s.zoom / 100 / 1.15);
        }
      }
      if (
        !editable &&
        (event.key === "Delete" || event.key === "Backspace") &&
        s.selectedAnnotationId
      ) {
        event.preventDefault();
        void controller?.deleteSelectedAnnotation();
        return;
      }
      if (!editable && event.key === "Escape" && !s.busy) {
        if (s.selectedAnnotationId) {
          s.set({ selectedAnnotationId: null, hasSelection: false });
        }
        controller?.setTool("select");
      }
    }
    window.addEventListener("keydown", key, true);
    function warn(event: BeforeUnloadEvent) {
      if (s.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("beforeunload", warn);
    };
  }, [s, session, controller, open]);
  useEffect(() => {
    if (!native) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void listen<string>("menu-action", ({ payload }) => {
      switch (payload) {
        case "open":
          open();
          break;
        case "save":
          void session.save();
          break;
        case "save-as":
          void session.save(true);
          break;
        case "home":
          session.home();
          break;
        case "undo":
          controller?.undo();
          break;
        case "redo":
          controller?.redo();
          break;
        case "find":
          s.set({ sidebar: "search" });
          break;
        case "settings":
          s.set({ settingsOpen: true });
          break;
        case "highlight":
          if (!s.info?.encrypted) controller?.setTool("highlight");
          break;
        case "select":
          controller?.setTool("select");
          break;
        case "fit-page":
          controller?.zoom("page-fit");
          break;
        case "fit-width":
          controller?.zoom("page-width");
          break;
        case "zoom-in":
          controller?.zoom((s.zoom / 100) * 1.15);
          break;
        case "zoom-out":
          controller?.zoom(s.zoom / 100 / 1.15);
          break;
      }
    }).then((fn) => {
      if (disposed) fn();
      else cleanup = fn;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [controller, s, session, open]);
  return (
    <div className="app-shell">
      <Toolbar
        controller={controller}
        open={open}
        save={(as) => void session.save(as)}
        home={session.home}
      />
      {s.error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={17} />
          <span>{s.error}</span>
          <button
            className="icon-button"
            onClick={() => s.set({ error: "" })}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div
        className={`workspace ${s.document ? "has-document" : ""}`}
        inert={s.busy}
      >
        {s.document && controller && <Sidebar controller={controller} />}
        <ViewerHost controller={controller} onReady={ready} />
        {s.document && controller && <Properties controller={controller} />}
      </div>
      {!s.document && (
        <Home
          open={open}
          recent={session.recent}
          recover={session.recover}
          refresh={session.refreshLocal}
          onError={session.report}
        />
      )}
      <Statusbar controller={controller} />
      {s.busy && (
        <div className="busy-indicator" aria-live="polite">
          <LoaderCircle size={16} className="spinner" />
          {s.status}
        </div>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) session.open(file);
        }}
      />
      {s.settingsOpen && <Settings />}
      {session.password && (
        <Dialog title="Unlock PDF" onClose={session.cancelPassword}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              session.password?.submit(passwordValue);
              setPasswordValue("");
            }}
          >
            <p>{session.password.name}</p>
            <label>
              Password
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
              />
            </label>
            {session.password.reason === 2 && (
              <p className="error-text" role="alert">
                That password did not work. Try again.
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={session.cancelPassword}
              >
                Cancel
              </button>
              <button className="button primary">Unlock PDF</button>
            </div>
          </form>
        </Dialog>
      )}
      {session.confirm && (
        <Dialog title="Save your changes?" onClose={session.cancelConfirm}>
          <p>
            This document has unsaved edits. Save them before continuing, or
            discard this session's changes.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={session.cancelConfirm}>
              Keep editing
            </button>
            <button className="button" onClick={session.discardAndContinue}>
              Discard
            </button>
            <button
              className="button primary"
              disabled={s.busy}
              onClick={() => void session.saveAndContinue()}
            >
              Save and continue
            </button>
          </div>
        </Dialog>
      )}
      <ToolErrorBoundary
        resetKey={s.activeModal ?? s.toolMode ?? ""}
        onError={() =>
          s.set({
            activeModal: null,
            toolMode: null,
            activeSnapshot: false,
            error:
              "That tool stopped unexpectedly and was closed. The open document and its unsaved changes are kept.",
          })
        }
      >
      {s.toolMode && (
        <ToolPanel
          mode={s.toolMode}
          onClose={() => s.set({ toolMode: null })}
        />
      )}
      {s.activeSnapshot && (
        <SnapshotTool onClose={() => s.set({ activeSnapshot: false })} />
      )}
      {(s.activeModal === "annotations" ||
        (s.document &&
          (s.tool === "highlight" ||
            s.tool === "draw" ||
            s.tool === "text" ||
            s.tool === "shape"))) && (
        <AnnotationToolbar
          controller={controller}
          onClose={() => {
            s.set({ activeModal: null });
            if (
              s.tool === "highlight" ||
              s.tool === "draw" ||
              s.tool === "text" ||
              s.tool === "shape"
            ) {
              s.set({ tool: "select" });
              controller?.setTool("select");
            }
          }}
        />
      )}
      {s.activeModal === "page-workspace" && (
        <PageWorkspace
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "print" && (
        <PrintDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "create-pdf" && (
        <CreatePdfDialog
          onLoad={(file) => session.open(file)}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "add-text" && (
        <ContentEditor
          controller={controller}
          type="text"
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "add-image" && (
        <ContentEditor
          controller={controller}
          type="image"
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "add-link" && (
        <LinkDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "sticky-note" && controller && (
        <AnnotationNoteDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "decorations" && (
        <DecorationsDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "attachments" && (
        <AttachmentsDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "forms" && (
        <FormManager
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "fill-sign" && (
        <FillAndSign
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "ocr" && (
        <OcrPanel
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "convert" && (
        <ExportDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "office-export" && (
        <OfficeExport
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "redact" && (
        <RedactionTool
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "edit-objects" && (
        <ObjectEditor
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "compress" && (
        <CompressDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "protect" && (
        <ProtectDialog
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
          onSaveUnprotected={() => session.save(true, true)}
        />
      )}
      {s.activeModal === "certificate-sign" && (
        <CertificateSignature
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "design" && (
        <DesignTools
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      {s.activeModal === "assistant" && (
        <AssistantPanel
          controller={controller}
          onClose={() => s.set({ activeModal: null })}
        />
      )}
      </ToolErrorBoundary>
    </div>
  );
}

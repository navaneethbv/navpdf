import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, Info, LoaderCircle, X } from "lucide-react";
import { useWorkspace } from "../stores/workspace";
import { ViewerController } from "../features/viewer/controller";
import { ViewerHost } from "../features/viewer/ViewerHost";
import { Sidebar } from "../features/viewer/Sidebar";
import { Properties } from "../features/annotations/Properties";
import { Home } from "../features/home/Home";
import { GettingStarted } from "../features/help/GettingStarted";
import { Settings } from "../features/settings/Settings";
import { Dialog } from "../components/Dialog";
import { RootErrorBoundary } from "../components/RootErrorBoundary";
import { ToolErrorBoundary } from "../components/ToolErrorBoundary";
import { native } from "../services/native";
import { Toolbar, Statusbar, QuickToolRail, NavigationRail } from "./Toolbar";
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
import { ExportOptions } from "../features/convert/ExportOptions";
import { PropertiesDialog } from "../features/document/PropertiesDialog";
import { applyTheme } from "../services/theme";
function officeFormat(modal: string | null): "pptx-text" | "xlsx" | "rtf" | "docx" {
  switch (modal) {
    case "office-pptx":
      return "pptx-text";
    case "office-xlsx":
      return "xlsx";
    case "office-rtf":
      return "rtf";
    default:
      return "docx";
  }
}

function handleWorkspaceNavigation(event: KeyboardEvent, controller: ViewerController | null) {
  const state = useWorkspace.getState();
  if (controller?.pdf && ["Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "Home") controller.goToFirst();
    else controller.goToLast();
  }
  if (event.key === "Escape") {
    if (state.readMode) {
      state.set({ readMode: false });
      return;
    }
    state.set({ selectedAnnotationId: null, hasSelection: false });
    controller?.setTool("select");
  }
}

function handleAnnotationKey(event: KeyboardEvent, controller: ViewerController | null): boolean {
  let dx = 0;
  let dy = 0;
  switch (event.key) {
    case "ArrowLeft":
      dx = -1;
      break;
    case "ArrowRight":
      dx = 1;
      break;
    case "ArrowDown":
      dy = -1;
      break;
    case "ArrowUp":
      dy = 1;
      break;
    case "Delete":
    case "Backspace":
      event.preventDefault();
      void controller?.deleteSelectedAnnotation();
      return true;
    default:
      return false;
  }
  event.preventDefault();
  const distance = event.shiftKey ? 10 : 1;
  void controller?.moveSelectedAnnotation(dx * distance, dy * distance);
  return true;
}

type WorkspaceState = ReturnType<typeof useWorkspace.getState>;
type SessionActions = ReturnType<typeof useDocumentSession>;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function handleShortcut(
  event: KeyboardEvent,
  state: WorkspaceState,
  controller: ViewerController | null,
  session: SessionActions,
  open: () => void,
): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const actions = new Map<string, () => void>([
    ["o", () => open()],
    ["s", () => void session.save(event.shiftKey)],
    [
      "f",
      () => {
        if (state.document) state.set({ sidebar: "search" });
      },
    ],
    [
      "p",
      () => {
        if (state.document) state.set({ activeModal: "print" });
      },
    ],
    ["w", () => session.home()],
    ["z", () => (event.shiftKey ? controller?.redo() : controller?.undo())],
    [",", () => state.set({ settingsOpen: true })],
    ["0", () => controller?.zoom("page-fit")],
    ["+", () => controller?.zoom((state.zoom / 100) * 1.15)],
    ["=", () => controller?.zoom((state.zoom / 100) * 1.15)],
    ["-", () => controller?.zoom(state.zoom / 100 / 1.15)],
  ]);
  const action = actions.get(event.key.toLowerCase());
  if (!action) return false;
  event.preventDefault();
  action();
  return true;
}

const creationMenuActions = new Set(["create-pdf", "import-pdf", "combine-pdf", "open-recent"]);
const documentMenuActions = new Set([
  "edit-objects",
  "page-workspace",
  "office-export",
  "office-pptx",
  "office-xlsx",
  "office-rtf",
  "convert",
  "compress",
  "protect",
  "properties",
  "ocr",
  "forms",
  "fill-sign",
]);

function handleLayoutMenuAction(
  payload: string,
  state: WorkspaceState,
  controller: ViewerController | null,
): boolean {
  const layoutActions = new Map<string, () => void>([
    ["layout-single", () => controller?.setLayout("single")],
    ["layout-continuous", () => controller?.setLayout("continuous")],
    ["layout-spread", () => controller?.setLayout("spread")],
  ]);
  const layoutAction = layoutActions.get(payload);
  if (layoutAction) {
    layoutAction();
    return true;
  }
  const panelActions = new Map<string, () => void>([
    ["panel-pages", () => state.set({ sidebar: "pages", propertiesVisible: false })],
    ["panel-bookmarks", () => state.set({ sidebar: "bookmarks", propertiesVisible: false })],
    ["panel-comments", () => state.set({ sidebar: "comments", propertiesVisible: false })],
  ]);
  const panelAction = panelActions.get(payload);
  if (panelAction) {
    panelAction();
    return true;
  }
  return false;
}

function menuActions(
  state: WorkspaceState,
  controller: ViewerController | null,
  session: SessionActions,
  open: () => void,
): Map<string, () => void> {
  return new Map([
    ["first-page", () => controller?.goToFirst()],
    ["last-page", () => controller?.goToLast()],
    [
      "next-page",
      () => {
        if (state.document) controller?.goTo(Math.min(state.page + 1, state.info?.pages ?? 1));
      },
    ],
    [
      "previous-page",
      () => {
        if (state.document) controller?.goTo(Math.max(state.page - 1, 1));
      },
    ],
    [
      "rotate-view",
      () => {
        if (state.document) controller?.rotateView(90);
      },
    ],
    ["actual-size", () => controller?.zoom(1)],
    [
      "read-mode",
      () => {
        if (state.document) state.set({ readMode: !state.readMode });
      },
    ],
    [
      "night-mode",
      () => {
        if (state.document) state.set({ nightMode: !state.nightMode });
      },
    ],
    ["all-tools", () => state.set({ toolMode: state.toolMode ? null : "all" })],
    ["quick-tools", () => state.set({ quickRailVisible: !state.quickRailVisible })],
    ["open", open],
    ["save", () => void session.save()],
    ["save-as", () => void session.save(true)],
    [
      "print",
      () => {
        if (state.document) state.set({ activeModal: "print" });
      },
    ],
    ["home", () => session.home()],
    [
      "organize",
      () => {
        if (state.document) state.set({ activeModal: "page-workspace" });
      },
    ],
    ["undo", () => controller?.undo()],
    ["redo", () => controller?.redo()],
    ["find", () => state.set({ sidebar: "search" })],
    ["settings", () => state.set({ settingsOpen: true })],
    [
      "highlight",
      () => {
        if (!state.info?.encrypted) controller?.setTool("highlight");
      },
    ],
    ["select", () => controller?.setTool("select")],
    [
      "tools:add-text",
      () => {
        if (state.document) state.set({ activeModal: "add-text" });
      },
    ],
    [
      "tools:add-image",
      () => {
        if (state.document) state.set({ activeModal: "add-image" });
      },
    ],
    [
      "tools:annotations",
      () => {
        if (state.document) state.set({ activeModal: "annotations" });
      },
    ],
    [
      "tools:redact",
      () => {
        if (state.document) state.set({ activeModal: "redact" });
      },
    ],
    ["fit-page", () => controller?.zoom("page-fit")],
    ["fit-width", () => controller?.zoom("page-width")],
    ["zoom-in", () => controller?.zoom((state.zoom / 100) * 1.15)],
    ["zoom-out", () => controller?.zoom(state.zoom / 100 / 1.15)],
  ]);
}

function handleMenuAction(
  payload: string,
  state: WorkspaceState,
  controller: ViewerController | null,
  session: SessionActions,
  open: () => void,
) {
  if (["help", "tour", "tips"].includes(state.activeModal ?? "")) return;
  if (state.busy || state.settingsOpen || session.password || session.confirm || state.activeModal)
    return;
  if (creationMenuActions.has(payload) || (state.document && documentMenuActions.has(payload))) {
    state.set({ activeModal: payload });
    return;
  }
  if (state.document && handleLayoutMenuAction(payload, state, controller)) return;
  if (payload === "tour" || payload === "tips") {
    state.set({ activeModal: payload });
    return;
  }
  menuActions(state, controller, session, open).get(payload)?.();
}

export default function App() {
  const [controller, setController] = useState<ViewerController | null>(null),
    [passwordValue, setPasswordValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const s = useWorkspace();
  const session = useDocumentSession(controller);
  const ready = useCallback((value: ViewerController) => setController(value), []);
  // The app owns document lifetime. A render boundary can remove ViewerHost
  // while its controller must remain available to the emergency Save a copy.
  useEffect(() => () => controller?.destroy(), [controller]);
  const open = useCallback(() => {
    if (native) session.open();
    else input.current?.click();
  }, [session]);
  useEffect(() => {
    if (s.settingsOpen) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      applyTheme(s.local.preferences.theme, media.matches, s.local.preferences);
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, [s.local.preferences, s.settingsOpen]);
  useEffect(() => {
    if (controller?.pdf) controller.setLayout(s.layout);
  }, [controller, s.layout]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const state = useWorkspace.getState();
      if (
        state.settingsOpen ||
        session.password ||
        session.confirm ||
        ["help", "tour", "tips"].includes(state.activeModal ?? "")
      )
        return;
      if (state.busy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (isEditableTarget(event.target)) return;
      handleShortcut(event, state, controller, session, open);
      if (state.selectedAnnotationId && handleAnnotationKey(event, controller)) return;
      handleWorkspaceNavigation(event, controller);
    }
    window.addEventListener("keydown", key, true);
    function warn(event: BeforeUnloadEvent) {
      if (useWorkspace.getState().dirty) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("beforeunload", warn);
    };
  }, [session, controller, open]);
  useEffect(() => {
    if (!native) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void listen<string>("menu-action", ({ payload }) => {
      handleMenuAction(payload, useWorkspace.getState(), controller, session, open);
    }).then((fn) => {
      if (disposed) fn();
      else cleanup = fn;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [controller, session, open]);
  return (
    <div
      className={`app-shell ${s.readMode ? "read-mode" : ""} ${s.nightMode ? "night-mode" : ""}`}
    >
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
            type="button"
            className="icon-button"
            onClick={() => s.set({ error: "" })}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {s.formNotice && (
        <div className="error-banner notice-banner">
          <Info size={17} />
          <span>{s.formNotice}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => s.set({ formNotice: null })}
            aria-label="Dismiss form notice"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <RootErrorBoundary
        controller={controller}
        document={s.document}
        resetKey={s.document?.id ?? "home"}
      >
        <div className={`workspace ${s.document ? "has-document" : ""}`} inert={s.busy}>
          {s.document && s.toolMode && (
            <ToolPanel mode={s.toolMode} onClose={() => s.set({ toolMode: null })} />
          )}
          <div className="document-stage">
            {s.document && <QuickToolRail controller={controller} />}
            <ViewerHost controller={controller} onReady={ready} />
          </div>
          {s.document && controller && s.navigationVisible && <Sidebar controller={controller} />}
          {s.document && controller && (s.propertiesVisible || s.selectedAnnotationId) && (
            <Properties controller={controller} />
          )}
          {s.document && <NavigationRail controller={controller} />}
        </div>
      </RootErrorBoundary>
      {!s.document && (
        <Home
          open={open}
          recent={session.recent}
          recover={session.recover}
          refresh={session.refreshLocal}
          onError={session.report}
        />
      )}
      <Statusbar />
      {s.busy && (
        <div className="busy-indicator" aria-hidden="true">
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
      <GettingStarted
        ready={session.preferencesReady && !!controller && !session.password && !session.confirm}
      />
      {s.settingsOpen && <Settings />}
      {s.activeModal === "open-recent" && (
        <Dialog title="Open Recent Files" onClose={() => s.set({ activeModal: null })}>
          <div className="export-options">
            {s.local.recents.length ? (
              s.local.recents.map((item) => (
                <button
                  type="button"
                  className="button"
                  key={item.id}
                  onClick={() => {
                    s.set({ activeModal: null });
                    session.recent(item.id, item.page);
                  }}
                >
                  {item.name}
                </button>
              ))
            ) : (
              <p>No recent PDFs yet.</p>
            )}
          </div>
        </Dialog>
      )}
      {session.password && (
        <Dialog title="Unlock PDF" onClose={session.cancelPassword} priority>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              session.password?.submit(passwordValue);
              setPasswordValue("");
            }}
          >
            <p>{session.password.name}</p>
            <label>
              Password{" "}
              <input
                data-autofocus
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
              <button type="button" className="button" onClick={session.cancelPassword}>
                Cancel
              </button>
              <button type="submit" className="button primary">
                Unlock PDF
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {session.confirm && (
        <Dialog title="Save your changes?" onClose={session.cancelConfirm} priority>
          <p>
            This document has unsaved edits. Save them before continuing, or discard this session's
            changes.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={session.cancelConfirm}>
              Keep editing
            </button>
            <button type="button" className="button" onClick={session.discardAndContinue}>
              Discard
            </button>
            <button
              type="button"
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
        {!s.document && s.toolMode && (
          <ToolPanel mode={s.toolMode} onClose={() => s.set({ toolMode: null })} />
        )}
        {s.activeSnapshot && <SnapshotTool onClose={() => s.set({ activeSnapshot: false })} />}
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
          <PageWorkspace controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "print" && (
          <PrintDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {["create-pdf", "import-pdf", "combine-pdf"].includes(s.activeModal ?? "") && (
          <CreatePdfDialog
            initialTab={s.activeModal === "create-pdf" ? "blank" : "combine"}
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
          <LinkDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "sticky-note" && controller && (
          <AnnotationNoteDialog
            controller={controller}
            onClose={() => s.set({ activeModal: null })}
          />
        )}
        {s.activeModal === "decorations" && (
          <DecorationsDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "attachments" && (
          <AttachmentsDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "forms" && (
          <FormManager controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "fill-sign" && (
          <FillAndSign controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "ocr" && (
          <OcrPanel controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "convert" && (
          <ExportDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {["office-export", "office-pptx", "office-xlsx", "office-rtf"].includes(
          s.activeModal ?? "",
        ) && (
          <OfficeExport
            controller={controller}
            initialFormat={officeFormat(s.activeModal)}
            onClose={() => s.set({ activeModal: null })}
          />
        )}
        {s.activeModal === "redact" && (
          <RedactionTool controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "edit-objects" && (
          <ObjectEditor controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "compress" && (
          <CompressDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
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
          <DesignTools controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
        {s.activeModal === "export-options" && <ExportOptions />}
        {s.activeModal === "properties" && (
          <PropertiesDialog controller={controller} onClose={() => s.set({ activeModal: null })} />
        )}
      </ToolErrorBoundary>
    </div>
  );
}

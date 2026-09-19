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
  const formats = {
    "office-pptx": "pptx-text",
    "office-xlsx": "xlsx",
    "office-rtf": "rtf",
  } as const;
  return formats[modal as keyof typeof formats] ?? "docx";
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
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowDown: [0, -1],
    ArrowUp: [0, 1],
  };
  const direction = directions[event.key];
  if (direction) {
    event.preventDefault();
    const distance = event.shiftKey ? 10 : 1;
    void controller?.moveSelectedAnnotation(direction[0] * distance, direction[1] * distance);
    return true;
  }
  if (["Delete", "Backspace"].includes(event.key)) {
    event.preventDefault();
    void controller?.deleteSelectedAnnotation();
    return true;
  }
  return false;
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
      const editable =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (editable) return;
      if (event.ctrlKey || event.metaKey) {
        const actions: Record<string, () => void> = {
          o: open,
          s: () => {
            void session.save(event.shiftKey);
          },
          f: () => {
            if (state.document) state.set({ sidebar: "search" });
          },
          p: () => {
            if (state.document) state.set({ activeModal: "print" });
          },
          w: session.home,
          z: () => {
            if (event.shiftKey) controller?.redo();
            else controller?.undo();
          },
          ",": () => state.set({ settingsOpen: true }),
          "0": () => controller?.zoom("page-fit"),
          "+": () => controller?.zoom((state.zoom / 100) * 1.15),
          "=": () => controller?.zoom((state.zoom / 100) * 1.15),
          "-": () => controller?.zoom(state.zoom / 100 / 1.15),
        };
        const command = actions[event.key.toLowerCase()];
        if (command) {
          event.preventDefault();
          command();
        }
      }
      if (state.selectedAnnotationId && handleAnnotationKey(event, controller)) return;
      handleWorkspaceNavigation(event, controller);
    }
    window.addEventListener("keydown", key, true);
    function warn(event: BeforeUnloadEvent) {
      if (useWorkspace.getState().dirty) {
        event.preventDefault();
        event.returnValue = "";
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
      const state = useWorkspace.getState();
      if (["help", "tour", "tips"].includes(state.activeModal ?? "")) return;
      if (
        state.busy ||
        state.settingsOpen ||
        session.password ||
        session.confirm ||
        state.activeModal
      )
        return;
      const creationActions = ["create-pdf", "import-pdf", "combine-pdf", "open-recent"];
      const documentActions = [
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
      ];
      if (
        creationActions.includes(payload) ||
        (state.document && documentActions.includes(payload))
      ) {
        state.set({ activeModal: payload });
        return;
      }
      if (state.document) {
        const layout = new Map<string, "single" | "continuous" | "spread">([
          ["layout-single", "single"],
          ["layout-continuous", "continuous"],
          ["layout-spread", "spread"],
        ]).get(payload);
        if (layout) {
          controller?.setLayout(layout);
          return;
        }
        const panel = new Map<string, "pages" | "bookmarks" | "comments">([
          ["panel-pages", "pages"],
          ["panel-bookmarks", "bookmarks"],
          ["panel-comments", "comments"],
        ]).get(payload);
        if (panel) {
          state.set({ sidebar: panel, propertiesVisible: false });
          return;
        }
      }
      const actions: Record<string, () => void> = {
        "first-page": () => {
          controller?.goToFirst();
        },
        "last-page": () => {
          controller?.goToLast();
        },
        "next-page": () => {
          if (state.document) controller?.goTo(Math.min(state.page + 1, state.info?.pages ?? 1));
        },
        "previous-page": () => {
          if (state.document) controller?.goTo(Math.max(state.page - 1, 1));
        },
        "rotate-view": () => {
          if (state.document) controller?.rotateView(90);
        },
        "actual-size": () => {
          controller?.zoom(1);
        },
        "read-mode": () => {
          if (state.document) state.set({ readMode: !state.readMode });
        },
        "night-mode": () => {
          if (state.document) state.set({ nightMode: !state.nightMode });
        },
        "all-tools": () => {
          state.set({ toolMode: state.toolMode ? null : "all" });
        },
        "quick-tools": () => {
          state.set({ quickRailVisible: !state.quickRailVisible });
        },
        tour: () => {
          if (
            state.busy ||
            state.settingsOpen ||
            state.activeModal ||
            session.password ||
            session.confirm
          )
            return;
          state.set({ activeModal: payload });
        },
        tips: () => {
          if (
            state.busy ||
            state.settingsOpen ||
            state.activeModal ||
            session.password ||
            session.confirm
          )
            return;
          state.set({ activeModal: payload });
        },
        open: () => {
          open();
        },
        save: () => {
          void session.save();
        },
        "save-as": () => {
          void session.save(true);
        },
        print: () => {
          if (state.document) state.set({ activeModal: "print" });
        },
        home: () => {
          session.home();
        },
        organize: () => {
          if (state.document) state.set({ activeModal: "page-workspace" });
        },
        undo: () => {
          controller?.undo();
        },
        redo: () => {
          controller?.redo();
        },
        find: () => {
          state.set({ sidebar: "search" });
        },
        settings: () => {
          state.set({ settingsOpen: true });
        },
        highlight: () => {
          if (!state.info?.encrypted) controller?.setTool("highlight");
        },
        select: () => {
          controller?.setTool("select");
        },
        "tools:add-text": () => {
          if (state.document) state.set({ activeModal: "add-text" });
        },
        "tools:add-image": () => {
          if (state.document) state.set({ activeModal: "add-image" });
        },
        "tools:annotations": () => {
          if (state.document) state.set({ activeModal: "annotations" });
        },
        "tools:redact": () => {
          if (state.document) state.set({ activeModal: "redact" });
        },
        "fit-page": () => {
          controller?.zoom("page-fit");
        },
        "fit-width": () => {
          controller?.zoom("page-width");
        },
        "zoom-in": () => {
          controller?.zoom((state.zoom / 100) * 1.15);
        },
        "zoom-out": () => {
          controller?.zoom(state.zoom / 100 / 1.15);
        },
      };
      actions[payload]?.();
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
              <button className="button primary">Unlock PDF</button>
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

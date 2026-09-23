import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
  Highlighter,
  PenTool,
  Type,
  PenLine,
  Camera,
  Printer,
  Minus,
  Plus,
  Scan,
  MoveHorizontal,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  Layers,
  Volume2,
  Pause,
  Play,
  Square,
  ArrowDownToLine,
  Search,
  Home,
  Settings,
  Download,
  Eye,
  EyeOff,
  RotateCw,
  Moon,
  CircleHelp,
  X,
  Files,
  Bookmark,
  MessageSquare,
  Info,
  Ellipsis,
} from "lucide-react";
import { useWorkspace } from "../stores/workspace";
import type { ViewerController } from "../features/viewer/controller";
import type { Layout, ToolMode } from "../types/document";

type ControllerProps = { controller: ViewerController | null };
export function Toolbar({
  open,
  save,
  home,
}: Readonly<
  ControllerProps & {
    open: () => void;
    save: (as: boolean) => void;
    home: () => void;
  }
>) {
  const s = useWorkspace();
  const disabled = !s.document || s.busy;
  const toggleMode = (mode: ToolMode) => s.set({ toolMode: s.toolMode === mode ? null : mode });
  return (
    <>
      <header className="document-bar">
        <button className="icon-button" onClick={home} aria-label="NavPDF home" title="Home">
          <Home size={21} />
        </button>
        <div className={`document-tab ${s.document ? "is-open" : ""}`}>
          <Files size={17} />
          <span>{s.document?.name || "NavPDF"}</span>
          {s.dirty && <span className="dirty-indicator" title="Unsaved changes" />}
          {s.document && (
            <button
              className="icon-button"
              onClick={home}
              disabled={s.busy}
              aria-label="Close document"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          className="create-button"
          disabled={s.busy}
          onClick={() => s.set({ activeModal: "create-pdf" })}
        >
          <Plus size={18} /> Create
        </button>
        <div className="toolbar-space" />
        <button
          className="icon-button"
          aria-label="Help and tips"
          title="Help and tips"
          disabled={s.busy}
          onClick={() => s.set({ activeModal: "help" })}
        >
          <CircleHelp size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="Settings"
          title="Settings"
          disabled={s.busy}
          onClick={() => s.set({ settingsOpen: true })}
        >
          <Settings size={19} />
        </button>
      </header>
      <div className="workspace-commandbar">
        <nav className="workspace-modes" aria-label="Tool modes">
          {(
            [
              ["all", "All tools"],
              ["edit", "Edit"],
              ["convert", "Convert"],
              ["esign", "E-Sign"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              aria-pressed={s.toolMode === mode}
              className={s.toolMode === mode ? "active" : ""}
              disabled={s.busy}
              onClick={() => toggleMode(mode)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="toolbar-space" />
        <button
          className="workspace-find"
          aria-label="Find in PDF"
          disabled={disabled}
          onClick={() => s.set({ sidebar: "search" })}
        >
          <span>Find text in this PDF</span>
          <Search size={20} />
        </button>
        <div className="command-actions" role="toolbar" aria-label="File actions">
          <button
            className="icon-button"
            title="Open (⌘O)"
            aria-label="Open PDF"
            disabled={s.busy}
            onClick={open}
          >
            <FolderOpen size={21} />
          </button>
          <button
            className="icon-button"
            title="Save (⌘S)"
            aria-label="Save PDF"
            disabled={disabled || s.info?.encrypted}
            onClick={() => save(false)}
          >
            <Save size={21} />
          </button>
          <button
            className="icon-button"
            title="Save As (⌘⇧S)"
            aria-label="Save PDF As"
            disabled={disabled || s.info?.encrypted}
            onClick={() => save(true)}
          >
            <Download size={21} />
          </button>
          <button
            className="icon-button"
            title="Print"
            aria-label="Print Document"
            disabled={disabled}
            onClick={() => s.set({ activeModal: "print" })}
          >
            <Printer size={21} />
          </button>
          <button
            className="export-button"
            disabled={disabled}
            onClick={() => s.set({ activeModal: "export-options" })}
          >
            Export PDF
          </button>
        </div>
        <button
          className="icon-button read-mode-exit"
          aria-label="Exit read mode"
          onClick={() => s.set({ readMode: false })}
        >
          <Eye size={20} />
        </button>
      </div>
    </>
  );
}

export function QuickToolRail({ controller }: Readonly<ControllerProps>) {
  const s = useWorkspace();
  const disabled = !s.document || s.busy;
  const readOnly = disabled || !s.editingAllowed || !!s.info?.encrypted;
  if (!s.quickRailVisible) return null;
  return (
    <div className="quick-tool-rail" role="toolbar" aria-label="PDF tools">
      <span className="rail-grip" aria-hidden="true" />
      <button
        title="Select text"
        aria-label="Select text"
        aria-pressed={s.tool === "select"}
        disabled={disabled}
        onClick={() => controller?.setTool("select")}
      >
        <MousePointer2 size={24} />
      </button>
      <button
        title="Add a comment"
        aria-label="Add a comment"
        disabled={readOnly}
        onClick={() => s.set({ activeModal: "sticky-note" })}
      >
        <MessageSquare size={23} />
      </button>
      <button
        title="Highlight text"
        aria-label="Highlight text"
        aria-pressed={s.tool === "highlight"}
        disabled={readOnly}
        onClick={() => controller?.setTool("highlight")}
      >
        <Highlighter size={24} />
      </button>
      <button
        title="Ink & Draw"
        aria-label="Ink & Draw"
        aria-pressed={s.tool === "draw"}
        disabled={readOnly}
        onClick={() => s.set({ tool: "draw", activeModal: "annotations" })}
      >
        <PenTool size={24} />
      </button>
      <button
        title="Add Text"
        aria-label="Add Text"
        aria-pressed={s.tool === "text"}
        disabled={readOnly}
        onClick={() => s.set({ tool: "text", activeModal: "add-text" })}
      >
        <Type size={24} />
      </button>
      <button
        title="Fill & Sign"
        aria-label="Fill & Sign"
        aria-pressed={s.tool === "signature"}
        disabled={readOnly}
        onClick={() => {
          s.set({ activeModal: "fill-sign", tool: "signature" });
          controller?.setTool("signature");
        }}
      >
        <PenLine size={24} />
      </button>
      <button
        title="Snapshot region"
        aria-label="Snapshot region"
        aria-pressed={s.activeSnapshot}
        disabled={disabled}
        onClick={() => {
          s.set({ activeSnapshot: true, tool: "snapshot" });
          controller?.setTool("snapshot");
        }}
      >
        <Camera size={24} />
      </button>
      <details className="rail-more">
        <summary aria-label="More quick tools" title="More quick tools">
          <Ellipsis size={24} />
        </summary>
        <div className="rail-popover">
          <button
            aria-label="Hand tool"
            aria-pressed={s.tool === "hand"}
            disabled={disabled}
            onClick={() => controller?.setTool("hand")}
          >
            <Hand size={18} /> Hand tool
          </button>
          <button
            aria-label="Undo"
            disabled={disabled || !s.canUndo}
            onClick={() => controller?.undo()}
          >
            <Undo2 size={18} /> Undo
          </button>
          <button
            aria-label="Redo"
            disabled={disabled || !s.canRedo}
            onClick={() => controller?.redo()}
          >
            <Redo2 size={18} /> Redo
          </button>
          <button aria-label="Hide quick tools" onClick={() => s.set({ quickRailVisible: false })}>
            <EyeOff size={18} /> Hide quick tools
          </button>
        </div>
      </details>
    </div>
  );
}

export function NavigationRail({ controller }: Readonly<ControllerProps>) {
  const s = useWorkspace();
  const disabled = !s.document || s.busy;
  const pageInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(String(s.page));
  useEffect(() => {
    if (document.activeElement !== pageInput.current)
      setPage(s.pageLabels?.[s.page - 1] ?? String(s.page));
  }, [s.page, s.pageLabels]);
  useEffect(() => {
    if (s.pageFocus > 0) {
      pageInput.current?.focus();
      pageInput.current?.select();
    }
  }, [s.pageFocus]);
  const commit = () => {
    if (!page.trim()) {
      setPage(String(s.page));
      return;
    }
    if (controller?.goToPage) controller.goToPage(page);
    else if (Number.isFinite(Number(page))) controller?.goTo(Number(page));
  };
  return (
    <aside className="navigation-rail" aria-label="Page and view controls">
      <div className="rail-panels">
        {(
          [
            { id: "comments", label: "Comments", icon: MessageSquare },
            { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
            { id: "pages", label: "Pages", icon: Files },
            { id: "search", label: "Search", icon: Search },
            { id: "layers", label: "Layers", icon: Layers },
          ] as const
        )
          .filter((item) => item.id !== "layers" || s.layers.length > 0)
          .map((item) => (
            <button
              key={item.id}
              title={item.label}
              aria-label={`Show ${item.label.toLowerCase()}`}
              aria-pressed={s.navigationVisible && s.sidebar === item.id}
              disabled={disabled}
              onClick={() =>
                s.set({
                  sidebar: item.id,
                  navigationVisible: !(s.navigationVisible && s.sidebar === item.id),
                  propertiesVisible: false,
                })
              }
            >
              <item.icon size={23} />
            </button>
          ))}
        <button
          title="Document properties"
          aria-label="Show document properties"
          disabled={disabled}
          aria-pressed={s.propertiesVisible}
          onClick={() =>
            s.set({ propertiesVisible: !s.propertiesVisible, navigationVisible: false })
          }
        >
          <Info size={23} />
        </button>
      </div>
      <div className="rail-navigation">
        <input
          ref={pageInput}
          aria-label="Page number"
          value={page}
          disabled={disabled}
          onChange={(event) => {
            setPage(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              event.currentTarget.blur();
            }
          }}
        />
        <span title="Total pages">{s.info?.pages ?? 0}</span>
        <button
          title="Previous page"
          aria-label="Previous page"
          disabled={disabled || s.page <= 1}
          onClick={() => controller?.goTo(s.page - 1)}
        >
          <ChevronUp size={23} />
        </button>
        <button
          title="Next page"
          aria-label="Next page"
          disabled={disabled || s.page >= (s.info?.pages ?? 0)}
          onClick={() => controller?.goTo(s.page + 1)}
        >
          <ChevronDown size={23} />
        </button>
        <button
          title="Previous view (⌘[)"
          aria-label="Previous view"
          disabled={disabled || !s.canGoBack}
          onClick={() => controller?.goBack()}
        >
          <ArrowLeft size={23} />
        </button>
        <button
          title="Next view (⌘])"
          aria-label="Next view"
          disabled={disabled || !s.canGoForward}
          onClick={() => controller?.goForward()}
        >
          <ArrowRight size={23} />
        </button>
        <hr />
        <button
          title="Rotate view clockwise"
          aria-label="Rotate view clockwise"
          disabled={disabled}
          onClick={() => controller?.rotateView(90)}
        >
          <RotateCw size={23} />
        </button>
        <button
          title="Fit page (⌘0)"
          aria-label="Fit page"
          disabled={disabled}
          onClick={() => controller?.zoom("page-fit")}
        >
          <Scan size={23} />
        </button>
        <button
          title="Zoom in"
          aria-label="Zoom in"
          disabled={disabled || s.zoom >= 500}
          onClick={() => controller?.zoom((s.zoom / 100) * 1.15)}
        >
          <Plus size={23} />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          disabled={disabled || s.zoom <= 25}
          onClick={() => controller?.zoom(s.zoom / 100 / 1.15)}
        >
          <Minus size={23} />
        </button>
        <details className="rail-more">
          <summary aria-label="More view options" title="More view options">
            <Ellipsis size={22} />
          </summary>
          <div className="rail-popover view-options">
            <label>
              Zoom{" "}
              <select
                aria-label="Zoom percentage"
                value={s.zoom}
                onChange={(e) => controller?.zoom(Number(e.target.value) / 100)}
              >
                {[...new Set([25, 50, 75, 100, 125, 150, 200, 300, 400, 500, s.zoom])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Page display{" "}
              <select
                aria-label="Page layout"
                value={s.layout}
                onChange={(e) => controller?.setLayout(e.target.value as Layout)}
              >
                <option value="continuous">Continuous</option>
                <option value="single">Single page</option>
                <option value="spread">Two pages</option>
              </select>
            </label>
            <button aria-label="Fit width" onClick={() => controller?.zoom("page-width")}>
              <MoveHorizontal size={18} /> Fit width
            </button>
            <button
              aria-label={s.nightMode ? "Disable night mode" : "Enable night mode"}
              onClick={() => s.set({ nightMode: !s.nightMode })}
            >
              <Moon size={18} /> Night mode
            </button>
            <button
              aria-label={s.readMode ? "Exit read mode" : "Enter read mode"}
              onClick={() => s.set({ readMode: !s.readMode })}
            >
              <Eye size={18} /> Read mode
            </button>
            {controller?.readAloud.supported && (
              <>
                <button
                  aria-label="Read this page aloud"
                  onClick={() => void controller.readOutLoud(false)}
                >
                  <Volume2 size={18} /> Read this page aloud
                </button>
                <button
                  aria-label="Read to the end aloud"
                  onClick={() => void controller.readOutLoud(true)}
                >
                  <Volume2 size={18} /> Read to the end
                </button>
              </>
            )}
            <button
              aria-label={s.autoScroll ? "Stop automatic scrolling" : "Scroll automatically"}
              onClick={() => controller?.autoScroll.toggle()}
            >
              <ArrowDownToLine size={18} /> {s.autoScroll ? "Stop scrolling" : "Auto-scroll"}
            </button>
            <button
              aria-label="Toggle Quick Tool Rail"
              onClick={() => s.set({ quickRailVisible: !s.quickRailVisible })}
            >
              <PenTool size={18} /> {s.quickRailVisible ? "Hide" : "Show"} quick tools
            </button>
          </div>
        </details>
      </div>
    </aside>
  );
}

export function Statusbar({ controller }: Readonly<ControllerProps>) {
  const s = useWorkspace();
  return (
    <footer className="statusbar">
      <span className={`status-light ${s.busy ? "working" : ""}`} />
      <output>{s.status}</output>
      {s.readAloud !== "idle" && (
        <fieldset className="playback-controls" aria-label="Read Out Loud">
          <button
            title={s.readAloud === "paused" ? "Resume reading" : "Pause reading"}
            aria-label={s.readAloud === "paused" ? "Resume reading" : "Pause reading"}
            onClick={() => controller?.toggleReadAloudPause()}
          >
            {s.readAloud === "paused" ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            title="Stop reading"
            aria-label="Stop reading"
            onClick={() => controller?.readAloud.stop()}
          >
            <Square size={14} />
          </button>
        </fieldset>
      )}
      {s.autoScroll && (
        <fieldset className="playback-controls" aria-label="Automatic scrolling">
          <button
            title="Scroll slower"
            aria-label="Scroll slower"
            onClick={() => controller?.autoScroll.slower()}
          >
            <Minus size={14} />
          </button>
          <button
            title="Scroll faster"
            aria-label="Scroll faster"
            onClick={() => controller?.autoScroll.faster()}
          >
            <Plus size={14} />
          </button>
          <button
            title="Stop scrolling"
            aria-label="Stop scrolling"
            onClick={() => controller?.autoScroll.stop()}
          >
            <Square size={14} />
          </button>
        </fieldset>
      )}
      <div className="statusbar-space" />
      {s.document && (
        <span>
          {s.info?.encrypted ? "Protected · " : ""}
          {s.hasDigitalSignature ? "Signed · " : ""}
          {(s.document.size / 1024).toFixed(1)} KB
        </span>
      )}
      <span>On your device</span>
    </footer>
  );
}

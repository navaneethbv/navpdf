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
  ChevronLeft,
  ChevronRight,
  Search,
  Home,
  Settings,
  ShieldCheck,
  Download,
  Eye,
  EyeOff,
  Layers,
  Lock,
} from "lucide-react";
import { useWorkspace } from "../stores/workspace";
import type { ViewerController } from "../features/viewer/controller";
import type { Layout, ToolMode } from "../types/document";

export function Toolbar({
  controller,
  open,
  save,
  home,
}: {
  controller: ViewerController | null;
  open: () => void;
  save: (as: boolean) => void;
  home: () => void;
}) {
  const s = useWorkspace(),
    disabled = !s.document || s.busy;

  const toggleMode = (m: ToolMode) => {
    s.set({ toolMode: s.toolMode === m ? null : m });
  };

  return (
    <>
      <header className="titlebar">
        <button className="brand" onClick={home} aria-label="NavPDF home">
          <span>N</span>NavPDF
        </button>
        <span className="titlebar-divider" />
        <nav className="mode-nav-tabs" role="tablist" aria-label="Tool modes">
          <button
            className={`mode-tab ${s.toolMode === "all" ? "active" : ""}`}
            onClick={() => toggleMode("all")}
          >
            All tools
          </button>
          <button
            className={`mode-tab ${s.toolMode === "edit" ? "active" : ""}`}
            onClick={() => toggleMode("edit")}
          >
            Edit
          </button>
          <button
            className={`mode-tab ${s.toolMode === "convert" ? "active" : ""}`}
            onClick={() => toggleMode("convert")}
          >
            Convert
          </button>
          <button
            className={`mode-tab ${s.toolMode === "esign" ? "active" : ""}`}
            onClick={() => toggleMode("esign")}
          >
            E-Sign
          </button>
          <button
            className={`mode-tab ${s.toolMode === "create" ? "active" : ""}`}
            onClick={() => toggleMode("create")}
          >
            Create
          </button>
        </nav>
        <span className="titlebar-divider" />
        <div className="document-title">
          {s.document?.name || "Local workspace"}
          {s.dirty && (
            <span className="dirty-indicator" title="Unsaved changes" />
          )}
        </div>
        <div className="titlebar-space" />
        <span className="privacy-label">
          <ShieldCheck size={15} /> On your device
        </span>
        <button
          className="icon-button"
          aria-label="Toggle Quick Tool Rail"
          title={s.quickRailVisible ? "Hide quick rail" : "Show quick rail"}
          onClick={() => s.set({ quickRailVisible: !s.quickRailVisible })}
        >
          {s.quickRailVisible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          className="icon-button"
          aria-label="Settings"
          onClick={() => s.set({ settingsOpen: true })}
        >
          <Settings size={17} />
        </button>
      </header>

      {s.quickRailVisible && (
        <div className="main-toolbar" role="toolbar" aria-label="PDF tools">
          <div className="toolbar-group">
            <button
              title="Open (⌘O)"
              aria-label="Open PDF"
              onClick={open}
              disabled={s.busy}
            >
              <FolderOpen size={18} />
              <span>Open</span>
            </button>
            <button
              title="Save (⌘S)"
              aria-label="Save PDF"
              onClick={() => save(false)}
              disabled={disabled || s.info?.encrypted}
            >
              <Save size={18} />
              <span>Save</span>
            </button>
            <button
              title="Save As (⌘⇧S)"
              aria-label="Save PDF As"
              onClick={() => save(true)}
              disabled={disabled || s.info?.encrypted}
            >
              <Download size={18} />
            </button>
          </div>
          <div className="toolbar-group">
            <button
              aria-label="Undo"
              disabled={disabled || !s.canUndo}
              onClick={() => controller?.undo()}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="Redo"
              disabled={disabled || !s.canRedo}
              onClick={() => controller?.redo()}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <div className="toolbar-group">
            <button
              aria-label="Select text"
              aria-pressed={s.tool === "select"}
              className={s.tool === "select" ? "active" : ""}
              disabled={disabled}
              onClick={() => controller?.setTool("select")}
            >
              <MousePointer2 size={18} />
              <span>Select</span>
            </button>
            <button
              aria-label="Hand tool"
              aria-pressed={s.tool === "hand"}
              className={s.tool === "hand" ? "active" : ""}
              disabled={disabled}
              onClick={() => controller?.setTool("hand")}
            >
              <Hand size={18} />
            </button>
            <button
              aria-label="Highlight text"
              aria-pressed={s.tool === "highlight"}
              className={s.tool === "highlight" ? "active" : ""}
              disabled={disabled || s.info?.encrypted}
              onClick={() => controller?.setTool("highlight")}
            >
              <Highlighter size={18} />
              <span>Highlight</span>
            </button>
            <button
              aria-label="Ink & Draw"
              aria-pressed={s.tool === "draw"}
              className={s.tool === "draw" ? "active" : ""}
              disabled={disabled}
              onClick={() => s.set({ tool: "draw", activeModal: "annotations" })}
            >
              <PenTool size={18} />
            </button>
            <button
              aria-label="Add Text"
              aria-pressed={s.tool === "text"}
              className={s.tool === "text" ? "active" : ""}
              disabled={disabled}
              onClick={() => s.set({ tool: "text", activeModal: "add-text" })}
            >
              <Type size={18} />
            </button>
            <button
              aria-label="Fill & Sign"
              aria-pressed={s.tool === "signature"}
              className={s.tool === "signature" ? "active" : ""}
              disabled={disabled}
              onClick={() => s.set({ activeModal: "fill-sign" })}
            >
              <PenLine size={18} />
            </button>
            <button
              aria-label="Snapshot region"
              aria-pressed={s.activeSnapshot}
              className={s.activeSnapshot ? "active" : ""}
              disabled={disabled}
              onClick={() => s.set({ activeSnapshot: true, tool: "snapshot" })}
            >
              <Camera size={18} />
            </button>
            <button
              aria-label="Organize Pages"
              disabled={disabled}
              onClick={() => s.set({ activeModal: "page-workspace" })}
            >
              <Layers size={18} />
            </button>
            <button
              aria-label="Print Document"
              disabled={disabled}
              onClick={() => s.set({ activeModal: "print" })}
            >
              <Printer size={18} />
            </button>
          </div>
        <div className="toolbar-group zoom-controls">
          <button
            aria-label="Zoom out"
            disabled={disabled || s.zoom <= 25}
            onClick={() => controller?.zoom(s.zoom / 100 / 1.15)}
          >
            <Minus size={16} />
          </button>
          <select
            aria-label="Zoom percentage"
            value={s.zoom}
            disabled={disabled}
            onChange={(e) => controller?.zoom(Number(e.target.value) / 100)}
          >
            {[
              ...new Set([
                25,
                50,
                75,
                100,
                125,
                150,
                200,
                300,
                400,
                500,
                s.zoom,
              ]),
            ]
              .sort((a, b) => a - b)
              .map((n) => (
                <option value={n} key={n}>
                  {n}%
                </option>
              ))}
          </select>
          <button
            aria-label="Zoom in"
            disabled={disabled || s.zoom >= 500}
            onClick={() => controller?.zoom((s.zoom / 100) * 1.15)}
          >
            <Plus size={16} />
          </button>
          <button
            aria-label="Fit width"
            title="Fit width"
            disabled={disabled}
            onClick={() => controller?.zoom("page-width")}
          >
            <MoveHorizontal size={18} />
          </button>
          <button
            aria-label="Fit page"
            title="Fit page (⌘0)"
            disabled={disabled}
            onClick={() => controller?.zoom("page-fit")}
          >
            <Scan size={18} />
          </button>
        </div>
        <div className="toolbar-space" />
        <div className="toolbar-group">
          <select
            aria-label="Page layout"
            disabled={disabled}
            value={s.layout}
            onChange={(e) => controller?.setLayout(e.target.value as Layout)}
          >
            <option value="continuous">Continuous</option>
            <option value="single">Single page</option>
            <option value="spread">Two pages</option>
          </select>
          <button
            aria-label="Find in PDF"
            title="Find (⌘F)"
            disabled={disabled}
            onClick={() => s.set({ sidebar: "search" })}
          >
            <Search size={18} />
          </button>
          <button
            aria-label="Close document"
            disabled={disabled}
            onClick={home}
          >
            <Home size={17} />
          </button>
        </div>
      </div>
      )}
    </>
  );
}
export function Statusbar({
  controller,
}: {
  controller: ViewerController | null;
}) {
  const s = useWorkspace();
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <footer className="statusbar">
      <span className={`status-light ${s.busy ? "working" : ""}`} />
      <span role="status">
        {s.status}
      </span>
      <div className="statusbar-space" />
      {s.document && (
        <>
          {s.info?.encrypted && (
            <span
              className="statusbar-item"
              title="Document is encrypted"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Lock size={13} /> Protected
            </span>
          )}
          {s.hasDigitalSignature && (
            <span
              className="statusbar-item"
              title="Document contains a digital signature"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <ShieldCheck size={13} /> Signed
            </span>
          )}
          {s.document.size > 0 && (
            <span className="statusbar-item" title={`File size: ${s.document.size} bytes`}>
              {formatSize(s.document.size)}
            </span>
          )}
          <span className="status-separator" />
          <button
            aria-label="Previous page"
            disabled={s.page === 1 || s.busy}
            onClick={() => controller?.goTo(s.page - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <label>
            Page
            <input
              key={s.page}
              aria-label="Page number"
              type="number"
              min={1}
              max={s.info?.pages}
              defaultValue={s.page}
              onBlur={(e) => controller?.goTo(Number(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  controller?.goTo(Number(e.currentTarget.value) || 1);
              }}
            />
            <span>of {s.info?.pages}</span>
          </label>
          <button
            aria-label="Next page"
            disabled={s.page === s.info?.pages || s.busy}
            onClick={() => controller?.goTo(s.page + 1)}
          >
            <ChevronRight size={15} />
          </button>
          <span className="status-separator" />
        </>
      )}
      <span>Network access off</span>
    </footer>
  );
}

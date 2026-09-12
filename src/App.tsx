import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Highlighter,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquare,
  Minus,
  Monitor,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  ScanLine,
  Signature,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { call, parsePages, readFile, saveFile } from "./api";
import { Canvas, Thumbnail } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Modal } from "./components/Modal";
import type {
  Command,
  Details,
  DocInfo,
  Panel,
  SearchHit,
  Selection,
  Tool,
} from "./types";
const toolbar = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "replaceText", label: "Edit text", icon: Type },
  { id: "text", label: "Add text", icon: Type },
  { id: "highlight", label: "Highlight", icon: Highlighter },
  { id: "comment", label: "Comment", icon: MessageSquare },
  { id: "draw", label: "Draw", icon: PenLine },
  { id: "image", label: "Image", icon: ImagePlus },
  { id: "signature", label: "Signature", icon: Signature },
  { id: "redact", label: "Redact", icon: ScanLine },
] as const;
const emptyDetails: Details = { spans: [], widgets: [], annotations: [] };
export default function App() {
  const [doc, setDoc] = useState<DocInfo | null>(null),
    [page, setPageState] = useState(0),
    [zoom, setZoom] = useState(100),
    [tool, setToolState] = useState<Tool>("select"),
    [panel, setPanelState] = useState<Panel>("tools");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("Ready"),
    [error, setError] = useState(""),
    [details, setDetails] = useState<Details>(emptyDetails),
    [selection, setSelection] = useState<Selection | null>(null),
    [hits, setHits] = useState<SearchHit[]>([]);
  const [color, setColor] = useState("#24634c"),
    [size, setSize] = useState(14),
    [width, setWidth] = useState(2),
    [imageData, setImageData] = useState(""),
    [password, setPassword] = useState(""),
    [exportOpen, setExportOpen] = useState(false),
    [range, setRange] = useState(""),
    [exportMode, setExportMode] = useState("all");
  const [savedRevision, setSavedRevision] = useState(0),
    [unlock, setUnlock] = useState<{
      data: string;
      name: string;
      op: string;
    } | null>(null),
    [unlockPassword, setUnlockPassword] = useState(""),
    [replaceFile, setReplaceFile] = useState<File | null>(null),
    [sideOpen, setSideOpen] = useState(false);
  const openInput = useRef<HTMLInputElement>(null),
    mergeInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    locked = useRef(false);
  const reportError = useCallback((value: string) => setError(value), []);
  const dirty = !!doc && doc.dirty && doc.revision !== savedRevision;
  useEffect(() => {
    call<DocInfo>({ op: "info" })
      .then(setDoc)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    window.navpdf?.dirty(dirty);
    function warn(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setDetails(emptyDetails);
    call<Details>({ op: "details", page })
      .then((d) => {
        if (alive) setDetails(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [page, doc?.revision]);
  const setPage = (n: number) => {
    setPageState(n);
    setSelection(null);
  };
  const setTool = (t: Tool) => {
    setToolState(t);
    setSelection(null);
    if (t === "highlight") setColor("#f4cf55");
    else if (tool === "highlight") setColor("#24634c");
  };
  const setPanel = (p: Panel) => {
    setPanelState(p);
    setTool("select");
    if (p !== "search") setHits([]);
  };
  async function run(
    command: Command,
    success = "Changes applied",
  ): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await call<DocInfo>(command);
      setDoc(result);
      setPageState((p) => Math.min(p, result.count - 1));
      setSelection(null);
      setMessage(success);
      if (command.op === "open") {
        setPageState(0);
        setPassword("");
        setHits([]);
        setSavedRevision(result.revision);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function loadFile(file: File, op = "open") {
    if (locked.current) return;
    setReplaceFile(null);
    setBusy(true);
    locked.current = true;
    setError("");
    try {
      const data = await readFile(file);
      const result = await call<DocInfo>({ op, data, name: file.name });
      setDoc(result);
      setSelection(null);
      setMessage(op === "merge" ? "PDF merged" : "PDF opened");
      setHits([]);
      if (op === "open") {
        setPageState(0);
        setPassword("");
        setSavedRevision(result.revision);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to open PDF.";
      if (msg.includes("PASSWORD_REQUIRED")) {
        setUnlock({ op, data: await readFile(file), name: file.name });
        setUnlockPassword("");
      } else setError(msg);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function doExport() {
    if (!doc || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const pages =
        exportMode === "all" ? undefined : parsePages(range, doc.count);
      const payload = await call<{ data: string; name: string }>({
        op: "export",
        pages,
        password,
      });
      if (await saveFile(payload)) {
        setMessage(pages ? "Selected pages exported" : "PDF exported");
        if (!pages) setSavedRevision(doc.revision);
        setExportOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "o") {
          e.preventDefault();
          openInput.current?.click();
        }
        if (e.key === "s") {
          e.preventDefault();
          setExportMode("all");
          setExportOpen(true);
        }
        if (e.key === "z") {
          e.preventDefault();
          void run(
            { op: e.shiftKey ? "redo" : "undo" },
            e.shiftKey ? "Redone" : "Undone",
          );
        }
        if (e.key === "f") {
          e.preventDefault();
          setPanel("search");
        }
      }
      if (e.key === "Escape") {
        setSelection(null);
        setToolState("select");
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function select(s: Selection) {
    setSelection(s);
    if (s.size) setSize(s.size);
    if (s.color) setColor(s.color);
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <FileText size={26} />
          <span>NavPDF</span>
        </div>
        <div className="document-tab">
          <span>{doc?.name || "Local workspace"}</span>
          {dirty && (
            <span className="unsaved-dot" title="Changes not exported" />
          )}
        </div>
        <div className="header-spacer" />
        <div className="local-indicator">
          <Monitor size={16} /> Local workspace
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => openInput.current?.click()}
        >
          <FolderOpen size={17} />
          <span>Open PDF</span>
        </button>
        <button
          className="button primary"
          disabled={!doc || busy}
          onClick={() => {
            setExportMode("all");
            setExportOpen(true);
          }}
        >
          <Download size={17} />
          <span>Export PDF</span>
        </button>
      </header>
      <nav className="toolbar" aria-label="Editing tools">
        <button
          className="icon-button mobile-pages"
          aria-label="Toggle pages"
          onClick={() => setSideOpen(!sideOpen)}
        >
          <Menu size={19} />
        </button>
        <div className="tool-list">
          {toolbar.map((t) => (
            <button
              key={t.id}
              className={`tool-button ${tool === t.id ? "active" : ""}`}
              disabled={!doc || busy}
              aria-pressed={tool === t.id}
              title={t.label}
              onClick={() => setTool(t.id)}
            >
              <t.icon size={19} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="history-controls">
          <button
            className="tool-button"
            disabled={!doc?.undo || busy}
            aria-label="Undo"
            title="Undo (⌘Z)"
            onClick={() => run({ op: "undo" }, "Undone")}
          >
            <Undo2 size={19} />
            <span>Undo</span>
          </button>
          <button
            className="tool-button"
            disabled={!doc?.redo || busy}
            aria-label="Redo"
            title="Redo (⌘⇧Z)"
            onClick={() => run({ op: "redo" }, "Redone")}
          >
            <Redo2 size={19} />
            <span>Redo</span>
          </button>
        </div>
      </nav>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {doc ? (
        <main className={`workspace ${sideOpen ? "show-pages" : ""}`}>
          <aside className="pages-sidebar">
            <div className="sidebar-heading">
              <h2>Pages</h2>
              <span>{doc.count}</span>
            </div>
            <div className="thumbnails">
              {doc.pages.map((_, i) => (
                <Thumbnail
                  key={i}
                  page={i}
                  revision={doc.revision}
                  selected={i === page}
                  onClick={() => {
                    if (!busy) {
                      setPage(i);
                      setSideOpen(false);
                    }
                  }}
                />
              ))}
            </div>
            <div className="page-actions">
              <button
                disabled={busy}
                onClick={() =>
                  run({ op: "addPage", after: page }, "Blank page added")
                }
              >
                <Plus size={18} /> Add page
              </button>
              <button
                disabled={busy}
                onClick={() => mergeInput.current?.click()}
              >
                <FilesIcon /> Merge PDF
              </button>
            </div>
          </aside>
          <section
            className="document-workspace"
            aria-label="Document workspace"
          >
            <Canvas
              doc={doc}
              page={page}
              zoom={zoom}
              tool={tool}
              busy={busy}
              details={details}
              hits={hits}
              selection={selection}
              onSelect={select}
              onStroke={(points) => {
                void run(
                  { op: tool, page, points, color, width },
                  tool === "signature"
                    ? "Signature stroke added"
                    : "Drawing added",
                );
              }}
              onError={reportError}
            />
            <div className="view-controls">
              <button
                className="icon-button"
                aria-label="Zoom out"
                disabled={zoom <= 25}
                onClick={() => setZoom(Math.max(25, zoom - 10))}
              >
                <Minus size={16} />
              </button>
              <select
                aria-label="Zoom level"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                {[...new Set([25, 50, 75, 90, 100, 125, 150, 200, zoom])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
              </select>
              <button
                className="icon-button"
                aria-label="Zoom in"
                disabled={zoom >= 200}
                onClick={() => setZoom(Math.min(200, zoom + 10))}
              >
                <Plus size={16} />
              </button>
              <span className="control-divider" />
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={page === 0 || busy}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <span className="page-counter">
                {page + 1} <span>/ {doc.count}</span>
              </span>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={page === doc.count - 1 || busy}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={17} />
              </button>
              <button
                className="fit-button"
                onClick={() => {
                  const area = document.querySelector(".canvas-scroll");
                  if (area)
                    setZoom(
                      Math.max(
                        25,
                        Math.min(
                          200,
                          Math.floor(
                            Math.min(
                              (area.clientWidth - 56) / doc.pages[page].width,
                              (area.clientHeight - 40) / doc.pages[page].height,
                            ) * 100,
                          ),
                        ),
                      ),
                    );
                }}
              >
                Fit
              </button>
            </div>
          </section>
          <Inspector
            doc={doc}
            page={page}
            panel={panel}
            setPanel={setPanel}
            tool={tool}
            setTool={setTool}
            selection={selection}
            clearSelection={() => setSelection(null)}
            details={details}
            run={run}
            busy={busy}
            setPage={setPage}
            setHits={setHits}
            exportPages={() => {
              setExportMode("range");
              setRange(String(page + 1));
              setExportOpen(true);
            }}
            password={password}
            setPassword={setPassword}
            color={color}
            setColor={setColor}
            size={size}
            setSize={setSize}
            width={width}
            setWidth={setWidth}
            error={reportError}
            imageData={imageData}
            chooseImage={() => imageInput.current?.click()}
          />
        </main>
      ) : (
        <main className="loading-workspace">
          <LoaderCircle className="spinner" size={30} />
          <h1>Opening your local workspace</h1>
          <p>
            {error
              ? "Run npm run setup, then restart the app."
              : "Getting your PDF tools ready..."}
          </p>
        </main>
      )}
      <footer className="statusbar">
        <span role="status">
          {busy ? (
            <LoaderCircle size={13} className="spinner" />
          ) : (
            <span className="status-dot" />
          )}
          {busy ? "Processing locally..." : message}
          {dirty && !busy && (
            <span className="muted"> · Unexported changes</span>
          )}
        </span>
        <span>
          <LockKeyhole size={13} /> All changes stay local
        </span>
      </footer>
      <input
        hidden
        ref={openInput}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Open PDF file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            if (dirty) setReplaceFile(f);
            else void loadFile(f);
          }
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={mergeInput}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Merge PDF file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f, "merge");
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Choose image file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            try {
              setImageData(await readFile(f));
            } catch (err) {
              setError((err as Error).message);
            }
        }}
      />
      {exportOpen && doc && (
        <Modal
          title="Export your PDF"
          onClose={() => {
            if (!busy) setExportOpen(false);
          }}
        >
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              void doExport();
            }}
          >
            <p className="description">
              Save an edited copy. Your original file is unchanged.
            </p>
            <label>
              Pages
              <select
                value={exportMode}
                onChange={(e) => setExportMode(e.target.value)}
              >
                <option value="all">All {doc.count} pages</option>
                <option value="range">Selected pages / split</option>
              </select>
            </label>
            {exportMode === "range" && (
              <label>
                Page numbers
                <input
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="1, 3-5"
                  required
                />
              </label>
            )}
            <label>
              Opening password (optional)
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Export without password"
              />
            </label>
            {doc.sensitive && (
              <p className="notice">
                Content removal applied. Export clears metadata, attachments,
                hidden text, links and comments. Inspect the saved PDF before
                sharing.
              </p>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setExportOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={16} className="spinner" />
                ) : (
                  <Download size={16} />
                )}{" "}
                Export PDF
              </button>
            </div>
          </form>
        </Modal>
      )}
      {unlock && (
        <Modal
          title="Unlock PDF"
          onClose={() => {
            if (!busy) setUnlock(null);
          }}
        >
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  { ...unlock, password: unlockPassword },
                  "PDF unlocked",
                )
              ) {
                setUnlock(null);
                setUnlockPassword("");
              }
            }}
          >
            <p className="description">{unlock.name} requires a password.</p>
            <label>
              Password
              <input
                type="password"
                autoFocus
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              Unlock PDF
            </button>
          </form>
        </Modal>
      )}
      {replaceFile && (
        <Modal
          title="Open another document?"
          onClose={() => setReplaceFile(null)}
        >
          <div className="modal-body">
            <p>
              You have changes that have not been exported. Opening another PDF
              will discard them.
            </p>
            <div className="modal-actions">
              <button className="button" onClick={() => setReplaceFile(null)}>
                Keep editing
              </button>
              <button
                className="button danger"
                onClick={() => loadFile(replaceFile)}
              >
                Discard and open
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function FilesIcon() {
  return <FileText size={18} />;
}

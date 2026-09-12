import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Crop,
  Files,
  FormInput,
  Info,
  LockKeyhole,
  MessageSquare,
  RotateCw,
  ScanText,
  Search,
  ShieldCheck,
  Trash2,
  Download,
} from "lucide-react";
import { call } from "../api";
import type {
  Command,
  Details,
  DocInfo,
  Panel,
  SearchHit,
  Selection,
  Tool,
} from "../types";
interface Props {
  doc: DocInfo;
  page: number;
  panel: Panel;
  setPanel: (p: Panel) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection | null;
  clearSelection: () => void;
  details: Details;
  run: (c: Command, message?: string) => Promise<boolean>;
  busy: boolean;
  setPage: (n: number) => void;
  setHits: (h: SearchHit[]) => void;
  exportPages: () => void;
  password: string;
  setPassword: (s: string) => void;
  color: string;
  setColor: (s: string) => void;
  size: number;
  setSize: (s: number) => void;
  width: number;
  setWidth: (s: number) => void;
  error: (s: string) => void;
  imageData: string;
  chooseImage: () => void;
}
const tools = [
  {
    id: "organize",
    label: "Organize pages",
    description: "Reorder, rotate, delete or extract pages",
    icon: Files,
  },
  {
    id: "forms",
    label: "Fill forms",
    description: "Fill and save PDF form fields",
    icon: FormInput,
  },
  {
    id: "search",
    label: "Search document",
    description: "Find text across your document",
    icon: Search,
  },
  {
    id: "ocr",
    label: "OCR text recognition",
    description: "Make scanned pages searchable",
    icon: ScanText,
  },
  {
    id: "password",
    label: "Password protection",
    description: "Protect your exported PDF",
    icon: LockKeyhole,
  },
  {
    id: "metadata",
    label: "Document properties",
    description: "View and edit document details",
    icon: Info,
  },
  {
    id: "annotations",
    label: "Comments & annotations",
    description: "Review notes, highlights and drawings",
    icon: MessageSquare,
  },
] as const;
const labels: Record<Tool, string> = {
  select: "Select",
  replaceText: "Edit text",
  text: "Add text",
  highlight: "Highlight",
  comment: "Add comment",
  draw: "Draw",
  image: "Add image",
  signature: "Draw signature",
  redact: "Redact",
  crop: "Crop page",
};
const hints: Record<Tool, string> = {
  select: "Select document text to copy it.",
  replaceText: "Click a text line on the page to replace it.",
  text: "Drag an area on the page, then enter your text.",
  highlight: "Drag across text to highlight it.",
  comment: "Click the page to place a comment.",
  draw: "Draw directly on the page. Each stroke is saved.",
  image: "Choose an image, then drag its area on the page.",
  signature: "Sign directly on the page using your mouse or trackpad.",
  redact: "Drag over content to remove from the exported PDF.",
  crop: "Drag the area of the page you want to keep.",
};
export function Inspector(p: Props) {
  const [text, setText] = useState("");
  const [font, setFont] = useState("helv");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [metadata, setMetadata] = useState(p.doc.metadata);
  useEffect(() => {
    setText(p.selection?.text || "");
    setFont(p.selection?.font || "helv");
  }, [p.selection]);
  useEffect(() => {
    setMetadata(p.doc.metadata);
  }, [p.doc.metadata]);
  useEffect(() => {
    let alive = true;
    if (p.panel !== "search") return;
    const timer = setTimeout(() => {
      setSearching(true);
      call<SearchHit[]>({ op: "search", query })
        .then((r) => {
          if (alive) {
            setResults(r);
            p.setHits(r);
          }
        })
        .catch((e) => {
          if (alive) p.error(e.message);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, p.panel, p.doc.revision, p.setHits, p.error]);
  const editing = p.tool !== "select";
  async function apply() {
    if (!p.selection) return;
    const command: Command = {
      op: p.tool,
      page: p.page,
      rect: p.selection.rect,
      origin: p.selection.origin,
      text,
      size: p.size,
      font,
      color: p.color,
    };
    if (p.tool === "comment") command.point = p.selection.rect.slice(0, 2);
    if (p.tool === "image") command.data = p.imageData;
    if (await p.run(command, `${labels[p.tool]} applied`)) p.clearSelection();
  }
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        {(p.panel !== "tools" || editing) && (
          <button
            className="icon-button"
            aria-label="Back to document tools"
            onClick={() => {
              p.setPanel("tools");
              p.setTool("select");
              p.clearSelection();
            }}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h2>
          {editing
            ? labels[p.tool]
            : p.panel === "tools"
              ? "Document tools"
              : tools.find((t) => t.id === p.panel)?.label}
        </h2>
      </div>
      <div className="inspector-content">
        {editing ? (
          <div className="tool-settings">
            <p className="description">{hints[p.tool]}</p>
            {["text", "replaceText", "comment"].includes(p.tool) && (
              <>
                <label>
                  {p.tool === "replaceText" ? "Replacement text" : "Text"}
                  <textarea
                    aria-label="Text content"
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      p.selection ? "Type here..." : "Select an area first"
                    }
                  />
                </label>
                {p.tool !== "comment" && (
                  <>
                    <label>
                      Font
                      <select
                        value={font}
                        onChange={(e) => setFont(e.target.value)}
                      >
                        <option value="helv">Helvetica</option>
                        <option value="hebo">Helvetica Bold</option>
                        <option value="heit">Helvetica Italic</option>
                        <option value="tiro">Times Roman</option>
                        <option value="tibo">Times Bold</option>
                        <option value="cour">Courier</option>
                      </select>
                    </label>
                    <label>
                      Font size
                      <input
                        type="number"
                        min="5"
                        max="144"
                        value={p.size}
                        onChange={(e) => p.setSize(Number(e.target.value))}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {["text", "replaceText", "highlight", "draw", "signature"].includes(
              p.tool,
            ) && (
              <label className="color-field">
                {p.tool === "highlight" ? "Highlight color" : "Ink color"}
                <input
                  aria-label="Ink color"
                  type="color"
                  value={p.color}
                  onChange={(e) => p.setColor(e.target.value)}
                />
              </label>
            )}
            {["draw", "signature"].includes(p.tool) && (
              <label>
                Stroke width
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={p.width}
                  onChange={(e) => p.setWidth(Number(e.target.value))}
                />
                <span className="muted">{p.width} pt</span>
              </label>
            )}
            {p.tool === "image" && (
              <>
                <button className="button" onClick={p.chooseImage}>
                  {p.imageData ? "Change image" : "Choose image"}
                </button>
                {p.imageData && (
                  <img
                    className="image-preview"
                    src={`data:image/png;base64,${p.imageData}`}
                    alt="Image to insert"
                  />
                )}
              </>
            )}
            {p.tool === "replaceText" && (
              <p className="notice">
                Replaces text within this area using the chosen standard font.
                Reduce the size if it does not fit. Complex layouts and
                non-Latin scripts are limited.
              </p>
            )}
            {p.tool === "signature" && (
              <p className="notice">
                A drawn signature is a visual mark. It is not a digital
                certificate signature.
              </p>
            )}
            {p.tool === "redact" && (
              <p className="notice warning">
                Redaction removes intersecting text, image pixels and graphics.
                Export also clears metadata, attachments, links, hidden text and
                comments. Review the exported copy before sharing.
              </p>
            )}
            {p.tool === "crop" && (
              <p className="notice">
                Cropping changes the visible page area. It does not securely
                remove hidden content.
              </p>
            )}
            {!["draw", "signature"].includes(p.tool) && (
              <>
                <div className="selection-status">
                  {p.selection ? (
                    <>
                      <Check size={15} /> Area selected
                    </>
                  ) : (
                    "No area selected"
                  )}
                </div>
                <button
                  className={`button ${p.tool === "redact" ? "danger" : "primary"}`}
                  disabled={
                    p.busy ||
                    !p.selection ||
                    (["text", "replaceText", "comment"].includes(p.tool) &&
                      !text.trim()) ||
                    (p.tool === "image" && !p.imageData)
                  }
                  onClick={apply}
                >
                  {p.tool === "redact"
                    ? "Remove selected content"
                    : `Apply ${labels[p.tool].toLowerCase()}`}
                </button>
                {p.selection && (
                  <button className="button quiet" onClick={p.clearSelection}>
                    Cancel selection
                  </button>
                )}
              </>
            )}
          </div>
        ) : p.panel === "tools" ? (
          <div className="document-tools">
            {tools.map((t) => (
              <button key={t.id} onClick={() => p.setPanel(t.id)}>
                <t.icon size={23} />
                <span>
                  <strong>{t.label}</strong>
                  <small>{t.description}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        ) : p.panel === "organize" ? (
          <div className="tool-settings">
            <p className="description">
              Page {p.page + 1} of {p.doc.count}. Select a thumbnail to work
              with another page.
            </p>
            <div className="action-grid">
              <button
                className="button"
                disabled={p.busy}
                onClick={() =>
                  p.run({ op: "rotate", page: p.page }, "Page rotated")
                }
              >
                <RotateCw size={17} /> Rotate
              </button>
              <button className="button" onClick={() => p.setTool("crop")}>
                <Crop size={17} /> Crop
              </button>
              <button
                className="button"
                disabled={p.busy || p.page === 0}
                onClick={async () => {
                  const order = Array.from(
                    { length: p.doc.count },
                    (_, i) => i,
                  );
                  [order[p.page - 1], order[p.page]] = [
                    order[p.page],
                    order[p.page - 1],
                  ];
                  if (await p.run({ op: "reorder", order }, "Page moved"))
                    p.setPage(p.page - 1);
                }}
              >
                <ArrowUp size={17} /> Move up
              </button>
              <button
                className="button"
                disabled={p.busy || p.page === p.doc.count - 1}
                onClick={async () => {
                  const order = Array.from(
                    { length: p.doc.count },
                    (_, i) => i,
                  );
                  [order[p.page + 1], order[p.page]] = [
                    order[p.page],
                    order[p.page + 1],
                  ];
                  if (await p.run({ op: "reorder", order }, "Page moved"))
                    p.setPage(p.page + 1);
                }}
              >
                <ArrowDown size={17} /> Move down
              </button>
            </div>
            <button className="button" onClick={p.exportPages}>
              <Download size={17} /> Extract / split pages
            </button>
            <button
              className="button danger-outline"
              disabled={p.busy || p.doc.count === 1}
              onClick={() =>
                p.run(
                  { op: "deletePage", page: p.page },
                  "Page deleted. Undo is available.",
                )
              }
            >
              <Trash2 size={17} /> Delete current page
            </button>
            <p className="notice">
              Page changes stay in this workspace until you export a copy. Undo
              is available for the last 20 changes, within the memory limit.
            </p>
          </div>
        ) : p.panel === "search" ? (
          <div className="tool-settings">
            <label>
              Search all pages
              <input
                autoFocus
                type="search"
                placeholder="Find text..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <p className="muted">
              {searching
                ? "Searching..."
                : `${results.length} result${results.length === 1 ? "" : "s"}${results.length === 1000 ? " (first 1,000)" : ""}`}
            </p>
            <div className="search-results">
              {results.map((r, i) => (
                <button key={i} onClick={() => p.setPage(r.page)}>
                  <Search size={15} />
                  <span>
                    Page {r.page + 1}
                    <small>Match {i + 1}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            {query && !results.length && !searching && (
              <p className="notice">
                No matching text. If this is a scan, run OCR first.
              </p>
            )}
          </div>
        ) : p.panel === "forms" ? (
          <div className="tool-settings">
            <p className="description">Form fields on page {p.page + 1}</p>
            {p.details.widgets.length ? (
              p.details.widgets.map((w) => (
                <FormField
                  key={`${p.doc.revision}-${w.id}`}
                  widget={w}
                  busy={p.busy}
                  onSave={(value) =>
                    p.run(
                      { op: "form", page: p.page, id: w.id, value },
                      "Form field saved",
                    )
                  }
                />
              ))
            ) : (
              <div className="empty-panel">
                <FormInput size={32} />
                <h3>No form fields here</h3>
                <p>
                  Try another page, or use Add text to fill a flat document.
                </p>
                <button className="button" onClick={() => p.setTool("text")}>
                  Add text
                </button>
              </div>
            )}
          </div>
        ) : p.panel === "ocr" ? (
          <div className="tool-settings">
            <div className="feature-icon">
              <ScanText size={30} />
            </div>
            <h3>Give scans searchable text.</h3>
            <p className="description">
              Recognize English text on page {p.page + 1}. Processing runs
              entirely on your device.
            </p>
            <p className="notice">
              This replaces the current page with a 200 DPI image and a
              searchable text layer. Forms and annotations on this page become
              part of the image. Undo is available.
            </p>
            <button
              className="button primary"
              disabled={p.busy || !p.doc.ocr}
              onClick={() =>
                p.run(
                  { op: "ocr", page: p.page },
                  "OCR complete. This page is searchable.",
                )
              }
            >
              Recognize this page
            </button>
            {!p.doc.ocr && (
              <p role="alert">OCR data is missing. Run npm run setup.</p>
            )}
          </div>
        ) : p.panel === "password" ? (
          <div className="tool-settings">
            <div className="feature-icon">
              <LockKeyhole size={28} />
            </div>
            <h3>Protect your exported copy.</h3>
            <p className="description">
              Set an opening password with AES-256 encryption.
            </p>
            <label>
              Export password
              <input
                type="password"
                autoComplete="new-password"
                value={p.password}
                onChange={(e) => p.setPassword(e.target.value)}
                placeholder="No password"
              />
            </label>
            <p className="notice">
              This password applies when you export. Leave it blank to export an
              unencrypted copy. Keep your password somewhere safe.
            </p>
          </div>
        ) : p.panel === "metadata" ? (
          <form
            className="tool-settings"
            onSubmit={(e) => {
              e.preventDefault();
              p.run({ op: "metadata", metadata }, "Document properties saved");
            }}
          >
            {["title", "author", "subject", "keywords", "creator"].map(
              (key) => (
                <label key={key} className="capitalize">
                  {key}
                  <input
                    value={metadata[key] || ""}
                    onChange={(e) =>
                      setMetadata({ ...metadata, [key]: e.target.value })
                    }
                  />
                </label>
              ),
            )}
            <p className="muted">
              {Math.round(p.doc.pages[p.page].width)} ×{" "}
              {Math.round(p.doc.pages[p.page].height)} pt ·{" "}
              {p.doc.pages[p.page].rotation}°
            </p>
            <button className="button primary" disabled={p.busy}>
              Save properties
            </button>
            {p.doc.sensitive && (
              <p className="notice">
                Metadata is cleared on export after redaction or text
                replacement.
              </p>
            )}
          </form>
        ) : (
          <div className="tool-settings">
            {p.details.annotations.length ? (
              p.details.annotations.map((a) => (
                <div className="annotation" key={a.id}>
                  <strong>{a.type}</strong>
                  <p>{a.text || "Visual annotation"}</p>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${a.type}`}
                    disabled={p.busy}
                    onClick={() =>
                      p.run(
                        { op: "deleteAnnotation", page: p.page, id: a.id },
                        "Annotation removed",
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-panel">
                <MessageSquare size={30} />
                <h3>No annotations yet</h3>
                <p>Add a note, draw or highlight on this page.</p>
              </div>
            )}
            <button className="button" onClick={() => p.setTool("comment")}>
              Add comment
            </button>
          </div>
        )}
      </div>
      <div className="privacy-note">
        <ShieldCheck size={23} />
        <div>
          <strong>All files stay on this device</strong>
          <p>No uploads. No accounts. Your workspace, in your hands.</p>
        </div>
      </div>
    </aside>
  );
}
function FormField({
  widget: w,
  busy,
  onSave,
}: {
  widget: Details["widgets"][number];
  busy: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(String(w.value ?? ""));
  if (w.type === "Signature")
    return (
      <p className="notice">{w.name}: certificate signing is not supported.</p>
    );
  if (
    !["Text", "CheckBox", "ComboBox", "ListBox", "RadioButton"].includes(w.type)
  )
    return (
      <p className="notice">
        {w.name}: {w.type} fields are not supported.
      </p>
    );
  return (
    <form
      className="form-field"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label>
        {w.name}
        {w.type === "CheckBox" || w.type === "RadioButton" ? (
          <input
            type="checkbox"
            checked={value !== "Off" && value !== ""}
            disabled={w.readonly}
            onChange={(e) => setValue(e.target.checked ? w.on : "Off")}
          />
        ) : w.choices?.length ? (
          <select
            value={value}
            disabled={w.readonly}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Choose...</option>
            {w.choices.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input
            value={value}
            disabled={w.readonly}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </label>
      <button className="button" disabled={busy || w.readonly}>
        Save field
      </button>
    </form>
  );
}

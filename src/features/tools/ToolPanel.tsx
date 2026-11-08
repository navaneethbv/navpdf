import { useState } from "react";
import { Pin, PinOff, Search, X } from "lucide-react";
import { savePinned, togglePinned } from "./pinned-tools";
import { useWorkspace } from "../../stores/workspace";
import type { ToolMode } from "../../types/document";
import { documentTools } from "./tool-catalog";

export function ToolPanel({ mode, onClose }: Readonly<{ mode: ToolMode; onClose: () => void }>) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const s = useWorkspace();
  const tools = documentTools(s);
  const pinned = s.local.preferences.pinnedTools ?? [];
  const togglePin = (id: string) => {
    try {
      void savePinned(togglePinned(pinned, id)).catch((error: unknown) =>
        s.set({ error: String(error) }),
      );
    } catch (error) {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  const preferred = [
    "edit-existing",
    "export-pdf",
    "fill-and-sign",
    "create-blank",
    "combine-files",
    "organize-pages",
    "ocr-text",
    "protect-pdf",
    "redact-pdf",
    "compress-pdf",
    "form-fields",
    "drawing-markup",
    "import-pdf",
    "certificate-sign",
  ];
  const ordered =
    mode === "all"
      ? [...tools].sort((a, b) => {
          // Pinned tools come first, in the order they were pinned.
          const rank = (id: string) => {
            const pin = pinned.indexOf(id);
            if (pin >= 0) return pin - pinned.length;
            const index = preferred.indexOf(id);
            return index < 0 ? preferred.length : index;
          };
          return rank(a.id) - rank(b.id);
        })
      : tools;
  const filtered = ordered.filter((t) => {
    if (mode === "edit" && !["edit", "pages"].includes(t.category)) return false;
    if (mode === "convert" && t.category !== "convert") return false;
    if (mode === "esign" && t.category !== "forms") return false;
    if (mode === "create" && !["create-blank", "combine-files", "create-text"].includes(t.id))
      return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
  });

  const title = getToolPanelTitle(mode);

  return (
    <section className="tool-drawer" aria-label={title}>
      <div className="tool-drawer-header">
        <div className="tool-drawer-title">
          <h3>{title}</h3>
          <span className="tool-count">{filtered.length} tools</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close tools panel">
          <X size={18} />
        </button>
      </div>

      {mode === "all" && (
        <div className="tool-search-box">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search all tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tools"
          />
        </div>
      )}

      <div className="tool-grid">
        {(mode === "all" && !search && !expanded ? filtered.slice(0, 12) : filtered).map((tool) => {
          const isPinned = pinned.includes(tool.id);
          return (
            <div key={tool.id} className="tool-card-wrap">
              <button
                className={`tool-card category-${tool.category} ${tool.disabled ? "disabled" : ""}`}
                title={tool.description}
                disabled={s.busy || tool.disabled}
                onClick={() => {
                  tool.action();
                  if (mode !== "all") onClose();
                }}
              >
                <div className="tool-card-icon">
                  <tool.icon size={20} />
                </div>
                <div className="tool-card-text">
                  <span className="tool-card-label">{tool.label}</span>
                </div>
              </button>
              <button
                type="button"
                className={`tool-pin ${isPinned ? "pinned" : ""}`}
                aria-label={`${isPinned ? "Unpin" : "Pin"} ${tool.label} ${isPinned ? "from" : "to"} the toolbar`}
                aria-pressed={isPinned}
                title={isPinned ? "Unpin from the toolbar" : "Pin to the toolbar"}
                onClick={() => togglePin(tool.id)}
              >
                {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
            </div>
          );
        })}
      </div>
      {mode === "all" && !search && (
        <button
          className="tool-view-more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? "View less" : "View more"}
        </button>
      )}
    </section>
  );
}

function getToolPanelTitle(mode: ToolMode): string {
  switch (mode) {
    case "all":
      return "All Tools";
    case "edit":
      return "Edit PDF";
    case "convert":
      return "Convert & Export";
    case "esign":
      return "Fill & Sign";
    default:
      return "Create PDF";
  }
}

import { useEffect, useRef } from "react";
import {
  Bookmark as BookmarkIcon,
  Files,
  Layers,
  MessageSquare,
  Search,
  Download,
  Upload,
  X,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { Thumbnails } from "./Thumbnails";
import { SearchPanel } from "../search/SearchPanel";
import type { ViewerController } from "./controller";
import { BookmarkPanel } from "./BookmarkPanel";
import { CommentPanel } from "./CommentPanel";
import { downloadBlob, safeFileName } from "../../utils/download";
const tabs = [
  { id: "pages", label: "Pages", icon: Files },
  { id: "bookmarks", label: "Bookmarks", icon: BookmarkIcon },
  { id: "search", label: "Search", icon: Search },
  { id: "comments", label: "Comments", icon: MessageSquare },
  { id: "layers", label: "Layers", icon: Layers },
] as const;
export function Sidebar({ controller }: Readonly<{ controller: ViewerController }>) {
  const tab = useWorkspace((s) => s.sidebar),
    documentId = useWorkspace((s) => s.document?.id),
    bookmarks = useWorkspace((s) => s.bookmarks),
    comments = useWorkspace((s) => s.comments),
    selectedId = useWorkspace((s) => s.selectedAnnotationId),
    layers = useWorkspace((s) => s.layers),
    set = useWorkspace((s) => s.set);
  const importInput = useRef<HTMLInputElement>(null);
  const exportComments = async () => {
    try {
      const source = controller.exportComments();
      const name = useWorkspace.getState().document?.name || "document.pdf";
      const saved = await downloadBlob(
        new Blob([source], { type: "application/json" }),
        safeFileName(`${name.replace(/\.pdf$/i, "")}-comments.json`),
      );
      if (saved) set({ status: "Comments exported" });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  useEffect(() => {
    if (tab === "comments")
      void controller
        .readComments()
        .catch(() => set({ error: "Comments could not be read from this PDF." }));
    if (tab !== "search") controller.closeSearch();
  }, [controller, tab, set]);
  const renderPanel = () => {
    if (tab === "pages") return <Thumbnails controller={controller} />;
    if (tab === "search") return <SearchPanel controller={controller} />;
    if (tab === "layers")
      return (
        <div className="sidebar-scroll">
          {layers.length ? (
            <ul className="layer-list">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(event) => {
                        void controller
                          .setLayerVisibility(layer.id, event.target.checked)
                          .catch(() => {
                            set({ error: "This layer could not be changed." });
                          });
                      }}
                    />{" "}
                    {layer.name}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-message">This PDF has no layers.</p>
          )}
          <p className="empty-message">
            Layer visibility changes this view only, not the saved PDF.
          </p>
        </div>
      );
    if (tab === "bookmarks")
      return (
        <div className="sidebar-scroll">
          <button
            className="button-secondary"
            disabled={useWorkspace.getState().info?.encrypted}
            onClick={() => set({ activeModal: "bookmarks-edit" })}
          >
            Edit bookmarks
          </button>
          <BookmarkPanel key={documentId} bookmarks={bookmarks} controller={controller} />
        </div>
      );
    return (
      <div className="sidebar-scroll">
        <div className="comment-actions" aria-label="Local comment exchange">
          <button
            type="button"
            className="button"
            disabled={comments.length === 0}
            onClick={() => {
              void exportComments();
            }}
          >
            <Download size={14} /> Export
          </button>
          <button type="button" className="button" onClick={() => importInput.current?.click()}>
            <Upload size={14} /> Import
          </button>
          <input
            ref={importInput}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void file
                .text()
                .then((source) => controller.importComments(source))
                .then((count) => set({ status: `${count} comments imported` }))
                .catch((error: unknown) =>
                  set({ error: error instanceof Error ? error.message : String(error) }),
                );
            }}
          />
        </div>
        <CommentPanel
          key={documentId}
          comments={comments}
          selectedId={selectedId}
          controller={controller}
        />
      </div>
    );
  };
  return (
    <aside className="left-sidebar">
      <button
        className="icon-button panel-close"
        aria-label="Close navigation panel"
        onClick={() => set({ navigationVisible: false })}
      >
        <X size={18} />
      </button>
      <div className="sidebar-tabs" role="tablist" aria-label="Document navigation">
        {tabs
          .filter((t) => t.id !== "layers" || layers.length > 0 || tab === "layers")
          .map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-label={t.label}
              title={t.label}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                set({ sidebar: t.id });
              }}
            >
              <t.icon size={18} />
            </button>
          ))}
      </div>
      <h2 className="sidebar-heading">
        {tabs.find((t) => t.id === tab)?.label}
        {tab === "comments" ? ` (${comments.length})` : ""}
      </h2>
      {renderPanel()}
    </aside>
  );
}

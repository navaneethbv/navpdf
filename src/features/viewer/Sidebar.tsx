import { useEffect } from "react";
import {
  Bookmark as BookmarkIcon,
  Files,
  MessageSquare,
  Search,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { Thumbnails } from "./Thumbnails";
import { SearchPanel } from "../search/SearchPanel";
import type { ViewerController } from "./controller";
import type { Bookmark } from "../../types/document";
const tabs = [
  { id: "pages", label: "Pages", icon: Files },
  { id: "bookmarks", label: "Bookmarks", icon: BookmarkIcon },
  { id: "search", label: "Search", icon: Search },
  { id: "comments", label: "Comments", icon: MessageSquare },
] as const;
export function Sidebar({ controller }: { controller: ViewerController }) {
  const tab = useWorkspace((s) => s.sidebar),
    bookmarks = useWorkspace((s) => s.bookmarks),
    comments = useWorkspace((s) => s.comments),
    set = useWorkspace((s) => s.set);
  useEffect(() => {
    if (tab === "comments")
      void controller
        .readComments()
        .catch(() =>
          set({ error: "Comments could not be read from this PDF." }),
        );
    if (tab !== "search") controller.closeSearch();
  }, [controller, tab, set]);
  return (
    <aside className="left-sidebar">
      <div
        className="sidebar-tabs"
        role="tablist"
        aria-label="Document navigation"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-label={t.label}
            title={t.label}
            className={tab === t.id ? "active" : ""}
            onClick={() => set({ sidebar: t.id })}
          >
            <t.icon size={18} />
          </button>
        ))}
      </div>
      <h2 className="sidebar-heading">
        {tabs.find((t) => t.id === tab)?.label}
      </h2>
      {tab === "pages" ? (
        <Thumbnails controller={controller} />
      ) : tab === "search" ? (
        <SearchPanel controller={controller} />
      ) : tab === "bookmarks" ? (
        <div className="sidebar-scroll">
          {bookmarks.length ? (
            <BookmarkTree nodes={bookmarks} controller={controller} />
          ) : (
            <p className="empty-message">This PDF has no bookmarks.</p>
          )}
        </div>
      ) : (
        <div className="sidebar-scroll">
          {comments.length ? (
            comments.map((c) => (
              <button
                className="comment-row"
                key={`${c.page}-${c.id}`}
                onClick={() => controller.goTo(c.page)}
              >
                <strong>
                  {c.type} · Page {c.page}
                </strong>
                <span>{c.text}</span>
              </button>
            ))
          ) : (
            <p className="empty-message">
              No saved comments or highlights found. New highlights appear here
              after saving and reopening.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
function BookmarkTree({
  nodes,
  controller,
}: {
  nodes: Bookmark[];
  controller: ViewerController;
}) {
  return (
    <ul className="bookmarks">
      {nodes.map((node, i) => (
        <li key={i}>
          {node.destination ? (
            <button
              onClick={() => {
                const dest = node.destination;
                if (!dest) return;
                void controller.links
                  .goToDestination(dest)
                  .catch(() =>
                    useWorkspace.getState().set({
                      error: "This bookmark has an invalid destination.",
                    }),
                  );
              }}
            >
              {node.title}
            </button>
          ) : (
            <span className="bookmark-heading">{node.title}</span>
          )}
          {node.children.length > 0 && (
            <BookmarkTree nodes={node.children} controller={controller} />
          )}
        </li>
      ))}
    </ul>
  );
}

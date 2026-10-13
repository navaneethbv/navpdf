import { useId, useMemo, useState } from "react";
import type { Bookmark } from "../../types/document";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "./controller";
import { filterBookmarks } from "./review-filters";

export function BookmarkPanel({
  bookmarks,
  controller,
}: Readonly<{ bookmarks: Bookmark[]; controller: ViewerController }>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterBookmarks(bookmarks, query), [bookmarks, query]);
  return (
    <>
      <div className="review-filters">
        <label className="setting-title" htmlFor={id}>
          Search bookmarks
        </label>
        <input
          id={id}
          className="text-input"
          type="search"
          value={query}
          placeholder="Find bookmark titles"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={!query}
          onClick={() => setQuery("")}
        >
          Clear bookmark search
        </button>
      </div>
      <p className="empty-message" role="status">
        Showing {filtered.shown} of {filtered.total} bookmarks
        {query.trim()
          ? ` (${filtered.matches} ${filtered.matches === 1 ? "match" : "matches"})`
          : ""}
      </p>
      {filtered.nodes.length ? (
        <BookmarkTree nodes={filtered.nodes} controller={controller} />
      ) : (
        <p className="empty-message">
          {bookmarks.length ? "No bookmarks match this search." : "This PDF has no bookmarks."}
        </p>
      )}
    </>
  );
}

function BookmarkTree({
  nodes,
  controller,
}: Readonly<{ nodes: Bookmark[]; controller: ViewerController }>) {
  return (
    <ul className="bookmarks">
      {nodes.map((node, index) => (
        <li key={`${node.title}-${index}`}>
          {node.destination ? (
            <button
              type="button"
              onClick={() => {
                if (!node.destination) return;
                void controller.links
                  .goToDestination(node.destination)
                  .catch(() =>
                    useWorkspace
                      .getState()
                      .set({ error: "This bookmark has an invalid destination." }),
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

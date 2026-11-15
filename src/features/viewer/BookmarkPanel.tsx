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
  const matchLabel = filtered.matches === 1 ? "match" : "matches";
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
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={!query}
          onClick={() => {
            setQuery("");
          }}
        >
          Clear bookmark search
        </button>
      </div>
      <output className="empty-message">
        Showing {filtered.shown} of {filtered.total} bookmarks
        {query.trim() ? ` (${filtered.matches} ${matchLabel})` : ""}
      </output>
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

function BookmarkItem({
  node,
  controller,
}: Readonly<{ node: Bookmark; controller: ViewerController }>) {
  if (node.destination) {
    const destination = node.destination;
    return (
      <button
        type="button"
        onClick={() => {
          void controller.links.goToDestination(destination).catch(() => {
            useWorkspace.getState().set({ error: "This bookmark has an invalid destination." });
          });
        }}
      >
        {node.title}
      </button>
    );
  }
  if (node.url) {
    const url = node.url;
    return (
      <button
        type="button"
        title={url}
        onClick={() => {
          controller.requestExternalLink(url);
        }}
      >
        {node.title}
      </button>
    );
  }
  return <span className="bookmark-heading">{node.title}</span>;
}

function BookmarkTree({
  nodes,
  controller,
}: Readonly<{ nodes: Bookmark[]; controller: ViewerController }>) {
  return (
    <ul className="bookmarks">
      {nodes.map((node, index) => (
        <li key={`${node.title}-${index}`}>
          <BookmarkItem node={node} controller={controller} />
          {node.children.length > 0 && (
            <BookmarkTree nodes={node.children} controller={controller} />
          )}
        </li>
      ))}
    </ul>
  );
}

import { useId, useMemo, useState } from "react";
import type { Comment } from "../../types/document";
import type { ViewerController } from "./controller";
import { selectedCommentIds, useWorkspace } from "../../stores/workspace";
import {
  commentAuthor,
  defaultCommentFilters,
  filterComments,
  type CommentFilters,
} from "./review-filters";

export function CommentPanel({
  comments,
  selectedId,
  controller,
}: Readonly<{
  comments: Comment[];
  selectedId: string | null;
  controller: ViewerController;
}>) {
  const id = useId();
  const selectedIds = useWorkspace((s) => s.selectedAnnotationIds);
  const selection = selectedCommentIds({
    selectedAnnotationId: selectedId,
    selectedAnnotationIds: selectedIds,
  });
  const clipCount = useWorkspace((s) => s.commentClipboardCount);
  const report = (error: unknown) =>
    useWorkspace.getState().set({ error: error instanceof Error ? error.message : String(error) });
  const [filters, setFilters] = useState(defaultCommentFilters);
  const displayed = useMemo(() => filterComments(comments, filters), [comments, filters]);
  const authors = useMemo(
    () =>
      [...new Set(comments.map(commentAuthor))].sort(
        (a, b) => Number(!a) - Number(!b) || a.localeCompare(b),
      ),
    [comments],
  );
  const types = useMemo(
    () => [...new Set(comments.map((comment) => comment.type))].sort((a, b) => a.localeCompare(b)),
    [comments],
  );
  const change = (patch: Partial<CommentFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  return (
    <>
      <div className="review-filters">
        <label className="setting-title" htmlFor={`${id}-query`}>
          Search comments and replies
        </label>
        <input
          id={`${id}-query`}
          className="text-input"
          type="search"
          value={filters.query}
          placeholder="Find review text"
          onChange={(event) => change({ query: event.target.value })}
        />
        <div className="review-filter-grid">
          <label className="setting-title">
            <span>Comment author</span>
            <select
              className="text-input"
              value={filters.author === null ? "all" : `author:${filters.author}`}
              onChange={(event) =>
                change({
                  author: event.target.value === "all" ? null : event.target.value.slice(7),
                })
              }
            >
              <option value="all">All authors</option>
              {authors.map((author) => (
                <option value={`author:${author}`} key={author}>
                  {author || "Unknown author"}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-title">
            <span>Annotation type</span>
            <select
              className="text-input"
              value={filters.type}
              onChange={(event) => change({ type: event.target.value })}
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="setting-title">
            <span>Review status</span>
            <select
              className="text-input"
              value={filters.status}
              onChange={(event) => change({ status: event.target.value })}
            >
              <option value="">All statuses</option>
              <option value="none">No status</option>
              {["Accepted", "Rejected", "Cancelled", "Completed"].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="setting-title">
            <span>Sort comments</span>
            <select
              className="text-input"
              value={filters.sort}
              onChange={(event) => change({ sort: event.target.value as CommentFilters["sort"] })}
            >
              <option value="page">Page</option>
              <option value="author">Author</option>
              <option value="date">Date (newest first)</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => setFilters(defaultCommentFilters)}
          disabled={
            !filters.query &&
            filters.author === null &&
            !filters.type &&
            !filters.status &&
            filters.sort === "page"
          }
        >
          Clear comment filters
        </button>
      </div>
      <output className="empty-message">
        Showing {displayed.length} of {comments.length} comments
        {selection.length > 1 ? `, ${selection.length} selected` : ""}
      </output>
      <div className="comment-actions" aria-label="Selected comments">
        <button
          type="button"
          className="button"
          disabled={selection.length === 0 || typeof controller.copySelectedComments !== "function"}
          title="Copy the selected comments with their replies (Command-C)"
          onClick={() => {
            const marker = controller.commentClipboardText();
            void navigator.clipboard?.writeText(marker).catch(() => {});
            void controller.copySelectedComments(marker).catch(report);
          }}
        >
          Copy
        </button>
        <button
          type="button"
          className="button"
          disabled={clipCount === 0 || typeof controller.pasteComments !== "function"}
          title="Paste copied comments on the current page (Command-V)"
          onClick={() => void controller.pasteComments().catch(report)}
        >
          Paste{clipCount ? ` ${clipCount}` : ""}
        </button>
        <button
          type="button"
          className="button"
          disabled={selection.length === 0}
          onClick={() => void controller.deleteSelectedAnnotation().catch(report)}
        >
          Delete{selection.length > 1 ? ` ${selection.length}` : ""}
        </button>
      </div>
      {displayed.map((comment) => (
        <button
          type="button"
          className="comment-row"
          key={`${comment.page}-${comment.id}`}
          aria-pressed={selection.includes(comment.id)}
          title="Command-click adds to the selection; Shift-click selects a range."
          onClick={(event) => {
            if (typeof controller.selectAnnotation !== "function") {
              controller.goTo(comment.page);
              return;
            }
            if (event.metaKey || event.ctrlKey) controller.selectAnnotation(comment.id, "toggle");
            else if (event.shiftKey) controller.selectAnnotation(comment.id, "range");
            else controller.selectAnnotation(comment.id);
          }}
        >
          <strong>
            {comment.replyTo ? "Reply · " : ""}
            {comment.type} · Page {comment.page}
          </strong>
          <span>{comment.text}</span>
          <span className="comment-meta">
            {commentAuthor(comment) || "Unknown author"}
            {comment.reviewState ? ` · ${comment.reviewState}` : ""}
            {comment.modified && !Number.isNaN(Date.parse(comment.modified))
              ? ` · ${new Date(comment.modified).toLocaleString()}`
              : ""}
          </span>
        </button>
      ))}
      {!displayed.length && (
        <p className="empty-message">
          {comments.length
            ? "No comments match these filters."
            : "No saved comments or highlights found. New highlights appear here after saving and reopening."}
        </p>
      )}
    </>
  );
}

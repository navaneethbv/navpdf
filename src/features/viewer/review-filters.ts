import type { Bookmark, Comment } from "../../types/document";

export interface CommentFilters {
  query: string;
  author: string | null;
  type: string;
  status: string;
  sort: "page" | "author" | "date";
}

export const defaultCommentFilters: CommentFilters = {
  query: "",
  author: null,
  type: "",
  status: "",
  sort: "page",
};

export function commentAuthor(comment: Comment): string {
  return comment.author?.trim() ?? "";
}

function latestReviewStates(comments: readonly Comment[]) {
  const reviewStates = new Map<
    string,
    { state: NonNullable<Comment["reviewState"]>; modified: number }
  >();
  for (const comment of comments) {
    if (!comment.replyTo || !comment.reviewState) continue;
    const parsed = Date.parse(comment.modified ?? "");
    const modified = Number.isNaN(parsed) ? -Infinity : parsed;
    const previous = reviewStates.get(comment.replyTo);
    // A valid timestamp outranks an undated state; ties use the later source entry.
    if (!previous || modified >= previous.modified)
      reviewStates.set(comment.replyTo, { state: comment.reviewState, modified });
  }
  return reviewStates;
}

function matchingCommentIds(comments: readonly Comment[], query: string) {
  const matches = new Set<string>();
  if (query) {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    for (const comment of comments) {
      if (!comment.text.toLocaleLowerCase().includes(query)) continue;
      let current: Comment | undefined = comment;
      while (current && !matches.has(current.id)) {
        matches.add(current.id);
        current = current.replyTo ? byId.get(current.replyTo) : undefined;
      }
    }
  }
  return matches;
}

/** Find matching annotations, retaining parent context for text found in a reply. */
export function filterComments(comments: readonly Comment[], filters: CommentFilters): Comment[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const reviewStates = latestReviewStates(comments);
  const matches = matchingCommentIds(comments, query);
  return comments
    .map((comment) =>
      reviewStates.has(comment.id)
        ? { ...comment, reviewState: reviewStates.get(comment.id)?.state }
        : comment,
    )
    .filter((comment) => {
      if (query && !matches.has(comment.id)) return false;
      if (filters.author !== null && commentAuthor(comment) !== filters.author) return false;
      if (filters.type && comment.type !== filters.type) return false;
      if (filters.status === "none") return !comment.reviewState;
      return !filters.status || comment.reviewState === filters.status;
    })
    .sort((a, b) => {
      if (filters.sort === "author") {
        const first = commentAuthor(a);
        const second = commentAuthor(b);
        return Number(!first) - Number(!second) || first.localeCompare(second) || a.page - b.page;
      }
      if (filters.sort === "date") {
        const first = Date.parse(a.modified ?? "");
        const second = Date.parse(b.modified ?? "");
        return (
          (Number.isNaN(second) ? -Infinity : second) - (Number.isNaN(first) ? -Infinity : first) ||
          a.page - b.page
        );
      }
      return a.page - b.page;
    });
}

/** Prune unmatched branches without changing the original tree or its destinations. */
export function filterBookmarks(bookmarks: readonly Bookmark[], search: string) {
  const query = search.trim().toLocaleLowerCase();
  let total = 0;
  let shown = 0;
  let matches = 0;
  const visit = (nodes: readonly Bookmark[]): Bookmark[] =>
    nodes.flatMap((node) => {
      total++;
      const children = visit(node.children);
      const matched = !query || node.title.toLocaleLowerCase().includes(query);
      if (matched) matches++;
      if (!matched && children.length === 0) return [];
      shown++;
      return [{ ...node, children }];
    });
  return { nodes: visit(bookmarks), total, shown, matches };
}

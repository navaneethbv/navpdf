import { describe, expect, it } from "vitest";
import {
  defaultCommentFilters,
  filterBookmarks,
  filterComments,
} from "../../src/features/viewer/review-filters";
import type { Comment } from "../../src/types/document";

describe("review filters", () => {
  it("filters the parent by its latest saved review state without mutating comments", () => {
    const comments: Comment[] = [
      { id: "parent", page: 1, type: "Text", text: "Review me" },
      {
        id: "old",
        page: 1,
        type: "Text",
        text: "Rejected",
        replyTo: "parent",
        reviewState: "Rejected",
      },
      {
        id: "new",
        page: 1,
        type: "Text",
        text: "Accepted",
        replyTo: "parent",
        reviewState: "Accepted",
      },
    ];
    expect(
      filterComments(comments, { ...defaultCommentFilters, status: "Accepted" }).map(
        (comment) => comment.id,
      ),
    ).toEqual(["parent", "new"]);
    expect(comments[0].reviewState).toBeUndefined();
  });

  it("uses the newest review date when an older state appears later in the annotation array", () => {
    const comments: Comment[] = [
      { id: "parent", page: 1, type: "Text", text: "Review me" },
      {
        id: "newer",
        page: 1,
        type: "Text",
        text: "Accepted",
        replyTo: "parent",
        reviewState: "Accepted",
        modified: "2026-10-13T10:00:00.000Z",
      },
      {
        id: "older",
        page: 1,
        type: "Text",
        text: "Rejected",
        replyTo: "parent",
        reviewState: "Rejected",
        modified: "2026-10-12T10:00:00.000Z",
      },
    ];
    expect(
      filterComments(comments, { ...defaultCommentFilters, status: "Accepted" }).map(
        (comment) => comment.id,
      ),
    ).toEqual(["parent", "newer"]);
    expect(comments[0].reviewState).toBeUndefined();
  });

  it.each([
    ["2026-10-13T10:00:00.000Z", undefined, "Accepted"],
    [undefined, "2026-10-13T10:00:00.000Z", "Rejected"],
    ["2026-10-13T10:00:00.000Z", "invalid", "Accepted"],
    ["2026-10-13T10:00:00.000Z", "2026-10-13T10:00:00.000Z", "Rejected"],
    [undefined, "invalid", "Rejected"],
  ])(
    "prefers valid dates and uses the later source entry for missing or equal dates (%s, %s)",
    (first, last, expected) => {
      const comments: Comment[] = [
        { id: "parent", page: 1, type: "Text", text: "Review me" },
        {
          id: "first",
          page: 1,
          type: "Text",
          text: "Accepted",
          replyTo: "parent",
          reviewState: "Accepted",
          modified: first,
        },
        {
          id: "last",
          page: 1,
          type: "Text",
          text: "Rejected",
          replyTo: "parent",
          reviewState: "Rejected",
          modified: last,
        },
      ];
      expect(
        filterComments(comments, defaultCommentFilters).find((comment) => comment.id === "parent")
          ?.reviewState,
      ).toBe(expected);
    },
  );

  it("terminates cyclic reply paths and preserves every matching ancestor once", () => {
    const comments: Comment[] = [
      { id: "a", page: 1, type: "Text", text: "Needle", replyTo: "b" },
      { id: "b", page: 2, type: "Text", text: "Parent", replyTo: "a" },
      { id: "orphan", page: 3, type: "Text", text: "Needle", replyTo: "missing" },
    ];
    expect(
      filterComments(comments, { ...defaultCommentFilters, query: "needle" }).map(
        (comment) => comment.id,
      ),
    ).toEqual(["a", "b", "orphan"]);
  });

  it("matches a branch title without retaining unrelated descendants", () => {
    const nodes = [
      {
        title: "Guide",
        destination: null,
        children: [{ title: "Overview", destination: [1], children: [] }],
      },
    ];
    expect(filterBookmarks(nodes, "guide")).toEqual({
      nodes: [{ ...nodes[0], children: [] }],
      shown: 1,
      total: 2,
      matches: 1,
    });
    expect(nodes[0].children).toHaveLength(1);
  });
});

// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../src/features/viewer/Sidebar";
import { useWorkspace } from "../../src/stores/workspace";

const comments = [
  {
    id: "parent",
    page: 3,
    type: "Highlight",
    text: "Check totals",
    author: "Zoe",
    modified: "2026-10-10T10:00:00.000Z",
    reviewState: "Accepted" as const,
  },
  {
    id: "reply",
    page: 3,
    type: "Text",
    text: "The invoice is correct",
    author: "Ada",
    replyTo: "parent",
    modified: "2026-10-12T10:00:00.000Z",
  },
  {
    id: "other",
    page: 1,
    type: "Text",
    text: "Check spelling",
    author: "Ada",
    modified: "2026-10-11T10:00:00.000Z",
    reviewState: "Completed" as const,
  },
  { id: "unknown", page: 2, type: "Square", text: "Margin", modified: "invalid" },
];
const bookmarks = [
  {
    title: "Chapter",
    destination: [0],
    children: [
      { title: "Overview", destination: "overview", children: [] },
      {
        title: "Appendices",
        destination: null,
        children: [
          { title: "Invoice details", destination: [2], children: [] },
          { title: "Glossary", destination: [3], children: [] },
        ],
      },
    ],
  },
  { title: "Index", destination: [4], children: [] },
];
const controller = {
  closeSearch() {},
  async readComments() {},
  selectAnnotation(id: string) {
    useWorkspace.getState().set({ selectedAnnotationId: id });
  },
  goTo(page: number) {
    useWorkspace.getState().set({ page });
  },
  links: {
    async goToDestination(destination: string | unknown[]) {
      useWorkspace
        .getState()
        .set({ page: destination === "overview" ? 2 : Number(destination[0]) + 1 });
    },
  },
};

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    document: { id: "first", name: "first.pdf", size: 10 },
    sidebar: "comments",
    comments,
    bookmarks,
  });
});
const rows = () => screen.getAllByRole("button", { pressed: false }).map((row) => row.textContent);

describe("sidebar comment review", () => {
  it("searches reply text with parent context and keeps matching annotations selectable", () => {
    render(<Sidebar controller={controller as never} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search comments and replies" }), {
      target: { value: "  INVOICE  " },
    });
    expect(screen.getByText("Check totals")).toBeTruthy();
    expect(screen.getByText("The invoice is correct")).toBeTruthy();
    expect(screen.queryByText("Check spelling")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Showing 2 of 4 comments");
    fireEvent.click(screen.getByText("The invoice is correct"));
    expect(useWorkspace.getState().selectedAnnotationId).toBe("reply");
  });

  it("combines author, annotation type and review status filters without changing source comments", () => {
    render(<Sidebar controller={controller as never} />);
    fireEvent.change(screen.getByLabelText("Comment author"), { target: { value: "author:Ada" } });
    fireEvent.change(screen.getByLabelText("Annotation type"), { target: { value: "Text" } });
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "Completed" } });
    expect(screen.getByText("Check spelling")).toBeTruthy();
    expect(screen.queryByText("Check totals")).toBeNull();
    expect(screen.queryByText("The invoice is correct")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Showing 1 of 4 comments");
    expect(useWorkspace.getState().comments).toEqual(comments);
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "Accepted" } });
    expect(screen.getByText("No comments match these filters.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear comment filters" }));
    expect(screen.getByRole("status").textContent).toBe("Showing 4 of 4 comments");
  });

  it("offers unknown authors and comments with no review status", () => {
    render(<Sidebar controller={controller as never} />);
    const author = screen.getByLabelText("Comment author");
    fireEvent.change(author, {
      target: {
        value: within(author).getByRole("option", { name: "Unknown author" }).getAttribute("value"),
      },
    });
    expect(screen.getByText("Margin")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Showing 1 of 4 comments");
    fireEvent.click(screen.getByRole("button", { name: "Clear comment filters" }));
    const status = screen.getByLabelText("Review status");
    fireEvent.change(status, {
      target: {
        value: within(status).getByRole("option", { name: "No status" }).getAttribute("value"),
      },
    });
    expect(screen.getByRole("status").textContent).toBe("Showing 2 of 4 comments");
  });

  it("sorts by page, author and newest recorded date with missing dates last", () => {
    render(<Sidebar controller={controller as never} />);
    expect(
      rows().map(
        (text) => text?.match(/Check spelling|Margin|Check totals|The invoice is correct/)?.[0],
      ),
    ).toEqual(["Check spelling", "Margin", "Check totals", "The invoice is correct"]);
    fireEvent.change(screen.getByLabelText("Sort comments"), { target: { value: "author" } });
    expect(
      rows().map(
        (text) => text?.match(/Check spelling|Margin|Check totals|The invoice is correct/)?.[0],
      ),
    ).toEqual(["Check spelling", "The invoice is correct", "Check totals", "Margin"]);
    fireEvent.change(screen.getByLabelText("Sort comments"), { target: { value: "date" } });
    expect(
      rows().map(
        (text) => text?.match(/Check spelling|Margin|Check totals|The invoice is correct/)?.[0],
      ),
    ).toEqual(["The invoice is correct", "Check spelling", "Check totals", "Margin"]);
  });

  it("resets all comment filters when another document is opened", () => {
    render(<Sidebar controller={controller as never} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search comments and replies" }), {
      target: { value: "invoice" },
    });
    fireEvent.change(screen.getByLabelText("Comment author"), { target: { value: "author:Ada" } });
    fireEvent.change(screen.getByLabelText("Annotation type"), { target: { value: "Text" } });
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "Accepted" } });
    fireEvent.change(screen.getByLabelText("Sort comments"), { target: { value: "date" } });
    act(() =>
      useWorkspace.getState().set({
        document: { id: "second", name: "second.pdf", size: 20 },
        comments: [{ id: "new", type: "Stamp", page: 1, text: "New document" }],
      }),
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Sort comments") as HTMLSelectElement).value).toBe("page");
    expect(screen.getByText("New document")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Showing 1 of 1 comments");
  });
});

describe("sidebar bookmark search", () => {
  beforeEach(() => useWorkspace.getState().set({ sidebar: "bookmarks" }));
  it("keeps ancestor paths to a matching bookmark and navigates to the original destination", () => {
    render(<Sidebar controller={controller as never} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search bookmarks" }), {
      target: { value: "  INVOICE " },
    });
    expect(screen.getByRole("button", { name: "Chapter" })).toBeTruthy();
    expect(screen.getByText("Appendices")).toBeTruthy();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("Index")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Showing 3 of 6 bookmarks (1 match)");
    fireEvent.click(screen.getByRole("button", { name: "Invoice details" }));
    expect(useWorkspace.getState().page).toBe(3);
    expect(useWorkspace.getState().bookmarks).toEqual(bookmarks);
  });
  it("clears bookmark searches and preserves named destination navigation", () => {
    render(<Sidebar controller={controller as never} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No bookmarks match this search.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear bookmark search" }));
    expect(screen.getByRole("status").textContent).toBe("Showing 6 of 6 bookmarks");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(useWorkspace.getState().page).toBe(2);
  });
  it("resets bookmark search after a document switch and reports invalid destinations", async () => {
    const invalid = {
      ...controller,
      links: {
        async goToDestination() {
          throw new Error("invalid");
        },
      },
    };
    render(<Sidebar controller={invalid as never} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    act(() =>
      useWorkspace.getState().set({ document: { id: "second", name: "second.pdf", size: 20 } }),
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await vi.waitFor(() =>
      expect(useWorkspace.getState().error).toBe("This bookmark has an invalid destination."),
    );
  });
});

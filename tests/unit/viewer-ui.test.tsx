// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { Sidebar } from "../../src/features/viewer/Sidebar";
import { Thumbnails } from "../../src/features/viewer/Thumbnails";
import { SearchPanel } from "../../src/features/search/SearchPanel";
import { Home } from "../../src/features/home/Home";
import { Settings } from "../../src/features/settings/Settings";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    local: { preferences: defaultPreferences, recents: [], recovery: null },
  });
  vi.clearAllMocks();
});

const controller = {
  goTo: vi.fn(),
  search: vi.fn(),
  selectResult: vi.fn(),
  closeSearch: vi.fn(),
  readComments: vi.fn(async () => {}),
  links: { goToDestination: vi.fn(async () => {}) },
  pdf: null,
};

describe("Sidebar", () => {
  it("switches between pages, bookmarks, search, and comments", () => {
    useWorkspace.getState().set({
      bookmarks: [
        {
          title: "Chapter",
          destination: null,
          children: [{ title: "Intro", destination: [1], children: [] }],
        },
      ],
      comments: [{ id: "c1", page: 2, type: "Highlight", text: "great" }],
    });
    render(<Sidebar controller={controller as never} />);
    fireEvent.click(screen.getByLabelText("Bookmarks"));
    expect(screen.getByText("Chapter")).toBeTruthy();
    expect(screen.getByText("Intro")).toBeTruthy();
    fireEvent.click(screen.getByText("Intro"));
    expect(controller.links.goToDestination).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Comments"));
    fireEvent.click(screen.getByText("great"));
    expect(controller.goTo).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByLabelText("Search document")).toBeTruthy();
  });

  it("shows empty states for bookmarks and comments", () => {
    useWorkspace.getState().set({ sidebar: "bookmarks" });
    render(<Sidebar controller={controller as never} />);
    expect(screen.getByText("This PDF has no bookmarks.")).toBeTruthy();
  });
});

describe("Thumbnails", () => {
  it("renders virtualized page buttons and navigates", async () => {
    useWorkspace.getState().set({
      info: {
        pages: 6,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
      page: 2,
    });
    const withPdf = {
      ...controller,
      pdf: { getPage: vi.fn(async () => { throw new Error("no render"); }) },
    };
    render(<Thumbnails controller={withPdf as never} />);
    expect(screen.getByLabelText("Go to page 1")).toBeTruthy();
    expect(await screen.findAllByText("Preview unavailable")).not.toHaveLength(0);
    fireEvent.click(screen.getByLabelText("Go to page 4"));
    expect(controller.goTo).toHaveBeenCalledWith(4);
  });
});

describe("SearchPanel", () => {
  it("debounces typing into a controller search and navigates results", async () => {
    vi.useFakeTimers();
    render(<SearchPanel controller={controller as never} />);
    fireEvent.change(screen.getByLabelText("Search document"), {
      target: { value: "river" },
    });
    expect(useWorkspace.getState().searchQuery).toBe("river");
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.search).toHaveBeenCalled();
    vi.useRealTimers();
    act(() => {
      useWorkspace.getState().set({
        searchCount: 2,
        results: [
          { page: 1, index: 0, context: "…river…", match: "river" },
          { page: 3, index: 1, context: "…river…", match: "river" },
        ],
      });
    });
    expect(screen.getAllByText("Page 1")).toHaveLength(1);
    fireEvent.click(screen.getAllByText("…river…")[0].closest("button")!);
    expect(controller.selectResult).toHaveBeenCalledWith(1, 0);
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(controller.search).toHaveBeenCalledWith(true);
  });

  it("shows the scanned-page hint when nothing matches", () => {
    useWorkspace.getState().set({ searchQuery: "zzz", searchCount: 0 });
    render(<SearchPanel controller={controller as never} />);
    expect(screen.getByText(/Scanned pages need/)).toBeTruthy();
  });
});

describe("Home", () => {
  it("opens documents, recents, and recovery flows", () => {
    const props = {
      open: vi.fn(),
      recent: vi.fn(),
      recover: vi.fn(),
      refresh: vi.fn(async () => {}),
      onError: vi.fn(),
    };
    useWorkspace.getState().set({
      local: {
        preferences: defaultPreferences,
        recents: [{ id: "r1", name: "old.pdf", openedAt: 1_700_000_000, page: 4 }],
        recovery: { name: "unsaved.pdf", savedAt: 1_700_000_001 },
      },
    });
    render(<Home {...props} />);
    fireEvent.click(screen.getByText("Open PDF"));
    expect(props.open).toHaveBeenCalled();
    fireEvent.click(screen.getByText("old.pdf"));
    expect(props.recent).toHaveBeenCalledWith("r1", 4);
    fireEvent.click(screen.getByText("Open recovery"));
    expect(props.recover).toHaveBeenCalled();
  });

  it("shows the empty-recents hint when history is disabled", () => {
    useWorkspace.getState().set({
      local: {
        preferences: { ...defaultPreferences, recentFiles: false },
        recents: [],
        recovery: null,
      },
    });
    render(
      <Home
        open={() => {}}
        recent={() => {}}
        recover={() => {}}
        refresh={async () => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByText("Recent document history is disabled.")).toBeTruthy();
  });
});

describe("Settings", () => {
  it("edits and saves preferences", async () => {
    useWorkspace.getState().set({ settingsOpen: true });
    render(<Settings />);
    fireEvent.change(screen.getByLabelText(/Theme/), {
      target: { value: "dark" },
    });
    fireEvent.click(screen.getByText("Save settings"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().settingsOpen).toBe(false);
    });
    expect(useWorkspace.getState().local.preferences.theme).toBe("dark");
  });

  it("cancels without saving", () => {
    useWorkspace.getState().set({ settingsOpen: true });
    render(<Settings />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(useWorkspace.getState().settingsOpen).toBe(false);
  });
});

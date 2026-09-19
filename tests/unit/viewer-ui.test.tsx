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

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
  writable: true,
});

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    local: { preferences: defaultPreferences, recents: [], recoveries: [] },
  });
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
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
    expect(screen.getByText("Comments (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("great"));
    expect(controller.goTo).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByLabelText("Search document")).toBeTruthy();
  });

  it("selects annotations when selectAnnotation is supported", () => {
    const withSelect = {
      ...controller,
      selectAnnotation: vi.fn(),
    };
    useWorkspace.getState().set({
      sidebar: "comments",
      comments: [{ id: "c2", page: 1, type: "Square", text: "box" }],
    });
    render(<Sidebar controller={withSelect as never} />);
    fireEvent.click(screen.getByText("box"));
    expect(withSelect.selectAnnotation).toHaveBeenCalledWith("c2");
  });

  it("exports and imports comments through the sidebar", async () => {
    const withExchange = {
      ...controller,
      exportComments: vi.fn(() => '{"schema":"navpdf-comments"}'),
      importComments: vi.fn(async () => 3),
    };
    useWorkspace.getState().set({
      sidebar: "comments",
      document: { id: "doc-1", name: "report.pdf", size: 100 },
      comments: [{ id: "c1", page: 1, type: "Text", text: "note" }],
    });
    render(<Sidebar controller={withExchange as never} />);

    const exportBtn = screen.getByRole("button", { name: /Export/ });
    fireEvent.click(exportBtn);
    expect(withExchange.exportComments).toHaveBeenCalled();
    await vi.waitFor(() => expect(useWorkspace.getState().status).toBe("Comments exported"));

    const importBtn = screen.getByRole("button", { name: /Import/ });
    const file = new File(['{"schema":"navpdf-comments"}'], "comments.json", {
      type: "application/json",
    });
    file.text = vi.fn(async () => '{"schema":"navpdf-comments"}');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.click(importBtn);
    fireEvent.change(input, { target: { files: [file] } });

    await vi.waitFor(() => {
      expect(withExchange.importComments).toHaveBeenCalledWith('{"schema":"navpdf-comments"}');
      expect(useWorkspace.getState().status).toBe("3 comments imported");
    });
  });

  it("handles export and import errors gracefully", async () => {
    const withFailingExchange = {
      ...controller,
      exportComments: vi.fn(() => {
        throw new Error("Export failed");
      }),
      importComments: vi.fn(async () => {
        throw new Error("Import failed");
      }),
    };
    useWorkspace.getState().set({
      sidebar: "comments",
      comments: [{ id: "c1", page: 1, type: "Text", text: "note" }],
    });
    render(<Sidebar controller={withFailingExchange as never} />);

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    expect(useWorkspace.getState().error).toBe("Export failed");

    const file = new File(["bad"], "comments.json");
    file.text = vi.fn(async () => "bad");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toBe("Import failed");
    });
  });

  it("shows empty states for bookmarks and comments", () => {
    useWorkspace.getState().set({ sidebar: "bookmarks" });
    const { rerender } = render(<Sidebar controller={controller as never} />);
    expect(screen.getByText("This PDF has no bookmarks.")).toBeTruthy();

    useWorkspace.getState().set({ sidebar: "comments", comments: [] });
    rerender(<Sidebar controller={controller as never} />);
    expect(screen.getByText(/No saved comments or highlights found/)).toBeTruthy();
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
      pdf: {
        getPage: vi.fn(async () => {
          throw new Error("no render");
        }),
      },
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
        recoveries: [
          { id: "rec-1", name: "unsaved.pdf", pages: 2, savedAt: 1_700_000_001 },
          { id: "rec-2", name: "draft.pdf", pages: 1, savedAt: 1_700_000_000 },
        ],
      },
    });
    render(<Home {...props} />);
    fireEvent.click(screen.getByText("Open PDF"));
    expect(props.open).toHaveBeenCalled();
    fireEvent.click(screen.getByText("old.pdf"));
    expect(props.recent).toHaveBeenCalledWith("r1", 4);
    expect(screen.getByText("Recover unsaved documents")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open recovery for draft.pdf"));
    expect(props.recover).toHaveBeenCalledWith("rec-2");
  });

  it("shows the empty-recents hint when history is disabled", () => {
    useWorkspace.getState().set({
      local: {
        preferences: { ...defaultPreferences, recentFiles: false },
        recents: [],
        recoveries: [],
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
    expect(document.documentElement.dataset.theme).toBe("dark");
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

  it("restores the persisted theme when a preview is canceled", () => {
    useWorkspace.getState().set({
      local: {
        preferences: { ...defaultPreferences, theme: "light" },
        recents: [],
        recoveries: [],
      },
      settingsOpen: true,
    });
    const view = render(<Settings />);
    fireEvent.change(screen.getByLabelText(/Theme/), {
      target: { value: "dark" },
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByText("Cancel"));
    view.unmount();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    zoom: 100,
    layout: "continuous",
    tool: "select",
    sidebar: "pages",
    busy: false,
    status: "Ready",
    error: "",
    local: { preferences: defaultPreferences, recents: [], recoveries: [] },
    settingsOpen: false,
    toolMode: null,
    activeModal: null,
    quickRailVisible: true,
  });
});

describe("workspace store", () => {
  it("holds document, navigation, and dirty state", () => {
    const s = useWorkspace.getState();
    expect(s.document).toBeNull();
    expect(s.page).toBe(1);
    expect(s.dirty).toBe(false);
    s.set({
      document: { id: "a", name: "a.pdf", size: 10 },
      info: {
        pages: 4,
        encrypted: false,
        title: "t",
        author: "a",
        version: "1.7",
      },
      page: 3,
      dirty: true,
    });
    const next = useWorkspace.getState();
    expect(next.document?.name).toBe("a.pdf");
    expect(next.info?.pages).toBe(4);
    expect(next.page).toBe(3);
    expect(next.dirty).toBe(true);
  });

  it("resets document state while keeping layout and zoom", () => {
    useWorkspace.getState().set({
      document: { id: "a", name: "a.pdf", size: 10 },
      dirty: true,
      tool: "highlight",
      toolMode: "edit",
      activeModal: "print",
      bookmarks: [{ title: "b", destination: null, children: [] }],
      comments: [{ id: "1", page: 1, type: "Text", text: "hi" }],
      selectedPages: [0, 1],
      activeSnapshot: true,
    });
    useWorkspace.getState().reset();
    const s = useWorkspace.getState();
    expect(s.document).toBeNull();
    expect(s.info).toBeNull();
    expect(s.dirty).toBe(false);
    expect(s.tool).toBe("select");
    expect(s.toolMode).toBeNull();
    expect(s.activeModal).toBeNull();
    expect(s.bookmarks).toEqual([]);
    expect(s.comments).toEqual([]);
    expect(s.selectedPages).toEqual([]);
    expect(s.activeSnapshot).toBe(false);
    expect(s.zoom).toBe(100);
  });

  it("tracks tool, sidebar, search, and annotation preferences", () => {
    useWorkspace.getState().set({
      tool: "highlight",
      sidebar: "search",
      searchQuery: "needle",
      matchCase: true,
      wholeWord: true,
      searchCount: 7,
      searchPending: true,
      results: [{ page: 2, index: 0, context: "…needle…", match: "needle" }],
      highlightColor: "#80d49b",
      inkColor: "#ef4444",
      inkWidth: 3,
      canUndo: true,
      canRedo: true,
      hasSelection: true,
      renderedPages: 5,
      firstRenderMs: 120,
    });
    const s = useWorkspace.getState();
    expect(s.searchCount).toBe(7);
    expect(s.results).toHaveLength(1);
    expect(s.canUndo).toBe(true);
    expect(s.renderedPages).toBe(5);
  });

  it("exposes default preferences for a fresh local state", () => {
    expect(defaultPreferences.theme).toBe("system");
    expect(defaultPreferences.networkAccess).toBe(false);
    expect(defaultPreferences.autosave).toBe(true);
  });
});

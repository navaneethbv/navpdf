import { create } from "zustand";
import type {
  DocumentDescriptor,
  DocumentInfo,
  Layout,
  SidebarTab,
  Tool,
  ToolMode,
  LocalState,
  SearchResult,
  Bookmark,
  Comment,
} from "../types/document";
import { defaultPreferences } from "../types/document";
interface Workspace {
  document: DocumentDescriptor | null;
  info: DocumentInfo | null;
  page: number;
  zoom: number;
  layout: Layout;
  tool: Tool;
  sidebar: SidebarTab;
  dirty: boolean;
  busy: boolean;
  status: string;
  error: string;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  local: LocalState;
  settingsOpen: boolean;
  searchQuery: string;
  matchCase: boolean;
  wholeWord: boolean;
  searchCount: number;
  searchPending: boolean;
  results: SearchResult[];
  bookmarks: Bookmark[];
  comments: Comment[];
  renderedPages: number;
  firstRenderMs: number | null;
  highlightColor: string;
  inkColor: string;
  inkWidth: number;
  toolMode: ToolMode | null;
  activeModal: string | null;
  quickRailVisible: boolean;
  selectedPages: number[];
  activeSnapshot: boolean;
  set: (patch: Partial<Omit<Workspace, "set" | "reset">>) => void;
  reset: () => void;
}
const cleanDocument = {
  document: null,
  info: null,
  page: 1,
  dirty: false,
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  bookmarks: [],
  comments: [],
  results: [],
  searchCount: 0,
  searchPending: false,
  searchQuery: "",
  renderedPages: 0,
  firstRenderMs: null,
  selectedPages: [],
  activeSnapshot: false,
} satisfies Partial<Workspace>;
export const useWorkspace = create<Workspace>((set) => ({
  ...cleanDocument,
  zoom: 100,
  layout: "continuous",
  tool: "select",
  sidebar: "pages",
  busy: false,
  status: "Ready",
  error: "",
  local: { preferences: defaultPreferences, recents: [], recovery: null },
  settingsOpen: false,
  matchCase: false,
  wholeWord: false,
  highlightColor: "#f5cf58",
  inkColor: "#25604b",
  inkWidth: 2,
  toolMode: null,
  activeModal: null,
  quickRailVisible: true,
  set,
  reset: () =>
    set({
      ...cleanDocument,
      tool: "select",
      toolMode: null,
      activeModal: null,
      status: "Ready",
      error: "",
    }),
}));

import { create } from "zustand";
import type {
  DocumentDescriptor,
  DocumentInfo,
  Layout,
  ShapeKind,
  SidebarTab,
  Tool,
  ToolMode,
  LocalState,
  SearchResult,
  Bookmark,
  Comment,
  DocumentLayer,
} from "../types/document";
import type { ReadAloudState } from "../features/viewer/read-aloud";
import { defaultPreferences } from "../types/document";
interface Workspace {
  document: DocumentDescriptor | null;
  info: DocumentInfo | null;
  page: number;
  zoom: number;
  layout: Layout;
  viewRotation: 0 | 90 | 180 | 270;
  spread: "none" | "odd" | "even";
  readMode: boolean;
  nightMode: boolean;
  pageLabels: string[] | null;
  tool: Tool;
  sidebar: SidebarTab;
  navigationVisible: boolean;
  propertiesVisible: boolean;
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
  /** Incremented to move keyboard focus to the search field, even when it is already shown. */
  searchFocus: number;
  /** Incremented to move keyboard focus to the page number field. */
  pageFocus: number;
  canGoBack: boolean;
  canGoForward: boolean;
  layers: DocumentLayer[];
  readAloud: ReadAloudState;
  autoScroll: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  searchCount: number;
  searchPending: boolean;
  results: SearchResult[];
  bookmarks: Bookmark[];
  comments: Comment[];
  redactionSelection: import("../types/document").SelectedTextGeometry[];
  selectedAnnotationId: string | null;
  renderedPages: number;
  firstRenderMs: number | null;
  highlightColor: string;
  inkColor: string;
  inkWidth: number;
  inkOpacity: number;
  shapeKind: ShapeKind;
  toolMode: ToolMode | null;
  activeModal: string | null;
  quickRailVisible: boolean;
  selectedPages: number[];
  activeSnapshot: boolean;
  hasDigitalSignature: boolean;
  formNotice: string | null;
  revision: number;
  editingAllowed: boolean;
  set: (patch: Partial<Omit<Workspace, "set" | "reset">>) => void;
  reset: () => void;
}
const cleanDocument = {
  document: null,
  info: null,
  page: 1,
  hasDigitalSignature: false,
  formNotice: null,
  revision: 0,
  viewRotation: 0,
  spread: "none",
  readMode: false,
  nightMode: false,
  pageLabels: null,
  editingAllowed: true,
  dirty: false,
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  bookmarks: [],
  comments: [],
  layers: [],
  canGoBack: false,
  canGoForward: false,
  redactionSelection: [],
  selectedAnnotationId: null,
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
  navigationVisible: false,
  propertiesVisible: false,
  busy: false,
  status: "Ready",
  error: "",
  local: { preferences: defaultPreferences, recents: [], recoveries: [] },
  settingsOpen: false,
  searchFocus: 0,
  pageFocus: 0,
  readAloud: "idle",
  autoScroll: false,
  matchCase: false,
  wholeWord: false,
  highlightColor: "#f5cf58",
  inkColor: "#25604b",
  inkWidth: 2,
  inkOpacity: 1,
  shapeKind: "Square",
  toolMode: null,
  activeModal: null,
  quickRailVisible: true,
  set: (patch) => set({ ...(patch.sidebar ? { navigationVisible: true } : {}), ...patch }),
  reset: () =>
    set({
      ...cleanDocument,
      tool: "select",
      toolMode: null,
      activeModal: null,
      busy: false,
      status: "Ready",
      error: "",
    }),
}));

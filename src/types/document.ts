export type Layout = "continuous" | "single" | "spread";
export type ToolMode = "all" | "edit" | "convert" | "esign" | "create";
export type Tool =
  "select" | "hand" | "highlight" | "ink" | "draw" | "text" | "shape" | "signature" | "snapshot";
export type ShapeKind = "Square" | "Circle" | "Line" | "Arrow";
export type SidebarTab = "pages" | "bookmarks" | "search" | "comments" | "tools";
export interface DocumentDescriptor {
  unsaved?: boolean;
  id: string;
  name: string;
  size: number;
  revisionId?: string;
}
export interface SaveResult {
  name: string;
  size: number;
}
export type ColorPalette =
  | "default"
  | "amber"
  | "coral"
  | "ocean"
  | "violet"
  | "acrobat"
  | "midnight"
  | "graphite"
  | "rose"
  | "crimson"
  | "mint"
  | "teal"
  | "lime"
  | "sepia"
  | "slate";
export interface ThemeOverrides {
  background: string | null;
  accent: string | null;
}
export interface Preferences {
  theme: "system" | "light" | "dark";
  lightPalette: ColorPalette;
  darkPalette: ColorPalette;
  lightOverrides: ThemeOverrides;
  darkOverrides: ThemeOverrides;
  defaultZoom: string;
  layout: Layout;
  rememberPage: boolean;
  autosave: boolean;
  recentFiles: boolean;
  networkAccess: boolean;
  saveBehavior: "ask" | "save-as";
  confirmOnDelete: boolean;
  annotationColor: string;
  annotationStrokeWidth: number;
  ocrLanguage: string;
  ocrScope: "current" | "all";
}
export interface RecentDocument {
  id: string;
  name: string;
  openedAt: number;
  page: number;
}
export interface LocalState {
  preferences: Preferences;
  recents: RecentDocument[];
  recoveries: RecoveryEntry[];
}
/** An autosaved copy of a document that was not saved before NavPDF closed. */
export interface RecoveryEntry {
  id: string;
  name: string;
  pages: number;
  savedAt: number;
}
export interface SearchResult {
  page: number;
  index: number;
  context: string;
  match: string;
}
export interface Bookmark {
  title: string;
  destination: string | unknown[] | null;
  children: Bookmark[];
}
export interface Comment {
  id: string;
  page: number;
  type: string;
  text: string;
  rect?: [number, number, number, number];
  line?: [number, number, number, number];
  lineEndings?: [string, string];
  quads?: number[][];
  color?: [number, number, number];
  opacity?: number;
  width?: number;
  vertices?: number[][];
  callout?: number[];
  stampName?: string;
  replyTo?: string;
  reviewState?: "Accepted" | "Rejected" | "Cancelled" | "Completed";
}
export interface SelectedTextGeometry {
  page: number;
  quads: { x1: number; y1: number; x2: number; y2: number }[];
  text: string;
}
export interface DocumentInfo {
  pages: number;
  encrypted: boolean;
  /** An unlocked working copy of a password-protected file; saving asks how to protect it. */
  protectedSource?: boolean;
  title: string;
  author: string;
  version: string;
}
export const defaultPreferences: Preferences = {
  theme: "system",
  lightPalette: "default",
  darkPalette: "default",
  lightOverrides: { background: null, accent: null },
  darkOverrides: { background: null, accent: null },
  defaultZoom: "page-fit",
  layout: "continuous",
  rememberPage: true,
  autosave: true,
  recentFiles: true,
  networkAccess: false,
  saveBehavior: "ask",
  confirmOnDelete: true,
  annotationColor: "#f5cf58",
  annotationStrokeWidth: 2,
  ocrLanguage: "en-US",
  ocrScope: "current",
};

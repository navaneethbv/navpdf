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
export interface Preferences {
  theme: "system" | "light" | "dark";
  defaultZoom: string;
  layout: Layout;
  rememberPage: boolean;
  autosave: boolean;
  recentFiles: boolean;
  networkAccess: boolean;
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
  defaultZoom: "page-fit",
  layout: "continuous",
  rememberPage: true,
  autosave: true,
  recentFiles: true,
  networkAccess: false,
};

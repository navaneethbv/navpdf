export type Layout = "continuous" | "single" | "spread";
export type ToolMode = "all" | "edit" | "convert" | "esign" | "create";
export type Tool =
  | "select"
  | "hand"
  | "highlight"
  | "ink"
  | "draw"
  | "text"
  | "signature"
  | "snapshot";
export type SidebarTab = "pages" | "bookmarks" | "search" | "comments" | "tools";
export interface DocumentDescriptor {
  id: string;
  name: string;
  size: number;
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
  recovery: { name: string; savedAt: number } | null;
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
}
export interface DocumentInfo {
  pages: number;
  encrypted: boolean;
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

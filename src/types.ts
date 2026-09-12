export type Rect = [number, number, number, number];
export type Point = [number, number];
export type Tool =
  | "select"
  | "replaceText"
  | "text"
  | "highlight"
  | "comment"
  | "draw"
  | "image"
  | "signature"
  | "redact"
  | "crop";
export type Panel =
  | "tools"
  | "organize"
  | "forms"
  | "search"
  | "ocr"
  | "password"
  | "metadata"
  | "annotations";
export interface DocInfo {
  name: string;
  count: number;
  revision: number;
  dirty: boolean;
  undo: boolean;
  redo: boolean;
  ocr: boolean;
  sensitive: boolean;
  metadata: Record<string, string>;
  pages: { width: number; height: number; rotation: number }[];
}
export interface Span {
  text: string;
  rect: Rect;
  origin: Point;
  size: number;
  font: string;
  color: string;
}
export interface Details {
  spans: Span[];
  widgets: {
    id: number;
    name: string;
    value: string;
    type: string;
    choices: string[] | null;
    on: string;
    readonly: boolean;
  }[];
  annotations: { id: number; text: string; type: string }[];
}
export interface SearchHit {
  page: number;
  rect: Rect;
}
export interface Selection {
  rect: Rect;
  origin?: Point;
  text?: string;
  size?: number;
  color?: string;
  font?: string;
}
export type Command = { op: string; [key: string]: unknown };
declare global {
  interface Window {
    navpdf?: {
      call: (args: Command) => Promise<any>;
      save: (payload: { data: string; name: string }) => Promise<boolean>;
      dirty: (value: boolean) => void;
    };
  }
}

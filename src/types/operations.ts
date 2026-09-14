export type PageRotation = 90 | 180 | 270 | -90;

export interface PageMutationOptions {
  pageIndices: number[]; // 0-based page indices
  rotation?: PageRotation;
  targetIndex?: number;
  cropBox?: { x: number; y: number; width: number; height: number };
}

export interface SplitOptions {
  mode: "all-pages" | "ranges";
  ranges?: string; // e.g. "1-3, 4-6"
}

export interface MergeInputItem {
  name?: string;
  bytes: Uint8Array;
  ranges?: number[]; // optional 0-based page indices to include
}

export interface OperationManifestItem {
  filename: string;
  pageCount: number;
  sourcePages?: number[];
}

export interface OperationManifest {
  operation: "split" | "merge" | "extract";
  items: OperationManifestItem[];
  warnings?: string[];
}

export interface DocumentRevision {
  revisionId: string;
  bytes: Uint8Array;
  numPages: number;
  description: string;
  timestamp: number;
  baseRevisionId?: string;
  pageMapping?: number[]; // maps each new page index to its source page index, or -1 for newly inserted pages
  warnings?: string[];
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, width, height] normalized [0..1]
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
  words: OcrWord[];
}

export interface OcrPageResult {
  pageIndex: number;
  language: string;
  lines: OcrLine[];
  fullText: string;
  meanConfidence: number;
}

export interface OcrEngineInfo {
  engineName: string;
  isOffline: boolean;
  supportedLanguages: string[];
}

export interface OcrOptions {
  pageIndex: number;
  language?: string;
  fastMode?: boolean;
}

export interface ExportTextOptions {
  scope: "all" | "current" | "custom";
  customRange?: string;
  includePageBreaks?: boolean;
}

export interface ExportImageOptions {
  format: "png" | "jpg";
  dpi: 72 | 150 | 300;
  scope: "current" | "all" | "custom";
  customRange?: string;
  quality?: number;
}

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

export interface MergeInput {
  name: string;
  bytes: Uint8Array;
}

export interface InsertPageOptions {
  atIndex: number;
  width?: number;
  height?: number;
  imageBytes?: Uint8Array;
  imageType?: "png" | "jpg";
}

export interface DocumentRevision {
  revisionId: string;
  bytes: Uint8Array;
  numPages: number;
  description: string;
  timestamp: number;
}

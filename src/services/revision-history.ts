import type { DocumentRevision } from "../types/operations";

const sameBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const copyRevision = (revision: DocumentRevision): DocumentRevision => ({
  ...revision,
  bytes: new Uint8Array(revision.bytes),
});

/**
 * Bounded, byte-backed history for mutations that replace the PDF.js proxy.
 * PDF.js keeps its own editor history for a live editor. This class covers
 * adapter and whole-document mutations after their candidate bytes have been
 * staged and validated.
 */
export class RevisionHistory {
  private readonly limit: number;
  private past: DocumentRevision[] = [];
  private future: DocumentRevision[] = [];
  private current: DocumentRevision | null = null;
  private savedRevisionId: string | null = null;
  private sequence = 0;

  constructor(limit = 20) {
    this.limit = Math.max(1, limit);
  }

  clear() {
    this.past = [];
    this.future = [];
    this.current = null;
    this.savedRevisionId = null;
  }

  getCurrent(): DocumentRevision | null {
    return this.current ? copyRevision(this.current) : null;
  }

  seed(
    revision: Omit<DocumentRevision, "revisionId" | "timestamp"> & {
      revisionId?: string;
    },
  ): DocumentRevision {
    const next = this.withIdentity(revision);
    this.past = [];
    this.future = [];
    this.current = next;
    this.savedRevisionId = next.revisionId;
    return copyRevision(next);
  }

  /** Adopt a serialized native-editor change before an adapter mutation. */
  adopt(
    revision: Omit<DocumentRevision, "revisionId" | "timestamp"> & {
      revisionId?: string;
      baseRevisionId?: string;
      pageMapping?: number[];
      warnings?: string[];
    },
  ): DocumentRevision {
    if (!this.current) {
      return this.seed(revision);
    }
    if (
      revision.baseRevisionId &&
      this.current.revisionId !== revision.baseRevisionId
    ) {
      throw new Error("Stale base revision. The document has been modified.");
    }
    if (sameBytes(this.current.bytes, revision.bytes)) {
      return copyRevision(this.current);
    }
    this.pushPast(this.current);
    this.current = this.withIdentity(revision);
    this.future = [];
    return copyRevision(this.current);
  }

  record(
    revision: Omit<DocumentRevision, "revisionId" | "timestamp"> & {
      revisionId?: string;
      baseRevisionId?: string;
      pageMapping?: number[];
      warnings?: string[];
    },
  ): DocumentRevision {
    return this.adopt(revision);
  }

  markSaved() {
    this.savedRevisionId = this.current?.revisionId ?? null;
  }

  markUnsaved() {
    this.savedRevisionId = null;
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  isAtSavedRevision() {
    return this.current?.revisionId === this.savedRevisionId;
  }

  undo(): DocumentRevision | null {
    if (!this.current || this.past.length === 0) return null;
    this.future.unshift(this.current);
    this.current = this.past.pop() ?? null;
    return this.current ? copyRevision(this.current) : null;
  }

  redo(): DocumentRevision | null {
    if (!this.current || this.future.length === 0) return null;
    this.past.push(this.current);
    this.current = this.future.shift() ?? null;
    return this.current ? copyRevision(this.current) : null;
  }

  /** Restore the history cursor if loading a staged undo/redo candidate fails. */
  restoreAfterFailedMove(direction: "undo" | "redo") {
    if (direction === "undo") this.redo();
    else this.undo();
  }

  private pushPast(revision: DocumentRevision) {
    this.past.push(copyRevision(revision));
    if (this.past.length > this.limit) this.past.shift();
  }

  private withIdentity(
    revision: Omit<DocumentRevision, "revisionId" | "timestamp"> & {
      revisionId?: string;
    },
  ): DocumentRevision {
    this.sequence++;
    const revisionId = revision.revisionId ?? `revision-${this.sequence}`;
    return {
      ...revision,
      bytes: new Uint8Array(revision.bytes),
      revisionId,
      timestamp: Date.now(),
    };
  }
}

import { describe, expect, it } from "vitest";
import { RevisionHistory } from "../../src/services/revision-history";

const revision = (value: number, description = `Revision ${value}`) => ({
  bytes: new Uint8Array([value]),
  numPages: 1,
  description,
});

describe("RevisionHistory", () => {
  it("keeps a bounded cursor and marks the saved revision", () => {
    const history = new RevisionHistory(2);
    history.seed(revision(0));
    history.record(revision(1));
    history.record(revision(2));
    history.record(revision(3));

    expect(history.canUndo()).toBe(true);
    expect(history.undo()?.bytes).toEqual(new Uint8Array([2]));
    expect(history.undo()?.bytes).toEqual(new Uint8Array([1]));
    expect(history.undo()).toBeNull();
    expect(history.isAtSavedRevision()).toBe(false);
  });

  it("clears the redo branch after a new record", () => {
    const history = new RevisionHistory();
    history.seed(revision(0));
    history.record(revision(1));
    expect(history.undo()?.bytes).toEqual(new Uint8Array([0]));
    expect(history.canRedo()).toBe(true);
    history.record(revision(2));
    expect(history.canRedo()).toBe(false);
    expect(history.undo()?.bytes).toEqual(new Uint8Array([0]));
  });

  it("adopts a native revision without duplicating identical bytes", () => {
    const history = new RevisionHistory();
    history.seed(revision(0));
    history.adopt(revision(0, "same native revision"));
    expect(history.undo()).toBeNull();
    history.adopt(revision(1, "native edit"));
    history.markSaved();
    expect(history.isAtSavedRevision()).toBe(true);
    expect(history.undo()?.bytes).toEqual(new Uint8Array([0]));
    expect(history.isAtSavedRevision()).toBe(false);
  });

  it("restores its cursor when a staged load fails", () => {
    const history = new RevisionHistory();
    history.seed(revision(0));
    history.record(revision(1));
    expect(history.undo()?.bytes).toEqual(new Uint8Array([0]));
    history.restoreAfterFailedMove("undo");
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("tracks current revision, validates base revision, and stores page mapping", () => {
    const history = new RevisionHistory();
    expect(history.getCurrent()).toBeNull();

    const base = history.seed({
      bytes: new Uint8Array([10]),
      numPages: 2,
      description: "Initial",
      revisionId: "rev-base-1",
    });
    expect(history.getCurrent()?.revisionId).toBe("rev-base-1");

    // Valid mutation with matching baseRevisionId
    const next = history.record({
      bytes: new Uint8Array([20]),
      numPages: 2,
      description: "Reordered",
      baseRevisionId: base.revisionId,
      pageMapping: [1, 0],
      warnings: ["Catalog preserved in-place"],
    });
    expect(next.revisionId).toBeDefined();
    expect(history.getCurrent()?.pageMapping).toEqual([1, 0]);
    expect(history.getCurrent()?.warnings).toEqual(["Catalog preserved in-place"]);

    // Stale base rejection: cannot branch from an obsolete base revision
    expect(() => {
      history.record({
        bytes: new Uint8Array([30]),
        numPages: 2,
        description: "Stale edit",
        baseRevisionId: "obsolete-rev-id",
      });
    }).toThrow(/Stale base revision/);
  });

  it("evicts the oldest retained revisions by byte budget", () => {
    const history = new RevisionHistory({ maxEntries: 20, maxBytes: 7 });
    history.seed({ bytes: new Uint8Array([0, 0, 0]), numPages: 1, description: "Initial" });
    history.record({ bytes: new Uint8Array([1, 1, 1]), numPages: 1, description: "First" });
    history.record({ bytes: new Uint8Array([2, 2, 2]), numPages: 1, description: "Second" });

    expect(history.undo()?.bytes).toEqual(new Uint8Array([1, 1, 1]));
    expect(history.undo()).toBeNull();
  });

  it("returns the retained current revision without copying its bytes", () => {
    const history = new RevisionHistory();
    history.seed({ bytes: new Uint8Array([1]), numPages: 1, description: "Initial" });
    expect(history.getCurrent()).toBe(history.getCurrent());
  });

  it("handles empty cursors, redo, unsaved state, and reset", () => {
    const history = new RevisionHistory({ maxEntries: 2, maxBytes: 10 });
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    const first = history.record(revision(1));
    expect(first.revisionId).toBeDefined();
    history.record(revision(2));
    expect(history.undo()?.bytes).toEqual(new Uint8Array([1]));
    expect(history.redo()?.bytes).toEqual(new Uint8Array([2]));
    history.markUnsaved();
    expect(history.isAtSavedRevision()).toBe(false);
    history.restoreAfterFailedMove("redo");
    expect(history.getCurrent()?.bytes).toEqual(new Uint8Array([1]));
    history.clear();
    expect(history.getCurrent()).toBeNull();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("seeds when adopting the first revision and rejects stale native bases", () => {
    const history = new RevisionHistory();
    history.adopt({ bytes: new Uint8Array([1]), numPages: 1, description: "First" });
    expect(() =>
      history.adopt({
        bytes: new Uint8Array([2]),
        numPages: 1,
        description: "Stale",
        baseRevisionId: "different",
      }),
    ).toThrow(/Stale base revision/);
  });

  it("uses a machine-relative default byte budget when available", () => {
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      value: 8,
    });
    const history = new RevisionHistory();
    history.seed({ bytes: new Uint8Array([1]), numPages: 1, description: "Initial" });
    expect(history.getCurrent()?.bytes).toEqual(new Uint8Array([1]));
    delete (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  });
});

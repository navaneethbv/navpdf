import { useEffect, useRef, useState } from "react";
import { FeatureDialog } from "../../components/FeatureDialog";
import { loadBookmarks, saveBookmarks, type EditableBookmark } from "../../services/pdf/bookmarks";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

interface Row extends Omit<EditableBookmark, "children"> {
  parent: string;
}
export function flattenBookmarks(nodes: EditableBookmark[], parent = ""): Row[] {
  return nodes.flatMap(({ children, ...node }) => [
    { ...node, parent },
    ...flattenBookmarks(children, node.id),
  ]);
}
export function nestBookmarks(
  rows: Row[],
  parent = "",
  ancestors = new Set<string>(),
): EditableBookmark[] {
  if (ancestors.size > 32) throw new Error("Bookmark nesting exceeds 32 levels.");
  return rows.flatMap(({ parent: rowParent, ...node }) => {
    if (rowParent !== parent) return [];
    if (ancestors.has(node.id)) throw new Error("Circular bookmark nesting.");
    return [{ ...node, children: nestBookmarks(rows, node.id, new Set([...ancestors, node.id])) }];
  });
}
function descendants(rows: Row[], id: string): Set<string> {
  const result = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows)
      if (result.has(row.parent) && !result.has(row.id)) {
        result.add(row.id);
        changed = true;
      }
  }
  return result;
}
export function BookmarkEditor({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const source = useRef<{ pdf: NonNullable<ViewerController["pdf"]>; bytes: Uint8Array } | null>(
    null,
  );
  const encrypted = useWorkspace((s) => s.info?.encrypted);
  useEffect(() => {
    let alive = true;
    const pdf = controller?.pdf;
    if (!pdf) return;
    void pdf
      .saveDocument()
      .then(async (bytes) => {
        const tree = await loadBookmarks(bytes);
        if (alive) {
          source.current = { pdf, bytes };
          setRows(flattenBookmarks(tree));
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [controller]);
  const update = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const changeParent = (id: string, parent: string) => {
    const next = rows.map((row) => (row.id === id ? { ...row, parent } : row));
    try {
      // Validate the entire moved subtree before publishing state used during rendering.
      nestBookmarks(next);
      setRows(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const move = (id: string, direction: number) =>
    setRows((current) => {
      const next = [...current],
        index = next.findIndex((row) => row.id === id);
      const siblings = next
        .map((row, i) => (row.parent === next[index].parent ? i : -1))
        .filter((i) => i >= 0);
      const other = siblings[siblings.indexOf(index) + direction];
      if (other !== undefined) [next[index], next[other]] = [next[other], next[index]];
      return next;
    });
  const save = async () => {
    if (!source.current || !controller) return;
    setBusy(true);
    setError("");
    try {
      const bytes = await saveBookmarks(source.current.bytes, nestBookmarks(rows));
      await controller.replaceWithBytes(bytes, "Updated bookmarks", {
        expectedSource: source.current.pdf,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const ordered = flattenBookmarks(nestBookmarks(rows));
  return (
    <FeatureDialog title="Edit bookmarks" onClose={onClose} busy={busy}>
      <div className="modal-dialog wide-tool-dialog">
        <div className="modal-header">
          <h3>Edit bookmarks</h3>
        </div>
        <div className="modal-body">
          {error && <p role="alert">{error}</p>}
          <p>
            Add, rename, nest, reorder or delete bookmarks. Page numbers start at 1. Deleting a
            bookmark also deletes its children.
          </p>
          <fieldset disabled={busy || !loaded || !!encrypted} className="bookmark-editor-list">
            {ordered.map((row) => {
              const excluded = descendants(rows, row.id);
              const siblings = ordered.filter((other) => other.parent === row.parent);
              return (
                <div className="bookmark-editor-row" key={row.id}>
                  <label>
                    Title{" "}
                    <input
                      className="text-input"
                      value={row.title}
                      maxLength={1000}
                      onChange={(event) => update(row.id, { title: event.target.value })}
                    />
                  </label>
                  <label>
                    Page{" "}
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      max={source.current?.pdf.numPages}
                      value={row.page === null ? "" : row.page + 1}
                      placeholder="Heading"
                      onChange={(event) =>
                        update(row.id, {
                          page: event.target.value === "" ? null : Number(event.target.value) - 1,
                          view: undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    Parent{" "}
                    <select
                      value={row.parent}
                      onChange={(event) => changeParent(row.id, event.target.value)}
                    >
                      <option value="">Top level</option>
                      {ordered
                        .filter((other) => !excluded.has(other.id))
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    aria-label={`Move ${row.title} up`}
                    disabled={siblings[0]?.id === row.id}
                    onClick={() => move(row.id, -1)}
                  >
                    Up
                  </button>
                  <button
                    aria-label={`Move ${row.title} down`}
                    disabled={siblings.at(-1)?.id === row.id}
                    onClick={() => move(row.id, 1)}
                  >
                    Down
                  </button>
                  <button
                    aria-label={`Delete ${row.title}`}
                    onClick={() =>
                      setRows((current) => current.filter((other) => !excluded.has(other.id)))
                    }
                  >
                    Delete
                  </button>
                </div>
              );
            })}
            <button
              className="button-secondary"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    title: "New bookmark",
                    page: useWorkspace.getState().page - 1,
                    parent: "",
                  },
                ])
              }
            >
              Add bookmark at current page
            </button>
          </fieldset>
        </div>
        <div className="modal-footer">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            disabled={busy || !loaded || !!encrypted}
            onClick={() => void save()}
          >
            Save bookmarks
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

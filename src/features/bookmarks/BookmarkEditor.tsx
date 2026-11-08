import { useEffect, useRef, useState } from "react";
import { FeatureDialog } from "../../components/FeatureDialog";
import { loadBookmarks, saveBookmarks, type EditableBookmark } from "../../services/pdf/bookmarks";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { downloadBytes, safeFileName } from "../../utils/download";
import {
  bookmarksForDocument,
  exportBookmarksJson,
  getBookmarkClipboard,
  parseBookmarksJson,
  setBookmarkClipboard,
} from "./bookmark-transfer";

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
/** One bookmark with its subtree, from the editor's rows. */
function subtree(rows: Row[], id: string): EditableBookmark | null {
  const find = (nodes: EditableBookmark[]): EditableBookmark | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };
  return find(nestBookmarks(rows));
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
  const [notice, setNotice] = useState("");
  const [hasClip, setHasClip] = useState(() => !!getBookmarkClipboard());
  const [importMode, setImportMode] = useState<"add" | "replace">("add");
  const importInput = useRef<HTMLInputElement>(null);
  const pageCount = () => source.current?.pdf.numPages ?? 0;
  const copy = (id: string, cut: boolean) => {
    const node = subtree(rows, id);
    if (!node) return;
    setBookmarkClipboard([node]);
    setHasClip(true);
    if (cut) {
      const removed = descendants(rows, id);
      setRows((current) => current.filter((row) => !removed.has(row.id)));
    }
    setNotice(`${cut ? "Cut" : "Copied"} "${node.title}" with its children.`);
  };
  /** Adds bookmarks under `parent` ("" for the top level), after its existing children. */
  const insert = (nodes: EditableBookmark[], parent: string, what: string) => {
    const { nodes: placed, unplaced } = bookmarksForDocument(nodes, pageCount());
    setRows((current) => [...current, ...flattenBookmarks(placed, parent)]);
    if (unplaced) {
      const subject = unplaced === 1 ? "bookmark has" : "bookmarks have";
      setNotice(
        `${what}; ${unplaced} ${subject} no destination because this document has fewer pages.`,
      );
    } else {
      setNotice(`${what}.`);
    }
  };
  const paste = (parent: string) => {
    const clip = getBookmarkClipboard();
    if (clip) insert(clip, parent, "Pasted bookmarks");
  };
  const exportJson = async (id?: string) => {
    try {
      const tree = id ? [subtree(rows, id)!] : nestBookmarks(rows);
      const name = useWorkspace.getState().document?.name ?? "document.pdf";
      await downloadBytes(
        new TextEncoder().encode(exportBookmarksJson(tree)),
        safeFileName(`${name.replace(/\.pdf$/i, "")}-bookmarks.json`),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importJson = async (file: File) => {
    try {
      const nodes = parseBookmarksJson(await file.text());
      if (importMode === "replace") {
        const { nodes: placed, unplaced } = bookmarksForDocument(nodes, pageCount());
        setRows(flattenBookmarks(placed));
        const destinations = unplaced ? `; ${unplaced} have no destination` : "";
        setNotice(`Replaced the bookmarks with ${file.name}${destinations}. Save to keep them.`);
      } else insert(nodes, "", `Added the bookmarks from ${file.name}. Save to keep them`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
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
          {notice && <output>{notice}</output>}
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
                  <button aria-label={`Cut ${row.title}`} onClick={() => copy(row.id, true)}>
                    Cut
                  </button>
                  <button aria-label={`Copy ${row.title}`} onClick={() => copy(row.id, false)}>
                    Copy
                  </button>
                  <button
                    aria-label={`Paste inside ${row.title}`}
                    disabled={!hasClip}
                    onClick={() => paste(row.id)}
                  >
                    Paste inside
                  </button>
                  <button
                    aria-label={`Export ${row.title}`}
                    onClick={() => void exportJson(row.id)}
                  >
                    Export
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
          <fieldset
            disabled={busy || !loaded || !!encrypted}
            className="bookmark-transfer"
            aria-label="Copy, import and export bookmarks"
          >
            <button className="button-secondary" disabled={!hasClip} onClick={() => paste("")}>
              Paste bookmarks at top level
            </button>
            <button
              className="button-secondary"
              disabled={!rows.length}
              onClick={() => void exportJson()}
            >
              Export all as JSON
            </button>
            <label>
              Import{" "}
              <select
                aria-label="How to import bookmarks"
                value={importMode}
                onChange={(event) => setImportMode(event.target.value as "add" | "replace")}
              >
                <option value="add">Add at top level</option>
                <option value="replace">Replace all bookmarks</option>
              </select>
            </label>
            <button className="button-secondary" onClick={() => importInput.current?.click()}>
              Import JSON…
            </button>
            <input
              ref={importInput}
              hidden
              type="file"
              accept="application/json,.json"
              aria-label="Bookmark JSON file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importJson(file);
              }}
            />
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

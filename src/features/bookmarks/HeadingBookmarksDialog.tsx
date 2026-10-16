import { useEffect, useId, useRef, useState } from "react";
import { Heading } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { loadBookmarks, saveBookmarks } from "../../services/pdf/bookmarks";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import { detectHeadings, headingBookmarks, type HeadingCandidate } from "./heading-bookmarks";

export function HeadingBookmarksDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const [levels, setLevels] = useState(2);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [headings, setHeadings] = useState<HeadingCandidate[] | null>(null);
  const [progress, setProgress] = useState("");
  const [loadError, setLoadError] = useState("");
  const { apply, busy, error } = useDocumentEdit(controller);
  const source = useRef(controller?.pdf);

  useEffect(() => {
    const pdf = controller?.pdf;
    source.current = pdf;
    if (!pdf) return;
    const abort = new AbortController();
    setHeadings(null);
    setLoadError("");
    detectHeadings(pdf, levels, {
      signal: abort.signal,
      onProgress: (page, total) => setProgress(`Reading page ${page} of ${total}`),
    })
      .then((found) => {
        if (!abort.signal.aborted) setHeadings(found);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setLoadError(errorMessage(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setProgress("");
      });
    return () => abort.abort();
  }, [controller, levels]);

  const save = async () => {
    if (!headings?.length) return;
    const created = headingBookmarks(headings);
    const detectedFrom = source.current;
    const saved = await apply(
      `Created ${headings.length} bookmarks from headings`,
      async (bytes) => {
        if (detectedFrom !== controller?.pdf)
          throw new Error("The document changed after the headings were found. Reopen this tool.");
        const existing = mode === "append" ? await loadBookmarks(bytes) : [];
        return saveBookmarks(bytes, [...existing, ...created]);
      },
    );
    if (saved) onClose();
  };

  return (
    <ToolDialog
      title="Bookmarks from Headings"
      icon={<Heading size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel="Create Bookmarks"
      busyLabel="Creating…"
      primaryDisabled={!headings?.length}
      onPrimary={() => void save()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${id}-levels`}>
          Heading levels
        </label>
        <select
          id={`${id}-levels`}
          className="text-input"
          value={levels}
          disabled={busy}
          onChange={(event) => setLevels(Number(event.target.value))}
        >
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${id}-mode`}>
          Existing bookmarks
        </label>
        <select
          id={`${id}-mode`}
          className="text-input"
          value={mode}
          disabled={busy}
          onChange={(event) => setMode(event.target.value as "replace" | "append")}
        >
          <option value="replace">Replace them</option>
          <option value="append">Keep them and add the headings after</option>
        </select>
      </div>
      {progress && <output aria-live="polite">{progress}</output>}
      {headings && !headings.length && (
        <p className="field-hint">
          No headings were found. Headings are recognised by text larger than the body text.
        </p>
      )}
      {headings && headings.length > 0 && (
        <ol className="check-list" aria-label="Headings found">
          {headings.slice(0, 200).map((heading, index) => (
            <li
              key={`${heading.page}-${index}`}
              style={{ paddingLeft: `${(heading.level - 1) * 16}px` }}
            >
              {heading.title} <span className="field-hint">page {heading.page}</span>
            </li>
          ))}
          {headings.length > 200 && <li>… and {headings.length - 200} more</li>}
        </ol>
      )}
      <p className="field-hint">
        Headings are suggested from font size in the text layer, not from document tags. Review the
        list, and rename or rearrange the bookmarks afterwards in Edit Bookmarks.
      </p>
    </ToolDialog>
  );
}

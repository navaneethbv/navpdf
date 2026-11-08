import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Type } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { loadBookmarks, saveBookmarks } from "../../services/pdf/bookmarks";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import {
  MAX_STYLE_LEVELS,
  scanTextStyles,
  styleBookmarks,
  type DocumentTextStyle,
  type StyledLine,
} from "./style-bookmarks";

function styleLabel(style: DocumentTextStyle) {
  const weight = [style.bold && "bold", style.italic && "italic"].filter(Boolean).join(" ");
  return `${style.fontName} ${style.size} pt${weight ? ` ${weight}` : ""} (${style.lines} line${
    style.lines === 1 ? "" : "s"
  }): ${style.sample}`;
}

export function StyleBookmarksDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const [found, setFound] = useState<{ styles: DocumentTextStyle[]; lines: StyledLine[] } | null>(
    null,
  );
  const [levels, setLevels] = useState<string[]>([]);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [progress, setProgress] = useState("");
  const [loadError, setLoadError] = useState("");
  const { apply, busy, error } = useDocumentEdit(controller);
  const source = useRef(controller?.pdf);

  useEffect(() => {
    const pdf = controller?.pdf;
    source.current = pdf;
    if (!pdf) return;
    const abort = new AbortController();
    scanTextStyles(pdf as never, {
      signal: abort.signal,
      onProgress: (page, total) => setProgress(`Reading page ${page} of ${total}`),
    })
      .then((result) => {
        if (abort.signal.aborted) return;
        setFound(result);
        // The largest style is offered for level 1.
        setLevels(result.styles.length ? [result.styles[0].key] : []);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setLoadError(errorMessage(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setProgress("");
      });
    return () => abort.abort();
  }, [controller]);

  const chosen = levels.filter(Boolean);
  const preview = useMemo(() => {
    if (!found || !chosen.length) return { bookmarks: [], error: "" };
    try {
      return { bookmarks: styleBookmarks(found.lines, chosen), error: "" };
    } catch (cause) {
      return { bookmarks: [], error: errorMessage(cause) };
    }
  }, [found, chosen.join("\n")]);
  const count = (nodes: typeof preview.bookmarks): number =>
    nodes.reduce((total, node) => total + 1 + count(node.children), 0);
  const total = count(preview.bookmarks);

  const save = async () => {
    if (!total) return;
    const scannedFrom = source.current;
    const saved = await apply(`Created ${total} bookmarks from text styles`, async (bytes) => {
      if (scannedFrom !== controller?.pdf)
        throw new Error("The document changed after its styles were read. Reopen this tool.");
      const existing = mode === "append" ? await loadBookmarks(bytes) : [];
      return saveBookmarks(bytes, [...existing, ...preview.bookmarks]);
    });
    if (saved) onClose();
  };

  const setLevel = (index: number, key: string) =>
    setLevels((current) => {
      const next = [...current];
      next[index] = key;
      // A level needs the levels above it, so later ones are cleared when one is cleared.
      return key ? next : next.slice(0, index);
    });

  return (
    <ToolDialog
      title="Bookmarks from Text Styles"
      icon={<Type size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError || preview.error}
      primaryLabel="Create Bookmarks"
      busyLabel="Creating…"
      primaryDisabled={!total}
      onPrimary={() => void save()}
    >
      {progress && <output aria-live="polite">{progress}</output>}
      {found && !found.styles.length && (
        <p className="field-hint">This document has no text to make bookmarks from.</p>
      )}
      {found && found.styles.length > 0 && (
        <div className="setting-group">
          {Array.from({ length: Math.min(MAX_STYLE_LEVELS, chosen.length + 1) }, (_, index) => (
            <label key={index} className="setting-title" htmlFor={`${id}-level-${index}`}>
              Level {index + 1} style
              <select
                id={`${id}-level-${index}`}
                className="text-input"
                value={levels[index] ?? ""}
                disabled={busy}
                onChange={(event) => setLevel(index, event.target.value)}
              >
                <option value="">None</option>
                {found.styles
                  .filter((style) => style.key === levels[index] || !chosen.includes(style.key))
                  .map((style) => (
                    <option key={style.key} value={style.key}>
                      {styleLabel(style)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
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
            <option value="append">Keep them and add these after</option>
          </select>
        </div>
      )}
      {total > 0 && (
        <output>
          {total} bookmark{total === 1 ? "" : "s"} will be created.
        </output>
      )}
      <p className="field-hint">
        Every line set in a chosen style becomes a bookmark of that level. Styles are read from
        fonts in the text layer, not from document tags. Rename or rearrange the bookmarks
        afterwards in Edit Bookmarks.
      </p>
    </ToolDialog>
  );
}

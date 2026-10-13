import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { downloadBlob, safeFileName } from "../../utils/download";
import { csvField } from "../convert/formats";
import { errorMessage } from "../document/use-document-edit";
import { searchCriteriaKey } from "../../utils/search";

function safeSearchCell(value: string): string {
  // Spreadsheet readers may ignore leading spaces before a formula marker.
  return csvField(/^\s+[=+@-]/.test(value) ? `'${value}` : value);
}

/** Export only the bounded results visible in the search panel, with their full match count. */
export function SearchResultExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useWorkspace((state) => state.searchPending);
  const resultCount = useWorkspace((state) => state.results.length);
  const stale = useWorkspace(
    (state) =>
      state.searchResultsKey !==
      searchCriteriaKey(state.searchQuery, state.matchCase, state.wholeWord),
  );
  const mounted = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exportResults = async () => {
    if (running.current) return;
    const snapshot = useWorkspace.getState();
    if (
      snapshot.searchPending ||
      !snapshot.results.length ||
      snapshot.searchResultsKey !==
        searchCriteriaKey(snapshot.searchQuery, snapshot.matchCase, snapshot.wholeWord)
    )
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const rows = snapshot.results.map((result) =>
        [
          snapshot.searchQuery,
          String(result.page),
          String(result.index + 1),
          result.match,
          result.context,
          String(snapshot.searchCount),
          String(snapshot.results.length),
        ]
          .map(safeSearchCell)
          .join(","),
      );
      const header = "Query,Page,Match on page,Match,Context,Total matches,Exported matches";
      const csv = `\uFEFF${header}\r\n${rows.join("\r\n")}\r\n`;
      const name = safeFileName(snapshot.document?.name.replace(/\.pdf$/i, "") ?? "document");
      const saved = await downloadBlob(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        `${name}-search-results.csv`,
      );
      if (saved && mounted.current && useWorkspace.getState().document === snapshot.document) {
        snapshot.set({
          status: `Exported ${snapshot.results.length} of ${snapshot.searchCount} search matches`,
        });
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="search-export">
      <button
        type="button"
        className="button-secondary"
        disabled={busy || pending || stale || !resultCount}
        onClick={() => void exportResults()}
      >
        <Download size={14} /> {busy ? "Exporting…" : "Export displayed results"}
      </button>
      <p className="field-hint">
        CSV includes the displayed matches only (up to 250), with the total match count.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

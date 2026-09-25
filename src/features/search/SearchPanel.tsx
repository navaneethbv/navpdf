import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

function resultSummary(count: number, pending: boolean): string {
  if (pending) return "Searching...";
  return `${count} ${count === 1 ? "result" : "results"}`;
}

export function SearchPanel({ controller }: Readonly<{ controller: ViewerController }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusRequest = useWorkspace((s) => s.searchFocus);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);
  const query = useWorkspace((s) => s.searchQuery),
    matchCase = useWorkspace((s) => s.matchCase),
    wholeWord = useWorkspace((s) => s.wholeWord),
    results = useWorkspace((s) => s.results),
    count = useWorkspace((s) => s.searchCount),
    pending = useWorkspace((s) => s.searchPending),
    set = useWorkspace((s) => s.set);
  const summary = resultSummary(count, pending);
  useEffect(() => {
    const timer = setTimeout(() => controller.search(), 150);
    return () => clearTimeout(timer);
  }, [controller, query, matchCase, wholeWord]);
  return (
    <div className="search-panel">
      <label className="search-input">
        <Search size={16} />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search document"
          placeholder="Find in document"
          value={query}
          onChange={(e) => set({ searchQuery: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") controller.search(true, e.shiftKey);
          }}
        />
      </label>
      <div className="search-options">
        <label>
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => set({ matchCase: e.target.checked })}
          />{" "}
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => set({ wholeWord: e.target.checked })}
          />{" "}
          Whole word
        </label>
      </div>
      <div className="search-summary">
        <span>{summary}</span>
        <button
          className="icon-button"
          aria-label="Previous match"
          disabled={!count}
          onClick={() => controller.search(true, true)}
        >
          <ChevronUp size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Next match"
          disabled={!count}
          onClick={() => controller.search(true)}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="search-results">
        {results.map((r) => (
          <button
            key={`${r.page}-${r.index}`}
            onClick={() => controller.selectResult(r.page, r.index)}
          >
            <strong>Page {r.page}</strong>
            <span>{r.context}</span>
          </button>
        ))}
        {!pending && query && !count && (
          <p className="empty-message">
            No matches. Scanned pages need an existing OCR text layer.
          </p>
        )}
        {count > 250 && (
          <p className="empty-message">
            Showing the first 250 results. Use Next match to continue.
          </p>
        )}
      </div>
    </div>
  );
}

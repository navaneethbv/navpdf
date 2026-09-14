import { useEffect, useRef, useState } from "react";
import { BookOpen, Info, Search, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

export interface Passage {
  page: number;
  excerpt: string;
  score: number;
}

const MIN_PASSAGE_CHARS = 60;
const MAX_EXCERPT_CHARS = 320;

const termsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

/**
 * Extractive passage ranking over page text. A passage qualifies only when it contains at
 * least half of the distinct query terms, so unsupported questions return no citations.
 */
export function rankPassages(pages: { page: number; text: string }[], query: string, limit = 5): Passage[] {
  const terms = [...new Set(termsOf(query))];
  if (!terms.length) return [];
  const required = Math.ceil(terms.length / 2);
  const passages: Passage[] = [];
  for (const { page, text } of pages) {
    const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
    let buffer = "";
    const flush = () => {
      if (!buffer) return;
      const words = termsOf(buffer);
      const matched = terms.filter((term) => words.includes(term));
      if (matched.length >= required) {
        const occurrences = words.filter((word) => terms.includes(word)).length;
        passages.push({
          page,
          excerpt: buffer.length > MAX_EXCERPT_CHARS ? `${buffer.slice(0, MAX_EXCERPT_CHARS)}…` : buffer,
          score: matched.length * 10 + occurrences,
        });
      }
      buffer = "";
    };
    for (const sentence of sentences) {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
      if (buffer.length >= MIN_PASSAGE_CHARS) flush();
    }
    flush();
  }
  return passages.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limit);
}

export function AssistantPanel({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Passage[] | null>(null);
  const [progress, setProgress] = useState("");
  const texts = useRef<{ pdf: unknown; pages: { page: number; text: string }[] } | null>(null);
  const run = useRef(0);
  const pdf = controller?.pdf ?? null;

  useEffect(() => {
    // Citations from a previous document or revision must never be shown for this one.
    setResults(null);
  }, [pdf]);

  const pageTexts = async (token: number) => {
    if (!pdf) return null;
    if (texts.current?.pdf === pdf) return texts.current.pages;
    const pages: { page: number; text: string }[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      if (run.current !== token) return null;
      setProgress(`Reading page ${number} of ${pdf.numPages}…`);
      const content = await (await pdf.getPage(number)).getTextContent();
      const text = (content.items as { str?: string }[]).map((item) => item.str ?? "").join(" ");
      pages.push({ page: number, text });
    }
    texts.current = { pdf, pages };
    return pages;
  };

  const find = async () => {
    const token = ++run.current;
    setResults(null);
    try {
      const pages = await pageTexts(token);
      if (!pages || run.current !== token) return;
      setResults(rankPassages(pages, query));
    } catch (error) {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (run.current === token) setProgress("");
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Find and Cite Passages">
      <div className="modal-dialog assistant-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <BookOpen size={18} />
            <h3>Find and Cite Passages</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="security-status-box">
            <Info size={18} />
            <p>
              No local language model is installed, so NavPDF does not generate
              summaries, answers, translations, slides or audio, and nothing is
              downloaded or uploaded. This tool finds passages that contain your
              words and cites their pages.
            </p>
          </div>
          <form
            className="inline-field"
            onSubmit={(event) => {
              event.preventDefault();
              void find();
            }}
          >
            <label className="visually-hidden" htmlFor="passage-query">
              Words to find
            </label>
            <input
              id="passage-query"
              className="text-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Words to find, such as renewal notice period"
            />
            <button type="submit" className="button-primary" disabled={!pdf || !termsOf(query).length || !!progress}>
              <Search size={15} /> Find Passages
            </button>
          </form>
          {progress && (
            <div className="inline-field" aria-live="polite">
              <span className="field-hint">{progress}</span>
              <button
                className="button-secondary"
                onClick={() => {
                  run.current++;
                  setProgress("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {results && results.length === 0 && (
            <p className="field-hint" role="status">
              No passage in this document contains enough of those words, so there
              is nothing to cite. Try different words.
            </p>
          )}
          {results && results.length > 0 && (
            <div className="citations-list">
              {results.map((passage, index) => (
                <button
                  key={`${passage.page}-${index}`}
                  className="citation-card"
                  onClick={() => {
                    controller?.goTo(passage.page);
                    onClose();
                  }}
                >
                  <span className="citation-badge">Page {passage.page}</span>
                  <span className="citation-text">{passage.excerpt}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

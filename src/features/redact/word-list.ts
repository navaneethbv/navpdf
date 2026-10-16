export const MAX_WORD_LIST_TERMS = 500;
const MAX_WORD_LIST_BYTES = 256 * 1024;
const MAX_TERM_LENGTH = 200;

/** Unique non-empty lines of a word list, compared without regard to case. */
export function parseWordList(text: string, bytes = text.length): string[] {
  if (bytes > MAX_WORD_LIST_BYTES) throw new Error("Word lists must be smaller than 256 KB.");
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const term = line.trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    if (term.length > MAX_TERM_LENGTH)
      throw new Error(`Word list entries must be at most ${MAX_TERM_LENGTH} characters.`);
    seen.add(term.toLowerCase());
    terms.push(term);
  }
  if (!terms.length) throw new Error("The word list is empty.");
  if (terms.length > MAX_WORD_LIST_TERMS)
    throw new Error(`Word lists can contain at most ${MAX_WORD_LIST_TERMS} entries.`);
  return terms;
}

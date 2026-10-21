// A native date picker for form fields that carry Acrobat's AFDate format. The format name is
// read from the field's action string by PDF.js; the action itself is never run. Choosing a
// date writes the value in the field's own format, as a reader running the script would.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const TOKENS = /yyyy|yy|mmmm|mmm|mm|m|dd|d/g;

/** Formats an ISO date (yyyy-mm-dd) with AFDate tokens; unknown text is kept literally. */
export function formatDate(iso: string, format: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parts: Record<string, string> = {
    yyyy: String(year).padStart(4, "0"),
    yy: String(year % 100).padStart(2, "0"),
    mmmm: MONTHS[month - 1],
    mmm: MONTHS[month - 1].slice(0, 3),
    mm: String(month).padStart(2, "0"),
    m: String(month),
    dd: String(day).padStart(2, "0"),
    d: String(day),
  };
  return format.replaceAll(TOKENS, (token) => parts[token]);
}

/** Splits an AFDate format into tokens and literal text. */
function tokenize(format: string) {
  const parts: { token?: string; text?: string }[] = [];
  let last = 0;
  for (const match of format.matchAll(TOKENS)) {
    if (match.index > last) parts.push({ text: format.slice(last, match.index) });
    parts.push({ token: match[0] });
    last = match.index + match[0].length;
  }
  if (last < format.length) parts.push({ text: format.slice(last) });
  return parts;
}

const isDigit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";
const isLetter = (char: string | undefined) => char !== undefined && /[A-Za-z]/.test(char);

/** Reads a value written in `format` back to an ISO date, or null when it does not match. */
export function parseDate(value: string, format: string): string | null {
  const text = value.trim();
  let at = 0;
  let year = 0;
  let month = 0;
  let day = 0;
  for (const { token, text: literal } of tokenize(format)) {
    if (literal !== undefined) {
      if (text.slice(at, at + literal.length).toLowerCase() !== literal.toLowerCase()) return null;
      at += literal.length;
      continue;
    }
    const start = at;
    if (token!.startsWith("mmm")) {
      while (isLetter(text[at])) at++;
      const name = text.slice(start, at).toLowerCase();
      month =
        name.length >= 3
          ? MONTHS.findIndex((month) => month.toLowerCase().startsWith(name.slice(0, 3))) + 1
          : 0;
      continue;
    }
    const width = token!.length === 4 ? 4 : 2;
    while (at - start < width && isDigit(text[at])) at++;
    if (at === start || (width === 4 && at - start !== 4)) return null;
    const number = Number(text.slice(start, at));
    if (token === "yyyy") year = number;
    else if (token === "yy") year = 2000 + number;
    else if (token!.startsWith("m")) month = number;
    else day = number;
  }
  if (at !== text.length) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface DateFieldAnnotation {
  id: string;
  datetimeFormat?: string;
  datetimeType?: string;
}

/**
 * Turns each date-formatted text input in a rendered annotation layer into a native date input
 * while it has focus, then writes the chosen date back in the field's format.
 */
export function enhanceDateFields(layer: HTMLElement, annotations: DateFieldAnnotation[]) {
  for (const annotation of annotations) {
    const format = annotation.datetimeFormat;
    if (!format || /HH|MM|ss|h/.test(format)) continue;
    const input = layer.querySelector<HTMLInputElement>(
      `input[data-element-id="${CSS.escape(annotation.id)}"]`,
    );
    if (!input || input.dataset.navpdfDate) continue;
    input.dataset.navpdfDate = format;
    let original = "";
    input.addEventListener("focus", () => {
      original = input.value;
      const iso = parseDate(original, format);
      // Text that is not a date in this format stays editable as text, so it is never lost.
      if (original && !iso) return;
      input.type = "date";
      input.value = iso ?? "";
    });
    input.addEventListener("blur", () => {
      if (input.type !== "date") return;
      const iso = input.value;
      input.type = "text";
      input.value = iso ? formatDate(iso, format) : "";
      if (input.value === original) return;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

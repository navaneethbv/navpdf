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
  const parts: ({ token: string } | { text: string })[] = [];
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

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const monthFromName = (name: string) =>
  name.length >= 3
    ? MONTHS.findIndex((month) => month.toLowerCase().startsWith(name.slice(0, 3).toLowerCase())) +
      1
    : 0;

/**
 * Reads one token's value at `at`, storing it in `parts`. Returns the position after it, or -1
 * when the text there does not fit the token.
 */
function readToken(text: string, at: number, field: string, parts: DateParts) {
  let end = at;
  if (field.startsWith("mmm")) {
    while (isLetter(text.charAt(end))) end++;
    parts.month = monthFromName(text.slice(at, end));
    return end;
  }
  const width = field.length === 4 ? 4 : 2;
  while (end - at < width && isDigit(text.charAt(end))) end++;
  if (end === at || (width === 4 && end - at !== 4)) return -1;
  const number = Number(text.slice(at, end));
  if (field === "yyyy") parts.year = number;
  else if (field === "yy") parts.year = 2000 + number;
  else if (field.startsWith("m")) parts.month = number;
  else parts.day = number;
  return end;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Reads a value written in `format` back to an ISO date, or null when it does not match. */
export function parseDate(value: string, format: string): string | null {
  const text = value.trim();
  const parts: DateParts = { year: 0, month: 0, day: 0 };
  let at = 0;
  for (const part of tokenize(format)) {
    if ("token" in part) at = readToken(text, at, part.token, parts);
    else if (text.slice(at, at + part.text.length).toLowerCase() === part.text.toLowerCase())
      at += part.text.length;
    else return null;
    if (at < 0) return null;
  }
  if (at !== text.length) return null;
  const { year, month, day } = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
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

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

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Reads a value written in `format` back to an ISO date, or null when it does not match. */
export function parseDate(value: string, format: string): string | null {
  const order: string[] = [];
  let pattern = "";
  let last = 0;
  for (const match of format.matchAll(TOKENS)) {
    pattern += escape(format.slice(last, match.index));
    order.push(match[0]);
    pattern += match[0].startsWith("mmm")
      ? "([A-Za-z]+)"
      : match[0].length === 4
        ? "(\\d{4})"
        : "(\\d{1,2})";
    last = match.index + match[0].length;
  }
  pattern += escape(format.slice(last));
  const found = new RegExp(`^${pattern}$`, "i").exec(value.trim());
  if (!found) return null;
  let year = 0;
  let month = 0;
  let day = 0;
  order.forEach((token, index) => {
    const text = found[index + 1];
    if (token === "yyyy") year = Number(text);
    else if (token === "yy") year = 2000 + Number(text);
    else if (token.startsWith("mmm"))
      month =
        MONTHS.findIndex((name) => name.toLowerCase().startsWith(text.toLowerCase().slice(0, 3))) +
        1;
    else if (token.startsWith("m")) month = Number(text);
    else day = Number(text);
  });
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

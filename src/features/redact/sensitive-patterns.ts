// Finds common kinds of personal and financial data in text so they can be marked for
// redaction. Candidates are found with bounded expressions and then checked (card checksums,
// IBAN checksums, SSN ranges), which keeps false positives down. Matches are suggestions for
// review, not a guarantee that every occurrence has been found.

export type SensitiveKind = "email" | "phone" | "ssn" | "card" | "iban" | "date";

export const SENSITIVE_KINDS: [SensitiveKind, string][] = [
  ["email", "Email addresses"],
  ["phone", "Phone numbers"],
  ["ssn", "US Social Security numbers"],
  ["card", "Payment card numbers"],
  ["iban", "Bank account numbers (IBAN)"],
  ["date", "Dates"],
];

export interface SensitiveMatch {
  kind: SensitiveKind;
  start: number;
  end: number;
  text: string;
}

const digitsOf = (value: string) => value.replaceAll(/\D/g, "");

/** Luhn checksum used by payment card numbers. */
export function luhnValid(digits: string) {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** ISO 13616 IBAN check: move the country code and check digits to the end, then mod 97. */
export function ibanValid(value: string) {
  const compact = value.replaceAll(" ", "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.codePointAt(0) ?? 0;
    const value = code >= 65 ? String(code - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function ssnValid(value: string) {
  const [area, group, serial] = value.split("-");
  return (
    area !== "000" && area !== "666" && !area.startsWith("9") && group !== "00" && serial !== "0000"
  );
}

const EMAIL_LOCAL = /[\w.%+-]/;
const EMAIL_DOMAIN = /[\w.-]/;

/** Email addresses found by expanding around each "@", which avoids backtracking. */
function emails(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    let start = at;
    while (start > 0 && EMAIL_LOCAL.test(text[start - 1])) start--;
    let end = at + 1;
    while (end < text.length && EMAIL_DOMAIN.test(text[end])) end++;
    while (end > at + 1 && !/[a-z\d]/i.test(text[end - 1])) end--;
    const domain = text.slice(at + 1, end);
    if (start < at && /^[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}$/i.test(domain))
      matches.push({ kind: "email", start, end, text: text.slice(start, end) });
  }
  return matches;
}

interface Rule {
  kind: SensitiveKind;
  pattern: RegExp;
  accept: (match: string) => boolean;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";

const RULES: Rule[] = [
  {
    kind: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    accept: ssnValid,
  },
  {
    kind: "card",
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    accept: (match) => luhnValid(digitsOf(match)),
  },
  {
    kind: "iban",
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z\d]{4}){2,7}(?: ?[A-Z\d]{1,3})?\b/gi,
    accept: ibanValid,
  },
  {
    kind: "date",
    pattern: new RegExp(
      String.raw`\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|(?:${MONTHS})[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2} (?:${MONTHS})[a-z]*\.? \d{4})\b`,
      "gi",
    ),
    accept: () => true,
  },
  {
    kind: "phone",
    pattern: /(?:\+|\(|\b)\d[\d ().-]{5,18}\d\b/g,
    accept: (match) => {
      const count = digitsOf(match).length;
      const international = match.startsWith("+") && count >= 8 && count <= 15;
      if (match.startsWith("(") && !/^\(\d{2,4}\)/.test(match)) return false;
      return international || (count >= 10 && count <= 11 && /[ ().-]/.test(match));
    },
  },
];

const overlaps = (a: SensitiveMatch, b: SensitiveMatch) => a.start < b.end && b.start < a.end;

/**
 * Matches of the requested kinds in `text`. Earlier, more specific kinds win where matches
 * overlap, so a card number is not also reported as a phone number.
 */
export function findSensitive(text: string, kinds: Iterable<SensitiveKind>): SensitiveMatch[] {
  const wanted = new Set(kinds);
  const found: SensitiveMatch[] = wanted.has("email") ? emails(text) : [];
  for (const rule of RULES) {
    if (!wanted.has(rule.kind)) continue;
    for (const match of text.matchAll(rule.pattern)) {
      const candidate: SensitiveMatch = {
        kind: rule.kind,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      };
      if (rule.accept(match[0]) && !found.some((other) => overlaps(other, candidate)))
        found.push(candidate);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

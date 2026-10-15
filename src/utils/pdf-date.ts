/** Parses a recorded PDF date into ISO 8601, returning an empty string for invalid dates. */
export function parsePdfDate(value: string): string {
  const parts = /^(\d{4}(?:\d{2}){0,5})(.*)$/.exec(value.trim().replace(/^D:/, ""));
  if (!parts) return "";
  if (!/^(?:[Zz]|[+-]\d{2}'?(?:\d{2})?'?)?$/.test(parts[2])) return "";
  const digits = parts[1];
  const field = (start: number, fallback: string) => digits.slice(start, start + 2) || fallback;
  const year = Number(digits.slice(0, 4));
  const month = Number(field(4, "01"));
  const day = Number(field(6, "01"));
  const hours = Number(field(8, "00"));
  const minutes = Number(field(10, "00"));
  const seconds = Number(field(12, "00"));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  )
    return "";
  const zone =
    parts[2] && /^[+-]/.test(parts[2]) ? /^([+-])(\d{2})'?(\d{2})?'?$/.exec(parts[2]) : null;
  if (zone && (Number(zone[2]) > 23 || Number(zone[3] ?? "00") > 59)) return "";
  const offset = zone ? `${zone[1]}${zone[2]}:${zone[3] ?? "00"}` : "Z";
  const iso = `${digits.slice(0, 4)}-${field(4, "01")}-${field(6, "01")}T${field(8, "00")}:${field(10, "00")}:${field(12, "00")}${offset}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

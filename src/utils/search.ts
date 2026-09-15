export function snippet(text: string, index: number, length: number) {
  const start = Math.max(0, index - 36),
    end = Math.min(text.length, index + length + 52);
  return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}
export function clampPage(page: number, count: number) {
  return Math.max(1, Math.min(count, Math.round(Number.isFinite(page) ? page : 1)));
}
export function boundedZoom(value: number) {
  return Math.max(0.25, Math.min(5, Number.isFinite(value) ? value : 1));
}

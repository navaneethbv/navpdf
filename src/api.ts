import type { Command } from "./types";
let token: Promise<string> | undefined;
export async function call<T = any>(args: Command): Promise<T> {
  if (window.navpdf) return window.navpdf.call(args);
  token ??= fetch("/api/session").then(async (r) => {
    if (!r.ok) throw new Error("Start the local app with npm run dev.");
    return (await r.json()).token;
  });
  const response = await fetch("/api/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-NavPDF-Token": await token,
    },
    body: JSON.stringify(args),
  });
  const payload = await response.json();
  if (!response.ok || payload.error)
    throw new Error(payload.error || "PDF operation failed.");
  return payload.result;
}
export function readFile(file: File): Promise<string> {
  if (file.size > 100 * 1024 * 1024)
    return Promise.reject(new Error("Choose a file smaller than 100 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Unable to read this file."));
    reader.readAsDataURL(file);
  });
}
export async function saveFile(payload: { data: string; name: string }) {
  if (window.navpdf) return window.navpdf.save(payload);
  const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
export function parsePages(input: string, count: number) {
  const pages = new Set<number>();
  for (const segment of input.split(",")) {
    const match = segment.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new Error("Use page numbers or ranges, for example 1, 3-5.");
    const start = Number(match[1]),
      end = Number(match[2] || match[1]);
    if (start < 1 || end > count || start > end)
      throw new Error(`Choose pages between 1 and ${count}.`);
    for (let i = start; i <= end; i++) pages.add(i - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

export async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Identifies document content independently of the session id: the trailer `/ID`, else the
 * PDF.js fingerprint (derived from `/ID` or a hash of the file header), plus the page count.
 */
export async function contentIdentity(pdf: {
  getMetadata?: () => Promise<{ info?: { ID?: unknown } }>;
  fingerprints?: Array<string | null>;
  numPages: number;
}): Promise<string> {
  let trailerId = pdf.fingerprints?.[0] ?? "";
  if (!trailerId && typeof pdf.getMetadata === "function") {
    try {
      const meta = await pdf.getMetadata();
      const rawId = meta?.info?.ID;
      if (Array.isArray(rawId) && rawId.length > 0) {
        trailerId = String(rawId[0]);
      } else if (typeof rawId === "string") {
        trailerId = rawId;
      }
    } catch {
      // ignore
    }
  }
  const hash = await sha256Hex(trailerId);
  return `${hash}:${pdf.numPages}`;
}

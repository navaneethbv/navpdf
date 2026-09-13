/** Older WKWebView releases lack the stream iterator used by PDF.js text layers. */
export async function preparePlatform() {
  if (
    typeof globalThis.ReadableStream?.prototype[Symbol.asyncIterator] !==
    "function"
  ) {
    await import("web-streams-polyfill/polyfill");
  }
}

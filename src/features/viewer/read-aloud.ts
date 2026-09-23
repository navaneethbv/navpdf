export type ReadAloudState = "idle" | "speaking" | "paused";

/** The subset of the Web Speech synthesizer that Read Out Loud uses. */
export interface SpeechEngine {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface ReadAloudHost {
  pageText(page: number): Promise<string>;
  showPage(page: number): void;
  onState(state: ReadAloudState, page: number | null): void;
}

/** Longest text handed to the synthesizer at once; long utterances can stall in WebKit. */
const CHUNK_LIMIT = 600;

/** Splits page text into sentence-aligned chunks for the synthesizer. */
export function speechChunks(text: string, limit = CHUNK_LIMIT): string[] {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    for (let start = 0; start < sentence.length; start += limit) {
      const piece = sentence.slice(start, start + limit);
      if (current && current.length + piece.length + 1 > limit) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function speechEngine(): SpeechEngine | null {
  return typeof globalThis.speechSynthesis === "object" &&
    typeof globalThis.SpeechSynthesisUtterance === "function"
    ? globalThis.speechSynthesis
    : null;
}

/**
 * Read Out Loud through the operating system's speech synthesizer. Text is extracted from
 * the PDF text layer only; scanned pages without OCR text are skipped.
 */
export class ReadAloud {
  private session = 0;
  private state: ReadAloudState = "idle";

  constructor(
    private readonly host: ReadAloudHost,
    private readonly engine: SpeechEngine | null = speechEngine(),
  ) {}

  get supported() {
    return this.engine !== null;
  }

  get current() {
    return this.state;
  }

  /** Reads `first` through `last`, showing each page as it is read. */
  async read(first: number, last: number) {
    if (!this.engine) throw new Error("Read Out Loud is not available on this system.");
    this.stop();
    const session = ++this.session;
    const engine = this.engine;
    let spoke = false;
    for (let page = first; page <= last; page++) {
      const text = await this.host.pageText(page);
      if (session !== this.session) return;
      const chunks = speechChunks(text);
      if (chunks.length === 0) continue;
      spoke = true;
      this.host.showPage(page);
      this.setState(this.state === "paused" ? "paused" : "speaking", page);
      for (const chunk of chunks) {
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          engine.speak(utterance);
        });
        if (session !== this.session) return;
      }
    }
    this.session++;
    this.setState("idle", null);
    if (!spoke) throw new Error("No readable text was found. Scanned pages need OCR first.");
  }

  pause() {
    if (this.state !== "speaking" || !this.engine) return;
    this.engine.pause();
    this.setState("paused", null);
  }

  resume() {
    if (this.state !== "paused" || !this.engine) return;
    this.engine.resume();
    this.setState("speaking", null);
  }

  stop() {
    this.session++;
    if (this.state === "idle") return;
    // Cancelling fires onend or onerror for queued utterances, which the new session ignores.
    this.engine?.cancel();
    this.setState("idle", null);
  }

  private setState(state: ReadAloudState, page: number | null) {
    this.state = state;
    this.host.onState(state, page);
  }
}

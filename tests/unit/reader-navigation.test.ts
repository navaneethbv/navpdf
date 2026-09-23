import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewHistory, VIEW_HISTORY_LIMIT } from "../../src/features/viewer/view-history";
import { AutoScroll, AUTO_SCROLL_SPEEDS } from "../../src/features/viewer/auto-scroll";
import { ReadAloud, speechChunks, type SpeechEngine } from "../../src/features/viewer/read-aloud";

describe("ViewHistory", () => {
  it("returns through earlier jumps and forward again", () => {
    const views = new ViewHistory();
    expect(views.previous(1, 10)).toBeNull();
    views.record(1);
    views.record(5);
    expect(views.previous(9, 10)).toBe(5);
    expect(views.previous(5, 10)).toBe(1);
    expect(views.canGoBack).toBe(false);
    expect(views.next(1, 10)).toBe(5);
    expect(views.next(5, 10)).toBe(9);
    expect(views.canGoForward).toBe(false);
  });

  it("clears Next View after a new jump and ignores duplicates and invalid pages", () => {
    const views = new ViewHistory();
    views.record(2);
    views.record(2);
    views.record(0);
    views.record(Number.NaN);
    expect(views.previous(7, 10)).toBe(2);
    expect(views.canGoBack).toBe(false);
    views.record(2);
    expect(views.canGoForward).toBe(false);
  });

  it("skips pages removed by edits and the page already shown", () => {
    const views = new ViewHistory();
    views.record(3);
    views.record(8);
    views.record(4);
    expect(views.previous(4, 5)).toBe(3);
  });

  it("keeps a bounded number of earlier views", () => {
    const views = new ViewHistory();
    for (let page = 1; page <= VIEW_HISTORY_LIMIT + 20; page++) views.record(page);
    let steps = 0;
    while (views.previous(1_000, 1_000) !== null) steps++;
    expect(steps).toBe(VIEW_HISTORY_LIMIT);
  });
});

describe("AutoScroll", () => {
  function setup(nextPage = () => false) {
    const frames: Array<(time: number) => void> = [];
    const container = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 } as HTMLElement;
    const changes: boolean[] = [];
    const scroll = new AutoScroll(
      { container, nextPage, onChange: (active) => changes.push(active) },
      (callback) => frames.push(callback),
      vi.fn(),
    );
    const run = (time: number) => frames.shift()?.(time);
    return { scroll, container, changes, run };
  }

  it("scrolls at the selected speed and stops at the end", () => {
    const { scroll, container, changes, run } = setup();
    scroll.start();
    expect(scroll.active).toBe(true);
    run(0);
    run(100);
    expect(container.scrollTop).toBe(Math.floor(AUTO_SCROLL_SPEEDS[1] / 10));
    scroll.faster();
    expect(scroll.pixelsPerSecond).toBe(AUTO_SCROLL_SPEEDS[2]);
    scroll.slower();
    scroll.slower();
    scroll.slower();
    expect(scroll.pixelsPerSecond).toBe(AUTO_SCROLL_SPEEDS[0]);
    container.scrollTop = 800;
    run(200);
    expect(scroll.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("turns single-page views and stops on toggle", () => {
    const nextPage = vi.fn(() => true);
    const { scroll, container, run } = setup(nextPage);
    scroll.toggle();
    container.scrollTop = 800;
    run(0);
    expect(nextPage).toHaveBeenCalledOnce();
    expect(container.scrollTop).toBe(0);
    scroll.toggle();
    expect(scroll.active).toBe(false);
    run(16);
    expect(container.scrollTop).toBe(0);
  });
});

describe("Read Out Loud", () => {
  class Utterance {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  beforeEach(() => {
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  });

  function engine() {
    const spoken: string[] = [];
    let pending: Utterance | null = null;
    const speech: SpeechEngine & { finish(): void; spoken: string[] } = {
      spoken,
      speak: vi.fn((utterance) => {
        pending = utterance as unknown as Utterance;
        spoken.push(pending.text);
      }),
      cancel: vi.fn(() => pending?.onerror?.()),
      pause: vi.fn(),
      resume: vi.fn(),
      finish: () => pending?.onend?.(),
    };
    return speech;
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("splits long text into sentence-aligned chunks", () => {
    expect(speechChunks("  ")).toEqual([]);
    expect(speechChunks("One. Two!  Three?", 8)).toEqual(["One.", "Two!", "Three?"]);
    expect(speechChunks("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("reads each page with text, shows it and returns to idle", async () => {
    const speech = engine();
    const shown: number[] = [];
    const states: string[] = [];
    const reader = new ReadAloud(
      {
        pageText: async (page) => (page === 2 ? " " : `Page ${page} text.`),
        showPage: (page) => shown.push(page),
        onState: (state) => states.push(state),
      },
      speech,
    );
    const done = reader.read(1, 3);
    await flush();
    speech.finish();
    await flush();
    speech.finish();
    await done;
    expect(speech.spoken).toEqual(["Page 1 text.", "Page 3 text."]);
    expect(shown).toEqual([1, 3]);
    expect(states.at(-1)).toBe("idle");
    expect(reader.current).toBe("idle");
  });

  it("pauses, resumes and stops without reading further pages", async () => {
    const speech = engine();
    const reader = new ReadAloud(
      { pageText: async () => "Words.", showPage: vi.fn(), onState: vi.fn() },
      speech,
    );
    const done = reader.read(1, 5);
    await flush();
    reader.pause();
    expect(reader.current).toBe("paused");
    expect(speech.pause).toHaveBeenCalled();
    reader.resume();
    expect(reader.current).toBe("speaking");
    reader.stop();
    await done;
    expect(speech.cancel).toHaveBeenCalled();
    expect(speech.spoken).toHaveLength(1);
    expect(reader.current).toBe("idle");
  });

  it("reports pages without readable text and unsupported systems", async () => {
    const reader = new ReadAloud(
      { pageText: async () => "", showPage: vi.fn(), onState: vi.fn() },
      engine(),
    );
    await expect(reader.read(1, 2)).rejects.toThrow(/OCR/);
    const unsupported = new ReadAloud(
      { pageText: async () => "x", showPage: vi.fn(), onState: vi.fn() },
      null,
    );
    expect(unsupported.supported).toBe(false);
    await expect(unsupported.read(1, 1)).rejects.toThrow(/not available/);
  });
});

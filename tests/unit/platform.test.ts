import { expect, it, vi } from "vitest";
import { preparePlatform } from "../../src/services/platform";
it("preserves a complete native streams implementation", async () => {
  const original = globalThis.ReadableStream;
  await preparePlatform();
  expect(globalThis.ReadableStream).toBe(original);
});
it("supplies working asynchronous streams on older webviews", async () => {
  const originals = {
    ReadableStream: globalThis.ReadableStream,
    WritableStream: globalThis.WritableStream,
    TransformStream: globalThis.TransformStream,
  };
  try {
    vi.stubGlobal(
      "ReadableStream",
      class {
        static prototypeMarker = true;
      },
    );
    await preparePlatform();
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(42);
        controller.close();
      },
    });
    const values: number[] = [];
    for await (const value of stream) values.push(value);
    expect(values).toEqual([42]);
  } finally {
    vi.unstubAllGlobals();
    Object.assign(globalThis, originals);
  }
});

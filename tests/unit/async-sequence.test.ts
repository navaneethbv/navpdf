import { describe, expect, it } from "vitest";
import { mapInOrder } from "../../src/utils/async-sequence";

describe("ordered asynchronous work", () => {
  it("waits for the consumer and never starts work after early termination", async () => {
    const started: number[] = [];
    let finish: ((value: string) => void) | undefined;
    const sequence = mapInOrder([1, 2, 3], (value) => {
      started.push(value);
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    expect(started).toEqual([]);
    const first = sequence.next();
    expect(started).toEqual([1]);
    finish!("first result");
    await expect(first).resolves.toEqual({ value: "first result", done: false });
    expect(started).toEqual([1]);
    await sequence.return(undefined);
    await expect(sequence.next()).resolves.toEqual({ value: undefined, done: true });
    expect(started).toEqual([1]);
  });

  it("propagates a rejected operation without starting later work", async () => {
    const failure = new Error("Cannot read page");
    const started: number[] = [];
    const sequence = mapInOrder([1, 2], (value) => {
      started.push(value);
      return Promise.reject(failure);
    });
    await expect(sequence.next()).rejects.toBe(failure);
    await expect(sequence.next()).resolves.toEqual({ value: undefined, done: true });
    expect(started).toEqual([1]);
  });
});

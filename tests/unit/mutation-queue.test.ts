import { describe, it, expect } from "vitest";
import { MutationQueue } from "../../src/services/mutation-queue";

describe("MutationQueue", () => {
  it("runs async tasks strictly sequentially in FIFO order", async () => {
    const queue = new MutationQueue();
    const order: number[] = [];

    const p1 = queue.run("task 1", async () => {
      await new Promise((r) => setTimeout(r, 25));
      order.push(1);
      return "one";
    });

    const p2 = queue.run("task 2", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
      return "two";
    });

    const p3 = queue.run("task 3", async () => {
      order.push(3);
      return "three";
    });

    expect(queue.pending).toBe(3);
    const results = await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(["one", "two", "three"]);
    expect(queue.pending).toBe(0);
  });

  it("continues processing subsequent tasks even if a prior task fails", async () => {
    const queue = new MutationQueue();
    const order: number[] = [];

    const p1 = queue.run("failing", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
      throw new Error("Task 1 error");
    });

    const p2 = queue.run("succeeding", async () => {
      order.push(2);
      return "recovered";
    });

    await expect(p1).rejects.toThrow("Task 1 error");
    const res2 = await p2;
    expect(res2).toBe("recovered");
    expect(order).toEqual([1, 2]);
    expect(queue.pending).toBe(0);
  });
});

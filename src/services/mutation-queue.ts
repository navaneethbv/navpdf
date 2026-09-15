export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pendingCount = 0;

  get pending(): number {
    return this.pendingCount;
  }

  async run<T>(_label: string, fn: () => Promise<T>): Promise<T> {
    this.pendingCount++;
    const previous = this.tail;
    let result: T;
    let error: unknown;

    const current = (async () => {
      try {
        await previous;
      } catch {
        // Continue queue execution even if previous mutation failed
      }
      try {
        result = await fn();
      } catch (err) {
        error = err;
      } finally {
        this.pendingCount--;
      }
    })();

    this.tail = current;
    await current;

    if (error !== undefined) {
      throw error;
    }
    return result!;
  }
}

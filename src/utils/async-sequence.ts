/** Run one operation at a time, starting the next only when the consumer requests it. */
export async function* mapInOrder<Input, Output>(
  items: Iterable<Input>,
  operation: (item: Input) => Promise<Output>,
): AsyncGenerator<Output> {
  for (const item of items) yield operation(item);
}

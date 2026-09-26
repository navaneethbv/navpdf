import type { CompressionPreset, CompressionReport, EngineResult } from "../../types/engine";

function checkCancelled(cancelled: () => boolean): void {
  if (cancelled()) throw new Error("Compression cancelled.");
}

/** Candidates always start from the original bytes, preventing cumulative image degradation. */
export async function compressToTarget(
  bytes: Uint8Array,
  targetBytes: number,
  run: (bytes: Uint8Array, preset: CompressionPreset) => Promise<EngineResult<CompressionReport>>,
  cancelled: () => boolean,
): Promise<EngineResult<CompressionReport>> {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 1024)
    throw new Error("Target must be at least 1 KB.");
  checkCancelled(cancelled);
  if (bytes.length < targetBytes) {
    const result = await run(bytes, "lossless");
    checkCancelled(cancelled);
    return result;
  }
  let best: EngineResult<CompressionReport> | undefined;
  for (const preset of ["lossless", "balanced", "small"] as const) {
    checkCancelled(cancelled);
    const result = await run(bytes, preset);
    checkCancelled(cancelled);
    if (!best || (result.bytes && (!best.bytes || result.bytes.length < best.bytes.length)))
      best = result;
    if (result.bytes && result.bytes.length < targetBytes) return result;
  }
  return best!;
}

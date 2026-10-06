import { useState } from "react";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";

export interface EditResult {
  bytes: Uint8Array;
  status: string;
}

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The operation could not be completed.";

/**
 * Applies a byte-level edit to the open document with undo history. The edit is discarded if
 * another document was opened meanwhile, and failures stay in the dialog for a retry.
 */
export function useDocumentEdit(controller: ViewerController | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = useWorkspace((state) => state.set);

  /** `edit` may return a status describing what changed instead of the default `status`. */
  const apply = async (
    status: string,
    edit: (bytes: Uint8Array) => Promise<Uint8Array | EditResult>,
  ): Promise<boolean> => {
    const source = controller?.pdf;
    if (!controller || !source || busy) return false;
    setBusy(true);
    setError("");
    try {
      const bytes = await source.saveDocument();
      const result = await edit(bytes);
      const changed = result instanceof Uint8Array ? result : result.bytes;
      const message = result instanceof Uint8Array ? status : result.status;
      await controller.replaceWithBytes(changed, message, {
        expectedSource: source,
        preMutationBytes: bytes,
      });
      set({ status: message });
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { apply, busy, error, setError };
}
